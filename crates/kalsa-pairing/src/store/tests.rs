use std::fs;
use std::path::PathBuf;

use kalsa_catalog::{Parameters, PhoneModel};

use super::{
    add_device, add_device_with_delivery, allow_device, clear_delivery, enrol_host, forget,
    forget_device, load, load_devices, load_with_delivery, persist, persist_with_delivery,
    replace, temp_path, Delivery, DeviceKind, StoreError, HOST_LABEL,
};
use crate::handshake::{Credential, Handshake};
use crate::messages::seal_computer;
use std::time::{Duration, UNIX_EPOCH};

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

fn sample_handshake_with_credential(hex: &str) -> Handshake {
    Handshake::new(
        sample_phone(),
        Credential::from_hex(hex).expect("the test credential is 64 hex characters"),
    )
}

/// The single-device file every installed copy wrote before the store held
/// a set, with a real credential and a real phone declaration in it.
fn write_v1_file(path: &std::path::Path, credential_hex: &str) {
    let json = format!(
        r#"{{"v":1,"credential_hex":"{credential_hex}","phone":{{"weights_bytes":2200000000,"parameters":{{"total":7600000000,"active":2400000000}},"measured_tokens_per_second":9.5,"battery_powered":true}}}}"#
    );
    fs::write(path, json).unwrap();
}

