//! The square's optional `tailnet` field: the door's Tailscale base URL,
//! read off this machine's Tailscale CLI, or nothing.
//!
//! The field exists so a paired phone can reach the door from outside the
//! house. It is offered only when the desk sees BOTH of its serve rules —
//! 443 proxying the door, 8443 proxying this desk — because a square that
//! named a tailnet behind anything less would point the phone somewhere
//! that is not listening. Any other answer is absence: no CLI, a timeout,
//! a missing rule, a wrong port, an unexpected shape. The value rides the
//! QR alone — it appears on the owner's own screen and nowhere else, so
//! nothing here logs it and nothing may.
//!
//! Detection runs the CLI on a background thread with a short timeout, so
//! the square is never waited on and never failed by it: the caller reads a
//! cache, and a square made before the first detection lands is plain until
//! the next one.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long a detection is trusted. The serve rules are standing
/// configuration, but the owner can add or remove them while the app runs.
const REFRESH_AFTER: Duration = Duration::from_secs(300);
/// The CLI answers from local state; a hung binary costs at most this.
const CLI_TIMEOUT: Duration = Duration::from_secs(2);
/// The serve port the rules must proxy the door behind.
const DOOR_SERVE_PORT: u16 = 443;
/// The serve port the rules must proxy this desk behind.
const DESK_SERVE_PORT: u16 = 8443;

pub(crate) struct Tailnet {
    inner: Arc<Inner>,
}

struct Inner {
    cached: Mutex<Option<(Instant, Option<String>)>>,
    refreshing: AtomicBool,
}

impl Tailnet {
    pub(crate) fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                cached: Mutex::new(None),
                refreshing: AtomicBool::new(false),
            }),
        }
    }

    /// The URL for the next square, or `None`. Never blocks and never runs
    /// the CLI on the caller's thread: a stale cache hands back what it has
    /// while a refresh starts besides, so the first square of a session may
    /// be plain and the next refresh of the square carries the field.
    pub(crate) fn get(&self, door_port: Option<u16>, desk_port: u16) -> Option<String> {
        // The field names the door through the serve rules; a door that is
        // not listening has no address to name.
        let door_port = door_port?;
        let cached = self.inner.cached.lock().unwrap_or_else(|e| e.into_inner());
        let stale = match *cached {
            Some((seen_at, _)) => seen_at.elapsed() >= REFRESH_AFTER,
            None => true,
        };
        if stale && !self.inner.refreshing.swap(true, Ordering::SeqCst) {
            let inner = Arc::clone(&self.inner);
            std::thread::spawn(move || {
                let value = detect(door_port, desk_port);
                *inner.cached.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some((Instant::now(), value));
                inner.refreshing.store(false, Ordering::SeqCst);
            });
        }
        cached.as_ref().and_then(|(_, value)| value.clone())
    }
}

/// What the CLI was asked and answered, or `None` for every way it can come
/// up empty: not installed, too slow, an exit it cannot redeem.
fn detect(door_port: u16, desk_port: u16) -> Option<String> {
    let candidates = cli_candidates();
    let status = run_any(&candidates, &["status", "--json"])?;
    let serve = run_any(&candidates, &["serve", "status", "--json"])?;
    decide(&status, &serve, door_port, desk_port)
}

/// The decision on the CLI's captured output — the half of [`detect`] the
/// unit tests stand at, so the shapes are pinned without spawning anything.
fn decide(status_json: &str, serve_json: &str, door_port: u16, desk_port: u16) -> Option<String> {
    let host = dns_name(status_json)?;
    both_rules_up(serve_json, door_port, desk_port).then(|| format!("https://{host}"))
}

/// The machine's tailnet host, from `status --json`'s `Self.DNSName`, the
/// CLI's trailing dot taken back off.
fn dns_name(status_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(status_json).ok()?;
    let name = value.get("Self")?.get("DNSName")?.as_str()?;
    let host = name.strip_suffix('.').unwrap_or(name);
    (!host.is_empty()).then(|| host.to_string())
}

/// Whether `serve status --json` shows BOTH rules: the `/` handler behind
/// serve port 443 proxying the door, and the one behind 8443 proxying this
/// desk, by the ports in the `Web` keys and the proxy targets. A rule
/// missing, a wrong port, a proxy pointed elsewhere — any of it is no.
fn both_rules_up(serve_json: &str, door_port: u16, desk_port: u16) -> bool {
    let parsed: Option<serde_json::Value> = serde_json::from_str(serve_json).ok();
    let Some(web) = parsed
        .as_ref()
        .and_then(|value| value.get("Web"))
        .and_then(|web| web.as_object())
    else {
        return false;
    };
    proxies_to(web, DOOR_SERVE_PORT, door_port) && proxies_to(web, DESK_SERVE_PORT, desk_port)
}

