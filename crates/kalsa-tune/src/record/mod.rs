//! What the tune kept: one file per model, one magic line, `key=value`
//! lines — the verdict's discipline, for a different question, and
//! stricter about the file's shape: a torn record must read as no record,
//! never as a smaller truth.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use kalsa_launch::Offload;
use kalsa_runtime::ServerBackend;

use crate::candidates::Candidate;
use crate::refusal::Refusal;
use crate::score::{reply_seconds, Reply, Winner};

const MAGIC: &str = "kalsa-tune v6";

/// One record per model, filed under the model digest the key names. The
/// single `tuning.txt` this replaces could hold one tune, so a second
/// model's save erased the first. The digest is the caller's own pinned
/// sha256 — the same identity the fingerprint embeds, handed to the store
/// instead of parsed out of it — and must be lowercase hex, the catalog's
/// pinned form: a name pieced from anything else is a path nobody meant
/// to make, so no file is touched at all.
fn path(dir: &Path, model_digest: &str) -> Option<PathBuf> {
    let hex = !model_digest.is_empty()
        && model_digest
            .bytes()
            .all(|byte| matches!(byte, b'a'..=b'f' | b'0'..=b'9'));
    hex.then(|| dir.join(format!("tuning-{model_digest}.txt")))
}

/// Whether a fingerprint names this model: the key's own format carries
/// the digest in its `model=` field (see [`fingerprint`]). The one place
/// the store looks inside the key, and only ever for the legacy file,
/// whose name cannot say whose record it holds.
fn names_model(fingerprint: &str, model_digest: &str) -> bool {
    fingerprint
        .split('|')
        .any(|field| field == format!("model={model_digest}"))
}

/// The store this store replaces, kept only as a fallback so a record
/// written before the split keeps serving its model until its next re-tune
/// files the new name.
fn legacy_path(dir: &Path) -> PathBuf {
    dir.join("tuning.txt")
}

/// The record's key: everything whose change must force a re-tune. Opaque —
/// save and load only compare it — and one function, so the walk, the tune
/// and the real walk can never compose it differently. The two engine
/// strings come from `kalsa_runtime::fingerprint` (the verdict's own
/// format: build digests | OS | detected backend | driver version), so a
/// new engine build, a new driver or a different card moves the key even
/// when the model and the context stand still.
///
/// `context_per_slot` is the window ONE SLOT is given, not the launch's
/// total: the engine divides `--ctx-size` by `--parallel`, so the per-slot
/// window is the shape a candidate is measured at, and a device paired or
/// forgotten — a seat more or fewer at the same window — must not move the
/// key. A record written before the split at one slot carries the same
/// number this argument does, so it still answers.
///
/// The version inside the key counts the SCORING RULE, not the file
/// grammar: the decode-first tie-break and the no-dominated-winners rule
/// chose different winners over identical lines, so a record saved before
/// them was chosen under a rule this build no longer applies — moving the
/// key re-measures every machine exactly once. The grammar is unchanged,
/// which is why MAGIC stays `kalsa-tune v6`: an old file must still PARSE
/// and simply miss the new key — never read as foreign and lost blind.
pub fn fingerprint(
    model_digest: &str,
    context_per_slot: u64,
    physical_cores: Option<usize>,
    logical_cores: Option<usize>,
    engine_builds: (&str, &str),
    drafter: Option<&str>,
) -> String {
    format!(
        "kalsa-tune fp v4|model={model_digest}|ctx={context_per_slot}|physical={physical_cores:?}|\
         logical={logical_cores:?}|graphics={}|processor={}|draft={}",
        engine_builds.0,
        engine_builds.1,
        drafter.unwrap_or("none")
    )
}
/// The winner as the file holds it, field by field until every line has
/// arrived: backend, offload, threads (optional), draft (optional), and
/// the three numbers of its reply.
struct WinnerLine {
    backend: ServerBackend,
    offload: Option<Offload>,
    threads: Option<usize>,
    draft: Option<u32>,
    prompt_rate: Option<f64>,
    decode_rate: Option<f64>,
    seconds: Option<f64>,
}

