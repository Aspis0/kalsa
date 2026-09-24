//! The machine's measurement, written down: the figures, when they were
//! taken, by which build and optimisation level, on how much RAM and which
//! backend — so a launch of a machine that has not changed does not measure
//! again, and a record that no longer describes this machine is recognised
//! rather than trusted.
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

use kalsa_probe::{Backend, Measurement};

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
/// needs BESIDE the machine's current facts — read fresh at seed time, so
/// they are arguments, not fields — to decide whether these figures are
/// still THIS machine's.
#[derive(Serialize, Deserialize)]
struct Record {
    measurement: Measurement,
    taken_unix: u64,
    opt_level: String,
    app_version: String,
    ram_bytes: u64,
    /// The chip's marketing name where the platform names it — the same
    /// string the probe's own decode estimate is keyed on. No serde
    /// default: a record from before this field existed does not parse, and
    /// one re-measurement is the honest price of the tighter identity.
    chip: Option<String>,
}

/// The machine's facts as a record is judged against them, gathered by the
/// caller's closure only when a record exists — a first launch reads none.
pub(crate) struct Facts {
    pub(crate) ram_bytes: u64,
    pub(crate) backend: Backend,
    pub(crate) chip: Option<String>,
}

/// Fills the empty kept-measurement slot from the record, before any
/// turn-on can run. The machine's current facts are read lazily, only
/// after a record has been found to judge. A record that fails the reuse
/// rule leaves the slot empty, and the existing path measures as today.
///
/// Declared: the record is consulted only here, at startup — a hardware
/// change while the app stays open is not seen until the next launch.
pub(crate) fn seed(
    kept: &Mutex<Option<Measurement>>,
    dir: &Path,
    now: SystemTime,
    facts: impl FnOnce() -> Facts,
) {
    let Some(record) = load(dir) else {
        return;
    };
    let facts = facts();
    if !describes_this_machine(&record, now_unix(now), &facts) {
        return;
    }
    if let Ok(mut stored) = kept.lock() {
        if stored.is_none() {
            *stored = Some(record.measurement);
        }
    }
}

/// Writes the record for a measurement a walk just kept. The stamp and the
/// RAM arrive from the walk — the instant the probe finished and the RAM
/// the measured `Machine` was built with — because the save can land
/// minutes of download after the measurement, and the record's age must
/// count from the measurement. A failure is logged in words and swallowed:
/// the walk already answered, and the cost of a missing record is one
/// re-measurement at the next launch, not data.
pub(crate) fn save(measurement: &Measurement, dir: &Path, taken_unix: u64, ram_bytes: u64) {
    let record = Record {
        measurement: measurement.clone(),
        taken_unix,
        opt_level: kalsa_probe::OPT_LEVEL.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        ram_bytes,
        chip: kalsa_probe::brand_string(),
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
    // trap `options` guards against for the settings file. Two turn-ons
    // racing this save both measured a real machine; the last rename wins.
    let temporary = dir.join(format!(
        "{FILE}.tmp.{}.{}",
        std::process::id(),
        TEMPORARY_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    // A temp file in the SAME directory, then a rename: the rename never
    // crosses a filesystem, and no reader ever sees a half-written record.
    // Declared, not proven: no test exercises the rename's atomicity, and a
    // crash between the write and the rename leaves the temp behind —
    // nothing sweeps it, because a sweep before the instance lock could
    // delete a live instance's temp.
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
fn describes_this_machine(record: &Record, now_unix: u64, facts: &Facts) -> bool {
    // The probe's own verdict: a reading it distrusts never seeds a walk.
    record.measurement.is_reliable()
        // The optimisation level changes the reading itself — by nineteen
        // times, once — so other-level figures are another build's machine.
        && record.opt_level == kalsa_probe::OPT_LEVEL
        // A new app version may measure or judge differently; it re-measures.
        && record.app_version == env!("CARGO_PKG_VERSION")
        // The RAM is half the budget: different memory is a different machine.
        && record.ram_bytes == facts.ram_bytes
        // The backend and the chip's own name are the rest of the identity:
        // every Apple Silicon Mac is `Backend::Metal`, so RAM and backend
        // alone would let a copied home directory run another Mac's figures
        // for a month. Where the platform cannot name its chip, None equals
        // None and RAM + backend is all the identity there is.
        && record.measurement.will_run_on == facts.backend
        && record.chip == facts.chip
        // Older than thirty days is a machine we no longer know.
        && now_unix.saturating_sub(record.taken_unix) <= MAX_AGE_SECS
        // Dated beyond the skew allowance is a clock mistake, not a record.
        && record.taken_unix <= now_unix.saturating_add(CLOCK_SKEW_SECS)
}

static TEMPORARY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Seconds since the epoch, 0 before it (an absurd clock): the record's
/// one time format, shared with the walk that stamps the probe's finish.
pub(crate) fn now_unix(now: SystemTime) -> u64 {
    now.duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
