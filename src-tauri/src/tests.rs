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
        None,
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
    let second = settle_walk(&brain, (Err("still refused".into()), Some(unbelieved)), None);
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
            model_sha256: None,
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
            tier: None,
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
            tier: None,
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
            tier: None,
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
            model_sha256: None,
        });
    }
    brain.clear_launch_for_state(&ServerState::Starting);
    assert!(brain.launch.lock().unwrap().is_some());
    brain.clear_launch_for_state(&ServerState::Stopped);
    assert!(brain.launch.lock().unwrap().is_none());
}

#[test]
fn a_drain_takes_the_launch_record_down_with_it() {
    // `brain_stop` clears the record by hand before it sends anything, but a
    // walk can publish its record AFTER that clear lands, and the poll is
    // what must not go on describing the engine being torn down: the record
    // carries the capacity and the capability `start_door_if_paired` builds
    // a door from, and neither belongs to an engine on its way out.
    let brain = Brain::new();
    brain.record_launch(
        startup::LaunchInfo {
            args: launch_args("/models/draining.gguf", startup::PORT),
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
            model_sha256: None,
        },
        StartOutcome::Accepted,
    );
    brain.clear_launch_for_state(&ServerState::Stopping);
    assert!(
        brain.launch.lock().unwrap().is_none(),
        "a drain kept the launch record of the engine going away"
    );
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
        model_sha256: None,
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
        model_sha256: None,
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

    /// A slot engine that writes down the name the door asked it to restore,
    /// so a test can read back the file name the door built — the only place
    /// the model hash and directory the app handed it become visible. The head
    /// was consumed by `serve`; what is left on the socket is the json body.
    fn recording_slot(seen: Arc<Mutex<Vec<String>>>) -> (Self, u16) {
        Self::serve(move |mut stream| {
            use std::io::Read;
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut body = Vec::new();
            let mut buffer = [0u8; 512];
            while !body.ends_with(b"}") {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => body.extend_from_slice(&buffer[..read]),
                }
            }
            let body = String::from_utf8_lossy(&body).to_string();
            let name = body
                .split("\"filename\":\"")
                .nth(1)
                .and_then(|rest| rest.split('"').next())
                .unwrap_or_default()
                .to_string();
            seen.lock().unwrap().push(name);
            let reply = br#"{"id_slot":0,"n_restored":1}"#;
            let _ = std::io::Write::write_all(
                &mut stream,
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n",
                    reply.len()
                )
                .as_bytes(),
            );
            let _ = std::io::Write::write_all(&mut stream, reply);
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

/// Opens one of the door's own chat routes, the way the chat page does: an id
/// and nothing else. The name is never the client's.
fn chat_route(port: u16, credential: &str, route: &str, id: &str) -> Vec<u8> {
    use std::io::{Read, Write};
    let body = format!("{{\"id\":\"{id}\"}}");
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(
        stream,
        "POST {route} HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {credential}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    response
}

fn status_of(response: &[u8]) -> u16 {
    String::from_utf8_lossy(response)
        .split(' ')
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or_default()
}

fn body_of(response: &[u8]) -> String {
    let text = String::from_utf8_lossy(response).to_string();
    text.split_once("\r\n\r\n")
        .map(|(_, body)| body.to_string())
        .unwrap_or_default()
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
            model_sha256: None,
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

/// A computer that has taken its own seat, ready for `start_door_if_paired`.
/// The slot directory is the engine's own `--slot-save-path`, created the way
/// the walk creates it. Returns the root to clean up, the pairing file, the
/// host record, and the slot directory.
fn launched_brain(
    name: &str,
) -> (PathBuf, PathBuf, kalsa_pairing::store::StoredDevice, PathBuf) {
    let root = std::env::temp_dir().join(format!("kalsa-brain-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join(PAIRING_FILE);
    take_own_seat(&file).expect("this computer takes its own seat");
    let host = kalsa_pairing::store::load_devices(&file)
        .expect("the store reloads")
        .remove(0);
    let slot_dir = root.join(SLOTS_DIR);
    std::fs::create_dir_all(&slot_dir).unwrap();
    (root, file, host, slot_dir)
}

#[test]
fn the_door_the_app_builds_carries_the_model_identity_and_the_slot_directory() {
    // PROVES: the door the app builds from a launch record has BOTH halves of
    // the disk tier pinned — the catalog row's digest at eight hex characters
    // and the `--slot-save-path` the engine was launched with — so
    // `POST /kalsa/chat/activate` reaches the engine instead of answering 501.
    // The digest is read from the catalog itself and the file is planted under
    // the name only that digest produces, so a wiring that carried another
    // row's digest, re-hashed the weights, or dropped the value would ask the
    // engine for a name that is not there.
    //
    // DOES NOT PROVE a restore's semantics: the engine answers every action,
    // and the door's own policy is covered in kalsa-door's tests.
    let sha256 = kalsa_catalog::usable()
        .next()
        .expect("the catalog carries a downloadable row")
        .source()
        .sha256;
    let (root, file, host, slot_dir) = launched_brain("disk-tier");

    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let (engine, upstream) = TestUpstream::recording_slot(Arc::clone(&seen));
    let brain = Brain::new();
    brain.record_launch(
        startup::LaunchInfo {
            args: kalsa_launch::ServerArgs {
                slot_save_path: slot_dir.clone(),
                ..launch_args("/models/chosen.gguf", startup::PORT)
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
            display_name: Some("IBM Granite 4 Tiny".to_string()),
            reason: None,
            model_sha256: Some(sha256.to_string()),
        },
        StartOutcome::Accepted,
    );
    brain
        .start_door_if_paired(upstream, &file, false)
        .expect("the door starts with the tier wired");
    let port = brain.door_port().expect("the host's seat builds the door");

    // The chat's file, under the name the door must build from the row's
    // digest and the slot directory it was given: `d<device>-m<hash8>-c<id>`.
    let id = "0f1e2d3c-5a6b";
    let name = format!("d0-m{}-c{id}.bin", &sha256[..MODEL_HASH_CHARS]);
    std::fs::write(slot_dir.join(&name), b"state").unwrap();

    let response = chat_route(
        port,
        &host.handshake.credential_hex(),
        "/kalsa/chat/activate",
        id,
    );
    assert_eq!(
        status_of(&response),
        204,
        "the app-built door did not reach the engine: {}",
        body_of(&response)
    );
    assert_eq!(
        seen.lock().unwrap().as_slice(),
        &[name.clone()],
        "the door asked the engine for a name that is not the row's digest in the engine's directory"
    );
    drop(engine);
    brain.stop_door();
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_model_with_no_catalog_identity_leaves_the_door_serving_and_the_route_says_why() {
    // The development path pins a file no catalog row named, so there is no
    // pinned digest to build a chat's name from. The app does not invent one —
    // hashing the weights is a pass over tens of gigabytes — and does not
    // pretend the tier is wired: the door stands up for everything else, the
    // chat route refuses with its own sentence, and a line on the record says
    // why. This is the one degraded state, and it is never silence.
    let (root, file, host, slot_dir) = launched_brain("no-identity");
    let brain = Brain::new();
    brain.record_launch(
        startup::LaunchInfo {
            args: kalsa_launch::ServerArgs {
                slot_save_path: slot_dir,
                ..launch_args("/models/pinned.gguf", startup::PORT)
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
            model_sha256: None,
        },
        StartOutcome::Accepted,
    );
    brain
        .start_door_if_paired(1, &file, false)
        .expect("a missing model identity must not take the phone door down");
    let port = brain.door_port().expect("the door still serves");

    let response = chat_route(
        port,
        &host.handshake.credential_hex(),
        "/kalsa/chat/activate",
        "aaaa1111",
    );
    assert_eq!(status_of(&response), 501);
    assert!(
        body_of(&response).contains("no model identity"),
        "the refusal does not say what is missing: {}",
        body_of(&response)
    );
    brain.stop_door();
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_digest_the_door_refuses_builds_no_door_rather_than_one_that_cannot_name_a_chat() {
    // The record is the app's own, so a digest the door's constructor refuses
    // is a bug and not a degraded state: the door is not built at all, rather
    // than standing with two chat routes that answer 501 unnamed. All three
    // forms the door refuses are driven through the app's path: eight
    // uppercase characters and eight non-hex characters reach
    // `with_model_hash`, and seven characters are refused before it.
    for digest in ["A1B2C3D4", "a1b2c3dg", "a1b2c3d"] {
        let (root, file, _host, slot_dir) = launched_brain("refused-digest");
        let brain = Brain::new();
        brain.record_launch(
            startup::LaunchInfo {
                args: kalsa_launch::ServerArgs {
                    slot_save_path: slot_dir,
                    ..launch_args("/models/chosen.gguf", startup::PORT)
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
                model_sha256: Some(digest.to_string()),
            },
            StartOutcome::Accepted,
        );
        let started = brain.start_door_if_paired(1, &file, false);
        assert!(
            started.is_err(),
            "the door stood with a digest it should refuse: {digest:?}"
        );
        assert!(
            brain.door_port().is_none(),
            "a door that cannot name a chat was built anyway: {digest:?}"
        );
        brain.stop_door();
        let _ = std::fs::remove_dir_all(root);
    }
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
fn a_waiting_device_is_refused_until_the_owner_allows_it() {
    // The approval gate where the set is built and swapped: a completed
    // ceremony's phone is stored WAITING, so the door's set excludes it
    // and its credential answers the door's ordinary 401. Allow flips one
    // record on disk, and the SAME door - same listener, no restart -
    // picks the set up through start_door_if_paired, the once-a-second
    // path a forget rides. A waiting device keeps its reserved seat
    // throughout (enrolled_devices counts it).
    let (_dir, file) = scratch_pairing("waiting-allow");
    let host_cred = "aa".repeat(32);
    let phone_cred = "bb".repeat(32);
    let fields = r#"{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}"#;
    std::fs::write(
        &file,
        format!(
            r#"{{"v":2,"devices":[
                {{"id":0,"label":"This computer","kind":"Host","credential_hex":"{host_cred}"}},
                {{"id":1,"label":"Waiting phone","credential_hex":"{phone_cred}","phone":{fields},"approval":"Waiting"}}]}}"#
        ),
    )
    .unwrap();
    assert_eq!(
        enrolled_devices(&file),
        2,
        "a waiting device keeps its reserved seat"
    );

    let (_upstream, engine_port) = TestUpstream::slow_start();
    let brain = Brain::new();
    brain.start_door_if_paired(engine_port, &file, false).unwrap();
    let door_port = brain.door_port().unwrap();

    // Before Allow: the credential is refused with the door's own 401 -
    // the ordinary answer for a credential the set does not hold.
    let refused = door_response(door_port, &phone_cred);
    assert!(
        refused.starts_with(b"HTTP/1.1 401"),
        "a waiting device must get the door's ordinary 401: {}",
        String::from_utf8_lossy(&refused)
    );

    // The owner presses Allow: one record flips on disk ...
    kalsa_pairing::store::allow_device(&file, 1).unwrap();
    // ... and the SAME door learns it through the path the once-a-second
    // poll (and every forget) already uses: start_door_if_paired rebuilds
    // the set and swaps it into the running listener.
    brain.start_door_if_paired(engine_port, &file, false).unwrap();
    assert_eq!(
        brain.door_port().unwrap(),
        door_port,
        "Allow must reach the RUNNING door, not a new one"
    );

    // After Allow: the same credential is served (its first authenticated
    // request leases the free seat and reaches the upstream's body, all 48
    // bytes of it); what must be gone is the 401. The host, asked afterwards
    // on a one-seat door, may meet the no-slot 503 - it must not meet the 401.
    let allowed = door_response(door_port, &phone_cred);
    assert!(
        allowed.starts_with(b"HTTP/1.1 200"),
        "after Allow the credential must be served: {}",
        String::from_utf8_lossy(&allowed)
    );
    // Counted in the BODY only - the bytes after the head's blank line -
    // because a marker riding a header would satisfy a whole-response count.
    let body_start = allowed
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("the served response carries a head")
        + 4;
    assert_eq!(
        allowed[body_start..].iter().filter(|&&byte| byte == b'#').count(),
        48,
        "the served request must reach the upstream's body, to its last byte: {}",
        String::from_utf8_lossy(&allowed)
    );
    let still_host = door_response(door_port, &host_cred);
    assert!(
        !still_host.starts_with(b"HTTP/1.1 401"),
        "the host keeps its credential through the swap: {}",
        String::from_utf8_lossy(&still_host)
    );
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

use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};

/// What the tick's predicate may read off the supervisor, pinned decision by
/// decision. The predicate is the whole policy of the invalidation hook; the
/// observation behind it is `Supervisor::watch`, which no command mediates.
#[test]
fn the_ticks_predicate_separates_a_lost_engine_from_an_unknown_one() {
    let running = ServerState::Running { pid: 1, port: 8123 };
    let failed = ServerState::Failed {
        reason: kalsa_supervisor::Failure::ServerExited {
            detail: "gone".into(),
        },
    };
    // Released: the model is out of memory, every `Resident` claim is a lie,
    // and the no-op on a resident chat would skip the restore from disk.
    assert!(
        engine_lost_its_state(&running, Some(true)),
        "a released model left the map believed"
    );
    // A crash announces nothing on stderr — no release line, no residency —
    // so only the state can say it, and it must be enough.
    assert!(
        engine_lost_its_state(&failed, None),
        "a crash did not count as lost: nobody polls for it either"
    );
    assert!(engine_lost_its_state(&failed, Some(true)));
    // In memory: nothing is lost, and invalidating here would burn a restore
    // on every mount of an otherwise resident chat.
    assert!(
        !engine_lost_its_state(&running, Some(false)),
        "a model in memory was read as lost"
    );
    // `None` is a server with no pipe of ours (adopted): nothing has said its
    // state is gone, and a door born against one starts `Unknown` anyway —
    // invalidating on `None` would cost every mount a full restore.
    assert!(
        !engine_lost_its_state(&running, None),
        "an unanswered residency was read as a release"
    );
    // A SKETCH, not a proof: every link below was read from the code the night
    // it was written, and the code moves — this chain has been rewritten four
    // times in one night — so re-verify each link instead of trusting it. The
    // register to update when a link moves: `docs/PLAN-DISK-TIER.md` §7 and
    // `docs/HANDOFF-2026-09-21-b.md`.
    // What holds is the chain, each link read from the code — and NOT because
    // every path calls `stop_door` first: `brain_start` (the turn-on walk)
    // never calls it, and neither does `startup.rs`. The door is raised only
    // in `brain_state`'s own Running arm (`start_door_if_paired`, the single
    // PRODUCTION caller — this file calls it too, and that is why the
    // adjective is here), and `Stopped` is reached only through
    // `Supervisor::stop`/`shutdown` — whose callers declare `Stopping` in
    // themselves BEFORE they queue the command (`brain_stop` sends first and
    // lowers the door after; the exit handler lowers it and `shutdown`
    // declares in the next breath), and whose write itself belongs to the
    // worker's `stop`, pinned in `crates/kalsa-supervisor/tests/stopping.rs`
    // (`stopped_is_written_only_where_the_drain_ends`). From that
    // declaration on, a poll lands in the `Stopping` arm and lowers the door
    // itself, so the window this sketch used to describe — a poll reading
    // `Running`, re-raising, `Stopped` set with the door UP — is CLOSED
    // rather than narrowed: it is the blip `docs/PLAN-DISK-TIER.md` T5
    // declared, and §9's `Stopping` bullet is this code implementing it.
    // What remains of the walk is the teardown itself: for a SPAWNED engine
    // the worker still spends stdin EOF, a stop grace (`stop_grace`, 2.5 s as
    // `startup.rs` configures it — `llama-server` reads no stdin, so the
    // first grace is spent whole), SIGTERM, a second grace, SIGKILL before it
    // writes `Stopped`, and an engine adopted blind has no child to walk:
    // there the stop writes `Stopped` at once with the engine still
    // listening, which is declared in the plan (T5) and is why this sentence
    // is about the spawned path only. One residual, declared: the exit
    // handler lowers the door BEFORE `shutdown` declares, so a poll inside
    // that single call can still read `Running` and rebuild the door; the
    // next poll's `Stopping` arm takes it down (≤ `POLL_MS`, 1 s) and the
    // process is on its way out anyway.
    // `Starting` is entered only by a start the
    // supervisor accepted, and it refuses one while it still owns a server
    // (`StartOutcome::Refused`: "already on"), so `Running` — the state whose
    // arm raises the door — is never recycled through it. And the window
    // asks for a start either off a state `brain_state` last answered — whose
    // non-`Running` arms all drop the door
    // (`every_non_running_arm_of_brain_state_stops_the_door`, below) — or
    // after a `brain_stop` it sends itself. Never polled, though, is not
    // never raised: the door goes up inside `brain_state`, not in the page,
    // and an answer that never lands — or a window that loaded after the
    // door did — leaves `state === null` (the `COULD_NOT_TELL` read of
    // `useBrain.ts`) in front of a door that is up. `act` returns on that
    // null — it only re-polls; `chooseModel` does not: its guard needs
    // `state !== null`, so it skips `brain_stop` and sends `brain_start`
    // anyway. What closes that hole is not the page's state but the
    // supervisor's refusal while it already owns a server: the request
    // starts nothing, so no `Starting` is entered over the live door. If the
    // engine died in the meantime, though, the start is accepted and
    // `Starting` does meet the door the Running arm left up — until the next
    // poll's `Starting` arm takes it down, at most a second later (`POLL_MS`).
    // What reaches an app nobody polled is therefore exactly the two above —
    // a release, or a death.
    assert!(!engine_lost_its_state(&ServerState::Starting, None));
    assert!(!engine_lost_its_state(&ServerState::Stopped, None));
    // A drain is not a lost engine: the server is alive and still holds its
    // state until the teardown ends, so invalidating here would burn a
    // restore on a stop the owner asked for.
    assert!(!engine_lost_its_state(&ServerState::Stopping, None));
}

/// A stand-in engine for the door: records the action of every slot request
/// and answers 200 with the field the door parses. The tick's test only ever
/// restores and erases, so nothing here writes files — the chat's file is on
/// disk before the test starts.
fn stand_in_engine() -> (
    u16,
    Arc<Mutex<Vec<String>>>,
    std::thread::JoinHandle<()>,
    Arc<AtomicBool>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    let log = Arc::new(Mutex::new(Vec::new()));
    let stop = Arc::new(AtomicBool::new(false));
    let handle = {
        let log = Arc::clone(&log);
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        // The accepted socket INHERITS O_NONBLOCK from this
                        // listener (macOS), and a read before the client's
                        // bytes arrive returns `WouldBlock` at once. The old
                        // loop turned that error into a phantom end-of-head
                        // with zero bytes — logged as "none" and answered
                        // 200 — so under load the door's own restore was
                        // recorded as a success that never happened. The door
                        // itself defends against exactly this by forcing the
                        // accepted socket back to blocking (server.rs); this
                        // fixture now does the same, and a head it cannot
                        // read completely is dropped and reported instead of
                        // answered.
                        stream
                            .set_nonblocking(false)
                            .expect("the accepted socket must be blocking");
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut head = Vec::new();
                        let mut complete = false;
                        while !head.ends_with(b"\r\n\r\n") {
                            let mut byte = [0u8; 1];
                            match stream.read(&mut byte) {
                                Ok(0) | Err(_) => break,
                                Ok(_) => head.push(byte[0]),
                            }
                            if head.ends_with(b"\r\n\r\n") {
                                complete = true;
                            }
                        }
                        if !complete {
                            // Not a slot request this fixture can answer for:
                            // no log line, no reply — an incomplete head must
                            // never become an action, and a client that never
                            // finished its request gets no success it did not
                            // earn (the door then reports Unreachable, loudly).
                            eprintln!(
                                "stand-in engine: dropping an incomplete request head ({:?})",
                                String::from_utf8_lossy(&head)
                            );
                            continue;
                        }
                        let text = String::from_utf8_lossy(&head).to_string();
                        let length = text
                            .split("\r\n")
                            .filter_map(|line| line.split_once(':'))
                            .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                            .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        let mut body = vec![0u8; length];
                        let _ = stream.read_exact(&mut body);
                        // A captured head without `action=` is not a slot
                        // request — the door never sends one (engine.rs
                        // builds `POST /slots/{id}?action={action}` and
                        // nothing else). The old `.unwrap_or("none")` turned
                        // an anomaly into a plausible action in the log;
                        // now it is reported and dropped, like an incomplete
                        // head: a fixture may never INVENT a value.
                        let action = text
                            .split_whitespace()
                            .nth(1)
                            .and_then(|target| target.split("action=").nth(1))
                            .map(str::to_string);
                        let Some(action) = action else {
                            eprintln!("stand-in engine: dropping a request with no slot action: {text:?}");
                            continue;
                        };
                        log.lock().unwrap().push(action);
                        let reply_body = "{\"id_slot\":0,\"n_saved\":1}";
                        let reply = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                             Content-Length: {}\r\nConnection: close\r\n\r\n{reply_body}",
                            reply_body.len()
                        );
                        let _ = stream.write_all(reply.as_bytes());
                    }
                    Err(ref error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2))
                    }
                    Err(_) => return,
                }
            }
        })
    };
    (port, log, handle, stop)
}

/// One activate of the door's own route, the way a client sends it.
fn activate_chat(address: std::net::SocketAddr, token: &str, id: &str) -> u16 {
    let body = format!("{{\"id\":\"{id}\"}}");
    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(
        client,
        "POST /kalsa/chat/activate HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\nOrigin: tauri://localhost\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    client.shutdown(Shutdown::Write).unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    String::from_utf8_lossy(&response)
        .split(' ')
        .nth(1)
        .and_then(|code| code.parse().ok())
        .unwrap_or(0)
}

/// THE property of T5a's hook, asserted at the Rust level: the supervisor
/// moves to `Failed` on its own, and it is the tick — a thread that runs with
/// no window behind it — that invalidates the door's map. `brain_state`, the
/// only other observer of `ServerState` and a command the webview polls, is
/// never called in this test; if the invalidation were routed through the
/// poll, nothing here would move and the second activation would no-op.
#[test]
fn the_tick_invalidates_a_failed_servers_map_with_nobody_polling() {
    // A start that fails by itself: the exe does not exist, so the worker
    // walks Starting → Failed with no poll watching it.
    let supervisor = Supervisor::new();
    let port = {
        let probe = TcpListener::bind("127.0.0.1:0").unwrap();
        probe.local_addr().unwrap().port()
    };
    let state_file =
        std::env::temp_dir().join(format!("kalsa-brain-t5a-{}.state", std::process::id()));
    let _ = std::fs::remove_file(&state_file);
    let _ = supervisor.start(kalsa_supervisor::ServerConfig {
        exe: PathBuf::from("/nonexistent/kalsa-t5a-server"),
        argv: vec![
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
        ],
        state_file: state_file.clone(),
        port,
        ready_timeout: Duration::from_secs(1),
        stop_grace: Duration::from_millis(50),
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match supervisor.state() {
            ServerState::Failed { .. } => break,
            _ if Instant::now() >= deadline => panic!("the broken start never reported Failed"),
            _ => std::thread::sleep(Duration::from_millis(5)),
        }
    }
    let watch = supervisor.watch();

    // A door against a stand-in engine, and a chat with a file on disk, so
    // activating it is a real restore.
    let (upstream, log, engine_thread, engine_stop) = stand_in_engine();
    let slot_dir =
        std::env::temp_dir().join(format!("kalsa-brain-t5a-slots-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&slot_dir);
    std::fs::create_dir_all(&slot_dir).unwrap();
    let token = "a".repeat(64);
    let devices = kalsa_door::Devices::new(vec![kalsa_door::DeviceEntry::new(
        kalsa_door::DeviceId::new(0),
        "Host",
        token.clone(),
    )
    .unwrap()])
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let door = kalsa_door::Door::new_with_engine(
        listener,
        upstream,
        devices.clone(),
        4,
        kalsa_door::EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_model_hash("a1b2c3d4")
    .unwrap()
    .with_slot_dir(slot_dir.clone());
    let door = Arc::new(door.start().unwrap());
    let chat = "aaaa1111";
    std::fs::write(slot_dir.join(format!("d0-ma1b2c3d4-c{chat}.bin")), b"state").unwrap();

    // The chat is resident — one restore — and asking for it again is the
    // no-op. Both facts are recorded before anything is torn down.
    assert_eq!(
        activate_chat(address, &token, chat),
        204,
        "the first activation of a stored chat is a restore"
    );
    assert_eq!(activate_chat(address, &token, chat), 204);
    let baseline = log.lock().unwrap().clone();
    assert_eq!(baseline, ["restore"], "the resident chat was not a no-op: {baseline:?}");

    // The tick, exactly as the ticker's thread calls it: the supervisor's own
    // watch in, the door's map out — no command, no webview, no poll.
    let doors = Mutex::new(Some(ActiveDoor {
        devices,
        host: None,
        address,
        door: Arc::clone(&door),
    }));
    tick(&doors, &watch);
    assert_eq!(
        activate_chat(address, &token, chat),
        204,
        "the activation after the tick failed"
    );
    let actions = log.lock().unwrap().clone();

    // Teardown before the verdicts, so a failing assertion leaves nothing
    // behind: the stand-in thread, the door's workers and both directories.
    engine_stop.store(true, Ordering::SeqCst);
    let _ = engine_thread.join();
    drop(door);
    let _ = std::fs::remove_dir_all(&slot_dir);
    let _ = std::fs::remove_file(&state_file);

    assert_eq!(
        actions.len(),
        baseline.len() + 1,
        "the tick did not take the map's claim away: the activation after it \
         touched no engine, {actions:?}"
    );
    assert_eq!(
        actions.last().unwrap(),
        "restore",
        "the tick's invalidation did not drive a restore from the file: {actions:?}"
    );
}

/// The brace-matched block whose opening `{` sits at or after `from`: the
/// whole of an `fn` or an `enum`, as source. Braces inside the blocks this
/// reads are balanced (a `format!` interpolates closed pairs), and an
/// unbalanced block panics here rather than slicing a lie.
fn brace_block(source: &str, from: usize) -> &str {
    let open = from + source[from..].find('{').expect("a block opens");
    let mut depth = 0usize;
    for i in open..source.len() {
        match source.as_bytes()[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return &source[open..=i];
                }
            }
            _ => {}
        }
    }
    panic!("unbalanced braces in the block at byte {from}");
}

/// The variant names of `ServerState`, read from the enum itself: a state added
/// tomorrow must be pinned by the check below, not exempted from it.
fn server_state_variants() -> Vec<String> {
    let source = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../crates/kalsa-supervisor/src/supervisor.rs"
    ))
    .expect("supervisor.rs is readable");
    let at = source
        .find("pub enum ServerState")
        .expect("the enum brain_state matches on");
    let block = brace_block(&source, at);
    let body: String = block[1..block.len() - 1]
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut names = Vec::new();
    let mut depth = 0usize;
    let mut i = 0;
    while i < body.len() {
        match body.as_bytes()[i] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            byte if byte.is_ascii_alphabetic() || byte == b'_' => {
                let start = i;
                while i < body.len()
                    && (body.as_bytes()[i].is_ascii_alphanumeric() || body.as_bytes()[i] == b'_')
                {
                    i += 1;
                }
                let after = body[i..].trim_start();
                if depth == 0 && (after.starts_with(',') || after.starts_with('{')) {
                    names.push(body[start..i].to_string());
                }
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    assert!(!names.is_empty(), "no variants parsed from {body}");
    names
}

/// The pin under the fifth way, and the most important check this round adds.
/// It defends TWO things in every non-`Running` arm of `brain_state`, because
/// two promises ride on the same answer:
///
/// 1. THE DOOR. The cross-layer invariant nobody wrote down: a window that
/// polls THIS command says `absent` only when `kind !== "running"`
/// (`slotGate.ts`, `standingOf`), and `brain_state` — the very command that
/// poll answers from — calls `stop_door()` in every non-`Running` arm.
/// Together they make `absent` on the polling client imply the door is
/// already down. Drop one `stop_door()` and the implication breaks in
/// silence: the window calls a live door "no door", mints a chat against
/// its slot, and the next switch writes that slot's state into another
/// chat's file — the divergence `slotGate.ts` exists to prevent, re-entered
/// from Rust. (A browser outside the webview never polls this command and
/// says `absent` on an assumption instead — declared in `useBrain.ts`, not
/// covered here.)
///
/// 2. THE SQUARE. `desk.desk.stop_serving()` in those same arms: the pairing
/// square is only drawn while the desk serves (`brain_pairing` answers
/// `serving` from `Running`), so an arm that takes the door down and leaves
/// the square up promises a way in that has just gone — a phone scans a QR
/// that leads to a door being torn down and finds nothing behind it. The
/// door's arm was pinned and this was not: the reviewer cancelled one
/// `desk.desk.stop_serving();` and all 166 + 47 + the harness stayed green,
/// which is exactly the hole this half of the pin closes.
fn non_running_arms_stop_the_door(source: &str) -> Result<(), String> {
    let at = source
        .find("fn brain_state(")
        .ok_or_else(|| "brain_state is the command the client polls".to_string())?;
    let body = brace_block(source, at);
    for variant in server_state_variants() {
        if variant == "Running" {
            continue;
        }
        let marker = format!("ServerState::{variant}");
        let found = body
            .find(&marker)
            .ok_or_else(|| format!("brain_state grew no arm for {variant}"))?;
        let rest = &body[found + marker.len()..];
        let arm = &rest[..rest.find("ServerState::").unwrap_or(rest.len())];
        if !arm.contains("stop_door()") {
            return Err(format!(
                "the {variant} arm of brain_state answers without stopping the door"
            ));
        }
        if !arm.contains("desk.desk.stop_serving()") {
            return Err(format!(
                "the {variant} arm of brain_state answers without retiring the pairing square — \
                 a square that stays up while the door goes down promises a way in that is gone"
            ));
        }
    }
    Ok(())
}

#[test]
fn every_non_running_arm_of_brain_state_stops_the_door() {
    let source = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs"))
        .expect("main.rs is readable");
    if let Err(error) = non_running_arms_stop_the_door(&source) {
        panic!(
            "{error} — the client's `absent` would no longer imply a stopped door, or a square \
             would keep promising an entrance the door no longer answers"
        );
    }
}

#[test]
fn the_pin_bites_when_one_stop_door_is_taken_away() {
    // The edit a future cleanup makes by accident, replayed on a COPY of the
    // source: the Stopped arm keeps answering `stopped` and stops taking the
    // door down. The pin must go red on exactly that copy...
    let source = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs"))
        .expect("main.rs is readable");
    let start = source.find("fn brain_state(").expect("the command");
    let stopped = start + source[start..].find("ServerState::Stopped").expect("the arm");
    let mutated = format!(
        "{}{}",
        &source[..stopped],
        source[stopped..].replacen("brain.stop_door();", "", 1)
    );
    assert!(
        non_running_arms_stop_the_door(&mutated).is_err(),
        "the pin passed on a brain_state whose Stopped arm no longer stops the door"
    );
    // ...and stay green on the untouched source, so the red above is the
    // mutation's doing and not a checker that fails both ways.
    assert_eq!(non_running_arms_stop_the_door(&source), Ok(()));
}

#[test]
fn the_pin_bites_when_the_square_is_taken_away() {
    // The reviewer's own edit, replayed on a COPY of the source: the
    // `Stopping` arm goes on lowering the door and stops retiring the
    // pairing square — done to the real source it left every suite green,
    // which is the hole this replay exists for. The pin must go red on
    // exactly that copy...
    let source = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs"))
        .expect("main.rs is readable");
    let start = source.find("fn brain_state(").expect("the command");
    // Scoped from `fn brain_state(` onward: `clear_launch_for_state` matches
    // `ServerState::Stopping` too, and the first `stop_serving` before this
    // point is not an arm of this command at all.
    let draining = start +
        source[start..]
            .find("ServerState::Stopping =>")
            .expect("the drain's arm");
    let mutated = format!(
        "{}{}",
        &source[..draining],
        source[draining..].replacen("desk.desk.stop_serving();", "", 1)
    );
    assert!(
        non_running_arms_stop_the_door(&mutated).is_err(),
        "the pin passed on a brain_state whose Stopping arm no longer retires the square"
    );
    // ...and stay green on the untouched source.
    assert_eq!(non_running_arms_stop_the_door(&source), Ok(()));
}

/// The companion pin: `every_non_running_arm_of_brain_state_stops_the_door`
/// demands an arm that STOPS the door; this one demands that the RAISE lives
/// in exactly one arm, the `Running` one. `start_door_if_paired` inside the
/// drain's arm is the original defect arriving through the very arm that
/// exists to suppress it: a poll landing during a stop would rebuild the
/// door the stop had lowered, from inside the answer that is supposed to say
/// "draining". Exactly once, in `Running`, or the window is open again.
fn only_the_running_arm_raises_the_door(source: &str) -> Result<(), String> {
    let at = source
        .find("fn brain_state(")
        .ok_or_else(|| "brain_state is the command the poll answers from".to_string())?;
    let body = brace_block(source, at);
    let marker = "start_door_if_paired(";
    let mut hits = 0usize;
    let mut cursor = 0usize;
    while let Some(found) = body[cursor..].find(marker) {
        let call = cursor + found;
        hits += 1;
        // The arm this call sits in: the last `ServerState::` before it.
        let arm_at = body[..call]
            .rfind("ServerState::")
            .ok_or_else(|| "a door raise sits outside every arm of brain_state".to_string())?;
        let rest = &body[arm_at + "ServerState::".len()..];
        let name: String = rest
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if name != "Running" {
            return Err(format!(
                "start_door_if_paired is called in the {name} arm of brain_state"
            ));
        }
        cursor = call + marker.len();
    }
    if hits == 0 {
        return Err("brain_state no longer raises the door at all".to_string());
    }
    Ok(())
}

#[test]
fn start_door_if_paired_is_raised_by_the_running_arm_only() {
    let source = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs"))
        .expect("main.rs is readable");
    if let Err(error) = only_the_running_arm_raises_the_door(&source) {
        panic!("{error} — a poll would raise the door out of the state that suppresses it");
    }
}

#[test]
fn the_raise_pin_bites_when_the_drain_re_raises_the_door() {
    // The edit replayed on a COPY: a future cleanup "reconciles" the door in
    // the new `Stopping` arm as well — which is the defect this state closes,
    // re-entered through the arm that exists to close it. The pin must go red
    // on that copy...
    let source = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs"))
        .expect("main.rs is readable");
    // Found inside `brain_state` itself: `clear_launch_for_state` matches
    // `ServerState::Stopping` too, and injecting there would be outside every
    // arm this pin reads.
    let command = source
        .find("fn brain_state(")
        .expect("the command the poll answers from");
    let anchor = "ServerState::Stopping => {";
    let at = command + source[command..].find(anchor).expect("the drain's arm");
    let insert = at + anchor.len();
    let mutated = format!(
        "{}\n            let _ = brain.start_door_if_paired(port, &desk.pairing_file, false);{}",
        &source[..insert],
        &source[insert..]
    );
    assert!(
        only_the_running_arm_raises_the_door(&mutated).is_err(),
        "the pin passed on a brain_state whose Stopping arm raises the door"
    );
    // ...and stay green on the untouched source.
    assert_eq!(only_the_running_arm_raises_the_door(&source), Ok(()));
}

/// The wire name the page unions (`useBrain.ts`, `kind: "stopping"`): pinned
/// as one sample, so renaming the variant cannot quietly orphan the frontend
/// into its `default:` arm — where the page would say "Not known" about a
/// machine that is simply being turned off.
#[test]
fn the_drain_reaches_the_page_as_stopping() {
    let json = serde_json::to_value(StateDto::Stopping).expect("the drain's DTO serialises");
    assert_eq!(json, serde_json::json!({ "kind": "stopping" }));
}

/// T6b from the app's side: the panel's numbers are the DOOR's reads —
/// residents from the residency map, capacity from the slots the door built,
/// disk from one scan of its directory — and they reach `tier_facts` whole.
/// `active_devices` is deliberately not consulted on this path: at rest with
/// a resident chat it answers 0 and would say the opposite of the truth.
#[test]
fn the_panel_numbers_are_read_from_the_door_not_from_traffic() {
    let (upstream, _log, engine_thread, engine_stop) = stand_in_engine();
    let slot_dir =
        std::env::temp_dir().join(format!("kalsa-brain-t6b-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&slot_dir);
    std::fs::create_dir_all(&slot_dir).unwrap();
    // A saved chat already on disk: the activation below is a real restore,
    // and the scan has real bytes to weigh.
    let chat = "aaaa1111";
    std::fs::write(slot_dir.join(format!("d0-ma1b2c3d4-c{chat}.bin")), b"state").unwrap();
    let token = "b".repeat(64);
    let devices = kalsa_door::Devices::new(vec![kalsa_door::DeviceEntry::new(
        kalsa_door::DeviceId::new(0),
        "Host",
        token.clone(),
    )
    .unwrap()])
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let door = kalsa_door::Door::new_with_engine(
        listener,
        upstream,
        devices,
        4,
        kalsa_door::EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_model_hash("a1b2c3d4")
    .unwrap()
    .with_slot_dir(slot_dir.clone());
    let door = door.start().unwrap();

    // Before any chat is opened: no residents (a slot nobody has looked at
    // holds nothing), the four slots the door itself built, and the file
    // that is really in the directory — five bytes, one file, nothing skipped.
    let facts = tier_facts(&door);
    assert_eq!(facts.capacity, 4, "the capacity is not the slots this door built");
    assert_eq!(facts.residents, 0, "an unopened slot holds a resident");
    let scan = facts.disk.expect("a door with a directory answers a scan");
    assert_eq!(scan.bytes, 5, "the scan did not weigh the file that is there");
    assert_eq!(scan.files, 1, "the scan did not count the file that is there");
    assert_eq!(scan.unreadable, 0, "nothing was skipped, nothing may be missing");

    assert_eq!(activate_chat(address, &token, chat), 204, "the activation failed");
    let facts = tier_facts(&door);
    assert_eq!(
        facts.residents,
        1,
        "the resident chat did not reach the panel's number"
    );
    assert_eq!(facts.capacity, 4, "the capacity moved under a running door");

    engine_stop.store(true, Ordering::SeqCst);
    let _ = engine_thread.join();
    drop(door);
    let _ = std::fs::remove_dir_all(&slot_dir);
}

/// The desk's port can be the fallback, so the DTO the Devices page polls
/// must carry the listener's ACTUAL port — assembled the way the command
/// assembles it, through the real serve().
#[test]
fn the_pairing_dto_carries_the_desks_actual_port() {
    let root = std::env::temp_dir().join(format!("kalsa-brain-desk-port-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    // Port 0 on purpose: this test's subject is the DTO wiring, not the
    // port choice, and the one test that binds the real preferred constant
    // must be its only claimant in this binary.
    let holder = pairing_desk_with(root.join("pairing.json"), |desk| transport::serve_on(desk, 0))
        .unwrap();
    let brain = Brain::new();
    let dto = serde_json::to_value(pairing_dto(&brain, &holder)).unwrap();
    assert_eq!(
        dto["desk_port"].as_u64(),
        Some(u64::from(holder.listener.port())),
        "the DTO must carry the listener's actual port"
    );
    holder.listener.shutdown();
    let _ = std::fs::remove_dir_all(root);
}

/// This app's fixed loopback ports, kept apart on purpose: the engine's
/// startup::PORT, the door's DEFAULT_PORT, the instance guard's GUARD_PORT
/// — claimed before the desk binds on every normal launch, so a collision
/// there means the fallback always fires and the serve rule never works —
/// and the guard's own test port (GUARD_PORT + 1). The desk's preference
/// must be none of them, and the literal is pinned here so a change is a
/// decision, not a drift.
#[test]
fn the_desks_preferred_port_is_none_of_this_apps_other_fixed_ports() {
    assert_eq!(transport::PREFERRED_PORT, 8134);
    assert_ne!(transport::PREFERRED_PORT, startup::PORT);
    assert_ne!(transport::PREFERRED_PORT, door::DEFAULT_PORT);
    assert_ne!(transport::PREFERRED_PORT, instance::GUARD_PORT);
    assert_ne!(
        transport::PREFERRED_PORT,
        instance::GUARD_PORT + 1,
        "the guard's own test port"
    );
}
