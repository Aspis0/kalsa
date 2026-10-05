//! The door's exit, on a bound: a worker inside a handler and a wake that
//! cannot land must not hold `shutdown`. It gives its threads a bounded wait,
//! names what it left, and returns — the process, on its way out, is not held
//! for a thread that will not come back.

use super::patience::ask;
use super::support::*;
use super::*;
use crate::clocks::Clocks;

/// A worker inside a handler must not hold the exit: the engine here answers
/// nothing, so the worker is in the response wait when shutdown lands.
#[test]
fn a_worker_stuck_in_a_handler_does_not_hold_shutdown() {
    bounded(Duration::from_secs(20), || {
        let upstream = HoldingUpstream::start();
        let token = credential();
        let clocks = Clocks::default().patience(Duration::from_secs(30));
        let (door, address) = door_with(upstream.port, &[&token], clocks);
        let _client = ask(address, &token);
        // The worker is only in the handler once the engine has been reached.
        let deadline = Instant::now() + Duration::from_secs(2);
        while upstream.accepts() == 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            upstream.accepts() > 0,
            "the request never reached the engine"
        );
        let begun = Instant::now();
        door.shutdown();
        let took = begun.elapsed();
        assert!(
            took < Duration::from_secs(4),
            "shutdown waited for the worker inside the handler: {took:?}"
        );
    });
}

/// A wake whose connect cannot land is tried a few times, named, and given up
/// on: shutdown still returns, with the acceptor left to the process.
#[test]
fn a_wake_that_cannot_land_does_not_hold_shutdown() {
    bounded(Duration::from_secs(20), || {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut door = Door::new(listener, 1, door_devices(&[&credential()]), 1)
            .unwrap()
            .start()
            .unwrap();
        // A scouted-then-released port: nothing listens, so every wake
        // attempt is refused.
        let scout = TcpListener::bind("127.0.0.1:0").unwrap();
        let dead = scout.local_addr().unwrap();
        drop(scout);
        door.point_wake_at(dead);
        // Let the acceptor reach its wait.
        thread::sleep(Duration::from_millis(50));
        let begun = Instant::now();
        door.shutdown();
        let took = begun.elapsed();
        assert!(
            took < Duration::from_secs(6),
            "a wake that could not land held shutdown: {took:?}"
        );
    });
}
