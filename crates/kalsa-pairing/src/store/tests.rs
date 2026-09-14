use std::fs;
use std::path::PathBuf;

use kalsa_catalog::{Parameters, PhoneModel};

use super::{forget, load, persist, StoreError};
use crate::handshake::{Credential, Handshake};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-pairing-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn sample_phone() -> PhoneModel {
    PhoneModel {
        weights_bytes: 2_200_000_000,
        parameters: Some(Parameters::mixture(7_600_000_000, 2_400_000_000)),
        measured_tokens_per_second: Some(9.5),
        battery_powered: Some(true),
    }
}

fn sample_handshake() -> Handshake {
    Handshake::new(sample_phone(), Credential::generate().unwrap())
}

#[test]
fn the_handshake_survives_the_store() {
    let dir = scratch("roundtrip");
    let path = dir.join("credential.json");
    let handshake = sample_handshake();
    let credential_hex = handshake.credential_hex();

    persist(&handshake, &path).unwrap();
    let loaded = load(&path).unwrap();

    assert_eq!(loaded.credential_hex(), credential_hex);
    assert_eq!(loaded.phone.weights_bytes, 2_200_000_000);
    let parameters = loaded.phone.parameters.unwrap();
    assert!(parameters.is_mixture());
    assert_eq!(parameters.total().count(), 7_600_000_000);
    assert_eq!(parameters.active().count(), 2_400_000_000);
    assert_eq!(loaded.phone.measured_tokens_per_second, Some(9.5));
    assert_eq!(loaded.phone.battery_powered, Some(true));
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_phone_that_declined_its_parameters_stays_declined() {
    let dir = scratch("declined");
    let path = dir.join("credential.json");
    let phone = PhoneModel {
        weights_bytes: 2_200_000_000,
        parameters: None,
        measured_tokens_per_second: None,
        battery_powered: None,
    };
    persist(
        &Handshake::new(phone, Credential::generate().unwrap()),
        &path,
    )
    .unwrap();

    let loaded = load(&path).unwrap();

    // Absent stays absent: not a zero, not a default, not a guess.
    assert!(loaded.phone.parameters.is_none());
    assert!(loaded.phone.measured_tokens_per_second.is_none());
    assert!(loaded.phone.battery_powered.is_none());
    assert_eq!(loaded.phone.weights_bytes, 2_200_000_000);
    fs::remove_dir_all(&dir).unwrap();
}

#[cfg(unix)]
#[test]
fn the_credential_file_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let dir = scratch("mode");
    let path = dir.join("credential.json");
    persist(&sample_handshake(), &path).unwrap();

    let mode = fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_store_never_overwrites_a_credential() {
    let dir = scratch("exclusive");
    let path = dir.join("credential.json");
    let first = sample_handshake();
    persist(&first, &path).unwrap();

    // And the refusal is the legible one, not an io error to squint at.
    assert!(matches!(
        persist(&sample_handshake(), &path),
        Err(StoreError::AlreadyPaired)
    ));
    // The first credential is still the one on disk.
    assert_eq!(
        load(&path).unwrap().credential_hex(),
        first.credential_hex()
    );
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn forgetting_makes_room_for_the_next_pairing() {
    let dir = scratch("re-pair");
    let path = dir.join("credential.json");
    let first = sample_handshake();
    persist(&first, &path).unwrap();

    forget(&path).unwrap();
    assert!(!path.exists());

    // The new phone pairs where the old one was, and what loads is the new
    // phone's handshake, not the old one's.
    let second = sample_handshake();
    persist(&second, &path).unwrap();
    assert_eq!(
        load(&path).unwrap().credential_hex(),
        second.credential_hex()
    );
    assert_ne!(first.credential_hex(), second.credential_hex());
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn forgetting_what_was_never_paired_succeeds() {
    let dir = scratch("never-paired");
    assert!(forget(&dir.join("credential.json")).is_ok());
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn forget_does_not_demand_a_readable_credential() {
    let dir = scratch("corrupt-forget");
    let path = dir.join("credential.json");
    fs::write(&path, "not json at all").unwrap();
    // The store cannot read this — it is not even JSON, so it never even
    // reaches the structural checks that yield Corrupt.
    assert!(load(&path).is_err());

    forget(&path).unwrap();
    let handshake = sample_handshake();
    persist(&handshake, &path).unwrap();
    assert_eq!(
        load(&path).unwrap().credential_hex(),
        handshake.credential_hex()
    );
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_corrupt_store_is_an_error_not_a_crash() {
    let dir = scratch("corrupt");
    let credential = "aa".repeat(32);
    let cases = [
        // An unknown version.
        r#"{"v":99,"credential_hex":"CREDENTIAL","phone":{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}"#,
        // Active parameters above total: `Parameters::mixture` would panic.
        r#"{"v":1,"credential_hex":"CREDENTIAL","phone":{"weights_bytes":1,"parameters":{"total":8,"active":9},"measured_tokens_per_second":null,"battery_powered":null}}"#,
        // A mixture with no active parameters.
        r#"{"v":1,"credential_hex":"CREDENTIAL","phone":{"weights_bytes":1,"parameters":{"total":8,"active":0},"measured_tokens_per_second":null,"battery_powered":null}}"#,
        // A credential that is not hex.
        r#"{"v":1,"credential_hex":"zz","phone":{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}"#,
    ];
    for template in cases {
        let path = dir.join("credential.json");
        let json = template.replace("CREDENTIAL", &credential);
        fs::write(&path, json).unwrap();
        assert!(
            matches!(load(&path), Err(StoreError::Corrupt(_))),
            "expected Corrupt for {template}"
        );
        fs::remove_file(&path).unwrap();
    }
    fs::remove_dir_all(&dir).unwrap();
}
