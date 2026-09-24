//! The machine's measurement, written down: the figures, when they were
//! taken, by which build and optimisation level, on how much RAM — so a
//! launch of a machine that has not changed does not measure again, and a
//! record that no longer describes this machine is recognised rather than
//! trusted.
//!
//! The in-memory `Mutex<Option<Measurement>>` in `main` stays the one
//! source the walk reads; this module only seeds that slot at startup and
//! refreshes the file after a walk measures. A record that fails any
//! clause of the reuse rule is ignored, never deleted — the next
//! measurement overwrites it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use kalsa_probe::Measurement;

use crate::startup;

/// The record's file, beside the app's other state files.
const FILE: &str = "measurement.json";
/// How old a record may be and still stand for this machine: long enough
/// that an unchanged machine is not re-measured at every launch, short
/// enough that a machine swapped under the same home directory does not
/// run on last quarter's figures.
const MAX_AGE_SECS: u64 = 30 * 24 * 60 * 60;
/// How far into the future a record's date may sit. The allowance is a
/// small clock skew between reads and writes of the same file, not a
/// mistaken clock: an hour is far beyond NTP's drift and far below a day.
const CLOCK_SKEW_SECS: u64 = 60 * 60;

/// What [`seed`] accepts and [`save`] writes. Everything a later launch
/// needs to decide whether these figures are still THIS machine's.
#[derive(Serialize, Deserialize)]
struct Record {
    measurement: Measurement,
    taken_unix: u64,
    opt_level: String,
    app_version: String,
    ram_bytes: u64,
}

/// Fills the empty kept-measurement slot from the record, before any
/// turn-on can run. A record that fails the reuse rule leaves the slot
/// empty, and the existing path measures as today; `now` and `ram_bytes`
/// arrive as facts from the caller so the rule is testable.
pub(crate) fn seed(
    kept: &Mutex<Option<Measurement>>,
    dir: &Path,
    now: SystemTime,
    ram_bytes: u64,
) {
    let Some(record) = load(dir) else {
        return;
    };
    if !describes_this_machine(&record, now_unix(now), ram_bytes) {
        return;
    }
    if let Ok(mut stored) = kept.lock() {
        if stored.is_none() {
            *stored = Some(record.measurement);
        }
    }
}

