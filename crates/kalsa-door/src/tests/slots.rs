//! The slot map and the door's sealed private headers, exercised through the
//! map itself and through sockets.

use super::support::*;
use super::*;

#[test]
fn two_devices_get_distinct_slots_below_the_capacity() {
    let upstream = RecordingUpstream::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (first, second) = (credential(), credential());
    let door = Door::new_with_engine(listener, upstream.port, door_devices(&[&first, &second]), 4, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();

    for token in [&first, &second] {
        let response = request(address, Some(&format!("Bearer {token}")));
        assert!(
            response.starts_with(b"HTTP/1.1 200 OK"),
            "an authenticated device was not served: {}",
            String::from_utf8_lossy(&response)
        );
    }

    let heads = upstream.heads();
    assert_eq!(heads.len(), 2, "the upstream saw one request per device");
    let slots: Vec<u32> = heads.iter().map(|head| sealed_slot(head)).collect();
    assert_ne!(slots[0], slots[1], "two devices shared one slot: {slots:?}");
    assert!(
        slots.iter().all(|slot| *slot < 4),
        "a slot escaped the capacity: {slots:?}"
    );
    assert_eq!(upstream.accepts(), 2);
    door.shutdown();
}

#[test]
fn a_fifth_device_is_refused_without_touching_the_upstream() {
    // The fifth device is refused with the door's own 503, and the accept
    // counter stays at four: the refusal happens before `connect_timeout`,
    // so no generation can be started for a device the engine has no slot for.
    let upstream = RecordingUpstream::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let tokens: Vec<String> = (0..5).map(|_| credential()).collect();
    let refs: Vec<&str> = tokens.iter().map(String::as_str).collect();
    let door = Door::new_with_engine(listener, upstream.port, door_devices(&refs), 4, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();

    for token in &tokens[..4] {
        let response = request(address, Some(&format!("Bearer {token}")));
        assert!(
            response.starts_with(b"HTTP/1.1 200 OK"),
            "one of the first four devices was not served: {}",
            String::from_utf8_lossy(&response)
        );
    }

    let fifth = request(address, Some(&format!("Bearer {}", tokens[4])));
    let text = String::from_utf8_lossy(&fifth).to_string();
    assert!(
        text.starts_with("HTTP/1.1 503 Service Unavailable"),
        "the fifth device was not refused with the door's own 503: {text}"
    );
    assert!(
        text.contains("This computer is set up for 4 devices at once, and one of them is this computer."),
        "the refusal does not say the count or that the host is one of them: {text}"
    );
    assert!(
        text.contains("Turning the assistant off and on again re-plans the seats from the devices stored now; if it still cannot fund one seat per stored device, lower the context in Advanced, or forget a device on the Devices page."),
        "the refusal does not say what to do: {text}"
    );
    // `Content-Length` must be exactly the body written, or the client hangs.
    let body_at = fifth
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|at| at + 4)
        .expect("the refusal has a head and a body");
    let (head, body) = fifth.split_at(body_at);
    let declared: usize = String::from_utf8_lossy(head)
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length: "))
        .and_then(|value| value.trim().parse().ok())
        .expect("the refusal declares its length");
    assert_eq!(
        declared,
        body.len(),
        "the no-slot Content-Length does not match the body: {}",
        String::from_utf8_lossy(&fifth)
    );
    // A spurious connection that is dropped at once is still a connection
    // the upstream's accept loop will count, just not instantly. Poll on the
    // condition with a deadline — no fixed sleep, which would be either
    // flaky (too short) or slow (too long) — so the assertion fails the
    // moment a refused request has been seen upstream.
    let accepted = Instant::now() + Duration::from_secs(2);
    while upstream.accepts() == 4 && Instant::now() < accepted {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(
        upstream.accepts(),
        4,
        "the refusal opened an upstream connection"
    );
    assert_eq!(upstream.heads().len(), 4);
    door.shutdown();
}

#[test]
fn client_copies_of_the_private_headers_never_reach_the_upstream() {
    let upstream = RecordingUpstream::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new_with_engine(listener, upstream.port, door_devices(&[&token]), 4, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();

    let attacker_salt = "deadbeef".repeat(8);
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\n\
         x-KALSA-slot: 999\r\n\
         X-Kalsa-Cache-Salt: {attacker_salt}\r\n\
         Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    assert!(
        response.starts_with(b"HTTP/1.1 200 OK"),
        "the request was not served after its private headers were stripped: {}",
        String::from_utf8_lossy(&response)
    );

    let heads = upstream.heads();
    assert_eq!(heads.len(), 1);
    let slots = header_values(&heads[0], "x-kalsa-slot");
    assert_eq!(slots.len(), 1, "the door sealed exactly one slot header");
    assert_ne!(
        slots[0], "999",
        "the client's slot value was forwarded: {slots:?}"
    );
    let salts = header_values(&heads[0], "x-kalsa-cache-salt");
    assert_eq!(salts.len(), 1, "the door sealed exactly one salt header");
    assert_ne!(
        salts[0], attacker_salt,
        "the client's salt value was forwarded"
    );

    // A repeated private header is ambiguous — the engine reads the FIRST
    // matching salt header — so the door refuses the head outright and the
    // upstream is never reached.
    let before = upstream.accepts();
    let mut duplicate = TcpStream::connect(address).unwrap();
    duplicate
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(
        duplicate,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\n\
         X-Kalsa-Slot: 0\r\nX-Kalsa-Slot: 1\r\n\
         Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut refusal = Vec::new();
    duplicate.read_to_end(&mut refusal).unwrap();
    assert!(
        refusal.starts_with(b"HTTP/1.1 401"),
        "a duplicate private header was not refused: {}",
        String::from_utf8_lossy(&refusal)
    );
    assert_eq!(
        upstream.accepts(),
        before,
        "a duplicate private header reached the upstream"
    );

    // The same for the salt, end to end: two client salt headers are just as
    // ambiguous as two slot headers, and the engine reads the FIRST.
    let mut duplicate_salt = TcpStream::connect(address).unwrap();
    duplicate_salt
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(
        duplicate_salt,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\n\
         X-Kalsa-Cache-Salt: {}\r\nX-Kalsa-Cache-Salt: {}\r\n\
         Content-Length: 0\r\nConnection: close\r\n\r\n",
        "0".repeat(64),
        "1".repeat(64),
    )
    .unwrap();
    let mut salt_refusal = Vec::new();
    duplicate_salt.read_to_end(&mut salt_refusal).unwrap();
    assert!(
        salt_refusal.starts_with(b"HTTP/1.1 401"),
        "a duplicate salt header was not refused: {}",
        String::from_utf8_lossy(&salt_refusal)
    );
    assert_eq!(
        upstream.accepts(),
        before,
        "a duplicate salt header reached the upstream"
    );

    // A private header the client names in its own `Connection` line dies
    // with the connection, value included, whether or not the private name
    // would have died anyway. Only the door's sealed slot reaches the engine.
    let mut named = TcpStream::connect(address).unwrap();
    named
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(
        named,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\n\
         Connection: x-kalsa-slot\r\n\
         X-Kalsa-Slot: 777\r\n\
         Content-Length: 0\r\n\r\n"
    )
    .unwrap();
    let mut named_response = Vec::new();
    named.read_to_end(&mut named_response).unwrap();
    assert!(
        named_response.starts_with(b"HTTP/1.1 200 OK"),
        "the request was not served after the named header was stripped: {}",
        String::from_utf8_lossy(&named_response)
    );
    let heads = upstream.heads();
    assert_eq!(heads.len(), 2, "the named-header request reached the upstream");
    let named_slots = header_values(&heads[1], "x-kalsa-slot");
    assert_eq!(
        named_slots.len(),
        1,
        "the named private header did not die: {}",
        String::from_utf8_lossy(&heads[1])
    );
    assert_ne!(
        named_slots[0], "777",
        "the client's named slot value was forwarded: {named_slots:?}"
    );
    door.shutdown();
}

#[test]
fn the_same_device_keeps_one_slot_across_two_requests() {
    let upstream = RecordingUpstream::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let door = Door::new_with_engine(listener, upstream.port, door_devices(&[&token]), 4, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();

    // Both requests are in flight at once; a per-request slot would hand the
    // second one a different id, evicting the first's warm cache.
    let first = {
        let token = token.clone();
        thread::spawn(move || request(address, Some(&format!("Bearer {token}"))))
    };
    let second = {
        let token = token.clone();
        thread::spawn(move || request(address, Some(&format!("Bearer {token}"))))
    };
    assert!(first.join().unwrap().starts_with(b"HTTP/1.1 200 OK"));
    assert!(second.join().unwrap().starts_with(b"HTTP/1.1 200 OK"));

    let heads = upstream.heads();
    assert_eq!(heads.len(), 2, "the upstream saw both requests");
    let slots: Vec<u32> = heads.iter().map(|head| sealed_slot(head)).collect();
    assert_eq!(
        slots[0], slots[1],
        "one device's two requests got different slots: {slots:?}"
    );
    assert_eq!(upstream.accepts(), 2);
    door.shutdown();
}

#[test]
fn the_cache_salt_is_never_logged() {
    // A guard, not a behavioral proof: it reads the crate's own source and
    // fails if the salt's name ever appears on a logging line. The salt is
    // cache-key material that goes to the engine and nowhere else; adding a
    // log line is the one change this test exists to stop.
    for (name, source) in [
        ("devices.rs", include_str!("../devices.rs")),
        ("proxy.rs", include_str!("../proxy.rs")),
        ("request.rs", include_str!("../request.rs")),
        ("lib.rs", include_str!("../lib.rs")),
    ] {
        for line in source.lines() {
            if !line.to_ascii_lowercase().contains("salt") {
                continue;
            }
            for loud in ["println!", "eprintln!", "dbg!", "print!", "panic!"] {
                assert!(
                    !line.contains(loud),
                    "{name}: the cache salt reached a logging line: {line}"
                );
            }
        }
    }
}

#[test]
fn the_slot_map_answers_the_slot_it_assigned() {
    let set = DeviceSet::new(door_devices(&[&credential(), &credential()]), 2);
    assert_eq!(set.slot_of(DeviceId::new(0)), None, "no slot before a request");
    let first = set.lease(DeviceId::new(0)).expect("the device is held");
    assert_eq!(first.slot(), 0);
    assert_eq!(set.slot_of(DeviceId::new(0)), Some(0));
    drop(first);
    assert_eq!(
        set.lease(DeviceId::new(0)).map(|lease| lease.slot()).ok(),
        Some(0),
        "the same device keeps its slot"
    );
    let second = set.lease(DeviceId::new(1)).expect("the device is held");
    assert_eq!(second.slot(), 1);
    assert_eq!(set.slot_of(DeviceId::new(1)), Some(1));
    // NotHeld and NoRoom are different facts with different refusals.
    assert!(matches!(
        set.lease(DeviceId::new(2)),
        Err(LeaseError::NotHeld)
    ));

    let set = DeviceSet::new(door_devices(&[&credential(), &credential(), &credential()]), 2);
    let _a = set.lease(DeviceId::new(0)).expect("held");
    let _b = set.lease(DeviceId::new(1)).expect("held");
    assert!(matches!(set.lease(DeviceId::new(2)), Err(LeaseError::NoRoom)));
}

#[test]
fn a_capacity_above_one_needs_the_engine_declaration() {
    // Fail closed: without an engine that reads the private headers, more
    // than one device would be auto-scheduled into one slot. The door must
    // refuse to be built, not serve it quietly.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let refused = Door::new(listener, 1, door_devices(&[&credential()]), 2);
    assert!(
        matches!(
            refused,
            Err(DoorError::CapacityWithoutHeaderSupport { capacity: 2 })
        ),
        "a two-device door was built without an engine declaration"
    );
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    assert!(Door::new_with_engine(
        listener,
        1,
        door_devices(&[&credential()]),
        2,
        EnginePrivateHeaders::Consumed,
    )
    .is_ok());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    assert!(Door::new(listener, 1, door_devices(&[&credential()]), 1).is_ok());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    assert!(matches!(
        Door::new(listener, 1, door_devices(&[&credential()]), 0),
        Err(DoorError::CapacityZero)
    ));
}

#[test]
fn no_slot_is_ever_in_two_sets_or_in_none() {
    // Double-free is what hands one slot to two devices, so the exact sizes
    // of the three disjoint sets are asserted at every step of the sequence.
    let (a, b, c) = (credential(), credential(), credential());
    let set = DeviceSet::new(device_set(&[(0, &a), (1, &b)]), 2);
    let partition = |set: &DeviceSet| {
        let (assigned, free, pending) = set.slot_cardinality();
        assert_eq!(
            assigned + free + pending,
            2,
            "assigned {assigned}, free {free}, pending {pending}"
        );
    };
    partition(&set);
    assert_eq!(set.slot_cardinality(), (0, 2, 0));
    let first = set.lease(DeviceId::new(0)).expect("held");
    assert_eq!(set.slot_cardinality(), (1, 1, 0));
    let second = set.lease(DeviceId::new(1)).expect("held");
    assert_eq!(set.slot_cardinality(), (2, 0, 0));
    // A revoked lease moves its slot out of `assigned` and out of `free`: it
    // waits, exactly once, in `pending_free`.
    set.swap(device_set(&[(1, &b)]));
    partition(&set);
    assert_eq!(set.slot_cardinality(), (1, 0, 1));
    drop(first);
    assert_eq!(set.slot_cardinality(), (1, 1, 0));
    drop(second);
    assert_eq!(set.slot_cardinality(), (1, 1, 0));
    set.swap(device_set(&[(1, &b), (2, &c)]));
    partition(&set);
    let newcomer = set.lease(DeviceId::new(2)).expect("held");
    assert_eq!(newcomer.slot(), 0, "the freed slot was not the one handed out");
    assert_eq!(set.slot_cardinality(), (2, 0, 0));
}

#[test]
fn two_leases_on_one_slot_release_it_exactly_once() {
    // Reference counting is where a double-free hides: two requests of one
    // device hold one slot, the device is revoked, and the slot must wait for
    // the SECOND drop, then be freed exactly once.
    let (a, b) = (credential(), credential());
    let set = DeviceSet::new(device_set(&[(0, &a)]), 1);
    let first = set.lease(DeviceId::new(0)).expect("held");
    let second = set.lease(DeviceId::new(0)).expect("held");
    assert_eq!(first.slot(), 0);
    assert_eq!(second.slot(), 0);
    assert_eq!(set.lease_count(0), 2);
    assert_eq!(set.slot_cardinality(), (1, 0, 0));
    set.swap(device_set(&[(1, &b)]));
    assert_eq!(set.lease_count(0), 2);
    assert_eq!(
        set.slot_cardinality(),
        (0, 0, 1),
        "the slot of two live leases must wait"
    );
    drop(first);
    assert_eq!(set.lease_count(0), 1);
    assert_eq!(
        set.slot_cardinality(),
        (0, 0, 1),
        "one live lease still holds the slot"
    );
    drop(second);
    assert_eq!(set.lease_count(0), 0);
    assert_eq!(
        set.slot_cardinality(),
        (0, 1, 0),
        "the slot must be freed exactly once, on the last drop"
    );
}
