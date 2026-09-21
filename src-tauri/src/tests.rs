use super::*;

#[test]
fn the_window_is_allowed_to_hear_the_walk() {
    // Tauri v2 grants nothing by default. With no capability file the
    // event bus is simply dead: `listen` returns a promise that never
    // settles, there is no error anywhere, and the page sits through the
    // whole walk -- measuring, then a download that reached 22.13 GB --
    // saying "Getting ready" and nothing else. It cost an evening to
    // find because the only symptom is silence.
    //
    // No frontend test can see this: the harness stubs the bus, so it
    // passes whether or not the real one is reachable. This is the only
    // place the grant can be checked.
    const CAPABILITY: &str = include_str!("../capabilities/default.json");
    assert!(
        CAPABILITY.contains("core:event:default"),
        "the window cannot hear brain_progress: {CAPABILITY}"
    );
    assert!(
        CAPABILITY.contains("\"main\""),
        "the grant names no window, so it reaches none: {CAPABILITY}"
    );
}
use kalsa_probe::{ExecutionPath, Reliability, Series};
use std::time::Duration;

/// A reliable measurement by hand: `bandwidth` on the CPU path, the shape
/// the probe returns when it believes itself.
fn measured(bandwidth: f64) -> Measurement {
    Measurement {
        ramp: vec![(2, bandwidth)],
        ceiling_bytes_per_second: bandwidth,
        // No chip figure in a fixture: the test machine is whatever
        // `ceiling` says, so the floor rule stays the backend's own.
        decode_bytes_per_second: None,
        ceiling: Series::new(vec![bandwidth]),
        plateau_threads: 2,
        cache: Series::new(vec![200.0e9]),
        compute: Series::new(vec![100.0e9]),
        reliability: Reliability {
            reliable: true,
            effective_parallelism: None,
            threads: 2,
            spread: 0.0,
            cache_ratio: None,
            notes: Vec::new(),
        },
        measured_on: ExecutionPath::Cpu,
        will_run_on: kalsa_probe::Backend::Cpu,
    }
}

#[test]
fn a_failed_walk_still_leaves_a_reliable_measurement_kept() {
    // The walk measures the machine (seconds of real work), the catalog
    // then refuses — here, nothing fits — and the refusal answers the
    // screen. But the machine WAS measured, and what was measured must
    // survive the refusal, or every retry measures again and throws it
    // away again.
    let brain = Brain::new();
    let verdict = settle_walk(
        &brain,
        (
            Err("No model that fits this computer is available yet. \
                 An app update may add one."
                .into()),
            Some(measured(80.0e9)),
        ),
    );
    assert!(verdict.is_err(), "the walk's refusal still answers");
    assert!(
        brain.measurement.lock().expect("lock").is_some(),
        "the measurement survived the walk's failure"
    );
    // The discipline is not weakened by carrying the measurement further:
    // a reading the probe itself does not believe is still refused, and
    // an unreliable one never replaces the reliable one already kept.
    let mut unbelieved = measured(80.0e9);
    unbelieved.reliability.reliable = false;
    let second = settle_walk(&brain, (Err("still refused".into()), Some(unbelieved)));
    assert!(
        second.is_err(),
        "an unreliable reading does not turn the refusal into a success"
    );
    let stored = brain.measurement.lock().expect("lock");
    assert!(
        stored.as_ref().is_some_and(|kept| kept.is_reliable()),
        "what is kept is the reliable reading, nothing else"
    );
}

#[test]
fn an_unreadable_credential_store_does_not_fail_a_running_brain() {
    // A store this app cannot read stands the DOOR down; the brain —
    // running, answering the local chat — does not report itself failed
    // for it. The problem stays visible where pairing lives, on the
    // Devices page, which reads the same store every poll.
    let brain = Brain::new();
    let unreadable = std::env::temp_dir().join(format!(
        "kalsa-brain-unreadable-store-{}.json",
        std::process::id()
    ));
    std::fs::write(&unreadable, b"\x00\x01 neither json nor ours").expect("write");
    let outcome = brain.start_door_if_paired(8130, &unreadable, false);
    let _ = std::fs::remove_file(&unreadable);
    assert!(
        outcome.is_ok(),
        "the brain's state must not fail for the door's store: {outcome:?}"
    );
    assert!(
        brain.door_port().is_none(),
        "the door stood down rather than serving what it cannot read"
    );
}

#[test]
fn a_second_press_while_a_walk_is_running_starts_nothing() {
    let brain = Brain::new();
    assert!(brain.begin_turn_on(), "the first press goes through");
    assert!(
        !brain.begin_turn_on(),
        "a second press while the first is still going is refused: \
         no second decide, no second download, no second server"
    );
    assert!(!brain.begin_turn_on(), "refusal holds until the walk ends");
    brain.turning_on.store(false, Ordering::SeqCst);
    assert!(brain.begin_turn_on(), "a finished walk frees the next one");
}

