//! The record's own tests: every clause of the reuse rule refused on its
//! own, the round trip, the lazy fact reading, and the save that must not
//! be fatal.

use super::*;
use kalsa_probe::{Backend, ExecutionPath, Reliability, Series};

/// The instant and the machine every record in these tests is judged
/// against, fixed so each clause fails alone and visibly.
const NOW: u64 = 1_800_000_000;
const RAM: u64 = 16 * 1024 * 1024 * 1024;
const THIRTY_DAYS: u64 = 30 * 24 * 60 * 60;

/// The machine's facts every record here is judged against.
fn facts() -> Facts {
    Facts {
        ram_bytes: RAM,
        backend: Backend::Cpu,
        chip: Some("a test chip".to_string()),
    }
}

fn measured(bandwidth: f64) -> Measurement {
    Measurement {
        ramp: vec![(2, bandwidth)],
        ceiling_bytes_per_second: bandwidth,
        decode_bytes_per_second: None,
        ceiling: Series::new(vec![bandwidth]),
        plateau_threads: 2,
        cache: Series::new(vec![200.0e9]),
        compute: Series::new(vec![100.0e9]),
        reliability: Reliability {
            reliable: true,
            effective_parallelism: None,
            threads: 2,
            spread: 0.0,
            cache_ratio: None,
            notes: Vec::new(),
        },
        measured_on: ExecutionPath::Cpu,
        will_run_on: Backend::Cpu,
    }
}

fn a_record() -> Record {
    Record {
        measurement: measured(80.0e9),
        taken_unix: NOW,
        opt_level: kalsa_probe::OPT_LEVEL.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        ram_bytes: RAM,
        chip: Some("a test chip".to_string()),
    }
}

fn time_of(unix: u64) -> SystemTime {
    UNIX_EPOCH + std::time::Duration::from_secs(unix)
}

