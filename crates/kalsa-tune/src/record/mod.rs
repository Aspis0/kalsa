//! What the tune kept: one file, one magic line, `key=value` lines — the
//! verdict's discipline, for a different question, and stricter about the
//! file's shape: a torn record must read as no record, never as a smaller
//! truth.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use kalsa_launch::Offload;
use kalsa_runtime::ServerBackend;

use crate::candidates::Candidate;
use crate::winner::{Outcome, Refusal, Winner};

const MAGIC: &str = "kalsa-tune v1";

/// The record's key: everything whose change must force a re-tune. Opaque —
/// save and load only compare it — and one function, so the walk, the tune
/// and the real walk can never compose it differently. The two engine
/// strings come from `kalsa_runtime::fingerprint` (the verdict's own
/// format: build digests | OS | detected backend | driver version), so a
/// new engine build, a new driver or a different card moves the key even
/// when the model and the context stand still.
pub fn fingerprint(
    model_digest: &str,
    context_tokens: u64,
    physical_cores: Option<usize>,
    logical_cores: Option<usize>,
    engine_builds: (&str, &str),
) -> String {
    format!(
        "kalsa-tune fp v1|model={model_digest}|ctx={context_tokens}|physical={physical_cores:?}|\
         logical={logical_cores:?}|graphics={}|processor={}",
        engine_builds.0, engine_builds.1
    )
}
/// The winner as the file holds it, field by field until every line has
/// arrived: backend, offload, threads (optional), best.
type WinnerLine = (ServerBackend, Option<Offload>, Option<usize>, Option<f64>);
const FILE_NAME: &str = "tuning.txt";

/// A candidate's kept result: its best rate, or its refusal. The record
/// keeps the winning number, not every sample — the app shows the figure
/// it chose, and that figure is the best one that ran.
#[derive(Clone, Debug, PartialEq)]
pub enum Kept {
    Best(f64),
    Refused(Refusal),
}

impl From<&Outcome> for Kept {
    fn from(outcome: &Outcome) -> Self {
        match outcome {
            Outcome::Refused(refusal) => Self::Refused(*refusal),
            Outcome::Measured(_) => match outcome.best() {
                Some(rate) => Self::Best(rate),
                // A measurement with no usable sample proved nothing —
                // kept as the closed cause it functionally is.
                None => Self::Refused(Refusal::NoUsableAnswer),
            },
        }
    }
}

/// One tune's result, kept until the fingerprint moves: the winner with its
/// number, and every candidate's number or refusal — the app must show the
/// number it chose, so the trials travel with the choice.
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    /// The caller's opaque key (model digest, engine builds, context,
    /// machine): this crate only compares it and never parses it. A
    /// mismatch reads as no record at all.
    pub fingerprint: String,
    pub winner: Option<Winner>,
    pub trials: Vec<(Candidate, Kept)>,
}

/// The shape `load` accepts, checked before anything is written: a save
/// that could only ever read back as "no record" is this side's bug, not
/// the reader's to catch. A refusal is `InvalidInput` and touches nothing
/// on disk — a failed save leaves the predecessor in place.
fn validate(record: &Record) -> io::Result<()> {
    fn reject(why: &str) -> io::Result<()> {
        Err(io::Error::new(io::ErrorKind::InvalidInput, why))
    }
    if record.fingerprint.is_empty() || record.fingerprint.contains(['\n', '\r']) {
        return reject("a fingerprint is one non-empty line: the file is line-shaped");
    }
    if record.trials.is_empty() {
        return reject("a record without trials reads as no record");
    }
    // The builder de-duplicates candidates; a record listing one launch
    // twice describes an experiment that never ran as written.
    let mut seen = std::collections::HashSet::new();
    for (candidate, _) in &record.trials {
        let identity = (
            candidate.backend.name(),
            candidate.threads,
            offload_name(candidate.offload),
        );
        if !seen.insert(identity) {
            return reject("two trials of one launch: the list is de-duplicated");
        }
    }
    for (candidate, kept) in &record.trials {
        if candidate.threads == Some(0) {
            return reject("a thread count of zero is not a count anyone ran");
        }
        if let Kept::Best(rate) = kept {
            if !rate.is_finite() || *rate <= 0.0 {
                return reject("a best must be a positive, finite rate");
            }
        }
    }
    if let Some(winner) = &record.winner {
        if !trial_holds(&record.trials, &winner.candidate, winner.best) {
            return reject("the winner must be one of the record's own trials");
        }
    }
    Ok(())
}

/// The winner is a trial of this record with the same number — the one
/// rule, used by both sides, so `save` cannot write what `load` refuses.
fn trial_holds(trials: &[(Candidate, Kept)], candidate: &Candidate, best: f64) -> bool {
    trials.iter().any(|(trial, kept)| {
        *trial == *candidate && matches!(kept, Kept::Best(rate) if *rate == best)
    })
}