fn proxies_to(
    web: &serde_json::Map<String, serde_json::Value>,
    serve_port: u16,
    behind: u16,
) -> bool {
    let key_port = serve_port.to_string();
    let target = format!("http://127.0.0.1:{behind}");
    web.iter().any(|(key, entry)| {
        key.rsplit(':').next() == Some(key_port.as_str())
            && entry
                .get("Handlers")
                .and_then(|handlers| handlers.get("/"))
                .and_then(|root| root.get("Proxy"))
                .and_then(|proxy| proxy.as_str())
                == Some(target.as_str())
    })
}

/// Where the CLI is looked for, in order: the paths real installs leave it
/// at, then bare `PATH`, which the spawn itself resolves.
fn cli_candidates() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/Tailscale"),
            PathBuf::from("tailscale"),
        ]
    }
    #[cfg(target_os = "windows")]
    {
        vec![
            PathBuf::from("tailscale"),
            PathBuf::from("C:\\Program Files\\Tailscale\\tailscale.exe"),
        ]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        vec![PathBuf::from("tailscale")]
    }
}

fn run_any(candidates: &[PathBuf], args: &[&str]) -> Option<String> {
    candidates.iter().find_map(|cli| run(cli, args))
}

/// One CLI run, killed after [`CLI_TIMEOUT`]. `None` for a spawn failure, a
/// timeout, or a nonzero exit — the caller can use none of them.
fn run(cli: &Path, args: &[&str]) -> Option<String> {
    let mut child = Command::new(cli)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (send, received) = mpsc::channel();
    std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        let _ = send.send(text);
    });
    let deadline = Instant::now() + CLI_TIMEOUT;
    let text = loop {
        match received.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(text) => break text,
            Err(RecvTimeoutError::Timeout) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(RecvTimeoutError::Disconnected) => return None,
        }
    };
    child.wait().ok()?.success().then_some(text)
}

#[cfg(test)]
mod tests {
    use super::{decide, dns_name};

    // Captured from `tailscale status --json` and `tailscale serve status
    // --json` on a machine with both rules up, the owner's own host name
    // replaced; structure and field set are the CLI's.
    const STATUS_JSON: &str = r#"{"Version":"1.90.0","BackendState":"Running","Self":{"ID":"1","HostName":"desk","DNSName":"desk.tail99zz44x.ts.net.","Online":true},"MagicDNSSuffix":".tail99zz44x.ts.net."}"#;

    fn serve_json(rules: &[String]) -> String {
        format!(r#"{{"TCP":{{"443":{{"HTTPS":true}},"8443":{{"HTTPS":true}}}},"Web":{{{}}}}}"#, rules.join(","))
    }

    fn rule(host_port: &str, proxy: &str) -> String {
        format!(r#""{host_port}":{{"Handlers":{{"/":{{"Proxy":"{proxy}"}}}}}}"#)
    }

    fn both_rules(door_port: u16, desk_port: u16) -> Vec<String> {
        vec![
            rule("desk.tail99zz44x.ts.net:443", &format!("http://127.0.0.1:{door_port}")),
            rule("desk.tail99zz44x.ts.net:8443", &format!("http://127.0.0.1:{desk_port}")),
        ]
    }

    #[test]
    fn both_rules_up_names_the_door_on_the_tailnet() {
        let url = decide(
            STATUS_JSON,
            &serve_json(&both_rules(8131, 8134)),
            8131,
            8134,
        );
        assert_eq!(
            url.as_deref(),
            Some("https://desk.tail99zz44x.ts.net"),
            "the trailing dot comes off, the scheme goes on"
        );
    }

    #[test]
    fn one_rule_missing_is_absence() {
        let mut rules = both_rules(8131, 8134);
        rules.remove(1);
        assert_eq!(
            decide(STATUS_JSON, &serve_json(&rules), 8131, 8134),
            None,
            "a door rule with no desk rule points the phone nowhere"
        );
    }

    #[test]
    fn a_rule_behind_the_wrong_port_is_absence() {
        // The desk fell back off its preferred port, so the standing rule
        // now proxies a port nothing listens on.
        assert_eq!(
            decide(
                STATUS_JSON,
                &serve_json(&both_rules(8131, 8135)),
                8131,
                8134,
            ),
            None,
            "the rule must proxy the port the desk actually listens on"
        );
    }

    #[test]
    fn no_dns_name_is_absence() {
        let logged_out = r#"{"BackendState":"NeedsLogin","Self":null}"#;
        assert_eq!(dns_name(logged_out), None, "no Self, no name");
        let nameless = r#"{"BackendState":"Running","Self":{"HostName":"desk"}}"#;
        assert_eq!(dns_name(nameless), None, "no DNSName, no name");
        assert_eq!(
            decide(
                nameless,
                &serve_json(&both_rules(8131, 8134)),
                8131,
                8134,
            ),
            None,
            "both rules and no name is still no URL"
        );
    }

    #[test]
    fn any_unexpected_shape_is_absence() {
        assert_eq!(decide(STATUS_JSON, "not json", 8131, 8134), None);
        assert_eq!(decide("not json", &serve_json(&both_rules(8131, 8134)), 8131, 8134), None);
        assert_eq!(
            decide(STATUS_JSON, &serve_json(&[]), 8131, 8134),
            None,
            "no rules at all is the common case"
        );
    }
}