/// A candidate's kept result: the room's reply it measured, or the closed
/// cause that kept any number out.
#[derive(Clone, Debug, PartialEq)]
pub enum Kept {
    /// The trial's three numbers: the shape's prefill, the trial's own
    /// decode, and the wait they make. The shape's own off setting is one
    /// of these, measured in the shape's first lifetime; the drafted
    /// settings are the others, each on its own lifetime.
    Replied(Reply),
    /// No number, and the closed cause. The prompt rate rides along when
    /// the shape's first lifetime had measured one, so a trial that failed
    /// after the room ask still says what the shape's history cost.
    Refused {
        refusal: Refusal,
        prompt_rate: Option<f64>,
    },
}

/// The trials as a callback receives them: one kept result per launch —
/// the shape [`crate::plan_prior`] filters, the passes report after every
/// finished lifetime and the checkpoint persists.
pub type Trials = [(Candidate, Kept)];

/// One tune's result, kept until the fingerprint moves: the winner with
/// its reply, and every candidate's own numbers or cause — the app must
/// show the wait it chose, so the trials travel with the choice. An
/// unfinished tune — cut by the budget, never finished, or all-refused —
/// is written as a marker file instead (see [`save_marker`]): the same
/// lines plus one, and `load` refuses it.
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
            candidate.draft,
        );
        if !seen.insert(identity) {
            return reject("two trials of one launch: the list is de-duplicated");
        }
    }
    for (candidate, kept) in &record.trials {
        if candidate.threads == Some(0) {
            return reject("a thread count of zero is not a count anyone ran");
        }
        match kept {
            Kept::Replied(reply) if !reply_is_sound(reply) => {
                return reject("a reply must be its own rates' positive, finite score");
            }
            Kept::Refused {
                prompt_rate: Some(prompt_rate),
                ..
            } if !rate_is_sound(*prompt_rate) => {
                return reject("a prefill rate must be positive and finite");
            }
            _ => {}
        }
    }
    if let Some(winner) = &record.winner {
        if !trial_holds(&record.trials, &winner.candidate, &winner.reply) {
            return reject("the winner must be one of the record's own trials");
        }
    }
    Ok(())
}

/// The rates and the score they make: the only reply a record may hold.
/// The score is recomputed, so a file whose seconds do not follow from its
/// own rates is a file with two truths, and not ours.
fn reply_is_sound(reply: &Reply) -> bool {
    rate_is_sound(reply.prompt_rate)
        && rate_is_sound(reply.decode_rate)
        && rate_is_sound(reply.seconds)
        && reply.seconds == reply_seconds(reply.prompt_rate, reply.decode_rate)
}

/// A rate a record may hold: a positive, finite number. Anything else is
/// not a measurement, whatever the file claims.
fn rate_is_sound(rate: f64) -> bool {
    rate.is_finite() && rate > 0.0
}

/// The winner is a trial of this record with the same reply — the one
/// rule, used by both sides, so `save` cannot write what `load` refuses.
fn trial_holds(trials: &[(Candidate, Kept)], candidate: &Candidate, reply: &Reply) -> bool {
    trials.iter().any(|(trial, kept)| {
        *trial == *candidate && matches!(kept, Kept::Replied(held) if held == reply)
    })
}

/// Saves the record atomically: a temp file in the same directory, renamed
/// over the old one — retried briefly when the disk holds the file (see
/// [`SAVE_ATTEMPTS`]), so a scan's moment does not cost the verdict. A
/// crash mid-write therefore leaves the predecessor whole (or no record at
/// all on the first save) — never a truncated file that could parse as a
/// smaller truth.
pub fn save(dir: &Path, model_digest: &str, record: &Record) -> io::Result<()> {
    save_with(dir, model_digest, record, None, stage_once)
}

