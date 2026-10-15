//! What `sources` returns for a set of UIDs. A server may answer a set with messages
//! that were not in it; only the asked-for ones come back, each with its own bytes.

mod fake_imap;

use fake_imap::uid::Answers;
use fake_imap::Login;
use kalsa_mail::account;
use kalsa_mail::imap;
use kalsa_mail::mailbox::{Mailbox, Source};

async fn open(answers: Answers) -> Mailbox {
    let line = fake_imap::serve(Login::Accept, answers).await;
    let account = account::read(line.as_bytes()).expect("the test line is well formed");
    let session = imap::connect(&account).await.expect("the fake accepts LOGIN");
    Mailbox::examine(session, "INBOX").await.expect("INBOX opens")
}

fn uids(sources: &[Source]) -> Vec<u32> {
    sources.iter().map(|source| source.uid).collect()
}

#[tokio::test]
async fn a_server_that_answers_wider_gives_back_only_the_mail_asked_for() {
    let mut mailbox = open(Answers::Wider).await;
    let sources = mailbox.sources(&[105]).await.expect("fetch");
    assert_eq!(uids(&sources), vec![105]);
    let text = String::from_utf8_lossy(&sources[0].bytes).into_owned();
    assert!(text.contains("giulia.serra"), "the bytes belong to the mail named: {text}");
}

#[tokio::test]
async fn a_server_that_answers_only_another_uid_gives_back_nothing() {
    let mut mailbox = open(Answers::Other).await;
    let sources = mailbox.sources(&[105]).await.expect("fetch");
    assert!(sources.is_empty(), "{:?}", uids(&sources));
}

#[tokio::test]
async fn an_exact_answer_comes_back_newest_first() {
    let mut mailbox = open(Answers::Exact).await;
    let sources = mailbox.sources(&[105, 115]).await.expect("fetch");
    assert_eq!(uids(&sources), vec![115, 105]);
}
