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
                (cpu16, Kept::Refused("it did not load".into())),
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

    /// A cut inside a refusal: the reason loads shorter and looks
    /// complete — only the missing end says otherwise.
    #[test]
    fn a_file_cut_inside_a_refusal_reads_as_no_record() {
        let dir = Scratch::new("cut-refusal");
        let text = sample_text(&dir);
        let cut = text.find("it did not load").expect("the refusal") + 6;
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