/// Why a file on disk is a marker rather than a verdict: the cause its
/// `cut=` line carries — one closed name per cause, so the file says what
/// actually happened. Every cause reads the same: [`load`] refuses it,
/// [`cut_before`] finds it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Marker {
    /// The budget stopped the decode sweep.
    Sweep,
    /// The budget stopped the first pass: a shape never began.
    PassOne,
    /// Every shape ran; none of them replied.
    Refused,
    /// Some candidate's build never resolved, so its shapes never ran:
    /// the dropped hole the next start gets one chance to fill.
    Unresolved,
    /// The run never finished: the app closed, slept or rebooted mid-tune,
    /// and the checkpoint holds the lifetimes measured so far. Not an
    /// unfinished verdict — no verdict was reached — so it never spends
    /// the one retry the rule owes: every interruption keeps its progress
    /// and lets the next start withhold again. The cause name is its own
    /// because the file must read what actually happened; an older build
    /// reads an unknown name as no file at all (a full re-tune there —
    /// the safe direction).
    Interrupted,
}

impl Marker {
    fn cause(self) -> &'static str {
        match self {
            Marker::Sweep => "sweep",
            Marker::PassOne => "first",
            Marker::Refused => "refused",
            Marker::Unresolved => "unresolved",
            Marker::Interrupted => "interrupted",
        }
    }

    /// The marker a `cut=<cause>` line names, and none another does — one
    /// closed name per cause, on the way out and on the way in.
    fn from_cause(cause: &str) -> Option<Marker> {
        match cause {
            "sweep" => Some(Marker::Sweep),
            "first" => Some(Marker::PassOne),
            "refused" => Some(Marker::Refused),
            "unresolved" => Some(Marker::Unresolved),
            "interrupted" => Some(Marker::Interrupted),
            _ => None,
        }
    }
}

/// Saves the tune as a marker rather than a verdict: the same record and
/// one `cut=<cause>` line, which `load` refuses and [`cut_before`] reads.
/// An unfinished verdict is written this way so the next start finishes
/// the measuring — only the lifetimes no marker proved measured — and a
/// second unfinished verdict is saved by [`save`] as it stands, which is
/// what keeps a slow or broken machine from spending the whole budget on
/// every start forever. [`Marker::Interrupted`] is written the same way,
/// by the checkpoint after every finished lifetime: same file, same
/// format, one honest cause.
pub fn save_marker(
    dir: &Path,
    model_digest: &str,
    record: &Record,
    marker: Marker,
) -> io::Result<()> {
    save_with(dir, model_digest, record, Some(marker.cause()), stage_once)
}

/// How many times one save's write+rename is tried before the caller's
/// warning stands: an antivirus can hold the file for a moment (a
/// Windows sharing violation at the create or the rename), and one
/// refusal must not cost the next start a re-tune over a record this
/// start already holds.
const SAVE_ATTEMPTS: u32 = 5;

/// The pause between two attempts of one save: long enough for a scan to
/// let go, five times short enough to stay inside one step of the walk.
const SAVE_RETRY: Duration = Duration::from_millis(200);

