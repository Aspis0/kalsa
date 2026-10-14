mod common;

use common::{FakeLauncher, TempBinary, args, launches, record, server_id, state, tool};
use kalsa_mcp::error::Error;
use kalsa_mcp::host::Host;
use kalsa_mcp::pins::Pins;
use kalsa_mcp::record::Trust;
use kalsa_mcp::registry::Registry;
use serde_json::json;

#[tokio::test]
async fn a_third_party_server_is_never_started_even_when_its_program_is_pinned() {
    let binary = TempBinary::new("third-party", b"vendor server v1");
    let tools = state(vec![tool("lookup", "Looks something up")], &[]);
    let registry = Registry::new(vec![record("vendor", binary.path(), Trust::ThirdParty)]).expect("registry");
    let mut pins = Pins::default();
    pins.seed_binary(&server_id("vendor"), &binary.path()).expect("program is readable");
    let mut host = Host::new(registry, FakeLauncher::new(vec![("vendor", tools.clone())]), pins);

    assert!(matches!(host.list(&server_id("vendor")).await, Err(Error::ThirdPartyNeedsSandbox(_))));
    assert!(matches!(
        host.call("conv", "vendor.lookup", args(json!({}))).await,
        Err(Error::ThirdPartyNeedsSandbox(_))
    ));
    assert_eq!(launches(&tools), 0);
}
