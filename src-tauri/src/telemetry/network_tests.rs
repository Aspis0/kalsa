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
        assert_eq!(
            offline(),
            super::network::Outcome::Offline(super::network::Why::Refused)
        );
    }

    #[test]
    fn a_name_that_never_resolves_is_offline() {
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(2))
            .resolver(|_host: &str| Err(std::io::Error::other("no resolver in the test")))
            .build();
        let error = agent.post("http://kalsa.invalid/report").send_string("{}");
        assert_eq!(
            super::network::classify(error),
            super::network::Outcome::Offline(super::network::Why::Dns)
        );
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
        assert_eq!(
            super::network::classify(error),
            super::network::Outcome::Retry(super::network::Why::Stalled)
        );
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
        assert_eq!(
            super::network::classify(error),
            super::network::Outcome::Retry(super::network::Why::Tls)
        );
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
        dispatch(&mut store, now, super::network::Outcome::Retry(super::network::Why::Status(503)));
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
            super::network::Outcome::Retry(super::network::Why::Status(503))
        );
        let mut store = queued("server", super::now());
        let mut now = super::now();
        for _ in 0..5 {
            dispatch(&mut store, now, super::network::Outcome::Retry(super::network::Why::Status(503)));
            now += 5_000;
        }
        assert!(store.queue.is_empty());
        let state = serde_json::to_value(&store).unwrap();
        assert_eq!(state["dead"].as_array().unwrap().len(), 1);
        assert_eq!(
            super::observability::mine()
                .iter()
                .filter(|line| line.contains("report dropped after"))
                .count(),
            1,
            "the drop is said once, with the attempts: {:?}",
            super::observability::mine()
        );
        assert!(
            super::observability::mine()
                .iter()
                .any(|line| line.contains("report dropped after 5 attempts")),
            "{:?}",
            super::observability::mine()
        );
    }