fn save_with(
    dir: &Path,
    model_digest: &str,
    record: &Record,
    cut: Option<&'static str>,
    mut attempt: impl FnMut(&Path, &str) -> io::Result<()>,
) -> io::Result<()> {
    validate(record)?;
    let Some(target) = path(dir, model_digest) else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the model digest is not the catalog's pinned sha256 form",
        ));
    };
    fs::create_dir_all(dir)?;
    let mut text = format!("{MAGIC}\nfingerprint={}\n", record.fingerprint);
    if let Some(cause) = cut {
        text.push_str(&format!("cut={cause}\n"));
    }
    for (index, (candidate, kept)) in record.trials.iter().enumerate() {
        text.push_str(&format!(
            "candidate.{index}.backend={}\n",
            candidate.backend.name()
        ));
        if let Some(threads) = candidate.threads {
            text.push_str(&format!("candidate.{index}.threads={threads}\n"));
        }
        text.push_str(&format!(
            "candidate.{index}.offload={}\n",
            offload_name(candidate.offload)
        ));
        if let Some(n_max) = candidate.draft {
            text.push_str(&format!("candidate.{index}.draft={n_max}\n"));
        }
        match kept {
            Kept::Replied(reply) => {
                text.push_str(&format!(
                    "candidate.{index}.prompt-rate={}\n",
                    reply.prompt_rate
                ));
                text.push_str(&format!(
                    "candidate.{index}.decode-rate={}\n",
                    reply.decode_rate
                ));
                text.push_str(&format!(
                    "candidate.{index}.reply-seconds={}\n",
                    reply.seconds
                ));
            }
            Kept::Refused {
                refusal,
                prompt_rate,
            } => {
                if let Some(prompt_rate) = prompt_rate {
                    text.push_str(&format!("candidate.{index}.prompt-rate={prompt_rate}\n"));
                }
                text.push_str(&format!(
                    "candidate.{index}.refused={}\n",
                    refusal_name(*refusal)
                ));
            }
        }
    }
    if let Some(winner) = &record.winner {
        text.push_str(&format!(
            "winner-backend={}\n",
            winner.candidate.backend.name()
        ));
        text.push_str(&format!(
            "winner-offload={}\n",
            offload_name(winner.candidate.offload)
        ));
        if let Some(threads) = winner.candidate.threads {
            text.push_str(&format!("winner-threads={threads}\n"));
        }
        if let Some(n_max) = winner.candidate.draft {
            text.push_str(&format!("winner-draft={n_max}\n"));
        }
        text.push_str(&format!(
            "winner-prompt-rate={}\n",
            winner.reply.prompt_rate
        ));
        text.push_str(&format!(
            "winner-decode-rate={}\n",
            winner.reply.decode_rate
        ));
        text.push_str(&format!("winner-reply-seconds={}\n", winner.reply.seconds));
    }
    // The end marker is the truncation guard: every cut this format can
    // suffer lands before it, and a record without it is a record we do
    // not have.
    text.push_str("end\n");
    // The bounded retry: a momentary hold (an AV scan mid-rename) must
    // not cost the verdict — [`SAVE_ATTEMPTS`] tries, [`SAVE_RETRY`]
    // apart, the same bytes each time; only the last failure reaches the
    // caller's warning.
    let mut last = None;
    for taken in 0..SAVE_ATTEMPTS {
        match attempt(&target, &text) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last = Some(error);
                if taken + 1 < SAVE_ATTEMPTS {
                    std::thread::sleep(SAVE_RETRY);
                }
            }
        }
    }
    Err(last.expect("a save is attempted at least once"))
}

