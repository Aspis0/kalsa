mod common;

use common::fixture::{fixture_host, fixture_record};
use common::{FakeLauncher, TempBinary, args, record, seed, server_id, state, tool};
use kalsa_mcp::error::Error;
use kalsa_mcp::host::Host;
use kalsa_mcp::pins::Pins;
use kalsa_mcp::record::Trust;
use kalsa_mcp::registry::Registry;
use serde_json::json;

// The clock is paused: the 15 s and 60 s deadlines fire as soon as the runtime is idle.

#[tokio::test(start_paused = true)]
async fn a_child_that_never_answers_the_handshake_is_gone() {
    let mut host = fixture_host(fixture_record("boot-line-silent", &["silent"]));
    assert!(matches!(host.list(&server_id("fixture")).await, Err(Error::ServerGone(_))));
}

#[tokio::test(start_paused = true)]
async fn a_list_that_never_returns_is_gone() {
    let binary = TempBinary::new("deadline-list", b"mail server v1");
    let tools = state(vec![tool("list", "Lists mail")], &[]);
    tools.lock().unwrap().hang_list = true;
    let mut pins = Pins::default();
    seed(&mut pins, "mail", &binary.path(), &[]);
    let registry = Registry::new(vec![record("mail", binary.path(), Trust::FirstParty)]).expect("registry");
    let mut host = Host::new(registry, FakeLauncher::new(vec![("mail", tools)]), pins);

    assert!(matches!(host.list(&server_id("mail")).await, Err(Error::ServerGone(_))));
}

#[tokio::test(start_paused = true)]
async fn a_call_that_never_returns_is_gone() {
    let binary = TempBinary::new("deadline-call", b"mail server v1");
    let tools = state(vec![tool("list", "Lists mail")], &[]);
    let mut pins = Pins::default();
    seed(&mut pins, "mail", &binary.path(), &[tool("list", "Lists mail")]);
    let registry = Registry::new(vec![record("mail", binary.path(), Trust::FirstParty)]).expect("registry");
    let mut host = Host::new(registry, FakeLauncher::new(vec![("mail", tools.clone())]), pins);
    tools.lock().unwrap().hang_calls = true;

    assert!(matches!(
        host.call("conv", "mail.list", args(json!({}))).await,
        Err(Error::ServerGone(_))
    ));
}
