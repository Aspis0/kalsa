//! A server that refuses the password is reported as a refused login, the one failure
//! the host can name for the person. The code it becomes is tested in `view`.

mod fake_imap;

use fake_imap::fetch::Answers;
use fake_imap::Login;
use kalsa_mail::imap::{self, MailError};

#[tokio::test]
async fn a_refused_login_is_reported_as_a_refused_login() {
    let account = fake_imap::serve(Login::Refuse, Answers::Exact).await;
    let refused = imap::connect(&account).await;
    assert!(matches!(refused, Err(MailError::Login)));
}