/// One attempt at the atomic write: a fresh temp in the same directory,
/// the bytes, the rename over the old file — and any failure takes its
/// own temp away before it reports. The retry lives in [`save_with`]:
/// this is the part a scan can hold for a moment.
fn stage_once(target: &Path, text: &str) -> io::Result<()> {
    let temp = temp_path(target);
    // A create failure is the one early return, and it is safe: no file
    // of ours exists yet (this code never removes a path it did not just
    // make). Every path AFTER the create — write, flush, rename — reports
    // through `result`, never through `?`, because a `?` would return and
    // leave this attempt's partial temp behind; one cleanup owns them all.
    let mut file = fs::File::create(&temp)?;
    let staged = file.write_all(text.as_bytes()).and_then(|()| file.flush());
    drop(file); // closed before the rename: nobody may hold the temp open
    let result = match staged {
        Ok(()) => fs::rename(&temp, target),
        Err(error) => Err(error),
    };
    if let Err(error) = result {
        // Whatever failed, THIS attempt's temp is THIS attempt's to clean
        // — by its own unique name, never another attempt's file.
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(())
}

/// One temp name per save: the pid separates processes, the counter
/// separates saves inside one — two concurrent saves must never truncate
/// or rename each other's half-written file.
fn temp_path(target: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let serial = COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = target
        .file_name()
        .expect("a path we just built names a file");
    target.with_file_name(format!(
        "{}.{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        serial
    ))
}

/// The saved record for one model, if it is ours, whole, valid, and still
/// this fingerprint. The per-model file is read first; the legacy single
/// file answers only for the model its fingerprint names. A corrupt,
/// truncated, foreign or stale file reads as `None`: no error reaches the
/// walk, the caller just keeps the rule.
pub fn load(dir: &Path, model_digest: &str, fingerprint: &str) -> Option<Record> {
    let text = fs::read_to_string(path(dir, model_digest)?)
        .or_else(|_| fs::read_to_string(legacy_path(dir)))
        .ok()?;
    let (saved, record, cause) = parse(&text)?;
    (saved == fingerprint && cause.is_none()).then_some(record)
}

/// The marker the last start left for this fingerprint: why it was
/// withheld, and the trials it measured. [`load`] refuses it as a
/// verdict, and the retry plans from the measurements themselves — every
/// lifetime they proved measured keeps its entry and never runs again,
/// and a retry that measures nothing keeps the first attempt's winner
/// instead of replacing it with a record of refusals. The cause tells
/// the walk whether the one retry was already spent (`Marker::Interrupted`
/// never spends it). A record for another fingerprint, a torn file, or
/// no marker at all answers none.
pub fn cut_marker(dir: &Path, model_digest: &str, fingerprint: &str) -> Option<(Marker, Record)> {
    let file = path(dir, model_digest)?;
    let text = fs::read_to_string(file).ok()?;
    let (saved, record, cause) = parse(&text)?;
    if saved != fingerprint {
        return None;
    }
    cause.map(|cause| (cause, record))
}

/// Whether the last start's tune for this fingerprint left an unfinished
/// verdict behind — the budget cut it, a pass never ran, or nothing
/// replied: the one fact that lets THIS start save its own unfinished
/// result instead of withholding it a second time — a slow machine must
/// not re-tune forever. A record for another fingerprint, a torn file, or
/// none at all answers no.
pub fn cut_before(dir: &Path, model_digest: &str, fingerprint: &str) -> bool {
    cut_marker(dir, model_digest, fingerprint).is_some()
}

/// The record a retry saves: the prior trials the CURRENT PLAN kept —
/// the caller's filter (`kalsa_tune::plan_prior` over the marker's
/// trials), so a launch this start's candidate list no longer runs
/// cannot re-enter the record through here — pooled with everything this
/// retry produced: one entry per candidate. The retry's
/// own measurement is the fresher one and wins a pair where both measured
/// the same launch; a refusal this start wrote never erases an earlier
/// reply (a refusal is a closed cause, not a measurement), so a marker's
/// winner survives a retry that could not measure it. The winner is
/// re-chosen over the union by the same rule every winner answers to —
/// band, decode, dominance, lightness — so the better reply wins whoever
/// measured it, and `reply_is_sound` still holds because every pooled
/// entry is the reply it was saved as. `retry`'s fingerprint is the
/// record's: the marker was only read for this fingerprint in the first
/// place.
pub fn pool_retry(prior: &[(Candidate, Kept)], retry: Record) -> Record {
    let mut trials = retry.trials;
    for (candidate, kept) in prior {
        let Kept::Replied(reply) = kept else {
            continue; // only measurements pool in from the first attempt
        };
        if trials.iter().any(|(other, held)| {
            other == candidate && matches!(held, Kept::Replied(_))
        }) {
            continue; // the retry measured it too: the fresher number wins
        }
        // One entry per candidate — validate would reject the duplicate —
        // so a refusal of the same launch makes way for the measurement.
        trials.retain(|(other, _)| other != candidate);
        trials.push((*candidate, Kept::Replied(*reply)));
    }
    let scored: Vec<(Candidate, Reply)> = trials
        .iter()
        .filter_map(|(candidate, kept)| match kept {
            Kept::Replied(reply) => Some((*candidate, *reply)),
            _ => None,
        })
        .collect();
    let winner = crate::score::reply_winner(&scored);
    Record {
        fingerprint: retry.fingerprint,
        winner,
        trials,
    }
}

/// The record filed for one model, by name alone — the display read. The
/// model identity IS the file's name here, so the fingerprint's other
/// facts (engine build, context) are not re-checked: a stale figure is
/// corrected by that model's next tune, and the launch path keeps the
/// strict [`load`] above. The legacy single file is the one record whose
/// name cannot say whose it is, so it is taken only when its fingerprint
/// names this model — otherwise it belongs to another model, and another
/// model's rate is not this one's.
pub fn load_by_model(dir: &Path, model_digest: &str) -> Option<Record> {
    if let Some(text) = fs::read_to_string(path(dir, model_digest)?).ok() {
        return parse(&text).map(|(_, record, _)| record);
    }
    let text = fs::read_to_string(legacy_path(dir)).ok()?;
    let (saved, record, _) = parse(&text)?;
    names_model(&saved, model_digest).then_some(record)
}

/// The file's whole meaning: the fingerprint it claims, the record it
/// holds, and which marker it carries — or none for a verdict. Shared by
/// every read, so none can grow a reading the others lack.
fn parse(text: &str) -> Option<(String, Record, Option<Marker>)> {
    let mut lines = text.lines();
    // The magic must be the WHOLE first line: a version we do not know —
    // `kalsa-tune v5` with its separate off lifetime, today — is not ours,
    // and the walk tunes again.
    if lines.next()? != MAGIC {
        return None;
    }
    let mut saved_fingerprint: Option<&str> = None;
    let mut cause: Option<Marker> = None;
    let mut trials: Vec<(Candidate, Kept)> = Vec::new();
    // The candidate being read: fields arrive in the order save writes
    // them (backend, threads?, offload, prompt-rate?, then exactly one of
    // reply-seconds/refused) and only for the next index in line.
    let mut open: Option<Open> = None;
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
                    if open.is_some() {
                        return None;
                    }
                    open = Some(Open {
                        backend: ServerBackend::from_name(value)?,
                        threads: None,
                        offload: None,
                        draft: None,
                        prompt_rate: None,
                        decode_rate: None,
                    });
                }
                "threads" => {
                    let slot = open.as_mut()?;
                    if slot.threads.is_some()
                        || slot.offload.is_some()
                        || slot.draft.is_some()
                        || slot.prompt_rate.is_some()
                    {
                        return None;
                    }
                    slot.threads = Some(parse_count(value)?);
                }
                "offload" => {
                    let slot = open.as_mut()?;
                    if slot.offload.is_some() || slot.draft.is_some() || slot.prompt_rate.is_some()
                    {
                        return None;
                    }
                    slot.offload = Some(offload_from_name(value)?);
                }
                "draft" => {
                    let slot = open.as_mut()?;
                    if slot.draft.is_some() || slot.prompt_rate.is_some() {
                        return None;
                    }
                    slot.offload?; // the offload line must have come first
                    slot.draft = Some(value.parse::<u32>().ok().filter(|n| *n > 0)?);
                }
                "prompt-rate" => {
                    let slot = open.as_mut()?;
                    if slot.prompt_rate.is_some() {
                        return None;
                    }
                    slot.offload?; // the offload line must have come first
                    slot.prompt_rate = Some(parse_rate(value)?);
                }
                "decode-rate" => {
                    let slot = open.as_mut()?;
                    if slot.decode_rate.is_some() {
                        return None;
                    }
                    slot.prompt_rate?; // a decode rate without its shape's prefill is not ours
                    slot.decode_rate = Some(parse_rate(value)?);
                }
                "reply-seconds" => {
                    let slot = open.as_ref()?;
                    let reply = Reply {
                        prompt_rate: slot.prompt_rate?,
                        decode_rate: slot.decode_rate?,
                        seconds: parse_rate(value)?,
                    };
                    if !reply_is_sound(&reply) {
                        return None;
                    }
                    close(&mut open, &mut trials, Kept::Replied(reply))?;
                }
                "refused" => {
                    if open.as_ref()?.decode_rate.is_some() {
                        return None; // a decoded refusal is two answers at once
                    }
                    open.as_ref()?.offload?; // the offload line must have come first
                    let prompt_rate = open.as_ref()?.prompt_rate;
                    let refusal = refusal_from_name(value)?;
                    close(
                        &mut open,
                        &mut trials,
                        Kept::Refused {
                            refusal,
                            prompt_rate,
                        },
                    )?;
                }
                _ => return None,
            }
            continue;
        }
        if open.is_some() {
            return None; // a candidate must finish before any other key
        }
        match key {
            "fingerprint"
                if saved_fingerprint.is_none() && trials.is_empty() && winner.is_none() =>
            {
                saved_fingerprint = Some(value);
            }
            "cut"
                if cause.is_none()
                    && saved_fingerprint.is_some()
                    && trials.is_empty()
                    && winner.is_none() =>
            {
                cause = Some(Marker::from_cause(value)?);
            }
            "winner-backend" if winner.is_none() => {
                winner = Some(WinnerLine {
                    backend: ServerBackend::from_name(value)?,
                    offload: None,
                    threads: None,
                    draft: None,
                    prompt_rate: None,
                    decode_rate: None,
                    seconds: None,
                });
            }
            "winner-offload" if winner.as_ref().is_some_and(|slot| slot.offload.is_none()) => {
                winner.as_mut()?.offload = Some(offload_from_name(value)?);
            }
            "winner-threads"
                if winner.as_ref().is_some_and(|slot| {
                    slot.offload.is_some()
                        && slot.threads.is_none()
                        && slot.draft.is_none()
                        && slot.prompt_rate.is_none()
                }) =>
            {
                winner.as_mut()?.threads = Some(parse_count(value)?);
            }
            "winner-draft"
                if winner.as_ref().is_some_and(|slot| {
                    slot.offload.is_some()
                        && slot.draft.is_none()
                        && slot.prompt_rate.is_none()
                        && slot.seconds.is_none()
                }) =>
            {
                winner.as_mut()?.draft = Some(value.parse::<u32>().ok().filter(|n| *n > 0)?);
            }
            "winner-prompt-rate"
                if winner.as_ref().is_some_and(|slot| {
                    slot.prompt_rate.is_none()
                        && slot.decode_rate.is_none()
                        && slot.seconds.is_none()
                }) =>
            {
                winner.as_mut()?.prompt_rate = Some(parse_rate(value)?);
            }
            "winner-decode-rate"
                if winner.as_ref().is_some_and(|slot| {
                    slot.prompt_rate.is_some()
                        && slot.decode_rate.is_none()
                        && slot.seconds.is_none()
                }) =>
            {
                winner.as_mut()?.decode_rate = Some(parse_rate(value)?);
            }
            "winner-reply-seconds"
                if winner
                    .as_ref()
                    .is_some_and(|slot| slot.decode_rate.is_some() && slot.seconds.is_none()) =>
            {
                winner.as_mut()?.seconds = Some(parse_rate(value)?);
            }
            _ => return None,
        }
    }
    // The whole file must have been there: the end marker, its key, at
    // least one trial — and when a winner started, every field it needs.
    if !saw_end || saved_fingerprint.is_none() || trials.is_empty() {
        return None;
    }
    let winner = match winner {
        None => None,
        Some(line) => {
            let reply = Reply {
                prompt_rate: line.prompt_rate?,
                decode_rate: line.decode_rate?,
                seconds: line.seconds?,
            };
            if !reply_is_sound(&reply) {
                return None;
            }
            let candidate = Candidate {
                backend: line.backend,
                threads: line.threads,
                offload: line.offload?,
                draft: line.draft,
            };
            // A file whose winner cannot be found among its own trials is
            // a file that lost its middle.
            if !trial_holds(&trials, &candidate, &reply) {
                return None;
            }
            Some(Winner { candidate, reply })
        }
    };
    let fingerprint = saved_fingerprint?.to_string();
    Some((
        fingerprint.clone(),
        Record {
            fingerprint,
            winner,
            trials,
        },
        cause,
    ))
}

