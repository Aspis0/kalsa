mod common;

use common::args;
use common::fixture::{fixture_host, fixture_record, fixture_sha256, sealed_host};
use common::server_id;
use kalsa_mcp::error::Error;
use kalsa_mcp::host::Host;
use kalsa_mcp::launch::{Launch, SealedStdioLauncher, StdioLauncher};
use kalsa_mcp::outcome::{CallOutcome, ToolResult};
use kalsa_mcp::permission::DenyReason;
use serde_json::json;

fn text(result: &ToolResult) -> String {
    result.for_model.concat()
}

#[tokio::test]
async fn the_bootstrap_line_arrives_first_and_the_tools_run_in_a_real_child() {
    let secret = "boot-line-from-the-keychain";
    let mut host = fixture_host(fixture_record(secret, &[]));

    let listing = host.list(&server_id("fixture")).await.expect("list");
    let names: Vec<String> = listing.tools.iter().map(|listed| listed.name.to_string()).collect();
    assert_eq!(names, vec!["fixture.echo", "fixture.bootstrap_len", "fixture.env"]);

    assert!(matches!(
        host.call("conv", "fixture.bootstrap_len", args(json!({}))).await,
        Err(Error::Denied(_, DenyReason::NotPinned))
    ));
    host.always_allow("conv", "fixture.bootstrap_len").await.expect("approve");
    let result = match host.call("conv", "fixture.bootstrap_len", args(json!({}))).await {
        Ok(CallOutcome::Ran(result)) => result,
        _ => panic!("approved tool runs"),
    };
    assert_eq!(text(&result), secret.len().to_string());
    assert_eq!(result.server.to_string(), "fixture");

    host.always_allow("conv", "fixture.echo").await.expect("approve");
    let result = match host.call("conv", "fixture.echo", args(json!({"text": "hello"}))).await {
        Ok(CallOutcome::Ran(result)) => result,
        _ => panic!("approved tool runs"),
    };
    assert_eq!(text(&result), "hello");
}

#[tokio::test]
async fn the_secret_is_not_written_to_a_program_that_fails_the_check() {
    let mut rec = fixture_record("boot-line-checked", &[]);
    let wrong = StdioLauncher.launch(&mut rec, "not-the-approved-digest").await;
    assert!(matches!(wrong, Err(Error::BinaryChanged(_))));

    let right = StdioLauncher.launch(&mut rec, &fixture_sha256()).await;
    assert!(right.is_ok(), "the secret was kept for the approved program");
}

#[tokio::test]
async fn the_secret_is_written_once_per_record() {
    let mut rec = fixture_record("boot-line-once", &[]);
    let first = StdioLauncher
        .launch(&mut rec, &fixture_sha256())
        .await
        .expect("first start writes the secret");
    drop(first);
    assert!(matches!(
        StdioLauncher.launch(&mut rec, &fixture_sha256()).await,
        Err(Error::ServerGone(_))
    ));
}

#[tokio::test]
async fn a_server_that_quits_is_gone_until_it_is_registered_again() {
    let mut host = fixture_host(fixture_record("boot-line-quits", &["quit-on-list"]));

    assert!(matches!(host.list(&server_id("fixture")).await, Err(Error::ServerGone(_))));
    assert!(matches!(host.list(&server_id("fixture")).await, Err(Error::ServerGone(_))));

    host.replace_record(fixture_record("boot-line-again", &[])).expect("record is registered again");
    let listing = host.list(&server_id("fixture")).await.expect("list after re-registering");
    assert_eq!(listing.tools.len(), 3);
}

/// The point of the sealed launcher: the child is given what this host names
/// and nothing else. `PATH` is asserted both ways — the value it was handed,
/// and the emptiness of a variable it was not handed — so a launcher that
/// cleared nothing and one that kept too much both fail.
#[tokio::test]
async fn a_sealed_child_sees_only_the_variables_it_was_given() {
    let given = "PLAYWRIGHT_DRIVER_PATH";
    let value = "/app data/browser/driver/playwright-1.64.0-mac-arm64-node24.21.0";
    let mut host = sealed_host(fixture_record("boot-line-sealed", &[]), vec![(given.into(), value.into())]);

    host.list(&server_id("fixture")).await.expect("list");
    host.always_allow("conv", "fixture.env").await.expect("approve");

    assert_eq!(env_of(&mut host, given).await, value, "the variable it was given arrives");
    assert_eq!(env_of(&mut host, "HOME").await, "", "a variable it was not given does not");
}

async fn env_of(host: &mut Host<SealedStdioLauncher>, name: &str) -> String {
    match host.call("conv", "fixture.env", args(json!({"name": name}))).await {
        Ok(CallOutcome::Ran(result)) => text(&result),
        _ => panic!("the env tool runs"),
    }
}