fn scratch(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("kalsa-brain-measurement-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

/// Writes a record by hand — `save` stamps this machine's RAM and the
/// real clock, which the clauses must not depend on.
fn planted(dir: &Path, record: &Record) {
    std::fs::write(dir.join(FILE), serde_json::to_vec(record).expect("serialise"))
        .expect("write the record");
}

#[test]
fn a_fresh_matching_record_describes_this_machine() {
    assert!(describes_this_machine(&a_record(), NOW, &facts()));
}

#[test]
fn an_unreliable_reading_is_not_reused() {
    let mut record = a_record();
    record.measurement.reliability.reliable = false;
    assert!(!describes_this_machine(&record, NOW, &facts()));
}

#[test]
fn a_record_from_another_optimisation_level_is_not_reused() {
    let mut record = a_record();
    record.opt_level.push_str("-other");
    assert_ne!(record.opt_level, kalsa_probe::OPT_LEVEL);
    assert!(!describes_this_machine(&record, NOW, &facts()));
}

#[test]
fn a_record_from_another_app_version_is_not_reused() {
    let mut record = a_record();
    record.app_version = "0.0.0-other".to_string();
    assert!(!describes_this_machine(&record, NOW, &facts()));
}

#[test]
fn a_record_of_another_machine_s_ram_is_not_reused() {
    assert!(!describes_this_machine(&a_record(), NOW, &Facts { ram_bytes: RAM + 1, ..facts() }));
}

#[test]
fn a_record_older_than_thirty_days_is_not_reused() {
    let record = a_record();
    assert!(
        describes_this_machine(&record, NOW + THIRTY_DAYS, &facts()),
        "the thirtieth day itself is still this machine"
    );
    assert!(
        !describes_this_machine(&record, NOW + THIRTY_DAYS + 1, &facts()),
        "one second past thirty days is not"
    );
}

#[test]
fn a_record_dated_beyond_the_clock_skew_is_not_reused() {
    let mut record = a_record();
    record.taken_unix = NOW + CLOCK_SKEW_SECS;
    assert!(
        describes_this_machine(&record, NOW, &facts()),
        "an hour of skew is the allowance"
    );
    record.taken_unix += 1;
    assert!(
        !describes_this_machine(&record, NOW, &facts()),
        "more than an hour into the future is a clock mistake, not a record"
    );
}

#[test]
fn a_missing_torn_or_corrupt_record_reads_as_none_without_panicking() {
    let dir = scratch("absent");
    assert!(load(&dir).is_none(), "no file at all");
    std::fs::write(dir.join(FILE), b"{\"measurement\":").expect("write a torn record");
    assert!(load(&dir).is_none(), "a record cut mid-sentence");
    std::fs::write(dir.join(FILE), b"not json at all").expect("write garbage");
    assert!(load(&dir).is_none(), "bytes that are not the record");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_record_round_trips_and_leaves_no_temporary_behind() {
    let dir = scratch("round-trip");
    save(&measured(80.0e9), &dir, NOW, RAM);
    let loaded = load(&dir).expect("the record was just written");
    assert_eq!(loaded.measurement, measured(80.0e9));
    assert_eq!(loaded.taken_unix, NOW);
    assert_eq!(loaded.opt_level, kalsa_probe::OPT_LEVEL);
    assert_eq!(loaded.app_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(loaded.ram_bytes, RAM);
    assert_eq!(loaded.chip, kalsa_probe::brand_string());
    let names: Vec<std::ffi::OsString> = std::fs::read_dir(&dir)
        .expect("the directory is readable")
        .map(|entry| entry.expect("each entry").file_name())
        .collect();
    assert_eq!(
        names,
        [std::ffi::OsString::from(FILE)],
        "the directory holds the record and nothing else"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_unwritable_destination_is_not_fatal_and_leaves_no_record() {
    // The destination's parent is a regular FILE, so the write cannot
    // succeed on any machine. Asserted: no panic, and no record appears
    // in the one directory that does exist here.
    let dir = scratch("unwritable");
    let blocker = dir.join("not-a-directory");
    std::fs::write(&blocker, b"a regular file").expect("write the blocker");
    save(&measured(80.0e9), &blocker, NOW, RAM);
    let names: Vec<std::ffi::OsString> = std::fs::read_dir(&dir)
        .expect("the directory is readable")
        .map(|entry| entry.expect("each entry").file_name())
        .collect();
    assert_eq!(
        names,
        [std::ffi::OsString::from("not-a-directory")],
        "a record appeared despite the unwritable destination"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_record_of_another_backend_is_not_reused() {
    let mut record = a_record();
    record.measurement.will_run_on = Backend::Metal;
    assert!(!describes_this_machine(&record, NOW, &facts()));
}

#[test]
fn a_record_of_another_chip_with_the_same_ram_and_backend_is_not_reused() {
    let mut record = a_record();
    record.chip = Some("another chip".to_string());
    assert!(
        !describes_this_machine(&record, NOW, &facts()),
        "same RAM, same backend, a different machine's figures"
    );
}

#[test]
fn a_chip_no_platform_can_name_matches_on_both_sides() {
    let mut record = a_record();
    record.chip = None;
    assert!(
        describes_this_machine(&record, NOW, &Facts { chip: None, ..facts() }),
        "with no name to compare, RAM and backend are the whole identity"
    );
}

#[test]
fn the_machine_s_facts_are_read_only_when_a_record_exists() {
    let dir = scratch("lazy-facts");
    let reads = std::sync::atomic::AtomicUsize::new(0);
    let kept = Mutex::new(None);
    seed(&kept, &dir, time_of(NOW), || {
        reads.fetch_add(1, Ordering::Relaxed);
        facts()
    });
    assert_eq!(
        reads.load(Ordering::Relaxed),
        0,
        "no record on disk: no machine fact was read"
    );
    planted(&dir, &a_record());
    seed(&kept, &dir, time_of(NOW), || {
        reads.fetch_add(1, Ordering::Relaxed);
        facts()
    });
    assert_eq!(
        reads.load(Ordering::Relaxed),
        1,
        "a record exists: the facts were read exactly once"
    );
    assert!(
        kept.lock().expect("lock").is_some(),
        "and the matching record seeded"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_record_is_stamped_where_the_probe_finished_not_where_it_was_saved() {
    let dir = scratch("stamp");
    // A taken time far in the real past: if save stamped its own now
    // instead of carrying the walk's instant, the record would read fresh.
    let measured_at = 1_700_000_000;
    save(&measured(80.0e9), &dir, measured_at, RAM);
    let loaded = load(&dir).expect("the record was just written");
    assert_eq!(
        loaded.taken_unix, measured_at,
        "the stamp must be the probe's finish, not the save's moment"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn seed_fills_the_empty_slot_from_a_matching_record_only() {
    let dir = scratch("seed");
    planted(&dir, &a_record());
    let kept = Mutex::new(None);
    seed(&kept, &dir, time_of(NOW), || facts());
    assert_eq!(
        kept.lock().expect("lock").as_ref(),
        Some(&a_record().measurement),
        "a matching record seeds the empty slot"
    );

    // A record of another machine's RAM fills nothing.
    let mut other_ram = a_record();
    other_ram.ram_bytes += 1;
    planted(&dir, &other_ram);
    let unstated = Mutex::new(None);
    seed(&unstated, &dir, time_of(NOW), || facts());
    assert!(
        unstated.lock().expect("lock").is_none(),
        "a stale record leaves the slot to the walk"
    );

    // And a slot already holding a measurement is never overwritten.
    let mut mine = a_record();
    mine.measurement = measured(1.0e9);
    planted(&dir, &mine);
    let held = Mutex::new(Some(measured(2.0e9)));
    seed(&held, &dir, time_of(NOW), || facts());
    assert_eq!(
        held.lock().expect("lock").as_ref().map(|m| m.ceiling_bytes_per_second),
        Some(2.0e9),
        "the seed fills an empty slot; it does not replace a kept reading"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
