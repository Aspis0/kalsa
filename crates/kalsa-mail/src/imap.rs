//! Reaching a mail server: the socket, the TLS session, the login, and the fixed
//! strings this process is allowed to fail with.

use crate::account::Account;
use async_imap::{Client, Session};
use std::fmt;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

/// A server that accepts the connection and then says nothing must not hold the tool
/// call open. The person is waiting on a chat bubble, not on a mailbox.
pub const CONNECT_DEADLINE: Duration = Duration::from_secs(20);
pub const READ_DEADLINE: Duration = Duration::from_secs(60);

/// Every failure is a fixed string. A mail server puts whatever it likes in a reply,
/// including the login it has just seen, so no reply text is ever formatted.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MailError {
    Connect,
    Tls,
    Login,
    Mailbox,
    Command,
    Protocol,
    Stale,
    Timeout,
}

impl MailError {
    pub fn message(self) -> &'static str {
        match self {
            MailError::Connect => "the mail server could not be reached",
            MailError::Tls => "the secure connection to the mail server failed",
            MailError::Login => "the mail server refused the credentials",
            MailError::Mailbox => "that folder could not be opened",
            MailError::Command => "the mail server did not answer as expected",
            MailError::Protocol => "the mail server sent something unreadable",
            MailError::Stale => "that folder changed, the list has to be taken again",
            MailError::Timeout => "the mail server did not answer in time",
        }
    }
}

impl fmt::Display for MailError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for MailError {}

/// Plain or TLS, because a fixture server on this machine speaks no TLS. Both arms
/// are a TCP stream at heart; the difference never leaves this file.
pub enum Transport {
    Secure(Box<tokio_rustls::client::TlsStream<TcpStream>>),
    Plain(TcpStream),
}

impl fmt::Debug for Transport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("imap transport")
    }
}

impl AsyncRead for Transport {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Transport::Plain(stream) => Pin::new(stream).poll_read(cx, buf),
            Transport::Secure(stream) => Pin::new(stream).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for Transport {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            Transport::Plain(stream) => Pin::new(stream).poll_write(cx, buf),
            Transport::Secure(stream) => Pin::new(stream).poll_write(cx, buf),
        }
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Transport::Plain(stream) => Pin::new(stream).poll_flush(cx),
            Transport::Secure(stream) => Pin::new(stream).poll_flush(cx),
        }
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Transport::Plain(stream) => Pin::new(stream).poll_shutdown(cx),
            Transport::Secure(stream) => Pin::new(stream).poll_shutdown(cx),
        }
    }
}

/// The plain arm is only ever built for a host on this machine, decided by the
/// `Account` constructor. This is the second place that holds, on purpose.
pub async fn connect(account: &Account) -> Result<Session<Transport>, MailError> {
    let stream = timeout(
        CONNECT_DEADLINE,
        TcpStream::connect((account.host(), account.port())),
    )
    .await
    .map_err(|_| MailError::Timeout)?
    .map_err(|_| MailError::Connect)?;

    let transport = if account.tls() {
        let name = rustls::pki_types::ServerName::try_from(account.host().to_string())
            .map_err(|_| MailError::Tls)?;
        let handshake = timeout(CONNECT_DEADLINE, tls_connector()?.connect(name, stream))
            .await
            .map_err(|_| MailError::Timeout)?
            .map_err(|_| MailError::Tls)?;
        Transport::Secure(Box::new(handshake))
    } else {
        Transport::Plain(stream)
    };

    let login = timeout(
        CONNECT_DEADLINE,
        Client::new(transport).login(account.user(), account.password()),
    )
    .await
    .map_err(|_| MailError::Timeout)?;
    login.map_err(|_| MailError::Login)
}

/// The platform verifier is the one that reads the trust store the operating system
/// already has, which is where a mail provider's roots live on every desktop. If it
/// cannot be built the connection fails: an unverified session is never the answer.
fn tls_connector() -> Result<tokio_rustls::TlsConnector, MailError> {
    use rustls_platform_verifier::BuilderVerifierExt;

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|_| MailError::Tls)?
        .with_platform_verifier()
        .map_err(|_| MailError::Tls)?
        .with_no_client_auth();
    Ok(tokio_rustls::TlsConnector::from(Arc::new(config)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_are_fixed_strings_with_nothing_from_the_server() {
        for error in [
            MailError::Connect,
            MailError::Tls,
            MailError::Login,
            MailError::Mailbox,
            MailError::Command,
            MailError::Protocol,
            MailError::Stale,
            MailError::Timeout,
        ] {
            assert_eq!(error.to_string(), error.message());
            assert!(!error.message().contains("BAD"));
        }
    }

    #[test]
    fn the_deadlines_are_the_ones_the_plan_asks_for() {
        assert_eq!(CONNECT_DEADLINE, Duration::from_secs(20));
        assert_eq!(READ_DEADLINE, Duration::from_secs(60));
    }
}
