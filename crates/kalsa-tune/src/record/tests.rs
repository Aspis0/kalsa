use super::*;
use crate::candidates::offload_for;

/// A scratch directory that cleans itself up even when the test
/// panics: a leftover temp dir is not a failure anyone can see.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("kalsa-tune-record-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        Self(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl std::ops::Deref for Scratch {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.0
    }
}

/// The model `sample()`'s fingerprint names: the store keys by this,
/// the fingerprint compares it. Hex, because that is the form the
/// store's paths accept.
const DIGEST: &str = "abc123";

/// A second model, for the tests that need one beside the first.
const OTHER_DIGEST: &str = "def456";

/// A fingerprint in the key's own format, so the fields `names_model`
/// reads are where the real composer puts them.
fn fp(digest: &str) -> String {
    format!(
        "kalsa-tune fp v1|model={digest}|ctx=8192|physical=Some(8)|\
             logical=Some(16)|graphics=gfx|processor=cpu"
    )
}

fn path_last(model_digest: &str) -> String {
    path(Path::new("."), model_digest)
        .expect("hex digest")
        .file_name()
        .expect("the store's own path names a file")
        .to_string_lossy()
        .into_owned()
}

/// The reply `sample()`'s winner holds, from the same two rates both
/// sides compute, so the trial and the winner are the same reply.
fn gpu_reply() -> Reply {
    Reply::from_rates(1000.0, 49.0).expect("two measurements")
}

fn mac_reply() -> Reply {
    Reply::from_rates(500.0, 21.0).expect("two measurements")
}

fn sample() -> Record {
    let cpu16 = Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(16),
        offload: offload_for(ServerBackend::Cpu),
        draft: None,
    };
    let gpu = Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(16),
        offload: Offload::All,
        draft: None,
    };
    let mac = Candidate {
        backend: ServerBackend::Metal,
        threads: Some(8),
        offload: Offload::ForcedOff,
        draft: None,
    };
    Record {
        fingerprint: fp(DIGEST),
        winner: Some(Winner {
            candidate: gpu,
            reply: gpu_reply(),
        }),
        trials: vec![
            (gpu, Kept::Replied(gpu_reply())),
            (
                cpu16,
                Kept::Refused {
                    refusal: Refusal::DidNotStart,
                    prompt_rate: None,
                },
            ),
            (mac, Kept::Replied(mac_reply())),
        ],
    }
}

/// The saved text of `sample()`, for the cut-boundary tests.
fn sample_text(dir: &Path) -> String {
    save(dir, DIGEST, &sample()).expect("save");
    std::fs::read_to_string(path(dir, DIGEST).expect("hex digest")).expect("read")
}

fn rewrite(dir: &Path, text: impl AsRef<[u8]>) {
    std::fs::write(path(dir, DIGEST).expect("hex digest"), text).expect("rewrite");
}

#[test]
fn a_record_survives_a_restart_with_the_same_fingerprint() {
    let dir = Scratch::new("roundtrip");
    let record = sample();
    save(&dir, DIGEST, &record).expect("save");
    let loaded = load(&dir, DIGEST, &record.fingerprint).expect("load");
    assert_eq!(loaded, record);
    std::fs::remove_file(path(&dir, DIGEST).expect("hex digest")).expect("remove");
    assert_eq!(load(&dir, DIGEST, &record.fingerprint), None);
}

/// The tune's graphics winner is remembered as engine-fitted: the name
/// must round-trip, or the next start would launch a different rule
/// than the one that won.
#[test]
fn an_engine_fitted_winner_round_trips() {
    let dir = Scratch::new("engine-fitted-roundtrip");
    let mut record = sample();
    let winner = record
        .winner
        .as_ref()
        .expect("the sample has a winner")
        .candidate;
    record.winner.as_mut().unwrap().candidate.offload = Offload::EngineFitted;
    for (candidate, _) in record.trials.iter_mut() {
        if *candidate == winner {
            candidate.offload = Offload::EngineFitted;
        }
    }
    save(&dir, DIGEST, &record).expect("save");
    let back = load(&dir, DIGEST, &record.fingerprint).expect("load");
    assert_eq!(
        back.winner.expect("kept").candidate.offload,
        Offload::EngineFitted
    );
}

