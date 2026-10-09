    #[test]
    fn contract_rejections_are_retained_with_a_bounded_dead_letter_queue() {
        let response = ureq::Response::new(400, "Bad Request", "PRIVATE-BODY-CANARY").unwrap();
        let outcome = super::network::classify(Err(ureq::Error::Status(400, response)));
        assert_eq!(outcome, super::network::Outcome::Rejected(400));
        let dir =
            std::env::temp_dir().join(format!("kalsa-contract-rejection-{}", std::process::id()));
        let mut store = super::store::Store::load(dir.clone());
        for _ in 0..105 {
            let item = super::store::Item {
                report: super::privacy_tests::sample(),
                attempts: 1,
                ready_at: 0,
                enqueued_at: 0,
                offline_streak: 0,
                in_flight: false,
                log_pending: false,
            };
            super::network::complete(
                &mut store,
                item,
                super::now(),
                super::network::Outcome::Rejected(400),
            );
        }
        store.save().unwrap();
        let state = serde_json::to_value(super::store::Store::load(dir.clone())).unwrap();
        assert_eq!(state["dead"].as_array().unwrap().len(), 100);
        assert!(!state.to_string().contains("PRIVATE-BODY-CANARY"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn retry_bands_match_phone_and_are_bounded() {
        assert_eq!(super::network::backoff(1, 25), 60);
        assert_eq!(super::network::backoff(4, 25), 480);
        assert_eq!(super::network::backoff(20, 25), 3600);
    }

    fn offline() -> super::network::Outcome {
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(2))
            .build();
        let error = agent.post("http://127.0.0.1:1/report").send_string("{}");
        super::network::classify(error)
    }

    /// A listener that accepts a connection and then says nothing.
    fn silent_listener(closes: bool) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                if closes {
                    drop(stream);
                } else {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
            }
        });
        port
    }

    /// One drain cycle: the queued report leaves the queue, its attempt is
    /// bumped and persisted before dispatch, and the answer lands in complete.
    fn dispatch(store: &mut super::store::Store, now: u64, outcome: super::network::Outcome) {
        let mut item = store.queue.remove(0);
        item.attempts += 1;
        super::network::complete(store, item, now, outcome);
    }

    fn queued(name: &str, now: u64) -> super::store::Store {
        let dir = std::env::temp_dir().join(format!("kalsa-{name}-{}", std::process::id()));
        let mut store = super::store::Store::load(dir.clone());
        store.queue.push(super::store::Item {
            report: super::privacy_tests::sample(),
            attempts: 0,
            ready_at: 0,
            enqueued_at: now,
            offline_streak: 0,
            in_flight: false,
            log_pending: false,
        });
        std::fs::remove_dir_all(dir).unwrap();
        store
    }

    #[test]
    fn a_refused_connection_is_an_attempt_the_server_never_answered() {
        assert_eq!(offline(), super::network::Outcome::Offline);
    }

    #[test]
    fn a_name_that_never_resolves_is_offline() {
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(2))
            .resolver(|_host: &str| Err(std::io::Error::other("no resolver in the test")))
            .build();
        let error = agent.post("http://kalsa.invalid/report").send_string("{}");
        assert_eq!(super::network::classify(error), super::network::Outcome::Offline);
    }

    #[test]
    fn a_server_that_connects_then_stalls_is_a_server_answer() {
        let port = silent_listener(false);
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_millis(300))
            .build();
        let error = agent
            .post(&format!("http://127.0.0.1:{port}/report"))
            .send_string("{}");
        assert_eq!(super::network::classify(error), super::network::Outcome::Retry);
    }

    #[test]
    fn a_tls_handshake_that_never_completes_is_a_server_answer() {
        let port = silent_listener(true);
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(2))
            .build();
        let error = agent
            .post(&format!("https://127.0.0.1:{port}/report"))
            .send_string("{}");
        assert_eq!(super::network::classify(error), super::network::Outcome::Retry);
    }

    #[test]
    fn the_offline_streak_grows_the_backoff_to_the_hour_cap() {
        let mut store = queued("streak", super::now());
        let mut now = super::now();
        let mut delays = Vec::new();
        for _ in 0..10 {
            dispatch(&mut store, now, offline());
            delays.push(store.queue[0].ready_at - now);
            now += 4_000;
        }
        assert_eq!(store.queue[0].offline_streak, 10);
        assert_eq!(store.queue[0].attempts, 0);
        assert!(delays[9] >= 30 * 60, "the backoff must grow: {delays:?}");
        assert!(delays[9] <= super::network::MAX_DELAY);
        assert!(delays[9] > delays[0], "the backoff must grow: {delays:?}");
        // A server answer ends the streak: the next offline gap starts over.
        dispatch(&mut store, now, super::network::Outcome::Retry);
        now += 5_000;
        assert_eq!(store.queue[0].offline_streak, 0);
        dispatch(&mut store, now, offline());
        assert_eq!(store.queue[0].offline_streak, 1);
        assert_eq!(store.queue[0].attempts, 1);
        assert!(store.queue[0].ready_at - now < 30 * 60);
    }

    #[test]
    fn twenty_offline_failures_then_success_is_sent_and_never_dead_lettered() {
        let mut store = queued("offline", super::now());
        let mut now = super::now();
        for cycle in 0..20 {
            dispatch(&mut store, now, offline());
            assert_eq!(
                store.queue.len(),
                1,
                "cycle {cycle}: an offline failure requeues the report"
            );
            assert_eq!(
                store.queue[0].attempts, 0,
                "cycle {cycle}: an offline failure consumes no attempt"
            );
            assert!(store.queue[0].ready_at - now <= super::network::MAX_DELAY);
            now += 4_000;
        }
        dispatch(&mut store, now, super::network::Outcome::Done);
        assert!(store.queue.is_empty());
        let state = serde_json::to_value(&store).unwrap();
        assert!(state["dead"].as_array().unwrap().is_empty());
    }

    #[test]
    fn five_server_errors_still_dead_letter_the_report() {
        let response = ureq::Response::new(503, "Service Unavailable", "BODY").unwrap();
        assert_eq!(
            super::network::classify(Err(ureq::Error::Status(503, response))),
            super::network::Outcome::Retry
        );
        let mut store = queued("server", super::now());
        let mut now = super::now();
        for _ in 0..5 {
            dispatch(&mut store, now, super::network::Outcome::Retry);
            now += 5_000;
        }
        assert!(store.queue.is_empty());
        let state = serde_json::to_value(&store).unwrap();
        assert_eq!(state["dead"].as_array().unwrap().len(), 1);
    }
