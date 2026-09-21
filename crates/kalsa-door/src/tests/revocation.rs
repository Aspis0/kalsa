//! Revocation against an in-flight request: the lease, the revocation gate,
//! and the two refusals.

use super::support::*;
use super::*;

#[test]
fn revocation_frees_the_slot_and_kept_devices_keep_theirs() {
    // Part 1: capacity 1. The device holding the only slot is removed, and
    // the device that replaces it is served — not refused — because the
    // revocation returned the slot to the free set.
    let upstream = RecordingUpstream::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (a, b) = (credential(), credential());
    let door = Door::new(listener, upstream.port, door_devices(&[&a]), 1)
        .unwrap()
        .start()
        .unwrap();
    let first = request(address, Some(&format!("Bearer {a}")));
    assert!(first.starts_with(b"HTTP/1.1 200 OK"));
    door.set_devices(door_devices(&[&b]));
    let second = request(address, Some(&format!("Bearer {b}")));
    assert!(
        second.starts_with(b"HTTP/1.1 200 OK"),
        "the freed slot was not reused: {}",
        String::from_utf8_lossy(&second)
    );
    let heads = upstream.heads();
    assert_eq!(sealed_slot(&heads[0]), 0);
    assert_eq!(
        sealed_slot(&heads[1]),
        0,
        "the only slot was not handed to the replacement device"
    );
    door.shutdown();

    // Part 2: capacity 2. The leaving device takes slot 0 first, so the
    // keeper holds slot 1. Removing the leaving device must not move the
    // keeper: a re-densified map would hand the keeper slot 0 and change its
    // warm-cache identity without the owner asking.
    let upstream = RecordingUpstream::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (keeper, leaving) = (credential(), credential());
    let door = Door::new_with_engine(listener, upstream.port, door_devices(&[&keeper, &leaving]), 2, EnginePrivateHeaders::Consumed)
        .unwrap()
        .start()
        .unwrap();
    let leaving_answer = request(address, Some(&format!("Bearer {leaving}")));
    assert!(leaving_answer.starts_with(b"HTTP/1.1 200 OK"));
    let keeper_answer = request(address, Some(&format!("Bearer {keeper}")));
    assert!(keeper_answer.starts_with(b"HTTP/1.1 200 OK"));
    let before = upstream.heads();
    assert_eq!(sealed_slot(&before[0]), 0);
    assert_eq!(sealed_slot(&before[1]), 1);

    door.set_devices(door_devices(&[&keeper]));
    let keeper_again = request(address, Some(&format!("Bearer {keeper}")));
    assert!(keeper_again.starts_with(b"HTTP/1.1 200 OK"));
    let after = upstream.heads();
    assert_eq!(
        sealed_slot(after.last().unwrap()),
        1,
        "a kept device's slot moved after another device was removed"
    );
    door.shutdown();
}

#[test]
fn a_swap_that_revokes_a_device_is_atomic_with_the_slot_decision() {
    // The interleaving the race needs, forced rather than raced: a worker
    // authenticates against the old set, the owner revokes that device, and
    // only then does the worker ask for its slot. The decision must see the
    // NEW set, refuse with NotHeld, and never allocate a slot the revoked
    // device would keep forever.
    let (a, b) = (credential(), credential());
    let set = DeviceSet::new(device_set(&[(0, &a)]), 1);
    // The authentication an in-flight worker already did.
    let authenticated = set.current();
    assert!(authenticated.contains(DeviceId::new(0)));
    // The owner's forget lands before the door reaches its slot decision.
    set.swap(device_set(&[(1, &b)]));
    assert!(matches!(set.lease(DeviceId::new(0)), Err(LeaseError::NotHeld)));
    assert_eq!(
        set.slot_of(DeviceId::new(0)),
        None,
        "a revoked device kept a slot"
    );
    // The replacement gets the freed slot, and the old device's slot is not
    // stranded.
    let replacement = set.lease(DeviceId::new(1)).expect("the replacement is held");
    assert_eq!(replacement.slot(), 0);
}

