//! The square's optional `tailnet` field: the door's Tailscale base URL,
//! read off this machine's Tailscale CLI, or nothing.
//!
//! The field exists so a paired phone can reach the door from outside the
//! house. It is offered only when the CLI shows BOTH of this desk's serve
//! rules on this machine's own tailnet name — 443 proxying the door, 8443
//! proxying this desk — because a square that named a tailnet behind
//! anything less would point the phone somewhere that is not listening.
//! Any other answer is absence: no CLI, a timeout, a missing rule, a wrong
//! port, a host a URL could not hold. The value rides the QR alone — it
//! appears on the owner's own screen and nowhere else, so nothing here
//! logs it and nothing may.
//!
//! Nothing is remembered between calls: a square carries exactly what was
//! true when it was made, and the ports are arguments every time. The CLI
//! is run only from its fixed install homes, never searched for on the
//! PATH — a `tailscale` found by search could be anything at all.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

/// The CLI answers from local state; a hung binary costs at most this per
/// command run.
const CLI_TIMEOUT: Duration = Duration::from_secs(2);
/// The serve port the rules must front the door behind.
const DOOR_SERVE_PORT: u16 = 443;
/// The serve port the rules must front this desk behind.
const DESK_SERVE_PORT: u16 = 8443;
/// The longest host this module will put in a URL. Real MagicDNS names are
/// far shorter; the bound keeps a hostile DNSName from sizing the QR.
const HOST_MAX: usize = 100;

/// The square's tailnet URL as the CLI tells it right now, or `None` for
/// every way the telling can fail. A `door_port` that is absent — the door
/// is down — is absence like any other: the field names a door through its
/// rules.
pub(crate) fn detect(door_port: Option<u16>, desk_port: u16) -> Option<String> {
    let door_port = door_port?;
    let candidates = cli_candidates();
    let status = run_any(&candidates, &["status", "--json"])?;
    let serve = run_any(&candidates, &["serve", "status", "--json"])?;
    decide(&status, &serve, door_port, desk_port)
}

/// The decision on the CLI's captured output — the half of [`detect`] the
/// unit tests stand at, so the shapes are pinned without spawning anything.
fn decide(status_json: &str, serve_json: &str, door_port: u16, desk_port: u16) -> Option<String> {
    let host = host_from_status(status_json)?;
    let serve: serde_json::Value = serde_json::from_str(serve_json).ok()?;
    let both = rule_up(&serve, &host, DOOR_SERVE_PORT, door_port)
        && rule_up(&serve, &host, DESK_SERVE_PORT, desk_port);
    both.then(|| format!("https://{host}"))
}

/// One serve rule, exactly as this desk requires it: the Web key is this
/// host on this serve port — this machine's own name, not merely a key
/// that shares the port — the `/` handler proxies the port named, and the
/// TCP front door speaks HTTPS.
fn rule_up(serve: &serde_json::Value, host: &str, serve_port: u16, behind: u16) -> bool {
    let port = serve_port.to_string();
    let https = serve
        .get("TCP")
        .and_then(|tcp| tcp.get(&port))
        .and_then(|entry| entry.get("HTTPS"))
        .and_then(|flag| flag.as_bool());
    let key = format!("{host}:{serve_port}");
    let target = format!("http://127.0.0.1:{behind}");
    let proxy = serve
        .get("Web")
        .and_then(|web| web.get(&key))
        .and_then(|entry| entry.get("Handlers"))
        .and_then(|handlers| handlers.get("/"))
        .and_then(|root| root.get("Proxy"))
        .and_then(|proxy| proxy.as_str());
    https == Some(true) && proxy == Some(target.as_str())
}

/// The machine's tailnet host, from `status --json`'s `Self.DNSName` with
/// the CLI's trailing dot taken off — and only when it is a host a URL can
/// hold as written, per [`valid_host`]. The DNSName is foreign input like
/// any other the CLI prints.
fn host_from_status(status_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(status_json).ok()?;
    let name = value.get("Self")?.get("DNSName")?.as_str()?;
    let host = name.strip_suffix('.').unwrap_or(name);
    valid_host(host).then(|| host.to_string())
}

/// Lowercase ASCII letters, digits, hyphens and dots; no dot at either
/// end; not empty; at most [`HOST_MAX`] characters. Anything else — a
/// colon, a slash, uppercase, a leading dot — is not a host this desk puts
/// in a URL.
fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= HOST_MAX
        && !host.starts_with('.')
        && !host.ends_with('.')
        && host
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'.')
}

