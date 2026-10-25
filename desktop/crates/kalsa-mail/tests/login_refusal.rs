//! A server that refuses the password is reported as a refused login, the one failure
//! the host can name for the person. The code it becomes is tested in `view`.

mod fake_imap;

use fake_imap::uid::Answers;
use fake_imap::Login;
use kalsa_mail::account;
use kalsa_mail::imap::{self, MailError};

#[tokio::test]
async fn a_refused_login_is_reported_as_a_refused_login() {
    let line = fake_imap::serve(Login::Refuse, Answers::Exact).await;
    let account = account::read(line.as_bytes()).expect("the test line is well formed");
    let refused = imap::connect(&account).await;
    assert!(matches!(refused, Err(MailError::Login)));
}
