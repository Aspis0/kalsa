//! The whole chain against a real engine: door -> sealed slot -> engine slot.
//!
//! The door's own tests prove its logic against a recording upstream. That
//! upstream cannot prove the one thing the design rests on: that the engine
//! really serves a device in the slot the door sealed for it, and only that
//! one. This test starts the real `kalsa-server`, sends the same request as
//! two devices, and reads `id_slot` back out of the engine's own answer.
//!
//! It also proves the seal beats the client: a device that names another
//! device's slot in a header still lands on its own.
//!
//! Ignored by default. Run it deliberately:
//!
//! ```text
//! KALSA_REAL_SERVER=/path/to/kalsa-server \
//! KALSA_REAL_MODEL=/path/to/model.gguf \
//! cargo test -p kalsa-door --test real_engine -- --ignored --nocapture
//! ```
//!
//! The engine must be one that carries the inlet (`x-kalsa-slot` in its
//! `libllama-server-impl.dylib`, v1.1.0 and later). The model must be
//! catalogue-shaped: the q8_0 cache the launcher pins needs a head dimension
//! divisible by 32, so the tiny probe model is refused at load.

use std::fs::File;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use kalsa_door::{DeviceEntry, DeviceId, Devices, Door, EnginePrivateHeaders};

/// Neither the app's port nor the launcher harness's, so a stray server from
/// another run is identifiable rather than silently answering here.
const ENGINE_PORT: u16 = 8140;
const HEALTH_DEADLINE: Duration = Duration::from_secs(120);
const ANSWER_TIMEOUT: Duration = Duration::from_secs(60);

/// The engine, killed and reaped however the test ends.
struct Engine(Child);

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn real_engine() -> Option<(String, String)> {
    let exe = std::env::var("KALSA_REAL_SERVER").ok().filter(|s| !s.is_empty());
    let model = std::env::var("KALSA_REAL_MODEL").ok().filter(|s| !s.is_empty());
    match (exe, model) {
        (Some(exe), Some(model)) => Some((exe, model)),
        _ => {
            eprintln!("skipped: set KALSA_REAL_SERVER and KALSA_REAL_MODEL");
            None
        }
    }
}

fn address() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], ENGINE_PORT))
}

fn health_ok(addr: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(2_000)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut answer = Vec::new();
    let _ = stream.read_to_end(&mut answer);
    String::from_utf8_lossy(&answer).starts_with("HTTP/1.1 200")
}

/// One completion through the door, optionally naming a slot the way a
/// curious client would.
fn completion(door: SocketAddr, credential: &str, claimed_slot: Option<u32>) -> String {
    let body = r#"{"prompt":"The capital of France is","n_predict":2}"#;
    let claimed = match claimed_slot {
        Some(slot) => format!("X-Kalsa-Slot: {slot}\r\n"),
        None => String::new(),
    };
    let request = format!(
        "POST /completion HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {credential}\r\n\
         Content-Type: application/json\r\n{claimed}\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let mut stream = TcpStream::connect(door).expect("the door accepts a connection");
    let _ = stream.set_read_timeout(Some(ANSWER_TIMEOUT));
    stream.write_all(request.as_bytes()).expect("the request goes out");
    let mut answer = Vec::new();
    let _ = stream.read_to_end(&mut answer);
    String::from_utf8_lossy(&answer).into_owned()
}

/// The slot the engine reports for its own answer. The non-OAI route carries
/// this field; the OpenAI-shaped one does not.
fn id_slot(answer: &str) -> u32 {
    let at = answer
        .find("\"id_slot\"")
        .unwrap_or_else(|| panic!("no id_slot in the engine's answer: {answer}"));
    let rest = answer[at + "\"id_slot\"".len()..].trim_start_matches([':', ' ']);
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits
        .parse()
        .unwrap_or_else(|_| panic!("id_slot was not a number: {answer}"))
}

#[test]
#[ignore = "needs a real kalsa-server and a catalogue-shaped model"]
fn two_devices_are_served_in_the_slots_the_door_sealed() {
    let Some((exe, model)) = real_engine() else {
        return;
    };
    let engine_dir = std::path::Path::new(&exe).parent().expect("an engine path");
    let log = File::create(std::env::temp_dir().join("kalsa-door-real-engine.log"));
    let child = Command::new(&exe)
        .current_dir(engine_dir)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &ENGINE_PORT.to_string(),
            "--model",
            &model,
            "--ctx-size",
            "4096",
            "--parallel",
            "2",
            "--no-webui",
            "--threads",
            "6",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::from(log.expect("a log file beside the test")))
        .spawn()
        .expect("the engine starts");
    let _engine = Engine(child);

    let engine = address();
    let deadline = Instant::now() + HEALTH_DEADLINE;
    while Instant::now() < deadline && !health_ok(engine) {
        std::thread::sleep(Duration::from_millis(250));
    }
    assert!(health_ok(engine), "the engine never answered /health");

    let laptop = "a".repeat(64);
    let phone = "b".repeat(64);
    let devices = Devices::new(vec![
        DeviceEntry::new(DeviceId::new(0), "laptop", laptop.clone()).expect("a credential"),
        DeviceEntry::new(DeviceId::new(1), "phone", phone.clone()).expect("a credential"),
    ])
    .expect("two distinguishable devices");

    let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback listener");
    let door = listener.local_addr().expect("the door's address");
    let running = Door::new_with_engine(
        listener,
        ENGINE_PORT,
        devices,
        2,
        EnginePrivateHeaders::Consumed,
    )
    .expect("a door for two declared devices")
    .start()
    .expect("the door runs");

    let first = id_slot(&completion(door, &laptop, None));
    let again = id_slot(&completion(door, &laptop, None));
    let other = id_slot(&completion(door, &phone, None));
    assert_eq!(
        first, again,
        "the same device drifted between slots: {first} then {again}"
    );
    assert_ne!(
        first, other,
        "two devices were served in the same slot ({first})"
    );

    // The seal is the door's, not the client's: naming the other device's
    // slot must not move this request there.
    let overridden = id_slot(&completion(door, &laptop, Some(other)));
    assert_eq!(
        overridden, first,
        "a client-supplied slot reached the engine: asked for {other}, served {overridden}"
    );

    running.shutdown();
}
