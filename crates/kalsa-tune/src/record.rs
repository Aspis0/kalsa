//! What the tune kept: one file, one magic line, `key=value` lines — the
//! verdict's discipline, for a different question.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use kalsa_runtime::ServerBackend;

use crate::candidates::{offload_for, Candidate};
use crate::winner::{Outcome, Winner};

const MAGIC: &str = "kalsa-tune v1";
const FILE_NAME: &str = "tuning.txt";

/// A candidate's kept result: its best rate, or its refusal. The record
/// keeps the winning number, not every sample — the app shows the figure
/// it chose, and that figure is the best one that ran.
#[derive(Clone, Debug, PartialEq)]
pub enum Kept {
    Best(f64),
    Refused(String),
}

impl From<&Outcome> for Kept {
    fn from(outcome: &Outcome) -> Self {
        match outcome {
            Outcome::Refused(reason) => Self::Refused(reason.clone()),
            Outcome::Measured(_) => match outcome.best() {
                Some(rate) => Self::Best(rate),
                // A measurement with no usable sample proved nothing —
                // recorded as the refusal it functionally is, in words
                // that say which one it was.
                None => Self::Refused("unmeasured".into()),
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

/// Saves the record the way the verdict does: created fresh, written in one
/// call — a torn write reads as no record, which is the safe direction.
pub fn save(dir: &Path, record: &Record) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let mut file = fs::File::create(path(dir))?;
    let mut text = format!("{MAGIC}\nfingerprint={}\n", record.fingerprint);
    // The candidates come before the winner: a file cut mid-winner still
    // has a complete trial set to parse, so the truncation is the winner's
    // incompleteness and not an empty record.
    for (index, (candidate, kept)) in record.trials.iter().enumerate() {
        text.push_str(&format!(
            "candidate.{index}.backend={}\n",
            candidate.backend.name()
        ));
        if let Some(threads) = candidate.threads {
            text.push_str(&format!("candidate.{index}.threads={threads}\n"));
        }
        match kept {
            Kept::Best(rate) => text.push_str(&format!("candidate.{index}.best={rate}\n")),
            Kept::Refused(reason) => text.push_str(&format!(
                // A refusal reason is a sentence someone else wrote: one
                // line only, or it would desync the lines() parse below.
                "candidate.{index}.refused={}\n",
                reason.replace(['\n', '\r'], " ")
            )),
        }
    }
    if let Some(winner) = &record.winner {
        text.push_str(&format!("winner-backend={}\n", winner.candidate.backend.name()));
        if let Some(threads) = winner.candidate.threads {
            text.push_str(&format!("winner-threads={threads}\n"));
        }
        text.push_str(&format!("winner-best={}\n", winner.best));
    }
    file.write_all(text.as_bytes())?;
    file.flush()
}

/// The saved record, if it is ours, whole, and still this fingerprint.
/// A corrupt, truncated, foreign or stale file reads as `None`: no error
/// reaches the walk, the caller just keeps the rule.
pub fn load(dir: &Path, fingerprint: &str) -> Option<Record> {
    let text = fs::read_to_string(path(dir)).ok()?;
    if !text.starts_with(MAGIC) {
        return None;
    }
    let saved_fingerprint = line_value(&text, "fingerprint")?;
    if saved_fingerprint != fingerprint {
        return None;
    }
    // The winner is all-or-nothing: backend and best must both be there,
    // or the file was cut between them.
    let winner = match line_value(&text, "winner-backend") {
        None => None,
        Some(name) => {
            let backend = ServerBackend::from_name(name)?;
            Some(Winner {
                candidate: Candidate {
                    backend,
                    threads: numeric(&text, "winner-threads")?,
                    offload: offload_for(backend),
                },
                best: line_value(&text, "winner-best")?.parse().ok()?,
            })
        }
    };
    // Candidates 0..n, each complete: a gap or a half-line is a truncation,
    // and a file with a fingerprint but no trials is a cut one — a tune
    // always has candidates to have a result.
    let mut trials = Vec::new();
    let mut index = 0usize;
    loop {
        let prefix = format!("candidate.{index}.");
        let Some(name) = line_value(&text, &format!("{prefix}backend")) else {
            break;
        };
        let backend = ServerBackend::from_name(name)?;
        let kept = match line_value(&text, &format!("{prefix}best")) {
            Some(rate) => Kept::Best(rate.parse().ok()?),
            None => Kept::Refused(line_value(&text, &format!("{prefix}refused"))?.to_string()),
        };
        trials.push((
            Candidate { backend, threads: numeric(&text, &format!("{prefix}threads"))?, offload: offload_for(backend) },
            kept,
        ));
        index += 1;
    }
    if index == 0 {
        return None;
    }
    Some(Record { fingerprint: saved_fingerprint.to_string(), winner, trials })
}

/// An optional numeric value: absent is `None`, and a present value that
/// is not a number is a corrupt file, not a missing one.
fn numeric(text: &str, key: &str) -> Option<Option<usize>> {
    match line_value(text, key) {
        None => Some(None),
        Some(value) => Some(Some(value.parse().ok()?)),
    }
}

/// The value of `key=` on its own line: whole or absent.
fn line_value<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines()
        .find_map(|line| line.strip_prefix(key).and_then(|rest| rest.strip_prefix('=')))
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::candidates::offload_for;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-tune-record-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn sample() -> Record {
        let cpu16 = Candidate {
            backend: ServerBackend::Cpu,
            threads: Some(16),
            offload: offload_for(ServerBackend::Cpu),
        };
        let gpu = Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(16),
            offload: offload_for(ServerBackend::Vulkan),
        };
        Record {
            fingerprint: "sha-abc|ctx8192|machine".into(),
            winner: Some(Winner { candidate: gpu, best: 49.0 }),
            trials: vec![
                (gpu, Kept::Best(49.0)),
                (cpu16, Kept::Refused("it did not load".into())),
            ],
        }
    }

    #[test]
    fn a_record_survives_a_restart_with_the_same_fingerprint() {
        let dir = scratch("roundtrip");
        let record = sample();
        save(&dir, &record).expect("save");
        let loaded = load(&dir, &record.fingerprint).expect("load");
        assert_eq!(loaded, record);
        std::fs::remove_file(path(&dir)).expect("remove");
        assert_eq!(load(&dir, &record.fingerprint), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_changed_machine_or_model_reads_as_no_record() {
        let dir = scratch("fingerprint");
        let record = sample();
        save(&dir, &record).expect("save");
        assert_eq!(load(&dir, "sha-other|ctx8192|machine"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_file_reads_as_no_record() {
        let dir = scratch("corrupt");
        std::fs::create_dir_all(&dir).expect("mkdir");
        // Our magic, our key, and nothing behind it: a header without a
        // single trial is a record that cannot say what was measured.
        std::fs::write(
            path(&dir),
            format!("{MAGIC}\nfingerprint=anything\nthis is not a trial line\n"),
        )
        .expect("write");
        assert_eq!(load(&dir, "anything"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_truncated_file_reads_as_no_record() {
        let dir = scratch("truncated");
        save(&dir, &sample()).expect("save");
        let text = std::fs::read_to_string(path(&dir)).expect("read");
        let cut = text.find("winner-best=").expect("the sample has a winner");
        std::fs::write(path(&dir), &text[..cut]).expect("rewrite cut");
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_foreign_magic_reads_as_no_record() {
        let dir = scratch("foreign");
        save(&dir, &sample()).expect("save");
        // Our shape, another tool's magic: only the magic line stands
        // between this file and being believed.
        let text = std::fs::read_to_string(path(&dir)).expect("read");
        let foreign = text.replacen(MAGIC, "another-tool v7", 1);
        std::fs::write(path(&dir), foreign).expect("rewrite");
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
