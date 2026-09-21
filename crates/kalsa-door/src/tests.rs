use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use super::registry::Registry;
use super::{proxy, Door, DoorError, ActiveDevices, DeviceSet, EnginePrivateHeaders, LeaseError, CONNECTION_LIFETIME, MAX_CONNECTIONS, Devices, DeviceEntry, DeviceId};
use kalsa_catalog::PhoneModel;
use kalsa_pairing::{ClaimResult, Pairing, PhoneDeclaration};

mod cors;
mod cors_answers;
mod paging;
mod paging_cadence;
mod paging_cadence_tick;
mod paging_route;
mod paging_support;
mod revocation;
mod slot_routes;
mod slots;
mod support;

fn request(address: std::net::SocketAddr, authorization: Option<&str>) -> Vec<u8> {
    let auth = authorization
        .map(|value| format!("Authorization: {value}\r\n"))
        .unwrap_or_default();
    let mut stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(
        stream,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n{auth}Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    response
}

fn credential() -> String {
    let now = SystemTime::now();
    let mut pairing = Pairing::offer(
        "http://127.0.0.1:8131",
        None,
        now,
        Duration::from_secs(60),
    )
    .unwrap();
    let payload: serde_json::Value = serde_json::from_str(&pairing.qr_payload().unwrap()).unwrap();
    let code = payload["code"].as_str().unwrap();
    let nonce = payload["nonce"].as_str().unwrap();
    assert!(matches!(pairing.claim(code, now), ClaimResult::Claimed));
    let declaration = PhoneDeclaration::sign(
        code,
        nonce,
        payload["reachable"].as_str().unwrap(),
        None,
        PhoneModel {
            weights_bytes: 1,
            parameters: None,
            measured_tokens_per_second: None,
            battery_powered: None,
        },
    )
    .unwrap();
    let (handshake, _) = pairing.complete(declaration, now).unwrap();
    handshake.credential_hex()
}

fn wrong_credential(token: &str) -> String {
    let mut wrong = token.as_bytes().to_vec();
    wrong[0] = if wrong[0] == b'0' { b'1' } else { b'0' };
    String::from_utf8(wrong).unwrap()
}

/// The set the door is handed: one entry per credential, ids by position.
/// Each credential validates on its own way in; the set is the door's to
/// refuse if it were ambiguous or empty.
fn door_devices(credentials: &[&str]) -> Devices {
    let entries = credentials
        .iter()
        .enumerate()
        .map(|(index, token)| {
            DeviceEntry::new(
                DeviceId::new(index as u32),
                format!("device {index}"),
                token.to_string(),
            )
            .unwrap()
        })
        .collect();
    Devices::new(entries).unwrap()
}

#[test]
fn a_non_loopback_listener_is_refused_at_construction() {
    let listener = TcpListener::bind("0.0.0.0:0").unwrap();
    let result = Door::new(listener, 1, door_devices(&[&credential()]), 1);
    assert!(matches!(result, Err(DoorError::NonLoopback(_))));
}

/// The door must never forward to itself: once the webview's endpoint is
/// derived from the door's own port, one mistaken argument would make every
/// request forward to itself, with no error line, until the worker and queue
/// budgets saturate.
#[test]
fn an_upstream_on_the_listening_port_is_refused_at_construction() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let refused = Door::new_with_engine(
        listener,
        port,
        door_devices(&[&credential()]),
        2,
        EnginePrivateHeaders::Consumed,
    );
    assert!(
        matches!(refused, Err(DoorError::UpstreamIsListener { port: named }) if named == port),
        "an upstream on the listening port was accepted"
    );
}

#[test]
fn the_running_door_reports_the_address_it_serves() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .unwrap();
    });
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let bound_address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();
    assert_eq!(door.address(), bound_address);
    assert_eq!(
        request(door.address(), Some(&format!("Bearer {token}"))),
        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
    );
    upstream_thread.join().unwrap();
    door.shutdown();
}

#[test]
fn every_authentication_failure_has_the_same_refusal() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    drop(upstream);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();
    let wrong = format!("Bearer {}", wrong_credential(&token));
    let refusal = request(address, Some(&wrong));
    assert!(refusal.starts_with(b"HTTP/1.1 401"));
    assert!(door.active_devices().is_empty());
    assert_eq!(
        request(address, None),
        refusal,
        "missing and wrong credentials are indistinguishable"
    );
    assert_eq!(request(address, Some("Basic anything")), refusal);
    assert_eq!(request(address, Some("Bearer")), refusal);
    // A real credential of a device the set never held: pairing minted it,
    // this door does not know it. "No such credential" and "wrong
    // credential" must stay one answer.
    let unknown = credential();
    assert_ne!(unknown, token, "pairing mints every credential fresh");
    assert_eq!(
        request(address, Some(&format!("Bearer {unknown}"))),
        refusal,
        "an unknown device's credential is the same refusal"
    );
    door.shutdown();
}

#[test]
fn an_unauthenticated_socket_is_not_an_active_phone() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let door = Door::new(listener, 1, door_devices(&[&credential()]), 1)
        .unwrap()
        .start()
        .unwrap();
    let client = TcpStream::connect(address).unwrap();
    thread::sleep(Duration::from_millis(25));
    assert!(door.active_devices().is_empty());
    drop(client);
    door.shutdown();
}

