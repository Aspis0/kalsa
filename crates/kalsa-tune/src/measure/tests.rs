    use super::*;
    use kalsa_launch::Offload;
    use kalsa_runtime::ServerBackend;
    use std::cell::RefCell;

    fn cpu(threads: usize) -> Candidate {
        Candidate {
            backend: ServerBackend::Cpu,
            threads: Some(threads),
            offload: Offload::NoGpuBuild,
        }
    }

    fn gpu() -> Candidate {
        Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(16),
            offload: Offload::All,
        }
    }

    fn measured(value: f64) -> Result<Vec<f64>, Refusal> {
        Ok(vec![value])
    }

    /// A candidate with the exe the step would have resolved for it: the
    /// pairing travels, so the tests never lose one either.
    fn on(candidate: Candidate) -> (Candidate, PathBuf) {
        (candidate, PathBuf::from("/stub-exe"))
    }

    /// The Lenovo shape: a 4x GPU lead cannot be overturned by a re-run
    /// of anything, so round two never happens — one lifetime each, in
    /// list order.
    #[test]
    fn the_lenovo_shape_ends_after_one_round() {
        let candidates = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
        let ran = RefCell::new(Vec::new());
        let results = rounds(
            &candidates,
            TOTAL_BUDGET,
            || Duration::ZERO,
            |candidate, _| {
                let at = candidates
                    .iter()
                    .position(|(other, _)| other == candidate)
                    .expect("one of ours");
                ran.borrow_mut().push(at);
                match at {
                    0 => measured(45.4),
                    1 => measured(11.8),
                    _ => measured(12.0),
                }
            },
            &mut |_, _| {},
        );
        assert_eq!(*ran.borrow(), vec![0, 1, 2], "one round, list order");
        assert_eq!(results.len(), 3);
        assert!(results.iter().all(|(_, outcome)| outcome.best().is_some()));
    }

    /// The Surface shape: two candidates a few percent apart both earn a
    /// second lifetime, and both rounds' samples pool — four numbers for
    /// two candidates, not a replacement.
    #[test]
    fn the_surface_shape_gets_a_second_round_pooled() {
        let candidates = vec![on(cpu(4)), on(cpu(8))];
        let ran = RefCell::new(Vec::new());
        let progress_seen = RefCell::new(Vec::new());
        let results = rounds(
            &candidates,
            TOTAL_BUDGET,
            || Duration::ZERO,
            |candidate, _| {
                let at = candidates
                    .iter()
                    .position(|(other, _)| other == candidate)
                    .expect("one of ours");
                let round = ran.borrow().iter().filter(|&&seen| seen == at).count();
                ran.borrow_mut().push(at);
                match (at, round) {
                    (0, 0) => measured(7.5),
                    (0, _) => measured(7.6),
                    (1, 0) => measured(8.0),
                    _ => measured(7.9),
                }
            },
            &mut |done, planned| progress_seen.borrow_mut().push((done, planned)),
        );
        assert_eq!(
            *progress_seen.borrow(),
            vec![(0, 2), (1, 2), (2, 4), (3, 4), (4, 4)],
            "the plan grows for round two and the final call equals what ran"
        );
        assert_eq!(*ran.borrow(), vec![0, 1, 0, 1], "both candidates, both rounds");
        for (candidate, outcome) in &results {
            let rates = match outcome {
                Outcome::Measured(rates) => rates,
                other => panic!("{candidate:?} refused: {other:?}"),
            };
            assert_eq!(rates.len(), 2, "one sample per round, pooled");
        }
    }

    /// A refusal earns no re-run: round two is for near-tops, and a
    /// candidate with no rate cannot be one. The near pair still runs.
    #[test]
    fn a_refusal_in_round_one_is_never_rerun() {
        let candidates = vec![on(cpu(4)), on(cpu(8)), on(cpu(16))];
        let ran = RefCell::new(Vec::new());
        let results = rounds(
            &candidates,
            TOTAL_BUDGET,
            || Duration::ZERO,
            |candidate, _| {
                let at = candidates
                    .iter()
                    .position(|(other, _)| other == candidate)
                    .expect("one of ours");
                ran.borrow_mut().push(at);
                match at {
                    0 => measured(10.0),
                    1 => measured(9.5),
                    _ => Err(Refusal::NotReady),
                }
            },
            &mut |_, _| {},
        );
        assert_eq!(*ran.borrow(), vec![0, 1, 2, 0, 1], "the refused candidate ran once");
        assert_eq!(results[2].1, Outcome::Refused(Refusal::NotReady));
        assert_eq!(results[0].1.best(), Some(10.0));
    }

    /// The samples of a dead child count for nothing: the port was free
    /// before the spawn, so a child that died means the answers may have
    /// been somebody else's — however good they look.
    #[test]
    fn the_answers_of_a_dead_child_count_for_nothing() {
        assert_eq!(
            conclude(vec![9.9], false, true),
            Err(Refusal::DidNotStart)
        );
        assert_eq!(conclude(vec![], true, true), Err(Refusal::NoUsableAnswer));
        assert_eq!(conclude(vec![7.5], true, true), Ok(vec![7.5]));
    }

    /// The identity gate: samples taken while the port serves somebody
    /// else's model are somebody else's samples.
    #[test]
    fn answers_from_a_port_serving_another_model_count_for_nothing() {
        assert_eq!(
            conclude(vec![99.9], true, false),
            Err(Refusal::DidNotStart),
            "a fast answer from the wrong server is not our measurement"
        );
    }

    /// The caller's aliases come off in the two forms the engine's parser
    /// actually knows — whole-token lookup, value in the next token — and
    /// nothing else moves: an `=`-shaped token is not an alias to this
    /// parser, so it is left as it was given.
    #[test]
    fn the_callers_aliases_are_removed_and_nothing_else() {
        let argv = vec![
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--alias".to_string(),
            "owner-name".to_string(),
            "--model".to_string(),
            "/m.gguf".to_string(),
            "-a".to_string(),
            "short".to_string(),
            "--alias=equals".to_string(),
            "--port".to_string(),
            "8131".to_string(),
        ];
        assert_eq!(
            without_aliases(argv),
            vec![
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--model".to_string(),
                "/m.gguf".to_string(),
                "--alias=equals".to_string(),
                "--port".to_string(),
                "8131".to_string(),
            ]
        );
    }

    /// No entropy, no panic: the lifetime refuses without spawning.
    #[test]
    fn a_nonce_that_cannot_be_drawn_is_a_refusal_not_a_panic() {
        assert_eq!(nonce_from(|_| Err::<(), _>("no entropy")), None);
        assert!(nonce_from(|_| Ok::<(), ()>(())).is_some());
    }

    /// The nonce's shape and freshness — the `kalsa-tune-` prefix, 128
    /// bits of hex, and two draws that differ. It does not prove no model
    /// on earth is called that; the aliases check proves ours is listed.
    #[test]
    fn a_nonce_is_unlike_any_model_name() {
        let nonce = fresh_nonce().expect("this machine has entropy");
        assert!(nonce.starts_with("kalsa-tune-"), "{nonce}");
        assert_eq!(nonce.len(), "kalsa-tune-".len() + 32, "{nonce}");
        assert_ne!(
            fresh_nonce().expect("this machine has entropy"),
            nonce,
            "a fresh identity per lifetime"
        );
    }

    /// The budget is checked before each lifetime, never inside one: the
    /// candidate that started ran to completion, and the ones behind it
    /// are simply absent — nothing is killed mid-measure.
    #[test]
    fn an_exhausted_budget_leaves_later_candidates_absent() {
        let candidates = vec![on(cpu(4)), on(cpu(8)), on(cpu(16))];
        let ran = RefCell::new(Vec::new());
        let progress_seen = RefCell::new(Vec::new());
        let clock = RefCell::new(0u32);
        let results = rounds(
            &candidates,
            TOTAL_BUDGET,
            || {
                let tick = {
                    let mut clock = clock.borrow_mut();
                    *clock += 1;
                    *clock
                };
                if tick == 1 {
                    Duration::ZERO
                } else {
                    TOTAL_BUDGET
                }
            },
            |candidate, _| {
                let at = candidates
                    .iter()
                    .position(|(other, _)| other == candidate)
                    .expect("one of ours");
                ran.borrow_mut().push(at);
                measured(9.0 + at as f64)
            },
            &mut |done, planned| progress_seen.borrow_mut().push((done, planned)),
        );
        assert_eq!(*ran.borrow(), vec![0], "only the lifetime that fit the budget ran");
        assert_eq!(results.len(), 1, "the later candidates are absent, not failed");
        assert_eq!(results[0].1, Outcome::Measured(vec![9.0]), "the started lifetime completed");
        // (done, planned) is monotonic until the last call, and the last
        // call lowers the plan to what really ran — and equals it.
        let seen = progress_seen.borrow();
        assert_eq!(*seen, vec![(0, 3), (1, 1)], "the plan may only shrink at the end");
        assert_eq!(seen.last(), Some(&(1, 1)), "the final plan is what ran");
    }