/// A drafted winner round-trips with every field its launch needs: the
/// draft count, and the reply that chose it. The sample's own winner is
/// target-only, so this is the one case that reads a `draft=` line back
/// from both the trial and the winner block.
#[test]
fn a_drafted_winner_round_trips() {
    let dir = Scratch::new("drafted-roundtrip");
    let base = Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(16),
        offload: Offload::EngineFitted,
        draft: Some(3),
    };
    let reply = Reply::from_rates(60.0, 45.0).expect("two measurements");
    let record = Record {
        fingerprint: fp(DIGEST),
        winner: Some(Winner {
            candidate: base,
            reply,
        }),
        trials: vec![(base, Kept::Replied(reply))],
    };
    save(&dir, DIGEST, &record).expect("save");
    assert_eq!(load(&dir, DIGEST, &record.fingerprint), Some(record));
}

#[test]
fn a_changed_machine_or_model_reads_as_no_record() {
    let dir = Scratch::new("fingerprint");
    save(&dir, DIGEST, &sample()).expect("save");
    assert_eq!(load(&dir, DIGEST, &fp(OTHER_DIGEST)), None);
}

/// A trial that refused after its shape's prefill keeps the prefill rate:
/// the one number the shape did produce travels with the cause.
#[test]
fn a_refusal_keeps_the_prompt_rate_it_measured() {
    let dir = Scratch::new("refused-prompt-rate");
    let record = Record {
        fingerprint: fp(DIGEST),
        winner: None,
        trials: vec![(
            Candidate {
                backend: ServerBackend::Vulkan,
                threads: Some(16),
                offload: Offload::All,
                draft: Some(2),
            },
            Kept::Refused {
                refusal: Refusal::PromptTooShort,
                prompt_rate: Some(73.0),
            },
        )],
    };
    save(&dir, DIGEST, &record).expect("save");
    assert_eq!(load(&dir, DIGEST, &record.fingerprint), Some(record));
}

