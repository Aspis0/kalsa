    use super::*;
    use crate::candidates::offload_for;

    /// A scratch directory that cleans itself up even when the test
    /// panics: a leftover temp dir is not a failure anyone can see.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "kalsa-tune-record-{name}-{}",
                std::process::id()
            ));
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

    fn sample() -> Record {
        let cpu16 = Candidate {
            backend: ServerBackend::Cpu,
            threads: Some(16),
            offload: offload_for(ServerBackend::Cpu),
        };
        let gpu = Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(16),
            offload: Offload::All,
        };
        let mac = Candidate {
            backend: ServerBackend::Metal,
            threads: Some(8),
            offload: Offload::ForcedOff,
        };
        Record {
            fingerprint: "sha-abc|ctx8192|machine".into(),
            winner: Some(Winner { candidate: gpu, best: 49.0 }),
            trials: vec![
                (gpu, Kept::Best(49.0)),
                (cpu16, Kept::Refused(Refusal::DidNotStart)),
                (mac, Kept::Best(21.0)),
            ],
        }
    }

    /// The saved text of `sample()`, for the cut-boundary tests.
    fn sample_text(dir: &Path) -> String {
        save(dir, &sample()).expect("save");
        std::fs::read_to_string(path(dir)).expect("read")
    }

    fn rewrite(dir: &Path, text: impl AsRef<[u8]>) {
        std::fs::write(path(dir), text).expect("rewrite");
    }

    #[test]
    fn a_record_survives_a_restart_with_the_same_fingerprint() {
        let dir = Scratch::new("roundtrip");
        let record = sample();
        save(&dir, &record).expect("save");
        let loaded = load(&dir, &record.fingerprint).expect("load");
        assert_eq!(loaded, record);
        std::fs::remove_file(path(&dir)).expect("remove");
        assert_eq!(load(&dir, &record.fingerprint), None);
    }

    #[test]
    fn a_changed_machine_or_model_reads_as_no_record() {
        let dir = Scratch::new("fingerprint");
        save(&dir, &sample()).expect("save");
        assert_eq!(load(&dir, "sha-other|ctx8192|machine"), None);
    }

    #[test]
    fn a_corrupt_value_reads_as_no_record() {
        let dir = Scratch::new("corrupt");
        let text = sample_text(&dir).replace("best=49", "best=banana");
        rewrite(&dir, text);
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
    }

    /// A cut before the winner: the trials parse completely and there is
    /// no winner line — indistinguishable from a real no-winner tune
    /// unless the end marker is what makes it a record at all.
    #[test]
    fn a_file_cut_before_the_winner_reads_as_no_record() {
        let dir = Scratch::new("cut-before-winner");
        let text = sample_text(&dir);
        let cut = text.find("winner-backend").expect("the sample has a winner");
        rewrite(&dir, &text[..cut]);
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
    }

    /// A cut inside a later candidate: the earlier ones parse and the
    /// later one is half-written — a complete key line, then nothing. The
    /// end marker is the only guard.
    #[test]
    fn a_file_cut_inside_a_candidate_reads_as_no_record() {
        let dir = Scratch::new("cut-candidate");
        let text = sample_text(&dir);
        let cut = text.find("candidate.1.threads").expect("the second trial's fields");
        rewrite(&dir, &text[..cut]);
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
    }

    /// A cut right after a refusal line. The cause itself can no longer be
    /// cut into something loadable — a closed name parses whole or not at
    /// all — so the boundary that still matters is the one after it: the
    /// file must not end before its `end`.
    #[test]
    fn a_file_cut_after_a_refusal_reads_as_no_record() {
        let dir = Scratch::new("cut-refusal");
        let text = sample_text(&dir);
        let cut = text.find("candidate.2.backend").expect("the trial after the refusal");
        rewrite(&dir, &text[..cut]);
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
    }

    #[test]
    fn a_foreign_magic_reads_as_no_record() {
        let dir = Scratch::new("foreign");
        save(&dir, &sample()).expect("save");
        // Our shape, another tool's magic: only the exact magic line
        // stands between this file and being believed.
        let text = std::fs::read_to_string(path(&dir)).expect("read");
        let foreign = text.replacen(MAGIC, "another-tool v7", 1);
        rewrite(&dir, foreign);
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
    }

    /// A version bump is not our version: the magic is the whole line,
    /// not a prefix.
    #[test]
    fn a_version_bump_reads_as_no_record() {
        let dir = Scratch::new("v10");
        save(&dir, &sample()).expect("save");
        let text = std::fs::read_to_string(path(&dir)).expect("read");
        rewrite(&dir, text.replacen(MAGIC, "kalsa-tune v10", 1));
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
    }

    /// A rate the format must not hold: zero, negative and non-finite are
    /// not measurements, however the file spells them.
    #[test]
    fn a_best_that_is_not_positive_reads_as_no_record() {
        let dir = Scratch::new("bad-best");
        for bad in ["0", "-1.5", "NaN", "inf"] {
            let text = sample_text(&dir).replace("best=49", &format!("best={bad}"));
            rewrite(&dir, text);
            assert_eq!(
                load(&dir, "sha-abc|ctx8192|machine"),
                None,
                "best={bad} must not load"
            );
        }
    }

    /// A winner that is not one of the loaded trials (or not the same
    /// number) is a file that lost its middle: no record.
    #[test]
    fn a_winner_that_is_not_among_the_trials_reads_as_no_record() {
        let dir = Scratch::new("stray-winner");
        let base = sample_text(&dir);

        // A thread count no trial has.
        rewrite(&dir, base.replace("winner-threads=16", "winner-threads=99"));
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);

        // The same trial, a different number.
        rewrite(&dir, base.replace("winner-best=49", "winner-best=48"));
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);

        // An offload no trial has.
        rewrite(&dir, base.replace("winner-offload=all", "winner-offload=forced-off"));
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
    }

    /// One temp name per save: the pid separates processes and the
    /// counter separates saves inside one, so two saves can never truncate
    /// or rename each other's half-written file.
    #[test]
    fn temp_names_never_collide() {
        let dir = Scratch::new("temp-names");
        let first = temp_path(&dir);
        let second = temp_path(&dir);
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
        save(&dir, &sample()).expect("save");
        let names = std::fs::read_dir(&*dir)
            .expect("the dir")
            .map(|entry| entry.expect("an entry").file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(names, vec![FILE_NAME.to_string()], "only the record remains");
    }

    /// When the rename cannot land (the target is a directory), the temp
    /// this save wrote is removed by its exact name — the failed save
    /// leaves nothing of itself behind.
    #[test]
    fn a_failed_rename_removes_the_temp_it_wrote() {
        let dir = Scratch::new("failed-rename");
        std::fs::create_dir_all(path(&dir)).expect("a directory where the file should go");
        let _error = save(&dir, &sample()).expect_err("a directory cannot be renamed over");
        let names = std::fs::read_dir(&*dir)
            .expect("the dir")
            .map(|entry| entry.expect("an entry").file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(names, vec![FILE_NAME.to_string()], "no temp outlives its save");
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
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
    }

    /// Every shape `load` would refuse is refused by `save` first, with
    /// InvalidInput, and nothing is written — not even the directory.
    #[test]
    fn an_unloadable_record_is_refused_before_anything_is_written() {
        let good = sample();
        let trials = &good.trials;

        let no_trials = Record { fingerprint: good.fingerprint.clone(), winner: None, trials: vec![] };
        let zero_threads = Record {
            trials: vec![(
                Candidate { backend: ServerBackend::Cpu, threads: Some(0), offload: Offload::NoGpuBuild },
                Kept::Best(9.0),
            )],
            ..good.clone()
        };
        let bad_best = Record {
            trials: vec![(trials[0].0, Kept::Best(0.0))],
            ..good.clone()
        };
        let stray_winner = Record {
            winner: Some(Winner {
                candidate: Candidate {
                    backend: ServerBackend::Cpu,
                    threads: Some(99),
                    offload: Offload::NoGpuBuild,
                },
                best: 5.0,
            }),
            ..good.clone()
        };

        // Prefixed so no scratch name collides with another test's: two
        // tests sharing a dir on one pid share their fate.
        for (name, record) in [
            ("save-no-trials", no_trials),
            ("save-zero-threads", zero_threads),
            ("save-bad-best", bad_best),
            ("save-stray-winner", stray_winner),
        ] {
            let dir = Scratch::new(name);
            let error = save(&dir, &record)
                .expect_err("save must refuse what load would refuse");
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{name}: {error}");
            assert!(!dir.exists(), "{name}: nothing was written");
        }
    }

    /// A refusal on disk is a closed cause, not a sentence: a path or any
    /// other text a step-2 stderr line might carry is not our format.
    #[test]
    fn a_refusal_that_is_not_a_closed_cause_reads_as_no_record() {
        let dir = Scratch::new("free-text-refusal");
        let text = sample_text(&dir);
        rewrite(&dir, text.replace("refused=did-not-start", "refused=/home/user/llama.log"));
        assert_eq!(load(&dir, "sha-abc|ctx8192|machine"), None);
    }