#[test]
fn a_v1_file_loads_intact_and_is_not_rewritten_by_reading() {
    let dir = scratch("v1");
    let path = dir.join("credential.json");
    let credential = "ab".repeat(32);
    write_v1_file(&path, &credential);
    let bytes_before = fs::read(&path).unwrap();

    // The single-device readers answer the migrated record exactly as they
    // always answered the file.
    let loaded = load(&path).unwrap();
    assert_eq!(loaded.credential_hex(), credential);
    let phone = loaded.phone.expect("a stored phone lives on");
    assert_eq!(phone.weights_bytes, 2_200_000_000);
    assert_eq!(phone.parameters.unwrap().total().count(), 7_600_000_000);

    // The set view: one device, with the id and label the app has always
    // given the phone.
    let devices = load_devices(&path).unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].id, 0);
    assert_eq!(devices[0].label, "Paired phone");
    assert_eq!(devices[0].handshake.credential_hex(), credential);

    // Migration is on read, never a rewrite: the poll reads this file every
    // second and must leave the v1 bytes for the next legitimate write.
    assert_eq!(fs::read(&path).unwrap(), bytes_before);

    // The next write publishes the set, and the old record is in it.
    let second = sample_handshake();
    let added = add_device(&path, "Second phone", &second).unwrap();
    assert_eq!(added.id, 1);
    let devices = load_devices(&path).unwrap();
    assert_eq!(devices.len(), 2);
    assert_eq!(devices[0].handshake.credential_hex(), credential);
    assert_eq!(devices[1].label, "Second phone");
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn several_devices_are_held_and_read_back_with_their_ids() {
    let dir = scratch("multi");
    let path = dir.join("credential.json");
    let first = sample_handshake();
    let second = sample_handshake();
    let third = sample_handshake();
    let credentials = [
        first.credential_hex(),
        second.credential_hex(),
        third.credential_hex(),
    ];

    let a = add_device(&path, "Anna's phone", &first).unwrap();
    let b = add_device(&path, "Paolo's phone", &second).unwrap();
    let c = add_device(&path, "Third phone", &third).unwrap();
    assert_eq!((a.id, b.id, c.id), (0, 1, 2), "ids are minted, one above the rest");

    let devices = load_devices(&path).unwrap();
    assert_eq!(devices.len(), 3);
    for (device, credential) in devices.iter().zip(credentials) {
        assert_eq!(device.handshake.credential_hex(), credential);
    }
    assert_eq!(devices[1].label, "Paolo's phone");
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn forgetting_one_device_leaves_the_others_and_a_middle_id_is_not_reused() {
    let dir = scratch("forget-one");
    let path = dir.join("credential.json");
    let first = sample_handshake();
    let second = sample_handshake();
    let third = sample_handshake();
    let kept_credentials = [first.credential_hex(), third.credential_hex()];
    add_device(&path, "First", &first).unwrap();
    add_device(&path, "Second", &second).unwrap();
    add_device(&path, "Third", &third).unwrap();

    forget_device(&path, 1).unwrap();
    let devices = load_devices(&path).unwrap();
    assert_eq!(devices.len(), 2, "only the forgotten device left");
    assert_eq!(devices[0].id, 0);
    assert_eq!(devices[1].id, 2);
    for (device, credential) in devices.iter().zip(kept_credentials) {
        assert_eq!(device.handshake.credential_hex(), credential);
    }

    // Forgetting an id that is already absent is success, and changes
    // nothing.
    forget_device(&path, 1).unwrap();
    assert_eq!(load_devices(&path).unwrap().len(), 2);

    // The set holds ids {0, 2}, and the mint is the highest present plus one:
    // it starts above both, so this forgotten middle id is passed over and the
    // next device is 3.
    let added = add_device(&path, "Fourth", &sample_handshake()).unwrap();
    assert_eq!(added.id, 3, "the middle id below the present max was not handed out again");

    // Forgetting the last devices empties the store, which is no file.
    forget_device(&path, 0).unwrap();
    forget_device(&path, 2).unwrap();
    forget_device(&path, 3).unwrap();
    assert!(!path.exists());
    assert!(load_devices(&path).unwrap().is_empty());
    fs::remove_dir_all(&dir).unwrap();
}

#[cfg(unix)]
#[test]
fn a_written_set_is_still_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let dir = scratch("set-mode");
    let path = dir.join("credential.json");
    add_device(&path, "First", &sample_handshake()).unwrap();
    // The second write replaces the file through a fresh temp: the mode
    // must be the temp's, not whatever the rename happens to keep.
    add_device(&path, "Second", &sample_handshake()).unwrap();

    let mode = fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn forgetting_the_highest_id_then_pairing_reuses_it() {
    // The salt trap, T5b: the file name carries no salt, so what matters for
    // the door's sweep is only whether a re-pair moves the device id. The
    // id is minted `max + 1` over the records present NOW — so forgetting
    // the record that holds the highest id hands that id straight back to
    // the next pairing. The old files then sit under an id the new set
    // holds, and the sweep is blind to them by its own first rule.
    let dir = scratch("forget-top-repair");
    let path = dir.join("credential.json");
    add_device(&path, "First", &sample_handshake()).unwrap(); // id 0
    add_device(&path, "Second", &sample_handshake()).unwrap(); // id 1

    forget_device(&path, 1).unwrap();

    let again = add_device(&path, "Re-paired", &sample_handshake()).unwrap();
    assert_eq!(
        again.id, 1,
        "the forgotten top id was minted again: a re-pair can keep the id"
    );
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_store_sitting_on_the_last_id_refuses_to_add_instead_of_duplicating() {
    let dir = scratch("ids-exhausted");
    let path = dir.join("credential.json");
    let credential = "ef".repeat(32);
    // One record holding the highest id there is: the next add has no id
    // left, and a silent saturation would mint a duplicate that makes the
    // whole set unreadable.
    fs::write(
        &path,
        format!(
            r#"{{"v":2,"devices":[{{"id":4294967295,"label":"Last","credential_hex":"{credential}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}}]}}"#
        ),
    )
    .unwrap();

    assert!(matches!(
        add_device(&path, "One too many", &sample_handshake()),
        Err(StoreError::StoreFull)
    ));

    // The refusal wrote nothing: the set is exactly as it was, readable.
    let devices = load_devices(&path).unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].id, u32::MAX);
    assert_eq!(devices[0].label, "Last");
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn forget_takes_the_crashed_write_temp_down_with_the_store() {
    let dir = scratch("forget-temp");
    let path = dir.join("credential.json");
    // A persist that died between writing the temp and renaming it leaves
    // the credential on disk twice.
    fs::write(&path, "a complete store").unwrap();
    fs::write(temp_path(&path), "ab".repeat(32)).unwrap();

    forget(&path).unwrap();
    assert!(!path.exists());
    assert!(
        !temp_path(&path).exists(),
        "the second copy of the secret does not survive the forget"
    );

    // A temp that exists but cannot be removed is a failure to discard,
    // not a success to shrug at.
    fs::write(&path, "a complete store").unwrap();
    fs::create_dir(temp_path(&path)).unwrap();
    assert!(forget(&path).is_err());
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn forgetting_a_device_from_a_store_that_is_not_there_succeeds() {
    let dir = scratch("forget-absent");
    let path = dir.join("credential.json");
    assert!(forget_device(&path, 0).is_ok());
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn an_emptied_out_set_ends_up_as_no_file() {
    let dir = scratch("empty-v2");
    let path = dir.join("credential.json");
    fs::write(&path, r#"{"v":2,"devices":[]}"#).unwrap();
    forget_device(&path, 7).unwrap();
    assert!(
        !path.exists(),
        "a store holding no devices is no file at all"
    );
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_same_credential_is_refused_not_stored_twice() {
    let dir = scratch("duplicate");
    let path = dir.join("credential.json");
    let credential = "cd".repeat(32);
    add_device(&path, "First", &sample_handshake_with_credential(&credential)).unwrap();

    // A different handshake around the SAME credential is not a new device:
    // it is the one thing this layer can see and refuse — and the refusal is
    // its own, not the one the desk reads as "offer the owner a replacement".
    let replay = sample_handshake_with_credential(&credential);
    assert!(matches!(
        add_device(&path, "Replay", &replay),
        Err(StoreError::CredentialAlreadyStored)
    ));
    let devices = load_devices(&path).unwrap();
    assert_eq!(devices.len(), 1, "the refusal stored nothing");
    assert_eq!(devices[0].label, "First");
    fs::remove_dir_all(&dir).unwrap();
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
    let phone = loaded.phone.expect("a stored phone lives on");
    assert_eq!(phone.weights_bytes, 2_200_000_000);
    let parameters = phone.parameters.unwrap();
    assert!(parameters.is_mixture());
    assert_eq!(parameters.total().count(), 7_600_000_000);
    assert_eq!(parameters.active().count(), 2_400_000_000);
    assert_eq!(phone.measured_tokens_per_second, Some(9.5));
    assert_eq!(phone.battery_powered, Some(true));
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
    let phone = loaded.phone.expect("a stored phone lives on");
    assert!(phone.parameters.is_none());
    assert!(phone.measured_tokens_per_second.is_none());
    assert!(phone.battery_powered.is_none());
    assert_eq!(phone.weights_bytes, 2_200_000_000);
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
fn a_torn_temp_from_an_earlier_crash_never_becomes_the_credential() {
    let dir = scratch("torn");
    let path = dir.join("credential.json");
    // A previous persist died between writing the temp and renaming it.
    fs::write(temp_path(&path), b"half a write").unwrap();

    persist(&sample_handshake(), &path).unwrap();
    // What loads is a complete handshake, and the torn bytes were consumed
    // by the publication, not promoted.
    assert!(load(&path).is_ok());
    assert!(!temp_path(&path).exists());
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
fn a_failed_replacement_leaves_the_old_credential_in_place() {
    let dir = scratch("replace-failure");
    let path = dir.join("credential.json");
    let first = sample_handshake();
    persist(&first, &path).unwrap();

    // The temp name is unusable, so publication fails before the destination
    // is touched. This is the crash/failure boundary the desk relies on.
    fs::create_dir(temp_path(&path)).unwrap();
    assert!(replace(&sample_handshake(), &path).is_err());
    assert_eq!(
        load(&path).unwrap().credential_hex(),
        first.credential_hex()
    );

    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_replacement_publishes_the_new_credential_atomically() {
    let dir = scratch("replace-success");
    let path = dir.join("credential.json");
    let first = sample_handshake();
    let second = sample_handshake();
    persist(&first, &path).unwrap();

    replace(&second, &path).unwrap();
    assert_eq!(
        load(&path).unwrap().credential_hex(),
        second.credential_hex()
    );
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_delivery_is_atomic_and_can_be_cleared_after_success() {
    let dir = scratch("delivery");
    let path = dir.join("credential.json");
    let handshake = sample_handshake();
    let code = "11".repeat(16);
    let nonce = "22".repeat(32);
    let mut key = [0u8; 16];
    let mut nonce_bytes = [0u8; 32];
    hex::decode_to_slice(&code, &mut key).unwrap();
    hex::decode_to_slice(&nonce, &mut nonce_bytes).unwrap();
    let seal = seal_computer(
        &key,
        &nonce_bytes,
        &Credential::from_hex(&"33".repeat(32)).unwrap(),
    );
    let delivery =
        Delivery::new(&"44".repeat(16), seal, UNIX_EPOCH + Duration::from_secs(60)).unwrap();

    persist_with_delivery(&handshake, &path, delivery).unwrap();
    let (_, loaded) = load_with_delivery(&path).unwrap();
    assert_eq!(loaded.unwrap().token(), &"44".repeat(16));
    clear_delivery(&path, &"44".repeat(16)).unwrap();
    assert!(load_with_delivery(&path).unwrap().1.is_none());
    fs::remove_dir_all(&dir).unwrap();
}

/// clear_delivery clears the record that HOLDS the token, not the first
/// record: production stores hold the host first, and the phone's retained
/// response sits further down. A token matching nothing is Ok and leaves
/// the bytes alone.
#[test]
fn clear_delivery_matches_the_record_holding_the_token() {
    let dir = scratch("clear-token");
    let path = dir.join("credential.json");
    let host = enrol_host(&path).unwrap();
    let host_cred = host.handshake.credential_hex();

    let handshake = sample_handshake();
    let code = "11".repeat(16);
    let nonce = "22".repeat(32);
    let mut key = [0u8; 16];
    let mut nonce_bytes = [0u8; 32];
    hex::decode_to_slice(&code, &mut key).unwrap();
    hex::decode_to_slice(&nonce, &mut nonce_bytes).unwrap();
    let seal = seal_computer(
        &key,
        &nonce_bytes,
        &Credential::from_hex(&"33".repeat(32)).unwrap(),
    );
    let delivery =
        Delivery::new(&"44".repeat(16), seal, UNIX_EPOCH + Duration::from_secs(60)).unwrap();
    add_device_with_delivery(&path, "Phone", &handshake, delivery).unwrap();

    clear_delivery(&path, &"44".repeat(16)).unwrap();
    let devices = load_devices(&path).unwrap();
    let stored_host = devices.iter().find(|d| d.kind == DeviceKind::Host).unwrap();
    let stored_phone = devices.iter().find(|d| d.kind == DeviceKind::Phone).unwrap();
    assert!(stored_phone.delivery.is_none(), "the token-holder's delivery is cleared");
    assert!(
        stored_host.delivery.is_none() && stored_host.handshake.credential_hex() == host_cred,
        "the host's record is untouched"
    );

    let bytes = fs::read(&path).unwrap();
    clear_delivery(&path, &"ff".repeat(16)).unwrap();
    assert_eq!(
        fs::read(&path).unwrap(),
        bytes,
        "a token matching nothing changes nothing"
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

/// A host round-trips: a credential, an id, a label — and no phone fields,
/// on disk or after `realize`.
#[test]
fn a_host_round_trips_without_phone_fields() {
    let dir = scratch("host-roundtrip");
    let path = dir.join("credential.json");
    let host = enrol_host(&path).unwrap();
    assert_eq!(host.id, 0);
    assert_eq!(host.label, HOST_LABEL);
    assert_eq!(host.kind, DeviceKind::Host);
    assert!(host.handshake.phone.is_none());

    let devices = load_devices(&path).unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].kind, DeviceKind::Host);
    assert!(devices[0].handshake.phone.is_none());
    assert_eq!(
        devices[0].handshake.credential_hex(),
        host.handshake.credential_hex()
    );

    // The file itself: a credential and no phone field at all.
    let stored: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert!(stored["devices"][0]["credential_hex"].is_string());
    assert!(
        stored["devices"][0]["phone"].is_null(),
        "a host has no phone fields to write"
    );
    fs::remove_dir_all(&dir).unwrap();
}

/// Every record written before the kind existed reads back as a phone: the
/// v2 file the previous build wrote, and the v1 file every install has.
#[test]
fn a_record_written_before_kinds_reads_back_as_a_phone() {
    let dir = scratch("kind-default");
    let credential = "12".repeat(32);

    // Version 2, no `kind` key — the previous build's shape, unchanged.
    let v2 = dir.join("v2.json");
    fs::write(
        &v2,
        format!(
            r#"{{"v":2,"devices":[{{"id":0,"label":"Paired phone","credential_hex":"{credential}","phone":{{"weights_bytes":2200000000,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}}]}}"#
        ),
    )
    .unwrap();
    let devices = load_devices(&v2).unwrap();
    assert_eq!(devices[0].kind, DeviceKind::Phone);
    assert_eq!(
        devices[0].handshake.phone.unwrap().weights_bytes,
        2_200_000_000
    );

    // Version 1, the single-device file, lifted by the same reader.
    let v1 = dir.join("v1.json");
    write_v1_file(&v1, &credential);
    let devices = load_devices(&v1).unwrap();
    assert_eq!(devices[0].kind, DeviceKind::Phone);
    assert!(devices[0].handshake.phone.is_some());
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn enrolling_the_host_twice_answers_with_the_same_host() {
    let dir = scratch("host-idempotent");
    let path = dir.join("credential.json");
    let first = enrol_host(&path).unwrap();
    let second = enrol_host(&path).unwrap();
    assert_eq!(second.id, first.id);
    assert_eq!(second.kind, DeviceKind::Host);
    assert_eq!(
        second.handshake.credential_hex(),
        first.handshake.credential_hex()
    );
    assert_eq!(
        load_devices(&path).unwrap().len(),
        1,
        "one host, one record"
    );
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_hosts_id_follows_the_never_re_densify_rule() {
    let dir = scratch("host-ids");

    // An empty store: the host is device 0.
    let empty = dir.join("empty.json");
    assert_eq!(enrol_host(&empty).unwrap().id, 0);

    // A v1 phone already holds id 0; the host takes the next id and the
    // phone keeps its own, credential and all.
    let path = dir.join("credential.json");
    let credential = "ab".repeat(32);
    write_v1_file(&path, &credential);
    assert_eq!(enrol_host(&path).unwrap().id, 1);
    assert_eq!(
        enrol_host(&path).unwrap().id,
        1,
        "enrolling again re-densifies nothing"
    );

    let devices = load_devices(&path).unwrap();
    assert_eq!((devices[0].id, devices[1].id), (0, 1));
    assert_eq!(devices[0].kind, DeviceKind::Phone);
    assert_eq!(devices[0].handshake.credential_hex(), credential);
    assert_eq!(devices[1].kind, DeviceKind::Host);
    fs::remove_dir_all(&dir).unwrap();
}

/// Forgetting the host from a host-only store leaves no file and no
/// credential — the postcondition forgetting a phone leaves.
#[test]
fn forgetting_the_host_empties_a_host_only_store() {
    let dir = scratch("forget-host");
    let path = dir.join("credential.json");
    let host = enrol_host(&path).unwrap();
    forget_device(&path, host.id).unwrap();
    assert!(!path.exists(), "the last device leaving empties the store");
    assert!(load_devices(&path).unwrap().is_empty());
    fs::remove_dir_all(&dir).unwrap();
}

/// The kind and the fields must agree: a host with phone fields and a phone
/// with none are both corrupt, never silently repaired into a phone.
#[test]
fn a_kind_that_disagrees_with_its_fields_is_corrupt() {
    let dir = scratch("kind-mismatch");
    let credential = "34".repeat(32);
    let fields = r#"{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}"#;
    let cases = [
        // A host carrying phone fields.
        format!(
            r#"{{"v":2,"devices":[{{"id":0,"label":"x","kind":"Host","credential_hex":"{credential}","phone":{fields}}}]}}"#
        ),
        // A phone that declares no phone fields.
        format!(
            r#"{{"v":2,"devices":[{{"id":0,"label":"x","kind":"Phone","credential_hex":"{credential}"}}]}}"#
        ),
    ];
    for json in cases {
        let path = dir.join("credential.json");
        fs::write(&path, json).unwrap();
        assert!(matches!(load_devices(&path), Err(StoreError::Corrupt(_))));
        fs::remove_file(&path).unwrap();
    }
    fs::remove_dir_all(&dir).unwrap();
}

/// The approval migration, the same shape as `kind`: a record written
/// before approval existed has no `approval` key and reads back ALLOWED,
/// and a read never rewrites the bytes.
#[test]
fn a_record_written_before_approval_existed_reads_back_allowed() {
    let dir = scratch("approval-default");
    let credential = "56".repeat(32);
    let path = dir.join("v2.json");
    fs::write(
        &path,
        format!(
            r#"{{"v":2,"devices":[{{"id":0,"label":"Paired phone","credential_hex":"{credential}","phone":{{"weights_bytes":2200000000,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}}]}}"#
        ),
    )
    .unwrap();
    let before = fs::read(&path).unwrap();
    let devices = load_devices(&path).unwrap();
    assert!(!devices[0].waiting, "no approval key: read back ALLOWED");
    load_devices(&path).unwrap();
    assert_eq!(fs::read(&path).unwrap(), before, "a read rewrites nothing");
    fs::remove_dir_all(&dir).unwrap();
}

/// A phone added by a completed ceremony is stored WAITING; the host this
/// computer enrols for itself never is.
#[test]
fn a_ceremony_added_phone_is_stored_waiting_and_the_host_is_not() {
    let dir = scratch("approval-ceremony");
    let path = dir.join("credential.json");
    let host = enrol_host(&path).unwrap();
    assert!(!host.waiting, "the host record is never waiting");

    let handshake = sample_handshake();
    let code = "11".repeat(16);
    let nonce = "22".repeat(32);
    let mut key = [0u8; 16];
    let mut nonce_bytes = [0u8; 32];
    hex::decode_to_slice(&code, &mut key).unwrap();
    hex::decode_to_slice(&nonce, &mut nonce_bytes).unwrap();
    let seal = seal_computer(
        &key,
        &nonce_bytes,
        &Credential::from_hex(&"33".repeat(32)).unwrap(),
    );
    let delivery =
        Delivery::new(&"44".repeat(16), seal, UNIX_EPOCH + Duration::from_secs(60)).unwrap();

    let phone = add_device_with_delivery(&path, "New phone", &handshake, delivery).unwrap();
    assert!(phone.waiting, "a completed ceremony stores the phone WAITING");

    let devices = load_devices(&path).unwrap();
    assert_eq!(devices.len(), 2, "waiting is stored, not absent");
    assert!(!devices.iter().find(|d| d.id == host.id).unwrap().waiting);
    assert!(devices.iter().find(|d| d.id == phone.id).unwrap().waiting);
    fs::remove_dir_all(&dir).unwrap();
}

/// Allow flips exactly ONE device: the waiting phone becomes allowed, the
/// host and an already-allowed phone keep their records and credentials
/// byte for byte.
#[test]
fn allow_flips_exactly_one_device_and_leaves_the_others_intact() {
    let dir = scratch("approval-allow");
    let path = dir.join("credential.json");
    let host = enrol_host(&path).unwrap();

    let waiting_handshake = sample_handshake();
    let waiting_cred = waiting_handshake.credential_hex();
    let code = "11".repeat(16);
    let nonce = "22".repeat(32);
    let mut key = [0u8; 16];
    let mut nonce_bytes = [0u8; 32];
    hex::decode_to_slice(&code, &mut key).unwrap();
    hex::decode_to_slice(&nonce, &mut nonce_bytes).unwrap();
    let seal = seal_computer(
        &key,
        &nonce_bytes,
        &Credential::from_hex(&"33".repeat(32)).unwrap(),
    );
    let delivery =
        Delivery::new(&"44".repeat(16), seal, UNIX_EPOCH + Duration::from_secs(60)).unwrap();
    let waiting =
        add_device_with_delivery(&path, "Waiting phone", &waiting_handshake, delivery).unwrap();

    let other_handshake = sample_handshake();
    let other_cred = other_handshake.credential_hex();
    let other = add_device(&path, "Other phone", &other_handshake).unwrap();
    let host_cred = host.handshake.credential_hex();
    assert!(waiting.waiting && !other.waiting && !host.waiting);

    allow_device(&path, waiting.id).unwrap();

    let devices = load_devices(&path).unwrap();
    assert_eq!(devices.len(), 3, "Allow forgets nobody");
    let by_id = |id: u32| devices.iter().find(|d| d.id == id).unwrap();
    assert!(!by_id(waiting.id).waiting, "Allow flipped the waiting phone");
    assert_eq!(
        by_id(waiting.id).handshake.credential_hex(),
        waiting_cred,
        "the flipped device keeps its credential"
    );
    assert!(!by_id(other.id).waiting, "the other phone is untouched");
    assert_eq!(by_id(other.id).handshake.credential_hex(), other_cred);
    assert!(!by_id(host.id).waiting, "the host is untouched");
    assert_eq!(by_id(host.id).handshake.credential_hex(), host_cred);
    fs::remove_dir_all(&dir).unwrap();
}

/// The host record is never waiting - on the write side (self-enrolment)
/// and on the read side: a hand edit that marks the host waiting refuses
/// the whole set, like every other record that disagrees with itself.
#[test]
fn the_host_record_is_never_waiting() {
    let dir = scratch("approval-host");
    let path = dir.join("credential.json");
    let host = enrol_host(&path).unwrap();
    assert!(!host.waiting, "enrol_host writes an ALLOWED host");
    let devices = load_devices(&path).unwrap();
    assert!(!devices[0].waiting, "...and it reads back allowed");

    let credential = "78".repeat(32);
    fs::write(
        &path,
        format!(
            r#"{{"v":2,"devices":[{{"id":0,"label":"This computer","kind":"Host","credential_hex":"{credential}","approval":"Waiting"}}]}}"#
        ),
    )
    .unwrap();
    assert!(matches!(
        load_devices(&path),
        Err(StoreError::Corrupt(_))
    ));
    fs::remove_dir_all(&dir).unwrap();
}

/// Only Allow flips approval: forgetting a DIFFERENT device, and adding
/// another one, both leave a waiting phone waiting.
#[test]
fn a_waiting_phone_stays_waiting_when_a_different_device_is_forgotten_or_added() {
    let dir = scratch("approval-retains");
    let path = dir.join("credential.json");
    let host = enrol_host(&path).unwrap();

    let waiting_handshake = sample_handshake();
    let code = "11".repeat(16);
    let nonce = "22".repeat(32);
    let mut key = [0u8; 16];
    let mut nonce_bytes = [0u8; 32];
    hex::decode_to_slice(&code, &mut key).unwrap();
    hex::decode_to_slice(&nonce, &mut nonce_bytes).unwrap();
    let seal = seal_computer(
        &key,
        &nonce_bytes,
        &Credential::from_hex(&"33".repeat(32)).unwrap(),
    );
    let delivery =
        Delivery::new(&"44".repeat(16), seal, UNIX_EPOCH + Duration::from_secs(60)).unwrap();
    let waiting =
        add_device_with_delivery(&path, "Waiting phone", &waiting_handshake, delivery).unwrap();
    let other = add_device(&path, "Other phone", &sample_handshake()).unwrap();

    forget_device(&path, other.id).unwrap();
    let devices = load_devices(&path).unwrap();
    assert!(
        devices.iter().find(|d| d.id == waiting.id).unwrap().waiting,
        "forgetting a different device must leave the waiting phone waiting"
    );

    let later = add_device(&path, "Later phone", &sample_handshake()).unwrap();
    let devices = load_devices(&path).unwrap();
    let by_id = |id: u32| devices.iter().find(|d| d.id == id).unwrap();
    assert!(
        by_id(waiting.id).waiting,
        "adding another device must leave the waiting phone waiting"
    );
    assert!(!by_id(host.id).waiting, "the host stays allowed throughout");
    assert!(!by_id(later.id).waiting, "a freshly added phone is allowed");
    fs::remove_dir_all(&dir).unwrap();
}
