// The line-delimited JSON server the lab harness speaks to (one responsibility:
// read one request per line, answer it on one line, until stdin closes).
//
// Everything below the pipe is `kalsa-browser`: this file keeps no parser, no
// snapshot rule and no Enter rule of its own, so a fix in the product lands in
// the lab in the same build.
use std::io::{BufRead, Write};
use std::path::PathBuf;

use kalsa_browser::{guard, input, snapshot as page_snapshot};
use kalsa_browser::session::Sessions;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Request {
    id: serde_json::Value,
    tool: String,
    #[serde(default)]
    args: serde_json::Value,
}

/// A profile directory of our own, thrown away on the way out. The person's own
/// profile is never touched: see `find_browser`.
fn profile_dir() -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("lab-browser-rs-profile-{stamp}"))
}

fn arg_str(args: &serde_json::Value, key: &str) -> String {
    args.get(key).and_then(|value| value.as_str()).unwrap_or_default().to_string()
}

fn arg_usize(args: &serde_json::Value, key: &str, fallback: usize) -> usize {
    args.get(key).and_then(|value| value.as_u64()).map(|number| number as usize).unwrap_or(fallback)
}

/// A read, and what it printed: the refs it holds are the only ones the next
/// call may act on, exactly as in the product.
async fn read(sessions: &Sessions, page: &playwright_rs::protocol::Page, part: usize) -> Result<String, String> {
    match page_snapshot::snapshot(page, part).await {
        Ok(text) => {
            sessions.remember(&text).await;
            Ok(text)
        }
        Err(error) => Err(kalsa_browser::session::explain(&error)),
    }
}

/// One tool call, on the same page and under the same rules the product uses.
async fn run(sessions: &Sessions, tool: &str, args: &serde_json::Value) -> Result<String, String> {
    let page = sessions.page().await.map_err(|unavailable| unavailable.message().to_string())?;
    match tool {
        "browser_navigate" => {
            let raw = arg_str(args, "url").trim().to_string();
            let url = if raw.starts_with("http://") || raw.starts_with("https://") {
                raw
            } else {
                format!("https://{raw}")
            };
            if let guard::Verdict::Refused(refusal) = guard::decide(&url).await {
                return Err(refusal.reason().to_string());
            }
            page.goto(&url, None).await.map_err(|error| kalsa_browser::session::explain(&error))?;
            // A redirect hop is not offered to the route in this stack, so where
            // we landed is judged here.
            if let Some(refusal) = guard::refused_landing(&page.url()) {
                return Err(refusal.reason().to_string());
            }
            read(sessions, &page, 1).await
        }
        "browser_snapshot" => read(sessions, &page, arg_usize(args, "page", 1)).await,
        "browser_find" => {
            match page_snapshot::find(&page, &arg_str(args, "text"), 1, 40).await {
                Ok(text) => {
                    // A find is a read: its refs are as good as any other's.
                    sessions.remember(&text).await;
                    Ok(text)
                }
                Err(error) => Err(kalsa_browser::session::explain(&error)),
            }
        }
        "browser_click" => {
            let id = sessions.ref_of(&arg_str(args, "ref")).await.map_err(str::to_string)?;
            input::click(&page, &id).await.map_err(|refused| refused.reason().to_string())?;
            read(sessions, &page, 1).await
        }
        "browser_type" => {
            let id = sessions.ref_of(&arg_str(args, "ref")).await.map_err(str::to_string)?;
            input::fill(&page, &id, &arg_str(args, "text"))
                .await
                .map_err(|refused| refused.reason().to_string())?;
            read(sessions, &page, 1).await
        }
        // Verifier-only. Never in the model's tool list: it is an escape hatch
        // out of the page, and a model holding one would take it.
        "page_eval" => {
            let value = page
                .evaluate::<(), serde_json::Value>(&arg_str(args, "expr"), None)
                .await
                .map_err(|error| kalsa_browser::session::explain(&error))?;
            serde_json::to_string(&value).map_err(|error| error.to_string())
        }
        other => Err(format!("there is no tool called {other}")),
    }
}

#[tokio::main]
async fn main() {
    let profile = profile_dir();
    std::fs::create_dir_all(&profile).expect("a profile directory is writable");
    let sessions = Sessions::new(profile.to_string_lossy().into_owned());

    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) if !line.trim().is_empty() => line,
            Ok(_) => continue,
            Err(error) => {
                eprintln!("stdin: {error}");
                break;
            }
        };
        // A line that is not a request must not end the run: a partial write on
        // the other side is the driver's problem to retry, not ours to die on.
        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                let reply =
                    json!({ "id": serde_json::Value::Null, "ok": false, "error": format!("bad request: {error}") });
                let _ = writeln!(out, "{reply}");
                let _ = out.flush();
                continue;
            }
        };
        let reply = match run(&sessions, &request.tool, &request.args).await {
            Ok(text) => json!({ "id": request.id, "ok": true, "text": text }),
            Err(error) => json!({ "id": request.id, "ok": false, "error": error }),
        };
        if writeln!(out, "{reply}").is_err() || out.flush().is_err() {
            break;
        }
    }

    let _ = std::fs::remove_dir_all(&profile);
}