#[test]
fn the_model_page_reads_the_name_from_the_launch_record() {
    let brain = Brain::new();
    assert_eq!(
        brain.model_dto().display_name,
        None,
        "nothing launched, no name invented"
    );
    assert_eq!(
        brain.model_dto().reason,
        None,
        "nothing launched, no reason invented"
    );
    brain.record_launch(
        startup::LaunchInfo {
            args: launch_args("/models/chosen.gguf", startup::PORT),
            maximum_context: startup::ContextMaxima {
                q8_0: Some(8192),
                f16: Some(4096),
            },
            automatic_context: startup::ContextMaxima {
                q8_0: Some(8192),
                f16: Some(4096),
            },
            context_prices: Default::default(),
            display_name: Some("IBM Granite 4 Tiny".to_string()),
            reason: Some("It is the more capable of the two.".to_string()),
        },
        StartOutcome::Accepted,
    );
    let dto = brain.model_dto();
    assert_eq!(
        dto.display_name.as_deref(),
        Some("IBM Granite 4 Tiny"),
        "the catalog's own name, not a filename"
    );
    assert_eq!(
        dto.reason.as_deref(),
        Some("It is the more capable of the two."),
        "the catalog's own reason for this start, not a general rule"
    );
    assert!(dto.chosen, "a catalog-chosen launch is chosen");
}

#[test]
fn a_development_override_counts_as_chosen_without_a_catalog_name() {
    // The dev override configures a model the catalog never chose and
    // the launch record cannot name: the page must still say "chosen",
    // which is the override's whole purpose.
    assert!(model_chosen(Some("IBM Granite 4 Tiny"), false));
    assert!(model_chosen(None, true));
    assert!(!model_chosen(None, false), "neither fact, no model");
}

#[test]
fn a_running_state_says_where_the_local_server_answers_and_what_it_launched() {
    let dto = StateDto::Running {
        port: startup::PORT,
        endpoint: Some(format!("http://127.0.0.1:{}/v1", startup::PORT)),
        model: Some("IBM Granite 4 Tiny".to_string()),
        reason: Some("It is the more capable of the two.".to_string()),
        asleep: Some(true),
        metrics: metrics::RuntimeMetricsDto {
            decode_tokens_per_second: None,
            active_devices: None,
            throttled: None,
        },
    };
    let json = serde_json::to_value(&dto).expect("a running state serialises");
    assert_eq!(json["kind"], "running");
    assert_eq!(
        json["endpoint"],
        format!("http://127.0.0.1:{}/v1", startup::PORT),
        "the door's own OpenAI-style address, loopback, is the only one the page takes"
    );
    assert_eq!(
        json["model"], "IBM Granite 4 Tiny",
        "the catalog's own name, not a filename"
    );
    assert_eq!(
        json["reason"], "It is the more capable of the two.",
        "the catalog's own reason reaches the page with the name"
    );
    assert_eq!(
        json["asleep"], true,
        "the announcement that the model is out of memory must reach the page"
    );
}

/// A running engine whose door is not up publishes no endpoint at all. The
/// engine's own port is deliberately not offered as a fallback: forwarding
/// there would be the one conversation in the system with no credential, no
/// slot and no cache of its own — the thing this change exists to end.
#[test]
fn a_running_engine_without_a_door_publishes_no_endpoint() {
    let dto = StateDto::Running {
        port: startup::PORT,
        endpoint: None,
        model: Some("IBM Granite 4 Tiny".to_string()),
        reason: None,
        asleep: None,
        metrics: metrics::RuntimeMetricsDto {
            decode_tokens_per_second: None,
            active_devices: None,
            throttled: None,
        },
    };
    let json = serde_json::to_value(&dto).expect("a running state serialises");
    assert_eq!(json["kind"], "running");
    assert!(
        json["endpoint"].is_null(),
        "no door, no endpoint: the engine port is not the page's road: {json}"
    );
}

#[test]
fn an_unknown_residency_crosses_as_an_absence_not_as_a_fact() {
    // What `brain_state` answers for a server this app adopted on startup:
    // the supervisor holds no stderr pipe to it (`take_over` in
    // kalsa-supervisor), so it has no answer at all. The page must receive
    // the absence of an answer — `null` — which its words read as "not
    // known". Defaulting this to `false` would tell the owner the model is
    // in memory on no evidence.
    let dto = StateDto::Running {
        port: startup::PORT,
        endpoint: Some(format!("http://127.0.0.1:{}/v1", startup::PORT)),
        model: None,
        reason: None,
        asleep: None,
        metrics: metrics::RuntimeMetricsDto {
            decode_tokens_per_second: None,
            active_devices: None,
            throttled: None,
        },
    };
    let json = serde_json::to_value(&dto).expect("a running state serialises");
    assert!(
        json["asleep"].is_null(),
        "a residency nothing announced must cross as null, not as a fact: {json}"
    );
}

#[test]
fn a_listener_bind_error_aborts_pairing_startup() {
    let result = pairing_desk_with(PathBuf::from("pairing-startup-test.json"), |_| {
        Err(io::Error::other("loopback unavailable"))
    });
    assert_eq!(result.err().unwrap().to_string(), "loopback unavailable");
}