#[test]
fn the_active_set_answers_who_is_busy_and_for_how_long() {
    let active = ActiveDevices::new();
    assert!(active.snapshot().is_empty(), "nobody has asked yet");

    // Six ids, filled in DESCENDING order. A hash map's order over two keys
    // is close to a coin flip; over six, only the sort itself can put
    // smallest id first, which is the thing this test is for.
    let first_of_two = active.enter(DeviceId::new(2));
    let others = [
        active.enter(DeviceId::new(7)),
        active.enter(DeviceId::new(6)),
        active.enter(DeviceId::new(5)),
        active.enter(DeviceId::new(4)),
        active.enter(DeviceId::new(3)),
    ];
    // The same device on a second connection: still one busy device.
    let second_connection = active.enter(DeviceId::new(2));
    assert_eq!(
        active.snapshot(),
        vec![
            DeviceId::new(2),
            DeviceId::new(3),
            DeviceId::new(4),
            DeviceId::new(5),
            DeviceId::new(6),
            DeviceId::new(7),
        ],
        "smallest id first, however the set was filled"
    );

    // One connection ending does not unbusy a device with another alive.
    drop(first_of_two);
    assert_eq!(active.snapshot().len(), 6, "device 2 still holds a connection");
    drop(second_connection);
    assert_eq!(active.snapshot(), vec![
        DeviceId::new(3),
        DeviceId::new(4),
        DeviceId::new(5),
        DeviceId::new(6),
        DeviceId::new(7),
    ]);
    for guard in others {
        drop(guard);
    }
    assert!(active.snapshot().is_empty(), "no connection, no occupant");
}

