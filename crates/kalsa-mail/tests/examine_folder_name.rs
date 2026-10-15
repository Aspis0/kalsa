//! What `EXAMINE` puts on the wire for a folder name. The fake server here is strict
//! on purpose: it takes a folder bare or in one pair of quotes, as RFC 3501 does, and
//! refuses a name quoted twice. Gmail refuses that form too.

use kalsa_mail::account;
use kalsa_mail::imap::{self, MailError};
use kalsa_mail::mailbox::Mailbox;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

/// Serves one client: accepts any LOGIN, opens the folders it knows, and refuses
/// every other EXAMINE argument, including the doubly quoted `"\"INBOX\""`.
async fn serve_one(listener: TcpListener) {
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
            "LOGIN" => format!("{tag} OK LOGIN completed\r\n"),
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

/// Connects to a fresh fake, logs in and examines `folder`.
async fn examine(folder: &str) -> Result<Mailbox, MailError> {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("address").port();
    tokio::spawn(serve_one(listener));
    let line = format!(
        r#"{{"host":"127.0.0.1","port":{port},"user":"lab","password":"lab","tls":false}}"#
    );
    let account = account::read(line.as_bytes()).expect("the test line is well formed");
    let session = imap::connect(&account).await.expect("the fake accepts LOGIN");
    Mailbox::examine(session, folder).await
}

#[tokio::test]
async fn examine_opens_inbox_and_reports_its_validity() {
    let mailbox = examine("INBOX").await.expect("INBOX opens");
    assert_eq!(mailbox.uid_validity, Some(7));
}

#[tokio::test]
async fn examine_opens_a_folder_with_a_space_in_its_name() {
    examine("Sent Items").await.expect("Sent Items opens");
}

#[tokio::test]
async fn examine_refuses_a_folder_name_with_a_line_break() {
    let refused = examine("INBOX\r\nA1 LOGOUT").await;
    assert!(matches!(refused, Err(MailError::Mailbox)));
}
