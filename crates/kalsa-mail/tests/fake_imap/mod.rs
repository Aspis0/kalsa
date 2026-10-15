//! A strict IMAP fake on a real socket, for the tests that need the wire. It answers
//! LOGIN by the policy it is given, and EXAMINE only for the folders it knows: any other
//! name is refused, as a real server refuses it.

// Each test file uses one policy, so the other one is unused in that file.
#![allow(dead_code)]

use kalsa_mail::account::{self, Account};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

#[derive(Clone, Copy)]
pub enum Login {
    Accept,
    Refuse,
}

/// Starts one fake on a fresh port and returns the account that reaches it.
pub async fn serve(login: Login) -> Account {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("address").port();
    tokio::spawn(serve_one(listener, login));
    let line = format!(
        r#"{{"host":"127.0.0.1","port":{port},"user":"lab","password":"lab","tls":false}}"#
    );
    account::read(line.as_bytes()).expect("the test line is well formed")
}

async fn serve_one(listener: TcpListener, login: Login) {
    let Ok((socket, _)) = listener.accept().await else {
        return;
    };
    let (read, mut write) = socket.into_split();
    let mut lines = BufReader::new(read).lines();
    let _ = write.write_all(b"* OK strict fake ready\r\n").await;
    while let Ok(Some(line)) = lines.next_line().await {
        let mut parts = line.splitn(3, ' ');
        let tag = parts.next().unwrap_or_default();
        let verb = parts.next().unwrap_or_default();
        let folder = parts.next().unwrap_or_default();
        let reply = match verb {
            "LOGIN" => match login {
                Login::Accept => format!("{tag} OK LOGIN completed\r\n"),
                Login::Refuse => format!("{tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n"),
            },
            "EXAMINE" if matches!(folder, "INBOX" | "\"INBOX\"" | "\"Sent Items\"") => format!(
                "* FLAGS ()\r\n* 0 EXISTS\r\n* 0 RECENT\r\n\
                 * OK [UIDVALIDITY 7] ok\r\n{tag} OK [READ-ONLY] EXAMINE completed\r\n"
            ),
            "EXAMINE" => format!("{tag} NO [NONEXISTENT] unknown mailbox\r\n"),
            "LOGOUT" => {
                let _ = write
                    .write_all(format!("* BYE\r\n{tag} OK LOGOUT completed\r\n").as_bytes())
                    .await;
                break;
            }
            _ => format!("{tag} BAD command not known to the fake\r\n"),
        };
        if write.write_all(reply.as_bytes()).await.is_err() {
            break;
        }
    }
}
