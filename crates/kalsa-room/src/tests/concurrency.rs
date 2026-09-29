//! Concurrency: writers serialize under the write lock while a reader
//! follows the stream — one seq order, no gaps, no duplicates, and the
//! reader never blocked by a writer's fsync (it would time out otherwise;
//! the assertion is the order itself).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::open;
use crate::{Event, Take};

const PER_WRITER: usize = 25;

#[test]
fn concurrent_writers_keep_one_order_and_a_reader_sees_no_gaps() {
    let (_dir, room) = open("concurrency_order");
    let room = Arc::new(room);
    let stop = Arc::new(AtomicBool::new(false));
    let seen = Arc::new(Mutex::new(Vec::new()));

    let reader = {
        let room = room.clone();
        let stop = stop.clone();
        let seen = seen.clone();
        std::thread::spawn(move || {
            let mut cursor = 0;
            let drain = |cursor: &mut usize| {
                let mut out = Vec::new();
                room.read_since(cursor, Instant::now() + Duration::from_millis(20), &mut out);
                seen.lock().unwrap().extend(out);
            };
            while !stop.load(Ordering::SeqCst) {
                drain(&mut cursor);
            }
            // The writers are done; one last patient drain to the end.
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let mut out = Vec::new();
                let take = room.read_since(&mut cursor, deadline, &mut out);
                seen.lock().unwrap().extend(out);
                if take == Take::TimedOut {
                    break;
                }
            }
        })
    };

    let writer = |device: u32| {
        let room = room.clone();
        std::thread::spawn(move || {
            let member = room.enroll(device).expect("the device enrolls");
            let mut posted = Vec::new();
            for n in 0..PER_WRITER {
                let entry = room
                    .post(member, &format!("d{device}-m{n}"), "text", false)
                    .expect("the post lands");
                posted.push(entry.seq);
            }
            posted
        })
    };
    let first = writer(3);
    let second = writer(4);
    let mut seqs = first.join().unwrap();
    seqs.extend(second.join().unwrap());
    stop.store(true, Ordering::SeqCst);
    reader.join().unwrap();

    // One order: every seq exactly once, 1..=50.
    let mut sorted = seqs.clone();
    sorted.sort_unstable();
    assert_eq!(
        sorted,
        (1..=(2 * PER_WRITER) as u64).collect::<Vec<_>>(),
        "no gaps, no duplicates, strictly one order"
    );
    // Each writer's own entries climbed: nobody's post landed behind its
    // own earlier post.
    for half in [seqs[..PER_WRITER].to_vec(), seqs[PER_WRITER..].to_vec()] {
        assert!(
            half.windows(2).all(|pair| pair[0] < pair[1]),
            "a writer's own entries keep their order: {half:?}"
        );
    }
    // The reader saw the same set, and never the same entry twice.
    let delivered: Vec<u64> = seen
        .lock()
        .unwrap()
        .iter()
        .filter_map(|event| match event {
            Event::Message(entry) => Some(entry.seq),
            Event::Member(_) => None,
        })
        .collect();
    let mut unique = delivered.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), delivered.len(), "no duplicate delivery");
    assert_eq!(unique, sorted, "the stream delivered every entry");
}