#[test]
fn a_corrupt_value_reads_as_no_record() {
    let dir = Scratch::new("corrupt");
    let text = sample_text(&dir).replace("decode-rate=49", "decode-rate=banana");
    rewrite(&dir, text);
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// A cut before the winner: the trials parse completely and there is
/// no winner line — indistinguishable from a real no-winner tune
/// unless the end marker is what makes it a record at all.
#[test]
fn a_file_cut_before_the_winner_reads_as_no_record() {
    let dir = Scratch::new("cut-before-winner");
    let text = sample_text(&dir);
    let cut = text
        .find("winner-backend")
        .expect("the sample has a winner");
    rewrite(&dir, &text[..cut]);
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// A cut inside a later candidate: the earlier ones parse and the
/// later one is half-written — a complete key line, then nothing. The
/// end marker is the only guard.
#[test]
fn a_file_cut_inside_a_candidate_reads_as_no_record() {
    let dir = Scratch::new("cut-candidate");
    let text = sample_text(&dir);
    let cut = text
        .find("candidate.1.threads")
        .expect("the second trial's fields");
    rewrite(&dir, &text[..cut]);
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// A cut right after a refusal line. The cause itself can no longer be
/// cut into something loadable — a closed name parses whole or not at
/// all — so the boundary that still matters is the one after it: the
/// file must not end before its `end`.
#[test]
fn a_file_cut_after_a_refusal_reads_as_no_record() {
    let dir = Scratch::new("cut-refusal");
    let text = sample_text(&dir);
    let cut = text
        .find("candidate.2.backend")
        .expect("the trial after the refusal");
    rewrite(&dir, &text[..cut]);
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

#[test]
fn a_foreign_magic_reads_as_no_record() {
    let dir = Scratch::new("foreign");
    save(&dir, DIGEST, &sample()).expect("save");
    // Our shape, another tool's magic: only the exact magic line
    // stands between this file and being believed.
    let text = std::fs::read_to_string(path(&dir, DIGEST).expect("hex digest")).expect("read");
    let foreign = text.replacen(MAGIC, "another-tool v7", 1);
    rewrite(&dir, foreign);
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// A version bump is not our version: the magic is the whole line,
/// not a prefix.
#[test]
fn a_version_bump_reads_as_no_record() {
    let dir = Scratch::new("v10");
    save(&dir, DIGEST, &sample()).expect("save");
    let text = std::fs::read_to_string(path(&dir, DIGEST).expect("hex digest")).expect("read");
    rewrite(&dir, text.replacen(MAGIC, "kalsa-tune v10", 1));
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// The v1 records pinned the graphics winner as `all`, whose flag makes
/// fit refuse to adapt the layers — the old magic reads as no record, so
/// the start measures again instead of launching it.
#[test]
fn a_v1_record_reads_as_no_record() {
    let dir = Scratch::new("legacy-v1");
    save(&dir, DIGEST, &sample()).expect("save");
    let text = std::fs::read_to_string(path(&dir, DIGEST).expect("hex digest")).expect("read");
    rewrite(&dir, text.replacen(MAGIC, "kalsa-tune v1", 1));
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// The older magics whose records the current tune must not trust: v3
/// held a decode rate and nothing of the room, v4 priced a history shorter
/// than the one it measured, and v5 measured the off setting on a lifetime
/// of its own. All re-tune once.
#[test]
fn an_older_format_reads_as_no_record() {
    for magic in ["kalsa-tune v3", "kalsa-tune v4", "kalsa-tune v5"] {
        let dir = Scratch::new("legacy-format");
        save(&dir, DIGEST, &sample()).expect("save");
        let text = std::fs::read_to_string(path(&dir, DIGEST).expect("hex digest")).expect("read");
        rewrite(&dir, text.replacen(MAGIC, magic, 1));
        assert_eq!(
            load(&dir, DIGEST, &fp(DIGEST)),
            None,
            "{magic} must not load"
        );
    }
}

/// The key counts the SCORING RULE: a record keyed by the previous rule's
/// version is not this build's verdict — the first start after a rule
/// change measures once instead of trusting a winner the old rule chose —
/// and it is not even a retry marker, just another question this file
/// does not answer.
#[test]
fn a_record_keyed_by_an_older_scoring_rule_is_not_reused() {
    let dir = Scratch::new("older-key");
    let current = fingerprint(DIGEST, 8192, Some(8), Some(16), ("gfx", "cpu"), None);
    assert!(
        current.starts_with("kalsa-tune fp v4"),
        "the key's version is the scoring rule's: {current}"
    );
    let stale = current.replacen("kalsa-tune fp v4", "kalsa-tune fp v3", 1);
    let mut record = sample();
    record.fingerprint = stale;
    save(&dir, DIGEST, &record).expect("save");
    assert_eq!(
        load(&dir, DIGEST, &current),
        None,
        "a winner chosen under the old rule is not this rule's verdict"
    );
    assert!(
        !cut_before(&dir, DIGEST, &current),
        "not a marker either: the next start measures fresh"
    );
}

/// One entry per candidate in a retry's pool: where both attempts measured
/// the same launch the retry's number is the fresher one and stands alone;
/// a refusal this start wrote never erases an earlier reply; and the winner
/// is re-chosen over the union by the same rule every winner answers to —
/// here the first attempt's better reply survives the retry's own.
#[test]
fn the_retry_pool_keeps_one_entry_per_candidate_and_the_better_reply() {
    let cpu8 = Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(8),
        offload: offload_for(ServerBackend::Cpu),
        draft: None,
    };
    let cpu16 = Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(16),
        offload: offload_for(ServerBackend::Cpu),
        draft: None,
    };
    let fast = Reply::from_rates(1000.0, 100.0).expect("measured");
    let retry_slow = Reply::from_rates(1000.0, 10.0).expect("measured");
    let better = Reply::from_rates(500.0, 20.0).expect("measured");
    let prior = Record {
        fingerprint: fp(DIGEST),
        winner: Some(Winner {
            candidate: cpu8,
            reply: fast,
        }),
        trials: vec![
            (cpu8, Kept::Replied(fast)),
            (cpu16, Kept::Replied(better)),
        ],
    };
    let retry = Record {
        fingerprint: fp(DIGEST),
        winner: Some(Winner {
            candidate: cpu8,
            reply: retry_slow,
        }),
        trials: vec![
            (cpu8, Kept::Replied(retry_slow)),
            (
                cpu16,
                Kept::Refused {
                    refusal: Refusal::DidNotStart,
                    prompt_rate: None,
                },
            ),
        ],
    };
    let pooled = pool_retry(&prior.trials, retry);
    assert_eq!(pooled.fingerprint, fp(DIGEST), "the retry's own key");
    assert_eq!(pooled.trials.len(), 2, "one entry per candidate: {pooled:?}");
    let cpu8_trial = pooled
        .trials
        .iter()
        .find(|(candidate, _)| *candidate == cpu8)
        .expect("the measured-again launch is there");
    assert_eq!(
        cpu8_trial.1,
        Kept::Replied(retry_slow),
        "measured twice: the retry's fresher number, one entry"
    );
    let cpu16_trial = pooled
        .trials
        .iter()
        .find(|(candidate, _)| *candidate == cpu16)
        .expect("the refused-again launch is still measured from the first attempt");
    assert_eq!(
        cpu16_trial.1,
        Kept::Replied(better),
        "a refusal is not a measurement and cannot erase one"
    );
    assert_eq!(
        pooled.winner,
        Some(Winner {
            candidate: cpu16,
            reply: better,
        }),
        "the union, chosen by the same rule: the better reply wins"
    );
    // The union is a record the store still accepts — reply_is_sound holds
    // because every pooled entry is the reply it was measured as.
    let dir = Scratch::new("pool-union");
    save(&dir, DIGEST, &pooled).expect("the union validates");
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), Some(pooled));
}

/// The tuned launch's failure streak, beside the record: ONE failure
/// keeps the record — a slow start under a scan must not cost the tune,
/// the rule runs this launch and the record gets its next chance — a
/// success resets the count, and only the SECOND consecutive failure
/// throws the record away.
#[test]
fn a_tuned_launch_failing_once_keeps_the_record_and_twice_drops_it() {
    let dir = Scratch::new("launch-failures");
    let record = sample();
    save(&dir, DIGEST, &record).expect("the verdict");

    assert!(
        !launch_failed(&dir, DIGEST),
        "one failure: nothing is thrown away"
    );
    assert_eq!(
        load(&dir, DIGEST, &record.fingerprint),
        Some(record.clone()),
        "the record stands after one failure"
    );

    launch_succeeded(&dir, DIGEST);
    assert!(
        !launch_failed(&dir, DIGEST),
        "the success in between reset the streak: this is a first failure again"
    );
    assert!(
        load(&dir, DIGEST, &record.fingerprint).is_some(),
        "still kept"
    );

    assert!(
        launch_failed(&dir, DIGEST),
        "two in a row: the record chose a launch this machine cannot bring up"
    );
    assert_eq!(
        load(&dir, DIGEST, &record.fingerprint),
        None,
        "the second consecutive failure drops it"
    );
    assert!(
        !launch_failed(&dir, DIGEST),
        "the count went with the record: the next failure is a first again"
    );
}

/// An unfinished verdict is written as a marker: the same record and one
/// `cut=<cause>` line, which the launch read refuses (the next start must
/// measure again) while `cut_before` and the display read still see it,
/// for every cause the marker carries — the interruption included, which
/// no verdict reached and which never spends the one retry.
#[test]
fn a_marker_is_refused_as_a_verdict_and_read_as_a_marker() {
    let dir = Scratch::new("cut-marker");
    let record = sample();
    for cause in [
        Marker::Sweep,
        Marker::PassOne,
        Marker::Refused,
        Marker::Unresolved,
        Marker::Interrupted,
    ] {
        save_marker(&dir, DIGEST, &record, cause).expect("marker");
        assert_eq!(
            load(&dir, DIGEST, &record.fingerprint),
            None,
            "{cause:?}: a marker is not this start's verdict"
        );
        assert!(
            cut_before(&dir, DIGEST, &record.fingerprint),
            "{cause:?}: the next start can read the marker"
        );
        assert_eq!(
            cut_marker(&dir, DIGEST, &record.fingerprint),
            Some((cause, record.clone())),
            "{cause:?}: and with the cause and the trials a retry may keep"
        );
        assert!(
            load_by_model(&dir, DIGEST).is_some(),
            "{cause:?}: the display read still shows the numbers"
        );
        assert!(
            !cut_before(&dir, DIGEST, &fp(OTHER_DIGEST)),
            "another fingerprint's marker is not this launch's"
        );
    }

    // The verdict of a later start replaces the marker and is reusable.
    save(&dir, DIGEST, &record).expect("verdict");
    assert_eq!(
        load(&dir, DIGEST, &record.fingerprint),
        Some(record.clone())
    );
    assert!(!cut_before(&dir, DIGEST, &record.fingerprint));
}

/// The marker's own line is closed and whole: a made-up reason, or a
/// marker line cut before the end, reads as no marker at all.
#[test]
fn a_marker_that_is_not_whole_is_no_marker() {
    let dir = Scratch::new("cut-marker-forged");
    let text = sample_text(&dir).replace("fingerprint=", "cut=later\nfingerprint=");
    rewrite(&dir, text);
    assert!(!cut_before(&dir, DIGEST, &fp(DIGEST)));
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);

    let mut text = sample_text(&dir);
    let cut = text.find("candidate.0").expect("the first trial");
    text.insert_str(cut, "cut=sweep\n");
    text.truncate(text.rfind("end\n").expect("the end marker"));
    rewrite(&dir, text);
    assert!(
        !cut_before(&dir, DIGEST, &fp(DIGEST)),
        "a torn marker is no marker"
    );
}

/// A rate the format must not hold: zero, negative and non-finite are
/// not measurements, however the file spells them.
#[test]
fn a_rate_that_is_not_positive_reads_as_no_record() {
    let dir = Scratch::new("bad-rate");
    for bad in ["0", "-1.5", "NaN", "inf"] {
        let text = sample_text(&dir).replace("decode-rate=49", &format!("decode-rate={bad}"));
        rewrite(&dir, text);
        assert_eq!(
            load(&dir, DIGEST, &fp(DIGEST)),
            None,
            "decode-rate={bad} must not load"
        );
    }
}

/// The score is not a claim the file gets to make: a reply whose seconds
/// do not follow from its own two rates is two truths in one line.
#[test]
fn a_reply_whose_seconds_are_not_its_rates_reads_as_no_record() {
    let dir = Scratch::new("bad-seconds");
    let held = format!("candidate.0.reply-seconds={}", gpu_reply().seconds);
    rewrite(
        &dir,
        sample_text(&dir).replace(&held, "candidate.0.reply-seconds=1"),
    );
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// A winner that is not one of the loaded trials (or not the same
/// reply) is a file that lost its middle: no record.
#[test]
fn a_winner_that_is_not_among_the_trials_reads_as_no_record() {
    let dir = Scratch::new("stray-winner");
    let base = sample_text(&dir);

    // A thread count no trial has.
    rewrite(&dir, base.replace("winner-threads=16", "winner-threads=99"));
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);

    // The same shape, another reply: rates and seconds that agree with
    // each other and with no trial's.
    let held = format!(
        "winner-prompt-rate={}\nwinner-decode-rate={}\nwinner-reply-seconds={}\n",
        gpu_reply().prompt_rate,
        gpu_reply().decode_rate,
        gpu_reply().seconds
    );
    let other = Reply::from_rates(1000.0, 48.0).expect("two measurements");
    let forged = format!(
        "winner-prompt-rate={}\nwinner-decode-rate={}\nwinner-reply-seconds={}\n",
        other.prompt_rate, other.decode_rate, other.seconds
    );
    rewrite(&dir, base.replace(&held, &forged));
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);

    // An offload no trial has.
    rewrite(
        &dir,
        base.replace("winner-offload=all", "winner-offload=forced-off"),
    );
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// One temp name per save: the pid separates processes and the
/// counter separates saves inside one, so two saves can never truncate
/// or rename each other's half-written file.
#[test]
fn temp_names_never_collide() {
    let dir = Scratch::new("temp-names");
    let first = temp_path(&path(&dir, DIGEST).expect("hex digest"));
    let second = temp_path(&path(&dir, DIGEST).expect("hex digest"));
    assert_ne!(first, second, "one name per save");
    let name = first.file_name().expect("a file name").to_string_lossy();
    assert!(
        name.contains(&std::process::id().to_string()),
        "the pid is in the name so another process cannot share it: {name}"
    );
}

/// A successful save leaves only the record: no temp of its own behind.
#[test]
fn every_save_leaves_no_temp_behind() {
    let dir = Scratch::new("no-temp");
    save(&dir, DIGEST, &sample()).expect("save");
    let names = std::fs::read_dir(&*dir)
        .expect("the dir")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
    assert_eq!(names, vec![path_last(DIGEST)], "only the record remains");
}

/// When the rename cannot land (the target is a directory), the temp
/// this save wrote is removed by its exact name — the failed save
/// leaves nothing of itself behind.
#[test]
fn a_failed_rename_removes_the_temp_it_wrote() {
    let dir = Scratch::new("failed-rename");
    std::fs::create_dir_all(path(&dir, DIGEST).expect("hex digest"))
        .expect("a directory where the file should go");
    let _error = save(&dir, DIGEST, &sample()).expect_err("a directory cannot be renamed over");
    let names = std::fs::read_dir(&*dir)
        .expect("the dir")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
    assert_eq!(names, vec![path_last(DIGEST)], "no temp outlives its save");
}

/// A candidate opened and never finished before the end marker: the
/// trials would parse as the shorter record — only the guard at `end`
/// says no.
#[test]
fn a_candidate_left_open_at_the_end_reads_as_no_record() {
    let dir = Scratch::new("open-at-end");
    let text = sample_text(&dir);
    let cut = text.rfind("end\n").expect("the end marker");
    let mut forged = String::with_capacity(text.len() + 24);
    forged.push_str(&text[..cut]);
    forged.push_str("candidate.3.backend=vulkan\n");
    forged.push_str("end\n");
    rewrite(&dir, forged);
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// The bounded retry behind every save: a file the disk refuses twice
/// and then takes lands on the third attempt — the caller never hears
/// about the refusals — and one that never lands gives up after
/// [`SAVE_ATTEMPTS`], leaving the caller's warning to say so. On Windows
/// this is a scan holding the file for a moment; without the retry the
/// next start would re-tune over a record this start already holds.
#[test]
fn a_held_file_is_retried_until_the_write_lands() {
    let dir = Scratch::new("held-write");
    let record = sample();
    let attempts = std::cell::Cell::new(0u32);
    save_with(&dir, DIGEST, &record, None, |target, text| {
        let attempt = attempts.get() + 1;
        attempts.set(attempt);
        if attempt <= 2 {
            return Err(io::Error::other("held by the scanner"));
        }
        stage_once(target, text)
    })
    .expect("the third attempt lands");
    assert_eq!(attempts.get(), 3, "two refusals, then the write");
    assert_eq!(
        load(&dir, DIGEST, &record.fingerprint),
        Some(record),
        "and the record reads back whole"
    );
}

/// The bound itself: a file that never lands stops at the last attempt —
/// no endless loop inside one step of the walk, only the error the
/// caller already warns about.
#[test]
fn a_write_that_never_lands_gives_up_after_the_bounded_attempts() {
    let dir = Scratch::new("never-lands");
    let record = sample();
    let attempts = std::cell::Cell::new(0u32);
    let result = save_with(&dir, DIGEST, &record, None, |_, _| {
        attempts.set(attempts.get() + 1);
        Err(io::Error::other("held by the scanner"))
    });
    assert!(result.is_err(), "the caller's warning stands");
    assert_eq!(
        attempts.get(),
        SAVE_ATTEMPTS,
        "five attempts, no more, no less"
    );
    assert!(
        load(&dir, DIGEST, &record.fingerprint).is_none(),
        "nothing was written"
    );
}

/// Every shape `load` would refuse is refused by `save` first, with
/// InvalidInput, and nothing is written — not even the directory.
#[test]
fn an_unloadable_record_is_refused_before_anything_is_written() {
    let good = sample();
    let trials = &good.trials;

    let no_trials = Record {
        fingerprint: good.fingerprint.clone(),
        winner: None,
        trials: vec![],
    };
    let zero_threads = Record {
        trials: vec![(
            Candidate {
                backend: ServerBackend::Cpu,
                threads: Some(0),
                offload: Offload::NoGpuBuild,
                draft: None,
            },
            Kept::Replied(Reply::from_rates(1000.0, 9.0).expect("two measurements")),
        )],
        ..good.clone()
    };
    let bad_rate = Record {
        trials: vec![(
            trials[0].0,
            Kept::Replied(Reply {
                prompt_rate: 1000.0,
                decode_rate: 0.0,
                seconds: 2.0,
            }),
        )],
        ..good.clone()
    };
    let stray_winner = Record {
        winner: Some(Winner {
            candidate: Candidate {
                backend: ServerBackend::Cpu,
                threads: Some(99),
                offload: Offload::NoGpuBuild,
                draft: None,
            },
            reply: Reply::from_rates(1000.0, 5.0).expect("two measurements"),
        }),
        ..good.clone()
    };

    // Prefixed so no scratch name collides with another test's: two
    // tests sharing a dir on one pid share their fate.
    for (name, record) in [
        ("save-no-trials", no_trials),
        ("save-zero-threads", zero_threads),
        ("save-bad-rate", bad_rate),
        ("save-stray-winner", stray_winner),
    ] {
        let dir = Scratch::new(name);
        let error =
            save(&dir, DIGEST, &record).expect_err("save must refuse what load would refuse");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{name}: {error}");
        assert!(!dir.exists(), "{name}: nothing was written");
    }
}

/// The key moves with every part that must force a re-tune: the model,
/// the per-slot window, both core counts, and either engine build.
#[test]
fn the_fingerprint_moves_with_every_part_that_matters() {
    use super::fingerprint;
    let base = fingerprint("sha", 8192, Some(16), Some(22), ("g1", "c1"), None);
    assert_eq!(
        base,
        fingerprint("sha", 8192, Some(16), Some(22), ("g1", "c1"), None),
        "the same parts are the same key"
    );
    for changed in [
        fingerprint("other", 8192, Some(16), Some(22), ("g1", "c1"), None),
        fingerprint("sha", 4096, Some(16), Some(22), ("g1", "c1"), None),
        fingerprint("sha", 8192, Some(15), Some(22), ("g1", "c1"), None),
        fingerprint("sha", 8192, Some(16), Some(21), ("g1", "c1"), None),
        fingerprint("sha", 8192, Some(16), Some(22), ("g2", "c1"), None),
        fingerprint("sha", 8192, Some(16), Some(22), ("g1", "c2"), None),
    ] {
        assert_ne!(changed, base, "every part must move the key");
    }
}

/// A refusal on disk is a closed cause, not a sentence: a path or any
/// other text a step-2 stderr line might carry is not our format.
#[test]
fn a_refusal_that_is_not_a_closed_cause_reads_as_no_record() {
    let dir = Scratch::new("free-text-refusal");
    let text = sample_text(&dir);
    rewrite(
        &dir,
        text.replace("refused=did-not-start", "refused=/home/user/llama.log"),
    );
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

/// A fingerprint is one non-empty line: the file is line-shaped, so a
/// newline or carriage return inside it would split the record into
/// something `load` reads as somebody else's (or not at all) while
/// `save` answered Ok. Refused before anything is written.
#[test]
fn a_fingerprint_that_is_not_one_line_is_refused() {
    for (name, fingerprint) in [
        ("fp-empty", ""),
        ("fp-newline", "sha-abc\nsecond line"),
        ("fp-cr", "sha-abc\rsecond line"),
    ] {
        let dir = Scratch::new(name);
        let record = Record {
            fingerprint: fingerprint.into(),
            ..sample().clone()
        };
        let error = save(&dir, DIGEST, &record).expect_err("one line or nothing");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{name}: {error}");
        assert!(!dir.exists(), "{name}: nothing was written");
    }
}

/// The builder de-duplicates candidates, so `save` refuses a record
/// that lists one launch twice — even carrying its own outcome.
#[test]
fn two_trials_of_one_launch_are_refused_by_save() {
    let base = sample();
    let mut trials = base.trials.clone();
    let (candidate, kept) = trials[0].clone();
    trials.push((candidate, kept));
    let record = Record { trials, ..base };
    let dir = Scratch::new("save-dup-trial");
    let error = save(&dir, DIGEST, &record).expect_err("one launch, one trial");
    assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{error}");
    assert!(!dir.exists(), "nothing was written");
}

/// And `load` holds the same promise against a forged file: the same
/// backend/threads/offload twice — different numbers notwithstanding —
/// is not a list this builder would have written.
#[test]
fn a_forged_duplicate_trial_reads_as_no_record() {
    let dir = Scratch::new("load-dup-trial");
    std::fs::create_dir_all(&*dir).expect("mkdir");
    let first = gpu_reply();
    let second = Reply::from_rates(1000.0, 48.0).expect("two measurements");
    let text = format!(
        "{MAGIC}\nfingerprint={}\n\
             candidate.0.backend=vulkan\ncandidate.0.threads=16\n\
             candidate.0.offload=all\ncandidate.0.prompt-rate={}\n\
             candidate.0.decode-rate={}\ncandidate.0.reply-seconds={}\n\
             candidate.1.backend=vulkan\ncandidate.1.threads=16\n\
             candidate.1.offload=all\ncandidate.1.prompt-rate={}\n\
             candidate.1.decode-rate={}\ncandidate.1.reply-seconds={}\n\
             end\n",
        fp(DIGEST),
        first.prompt_rate,
        first.decode_rate,
        first.seconds,
        second.prompt_rate,
        second.decode_rate,
        second.seconds
    );
    rewrite(&dir, text);
    assert_eq!(load(&dir, DIGEST, &fp(DIGEST)), None);
}

#[test]
fn two_models_keep_their_own_records() {
    // The store's reason for existing: two models tuned on one machine
    // must both survive, each under its own digest. The single file
    // this store replaced answered only the last one saved.
    let dir = Scratch::new("per-model");
    let mut other = sample();
    other.fingerprint = fp(OTHER_DIGEST);
    let mac = Candidate {
        backend: ServerBackend::Metal,
        threads: Some(8),
        offload: Offload::ForcedOff,
        draft: None,
    };
    other.winner = Some(Winner {
        candidate: mac,
        reply: mac_reply(),
    });
    save(&dir, DIGEST, &sample()).expect("the first model's save");
    save(&dir, OTHER_DIGEST, &other).expect("the second model's save");
    let first =
        load(&dir, DIGEST, &fp(DIGEST)).expect("the first model's record survived the second save");
    let second =
        load(&dir, OTHER_DIGEST, &fp(OTHER_DIGEST)).expect("and the second's survived the first");
    assert_eq!(first.winner.expect("kept").reply, gpu_reply());
    assert_eq!(second.winner.expect("kept").reply, mac_reply());
    assert_eq!(
        load_by_model(&dir, DIGEST)
            .expect("by name alone")
            .fingerprint,
        fp(DIGEST)
    );
}

#[test]
fn a_legacy_single_file_still_serves_its_model() {
    // A record the pre-split store wrote: one tuning.txt, holding one
    // model's tune. It keeps answering for that model — and for no
    // other — until its next re-tune files the new name.
    let dir = Scratch::new("legacy");
    save(&dir, DIGEST, &sample()).expect("save");
    std::fs::rename(path(&dir, DIGEST).expect("hex digest"), legacy_path(&dir))
        .expect("age the file by hand");
    assert!(
        load(&dir, DIGEST, &fp(DIGEST)).is_some(),
        "the legacy file answers for its own model"
    );
    assert!(
        load(&dir, OTHER_DIGEST, &fp(OTHER_DIGEST)).is_none(),
        "and for no other model"
    );
    assert!(
        load_by_model(&dir, DIGEST).is_some(),
        "the display read too"
    );
    // A retry for the OTHER model must not erase this one's legacy
    // record — the fingerprint says whose it is, and that is enough.
    invalidate(&dir, OTHER_DIGEST);
    assert!(
        load(&dir, DIGEST, &fp(DIGEST)).is_some(),
        "another model's invalidation left the legacy file alone"
    );
    // The next save for the model files the new name, and the legacy
    // file stops mattering.
    save(&dir, DIGEST, &sample()).expect("re-save");
    std::fs::remove_file(legacy_path(&dir)).expect("the legacy file is gone");
    assert!(
        load(&dir, DIGEST, &fp(DIGEST)).is_some(),
        "the per-model file stands on its own"
    );
    // Aged again by hand: this model's OWN invalidation takes it.
    std::fs::rename(path(&dir, DIGEST).expect("hex digest"), legacy_path(&dir))
        .expect("age it once more");
    invalidate(&dir, DIGEST);
    assert!(
        load(&dir, DIGEST, &fp(DIGEST)).is_none(),
        "the model's own invalidation clears its legacy file"
    );
}

#[test]
fn a_digest_outside_the_catalog_s_form_touches_no_file() {
    // The store's paths accept lowercase hex only — the catalog's own
    // pinned sha256 form. Anything else names no file: no load, no
    // save, nothing invalidated, and certainly no path pieced from an
    // unvalidated string.
    let dir = Scratch::new("not-hex");
    std::fs::create_dir_all(&*dir).expect("mkdir: nothing else here will");
    assert!(
        save(&dir, "ABC123", &sample()).is_err(),
        "uppercase is not the form"
    );
    assert!(save(&dir, "abc-123", &sample()).is_err(), "nor is a dash");
    assert!(save(&dir, "", &sample()).is_err(), "nor is nothing at all");
    assert!(load_by_model(&dir, "ABC123").is_none());
    assert!(load(&dir, "abc-123", &fp(DIGEST)).is_none());
    invalidate(&dir, "abc-123");
    let names = std::fs::read_dir(&*dir)
        .expect("the dir")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
    assert!(names.is_empty(), "nothing was written: {names:?}");
}

#[test]
fn the_legacy_file_names_the_model_its_key_carries() {
    // Only the legacy single file answers: per-model records name
    // their model by file name and are never a legacy install's.
    let dir = Scratch::new("legacy-model");
    save(&dir, DIGEST, &sample()).expect("a per-model save");
    assert_eq!(
        legacy_model(&dir),
        None,
        "a per-model record is not the legacy file"
    );
    std::fs::rename(path(&dir, DIGEST).expect("hex digest"), legacy_path(&dir)).expect("age it");
    assert_eq!(legacy_model(&dir), Some(DIGEST.to_string()));
    assert_eq!(
        legacy_model(&dir.parent().expect("parent").join("no-such")),
        None
    );
}
