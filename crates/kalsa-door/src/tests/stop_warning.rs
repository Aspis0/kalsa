//! What a stop says on the log: a wake that lands says nothing, a second
//! stop — the `Drop` after the app's own `stop_door` — says nothing, and the
//! one door worth a warning is the one whose acceptor is still in it after
//! every attempt.
//!
//! The claim is the line's address, never the line order: the capture is one
//! for the whole test binary, and each door here binds its own port.

use std::net::{SocketAddr, TcpListener};
use std::time::{Duration, Instant};

use super::logging::{capture, line_count, lines};
use super::support::*;
use super::*;

/// A port nothing listens on: these doors are stopped before any request, so
/// their upstream is never reached.
fn no_upstream() -> u16 {
    let scout = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = scout.local_addr().unwrap().port();
    drop(scout);
    port
}

/// The one line a failed wake writes, for the address a door wakes.
fn wake_warnings_for(address: SocketAddr, since: usize) -> Vec<String> {
    let said = format!("could not be woken at {address}");
    lines()
        .lock()
        .unwrap()
        .iter()
        .skip(since)
        .filter(|line| line.contains(&said))
        .cloned()
        .collect()
}

/// The ordinary door: a stop wakes its acceptor out of the blocking accept,
/// and says nothing about it.
#[test]
fn a_first_stop_that_wakes_the_acceptor_is_silent() {
    bounded(Duration::from_secs(20), || {
        capture();
        let (door, address) = door(no_upstream(), &[&credential()]);
        // The acceptor is in its wait: nothing has knocked and nothing will.
        thread::sleep(Duration::from_millis(50));
        let since = line_count();
        door.shutdown();
        let warned = wake_warnings_for(address, since);
        assert!(
            warned.is_empty(),
            "a wake that landed is not news: {warned:?}"
        );
    });
}

/// The door's own `Drop` stops it a second time — the app calls `shutdown`
/// and the `Arc<RunningDoor>` it hands out is dropped later, long after the
/// acceptor left. That second stop cannot wake anything, and it must not say
/// it could not.
#[test]
fn the_stop_that_drop_adds_after_an_explicit_one_is_silent() {
    bounded(Duration::from_secs(20), || {
        capture();
        let (door, address) = door(no_upstream(), &[&credential()]);
        thread::sleep(Duration::from_millis(50));
        door.shutdown();
        let since = line_count();
        drop(door);
        let warned = wake_warnings_for(address, since);
        assert!(
            warned.is_empty(),
            "the acceptor had already left: {warned:?}"
        );
    });
}

/// A wake that cannot land while the acceptor is still blocked in `accept`
/// IS the warning: that door's accept loop will never look at the stop flag
/// again, and a report has to carry it.
#[test]
fn a_wake_that_cannot_land_while_the_acceptor_waits_warns() {
    bounded(Duration::from_secs(20), || {
        capture();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut door = Door::new(listener, no_upstream(), door_devices(&[&credential()]), 1)
            .unwrap()
            .start()
            .unwrap();
        // A scouted-then-released port: nothing listens, so every wake
        // attempt is refused and the acceptor is never reached.
        let scout = TcpListener::bind("127.0.0.1:0").unwrap();
        let dead = scout.local_addr().unwrap();
        drop(scout);
        door.point_wake_at(dead);
        thread::sleep(Duration::from_millis(50));
        let since = line_count();
        let begun = Instant::now();
        door.shutdown();
        assert!(
            begun.elapsed() < Duration::from_secs(6),
            "a wake that could not land held shutdown"
        );
        let warned = wake_warnings_for(dead, since);
        assert_eq!(
            warned.len(),
            1,
            "an acceptor still waiting for a wake that cannot land is the one case that warns: {warned:?}"
        );
    });
}
