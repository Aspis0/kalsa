use std::path::PathBuf;

use super::{NodeId, NodeKey};

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-iroh-key-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

#[test]
fn the_key_survives_a_restart_unchanged() {
    let dir = temp_dir("roundtrip");
    let path = dir.join("node-key");
    let first = NodeKey::load_or_create(&path).expect("create");
    let second = NodeKey::load_or_create(&path).expect("reload");
    assert_eq!(first.to_bytes(), second.to_bytes());
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn the_stored_key_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let dir = temp_dir("mode");
    let path = dir.join("node-key");
    NodeKey::load_or_create(&path).expect("create");
    let mode = std::fs::metadata(&path)
        .expect("metadata")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "the key file must be owner-only");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_corrupt_key_file_is_refused_not_replaced() {
    let dir = temp_dir("corrupt");
    let path = dir.join("node-key");
    std::fs::write(&path, "kalsa-iroh-node-key-v1\nnot hex at all\n").expect("write");
    match NodeKey::load_or_create(&path) {
        Err(super::BridgeError::Corrupt(_)) => {}
        other => panic!("expected Corrupt, got {other:?}"),
    }
    // Refusal must not have overwritten the file with a fresh key.
    assert_eq!(
        std::fs::read(&path).expect("file still there"),
        b"kalsa-iroh-node-key-v1\nnot hex at all\n"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_debug_of_a_key_prints_nothing() {
    let key = NodeKey::generate().expect("entropy");
    let printed = format!("{key:?}");
    assert_eq!(printed, "NodeKey(_)");
    assert!(!printed.contains(&hex::encode(key.to_bytes())));
}

#[test]
fn the_node_id_round_trips_through_hex() {
    let id = NodeId::from_bytes([0xab; 32]);
    let printed = id.to_string();
    assert_eq!(printed.len(), 64);
    assert_eq!(printed, hex::encode([0xab_u8; 32]));
    assert_eq!(printed.parse::<NodeId>().expect("parse"), id);
    assert!("zz".parse::<NodeId>().is_err());
    assert!("a".repeat(63).parse::<NodeId>().is_err());
}
