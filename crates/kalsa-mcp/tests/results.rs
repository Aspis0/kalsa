mod common;

use common::{FakeLauncher, TempBinary, args, record, seed, state, tool};
use kalsa_mcp::host::Host;
use kalsa_mcp::outcome::CallOutcome;
use kalsa_mcp::pins::Pins;
use kalsa_mcp::record::Trust;
use kalsa_mcp::registry::Registry;
use serde_json::json;

#[tokio::test]
async fn the_model_gets_text_and_the_ui_gets_structured_content() {
    let binary = TempBinary::new("results-split", b"mail server v1");
    let read = tool("read", "Reads a mail");
    let mail = state(vec![read.clone()], &[("read", "Mail from Anna: lunch on Monday?")]);
    mail.lock().unwrap().structured.insert("read".to_owned(), json!({"body": "SECRET BODY", "to": "x@example.test"}));
    let registry = Registry::new(vec![record("mail", binary.path(), Trust::FirstParty)]).expect("registry");
    let mut pins = Pins::default();
    seed(&mut pins, "mail", &binary.path(), &[read]);
    let mut host = Host::new(registry, FakeLauncher::new(vec![("mail", mail)]), pins);

    let result = match host.call("conv", "mail.read", args(json!({"id": "1"}))).await {
        Ok(CallOutcome::Ran(result)) => result,
        _ => panic!("read is allowed"),
    };
    let for_model = result.for_model.concat();
    assert_eq!(for_model, "Mail from Anna: lunch on Monday?");
    assert!(!for_model.contains("SECRET BODY"));
    assert_eq!(result.for_ui, Some(json!({"body": "SECRET BODY", "to": "x@example.test"})));
}
