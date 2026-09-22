//! T5b: the sweep. A directory read that removes exactly the files that
//! belong to nobody, at its two moments (door construction, set change) and
//! under its three rules: a present device's file is never touched, an
//! absent device's file goes, an unparseable name is left where it is.
//!
//! The test that makes the sweep safe to have is
//! `a_present_devices_files_are_never_touched`: without it a sweep that
//! deleted everything would pass every other test here.

use std::fs;
use std::path::Path;

use super::paging_support::{door_of, temp_dir, HASH};
use super::*;

/// The door's own name for any device — `paging_support::file_name` builds
/// device 0's only, and these tests need device 1's too.
fn name(device: u32, chat: &str) -> String {
    format!("d{device}-m{HASH}-c{chat}.bin")
}

fn staging(file: &str) -> String {
    format!("{file}.staging")
}

fn plant(dir: &Path, files: &[String]) {
    for file in files {
        fs::write(dir.join(file), format!("state of {file}")).unwrap();
    }
}

#[test]
fn a_file_of_a_device_that_left_the_set_is_deleted() {
    let dir = temp_dir("sweep-revoked");
    let (first, second) = (credential(), credential());
    let (door, _address) = door_of(1, Some(&dir), Some(HASH), &[&first, &second]);
    plant(&dir, &[name(0, "aaaa1111"), name(1, "aaaa1111")]);

    // Device 1 is revoked: its record leaves the set, and with it every file
    // whose name says `d1`.
    door.set_devices(door_devices(&[&first]));

    assert!(
        !dir.join(name(1, "aaaa1111")).exists(),
        "a revoked device's file survived the sweep"
    );
    assert!(
        dir.join(name(0, "aaaa1111")).exists(),
        "the sweep took a device that is still in the set"
    );
    door.shutdown();
}

#[test]
fn a_present_devices_files_are_never_touched() {
    let dir = temp_dir("sweep-present");
    let (first, second) = (credential(), credential());
    let (door, _address) = door_of(1, Some(&dir), Some(HASH), &[&first, &second]);
    // Three files of the device that stays: its chat file, the staging
    // sibling a save may be writing right now, and a file under an older
    // model's hash. The sweep judges by device alone — never by staleness
    // and never by model.
    let kept = [
        name(0, "aaaa1111"),
        staging(&name(0, "aaaa1111")),
        "d0-m00000000-caaaa1111.bin".to_string(),
    ];
    plant(&dir, &kept);

    // Only device 1 leaves — device 0 is in the set before and after.
    door.set_devices(door_devices(&[&first]));

    for file in &kept {
        assert_eq!(
            fs::read(dir.join(file)).unwrap(),
            format!("state of {file}").as_bytes(),
            "a present device's file was touched: {file}"
        );
    }
    door.shutdown();
}

#[test]
fn an_orphan_staging_file_of_a_revoked_device_is_deleted() {
    let dir = temp_dir("sweep-staging");
    let (first, second) = (credential(), credential());
    let (door, _address) = door_of(1, Some(&dir), Some(HASH), &[&first, &second]);
    // A save that died with the door: the staging file is never renamed and
    // nothing will ever name it again.
    plant(&dir, &[staging(&name(1, "aaaa1111"))]);

    door.set_devices(door_devices(&[&first]));

    assert!(
        !dir.join(staging(&name(1, "aaaa1111"))).exists(),
        "an orphan staging file of a revoked device survived the sweep"
    );
    door.shutdown();
}

#[test]
fn a_name_the_door_could_not_have_written_is_left_alone() {
    let dir = temp_dir("sweep-unknown");
    let (first, second) = (credential(), credential());
    let (door, _address) = door_of(1, Some(&dir), Some(HASH), &[&first, &second]);
    // Every one of these fails the parse that `file_name` + `valid_id`
    // define, so none can be attributed to any device — including the last
    // two, whose leading id is device 1's, the device being revoked here.
    // Rule: an unparseable name is not an orphan, it is unknown.
    let unknown = [
        "notes.txt".to_string(),
        "d1-ma1b2c3-caaaa1111.bin".to_string(), // the model is not eight wide
        "d1-mA1B2C3D4-cffff4444.bin".to_string(), // upper case: with_model_hash never wrote it
        "d01-ma1b2c3d4-caaaa1111.bin".to_string(), // Display never pads with a zero
        "d1-ma1b2c3d4-cab.bin".to_string(),       // a chat id the door would have refused
        "d9999999999999999999-ma1b2c3d4-caaaa1111.bin".to_string(), // past u32
        "leftover.staging".to_string(),           // a staging that is not one of ours
        name(1, "ab"),                            // device 1's real hash, chat id too short
    ];
    plant(&dir, &unknown);
    // The canary: one name that does parse, for the device that is gone.
    // Without it every assertion below would pass with the sweep not running
    // at all. Its chat id must differ from every unknown's beyond case: the
    // test disks are case-insensitive (APFS), where `d1-mA...` and `d1-ma...`
    // are one file and the canary would "survive" as somebody else's name.
    plant(&dir, &[name(1, "aaaa1111")]);

    door.set_devices(door_devices(&[&first]));

    assert!(
        !dir.join(name(1, "aaaa1111")).exists(),
        "the sweep did not run: the canary is still here"
    );
    for file in &unknown {
        assert!(
            dir.join(file).exists(),
            "an unparsable name was deleted: {file}"
        );
    }
    door.shutdown();
}

#[test]
fn two_devices_only_the_revoked_ones_files_go() {
    let dir = temp_dir("sweep-two");
    let (first, second) = (credential(), credential());
    let (door, _address) = door_of(1, Some(&dir), Some(HASH), &[&first, &second]);
    let gone = [name(1, "aaaa1111"), staging(&name(1, "bbbb2222"))];
    let kept = [name(0, "aaaa1111"), staging(&name(0, "bbbb2222"))];
    plant(&dir, &gone);
    plant(&dir, &kept);

    door.set_devices(door_devices(&[&first]));

    for file in &gone {
        assert!(!dir.join(file).exists(), "revoked device kept a file: {file}");
    }
    for file in &kept {
        assert!(dir.join(file).exists(), "present device lost a file: {file}");
    }
    door.shutdown();
}

#[test]
fn a_new_door_sweeps_what_the_last_run_left_behind() {
    let dir = temp_dir("sweep-construction");
    let token = credential();
    // Planted BEFORE the door exists: a revoked device's file no set change
    // will ever announce again, its orphan staging, and the kept device's
    // file. This is the sweep's first moment — construction.
    plant(
        &dir,
        &[
            name(3, "abcdefgh"),
            staging(&name(3, "abcdefgh")),
            name(0, "abcdefgh"),
        ],
    );

    let (door, _address) = door_of(1, Some(&dir), Some(HASH), &[&token]);

    assert!(
        !dir.join(name(3, "abcdefgh")).exists(),
        "a construction sweep left a dead device's file"
    );
    assert!(
        !dir.join(staging(&name(3, "abcdefgh"))).exists(),
        "a construction sweep left an orphan staging"
    );
    assert!(
        dir.join(name(0, "abcdefgh")).exists(),
        "the construction sweep took the present device's file"
    );
    door.shutdown();
}