#[test]
fn a_streak_of_one_answer_logs_once_and_the_recovery_logs_once() {
    let dir = std::env::temp_dir().join(format!("kalsa-reach-streak-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut store = super::store::Store::load(dir.clone());
    store.queue.push(super::store::Item {
        report: super::privacy_tests::sample(),
        attempts: 0,
        ready_at: 0,
        enqueued_at: super::now(),
        offline_streak: 0,
        in_flight: false,
        log_pending: false,
    });
    let service = std::sync::Arc::new(super::Service {
        inner: std::sync::Mutex::new(super::Inner {
            store,
            epoch: 0,
            recent: Default::default(),
            breadcrumbs: Default::default(),
            base: serde_json::json!({}),
            category: "unknown",
            total_ram: 0,
            cpu: Default::default(),
            resource_snapshot: serde_json::json!({}),
            started: None,
            last_state: None,
            last_failure: None,
            engine_stage: "load",
            reach: super::network::Reach::Through,
            crash_at: None,
            stream_error_at: None,
        }),
        send_gate: std::sync::Mutex::new(()),
    });
    // Three offline cycles, then the server is back. Each cycle advances past
    // the requeued backoff so the next pick finds its item.
    let mut when = super::now();
    for cycle in 0..4 {
        let (work, epoch) =
            super::network::pick(&service, when).expect("the pick takes the queued report");
        let out = super::network::Outbound {
            body: &|| "the redacted log\n".to_string(),
            upload: &|_| Ok("K7XQ2M9P".to_string()),
            report: &|_| {
                if cycle < 3 {
                    super::network::Outcome::Offline(super::network::Why::ConnectTimeout)
                } else {
                    super::network::Outcome::Done
                }
            },
        };
        super::network::dispatch(&service, work, epoch, when, &out);
        when += 3_600;
    }
    let lines = super::observability::mine();
    let offline: Vec<&String> = lines
        .iter()
        .filter(|line| line.contains("cannot reach the server"))
        .collect();
    assert_eq!(
        offline.len(),
        1,
        "one line for the whole streak: {lines:?}"
    );
    assert!(
        offline[0].contains("connect timeout") && offline[0].contains("1 reports waiting"),
        "{offline:?}"
    );
    assert_eq!(
        lines
            .iter()
            .filter(|line| line.contains("reports delivered again"))
            .count(),
        1,
        "one line for the recovery: {lines:?}"
    );
    assert!(
        service.inner.lock().unwrap().store.queue.is_empty(),
        "the delivered report left the queue"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

/// The words for a connect that never came up, from the parts a
/// `ureq::Transport` reads with. Its own fields are private, so a test builds
/// the parts instead of opening a socket a machine without a network would
/// answer differently.
#[test]
fn the_connect_labels_follow_the_io_source_that_caused_them() {
    use std::io::ErrorKind as Io;
    let connect = |io: Option<Io>| {
        super::network::answer(ureq::ErrorKind::ConnectionFailed, Some("Connect error"), io)
    };
    let why = |outcome| match outcome {
        super::network::Outcome::Offline(why) => why,
        other => panic!("a connect that never came up waits: {other:?}"),
    };
    assert_eq!(why(connect(Some(Io::TimedOut))), super::network::Why::ConnectTimeout);
    assert_eq!(
        why(connect(Some(Io::ConnectionRefused))),
        super::network::Why::Refused
    );
    assert_eq!(
        why(connect(Some(Io::PermissionDenied))),
        super::network::Why::ConnectFailed
    );
    assert_eq!(why(connect(None)), super::network::Why::ConnectFailed);
    assert_eq!(
        super::network::Why::ConnectTimeout.to_string(),
        "connect timeout"
    );
    assert_eq!(super::network::Why::ConnectFailed.to_string(), "connect failed");
    // The TLS handshake's own message wins over whatever the socket said.
    assert_eq!(
        super::network::answer(
            ureq::ErrorKind::ConnectionFailed,
            Some(super::network::TLS_HANDSHAKE),
            Some(Io::TimedOut),
        ),
        super::network::Outcome::Retry(super::network::Why::Tls)
    );
}

/// The transport label names only what the kind knows: a read that stopped
/// talking, and nothing more for the kinds that say nothing more.
#[test]
fn the_transport_label_names_only_what_the_kind_knows() {
    use std::io::ErrorKind as Io;
    assert_eq!(
        super::network::answer(ureq::ErrorKind::Io, None, Some(Io::TimedOut)),
        super::network::Outcome::Retry(super::network::Why::Stalled)
    );
    assert_eq!(super::network::Why::Stalled.to_string(), "read timeout");
    for kind in [
        ureq::ErrorKind::BadHeader,
        ureq::ErrorKind::BadStatus,
        ureq::ErrorKind::InsecureRequestHttpsOnly,
        ureq::ErrorKind::InvalidProxyUrl,
        ureq::ErrorKind::ProxyConnect,
        ureq::ErrorKind::ProxyUnauthorized,
        ureq::ErrorKind::TooManyRedirects,
        ureq::ErrorKind::UnknownScheme,
        ureq::ErrorKind::InvalidUrl,
        ureq::ErrorKind::HTTP,
    ] {
        assert_eq!(
            super::network::answer(kind, None, None),
            super::network::Outcome::Retry(super::network::Why::Transport),
            "{kind:?}"
        );
    }
    assert_eq!(super::network::Why::Transport.to_string(), "transport error");
    // The name that never resolved stays offline whatever follows it.
    assert_eq!(
        super::network::answer(ureq::ErrorKind::Dns, None, None),
        super::network::Outcome::Offline(super::network::Why::Dns)
    );
}

#[test]
fn a_rejection_is_an_answer_so_the_next_offline_streak_says_its_line() {
    let dir = std::env::temp_dir().join(format!("kalsa-rejected-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut store = super::store::Store::load(dir.clone());
    for n in 0..2 {
        let mut report = super::privacy_tests::sample();
        report["osMajor"] = serde_json::json!(format!("{n}"));
        store.queue.push(super::store::Item {
            report,
            attempts: 0,
            ready_at: 0,
            enqueued_at: super::now(),
            offline_streak: 0,
            in_flight: false,
            log_pending: false,
        });
    }
    let service = std::sync::Arc::new(super::Service {
        inner: std::sync::Mutex::new(super::Inner {
            store,
            epoch: 0,
            recent: Default::default(),
            breadcrumbs: Default::default(),
            base: serde_json::json!({}),
            category: "unknown",
            total_ram: 0,
            cpu: Default::default(),
            resource_snapshot: serde_json::json!({}),
            started: None,
            last_state: None,
            last_failure: None,
            engine_stage: "load",
            reach: super::network::Reach::Through,
            crash_at: None,
            stream_error_at: None,
        }),
        send_gate: std::sync::Mutex::new(()),
    });
    let answers = [
        super::network::Outcome::Offline(super::network::Why::Refused),
        super::network::Outcome::Rejected(400),
        super::network::Outcome::Offline(super::network::Why::Refused),
    ];
    let mut when = super::now();
    for answer in answers {
        let (work, epoch) =
            super::network::pick(&service, when).expect("the pick takes a queued report");
        let out = super::network::Outbound {
            body: &|| "the redacted log\n".to_string(),
            upload: &|_| Ok("K7XQ2M9P".to_string()),
            report: &|_| answer,
        };
        super::network::dispatch(&service, work, epoch, when, &out);
        when += 3_600;
    }
    let lines = super::observability::mine();
    let streaks: Vec<&String> = lines
        .iter()
        .filter(|line| line.contains("cannot reach the server"))
        .collect();
    assert_eq!(
        streaks.len(),
        2,
        "the rejection is an answer, so the second streak is a change: {lines:?}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn an_engine_start_says_nothing_about_the_telemetry_server() {
    let dir = std::env::temp_dir().join(format!("kalsa-start-reach-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut store = super::store::Store::load(dir.clone());
    store.queue.push(super::store::Item {
        report: super::privacy_tests::sample(),
        attempts: 0,
        ready_at: 0,
        enqueued_at: super::now(),
        offline_streak: 0,
        in_flight: false,
        log_pending: false,
    });
    let service = std::sync::Arc::new(super::Service {
        inner: std::sync::Mutex::new(super::Inner {
            store,
            epoch: 0,
            recent: Default::default(),
            breadcrumbs: Default::default(),
            base: serde_json::json!({}),
            category: "unknown",
            total_ram: 0,
            cpu: Default::default(),
            resource_snapshot: serde_json::json!({}),
            started: None,
            last_state: None,
            last_failure: None,
            engine_stage: "load",
            reach: super::network::Reach::Through,
            crash_at: None,
            stream_error_at: None,
        }),
        send_gate: std::sync::Mutex::new(()),
    });
    let streaks = |lines: &[String]| {
        lines
            .iter()
            .filter(|line| line.contains("cannot reach the server"))
            .count()
    };
    let mut when = super::now();
    // The offline streak's one line.
    let (work, epoch) = super::network::pick(&service, when).expect("the pick takes the item");
    let out = super::network::Outbound {
        body: &|| "the redacted log\n".to_string(),
        upload: &|_| Ok("K7XQ2M9P".to_string()),
        report: &|_| super::network::Outcome::Offline(super::network::Why::Refused),
    };
    super::network::dispatch(&service, work, epoch, when, &out);
    when += 3_600;
    assert_eq!(streaks(&super::observability::mine()), 1);
    // The local model starting again says nothing about the server.
    super::restart(&mut service.inner.lock().unwrap());
    let (work, epoch) = super::network::pick(&service, when).expect("the pick takes the item");
    super::network::dispatch(&service, work, epoch, when, &out);
    when += 3_600;
    assert_eq!(
        streaks(&super::observability::mine()),
        1,
        "an engine start is not a reachability change: {:?}",
        super::observability::mine()
    );
    // The preference switch is the one thing that starts a fresh streak: the
    // switch clears the queue, so the report that follows is a new one.
    super::commands::set_preference(&service, true).expect("the switch is saved");
    service.inner.lock().unwrap().store.queue.push(super::store::Item {
        report: super::privacy_tests::sample(),
        attempts: 0,
        ready_at: 0,
        enqueued_at: super::now(),
        offline_streak: 0,
        in_flight: false,
        log_pending: false,
    });
    let (work, epoch) = super::network::pick(&service, when).expect("the pick takes the item");
    super::network::dispatch(&service, work, epoch, when, &out);
    assert_eq!(
        streaks(&super::observability::mine()),
        2,
        "a fresh session says the reach again: {:?}",
        super::observability::mine()
    );
    std::fs::remove_dir_all(dir).unwrap();
}
