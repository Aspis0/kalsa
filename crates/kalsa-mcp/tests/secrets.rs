mod common;

use std::panic::{AssertUnwindSafe, catch_unwind};

use common::{record, server_id};
use kalsa_mcp::error::Error;
use kalsa_mcp::launch::{Launch, StdioLauncher};
use kalsa_mcp::name::NamespacedName;
use kalsa_mcp::permission::DenyReason;
use kalsa_mcp::record::{ServerRecord, Trust};
use kalsa_mcp::secret::BootstrapSecret;

const SECRET: &str = "tok-SECRET-0123456789";

fn missing_program_record() -> ServerRecord {
    let missing = std::env::temp_dir().join("kalsa-mcp-no-such-program");
    record("mail", missing, Trust::FirstParty)
        .with_bootstrap(BootstrapSecret::new(SECRET.to_owned()).expect("secret is one line"))
        .expect("first-party record takes a bootstrap")
}

#[tokio::test]
async fn the_secret_is_absent_from_debug_errors_and_panics() {
    let mut rec = missing_program_record();
    assert!(format!("{rec:?}").contains("set"));
    assert!(!format!("{rec:?}").contains(SECRET));

    let error = match StdioLauncher.launch(&mut rec, "not-the-approved-digest").await {
        Err(error) => error,
        Ok(_) => panic!("a missing program must not start"),
    };
    assert!(!format!("{error}").contains(SECRET));
    assert!(!format!("{error:?}").contains(SECRET));

    let panic_payload = catch_unwind(AssertUnwindSafe(|| panic!("launch state: {rec:?}")))
        .expect_err("the closure panics");
    let message = panic_payload
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic_payload.downcast_ref::<&str>().copied())
        .unwrap_or_default();
    assert!(message.contains("launch state"));
    assert!(!message.contains(SECRET));
}

#[test]
fn every_error_variant_is_free_of_the_secret() {
    let mail = server_id("mail");
    let name = NamespacedName::parse("mail.list").expect("name parses");
    let every = vec![
        Error::InvalidServerId,
        Error::InvalidSecret,
        Error::RelativeCommand(mail.clone()),
        Error::DuplicateServer(mail.clone()),
        Error::NoNamespace,
        Error::UnknownServer,
        Error::UnknownTool(name.clone()),
        Error::DuplicateTool(name.clone()),
        Error::InvalidToolName(mail.clone()),
        Error::Denied(name, DenyReason::NotPinned),
        Error::BinaryUnreadable(mail.clone()),
        Error::BinaryChanged(mail.clone()),
        Error::NotPinned(mail.clone()),
        Error::ThirdPartyNeedsSandbox(mail.clone()),
        Error::BootstrapNeedsFirstParty(mail.clone()),
        Error::Launch(mail.clone()),
        Error::ServerGone(mail.clone()),
        Error::Protocol(mail.clone()),
        Error::Unsupported(mail.clone()),
        Error::TooManyPages(mail),
    ];
    for error in every {
        assert!(!format!("{error}").contains(SECRET), "Display leaks: {error:?}");
        assert!(!format!("{error:?}").contains(SECRET), "Debug leaks: {error:?}");
    }
}

#[test]
fn a_secret_that_is_empty_or_spans_lines_is_refused_without_echoing_it() {
    let multi_line = BootstrapSecret::new(format!("first-{SECRET}\nsecond"));
    assert!(matches!(multi_line, Err(Error::InvalidSecret)));
    assert!(matches!(BootstrapSecret::new(String::new()), Err(Error::InvalidSecret)));
    assert!(!Error::InvalidSecret.to_string().contains(SECRET));
}

#[test]
fn a_third_party_record_refuses_a_bootstrap_secret() {
    let third_party = record("vendor", std::env::temp_dir(), Trust::ThirdParty);
    let secret = BootstrapSecret::new(SECRET.to_owned()).expect("secret is one line");
    let refused = match third_party.with_bootstrap(secret) {
        Err(error) => error,
        Ok(_) => panic!("a third-party record must not take a bootstrap"),
    };
    assert!(matches!(refused, Error::BootstrapNeedsFirstParty(_)));
    assert!(!refused.to_string().contains(SECRET));
}
