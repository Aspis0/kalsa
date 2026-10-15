//! The IMAP session this process keeps between tool calls.
//!
//! A call used to connect, log in and log out: a TLS handshake and a LOGIN on every tool
//! call. The session is kept instead. Each call still EXAMINEs its folder, so the
//! UIDVALIDITY it checks is read fresh. A session idle past `IDLE_LIMIT` is not reused,
//! and a call that fails drops it.

use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_imap::Session;

use crate::account::Account;
use crate::imap::{self, MailError, Transport};
use crate::mailbox::{check_session, Mailbox};

/// A gap between two of a person's tool calls is seconds to minutes. A longer hold keeps
/// a login open that nothing uses; a shorter one pays a handshake on calls that were close.
const IDLE_LIMIT: Duration = Duration::from_secs(120);

pub struct KeptSession {
    account: Arc<Account>,
    kept: Option<Kept>,
}

struct Kept {
    session: Session<Transport>,
    idle_since: Instant,
}

impl KeptSession {
    pub fn new(account: Arc<Account>) -> KeptSession {
        KeptSession { account, kept: None }
    }

    /// Runs `body` on the folder and keeps the session its answer came back on. An error
    /// keeps nothing, because the state of a socket after an error is unknown. A dead
    /// connection is retried once on a new session, so `body` may run twice and must only read.
    pub async fn call<T, F, Fut>(&mut self, folder: &str, mut body: F) -> Result<T, MailError>
    where
        F: FnMut(Mailbox) -> Fut,
        Fut: Future<Output = Result<(T, Mailbox), MailError>>,
    {
        let kept = self.kept.take().filter(|kept| kept.idle_since.elapsed() < IDLE_LIMIT);
        if let Some(kept) = kept {
            let outcome = match alive(kept.session).await {
                Ok(session) => run(session, folder, &mut body).await,
                Err(error) => Err(error),
            };
            match outcome {
                Err(MailError::Connect) => {}
                outcome => return self.settle(outcome),
            }
        }
        let session = imap::connect(&self.account).await?;
        let outcome = run(session, folder, &mut body).await;
        self.settle(outcome)
    }

    fn settle<T>(&mut self, outcome: Result<(T, Session<Transport>), MailError>) -> Result<T, MailError> {
        outcome.map(|(answer, session)| {
            self.kept = Some(Kept { session, idle_since: Instant::now() });
            answer
        })
    }
}

/// Before the folder is examined: a closed socket would answer EXAMINE with no UIDVALIDITY.
async fn alive(mut session: Session<Transport>) -> Result<Session<Transport>, MailError> {
    check_session(&mut session).await?;
    Ok(session)
}

async fn run<T, F, Fut>(
    session: Session<Transport>,
    folder: &str,
    body: &mut F,
) -> Result<(T, Session<Transport>), MailError>
where
    F: FnMut(Mailbox) -> Fut,
    Fut: Future<Output = Result<(T, Mailbox), MailError>>,
{
    let mailbox = Mailbox::examine(session, folder).await?;
    let (answer, mailbox) = body(mailbox).await?;
    Ok((answer, mailbox.into_session()))
}

#[cfg(test)]
#[path = "../tests/fake_imap/mod.rs"]
mod fake_imap;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::listed::Listed;
    use crate::mcp;
    use crate::senders::Senders;
    use fake_imap::uid::Answers;
    use fake_imap::Login;
    use std::sync::atomic::Ordering;
    use tokio::sync::Mutex;

    struct Rig {
        seen: Arc<fake_imap::Seen>,
        account: Arc<Account>,
        kept: Arc<Mutex<KeptSession>>,
        cache: Arc<Mutex<Senders>>,
        listed: Arc<Mutex<Listed>>,
    }

    async fn rig() -> Rig {
        let (line, seen) = fake_imap::serve_seen(Login::Accept, Answers::Exact).await;
        let account = Arc::new(crate::account::read(line.as_bytes()).expect("the test line is well formed"));
        let listed = Arc::new(Mutex::new(Listed::default()));
        listed.lock().await.remember("INBOX", Some(7), &[105]);
        Rig {
            seen,
            kept: Arc::new(Mutex::new(KeptSession::new(account.clone()))),
            account,
            cache: Arc::new(Mutex::new(Senders::default())),
            listed,
        }
    }

    async fn read_105(rig: &Rig) -> Result<(), MailError> {
        mcp::one(&rig.account, &rig.cache, &rig.listed, &rig.kept, "INBOX", 105)
            .await
            .map(|_| ())
    }

    #[tokio::test]
    async fn two_reads_share_one_login() {
        let rig = rig().await;
        read_105(&rig).await.expect("the first read");
        read_105(&rig).await.expect("the second read");
        assert_eq!(rig.seen.logins.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_dropped_connection_reconnects_once_and_the_read_still_answers() {
        let rig = rig().await;
        read_105(&rig).await.expect("the first read");
        rig.seen.hang_up.store(true, Ordering::SeqCst);
        read_105(&rig).await.expect("the read after the drop");
        assert_eq!(rig.seen.logins.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_second_read_does_not_list_the_folder_again() {
        let rig = rig().await;
        read_105(&rig).await.expect("the first read");
        read_105(&rig).await.expect("the second read");
        assert_eq!(rig.seen.searches.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_read_after_uidnext_moved_lists_the_folder_again() {
        let rig = rig().await;
        read_105(&rig).await.expect("the first read");
        rig.seen.uid_next.store(117, Ordering::SeqCst);
        read_105(&rig).await.expect("the second read");
        assert_eq!(rig.seen.searches.load(Ordering::SeqCst), 2);
    }
}
