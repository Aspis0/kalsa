mod common;

use common::{FakeLauncher, SharedState, TempBinary, args, arguments, calls, launches, record, seed, set_tools, state, tool};
use kalsa_mcp::error::Error;
use kalsa_mcp::host::Host;
use kalsa_mcp::outcome::CallOutcome;
use kalsa_mcp::pins::Pins;
use kalsa_mcp::record::Trust;
use kalsa_mcp::registry::Registry;
use serde_json::json;

/// The browser's sidecar as the app registers it, with the tools it lists pinned
/// and its program approved as it is on disk.
fn browser(binary: &TempBinary, trust: Trust, listed: &[(&str, &str)], answers: &[(&str, &str)]) -> (Host<FakeLauncher>, SharedState) {
    let tools: Vec<_> = listed.iter().map(|(name, text)| tool(name, text)).collect();
    let sidecar = state(tools.clone(), answers);
    let registry = Registry::new(vec![record("browser", binary.path(), trust)]).expect("one server");
    let mut pins = Pins::default();
    seed(&mut pins, "browser", &binary.path(), &tools);
    let host = Host::new(registry, FakeLauncher::new(vec![("browser", sidecar.clone())]), pins);
    (host, sidecar)
}

/// **The model is never offered a host-only tool, and a call to one never reaches
/// the sidecar.** Those tools are answered by the server but not listed, so the
/// chat's own path refuses them as unlisted.
#[tokio::test]
async fn the_model_path_refuses_a_host_only_tool_and_the_sidecar_never_hears_it() {
    let binary = TempBinary::new("host-only-model", b"browser v1");
    let (mut host, sidecar) = browser(&binary, Trust::FirstParty, &[("browser_open", "Open a page")], &[("browser_waiting", "[]")]);

    assert!(matches!(host.call("conv", "browser.browser_waiting", args(json!({}))).await, Err(Error::UnknownTool(_))));
    assert!(matches!(host.call("conv", "browser.browser_confirm", args(json!({"id": "c1"}))).await, Err(Error::UnknownTool(_))));
    // **The picture of the person's page is one of these.** A model that could
    // ask for it would be a model reading the person's screen.
    assert!(matches!(host.call("conv", "browser.browser_preview", args(json!({"conversation": "phone:1"}))).await, Err(Error::UnknownTool(_))));
    assert!(calls(&sidecar).is_empty(), "the sidecar was never asked for a host-only tool");
}

/// **The host reaches its own tools through `call_host_only`, and the arguments
/// arrive as they were sent.**
#[tokio::test]
async fn the_host_reaches_its_own_tools_through_call_host_only() {
    let binary = TempBinary::new("host-only-host", b"browser v1");
    let (mut host, sidecar) = browser(
        &binary,
        Trust::FirstParty,
        &[("browser_open", "Open a page")],
        &[("browser_waiting", "[]"), ("browser_confirm", "{\"code\":\"sent\"}")],
    );

    let waiting = host
        .call_host_only("conv", "browser.browser_waiting", args(json!({})))
        .await
        .expect("the host may ask what is waiting");
    assert_eq!(waiting.for_model, vec!["[]".to_owned()]);

    let confirmed = host
        .call_host_only("conv", "browser.browser_confirm", args(json!({"id": "c1"})))
        .await
        .expect("the host may confirm a card");
    assert_eq!(confirmed.for_model, vec!["{\"code\":\"sent\"}".to_owned()]);
    assert_eq!(calls(&sidecar), vec!["browser_waiting", "browser_confirm"]);
    assert_eq!(arguments(&sidecar)[1], json!({"id": "c1"}));
}

/// **`call_host_only` takes the names in its table and no others.** A tool the
/// model is offered is not the host's to call this way, and a name with no
/// server is refused before anything is started.
#[tokio::test]
async fn call_host_only_takes_only_the_names_in_its_table() {
    let binary = TempBinary::new("host-only-table", b"browser v1");
    let (mut host, sidecar) = browser(&binary, Trust::FirstParty, &[("browser_open", "Open a page")], &[]);

    assert!(matches!(
        host.call_host_only("conv", "browser.browser_open", args(json!({}))).await,
        Err(Error::UnknownTool(_))
    ));
    assert!(matches!(
        host.call_host_only("conv", "browser.browser_steal", args(json!({}))).await,
        Err(Error::UnknownTool(_))
    ));
    assert!(matches!(
        host.call_host_only("conv", "browser_waiting", args(json!({}))).await,
        Err(Error::NoNamespace)
    ));
    assert_eq!(launches(&sidecar), 0, "a refused name starts nothing");
}

/// **A third-party server is refused before anything is read or started.**
#[tokio::test]
async fn a_third_party_server_is_not_called_for_the_host() {
    let binary = TempBinary::new("host-only-third", b"browser v1");
    let (mut host, sidecar) = browser(&binary, Trust::ThirdParty, &[("browser_open", "Open a page")], &[]);

    assert!(matches!(
        host.call_host_only("conv", "browser.browser_waiting", args(json!({}))).await,
        Err(Error::ThirdPartyNeedsSandbox(_))
    ));
    assert_eq!(launches(&sidecar), 0, "and nothing was started");
}

/// **A program that changed since it was approved is not run, even for the host.**
#[tokio::test]
async fn a_changed_program_is_not_called_for_the_host() {
    let binary = TempBinary::new("host-only-changed", b"browser v1");
    let (mut host, sidecar) = browser(&binary, Trust::FirstParty, &[("browser_open", "Open a page")], &[]);
    binary.overwrite(b"browser v2");

    assert!(matches!(
        host.call_host_only("conv", "browser.browser_pause", args(json!({}))).await,
        Err(Error::BinaryChanged(_))
    ));
    assert_eq!(launches(&sidecar), 0, "and nothing was started");
}

/// **The browser's model tools run without asking, and a changed definition is
/// still refused.** Clicks and typing are held by the sidecar for the person's
/// confirm, so they are allowed here; the pins still decide first.
#[tokio::test]
async fn the_browsers_model_tools_run_without_asking_while_their_pins_hold() {
    let binary = TempBinary::new("browser-allow", b"browser v1");
    let (mut host, sidecar) = browser(&binary, Trust::FirstParty, &[("browser_open", "Open"), ("browser_click", "Click")], &[]);

    assert!(matches!(host.call("conv", "browser.browser_open", args(json!({}))).await, Ok(CallOutcome::Ran(_))));
    assert!(matches!(host.call("conv", "browser.browser_click", args(json!({"ref": "e1"}))).await, Ok(CallOutcome::Ran(_))));
    assert_eq!(calls(&sidecar), vec!["browser_open", "browser_click"]);

    set_tools(&sidecar, vec![tool("browser_click", "Click, described differently now")]);
    assert!(matches!(
        host.call("conv", "browser.browser_click", args(json!({"ref": "e1"}))).await,
        Err(Error::Denied(_, _))
    ));
}
