//! A strict IMAP fake on a real socket, for the tests that need the wire. It answers
//! LOGIN by the policy it is given, EXAMINE only for the folders it knows, and UID
//! SEARCH and FETCH by the answers policy. Any other command is refused, as a real server
//! refuses it. Every connection is served, and what it saw is counted for the test.
//!
//! It names no crate of this one, so the library's own tests include it as well.

// Each test file uses one policy, so the other ones are unused in that file.
#![allow(dead_code)]

pub mod uid;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use uid::Answers;

#[derive(Clone, Copy)]
pub enum Login {
    Accept,
    Refuse,
}

/// What the fake saw, across every connection it served, and what it is told to do.
pub struct Seen {
    pub logins: AtomicUsize,
    pub searches: AtomicUsize,
    /// The UIDNEXT the folder reports. A test moves it to mean that mail arrived.
    pub uid_next: AtomicU32,
    /// Set by a test: the next command on any connection finds its socket closed.
    pub hang_up: AtomicBool,
    /// Set by a test: the next UID SEARCH or FETCH finds its socket closed, before any answer.
    pub hang_up_on_uid: AtomicBool,
}

impl Default for Seen {
    fn default() -> Seen {
        Seen {
            logins: AtomicUsize::new(0),
            searches: AtomicUsize::new(0),
            uid_next: AtomicU32::new(116),
            hang_up: AtomicBool::new(false),
            hang_up_on_uid: AtomicBool::new(false),
        }
    }
}

/// Starts one fake on a fresh port and returns the account line that reaches it.
pub async fn serve(login: Login, answers: Answers) -> String {
    serve_seen(login, answers).await.0
}

/// As `serve`, and the counts the fake keeps.
pub async fn serve_seen(login: Login, answers: Answers) -> (String, Arc<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("address").port();
    let seen = Arc::new(Seen::default());
    tokio::spawn(accept_each(listener, login, answers, seen.clone()));
    let line = format!(r#"{{"host":"127.0.0.1","port":{port},"user":"lab","password":"lab","tls":false}}"#);
    (line, seen)
}

async fn accept_each(listener: TcpListener, login: Login, answers: Answers, seen: Arc<Seen>) {
    while let Ok((socket, _)) = listener.accept().await {
        tokio::spawn(serve_one(socket, login, answers, seen.clone()));
    }
}

async fn serve_one(socket: TcpStream, login: Login, answers: Answers, seen: Arc<Seen>) {
    let (read, mut write) = socket.into_split();
    let mut lines = BufReader::new(read).lines();
    let _ = write.write_all(b"* OK strict fake ready\r\n").await;
    while let Ok(Some(line)) = lines.next_line().await {
        if seen.hang_up.swap(false, Ordering::SeqCst) {
            break;
        }
        let mut parts = line.splitn(3, ' ');
        let tag = parts.next().unwrap_or_default();
        let verb = parts.next().unwrap_or_default();
        let rest = parts.next().unwrap_or_default();
        let reply = match verb {
            "LOGIN" => {
                seen.logins.fetch_add(1, Ordering::SeqCst);
                match login {
                    Login::Accept => format!("{tag} OK LOGIN completed\r\n").into_bytes(),
                    Login::Refuse => format!("{tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n").into_bytes(),
                }
            }
            "EXAMINE" if matches!(rest, "INBOX" | "\"INBOX\"" | "\"Sent Items\"") => {
                let next = seen.uid_next.load(Ordering::SeqCst);
                format!(
                    "* FLAGS ()\r\n* 2 EXISTS\r\n* 0 RECENT\r\n\
                     * OK [UIDVALIDITY 7] ok\r\n* OK [UIDNEXT {next}] ok\r\n{tag} OK [READ-ONLY] EXAMINE completed\r\n"
                )
                .into_bytes()
            }
            "EXAMINE" => format!("{tag} NO [NONEXISTENT] unknown mailbox\r\n").into_bytes(),
            "CHECK" => format!("{tag} OK CHECK completed\r\n").into_bytes(),
            "UID" => {
                if seen.hang_up_on_uid.swap(false, Ordering::SeqCst) {
                    break;
                }
                if rest.starts_with("SEARCH") {
                    seen.searches.fetch_add(1, Ordering::SeqCst);
                }
                uid::answer(tag, rest, answers)
            }
            "LOGOUT" => {
                let _ = write
                    .write_all(format!("* BYE\r\n{tag} OK LOGOUT completed\r\n").as_bytes())
                    .await;
                break;
            }
            _ => format!("{tag} BAD command not known to the fake\r\n").into_bytes(),
        };
        if write.write_all(&reply).await.is_err() {
            break;
        }
    }
}
