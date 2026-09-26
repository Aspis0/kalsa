//! The identity file on the path the phone will actually run:
//! `MobileBridge`'s constructor goes through brain's `Bridge::start` →
//! `NodeKey::load_or_create`, so creation, owner-only permissions, and
//! reload-same-identity are proven here, against a real file on disk.

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use kalsa_iroh::AddressBook;
use kalsa_iroh_mobile::MobileBridge;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join(format!("kalsa-iroh-mobile-key-{}-{tag}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir creates");
    dir
}

#[test]
fn the_key_file_is_created_owner_only_and_reloaded_as_the_same_identity() {
    let dir = temp_dir("lifecycle");
    let key_path = dir.join("iroh-node.key");
    let book = AddressBook::new();

    let first = MobileBridge::for_tests(key_path.clone(), &book).expect("first bridge starts");
    let stored = std::fs::read(&key_path).expect("key file was created");
    assert!(
        stored.starts_with(b"kalsa-iroh-node-key-v1"),
        "the key file must carry its format tag"
    );
    let mode = std::fs::metadata(&key_path)
        .expect("key file metadata")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "the key file must be owner-only");

    let identity = first.node_id();
    drop(first);
    let second = MobileBridge::for_tests(key_path, &book).expect("second bridge starts");
    assert_eq!(
        second.node_id(),
        identity,
        "a reload must keep the node's identity"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_corrupt_key_file_is_refused_not_replaced() {
    let dir = temp_dir("corrupt");
    let key_path = dir.join("iroh-node.key");
    std::fs::write(&key_path, b"kalsa-iroh-node-key-v1\nnot-hex\n")
        .expect("corrupt key file writes");
    let book = AddressBook::new();

    let error = MobileBridge::for_tests(key_path, &book)
        .err()
        .expect("a corrupt key file must refuse to start");
    assert!(
        matches!(error, kalsa_iroh_mobile::IrohMobileError::KeyCorrupt { .. }),
        "expected KeyCorrupt, got: {error}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