#[test]
fn starting_keeps_the_launch_record_until_the_server_is_running() {
    let brain = Brain::new();
    let args = kalsa_launch::ServerArgs {
        model_path: PathBuf::from("/models/model.gguf"),
        port: startup::PORT,
        context_tokens: 4096,
        cache_ram_mib: 0,
        threads: Some(4),
        offload: kalsa_launch::Offload::NoGpuBuild,
        idle_unload_seconds: 300,
        batch_size: 2048,
        ubatch_size: 512,
        kv_cache: kalsa_launch::KvCache::Q8_0,
        parallel: kalsa_launch::DEFAULT_PARALLEL,
        slot_save_path: PathBuf::from("/slots"),
    };
    if let Ok(mut launch) = brain.launch.lock() {
        *launch = Some(startup::LaunchInfo {
            args,
            maximum_context: startup::ContextMaxima {
                q8_0: Some(8192),
                f16: Some(4096),
            },
            automatic_context: startup::ContextMaxima {
                q8_0: Some(8192),
                f16: Some(4096),
            },
            context_prices: Default::default(),
            display_name: None,
            reason: None,
        });
    }
    brain.clear_launch_for_state(&ServerState::Starting);
    assert!(brain.launch.lock().unwrap().is_some());
    brain.clear_launch_for_state(&ServerState::Stopped);
    assert!(brain.launch.lock().unwrap().is_none());
}

#[test]
fn a_refused_start_never_publishes_its_record() {
    // The second walk of a double start is refused by the supervisor:
    // its argv must not replace the record of the server that kept
    // running, and an accepted start must still publish.
    let brain = Brain::new();
    let running = startup::LaunchInfo {
        args: launch_args("/models/running.gguf", 8137),
        maximum_context: startup::ContextMaxima {
            q8_0: Some(8192),
            f16: Some(4096),
        },
        automatic_context: startup::ContextMaxima {
            q8_0: Some(8192),
            f16: Some(4096),
        },
        context_prices: Default::default(),
        display_name: None,
        reason: None,
    };
    let rejected = startup::LaunchInfo {
        args: launch_args("/models/rejected.gguf", 8138),
        maximum_context: startup::ContextMaxima {
            q8_0: Some(4096),
            f16: Some(2048),
        },
        automatic_context: startup::ContextMaxima {
            q8_0: Some(4096),
            f16: Some(2048),
        },
        context_prices: Default::default(),
        display_name: None,
        reason: None,
    };
    brain.record_launch(running, StartOutcome::Accepted);
    brain.record_launch(rejected, StartOutcome::Refused);
    let launch = brain.launch.lock().unwrap();
    let published = launch.as_ref().expect("an accepted start published");
    assert_eq!(
        published.args.model_path,
        PathBuf::from("/models/running.gguf"),
        "a refused start overwrote the record of the server that runs"
    );
}

fn launch_args(model: &str, port: u16) -> kalsa_launch::ServerArgs {
    kalsa_launch::ServerArgs {
        model_path: PathBuf::from(model),
        port,
        context_tokens: 4096,
        cache_ram_mib: 0,
        threads: Some(4),
        offload: kalsa_launch::Offload::NoGpuBuild,
        idle_unload_seconds: 300,
        batch_size: 2048,
        ubatch_size: 512,
        kv_cache: kalsa_launch::KvCache::Q8_0,
        parallel: kalsa_launch::DEFAULT_PARALLEL,
        slot_save_path: PathBuf::from("/slots"),
    }
}

/// A real persisted pairing, the way the phone leaves it, so the door
/// can be started for real in these tests.
fn persist_pairing(file: &Path) {
    let now = SystemTime::now();
    let mut pairing = kalsa_pairing::Pairing::offer(
        "http://127.0.0.1:8131",
        None,
        now,
        Duration::from_secs(60),
    )
    .unwrap();
    let payload: serde_json::Value =
        serde_json::from_str(&pairing.qr_payload().unwrap()).unwrap();
    let code = payload["code"].as_str().unwrap();
    let nonce = payload["nonce"].as_str().unwrap();
    assert!(matches!(
        pairing.claim(code, now),
        kalsa_pairing::ClaimResult::Claimed
    ));
    let declaration = kalsa_pairing::PhoneDeclaration::sign(
        code,
        nonce,
        payload["reachable"].as_str().unwrap(),
        None,
        kalsa_catalog::PhoneModel {
            weights_bytes: 1,
            parameters: None,
            measured_tokens_per_second: None,
            battery_powered: None,
        },
    )
    .unwrap();
    let (handshake, _) = pairing.complete(declaration, now).unwrap();
    kalsa_pairing::store::persist(&handshake, file).unwrap();
}

/// What llama-server answers behind the door in this test.
const UPSTREAM_RESPONSE: &[u8] =
    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello";

/// The canned upstream behind the door in the wiring tests: one response
/// per connection, stopped and joined on drop, so a failed assert does
/// not leave a thread spinning behind it.
struct TestUpstream {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl TestUpstream {
    fn start() -> (Self, u16) {
        Self::serve(|mut stream| {
            let _ = std::io::Write::write_all(&mut stream, &UPSTREAM_RESPONSE);
        })
    }

    /// Answers with the same head but a body that arrives in six
    /// 8-byte steps, 40 ms apart: long enough that a test can change
    /// the device set while an answer is genuinely in flight.
    fn slow_start() -> (Self, u16) {
        Self::serve(|mut stream| {
            let _ = std::io::Write::write_all(
                &mut stream,
                b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 48\r\nConnection: close\r\n\r\n",
            );
            for _ in 0..6 {
                std::thread::sleep(Duration::from_millis(40));
                // `#` never appears in an HTTP head, so the client can
                // count body bytes by counting the marker.
                let _ = std::io::Write::write_all(&mut stream, b"########");
            }
        })
    }

