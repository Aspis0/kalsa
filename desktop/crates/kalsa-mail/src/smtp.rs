//! Hands one composed message to the person's submission server. Port 465 is TLS from
//! the first byte and 587 upgrades with STARTTLS. Plaintext reaches only a loopback
//! test server, and only in a debug build.

use std::time::Duration;

use lettre::message::Message;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use zeroize::Zeroizing;

const TIMEOUT: Duration = Duration::from_secs(30);

pub struct Outbound {
    pub host: String,
    pub port: u16,
    pub login: String,
    pub password: Zeroizing<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    ImplicitTls,
    StartTls,
    Plain,
}

/// Fixed categories. The server's reply text never leaves this module.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeliveryError {
    NotConfigured,
    Unreachable,
    Refused,
    Failed,
}

pub fn channel_for(host: &str, port: u16, debug_build: bool) -> Option<Channel> {
    if debug_build && matches!(host, "127.0.0.1" | "localhost") {
        return Some(Channel::Plain);
    }
    match port {
        465 => Some(Channel::ImplicitTls),
        587 => Some(Channel::StartTls),
        _ => None,
    }
}

pub async fn deliver(outbound: &Outbound, message: Message) -> Result<(), DeliveryError> {
    let channel = channel_for(&outbound.host, outbound.port, cfg!(debug_assertions)).ok_or(DeliveryError::NotConfigured)?;
    let transport = transport(outbound, channel)?;
    transport.send(message).await.map(|_| ()).map_err(classify)
}

fn transport(outbound: &Outbound, channel: Channel) -> Result<AsyncSmtpTransport<Tokio1Executor>, DeliveryError> {
    let host = outbound.host.as_str();
    let tls = match channel {
        Channel::ImplicitTls => Tls::Wrapper(parameters(host)?),
        Channel::StartTls => Tls::Required(parameters(host)?),
        Channel::Plain => Tls::None,
    };
    let credentials = Credentials::new(outbound.login.clone(), outbound.password.to_string());
    Ok(AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
        .port(outbound.port)
        .tls(tls)
        .credentials(credentials)
        .timeout(Some(TIMEOUT))
        .build())
}

fn parameters(host: &str) -> Result<TlsParameters, DeliveryError> {
    TlsParameters::new_rustls(host.to_owned()).map_err(|_| DeliveryError::Failed)
}

fn classify(error: lettre::transport::smtp::Error) -> DeliveryError {
    if error.is_permanent() {
        DeliveryError::Refused
    } else if error.is_transient() || error.is_client() {
        DeliveryError::Failed
    } else {
        DeliveryError::Unreachable
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use lettre::message::Mailbox;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    use super::*;

    #[derive(Default)]
    struct Seen {
        envelope: Vec<String>,
        data: String,
    }

    /// Speaks the lines one message needs: EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT.
    /// With `reject_rcpt` the recipient is refused permanently, as a real server would.
    async fn mock_server(reject_rcpt: bool) -> (u16, Arc<Mutex<Seen>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("loopback bind");
        let port = listener.local_addr().expect("address").port();
        let seen = Arc::new(Mutex::new(Seen::default()));
        let record = seen.clone();
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.expect("one connection");
            let (read, mut write) = socket.into_split();
            let mut lines = BufReader::new(read).lines();
            let _ = write.write_all(b"220 mock ready\r\n").await;
            let mut in_data = false;
            while let Ok(Some(line)) = lines.next_line().await {
                if in_data {
                    if line == "." {
                        in_data = false;
                        let _ = write.write_all(b"250 queued\r\n").await;
                    } else {
                        let mut seen = record.lock().unwrap();
                        seen.data.push_str(&line);
                        seen.data.push('\n');
                    }
                    continue;
                }
                let reply: &[u8] = if line.starts_with("EHLO") {
                    b"250-mock\r\n250 AUTH PLAIN\r\n"
                } else if line.starts_with("AUTH") {
                    b"235 accepted\r\n"
                } else if line.starts_with("MAIL FROM") || line.starts_with("RCPT TO") {
                    record.lock().unwrap().envelope.push(line.clone());
                    if reject_rcpt && line.starts_with("RCPT TO") {
                        b"550 no such mailbox\r\n"
                    } else {
                        b"250 ok\r\n"
                    }
                } else if line == "DATA" {
                    in_data = true;
                    b"354 go ahead\r\n"
                } else if line == "QUIT" {
                    let _ = write.write_all(b"221 bye\r\n").await;
                    break;
                } else {
                    b"250 ok\r\n"
                };
                let _ = write.write_all(reply).await;
            }
        });
        (port, seen)
    }

    fn outbound(port: u16) -> Outbound {
        Outbound {
            host: "127.0.0.1".into(),
            port,
            login: "maria@example.it".into(),
            password: Zeroizing::new("fake-password-for-a-test".into()),
        }
    }

    fn reply() -> Message {
        Message::builder()
            .from("Maria <maria@example.it>".parse::<Mailbox>().expect("from"))
            .to("Anna <anna@example.it>".parse::<Mailbox>().expect("to"))
            .subject("Re: Riunione")
            .in_reply_to("<original@example.it>".to_owned())
            .references("<original@example.it>".to_owned())
            .body("Va bene giovedì.".to_owned())
            .expect("message builds")
    }

    #[tokio::test]
    async fn a_reply_reaches_the_submission_server_with_its_threading_headers() {
        let (port, seen) = mock_server(false).await;
        deliver(&outbound(port), reply()).await.expect("delivered");
        let seen = seen.lock().unwrap();
        assert!(seen.envelope.iter().any(|line| line.contains("anna@example.it")), "{:?}", seen.envelope);
        assert!(seen.data.contains("In-Reply-To: <original@example.it>"), "{}", seen.data);
        assert!(seen.data.contains("Subject: Re: Riunione"));
    }

    #[tokio::test]
    async fn a_refused_recipient_is_refused_without_the_server_text() {
        let (port, _) = mock_server(true).await;
        assert_eq!(deliver(&outbound(port), reply()).await, Err(DeliveryError::Refused));
    }

    #[tokio::test]
    async fn a_closed_port_is_unreachable() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
            listener.local_addr().expect("address").port()
        };
        assert_eq!(deliver(&outbound(port), reply()).await, Err(DeliveryError::Unreachable));
    }

    #[test]
    fn the_channel_follows_the_port_and_plaintext_is_debug_and_loopback_only() {
        assert_eq!(channel_for("smtp.gmail.com", 465, false), Some(Channel::ImplicitTls));
        assert_eq!(channel_for("smtp.gmail.com", 587, false), Some(Channel::StartTls));
        assert_eq!(channel_for("smtp.gmail.com", 25, true), None, "no other port is spoken");
        assert_eq!(channel_for("127.0.0.1", 40000, true), Some(Channel::Plain));
        assert_eq!(channel_for("127.0.0.1", 40000, false), None, "a release build has no plaintext");
        assert_eq!(channel_for("127.0.0.1", 465, false), Some(Channel::ImplicitTls));
    }
}
