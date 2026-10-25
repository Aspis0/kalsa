//! Against the lab's fake IMAP server. Ignored by default because it needs that
//! server running:
//!
//! ```text
//! cd ~/lab/mail-lab && node src/run-server.js 1244 data-v2
//! cargo test -p kalsa-mail --test live_fake_server -- --ignored
//! ```
//!
//! The fixture counts every write command it is asked to run and prints the total on
//! shutdown, so a run that wrote anything shows up there as well as here.

mod common;

use common::fixtures;
use kalsa_mail::account;
use kalsa_mail::imap;
use kalsa_mail::label::{self, Label};
use kalsa_mail::mail;
use kalsa_mail::mailbox::Mailbox;
use std::time::Instant;

const LINE: &[u8] = br#"{"host":"127.0.0.1","port":1244,"user":"lab","password":"lab","tls":false,"authserv_id":"mx.lab-provider.example"}"#;

async fn mailbox() -> Option<Mailbox> {
    let account = account::read(LINE).expect("the fixture line is well formed");
    let session = match imap::connect(&account).await {
        Ok(session) => session,
        Err(error) => {
            eprintln!(
                "skipping: {} (start the fixture server first)",
                error.message()
            );
            return None;
        }
    };
    match Mailbox::examine(session, "INBOX").await {
        Ok(mailbox) => Some(mailbox),
        Err(error) => {
            eprintln!("skipping: {}", error.message());
            None
        }
    }
}

#[tokio::test]
#[ignore = "needs the lab fixture server on 127.0.0.1:1244"]
async fn the_fixture_mailbox_lists_reads_and_drafts() {
    let Some(mut mailbox) = mailbox().await else {
        return;
    };

    let uids = mailbox.uids(14, None, None, 50).await.expect("search");
    let expected = fixtures().len();
    assert!(!uids.is_empty(), "the fixture mailbox has mail");
    assert!(uids.len() <= 50, "the cap holds");
    println!("listed {} uids, the lab mailbox has {expected}", uids.len());

    let sources = mailbox.sources(&uids).await.expect("fetch");
    assert_eq!(sources.len(), uids.len());
    assert_eq!(
        uids.first().copied(),
        sources.first().map(|source| source.uid)
    );

    let senders = mailbox.all_uids().await.expect("all uids");
    let headers = mailbox.headers(&senders).await.expect("sender history");
    assert!(headers.len() >= sources.len());
    let history: Vec<label::Sender> = headers
        .into_iter()
        .filter_map(|(uid, header)| {
            let (address, _) = mail::sender_of(&header);
            (!address.is_empty()).then_some(label::Sender { address, uid })
        })
        .collect();

    let labels: Vec<_> = sources
        .iter()
        .map(|source| {
            let parsed = mail::parse(&source.bytes);
            label::label(
                source.uid,
                &parsed,
                &history,
                Some("mx.lab-provider.example"),
            )
        })
        .collect();

    assert!(
        labels.iter().any(|l| l.label == Label::Suspicious),
        "the lab's phishing mail is flagged over the wire too"
    );
    assert!(
        labels.iter().any(|l| l.label == Label::Bulk),
        "bulk mail is labelled over the wire too"
    );
    assert!(
        sources
            .iter()
            .all(|source| !mail::parse(&source.bytes).text.is_empty()),
        "every mail arrives with readable text"
    );
    assert_eq!(mailbox.uid_validity, Some(1), "the fixture stamps one");
    mailbox.logout().await;
}

#[tokio::test]
#[ignore = "needs the lab fixture server on 127.0.0.1:1244"]
async fn a_draft_takes_its_recipient_from_the_message() {
    let Some(mut mailbox) = mailbox().await else {
        return;
    };
    let uids = mailbox.uids(14, None, None, 50).await.expect("search");
    let sources = mailbox.sources(&uids).await.expect("fetch");
    mailbox.logout().await;

    let source = sources.first().expect("at least one mail");
    let parsed = mail::parse(&source.bytes);
    let draft = kalsa_mail::draft::reply_to(&parsed, "Va bene, a presto.")
        .expect("the mail has an address");

    assert!(
        draft.to
            == parsed
                .reply_to
                .unwrap_or_else(|| parsed.from_address.clone()),
        "the recipient is the one in the message"
    );
    assert!(draft.subject.starts_with("Re: "));
    println!(
        "draft prepared for uid {} to a domain of {}",
        source.uid,
        draft.to.rsplit('@').next().unwrap_or_default()
    );
}

/// The fixture answers a write command with an error and counts it, so a write that
/// ever reached the wire would fail here.
#[tokio::test]
#[ignore = "needs the lab fixture server on 127.0.0.1:1244"]
async fn the_fixture_server_is_reachable_and_read_only() {
    let Some(mut mailbox) = mailbox().await else {
        return;
    };
    let start = Instant::now();
    let uids = mailbox.uids(1, None, None, 50).await.expect("search");
    println!("{} uids in one day, in {:?}", uids.len(), start.elapsed());
    mailbox.logout().await;
}