/// Saves the record atomically: a temp file in the same directory, renamed
/// over the old one. A crash mid-write therefore leaves the predecessor
/// whole (or no record at all on the first save) — never a truncated file
/// that could parse as a smaller truth.
pub fn save(dir: &Path, record: &Record) -> io::Result<()> {
    validate(record)?;
    fs::create_dir_all(dir)?;
    let mut text = format!("{MAGIC}\nfingerprint={}\n", record.fingerprint);
    for (index, (candidate, kept)) in record.trials.iter().enumerate() {
        text.push_str(&format!("candidate.{index}.backend={}\n", candidate.backend.name()));
        if let Some(threads) = candidate.threads {
            text.push_str(&format!("candidate.{index}.threads={threads}\n"));
        }
        text.push_str(&format!(
            "candidate.{index}.offload={}\n",
            offload_name(candidate.offload)
        ));
        match kept {
            Kept::Best(rate) => text.push_str(&format!("candidate.{index}.best={rate}\n")),
            Kept::Refused(refusal) => text.push_str(&format!(
                "candidate.{index}.refused={}\n",
                refusal_name(*refusal)
            )),
        }
    }
    if let Some(winner) = &record.winner {
        text.push_str(&format!("winner-backend={}\n", winner.candidate.backend.name()));
        text.push_str(&format!(
            "winner-offload={}\n",
            offload_name(winner.candidate.offload)
        ));
        if let Some(threads) = winner.candidate.threads {
            text.push_str(&format!("winner-threads={threads}\n"));
        }
        text.push_str(&format!("winner-best={}\n", winner.best));
    }
    // The end marker is the truncation guard: every cut this format can
    // suffer lands before it, and a record without it is a record we do
    // not have.
    text.push_str("end\n");
    let temp = temp_path(dir);
    // A create failure is the one early return past this point, and it is
    // safe: no file of ours exists yet (this code never removes a path it
    // did not just make). Every path AFTER the create — write, flush,
    // rename — reports through `result`, never through `?`, because a `?`
    // would return and leave this save's partial temp behind; one cleanup
    // below owns them all.
    let mut file = fs::File::create(&temp)?;
    let staged = file.write_all(text.as_bytes()).and_then(|()| file.flush());
    drop(file); // closed before the rename: nobody may hold the temp open
    let result = match staged {
        Ok(()) => fs::rename(&temp, path(dir)),
        Err(error) => Err(error),
    };
    if let Err(error) = result {
        // Whatever failed, THIS save's temp is this save's to clean — by
        // its own unique name, never another save's half-written file.
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(())
}

/// One temp name per save: the pid separates processes, the counter
/// separates saves inside one — two concurrent saves must never truncate
/// or rename each other's half-written file.
fn temp_path(dir: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let serial = COUNTER.fetch_add(1, Ordering::Relaxed);
    dir.join(format!("{FILE_NAME}.{}.{}.tmp", std::process::id(), serial))
}

/// The saved record, if it is ours, whole, valid, and still this
/// fingerprint. A corrupt, truncated, foreign or stale file reads as
/// `None`: no error reaches the walk, the caller just keeps the rule.
pub fn load(dir: &Path, fingerprint: &str) -> Option<Record> {
    let text = fs::read_to_string(path(dir)).ok()?;
    let mut lines = text.lines();
    // The magic must be the WHOLE first line: `kalsa-tune v10` is not
    // `kalsa-tune v1`, and a version we do not know is not ours.
    if lines.next()? != MAGIC {
        return None;
    }
    let mut saved_fingerprint: Option<&str> = None;
    let mut trials: Vec<(Candidate, Kept)> = Vec::new();
    // The candidate being read: fields arrive in the order save writes
    // them (backend, threads?, offload, then exactly one of best/refused)
    // and only for the next index in line.
    let mut open: Option<(ServerBackend, Option<usize>, Option<Offload>)> = None;
    let mut kept: Option<Kept> = None;
    let mut winner: Option<WinnerLine> = None;
    let mut saw_end = false;
    for line in lines {
        if saw_end {
            return None; // nothing may follow `end`
        }
        if line == "end" {
            // A candidate still open at the end never finished — only a
            // hand writes that, and the record it would claim is shorter
            // than the file pretends.
            if open.is_some() {
                return None;
            }
            saw_end = true;
            continue;
        }
        let (key, value) = line.split_once('=')?;
        if let Some(rest) = key.strip_prefix("candidate.") {
            let (index, field) = rest.split_once('.')?;
            if index.parse::<usize>().ok()? != trials.len() {
                return None; // out of line: not the next candidate this file wrote
            }
            match field {
                "backend" => {
                    if open.is_some() || kept.is_some() {
                        return None;
                    }
                    open = Some((ServerBackend::from_name(value)?, None, None));
                }
                "threads" => {
                    let slot = open.as_mut()?;
                    if slot.1.is_some() || slot.2.is_some() || kept.is_some() {
                        return None;
                    }
                    slot.1 = Some(parse_count(value)?);
                }
                "offload" => {
                    let slot = open.as_mut()?;
                    if slot.2.is_some() || kept.is_some() {
                        return None;
                    }
                    slot.2 = Some(offload_from_name(value)?);
                }
                "best" | "refused" => {
                    if kept.is_some() {
                        return None;
                    }
                    let slot = open.as_ref()?;
                    slot.2?; // the offload line must have come first
                    kept = Some(if field == "best" {
                        Kept::Best(parse_rate(value)?)
                    } else {
                        Kept::Refused(refusal_from_name(value)?)
                    });
                }
                _ => return None,
            }
            if kept.is_some() {
                let (backend, threads, offload) = open.take()?;
                let candidate = Candidate { backend, threads, offload: offload? };
                if trials.iter().any(|(other, _)| *other == candidate) {
                    // The builder de-duplicates: a file that does not is a
                    // file from something else wearing our shape.
                    return None;
                }
                trials.push((candidate, kept.take()?));
            }
            continue;
        }
        if open.is_some() || kept.is_some() {
            return None; // a candidate must finish before any other key
        }
        match key {
            "fingerprint"
                if saved_fingerprint.is_none() && trials.is_empty() && winner.is_none() =>
            {
                saved_fingerprint = Some(value);
            }
            "winner-backend" if winner.is_none() => {
                winner = Some((ServerBackend::from_name(value)?, None, None, None));
            }
            "winner-offload" if winner.as_ref().is_some_and(|slot| slot.1.is_none()) => {
                winner.as_mut()?.1 = Some(offload_from_name(value)?);
            }
            "winner-threads"
                if winner
                    .as_ref()
                    .is_some_and(|slot| slot.1.is_some() && slot.2.is_none() && slot.3.is_none()) =>
            {
                winner.as_mut()?.2 = Some(parse_count(value)?);
            }
            "winner-best" if winner.as_ref().is_some_and(|slot| slot.3.is_none()) => {
                winner.as_mut()?.3 = Some(parse_rate(value)?);
            }
            _ => return None,
        }
    }
    // The whole file must have been there: the end marker, its key, at
    // least one trial — and when a winner started, every field it needs.
    if !saw_end || saved_fingerprint.is_none() || trials.is_empty() {
        return None;
    }
    if saved_fingerprint? != fingerprint {
        return None;
    }
    let winner = match winner {
        None => None,
        Some((backend, offload, threads, best)) => {
            let offload = offload?;
            let best = best?;
            let candidate = Candidate { backend, threads, offload };
            // A file whose winner cannot be found among its own candidates
            // is a file that lost its middle.
            if !trial_holds(&trials, &candidate, best) {
                return None;
            }
            Some(Winner { candidate, best })
        }
    };
    Some(Record { fingerprint: saved_fingerprint?.to_string(), winner, trials })
}

/// A rate the record may hold: a positive, finite number. Anything else
/// is not a measurement, whatever the file claims.
fn parse_rate(value: &str) -> Option<f64> {
    let rate = value.parse::<f64>().ok()?;
    (rate.is_finite() && rate > 0.0).then_some(rate)
}

/// A thread count the record may hold: a positive integer, whatever the
/// file claims.
fn parse_count(value: &str) -> Option<usize> {
    let count = value.parse::<usize>().ok()?;
    (count > 0).then_some(count)
}

/// The record's name for each offload. An exhaustive match: a new variant
/// in `kalsa-launch` becomes a compile error here rather than a record
/// nobody can read back.
fn offload_name(offload: Offload) -> &'static str {
    match offload {
        Offload::All => "all",
        Offload::EngineFitted => "engine-fitted",
        Offload::ForcedOff => "forced-off",
        Offload::NoGpuBuild => "no-gpu-build",
    }
}

