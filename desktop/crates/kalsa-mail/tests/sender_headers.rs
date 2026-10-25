//! What the sender history asks a server for. It reads From and Date out of each mail's
//! header block, so a mail with megabytes of trace headers must not be sent whole.

mod fake_imap;

use fake_imap::uid::Answers;
use fake_imap::{Login, Seen};
use kalsa_mail::account;
use kalsa_mail::imap;
use kalsa_mail::mail;
use kalsa_mail::mailbox::{Mailbox, HEADER_LIMIT};
use std::sync::Arc;

async fn open(answers: Answers) -> (Mailbox, Arc<Seen>) {
    let (line, seen) = fake_imap::serve_seen(Login::Accept, answers).await;
    let account = account::read(line.as_bytes()).expect("the test line is well formed");
    let session = imap::connect(&account).await.expect("the fake accepts LOGIN");
    let mailbox = Mailbox::examine(session, "INBOX").await.expect("INBOX opens");
    (mailbox, seen)
}

#[tokio::test]
async fn a_multi_megabyte_header_block_is_never_asked_for_whole() {
    let (mut mailbox, seen) = open(Answers::BigHeader).await;
    let headers = mailbox.headers(&[105]).await.expect("sender history");

    let asked = seen.fetches.lock().expect("the fake's record").clone();
    assert_eq!(
        asked,
        vec!["FETCH 105 BODY.PEEK[HEADER.FIELDS (FROM DATE)]<0.2048>".to_string()],
        "{asked:?}"
    );

    let (uid, header) = &headers[0];
    assert_eq!(*uid, 105);
    assert!(header.len() <= HEADER_LIMIT, "{} bytes came back", header.len());
    let (address, date) = mail::sender_of(header);
    assert_eq!(address, "giulia.serra@serraconsulting.example.it");
    let expected = chrono::DateTime::parse_from_rfc2822("Thu, 15 Oct 2026 10:00:00 +0000")
        .expect("the test date is valid")
        .timestamp_millis();
    assert_eq!(date, expected);
}

#[tokio::test]
async fn a_server_that_omits_date_gives_the_empty_date() {
    let (mut mailbox, _) = open(Answers::Exact).await;
    let headers = mailbox.headers(&[105]).await.expect("sender history");
    let (address, date) = mail::sender_of(&headers[0].1);
    assert_eq!(address, "giulia.serra@serraconsulting.example.it");
    assert_eq!(date, 0);
}

#[tokio::test]
async fn a_from_the_limit_cuts_is_not_read_as_a_sender() {
    let (mut mailbox, _) = open(Answers::CutInFrom).await;
    let headers = mailbox.headers(&[105]).await.expect("sender history");
    let (uid, header) = &headers[0];
    assert_eq!(*uid, 105);
    let (address, _) = mail::sender_of(header);
    assert_eq!(address, "", "a cut From is not a sender: {address}");
    assert!(header.ends_with(b"\r\n"), "the block ends on a whole line");
}

#[tokio::test]
async fn a_server_that_ignores_the_field_list_and_sends_a_trace_first_gives_no_block() {
    let (mut mailbox, _) = open(Answers::TraceFirst).await;
    let headers = mailbox.headers(&[105]).await.expect("sender history");
    let (_, header) = &headers[0];
    assert!(header.is_empty(), "the cut falls in the first line, so no whole line is left");
    let (address, date) = mail::sender_of(header);
    assert_eq!((address.as_str(), date), ("", 0));
}