/// Writes the record for the measurement a walk just kept. A failure is
/// logged in words and swallowed: the walk already answered, and the cost
/// of a missing record is one re-measurement at the next launch, not data.
pub(crate) fn save(measurement: &Measurement, dir: &Path) {
    let record = Record {
        measurement: measurement.clone(),
        taken_unix: now_unix(SystemTime::now()),
        opt_level: kalsa_probe::OPT_LEVEL.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        ram_bytes: startup::ram_bytes(),
    };
    let bytes = match serde_json::to_vec_pretty(&record) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("kalsa-brain: the measurement could not be recorded: {error}");
            return;
        }
    };
    let path = dir.join(FILE);
    // Distinct temporary names, one per save: two saves sharing a temporary
    // could interleave their writes and publish a torn record — the same
    // trap `options` guards against for the settings file.
    let temporary = dir.join(format!(
        "{FILE}.tmp.{}.{}",
        std::process::id(),
        TEMPORARY_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    // A temp file in the SAME directory, then a rename: the rename never
    // crosses a filesystem, and no reader ever sees a half-written record.
    let written = (|| -> std::io::Result<()> {
        std::fs::write(&temporary, bytes)?;
        std::fs::rename(&temporary, &path)
    })();
    if let Err(error) = written {
        let _ = std::fs::remove_file(&temporary);
        eprintln!(
            "kalsa-brain: the measurement could not be recorded, so the next launch will \
             measure again: {error}"
        );
    }
}

/// The record on disk, or `None` when there is nothing usable there — no
/// file, or bytes that are not the record. Neither is an error (the walk
/// measures) and neither deletes anything.
fn load(dir: &Path) -> Option<Record> {
    let bytes = std::fs::read(dir.join(FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// The reuse rule, one line of why per clause: every term here is a way a
/// record can stop describing this machine, and each is refused on its own.
fn describes_this_machine(record: &Record, now_unix: u64, ram_bytes: u64) -> bool {
    // The probe's own verdict: a reading it distrusts never seeds a walk.
    record.measurement.is_reliable()
        // The optimisation level changes the reading itself — by nineteen
        // times, once — so other-level figures are another build's machine.
        && record.opt_level == kalsa_probe::OPT_LEVEL
        // A new app version may measure or judge differently; it re-measures.
        && record.app_version == env!("CARGO_PKG_VERSION")
        // The RAM is half the budget: different memory is a different machine.
        && record.ram_bytes == ram_bytes
        // Older than thirty days is a machine we no longer know.
        && now_unix.saturating_sub(record.taken_unix) <= MAX_AGE_SECS
        // Dated beyond the skew allowance is a clock mistake, not a record.
        && record.taken_unix <= now_unix.saturating_add(CLOCK_SKEW_SECS)
}

static TEMPORARY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn now_unix(now: SystemTime) -> u64 {
    now.duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_probe::{Backend, ExecutionPath, Reliability, Series};

    /// The instant and the machine every record in these tests is judged
    /// against, fixed so each clause fails alone and visibly.
    const NOW: u64 = 1_800_000_000;
    const RAM: u64 = 16 * 1024 * 1024 * 1024;
    const THIRTY_DAYS: u64 = 30 * 24 * 60 * 60;

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
        assert!(describes_this_machine(&a_record(), NOW, RAM));
    }

    #[test]
    fn an_unreliable_reading_is_not_reused() {
        let mut record = a_record();
        record.measurement.reliability.reliable = false;
        assert!(!describes_this_machine(&record, NOW, RAM));
    }

    #[test]
    fn a_record_from_another_optimisation_level_is_not_reused() {
        let mut record = a_record();
        record.opt_level.push_str("-other");
        assert_ne!(record.opt_level, kalsa_probe::OPT_LEVEL);
        assert!(!describes_this_machine(&record, NOW, RAM));
    }

    #[test]
    fn a_record_from_another_app_version_is_not_reused() {
        let mut record = a_record();
        record.app_version = "0.0.0-other".to_string();
        assert!(!describes_this_machine(&record, NOW, RAM));
    }

    #[test]
    fn a_record_of_another_machine_s_ram_is_not_reused() {
        assert!(!describes_this_machine(&a_record(), NOW, RAM + 1));
    }

    #[test]
    fn a_record_older_than_thirty_days_is_not_reused() {
        let record = a_record();
        assert!(
            describes_this_machine(&record, NOW + THIRTY_DAYS, RAM),
            "the thirtieth day itself is still this machine"
        );
        assert!(
            !describes_this_machine(&record, NOW + THIRTY_DAYS + 1, RAM),
            "one second past thirty days is not"
        );
    }

    #[test]
    fn a_record_dated_beyond_the_clock_skew_is_not_reused() {
        let mut record = a_record();
        record.taken_unix = NOW + CLOCK_SKEW_SECS;
        assert!(
            describes_this_machine(&record, NOW, RAM),
            "an hour of skew is the allowance"
        );
        record.taken_unix += 1;
        assert!(
            !describes_this_machine(&record, NOW, RAM),
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
        save(&measured(80.0e9), &dir);
        let loaded = load(&dir).expect("the record was just written");
        assert_eq!(loaded.measurement, measured(80.0e9));
        assert_eq!(loaded.opt_level, kalsa_probe::OPT_LEVEL);
        assert_eq!(loaded.app_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(loaded.ram_bytes, startup::ram_bytes());
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
    fn a_save_that_cannot_write_is_logged_not_fatal() {
        // Not panicking is the whole assertion; the reason goes to the log.
        save(&measured(80.0e9), Path::new("/nonexistent-kalsa/record"));
    }

    #[test]
    fn seed_fills_the_empty_slot_from_a_matching_record_only() {
        let dir = scratch("seed");
        planted(&dir, &a_record());
        let kept = Mutex::new(None);
        seed(&kept, &dir, time_of(NOW), RAM);
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
        seed(&unstated, &dir, time_of(NOW), RAM);
        assert!(
            unstated.lock().expect("lock").is_none(),
            "a stale record leaves the slot to the walk"
        );

        // And a slot already holding a measurement is never overwritten.
        let mut mine = a_record();
        mine.measurement = measured(1.0e9);
        planted(&dir, &mine);
        let held = Mutex::new(Some(measured(2.0e9)));
        seed(&held, &dir, time_of(NOW), RAM);
        assert_eq!(
            held.lock().expect("lock").as_ref().map(|m| m.ceiling_bytes_per_second),
            Some(2.0e9),
            "the seed fills an empty slot; it does not replace a kept reading"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