    fn serve(answer: impl Fn(std::net::TcpStream) + Send + 'static) -> (Self, u16) {
        let upstream =
            std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = upstream.local_addr().unwrap().port();
        let stop = Arc::new(AtomicBool::new(false));
        let thread = {
            let stop = Arc::clone(&stop);
            std::thread::spawn(move || {
                upstream.set_nonblocking(true).unwrap();
                while !stop.load(Ordering::SeqCst) {
                    match upstream.accept() {
                        Ok((mut stream, _)) => {
                            // macOS inherits the listener's flag on the
                            // accepted socket; the relay is blocking.
                            stream.set_nonblocking(false).unwrap();
                            let mut head = Vec::new();
                            let mut byte = [0u8; 1];
                            loop {
                                use std::io::Read;
                                if stream.read(&mut byte).unwrap_or(0) == 0
                                    || (head.push(byte[0]), head.ends_with(b"\r\n\r\n")).1
                                {
                                    break;
                                }
                            }
                            answer(stream);
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(2));
                        }
                        Err(_) => return,
                    }
                }
            })
        };
        (Self { stop, thread: Some(thread) }, port)
    }
}

impl Drop for TestUpstream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// A scratch directory that removes itself — assertions included.
struct ScratchDir(PathBuf);

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn scratch_pairing(name: &str) -> (ScratchDir, PathBuf) {
    let directory = std::env::temp_dir().join(format!(
        "kalsa-brain-road-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let file = directory.join("pairing.json");
    persist_pairing(&file);
    (ScratchDir(directory), file)
}

fn wait_for_road(brain: &Brain, wanted: road::RoadState) {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while brain.road.snapshot() != wanted {
        assert!(
            std::time::Instant::now() < deadline,
            "the road never reached {wanted:?}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_road_that_cannot_open_leaves_the_door_serving() {
    // The key path is a directory, so the bridge fails before any
    // network is touched. The road must own that failure — the door
    // keeps standing, and the panel says the road is not available.
    let (_dir, file) = scratch_pairing("failure");
    std::fs::create_dir_all(road::key_path(&file)).unwrap();
    let brain = Brain::new();
    let started = brain.start_door_if_paired(8130, &file, true);
    assert!(
        started.is_ok(),
        "a road failure must not fail the door: {started:?}"
    );
    assert!(brain.door_port().is_some(), "the door must be serving");
    wait_for_road(&brain, road::RoadState::Unavailable);
    assert_eq!(
        brain.road.sentence(),
        "The internet road could not open on this computer. The other roads to it still work."
    );
    brain.stop_door();
    assert!(matches!(brain.road.snapshot(), road::RoadState::Closed));
}

#[test]
fn a_road_turned_off_by_its_switch_stays_closed_while_the_door_serves() {
    // The road exists only while the owner has asked for it: with the
    // switch off, a running door does not open one — and the door keeps
    // serving, because the road was always additive.
    let (dir, file) = scratch_pairing("switch-off");
    let brain = Brain::new();
    let started = brain.start_door_if_paired(8130, &file, false);
    assert!(started.is_ok(), "{started:?}");
    assert!(brain.door_port().is_some(), "the door must be serving");
    std::thread::sleep(Duration::from_millis(50));
    assert!(matches!(brain.road.snapshot(), road::RoadState::Closed));
    // What the owner is told is the switch's own words, not the road's.
    let state_file = dir.0.join("server.state");
    let panel = brain.advanced(&state_file);
    assert!(!panel.internet_road);
    assert_eq!(
        panel.iroh_sentence,
        "The internet road is turned off. The phone reaches this computer the Tailscale way."
    );
}

#[test]
fn a_poll_reconciles_the_road_with_the_switch_the_file_carries() {
    // The file is what the panel reads and what the poll reads: when it
    // says off while the door is up with the road open, the poll must
    // close the road — a machine announced in a public directory while
    // its owner is told the road is off is the one state that may not
    // exist. The switch here is flipped in the file, not through the
    // panel, the way a manual edit or a restore would do it.
    let (dir, file) = scratch_pairing("reconcile");
    let state_file = dir.0.join("server.state");
    let book = kalsa_iroh::AddressBook::new();
    let mut brain = Brain::new();
    brain.road = Arc::new(road::Road::offline(book.clone()));
    brain
        .start_door_if_paired(8130, &file, true)
        .expect("the door starts with the road on");
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !matches!(brain.road.snapshot(), road::RoadState::Open { .. }) {
        assert!(
            std::time::Instant::now() < deadline,
            "the road never opened"
        );
        std::thread::sleep(Duration::from_millis(10));
    }

    options::save(
        &state_file,
        options::LaunchOverrides {
            context_tokens: None,
            idle_unload_seconds: None,
            internet_road: false,
            ..options::LaunchOverrides::default()
        },
    )
    .expect("flip the switch off in the file");
    let internet_road = persisted_internet_road(&state_file);
    assert!(!internet_road, "the file must carry the switch");
    brain
        .start_door_if_paired(8130, &file, internet_road)
        .expect("the poll still serves the door");
    assert!(
        matches!(brain.road.snapshot(), road::RoadState::Closed),
        "the road stayed open against a file that says off"
    );
}

#[test]
fn a_second_poll_with_the_same_door_does_not_restart_the_road() {
    // start_door_if_paired runs once a second; the road, like the door,
    // must not be torn down and rebuilt by every poll.
    let (_dir, file) = scratch_pairing("idempotent");
    std::fs::create_dir_all(road::key_path(&file)).unwrap();
    let brain = Brain::new();
    brain.start_door_if_paired(8130, &file, true).unwrap();
    wait_for_road(&brain, road::RoadState::Unavailable);
    let before = brain.road.snapshot();
    brain.start_door_if_paired(8130, &file, true).unwrap();
    assert_eq!(
        before,
        brain.road.snapshot(),
        "the same door restarted the road"
    );
    brain.stop_door();
}

#[test]
fn stopping_the_door_closes_the_road() {
    let brain = Brain::new();
    let epoch = brain.road.begin();
    brain.road.finish(epoch, None);
    assert!(matches!(
        brain.road.snapshot(),
        road::RoadState::Unavailable
    ));
    brain.stop_door();
    assert!(
        matches!(brain.road.snapshot(), road::RoadState::Closed),
        "the road outlived its door"
    );
}

#[test]
fn the_road_reaches_the_door_the_app_started() {
    // The full loop, offline: relays disabled, addresses through one
    // in-process book — the crate's own seam, the same way its
    // round-trip test runs. The road attempt goes through the app's own
    // wiring (start_door_if_paired), so a bridge opened toward any
    // address but the running door's own leaves this response unborn.
    let (_dir, file) = scratch_pairing("full-loop");
    let credential = kalsa_pairing::store::load(&file)
        .unwrap()
        .credential_hex();

    // The upstream behind the door: one canned response per connection,
    // stopped and joined with the test whatever way the test ends.
    let (upstream, upstream_port) = TestUpstream::start();

    let book = kalsa_iroh::AddressBook::new();
    let mut brain = Brain::new();
    brain.road = Arc::new(road::Road::offline(book.clone()));
    brain.start_door_if_paired(upstream_port, &file, true).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let node_id = loop {
        match brain.road.snapshot() {
            road::RoadState::Open { node_id } => break node_id,
            road::RoadState::Opening => {
                assert!(
                    std::time::Instant::now() < deadline,
                    "the road never opened against the running door"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            other => panic!("the road gave up instead of opening: {other:?}"),
        }
    };

    // The phone side: another bridge sharing the book, dialing the road
    // by its public bytes alone, then speaking HTTP to it — with the
    // door's own credential, so authentication must pass too.
    let client_key = file.with_file_name("client-node.key");
    let client = road::runtime().block_on(async {
        kalsa_iroh::Bridge::start(
            kalsa_iroh::BridgeConfig::new(SocketAddr::from((
                std::net::Ipv4Addr::LOCALHOST,
                8131,
            )))
            .with_relay(kalsa_iroh::RelayChoice::Disabled)
            .with_address_book(book),
            &client_key,
        )
        .await
        .expect("a relayless client bridge binds locally")
    });
    let response: Vec<u8> = road::runtime().block_on(async {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let remote = node_id.parse().expect("the node id is 64 hex characters");
        let mut stream = client.connect(remote).await.expect("the tunnel dials");
        let request = format!(
            "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
             Authorization: Bearer {credential}\r\nContent-Length: 0\r\n\
             Connection: close\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        stream.shutdown().await.unwrap();
        let mut response = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut response))
            .await
            .expect("the tunnel answer arrived")
            .unwrap();
        response
    });
    assert!(
        response.starts_with(b"HTTP/1.1 200 OK") && response.ends_with(b"hello"),
        "the tunnel did not reach the door the app started: {response:?}"
    );

    brain.stop_door();
    drop(upstream);
    let _ = std::fs::remove_file(&client_key);
}

/// A plain HTTP exchange with the door on `port`, using the same
/// bearer-credential shape the phone uses.
fn door_response(port: u16, credential: &str) -> Vec<u8> {
    use std::io::{Read, Write};
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    write!(
        stream,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {credential}\r\nContent-Length: 0\r\n\
         Connection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    response
}

#[test]
fn a_set_change_keeps_the_door_and_the_one_slot_engine_refuses_the_extra_device() {
    // The swap must not kill the door: an answer IN FLIGHT across the
    // device-set change runs to its last byte, and the kept device still
    // works afterwards. The app mounts no engine that reads the door's
    // private headers yet, so the door is built for one device: the newly
    // paired device is refused with the door's no-slot 503 rather than
    // auto-scheduled into the first device's slot.
    let (_dir, file) = scratch_pairing("set-swap");
    let (upstream, port) = TestUpstream::slow_start();
    let brain = Brain::new();
    brain.start_door_if_paired(port, &file, false).unwrap();
    let original = kalsa_pairing::store::load(&file).unwrap().credential_hex();
    let newcomer = "cd".repeat(32);

    // A device is mid-answer when the household grows.
    let mut stream =
        std::net::TcpStream::connect(("127.0.0.1", brain.door_port().unwrap())).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    std::io::Write::write_all(
        &mut stream,
        format!(
            "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
             Authorization: Bearer {original}\r\nContent-Length: 0\r\n\
             Connection: close\r\n\r\n"
        )
        .as_bytes(),
    )
    .unwrap();
    std::thread::sleep(Duration::from_millis(80));

    // The same file, now a set of two, written the way the store
    // writes them.
    std::fs::write(
        &file,
        format!(
            r#"{{"v":2,"devices":[
                    {{"id":0,"label":"Paired phone","credential_hex":"{original}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}},
                    {{"id":1,"label":"Second phone","credential_hex":"{newcomer}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}}]}}"#
        ),
    )
    .unwrap();
    brain.start_door_if_paired(port, &file, false).unwrap();

    // The in-flight answer survives the swap, to its last byte.
    let mut answer = Vec::new();
    std::io::Read::read_to_end(&mut stream, &mut answer).unwrap();
    assert_eq!(
        answer.iter().filter(|&&byte| byte == b'#').count(),
        48,
        "the in-flight answer was cut by a set change: the door was rebuilt"
    );

    // The one-slot engine refuses the new device, and the kept device is
    // undisturbed.
    let door_port = brain.door_port().unwrap();
    let newcomer_response = door_response(door_port, &newcomer);
    assert!(
        newcomer_response.starts_with(b"HTTP/1.1 503 Service Unavailable"),
        "the one-slot engine did not refuse the new device: {}",
        String::from_utf8_lossy(&newcomer_response)
    );
    assert!(
        String::from_utf8_lossy(&newcomer_response)
            .contains("This computer is set up for 1 device at once"),
        "the refusal did not say why: {}",
        String::from_utf8_lossy(&newcomer_response)
    );
    let original_response = door_response(door_port, &original);
    assert!(
        original_response.starts_with(b"HTTP/1.1 200 OK"),
        "the first device was disturbed by the add: {}",
        String::from_utf8_lossy(&original_response)
    );
    brain.stop_door();
    drop(upstream);
}

#[test]
fn setting_advanced_values_writes_the_file_used_by_startup() {
    let root =
        std::env::temp_dir().join(format!("kalsa-brain-main-advanced-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let state_file = root.join("server.state");
    let brain = Brain::new();
    let pairing = root.join("pairing.json");
    let dto = brain
        .set_advanced(&state_file, &pairing, Some(2048), None, Some(false), None, None, None)
        .unwrap();
    let stored = options::load(&state_file);
    assert_eq!(stored.context_tokens, Some(2048));
    assert_eq!(stored.idle_unload_seconds, None);
    assert_eq!(dto.idle_override, None);
    let _ = std::fs::remove_dir_all(root);
}

/// The panel's save is a whole-record write: `brain_set_advanced` rebuilds
/// the launch record from its arguments and carries nothing over from the
/// file but the model and the internet road. The browser check proves what
/// the page sent; this proves what Rust kept. The file starts with the
/// owner's own values for all four knobs, the way an earlier build leaves
/// it, and only the idle clock changes — so every other value has to come
/// back out of the file. A save that quietly dropped one would reset that
/// knob to automatic with nothing on screen to say so.
#[test]
fn saving_the_idle_clock_keeps_every_other_launch_value() {
    let root = std::env::temp_dir().join(format!(
        "kalsa-brain-main-idle-keeps-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let state_file = root.join("server.state");
    let brain = Brain::new();
    let pairing = root.join("pairing.json");
    options::save(
        &state_file,
        options::LaunchOverrides {
            context_tokens: Some(8192),
            idle_unload_seconds: Some(600),
            batch_size: Some(1024),
            ubatch_size: Some(256),
            kv_cache: Some(kalsa_launch::KvCache::F16),
            ..options::LaunchOverrides::default()
        },
    )
    .expect("write the values an earlier build left behind");

    let dto = brain
        .set_advanced(
            &state_file,
            &pairing,
            Some(8192),
            Some(3600),
            None,
            Some(1024),
            Some(256),
            Some(kalsa_launch::KvCache::F16),
        )
        .unwrap();

    let stored = options::load(&state_file);
    assert_eq!(
        stored.idle_unload_seconds,
        Some(3600),
        "the idle clock is the one value that changed"
    );
    assert_eq!(
        stored.context_tokens,
        Some(8192),
        "the save dropped the context"
    );
    assert_eq!(
        stored.batch_size,
        Some(1024),
        "the save dropped the batch size"
    );
    assert_eq!(
        stored.ubatch_size,
        Some(256),
        "the save dropped the micro-batch size"
    );
    assert_eq!(
        stored.kv_cache,
        Some(kalsa_launch::KvCache::F16),
        "the save dropped the cache type"
    );
    assert_eq!(dto.idle_override, Some(3600));
    assert_eq!(
        dto.context_override,
        Some(8192),
        "the panel reads the file back, and the file kept the context"
    );
    let _ = std::fs::remove_dir_all(root);
}

/// The panel's "next start" values must be the owner's saved overrides on
/// top of the automatic ones. If `dto` went back to reporting the bare
/// defaults for a stopped server, `ubatch_size` would read 512 and
/// `kv_cache_type` q8_0 while the file says 1024/f16.
#[test]
fn a_stopped_panel_reports_the_saved_launch_values_as_next_start() {
    let root = std::env::temp_dir().join(format!(
        "kalsa-brain-main-next-start-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let state_file = root.join("server.state");
    options::save(
        &state_file,
        options::LaunchOverrides {
            ubatch_size: Some(1024),
            kv_cache: Some(kalsa_launch::KvCache::F16),
            ..options::LaunchOverrides::default()
        },
    )
    .expect("save the owner's choice");
    let brain = Brain::new();
    let panel = brain.advanced(&state_file);
    assert!(!panel.running);
    assert_eq!(panel.ubatch_size, 1024);
    assert_eq!(panel.kv_cache_type, "f16");
    assert_eq!(panel.ubatch_override, Some(1024));
    assert_eq!(panel.kv_cache_override, Some("f16"));
    assert_eq!(panel.ubatch_automatic, 512);
    assert_eq!(panel.kv_cache_automatic, "q8_0");
    assert_eq!(panel.batch_automatic, 2048);
    assert_eq!(panel.batch_size, 2048, "no batch override, so automatic");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn an_engine_that_cannot_isolate_is_given_one_device_not_a_refusal() {
    // The declaration is read from the mounted engine's bytes, so on a
    // machine whose engine ignores `X-Kalsa-Slot` the honest answer is one
    // device. The door used to enforce that by refusing to build at all,
    // which turns "this engine cannot isolate" into "the app has no door":
    // on Windows, whose engine row is still upstream, that would fail every
    // poll once `--parallel` is ever raised above one. Clamping keeps the
    // machine usable with the one device it can honour.
    assert_eq!(
        door_capacity(4, kalsa_door::EnginePrivateHeaders::NotConsumed),
        1
    );
    assert_eq!(
        door_capacity(1, kalsa_door::EnginePrivateHeaders::NotConsumed),
        1
    );
    assert_eq!(
        door_capacity(4, kalsa_door::EnginePrivateHeaders::Consumed),
        4,
        "an engine that reads the inlet keeps the capacity it was asked for"
    );
}

#[test]
fn a_store_holding_only_the_host_starts_the_door() {
    // PROVES: the host's own record is enough for the door to stand up on a
    // machine that has never paired a phone, so this computer's own
    // conversation has a credential at the door instead of none. The host's
    // stored credential passes the door's credential check and reaches the
    // forward step — the upstream port here is dead, so an accepted request
    // ends in the door's 502 rather than its 401 — while a credential nobody
    // stored is still refused with 401.
    //
    // DOES NOT PROVE anything about slots: no upstream exists here to observe
    // the sealed headers, so nothing is asserted about `X-Kalsa-Slot` or
    // `X-Kalsa-Cache-Salt`, and a host-only store never reaches the no-slot
    // 503. Slot placement and the sealed headers are covered where the
    // upstream IS recorded, in kalsa-door's own tests.
    //
    // The capacity is carried the way the walk carries it — the store's own
    // device count into the launch record's `parallel`, never a literal.
    let root = std::env::temp_dir().join(format!("kalsa-brain-host-door-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join(PAIRING_FILE);
    take_own_seat(&file).expect("this computer takes its own seat");
    assert_eq!(enrolled_devices(&file), 1, "the host is one seat");
    let host = kalsa_pairing::store::load_devices(&file)
        .expect("the store reloads")
        .remove(0);

    let brain = Brain::new();
    brain.record_launch(
        startup::LaunchInfo {
            args: kalsa_launch::ServerArgs {
                parallel: enrolled_devices(&file),
                ..launch_args("/models/host-only.gguf", startup::PORT)
            },
            maximum_context: startup::ContextMaxima {
                q8_0: None,
                f16: None,
            },
            automatic_context: startup::ContextMaxima {
                q8_0: None,
                f16: None,
            },
            context_prices: Default::default(),
            display_name: None,
            reason: None,
        },
        StartOutcome::Accepted,
    );
    brain.start_door_if_paired(1, &file, false).unwrap();
    let port = brain
        .door_port()
        .expect("the host's own seat is enough to build the door");

    // The key the page gets from `brain_host_credential` is the key the door
    // authenticates.
    let with_key = door_response(port, &host.handshake.credential_hex());
    assert!(
        with_key.starts_with(b"HTTP/1.1 502") || with_key.starts_with(b"HTTP/1.1 200"),
        "the host's own credential did not open the door: {}",
        String::from_utf8_lossy(&with_key)
    );
    let stranger = door_response(port, &"00".repeat(32));
    assert!(
        stranger.starts_with(b"HTTP/1.1 401"),
        "a credential nobody stored is still refused: {}",
        String::from_utf8_lossy(&stranger)
    );
    brain.stop_door();
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_missing_store_is_no_seat_and_no_door() {
    // The enrolment failure path: with nothing written the count is zero,
    // the plan keeps its one-seat default, and the door stands down rather
    // than promising a seat no credential backs.
    let root = std::env::temp_dir().join(format!("kalsa-brain-no-store-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join(PAIRING_FILE);
    assert_eq!(enrolled_devices(&file), 0);

    let brain = Brain::new();
    brain.start_door_if_paired(1, &file, false).unwrap();
    assert!(brain.door_port().is_none(), "an empty store builds no door");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn enrolled_devices_counts_this_computer_and_every_phone() {
    // Two phones written by a build that had no `kind` key, then the host the
    // next launch enrols: the count is the whole store, because each stored
    // device holds a seat whether or not it is talking.
    let root = std::env::temp_dir().join(format!("kalsa-brain-enrolled-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join(PAIRING_FILE);
    let first = "11".repeat(32);
    let second = "22".repeat(32);
    std::fs::write(
        &file,
        format!(
            r#"{{"v":2,"devices":[
                {{"id":0,"label":"Paired phone","credential_hex":"{first}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}},
                {{"id":1,"label":"Paired phone 2","credential_hex":"{second}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}}]}}"#
        ),
    )
    .unwrap();
    assert_eq!(enrolled_devices(&file), 2, "two phones, two seats");
    kalsa_pairing::store::enrol_host(&file).unwrap();
    assert_eq!(enrolled_devices(&file), 3, "the host is a seat too");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn taking_our_own_seat_writes_exactly_one_host_record() {
    // The flagship wiring, driven directly: the setup hook's step, called on a
    // store that does not exist yet. Exactly one record appears — id 0, kind
    // Host, and no phone fields, because this computer declared none.
    let root = std::env::temp_dir().join(format!("kalsa-brain-seat-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join(PAIRING_FILE);
    take_own_seat(&file).expect("a fresh store takes this computer's seat");

    let stored = kalsa_pairing::store::load_devices(&file).expect("the host reloads");
    assert_eq!(stored.len(), 1, "one seat, the host's");
    assert_eq!(stored[0].id, 0, "the host takes the first seat");
    assert_eq!(stored[0].kind, DeviceKind::Host);
    assert_eq!(stored[0].label, kalsa_pairing::store::HOST_LABEL);
    assert!(
        stored[0].handshake.phone.is_none(),
        "a host carries no phone fields"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn taking_our_own_seat_twice_changes_nothing() {
    // `enrol_host` runs on EVERY launch, so a second call must answer the
    // first record again: one record, the same id, the same credential. A new
    // key here would mean a new cache salt and a cold model on every start.
    let root = std::env::temp_dir().join(format!("kalsa-brain-seat-twice-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join(PAIRING_FILE);
    take_own_seat(&file).expect("the first launch takes the seat");
    let first = kalsa_pairing::store::load_devices(&file).expect("the host reloads");
    assert_eq!(first.len(), 1);
    let credential = first[0].handshake.credential_hex();

    take_own_seat(&file).expect("the second launch takes the same seat");
    let second = kalsa_pairing::store::load_devices(&file).expect("the host still reloads");
    assert_eq!(second.len(), 1, "the second launch added a second record");
    assert_eq!(second[0].id, first[0].id, "the host's id changed");
    // Compared, never printed: both values are secrets.
    assert!(
        second[0].handshake.credential_hex() == credential,
        "the second launch minted a fresh credential"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_store_that_cannot_be_written_is_an_error_not_a_panic() {
    // The startup hook prints the error and starts anyway, so this must answer
    // Err, not panic. The path's parent is a FILE, so nothing can be written
    // below it; nothing half-written may be left pretending to be a seat.
    let root = std::env::temp_dir().join(format!(
        "kalsa-brain-seat-unwritable-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let blocker = root.join("not-a-directory");
    std::fs::write(&blocker, b"a file, so nothing can be created below it").unwrap();
    let file = blocker.join(PAIRING_FILE);

    let outcome = take_own_seat(&file);
    assert!(
        outcome.is_err(),
        "an unwritable store must answer Err, not panic"
    );
    assert_eq!(
        enrolled_devices(&file),
        0,
        "a failed enrolment leaves no seat behind"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn forgetting_the_store_gives_this_computer_its_seat_back() {
    // The Devices page's escape hatch deletes the WHOLE store, host record
    // included. The command puts this computer back in the same breath, so
    // the store is never left host-less: this computer stays a device, and
    // the door rebuilt from the store keeps a credential for its own chat.
    let root = std::env::temp_dir().join(format!(
        "kalsa-brain-forget-seat-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join(PAIRING_FILE);
    // A store nothing can read is exactly when the hatch is offered.
    std::fs::write(&file, b"\x00\x01 neither json nor ours").unwrap();
    let desk = pairing::Desk::new(file.clone());
    forget_store_and_keep_own_seat(&desk).expect("the hatch clears an unreadable store");

    let stored = kalsa_pairing::store::load_devices(&file).expect("the store reloads");
    assert_eq!(stored.len(), 1, "the store is never left host-less");
    assert_eq!(stored[0].kind, DeviceKind::Host, "the survivor is this computer");
    assert_eq!(stored[0].id, 0, "a fresh store gives the host seat 0 again");

    // Ids are minted by the store, never re-densified: a phone paired after
    // the hatch takes the next id rather than the host's seat.
    let phone_file = root.join("phone.json");
    persist_pairing(&phone_file);
    let phone = kalsa_pairing::store::load(&phone_file).expect("the phone reloads");
    let added = kalsa_pairing::store::add_device(&file, "Paired phone", &phone)
        .expect("a phone pairs beside the host");
    assert_eq!(
        added.id, 1,
        "the phone's id was re-densified onto the host's seat"
    );
    let _ = std::fs::remove_dir_all(root);
}
