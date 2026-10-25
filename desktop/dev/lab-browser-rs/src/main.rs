// The line-delimited JSON server the lab harness speaks to (one responsibility:
// read one request per line, answer it on one line, until stdin closes).
//
// Everything below the pipe is `kalsa-browser`: this file keeps no parser, no
// snapshot rule and no Enter rule of its own, so a fix in the product lands in
// the lab in the same build.
use std::io::{BufRead, Write};
use std::path::PathBuf;

use kalsa_browser::{guard, hold, input, mcp, snapshot as page_snapshot};
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

/// Waits for the page to stop moving, so the next call reads where it landed
/// rather than the page it left.
///
/// **A real site is slow** — the lab's own form posts to a public service that
/// takes seconds — so this waits for the page to actually be somewhere else, not
/// merely to stop moving. Bounded, because a page that never settles is a page
/// the caller must be able to read anyway.
async fn settle(page: &playwright_rs::protocol::Page, was: &str) {
    let started = std::time::Instant::now();
    while started.elapsed() < std::time::Duration::from_secs(20) {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        // Moved is the test that matters: a page still loading on its old
        // address is not where the request went.
        if page.url() != was {
            return;
        }
        match page.evaluate::<(), bool>("() => document.readyState === 'complete'", None).await {
            // Ready, but still on the page it started from.
            Ok(true) => {}
            // Not ready yet, or the page moved out from under the evaluation — a
            // commit in flight. Another turn either way.
            Ok(false) | Err(_) => {}
        }
    }
}

/// The chat this lab drives from. A lab run is one conversation, so this is the
/// only one there is — and it is named rather than defaulted, so a card the lab
/// raises is answerable by the same id it was raised under.
const LAB_CHAT: &str = "lab";

/// One tool call, on the same page and under the same rules the product uses.
async fn run(
    sessions: &Sessions,
    url: &std::cell::Cell<String>,
    tool: &str,
    args: &serde_json::Value,
) -> Result<String, String> {
    let (page, landings, holds) =
        sessions.page().await.map_err(|unavailable| unavailable.message().to_string())?;
    // The window is bound to the one conversation this lab drives, exactly as a
    // real one is bound to the chat whose turn is driving it.
    holds.navigated_by(LAB_CHAT).await;
    match tool {
        "browser_navigate" => {
            let raw = arg_str(args, "url").trim().to_string();
            let target = if raw.starts_with("http://") || raw.starts_with("https://") {
                raw
            } else {
                format!("https://{raw}")
            };
            if let guard::Verdict::Refused(refusal) = guard::decide(&target).await {
                return Err(refusal.reason().to_string());
            }
            page.goto(&target, None).await.map_err(|error| kalsa_browser::session::explain(&error))?;
            // A redirect hop is not offered to the route in this stack, so where
            // we landed is judged here.
            if let Some(refusal) = landings.refused(&page.url()).await {
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
        // **The two writing tools go through the product's own hold**, by the
        // same `mcp::acting` the app's executor reaches. A lab that called the
        // input helpers directly would leave a form post sitting in a held
        // route with nobody to answer it, and would prove nothing about the
        // product: what is being measured is what a write does when a person
        // has not said so yet.
        "browser_click" => {
            let id = sessions.ref_of(&arg_str(args, "ref")).await.map_err(str::to_string)?;
            let before = holds.ids().await;
            let (clicked, held) = // **The lab judges an address with the product's own rule**, as the app's
            // executor does: the lab is driving real sites, and a lab that allowed
            // what the product refuses would be measuring a browser Kalsa does not
            // ship. The conversation rides along so a card it raises belongs to
            // this run.
            mcp::acting(&page, &holds, LAB_CHAT, &before, mcp::the_address, input::click(&page, &id)).await;
            clicked.map_err(|refused| refused.reason().to_string())?;
            match held {
                Some(id) => Ok(hold::awaiting(&id)),
                None => read(sessions, &page, 1).await,
            }
        }
        "browser_type" => {
            // No `submit` here, exactly as in the product: Enter is decided by
            // the crate from the field's own shape, and a lab that could press
            // a key the product cannot would prove nothing about the product.
            let id = sessions.ref_of(&arg_str(args, "ref")).await.map_err(str::to_string)?;
            let before = holds.ids().await;
            let (filled, held) =
                mcp::acting(&page, &holds, LAB_CHAT, &before, mcp::the_address, input::fill(&page, &id, &arg_str(args, "text"))).await;
            filled.map_err(|refused| refused.reason().to_string())?;
            match held {
                Some(id) => Ok(hold::awaiting(&id)),
                None => read(sessions, &page, 1).await,
            }
        }
        // The person's answer, which only the harness ever sends: a model is
        // offered none of these, exactly as in the product.
        "browser_confirm" | "browser_decline" => {
            let yes = tool == "browser_confirm";
            let answer = holds.answer(&arg_str(args, "id"), LAB_CHAT, yes).await;
            // A confirm that sent something is a navigation, and the next call
            // reads the page it lands on. The sidecar lets the next call settle
            // for itself; here the harness reads straight after, so the wait is
            // on this side of the answer — the same wait, in the one place that
            // needs it.
            if yes {
                let was = page.url();
                settle(&page, &was).await;
                // The address the run reports is the one the page is on, not the
                // one it was sent to from: a confirm that landed somewhere else
                // would otherwise be reported as if it had not moved.
                if tool == "browser_confirm" {
                    url.replace(page.url());
                }
            }
            Ok(match answer {
                hold::Answer::Spent(outcome) => outcome.sentence(),
                hold::Answer::Unknown => "there is no request waiting with that id".to_string(),
            })
        }
        // Not a tool a model may call: it is here so the harness can say what a
        // card holds before it answers one, and so a held request nobody answers
        // is visible rather than silently sitting in a store.
        "browser_waiting" => {
            Ok(serde_json::to_string(&serde_json::Value::Array(
                holds.cards().await.iter().map(|card| serde_json::json!({
                    "id": card.id,
                    "method": card.method,
                    "url": card.url,
                })).collect(),
            )).map_err(|error| error.to_string())?)
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
    let url = std::cell::Cell::new(String::new());
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
        let reply = match run(&sessions, &url, &request.tool, &request.args).await {
            Ok(text) => json!({ "id": request.id, "ok": true, "text": text }),
            Err(error) => json!({ "id": request.id, "ok": false, "error": error }),
        };
        if writeln!(out, "{reply}").is_err() || out.flush().is_err() {
            break;
        }
    }

    let _ = std::fs::remove_dir_all(&profile);
}