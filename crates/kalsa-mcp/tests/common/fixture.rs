//! The stdio fixture server built from `examples/mcp_test_server.rs`.

use std::path::PathBuf;

use kalsa_mcp::host::Host;
use kalsa_mcp::launch::StdioLauncher;
use kalsa_mcp::pins::Pins;
use kalsa_mcp::record::{ServerRecord, Trust};
use kalsa_mcp::registry::Registry;
use kalsa_mcp::secret::BootstrapSecret;
use sha2::{Digest, Sha256};

use super::{record, server_id};

/// Cargo sets no `CARGO_BIN_EXE_` variable for examples, and names them with a
/// hash, so the newest matching file in the examples folder is the fixture.
pub fn fixture_binary() -> PathBuf {
    let mut dir = std::env::current_exe().expect("test binary path");
    dir.pop();
    dir.pop();
    dir.push("examples");
    let is_fixture = |path: &PathBuf| {
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default();
        name.starts_with("mcp_test_server-") && extension == std::env::consts::EXE_EXTENSION
    };
    std::fs::read_dir(&dir)
        .expect("examples folder exists after cargo test")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(is_fixture)
        .max_by_key(|path| path.metadata().and_then(|meta| meta.modified()).ok())
        .expect("cargo test builds the fixture example")
}

pub fn fixture_sha256() -> String {
    Sha256::digest(std::fs::read(fixture_binary()).expect("fixture is readable"))
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// `mode` is the fixture's argument: `silent`, `quit-on-list`, or none for a normal server.
pub fn fixture_record(secret: &str, mode: &[&str]) -> ServerRecord {
    let secret = BootstrapSecret::new(secret.to_owned()).expect("secret is one line");
    let args = mode.iter().map(|arg| arg.to_string()).collect();
    record("fixture", fixture_binary(), Trust::FirstParty)
        .with_args(args)
        .with_bootstrap(secret)
        .expect("first-party record takes a bootstrap")
}

pub fn fixture_host(record: ServerRecord) -> Host<StdioLauncher> {
    let mut pins = Pins::default();
    pins.seed_binary(&server_id("fixture"), &fixture_binary()).expect("fixture is readable");
    let registry = Registry::new(vec![record]).expect("registry");
    Host::new(registry, StdioLauncher, pins)
}