#[test]
fn a_revoked_request_cannot_have_its_slot_taken_while_it_is_leased() {
    // The other half: a device is revoked WHILE its request holds the slot.
    // The slot must not be handed to the replacement until the revoked
    // request lets go — otherwise two devices would share one slot across
    // the swap.
    let (a, b) = (credential(), credential());
    let set = DeviceSet::new(device_set(&[(0, &a)]), 1);
    let revoked = set.lease(DeviceId::new(0)).expect("A is held");
    assert_eq!(revoked.slot(), 0);
    set.swap(device_set(&[(1, &b)]));
    assert!(
        !revoked.holds(),
        "the lease still claims a revoked device is held"
    );
    assert_eq!(
        set.slot_of(DeviceId::new(0)),
        None,
        "the revoked device is still in the map"
    );
    assert!(
        matches!(set.lease(DeviceId::new(1)), Err(LeaseError::NoRoom)),
        "the revoked device's slot was handed to another device while its request ran"
    );
    drop(revoked);
    let replacement = set
        .lease(DeviceId::new(1))
        .expect("the slot was released with the lease");
    assert_eq!(replacement.slot(), 0);
}

#[test]
fn a_kept_device_keeps_its_slot_across_a_swap() {
    // Re-densification is the other way to share a slot: removing device 0
    // must not move device 1 from slot 1 down to slot 0.
    let (a, b) = (credential(), credential());
    let set = DeviceSet::new(device_set(&[(0, &a), (1, &b)]), 2);
    let first = set.lease(DeviceId::new(0)).expect("A is held");
    assert_eq!(first.slot(), 0);
    let second = set.lease(DeviceId::new(1)).expect("B is held");
    assert_eq!(second.slot(), 1);
    drop(first);
    drop(second);
    set.swap(device_set(&[(1, &b)]));
    assert_eq!(set.slot_of(DeviceId::new(0)), None);
    assert_eq!(
        set.slot_of(DeviceId::new(1)),
        Some(1),
        "a kept device's slot moved"
    );
}

#[test]
fn a_revoked_device_has_no_cache_salt() {
    // The salt is reachable only while the set holds the device. A revoked
    // id answers None, so no request can name a cache for a device that is
    // gone.
    let (a, b) = (credential(), credential());
    let set = DeviceSet::new(device_set(&[(0, &a)]), 2);
    assert!(set.cache_salt(DeviceId::new(0)).is_some());
    assert!(set.cache_salt(DeviceId::new(1)).is_none());
    set.swap(device_set(&[(1, &b)]));
    assert!(
        set.cache_salt(DeviceId::new(0)).is_none(),
        "a revoked device still had a cache salt"
    );
    assert!(set.cache_salt(DeviceId::new(1)).is_some());
}

#[test]
fn a_revocation_waits_for_the_write_it_must_not_cut() {
    // The gate, held directly so the wait is deterministic instead of a race:
    // while a request holds it shared, the owner's forget cannot install the
    // new set; once released, the forget goes through.
    let (a, b) = (credential(), credential());
    let set = Arc::new(DeviceSet::new(device_set(&[(0, &a)]), 1));
    let guard = set.revocation_guard_for_test();
    let (started, beginning) = mpsc::channel();
    let (finished, waiting) = mpsc::channel();
    let forgetting = {
        let set = Arc::clone(&set);
        thread::spawn(move || {
            let _ = started.send(());
            set.swap(device_set(&[(1, &b)]));
            let _ = finished.send(());
        })
    };
    beginning
        .recv_timeout(Duration::from_secs(2))
        .expect("the forgetting thread never started");
    assert!(
        waiting.recv_timeout(Duration::from_millis(200)).is_err(),
        "the swap did not wait for the write it must not cut"
    );
    drop(guard);
    waiting
        .recv_timeout(Duration::from_secs(2))
        .expect("the swap never finished after the guard was released");
    forgetting.join().unwrap();
    assert_eq!(set.slot_of(DeviceId::new(0)), None);
}

