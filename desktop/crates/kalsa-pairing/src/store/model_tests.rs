use std::fs;
use std::path::PathBuf;
use std::time::{Duration, UNIX_EPOCH};

use kalsa_catalog::{Parameters, PhoneModel};

use super::{
    add_device, add_device_with_install, allow_device, enrol_host, load_devices, persist, replace,
    set_device_name, Delivery,
};
use crate::handshake::{Credential, Handshake};
use crate::messages::seal_computer;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-pairing-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn phone_naming(model: Option<&str>) -> Handshake {
    let phone = PhoneModel {
        weights_bytes: 2_200_000_000,
        parameters: Some(Parameters::mixture(7_600_000_000, 2_400_000_000)),
        measured_tokens_per_second: Some(9.5),
        battery_powered: Some(true),
    };
    Handshake::new(phone, Credential::generate().unwrap()).naming(model.map(str::to_owned))
}

fn a_delivery(token: &str) -> Delivery {
    let seal = seal_computer(
        &[0x31u8; 16],
        &[0x32u8; 32],
        &Credential::from_hex(&"33".repeat(32)).unwrap(),
    );
    Delivery::new(token, seal, UNIX_EPOCH + Duration::from_secs(60)).unwrap()
}

#[test]
fn a_declared_model_is_kept_cleaned_and_read_back() {
    let dir = scratch("model-kept");
    let path = dir.join("pairing.json");
    enrol_host(&path).unwrap();
    let handshake = phone_naming(Some("  iPhone\u{200B} 15 Pro Max  "));
    let added = add_device(&path, "Paired phone", &handshake).unwrap();

    assert_eq!(added.model.as_deref(), Some("iPhone 15 Pro Max"));
    let stored = load_devices(&path).unwrap();
    assert_eq!(stored[1].model.as_deref(), Some("iPhone 15 Pro Max"));
}

#[test]
fn a_phone_that_declares_no_model_reads_back_without_one() {
    let dir = scratch("model-absent");
    let path = dir.join("pairing.json");
    enrol_host(&path).unwrap();
    add_device(&path, "Paired phone", &phone_naming(None)).unwrap();

    assert!(load_devices(&path).unwrap()[1].model.is_none());
}

#[test]
fn a_model_that_cleans_to_nothing_is_no_model() {
    let dir = scratch("model-blank");
    let path = dir.join("pairing.json");
    enrol_host(&path).unwrap();
    add_device(&path, "Paired phone", &phone_naming(Some("\u{200B}   "))).unwrap();

    assert!(load_devices(&path).unwrap()[1].model.is_none());
}

#[test]
fn an_owner_name_leaves_the_declared_model_in_place() {
    let dir = scratch("model-and-name");
    let path = dir.join("pairing.json");
    enrol_host(&path).unwrap();
    let phone = add_device(&path, "Paired phone", &phone_naming(Some("Galaxy S23"))).unwrap();
    set_device_name(&path, phone.id, Some("Anna".to_string())).unwrap();

    let stored = load_devices(&path).unwrap();
    assert_eq!(stored[1].name.as_deref(), Some("Anna"));
    assert_eq!(stored[1].model.as_deref(), Some("Galaxy S23"));
}

#[test]
fn a_re_pair_that_names_no_model_keeps_the_one_it_had() {
    let dir = scratch("repair-keeps-model");
    let path = dir.join("pairing.json");
    let install = Some("d0".repeat(16));
    add_device_with_install(
        &path,
        "Paired phone",
        &phone_naming(Some("Pixel 8")),
        a_delivery(&"44".repeat(16)),
        install.as_deref(),
    )
    .unwrap();
    allow_device(&path, 0).unwrap();
    add_device_with_install(
        &path,
        "Paired phone 2",
        &phone_naming(None),
        a_delivery(&"55".repeat(16)),
        install.as_deref(),
    )
    .unwrap();
    allow_device(&path, 1).unwrap();

    let stored = load_devices(&path).unwrap();
    assert_eq!(stored.len(), 1, "the re-pair folds into its seat");
    assert_eq!(stored[0].model.as_deref(), Some("Pixel 8"));
}

#[test]
fn a_second_ceremony_while_the_first_still_waits_keeps_the_model_it_had() {
    let dir = scratch("waiting-keeps-model");
    let path = dir.join("pairing.json");
    let install = Some("d0".repeat(16));
    add_device_with_install(
        &path,
        "Paired phone",
        &phone_naming(Some("Pixel 8")),
        a_delivery(&"44".repeat(16)),
        install.as_deref(),
    )
    .unwrap();
    // The owner has not answered yet, so this ceremony takes the waiting
    // record's place, and says nothing about its model.
    add_device_with_install(
        &path,
        "Paired phone",
        &phone_naming(None),
        a_delivery(&"55".repeat(16)),
        install.as_deref(),
    )
    .unwrap();

    let stored = load_devices(&path).unwrap();
    assert_eq!(stored.len(), 1, "the waiting record is replaced, not doubled");
    assert!(stored[0].waiting);
    assert_eq!(stored[0].model.as_deref(), Some("Pixel 8"));
}

#[test]
fn a_re_pair_that_names_a_model_replaces_the_one_it_had() {
    let dir = scratch("repair-new-model");
    let path = dir.join("pairing.json");
    let install = Some("d0".repeat(16));
    add_device_with_install(
        &path,
        "Paired phone",
        &phone_naming(Some("Pixel 8")),
        a_delivery(&"44".repeat(16)),
        install.as_deref(),
    )
    .unwrap();
    allow_device(&path, 0).unwrap();
    add_device_with_install(
        &path,
        "Paired phone 2",
        &phone_naming(Some("Galaxy S23")),
        a_delivery(&"55".repeat(16)),
        install.as_deref(),
    )
    .unwrap();
    allow_device(&path, 1).unwrap();

    assert_eq!(load_devices(&path).unwrap()[0].model.as_deref(), Some("Galaxy S23"));
}

#[test]
fn a_replacement_without_a_model_keeps_the_one_it_had() {
    let dir = scratch("replace-keeps-model");
    let path = dir.join("pairing.json");
    persist(&phone_naming(Some("Pixel 8")), &path).unwrap();
    replace(&phone_naming(None), &path).unwrap();

    assert_eq!(load_devices(&path).unwrap()[0].model.as_deref(), Some("Pixel 8"));
}

#[test]
fn a_tag_private_use_or_unassigned_character_is_dropped_from_a_model_and_a_name() {
    let dir = scratch("label-invisible");
    let path = dir.join("pairing.json");
    enrol_host(&path).unwrap();
    // U+E0020 is a tag character (Cf), U+E000 private use (Co), and U+10FFFF
    // is unassigned (Cn): none of them is something a person can read.
    let phone = add_device(
        &path,
        "Paired phone",
        &phone_naming(Some("Pixel\u{E0020} 8\u{E000}\u{10FFFF}")),
    )
    .unwrap();
    assert_eq!(phone.model.as_deref(), Some("Pixel 8"));

    set_device_name(&path, phone.id, Some("Anna\u{E0020}\u{E000}\u{10FFFF}".to_string())).unwrap();
    let stored = load_devices(&path).unwrap();
    assert_eq!(stored[1].name.as_deref(), Some("Anna"));
    assert_eq!(stored[1].model.as_deref(), Some("Pixel 8"));
}
