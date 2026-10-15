//! What `EXAMINE` puts on the wire for a folder name. The fake refuses a name quoted
//! twice, as Gmail does, so a folder name that is quoted again is caught here.

mod fake_imap;

use fake_imap::fetch::Answers;
use fake_imap::Login;
use kalsa_mail::imap::{self, MailError};
use kalsa_mail::mailbox::Mailbox;

/// Logs in to a fresh fake and examines `folder`.
async fn examine(folder: &str) -> Result<Mailbox, MailError> {
    let account = fake_imap::serve(Login::Accept, Answers::Exact).await;
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