/// Where the CLI lives when it is installed — absolute paths only, in the
/// homes the real installers leave it at, so the child that answers is the
/// machine's own binary and not whatever a writable directory put in the
/// way. Empty on a platform with no known home: the field is absent.
fn cli_candidates() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![PathBuf::from(
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        )]
    }
    #[cfg(target_os = "windows")]
    {
        vec![PathBuf::from(r"C:\Program Files\Tailscale\tailscale.exe")]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        vec![
            PathBuf::from("/usr/bin/tailscale"),
            PathBuf::from("/usr/local/bin/tailscale"),
        ]
    }
}

fn run_any(candidates: &[PathBuf], args: &[&str]) -> Option<String> {
    candidates.iter().find_map(|cli| run(cli, args))
}

/// One CLI run under [`CLI_TIMEOUT`].
fn run(cli: &Path, args: &[&str]) -> Option<String> {
    run_within(cli, args, CLI_TIMEOUT)
}

/// One CLI run under ONE deadline that covers the whole child — reading
/// its output to the end and seeing it exit. `None` for a spawn failure, a
/// deadline that passes, or a nonzero exit; on any of those the child is
/// killed and reaped, never orphaned or left a zombie. The only `wait`
/// without a deadline of its own is the one after a kill, which is the
/// reaping itself.
fn run_within(cli: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let mut cmd = Command::new(cli);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    kalsa_supervisor::hide_console(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let (send, received) = mpsc::channel();
    std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        let _ = send.send(text);
    });
    let deadline = Instant::now() + timeout;
    // A reader that misses the deadline — or dies without a word — ends the
    // run here, with the child reaped.
    let text = match received.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(text) => text,
        Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => {
            kill_and_reap(&mut child);
            return None;
        }
    };
    // The output is in; the process itself must still exit inside the same
    // deadline, polled — never waited on bare.
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success().then_some(text),
            Ok(None) => {}
            Err(_) => {
                kill_and_reap(&mut child);
                return None;
            }
        }
        if Instant::now() >= deadline {
            kill_and_reap(&mut child);
            return None;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn kill_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::{cli_candidates, decide, host_from_status, run_within};
    use std::time::{Duration, Instant};

    // Captured from `tailscale status --json` and `tailscale serve status
    // --json` on a machine with both rules up, the owner's own host name
    // replaced; structure and field set are the CLI's.
    const STATUS_JSON: &str = r#"{"Version":"1.90.0","BackendState":"Running","Self":{"ID":"1","HostName":"desk","DNSName":"desk.tail99zz44x.ts.net.","Online":true},"MagicDNSSuffix":".tail99zz44x.ts.net."}"#;
    const HOST: &str = "desk.tail99zz44x.ts.net";

    fn serve(rules: &[String], tcp: &str) -> String {
        format!(r#"{{"TCP":{tcp},"Web":{{{}}}}}"#, rules.join(","))
    }

    fn serve_json(rules: &[String]) -> String {
        serve(
            rules,
            r#"{"443":{"HTTPS":true},"8443":{"HTTPS":true}}"#,
        )
    }

    fn rule(host_port: &str, proxy: &str) -> String {
        format!(r#""{host_port}":{{"Handlers":{{"/":{{"Proxy":"{proxy}"}}}}}}"#)
    }

    fn both_rules(door_port: u16, desk_port: u16) -> Vec<String> {
        vec![
            rule(&format!("{HOST}:443"), &format!("http://127.0.0.1:{door_port}")),
            rule(&format!("{HOST}:8443"), &format!("http://127.0.0.1:{desk_port}")),
        ]
    }

    #[test]
    fn both_rules_up_names_the_door_on_the_tailnet() {
        let url = decide(STATUS_JSON, &serve_json(&both_rules(8131, 8134)), 8131, 8134);
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
            decide(STATUS_JSON, &serve_json(&both_rules(8131, 8135)), 8131, 8134),
            None,
            "the rule must proxy the port the desk actually listens on"
        );
    }

    #[test]
    fn a_rule_on_another_host_is_absence() {
        // The Web keys must be this machine's own name: a key that merely
        // shares the serve ports, on some other node, points nowhere.
        let rules = vec![
            rule("other-host.tail99zz44x.ts.net:443", "http://127.0.0.1:8131"),
            rule("other-host.tail99zz44x.ts.net:8443", "http://127.0.0.1:8134"),
        ];
        assert_eq!(
            decide(STATUS_JSON, &serve_json(&rules), 8131, 8134),
            None,
            "a serve rule on another machine's name is not this desk's"
        );
    }

    #[test]
    fn a_front_door_that_is_not_https_is_absence() {
        let plain = serve(
            &both_rules(8131, 8134),
            r#"{"443":{"HTTPS":false},"8443":{"HTTPS":true}}"#,
        );
        assert_eq!(
            decide(STATUS_JSON, &plain, 8131, 8134),
            None,
            "the URL this field offers is https, and only rules that front one count"
        );
    }

    #[test]
    fn a_host_the_url_cannot_hold_is_absence() {
        // The DNSName is foreign input: colons and slashes would change
        // what the URL points at, so they end the field, not the quoting.
        let hostile = r#"{"Self":{"DNSName":"box.ts.net:444/path/"}}"#;
        assert_eq!(host_from_status(hostile), None);
        assert_eq!(
            decide(hostile, &serve_json(&both_rules(8131, 8134)), 8131, 8134),
            None,
            "perfectly good rules do not redeem a hostile name"
        );
    }

    #[test]
    fn the_host_cap_is_exactly_one_hundred() {
        let at_cap = format!(r#"{{"Self":{{"DNSName":"{}."}}}}"#, "a".repeat(100));
        assert_eq!(
            host_from_status(&at_cap).as_deref(),
            Some("a".repeat(100).as_str()),
            "one hundred characters is a host"
        );
        let past_cap = format!(r#"{{"Self":{{"DNSName":"{}."}}}}"#, "a".repeat(101));
        assert_eq!(
            host_from_status(&past_cap),
            None,
            "one more is not: the square's worst case stays bounded"
        );
    }

    #[test]
    fn no_dns_name_is_absence() {
        let logged_out = r#"{"BackendState":"NeedsLogin","Self":null}"#;
        assert_eq!(host_from_status(logged_out), None, "no Self, no name");
        let nameless = r#"{"BackendState":"Running","Self":{"HostName":"desk"}}"#;
        assert_eq!(host_from_status(nameless), None, "no DNSName, no name");
        assert_eq!(
            decide(nameless, &serve_json(&both_rules(8131, 8134)), 8131, 8134),
            None,
            "both rules and no name is still no URL"
        );
    }

    #[test]
    fn any_unexpected_shape_is_absence() {
        assert_eq!(decide(STATUS_JSON, "not json", 8131, 8134), None);
        assert_eq!(
            decide("not json", &serve_json(&both_rules(8131, 8134)), 8131, 8134),
            None
        );
        assert_eq!(
            decide(STATUS_JSON, &serve_json(&[]), 8131, 8134),
            None,
            "no rules at all is the common case"
        );
    }

    #[test]
    fn the_cli_is_only_ever_its_fixed_install_homes() {
        // No PATH, no working directory: a `tailscale` found by search
        // could be anything with write access to either.
        let candidates = cli_candidates();
        assert!(!candidates.is_empty());
        assert!(
            candidates.iter().all(|path| path.is_absolute()),
            "a relative candidate is a PATH search in disguise"
        );
    }

    // The child tests need a hand-made executable: a shell script that
    // answers, hangs, or reports its own pid, run through the same
    // `run_within` the CLI goes through.
    #[cfg(unix)]
    fn script(name: &str, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("kalsa-brain-tailnet-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cli");
        std::fs::write(&path, body).unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn a_child_that_answers_in_time_is_read_to_the_end() {
        let cli = script("answers", "#!/bin/sh\necho ok\n");
        assert_eq!(
            run_within(&cli, &[], Duration::from_millis(500)).as_deref(),
            Some("ok\n")
        );
        let _ = std::fs::remove_dir_all(cli.parent().unwrap());
    }

    /// A child that outlives its deadline is killed AND reaped: the pid it
    /// wrote stops existing — a merely-killed child would linger as a
    /// zombie, which keeps answering `kill -0` until someone waits for it.
    #[cfg(unix)]
    #[test]
    fn a_child_that_outlives_its_deadline_is_killed_and_reaped() {
        let dir = std::env::temp_dir().join(format!("kalsa-brain-tailnet-hang-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pidfile = dir.join("pid");
        let cli = script(
            "hangs",
            &format!("#!/bin/sh\necho $$ > {}\nsleep 5\n", pidfile.display()),
        );
        let started = Instant::now();
        let outcome = run_within(&cli, &[], Duration::from_millis(300));
        let elapsed = started.elapsed();

        assert!(outcome.is_none(), "a hung child is no answer");
        assert!(
            elapsed < Duration::from_secs(3),
            "the deadline bounds the whole child: {elapsed:?}"
        );
        let pid = std::fs::read_to_string(&pidfile).unwrap().trim().to_string();
        let mut gone = false;
        for _ in 0..40 {
            let alive = std::process::Command::new("kill")
                .args(["-0", &pid])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|status| status.success());
            if !alive {
                gone = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = std::fs::remove_dir_all(&dir);
        assert!(gone, "pid {pid} still answers kill -0: killed but not reaped");
    }
}