/// The record's name for each cause: an exhaustive match, so a new variant
/// becomes a compile error here rather than a record nobody reads back.
fn refusal_name(refusal: Refusal) -> &'static str {
    match refusal {
        Refusal::DidNotStart => "did-not-start",
        Refusal::NotReady => "not-ready",
        Refusal::NoUsableAnswer => "no-usable-answer",
    }
}

fn refusal_from_name(name: &str) -> Option<Refusal> {
    match name {
        "did-not-start" => Some(Refusal::DidNotStart),
        "not-ready" => Some(Refusal::NotReady),
        "no-usable-answer" => Some(Refusal::NoUsableAnswer),
        _ => None,
    }
}

fn offload_from_name(name: &str) -> Option<Offload> {
    match name {
        "all" => Some(Offload::All),

        "engine-fitted" => Some(Offload::EngineFitted),
        "forced-off" => Some(Offload::ForcedOff),
        "no-gpu-build" => Some(Offload::NoGpuBuild),
        _ => None,
    }
}

/// Throw the record away: the tuned launch just failed where the rule
/// succeeded, so whatever this file said is not what this machine wants —
/// the next start must measure again. Best effort: no record is already
/// the goal, and a missing file is not an error anyone should see.
pub fn invalidate(dir: &Path) {
    let _ = fs::remove_file(path(dir));
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

#[cfg(test)]
mod tests;