#[test]
fn an_authenticated_connection_is_active_as_its_device() {
    // The upstream accepts and then holds the connection silent, so the
    // door stays inside the request while this test looks.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let upstream_stop = Arc::new(AtomicBool::new(false));
    let upstream_thread = {
        let stop = Arc::clone(&upstream_stop);
        thread::spawn(move || {
            upstream.set_nonblocking(true).unwrap();
            while !stop.load(Ordering::SeqCst) {
                match upstream.accept() {
                    Ok((stream, _)) => {
                        thread::sleep(Duration::from_millis(400));
                        drop(stream);
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => return,
                }
            }
        })
    };

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();

    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\nContent-Length: 0\r\n\
         Connection: close\r\n\r\n"
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while door.active_devices() != vec![DeviceId::new(0)] {
        assert!(
            Instant::now() < deadline,
            "the connected device never showed as active: {:?}",
            door.active_devices()
        );
        thread::sleep(Duration::from_millis(5));
    }
    assert!(!door.active_devices().is_empty());

    drop(client);
    let deadline = Instant::now() + Duration::from_secs(2);
    while !door.active_devices().is_empty() {
        assert!(
            Instant::now() < deadline,
            "the device stayed active after its connection left: {:?}",
            door.active_devices()
        );
        thread::sleep(Duration::from_millis(5));
    }
    door.shutdown();
    upstream_stop.store(true, Ordering::SeqCst);
    upstream_thread.join().unwrap();
}

/// An upstream that answers every request with a slow body — 48 bytes
/// written in six 8-byte steps, 40ms apart — so a test can look at the door
/// while an answer is genuinely in flight. Returns the port, a stop flag
/// and the thread; the flag is stored and the thread joined on test end.
/// Stopped and joined however the test ends: an assertion failing
/// mid-answer must not leave a 2ms accept loop spinning behind it.
struct SlowUpstream {
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Drop for SlowUpstream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn slow_answer_upstream() -> (u16, SlowUpstream) {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = upstream.local_addr().unwrap().port();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let handle = thread::spawn(move || {
        upstream.set_nonblocking(true).unwrap();
        while !thread_stop.load(Ordering::SeqCst) {
            match upstream.accept() {
                Ok((stream, _)) => {
                    let mut stream = stream;
                    stream.set_nonblocking(false).unwrap();
                    let mut head = Vec::new();
                    let mut byte = [0u8; 1];
                    loop {
                        if stream.read(&mut byte).unwrap_or(0) == 0
                            || (head.push(byte[0]), head.ends_with(b"\r\n\r\n")).1
                        {
                            break;
                        }
                    }
                    let _ = stream.write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 48\r\nConnection: close\r\n\r\n",
                    );
                    for _ in 0..6 {
                        thread::sleep(Duration::from_millis(40));
                        // `#` never appears in an HTTP head, so counting the
                        // marker counts body bytes, nothing else.
                        let _ = stream.write_all(b"########");
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(2));
                }
                Err(_) => return,
            }
        }
    });
    (
        port,
        SlowUpstream {
            stop,
            handle: Some(handle),
        },
    )
}

#[test]
fn an_added_device_disturbs_nobody_and_starts_authenticating() {
    // The house model: one device is mid-answer when another pairs. The
    // answer runs to its last byte and the listener never rebinds; the new
    // device authenticates from its first request after the swap.
    // The guard owns the upstream: dropping it at scope end stops and joins.
    let (upstream_port, _upstream) = slow_answer_upstream();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let first = credential();
    let second = credential();
    let door = Door::new_with_engine(listener, upstream_port, door_devices(&[&first]), 2, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();

    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    write!(
        client,
        "POST /answer HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {first}\r\nContent-Length: 0\r\n\
         Connection: close\r\n\r\n"
    )
    .unwrap();
    thread::sleep(Duration::from_millis(50)); // mid-answer

    door.set_devices(door_devices(&[&first, &second]));

    let mut answer = Vec::new();
    client.read_to_end(&mut answer).unwrap();
    assert_eq!(
        answer.iter().filter(|&&byte| byte == b'#').count(),
        48,
        "the in-flight answer was disturbed by an add"
    );

    let newcomer = request(address, Some(&format!("Bearer {second}")));
    assert!(
        newcomer.starts_with(b"HTTP/1.1 200 OK"),
        "the added device could not authenticate: {}",
        String::from_utf8_lossy(&newcomer)
    );
    door.shutdown();
}

#[test]
fn a_removed_device_is_cut_mid_answer_and_refused_after() {
    // The decision under test: revocation is immediate and mid-flight. The
    // forgotten device's in-flight answer is cut at the next relay check —
    // the owner's forget outranks the tail of an answer the device streamed
    // for before it was revoked — and every later request is refused.
    // The guard owns the upstream: dropping it at scope end stops and joins.
    let (upstream_port, _upstream) = slow_answer_upstream();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let revoked = credential();
    let keeper = credential();
    let door = Door::new_with_engine(listener, upstream_port, door_devices(&[&revoked, &keeper]), 2, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();

    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    write!(
        client,
        "POST /answer HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {revoked}\r\nContent-Length: 0\r\n\
         Connection: close\r\n\r\n"
    )
    .unwrap();
    thread::sleep(Duration::from_millis(50)); // mid-answer

    // Device 0 leaves, device 1 keeps its id: a removal removes the id,
    // it does not renumber the set.
    door.set_devices(Devices::new(vec![DeviceEntry::new(
        DeviceId::new(1),
        "Keeper",
        keeper.clone(),
    )
    .unwrap()])
    .unwrap());

    let mut answer = Vec::new();
    client.read_to_end(&mut answer).unwrap();
    let delivered = answer.iter().filter(|&&byte| byte == b'#').count();
    assert!(
        delivered < 48,
        "a revoked device kept streaming: {delivered} of 48 bytes"
    );

    // And the credential is dead for everything that follows.
    let again = request(address, Some(&format!("Bearer {revoked}")));
    assert!(again.starts_with(b"HTTP/1.1 401"));
    let kept = request(address, Some(&format!("Bearer {keeper}")));
    assert!(kept.starts_with(b"HTTP/1.1 200 OK"));
    door.shutdown();
}

#[test]
fn a_connection_whose_stamp_has_expired_still_gets_its_head_read() {
    // The accepted stamp here is long stale — the shape of a connection
    // that waited in the queue. The head arrives complete, so the worker's
    // own patience reads it and answers on its merits: the credential
    // below is wrong, and the answer says exactly that, byte for byte.
    // (A connection whose head was never read at all is answered busy
    // instead — see the true-path test.)
    let upstream = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    drop(upstream);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let stop = AtomicBool::new(false);
        let active = ActiveDevices::new();
        let registry = Registry::new();
        let devices = DeviceSet::new(door_devices(&[&"0".repeat(64)]), 1);
        let accepted = Instant::now()
            .checked_sub(super::HEAD_PATIENCE + Duration::from_secs(5))
            .unwrap();
        proxy::handle(
            stream,
            accepted,
            super::HEAD_PATIENCE,
            upstream_port,
            1,
            &devices,
            &crate::paging::Chats::new(1, None, None, None),
            &registry,
            &stop,
            &active,
            None,
        );
    });
    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    client
        .write_all(b"POST / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).expect("answer arrives");
    assert_eq!(
        response,
        super::unauthorized_response(None),
        "a complete head on a stale stamp was not read and answered"
    );
    server.join().unwrap();
}

#[test]
fn a_queued_request_is_served_and_a_silent_one_answered_busy() {
    // The true path: accept loop, queue, workers. Four long exchanges fill
    // the pool, so the next connections wait in the queue longer than the
    // head patience. One of them arrives complete — bytes already on the
    // wire — and must be read with a fresh patience and answered. One says
    // nothing at all: its answer is the busy one, never a lying 401.
    let head_patience = Duration::from_millis(300);
    let upstream = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let upstream_stop = Arc::new(AtomicBool::new(false));
    let upstream_thread = {
        let stop = Arc::clone(&upstream_stop);
        thread::spawn(move || {
            upstream.set_nonblocking(true).unwrap();
            while !stop.load(Ordering::SeqCst) {
                match upstream.accept() {
                    // Each connection is served on its own thread: a held
                    // exchange must not stop the next one from being
                    // accepted and answered.
                    Ok((stream, _)) => {
                        thread::spawn(move || {
                            let mut stream = stream;
                            stream.set_nonblocking(false).expect("blocking");
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
                            if head.windows(7).any(|window| window == b"/answer") {
                                let _ = std::io::Write::write_all(
                                    &mut stream,
                                    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
                                );
                            }
                            // Anything else is a held exchange: open and
                            // silent for a fixed hold — long enough that
                            // the queued connections outwait the head
                            // patience — then the socket is dropped, which
                            // frees the worker that serves it. Read
                            // timeouts are not a close: the hold survives
                            // them.
                            let hold_until = std::time::Instant::now()
                                + Duration::from_millis(600);
                            let _ = stream
                                .set_read_timeout(Some(Duration::from_millis(50)));
                            loop {
                                if std::time::Instant::now() >= hold_until {
                                    break;
                                }
                                match stream.read(&mut byte) {
                                    Ok(0) => break,
                                    Err(ref e)
                                        if e.kind() == io::ErrorKind::WouldBlock
                                            || e.kind() == io::ErrorKind::TimedOut =>
                                    {
                                        continue
                                    }
                                    Err(_) => break,
                                    Ok(_) => {}
                                }
                            }
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => return,
                }
            }
        })
    };

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, door_devices(&[&token]), 1)
        .unwrap()
        .with_head_patience(head_patience)
        .start()
        .unwrap();

    let request_for = |path: &str, stream: &mut TcpStream| {
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .write_all(
                format!(
                    "POST {path} HTTP/1.1\r\nHost: localhost\r\n\
                     Authorization: Bearer {token}\r\nContent-Length: 0\r\n\
                     Connection: close\r\n\r\n"
                )
                .as_bytes(),
            )
            .unwrap();
    };

    // Four exchanges the upstream holds open: the pool is full.
    let mut held = Vec::new();
    for _ in 0..4 {
        let mut stream = TcpStream::connect(address).unwrap();
        request_for("/hold", &mut stream);
        held.push(stream);
    }
    thread::sleep(Duration::from_millis(100));

    // The victims of the queue: one speaks at once, one never speaks.
    let mut speaking = TcpStream::connect(address).unwrap();
    request_for("/answer", &mut speaking);
    let mut silent = TcpStream::connect(address).unwrap();
    thread::sleep(head_patience + Duration::from_millis(200));

    drop(held);
    let mut served = Vec::new();
    speaking
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    speaking.read_to_end(&mut served).expect("the queued request is served");
    assert!(
        served.starts_with(b"HTTP/1.1 200 OK"),
        "a complete request that waited in the queue was refused on the queue's clock: {served:?}"
    );

    let mut busy = Vec::new();
    silent
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    silent.read_to_end(&mut busy).expect("the silent one is answered");
    assert!(
        busy.starts_with(b"HTTP/1.1 503"),
        "a connection whose head was never read must be answered busy, not unauthorized: {busy:?}"
    );

    drop(speaking);
    drop(silent);
    door.shutdown();
    upstream_stop.store(true, Ordering::SeqCst);
    upstream_thread.join().unwrap();
}

#[test]
fn an_authenticated_request_when_upstream_is_down_returns_a_clean_error() {
    let unused = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = unused.local_addr().unwrap().port();
    drop(unused);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();
    let response = request(address, Some(&format!("Bearer {token}")));
    assert_eq!(
        response,
        b"HTTP/1.1 502 Bad Gateway\r\nVary: Origin\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    door.shutdown();
}

#[test]
fn handled_requests_free_their_slot_so_the_door_stays_open() {
    // One slot per in-flight request, handed back when the request is done:
    // twice as many sequential requests as the budget allows must all be
    // served. A slot leaked per request would fill the door at exactly
    // MAX_CONNECTIONS and start refusing.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let upstream_stop = Arc::new(AtomicBool::new(false));
    let upstream_thread = thread::spawn({
        let stop = Arc::clone(&upstream_stop);
        move || {
            upstream
                .set_nonblocking(true)
                .expect("upstream nonblocking");
            while !stop.load(Ordering::SeqCst) {
                match upstream.accept() {
                    Ok((mut stream, _)) => {
                        // On macOS an accepted socket inherits the
                        // listener's non-blocking flag; a read that gives
                        // up on WouldBlock would answer before the
                        // request arrived and its drop would reset the
                        // door mid-relay. The head is therefore read
                        // blocking, bounded, and loudly.
                        stream.set_nonblocking(false).expect("accepted stream blocking");
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut request = Vec::new();
                        read_until(&mut stream, b"\r\n\r\n", &mut request)
                            .expect("upstream got a whole request head");
                        std::io::Write::write_all(
                            &mut stream,
                            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .expect("upstream answered");
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => return,
                }
            }
        }
    });
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_port, door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();
    for _ in 0..(MAX_CONNECTIONS * 2) {
        let response = request(address, Some(&format!("Bearer {token}")));
        assert_eq!(
            response,
            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
            "a handled request did not free its slot: the door filled up"
        );
    }
    door.shutdown();
    upstream_stop.store(true, Ordering::SeqCst);
    upstream_thread.join().unwrap();
}

#[test]
fn a_connection_past_its_lifetime_is_cut() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let registry = Registry::new();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let stop = AtomicBool::new(false);
        let active = ActiveDevices::new();
        let devices = DeviceSet::new(door_devices(&[&"0".repeat(64)]), 1);
        let accepted = Instant::now()
            .checked_sub(CONNECTION_LIFETIME + Duration::from_secs(1))
            .unwrap();
        proxy::handle(
            stream,
            accepted,
            super::HEAD_PATIENCE,
            1,
            1,
            &devices,
            &crate::paging::Chats::new(1, None, None, None),
            &registry,
            &stop,
            &active,
            None,
        );
    });
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    assert!(
        response.is_empty(),
        "an expired connection gets no response"
    );
    server.join().unwrap();
}

#[test]
fn an_sse_response_reaches_the_client_before_the_upstream_finishes() {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let (first_sent, first_received) = mpsc::channel();
    let (allow_second, second_allowed) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        let body = b"{\"x\":1}";
        let mut received_body = vec![0u8; body.len()];
        stream.read_exact(&mut received_body).unwrap();
        assert_eq!(received_body, body);
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        write_chunk(&mut stream, b"data: one\n\n");
        first_sent.send(()).unwrap();
        second_allowed.recv_timeout(Duration::from_secs(2)).unwrap();
        write_chunk(&mut stream, b"data: two\n\n");
        stream.write_all(b"0\r\n\r\n").unwrap();
    });

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\nContent-Length: 7\r\nConnection: close\r\n\r\n{{\"x\":1}}"
    )
    .unwrap();
    let started = Instant::now();
    let mut first = Vec::new();
    read_until(&mut client, b"data: one\n\n", &mut first).unwrap();
    assert!(started.elapsed() < Duration::from_secs(1));
    first_received.recv_timeout(Duration::from_secs(1)).unwrap();
    allow_second.send(()).unwrap();
    let mut rest = Vec::new();
    client.read_to_end(&mut rest).unwrap();
    assert!(first
        .windows(b"data: one\n\n".len())
        .any(|chunk| chunk == b"data: one\n\n"));
    assert!(rest
        .windows(b"data: two\n\n".len())
        .any(|chunk| chunk == b"data: two\n\n"));
    upstream_thread.join().unwrap();
    door.shutdown();
}

fn write_chunk(stream: &mut TcpStream, body: &[u8]) {
    write!(stream, "{:x}\r\n", body.len()).unwrap();
    stream.write_all(body).unwrap();
    stream.write_all(b"\r\n").unwrap();
}

fn read_until(stream: &mut TcpStream, needle: &[u8], output: &mut Vec<u8>) -> std::io::Result<()> {
    let mut byte = [0u8; 1];
    while !output.windows(needle.len()).any(|chunk| chunk == needle) {
        stream.read_exact(&mut byte)?;
        output.push(byte[0]);
    }
    Ok(())
}

/// The ids the door minted, in the order the client received them. This is
/// the whole resume contract in one line of text per event.
fn event_ids(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| line.strip_prefix("id: ").map(str::to_string))
        .collect()
}

fn post(address: std::net::SocketAddr, token: &str, last_event_id: Option<&str>) -> TcpStream {
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let resume = last_event_id
        .map(|id| format!("Last-Event-ID: {id}\r\n"))
        .unwrap_or_default();
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n{resume}Content-Length: 7\r\nConnection: close\r\n\r\n{{\"x\":1}}"
    )
    .unwrap();
    client
}

#[test]
fn an_answer_survives_a_brutal_disconnect_and_resumes_from_the_last_event_id() {
    // The whole point of jobs, end to end: a client reading a live stream
    // dies with a reset — no goodbye — the model finishes the answer with
    // nobody listening, the client comes back naming the last id it saw,
    // and receives the rest of one answer, in order, once.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let (client_died, client_gone) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        let mut body = vec![0u8; 7];
        stream.read_exact(&mut body).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n")
            .unwrap();
        write_chunk(&mut stream, b"data: one\n\ndata: two\n\n");
        // The phone is gone from here on; the model keeps producing.
        client_gone.recv_timeout(Duration::from_secs(5)).unwrap();
        write_chunk(&mut stream, b"data: three\n\ndata: four\n\ndata: five\n\ndata: [DONE]\n\n");
        stream.write_all(b"0\r\n\r\n").unwrap();
        // The server drains until the client's side disappears.
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut byte = [0u8; 1];
        loop {
            match stream.read(&mut byte) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();

    // Read two numbered events, then hang up brutally: linger zero turns
    // the drop into a reset, not a polite close.
    let (job, last_seen) = {
        let mut client = post(address, &token, None);
        let mut seen = Vec::new();
        read_until(&mut client, b"data: two\n\n", &mut seen).unwrap();
        let ids = event_ids(&String::from_utf8(seen).unwrap());
        assert_eq!(ids.len(), 2, "the door numbered both events: {ids:?}");
        let job = ids[0]
            .rsplit_once(':')
            .map(|(token, _)| token.to_string())
            .unwrap();
        let last_seen = ids[1].clone();
        // No goodbye: the transport dies under the client, mid-answer.
        client.shutdown(Shutdown::Both).unwrap();
        drop(client);
        client_died.send(()).unwrap();
        (job, last_seen)
    };
    assert_ne!(job, "", "the job token is real bytes, never empty");

    // The answer finished with nobody listening at all.
    upstream_thread.join().unwrap();

    // The phone returns, naming the last id it saw.
    let mut returning = post(address, &token, Some(&last_seen));
    let mut raw = Vec::new();
    returning.read_to_end(&mut raw).unwrap();
    let text = String::from_utf8(raw).unwrap();
    assert!(
        text.starts_with("HTTP/1.1 200 OK"),
        "a resume is the same answer: {text}"
    );
    let ids = event_ids(&text);
    let wanted: Vec<String> = (2..6).map(|index| format!("{job}:{index}")).collect();
    assert_eq!(
        ids, wanted,
        "exactly the missed events, in order, without duplicates or holes"
    );
    for words in ["data: three", "data: four", "data: five", "data: [DONE]"] {
        assert!(text.contains(words), "the answer kept its content: {words}");
    }
    for lost in ["data: one", "data: two"] {
        assert!(
            !text.contains(lost),
            "what the client already had is not sent again: {lost}"
        );
    }
    door.shutdown();
}

#[test]
fn a_returning_client_rejoins_an_answer_still_in_motion() {
    // The resumer is served what it missed and then the live tail of the
    // same generation, with no seam between the two.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let (client_died, client_gone) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        let mut body = vec![0u8; 7];
        stream.read_exact(&mut body).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n")
            .unwrap();
        write_chunk(&mut stream, b"data: one\n\ndata: two\n\n");
        client_gone.recv_timeout(Duration::from_secs(5)).unwrap();
        // Long enough that the resumer is attached and waiting before the
        // generation moves on.
        thread::sleep(Duration::from_millis(200));
        write_chunk(&mut stream, b"data: three\n\ndata: [DONE]\n\n");
        stream.write_all(b"0\r\n\r\n").unwrap();
    });

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();

    let (job, last_seen) = {
        let mut client = post(address, &token, None);
        let mut seen = Vec::new();
        read_until(&mut client, b"data: two\n\n", &mut seen).unwrap();
        let ids = event_ids(&String::from_utf8(seen).unwrap());
        // No goodbye: the transport dies under the client, mid-answer.
        client.shutdown(Shutdown::Both).unwrap();
        let last_seen = ids[1].clone();
        let job = ids[0]
            .rsplit_once(':')
            .map(|(token, _)| token.to_string())
            .unwrap();
        drop(client);
        client_died.send(()).unwrap();
        (job, last_seen)
    };
    let mut returning = post(address, &token, Some(&last_seen));
    let mut raw = Vec::new();
    returning.read_to_end(&mut raw).unwrap();
    let text = String::from_utf8(raw).unwrap();
    let ids = event_ids(&text);
    let wanted: Vec<String> = (2..4).map(|index| format!("{job}:{index}")).collect();
    assert_eq!(ids, wanted, "one continuous answer, no seam: {ids:?}");
    upstream_thread.join().unwrap();
    door.shutdown();
}

#[test]
fn a_resume_the_door_cannot_honor_is_refused_and_starts_nothing() {
    // An upstream that is never reached: bound, deaf. Every refusal below
    // must be the door's own words, without a generation being started.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    upstream.set_nonblocking(true).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();

    let nonsense = post(address, &token, Some("not-an-id"));
    let refusal = read_all(nonsense);
    assert!(
        refusal.starts_with(b"HTTP/1.1 410 Gone"),
        "an unusable id is answered, not ignored: {refusal:?}"
    );
    let unknown = post(address, &token, Some(&format!("{}:1", "0".repeat(32))));
    let refusal = read_all(unknown);
    assert!(refusal.starts_with(b"HTTP/1.1 410 Gone"));
    assert!(
        String::from_utf8_lossy(&refusal).contains("no longer kept"),
        "the refusal says what happened: {refusal:?}"
    );

    // Resuming is authenticated like everything else: the wrong credential
    // is a 401 before any question about the job is even considered.
    let wrong = wrong_credential(&token);
    let stranger = post(address, &wrong, Some(&format!("{}:1", "0".repeat(32))));
    assert!(read_all(stranger).starts_with(b"HTTP/1.1 401"));

    // Nothing derailed into the upstream: no connection was ever made.
    assert!(
        upstream.accept().is_err(),
        "a refused resume must not start a generation"
    );
    door.shutdown();
}

fn read_all(mut stream: TcpStream) -> Vec<u8> {
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    response
}

#[test]
fn the_generation_continues_after_its_client_dies() {
    // The product's own promise, in two separated moments of time: the
    // client reads part of the answer and dies; the producer must LEARN
    // that nobody is listening (its write into the dead socket fails — the
    // keep-alive pings below are what makes it write); and only then does
    // the model emit the rest. A producer that stops when nobody listens
    // would never read that last part, and the returning phone would find
    // the answer missing it.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let (client_died, client_gone) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        let mut body = vec![0u8; 7];
        stream.read_exact(&mut body).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n")
            .unwrap();
        write_chunk(&mut stream, b"data: one\n\ndata: two\n\n");
        client_gone.recv_timeout(Duration::from_secs(5)).unwrap();
        // The server's own keep-alives, in their own reads: by the second
        // one the producer has written into the dead socket and failed.
        // Pings are fire-and-forget: a dropped road must not end the
        // answer here.
        for _ in 0..4 {
            let _ = write_chunk(&mut stream, b": ping\n\n");
            thread::sleep(Duration::from_millis(50));
        }
        // Only now the last of the answer, in reads of their own.
        write_chunk(&mut stream, b"data: three\n\ndata: four\n\ndata: five\n\ndata: [DONE]\n\n");
        stream.write_all(b"0\r\n\r\n").unwrap();
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut byte = [0u8; 1];
        loop {
            match stream.read(&mut byte) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new(listener, upstream_address.port(), door_devices(&[&token]), 1)
        .unwrap()
        .start()
        .unwrap();

    // The client reads two numbered events and dies with no goodbye.
    let (job, last_seen) = {
        let mut client = post(address, &token, None);
        let mut seen = Vec::new();
        read_until(&mut client, b"data: two\n\n", &mut seen).unwrap();
        let ids = event_ids(&String::from_utf8(seen).unwrap());
        assert_eq!(ids.len(), 2);
        client.shutdown(Shutdown::Both).unwrap();
        let last_seen = ids[1].clone();
        let job = ids[0]
            .rsplit_once(':')
            .map(|(token, _)| token.to_string())
            .unwrap();
        drop(client);
        client_died.send(()).unwrap();
        (job, last_seen)
    };

    // The phone returns long after, naming the last id it saw.
    let mut returning = post(address, &token, Some(&last_seen));
    let mut raw = Vec::new();
    match returning.read_to_end(&mut raw) {
        Ok(_) => {}
        // macOS surfaces a socket read timeout as EAGAIN/WouldBlock.
        Err(error)
            if error.kind() == io::ErrorKind::TimedOut
                || error.kind() == io::ErrorKind::WouldBlock =>
        {
            panic!("the answer stopped when nobody was listening: {error}")
        }
        Err(error) => panic!("{error}"),
    }
    let text = String::from_utf8(raw).unwrap();
    assert!(
        text.starts_with("HTTP/1.1 200 OK"),
        "a resume is the same answer: {text}"
    );
    let ids = event_ids(&text);
    let wanted: Vec<String> = (2..6).map(|index| format!("{job}:{index}")).collect();
    assert_eq!(
        ids, wanted,
        "the events made after the client died are in the answer"
    );
    for words in ["data: three", "data: four", "data: five", "data: [DONE]"] {
        assert!(text.contains(words), "the tail was produced anyway: {words}");
    }
    for seen_before in ["data: one", "data: two"] {
        assert!(!text.contains(seen_before), "no duplicates: {seen_before}");
    }
    upstream_thread.join().unwrap();
    door.shutdown();
}

/// A canned upstream that answers every request with a short event stream
/// — one numbered event, a pause that keeps the answer genuinely in
/// flight, then the tail — for as many connections as arrive, until told
/// to stop.
fn sse_upstream() -> (std::net::SocketAddr, Arc<AtomicBool>, thread::JoinHandle<()>) {
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = upstream.local_addr().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let thread = {
        let stop = Arc::clone(&stop);
        thread::spawn(move || {
            upstream.set_nonblocking(true).unwrap();
            while !stop.load(Ordering::SeqCst) {
                match upstream.accept() {
                    Ok((stream, _)) => {
                        let mut stream = stream;
                        stream.set_nonblocking(false).unwrap();
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut head = Vec::new();
                        if read_until(&mut stream, b"\r\n\r\n", &mut head).is_err() {
                            continue;
                        }
                        let mut body = vec![0u8; 7];
                        let _ = stream.read_exact(&mut body);
                        let _ = std::io::Write::write_all(
                            &mut stream,
                            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
                        );
                        write_chunk(&mut stream, b"data: one\n\n");
                        // Long enough that the door is shut down with the
                        // answer still running, in the revocation test.
                        thread::sleep(Duration::from_millis(200));
                        write_chunk(&mut stream, b"data: two\n\ndata: [DONE]\n\n");
                        let _ = stream.write_all(b"0\r\n\r\n");
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => return,
                }
            }
        })
    };
    (address, stop, thread)
}

/// The job token and the last id a client saw, extracted from what it read.
fn job_of(seen: &[u8]) -> (String, String) {
    let ids = event_ids(&String::from_utf8_lossy(seen));
    assert!(!ids.is_empty(), "the door numbered the events: {ids:?}");
    let job = ids[0]
        .rsplit_once(':')
        .map(|(token, _)| token.to_string())
        .unwrap();
    let last_seen = ids[ids.len() - 1].clone();
    (job, last_seen)
}

#[test]
fn two_devices_each_open_the_door_with_their_own_credential() {
    let (upstream_address, upstream_stop, upstream_thread) = sse_upstream();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (first, second) = (credential(), credential());
    assert_ne!(first, second, "pairing mints every device its own secret");
    let door = Door::new_with_engine(listener, upstream_address.port(), door_devices(&[&first, &second]), 2, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();
    for token in [&first, &second, &first] {
        let mut client = post(address, token, None);
        let mut seen = Vec::new();
        read_until(&mut client, b"data: one\n\n", &mut seen).unwrap();
        assert!(
            String::from_utf8_lossy(&seen).contains("id: "),
            "an authenticated device gets its answer: {seen:?}"
        );
    }
    door.shutdown();
    upstream_stop.store(true, Ordering::SeqCst);
    upstream_thread.join().unwrap();
}

#[test]
fn device_b_cannot_resume_device_a_s_answer() {
    // Both devices are valid; the set tells them apart. A's answer — its
    // job token, its ids — is A's alone: B, fully authenticated, asking
    // for it by token and index must be refused with the same words a lost
    // answer gets, learning neither that it exists nor that it does not.
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let (client_died, client_gone) = mpsc::channel();
    let upstream_thread = thread::spawn(move || {
        let (mut stream, _) = upstream.accept().unwrap();
        let mut request = Vec::new();
        read_until(&mut stream, b"\r\n\r\n", &mut request).unwrap();
        let mut body = vec![0u8; 7];
        stream.read_exact(&mut body).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n")
            .unwrap();
        write_chunk(&mut stream, b"data: one\n\ndata: two\n\n");
        client_gone.recv_timeout(Duration::from_secs(5)).unwrap();
        write_chunk(&mut stream, b"data: three\n\ndata: [DONE]\n\n");
        stream.write_all(b"0\r\n\r\n").unwrap();
    });

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (mine, theirs) = (credential(), credential());
    let door = Door::new_with_engine(listener, upstream_address.port(), door_devices(&[&mine, &theirs]), 2, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();

    let (job, last_seen) = {
        let mut client = post(address, &mine, None);
        let mut seen = Vec::new();
        read_until(&mut client, b"data: two\n\n", &mut seen).unwrap();
        // No goodbye: the transport dies under the client, mid-answer.
        client.shutdown(Shutdown::Both).unwrap();
        drop(client);
        client_died.send(()).unwrap();
        job_of(&seen)
    };
    upstream_thread.join().unwrap();

    // Device B asks for A's answer by its real token and real index.
    let thief = post(address, &theirs, Some(&last_seen));
    let stolen = read_all(thief);
    assert!(
        stolen.starts_with(b"HTTP/1.1 410 Gone"),
        "another device's valid credential must not serve A's answer: {}",
        String::from_utf8_lossy(&stolen)
    );
    assert!(
        String::from_utf8_lossy(&stolen).contains("no longer kept"),
        "the refusal is the lost-answer words, revealing nothing: {}",
        String::from_utf8_lossy(&stolen)
    );

    // The control: the owner still resumes the very same answer, so the
    // refusal above is about the device, not the token.
    let owner = post(address, &mine, Some(&last_seen));
    let own = read_all(owner);
    assert!(
        own.starts_with(b"HTTP/1.1 200 OK"),
        "the device that started the answer still resumes it: {}",
        String::from_utf8_lossy(&own)
    );
    let ids = event_ids(&String::from_utf8(own).unwrap());
    let wanted: Vec<String> = (2..4).map(|index| format!("{job}:{index}")).collect();
    assert_eq!(ids, wanted, "the owner gets exactly the missed events");
    door.shutdown();
}

#[test]
fn a_revoked_device_is_refused_and_its_answer_dies_with_the_door() {
    // Revocation is the app's act: it rebuilds the door from the set
    // without the removed device. The decision about the revoked device's
    // in-flight job is the door's lifecycle, applied without a special
    // case: every job dies with the door, so the restart destroys the
    // revoked device's answer too — nothing remains that it, or anyone,
    // could still resume.
    let (upstream_address, upstream_stop, upstream_thread) = sse_upstream();
    let (leaving, staying) = (credential(), credential());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let door = Door::new_with_engine(listener, upstream_address.port(), door_devices(&[&leaving, &staying]), 2, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();

    // The device about to leave is mid-answer when the revocation lands.
    let (_job, last_seen) = {
        let mut client = post(door.address(), &leaving, None);
        let mut seen = Vec::new();
        read_until(&mut client, b"data: one\n\n", &mut seen).unwrap();
        job_of(&seen)
    };
    door.shutdown();

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let rebuilt = Door::new(listener, upstream_address.port(), door_devices(&[&staying]), 1)
        .unwrap()
        .start()
        .unwrap();

    // The revoked device's next request is the one plain 401 — the same
    // bytes a total stranger gets, revealing nothing about the past.
    let revoked = request(address, Some(&format!("Bearer {leaving}")));
    assert!(revoked.starts_with(b"HTTP/1.1 401"));
    let stranger = request(address, Some(&format!("Bearer {}", wrong_credential(&staying))));
    assert_eq!(revoked, stranger, "revoked and wrong are the same refusal");
    // Even naming the job token it was shown, the revoked device cannot
    // resume: authentication comes before any question about the job.
    let attempt = post(address, &leaving, Some(&last_seen));
    assert!(read_all(attempt).starts_with(b"HTTP/1.1 401"));
    // And the answer itself went with the door: the one device that
    // remains, asking with the revoked device's own token, is told the
    // answer is not kept — not served somebody else's stream.
    let survivor = post(address, &staying, Some(&last_seen));
    let answer = read_all(survivor);
    assert!(answer.starts_with(b"HTTP/1.1 410 Gone"));
    assert!(
        String::from_utf8_lossy(&answer).contains("no longer kept"),
        "the revoked device's answer died with the door: {}",
        String::from_utf8_lossy(&answer)
    );
    // The surviving device still opens the rebuilt door.
    let mut own = post(address, &staying, None);
    let mut seen = Vec::new();
    read_until(&mut own, b"data: one\n\n", &mut seen).unwrap();

    rebuilt.shutdown();
    upstream_stop.store(true, Ordering::SeqCst);
    upstream_thread.join().unwrap();
}
