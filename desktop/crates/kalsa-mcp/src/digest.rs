use std::path::Path;

use rmcp::model::Tool;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Hashes the whole definition, so a change to any field a server sends is seen.
pub(crate) fn tool_digest(tool: &Tool) -> Result<String, serde_json::Error> {
    serde_json::to_value(tool).map(|value| sha256_hex(canonical(&value).as_bytes()))
}

pub(crate) fn file_digest(path: &Path) -> std::io::Result<String> {
    std::fs::read(path).map(|bytes| sha256_hex(&bytes))
}

/// Object keys are sorted at every level, so the digest does not depend on the
/// key order a server or a serializer happens to use.
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let fields: Vec<String> = keys
                .into_iter()
                .map(|key| format!("{}:{}", Value::String(key.clone()), canonical(&map[key.as_str()])))
                .collect();
            format!("{{{}}}", fields.join(","))
        }
        Value::Array(items) => {
            let items: Vec<String> = items.iter().map(canonical).collect();
            format!("[{}]", items.join(","))
        }
        scalar => scalar.to_string(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}