#[test]
fn the_request_write_holds_the_gate_against_a_forget() {
    // The REAL request path, not the helper: a hook parks the request inside
    // the gated write block, the owner forgets the device, and the forget
    // cannot finish until the request leaves the block. The start handshake
    // removes the thread-has-not-started race; the 200 ms wait is still a
    // timing assumption, just no longer a lucky one.
    let upstream = RecordingUpstream::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let replacement = credential();
    let set = Arc::new(DeviceSet::new(device_set(&[(0, &token)]), 1));
    let (parked, reached) = mpsc::channel();
    let (release, leaving) = mpsc::channel::<()>();
    set.set_in_write_hook(move || {
        let _ = parked.send(());
        let _ = leaving.recv();
    });
    let request = {
        let set = Arc::clone(&set);
        let upstream_port = upstream.port;
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let stop = AtomicBool::new(false);
            let active = ActiveDevices::new();
            let registry = Registry::new();
            proxy::handle(
                stream,
                Instant::now(),
                crate::HEAD_PATIENCE,
                upstream_port,
                1,
                &set,
                &crate::paging::Chats::new(1, None, None),
                &registry,
                &stop,
                &active,
                None,
            );
        })
    };
    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\nContent-Length: 0\r\n\
         Connection: close\r\n\r\n"
    )
    .unwrap();
    reached
        .recv_timeout(Duration::from_secs(2))
        .expect("the request never reached the gated write");
    let (started, beginning) = mpsc::channel();
    let (finished, waiting) = mpsc::channel();
    let forgetting = {
        let set = Arc::clone(&set);
        thread::spawn(move || {
            let _ = started.send(());
            set.swap(device_set(&[(1, &replacement)]));
            let _ = finished.send(());
        })
    };
    beginning
        .recv_timeout(Duration::from_secs(2))
        .expect("the forgetting thread never started");
    assert!(
        waiting.recv_timeout(Duration::from_millis(200)).is_err(),
        "the gated request write did not hold the forget"
    );
    let _ = release.send(());
    request.join().unwrap();
    waiting
        .recv_timeout(Duration::from_secs(2))
        .expect("the forget never finished after the write left the gate");
    forgetting.join().unwrap();
    drop(client);
}

#[test]
fn a_revoked_device_is_refused_without_opening_an_upstream_socket() {
    // The device authenticates, the owner forgets it, and only then does the
    // door reach its slot decision. The decision must see the new set and
    // answer the one 401, and the upstream must never see a connection.
    let upstream = RecordingUpstream::start();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = credential();
    let replacement = credential();
    let set = Arc::new(DeviceSet::new(device_set(&[(0, &token)]), 1));
    let forgetting = Arc::clone(&set);
    set.set_before_lease_hook(move || {
        forgetting.swap(device_set(&[(1, &replacement)]));
    });
    let server = {
        let set = Arc::clone(&set);
        let upstream_port = upstream.port;
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let stop = AtomicBool::new(false);
            let active = ActiveDevices::new();
            let registry = Registry::new();
            proxy::handle(
                stream,
                Instant::now(),
                crate::HEAD_PATIENCE,
                upstream_port,
                1,
                &set,
                &crate::paging::Chats::new(1, None, None),
                &registry,
                &stop,
                &active,
                None,
            );
        })
    };
    let mut client = TcpStream::connect(address).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    write!(
        client,
        "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
         Authorization: Bearer {token}\r\nContent-Length: 0\r\n\
         Connection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = Vec::new();
    client.read_to_end(&mut response).unwrap();
    assert!(
        response.starts_with(b"HTTP/1.1 401"),
        "the revoked device was not refused: {}",
        String::from_utf8_lossy(&response)
    );
    server.join().unwrap();
    assert_eq!(
        upstream.accepts(),
        0,
        "the refusal opened an upstream connection"
    );
}