/// The candidate fields as they arrive, before the kept result closes the
/// entry: the order save writes them is the order the parser accepts.
struct Open {
    backend: ServerBackend,
    threads: Option<usize>,
    offload: Option<Offload>,
    draft: Option<u32>,
    prompt_rate: Option<f64>,
    decode_rate: Option<f64>,
}

/// Close the open entry as the kept result it just became, refusing a
/// candidate the builder would never have written twice.
fn close(open: &mut Option<Open>, trials: &mut Vec<(Candidate, Kept)>, kept: Kept) -> Option<()> {
    let slot = open.take()?;
    let candidate = Candidate {
        backend: slot.backend,
        threads: slot.threads,
        offload: slot.offload?,
        draft: slot.draft,
    };
    if trials.iter().any(|(other, _)| *other == candidate) {
        // The builder de-duplicates: a file that does not is a file from
        // something else wearing our shape.
        return None;
    }
    trials.push((candidate, kept));
    Some(())
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
        Refusal::PromptTooShort => "prompt-too-short",
    }
}

fn refusal_from_name(name: &str) -> Option<Refusal> {
    match name {
        "did-not-start" => Some(Refusal::DidNotStart),
        "not-ready" => Some(Refusal::NotReady),
        "no-usable-answer" => Some(Refusal::NoUsableAnswer),
        "prompt-too-short" => Some(Refusal::PromptTooShort),
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

/// Throw the model's record away: the tuned launch just failed where the
/// rule succeeded — twice in a row (see [`launch_failed`]) — so whatever
/// the file said is not what this machine wants, and the next start must
/// measure again. The failure count beside the record goes with it, and
/// the legacy single file only when it holds THIS model's record (its
/// fingerprint says whose it is): a retry for one model must not erase
/// another's legacy. Best effort: no record is already the goal, and a
/// missing file is not an error anyone should see.
pub fn invalidate(dir: &Path, model_digest: &str) {
    if let Some(file) = path(dir, model_digest) {
        let _ = fs::remove_file(file);
    }
    if let Some(counter) = failures_path(dir, model_digest) {
        let _ = fs::remove_file(counter); // the streak goes with the record
    }
    let holds_this_model = fs::read_to_string(legacy_path(dir))
        .ok()
        .and_then(|text| parse(&text))
        .is_some_and(|(saved, _, _)| names_model(&saved, model_digest));
    if holds_this_model {
        let _ = fs::remove_file(legacy_path(dir));
    }
}

/// How many consecutive failures of the tuned launch the record survives.
/// One is a slow start — a scan holding the exe, a cold disk — and the
/// rule runs THIS launch while the record keeps its chance; two is a
/// launch this machine cannot bring up, and the next start tunes again.
const LAUNCH_FAILURE_LIMIT: u32 = 2;

/// The failure count beside the record: same name, `.launch-failures`
/// instead of `.txt` — a neighbour no reader mistakes for a record (every
/// read names the `.txt` exactly).
fn failures_path(dir: &Path, model_digest: &str) -> Option<PathBuf> {
    Some(path(dir, model_digest)?.with_extension("launch-failures"))
}

/// One more consecutive failure of the tuned launch to come up, persisted
/// beside the record so the streak survives the restart. The SECOND one
/// throws the record (and the count) away and returns `true` — the caller
/// says so; the first changes no verdict, only the number. Best effort: a
/// count that cannot be written only forgets the streak, never the record.
pub fn launch_failed(dir: &Path, model_digest: &str) -> bool {
    let Some(target) = failures_path(dir, model_digest) else {
        return false; // an unusable digest names no record to protect
    };
    let count = fs::read_to_string(&target)
        .ok()
        .and_then(|text| text.trim().parse::<u32>().ok())
        .unwrap_or(0)
        .saturating_add(1);
    if count >= LAUNCH_FAILURE_LIMIT {
        invalidate(dir, model_digest);
        return true;
    }
    // The record's own temp-and-rename: a torn count reads as the streak
    // it replaced's absence — at worst the next failure counts as a first.
    let temp = temp_path(&target);
    let landed = fs::write(&temp, format!("{count}\n")).and_then(|()| fs::rename(&temp, target));
    if landed.is_err() {
        let _ = fs::remove_file(&temp);
    }
    false
}

/// The tuned launch came up: whatever failed before, the streak of
/// consecutive failures is over. Called on a successful start, the count
/// file simply goes.
pub fn launch_succeeded(dir: &Path, model_digest: &str) {
    if let Some(target) = failures_path(dir, model_digest) {
        let _ = fs::remove_file(&target);
    }
}

/// The model the legacy single `tuning.txt` was tuned for, read from its
/// key — the one record whose name cannot say whose it is. Installs from
/// before the stored choice are recognised by it; nothing else needs it.
pub fn legacy_model(dir: &Path) -> Option<String> {
    let (saved, _, _) = parse(&fs::read_to_string(legacy_path(dir)).ok()?)?;
    saved
        .split('|')
        .find_map(|field| field.strip_prefix("model="))
        .map(str::to_owned)
}

#[cfg(test)]
mod tests;
