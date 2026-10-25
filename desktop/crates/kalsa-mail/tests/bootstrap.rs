//! The host writes the account line and the first MCP message, then waits for an
//! answer. Both go into the same pipe, often in the same write, and the server must
//! answer instead of hanging on a message the read-ahead already ate.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};

const SECRET: &str = "bootstrap-secret-2b7c";

fn line() -> String {
    format!(
        r#"{{"host":"127.0.0.1","port":1244,"user":"lab","password":"{SECRET}","tls":false,"authserv_id":"mx.lab-provider.example"}}"#
    )
}

fn initialize() -> String {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2026-07-28",
            "capabilities": {},
            "clientInfo": {"name": "bootstrap-test", "version": "0"}
        }
    })
    .to_string()
}

#[test]
fn an_account_line_and_an_initialize_in_one_write_still_get_an_answer() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_kalsa-mail"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary builds");

    // One write, both messages: this is the shape that used to lose the initialize.
    let mut stdin = child.stdin.take().expect("stdin");
    let both = format!("{}\n{}\n", line(), initialize());
    stdin
        .write_all(both.as_bytes())
        .expect("the write goes through");
    stdin.flush().expect("flush");
    // The pipe stays open so the server is not told the conversation ended.

    let stdout = child.stdout.take().expect("stdout");
    let mut reader = BufReader::new(stdout);
    let mut answer = String::new();
    reader
        .read_line(&mut answer)
        .expect("the server answers on stdout");

    let parsed: serde_json::Value = serde_json::from_str(answer.trim())
        .unwrap_or_else(|e| panic!("the answer is not a JSON-RPC message ({e}): {answer}"));
    assert_eq!(parsed["id"], 1);
    assert!(
        parsed["result"]["serverInfo"]["name"].is_string(),
        "the server introduced itself: {parsed}"
    );

    // Closing the pipe ends the conversation, so the server stops and its stderr
    // reaches end of file. Reading stderr before this would wait for a process that
    // is still waiting for input.
    drop(stdin);
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .expect("stderr")
        .read_to_string(&mut stderr)
        .expect("stderr is readable");
    assert!(
        !stderr.contains(SECRET),
        "the password reached stderr: {stderr}"
    );
    assert!(
        !answer.contains(SECRET),
        "the password reached stdout: {answer}"
    );

    let _ = child.kill();
    let _ = child.wait();
}

/// The line is a byte at a time, so the bytes after the newline are still there for
/// the transport that takes over.
#[test]
fn the_line_is_capped_and_a_missing_one_is_an_error() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_kalsa-mail"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary builds");
    let mut stdin = child.stdin.take().expect("stdin");
    stdin
        .write_all(b"x".repeat(9 * 1024).as_slice())
        .expect("write");
    stdin.flush().expect("flush");
    drop(stdin);
    let output = child.wait_with_output().expect("the binary exits");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("longer than"),
        "a line past the cap is refused, not read: {stderr}"
    );
    assert!(!stderr.contains(SECRET));
}

/// With no line at all the process says so in fixed words and stops.
#[test]
fn an_empty_stdin_is_a_fixed_error() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_kalsa-mail"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary builds");
    drop(child.stdin.take().expect("stdin"));
    let output = child.wait_with_output().expect("the binary exits");
    assert_eq!(
        String::from_utf8_lossy(&output.stderr).trim(),
        "kalsa-mail: no account line arrived on stdin"
    );
}
