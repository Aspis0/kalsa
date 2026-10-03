use std::io;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::queue::Queue;
use crate::registry::Registry;
use crate::{proxy, Door, DoorError, RunningDoor, ActiveDevices, BUSY_RESPONSE, MAX_CONNECTIONS, POLL_INTERVAL, QUEUE, REAP_INTERVAL, WORKERS};

struct Work {
    stream: TcpStream,
    accepted: Instant,
    /// The accept-budget slot this work occupies. Dropping the work — at the
    /// end of handling, on an early return, or through an unwind — hands the
    /// slot back, so one panicked request cannot shrink the door forever.
    _slot: SlotLease,
}

/// The RAII half of the accept budget: created when the accept loop counts a
/// connection in, dropped wherever the work ends up being handled or thrown
/// away. This is the same shape as proxy's `ActiveConnection`, for the same
/// reason: a `fetch_sub` after the call site is skippable by a panic, a Drop
/// is not.
struct SlotLease {
    connections: Arc<AtomicUsize>,
}

impl Drop for SlotLease {
    fn drop(&mut self) {
        self.connections.fetch_sub(1, Ordering::SeqCst);
    }
}

pub(super) fn start(door: Door) -> Result<RunningDoor, DoorError> {
    let stop = Arc::new(AtomicBool::new(false));
    let connections = Arc::new(AtomicUsize::new(0));
    let active = Arc::new(ActiveDevices::new());
    let registry = Arc::new(Registry::new());
    let device_set = Arc::clone(&door.devices);
    // The disk tier's state, built here where the capacity, the port and the
    // app-supplied halves are all in hand, and shared by every worker: the
    // per-slot gates and the resident map must be one per slot, not one per
    // worker.
    let chats = Arc::new(crate::paging::Chats::new(
        door.capacity,
        door.model_hash.clone(),
        door.slot_dir.clone(),
        door.idle_save,
    ));
    // The sweep runs here, before any worker exists: construction is the one
    // moment provably free of this door's own saves, and it is what clears
    // what a previous run left behind — a crash's staging file, a device
    // forgotten while no door was standing. On a set change the sweep runs
    // from `set_devices` instead; on the tick it never runs, because the
    // directory's ownership only changes at those two moments and a per-tick
    // read would race the ticker's own saves for nothing.
    chats.sweep(&device_set);
    // What every worker serves with, built once: the stop flag, the live
    // device set, the room, and the tier's map. One bundle because it is one
    // thing — the door's shared state — and the room's threads take clones
    // of it whole.
    let shared = Arc::new(crate::proxy::Shared {
        stop: Arc::clone(&stop),
        set: Arc::clone(&door.devices),
        room: door.room.clone(),
        port: door.upstream_port,
        slot_context: door.slot_context,
        clocks: door.clocks,
        chats: Arc::clone(&chats),
        seat_waiters: AtomicUsize::new(0),
        seat_waiting: Mutex::new(std::collections::HashSet::new()),
    });
    let queue = Arc::new(Queue::new(QUEUE));
    let mut threads = Vec::with_capacity(WORKERS + 2);

    for index in 0..WORKERS {
        let worker_active = Arc::clone(&active);
        let worker_queue = Arc::clone(&queue);
        let worker_registry = Arc::clone(&registry);
        let worker_shared = Arc::clone(&shared);
        let port = door.upstream_port;
        let capacity = door.capacity;
        let head_patience = door.head_patience;
        let observer = door.response_observer.clone();
        let result = thread::Builder::new()
            .name(format!("kalsa-door-worker-{index}"))
            .spawn(move || {
                worker(
                    worker_active,
                    worker_queue,
                    worker_registry,
                    worker_shared,
                    port,
                    capacity,
                    head_patience,
                    observer,
                )
            });
        match result {
            Ok(thread) => threads.push(thread),
            Err(error) => {
                stop.store(true, Ordering::SeqCst);
                join_all(threads);
                return Err(DoorError::Thread(error));
            }
        }
    }

    let queue_wait = door.clocks.queue_wait;
    let reaper_stop = Arc::clone(&stop);
    let reaper_registry = Arc::clone(&registry);
    let result = thread::Builder::new()
        .name("kalsa-door-reaper".into())
        .spawn(move || reaper(reaper_stop, reaper_registry));
    match result {
        Ok(thread) => threads.push(thread),
        Err(error) => {
            stop.store(true, Ordering::SeqCst);
            join_all(threads);
            return Err(DoorError::Thread(error));
        }
    }

    let address = door.address;
    let upstream_port = door.upstream_port;
    let listener = door.listener;
    let accept_stop = Arc::clone(&stop);
    let accept_connections = Arc::clone(&connections);
    let result = thread::Builder::new()
        .name("kalsa-door".into())
        .spawn(move || accept_loop(listener, queue, queue_wait, accept_stop, accept_connections));
    match result {
        Ok(thread) => threads.push(thread),
        Err(error) => {
            stop.store(true, Ordering::SeqCst);
            join_all(threads);
            return Err(DoorError::Thread(error));
        }
    }
    Ok(RunningDoor {
        stop,
        address,
        devices: device_set,
        active,
        chats,
        upstream_port,
        threads: Mutex::new(threads),
        room: door.room,
        shared: Some(shared),
    })
}

/// Forgets kept answers whose retention ran out, whether or not anything
/// else ever touches the registry again.
fn reaper(stop: Arc<AtomicBool>, registry: Arc<Registry>) {
    while !stop.load(Ordering::SeqCst) {
        registry.reap();
        let wake = Instant::now() + REAP_INTERVAL;
        while Instant::now() < wake && !stop.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(200));
        }
    }
}

fn accept_loop(
    listener: std::net::TcpListener,
    queue: Arc<Queue<Work>>,
    queue_wait: Duration,
    stop: Arc<AtomicBool>,
    connections: Arc<AtomicUsize>,
) {
    while !stop.load(Ordering::SeqCst) {
        // Answers can hold a worker for half an hour, so the line is swept on
        // every turn: whoever has waited too long is answered busy now, not
        // when a worker finally frees.
        for mut work in queue.expired(queue_wait) {
            reject_busy(&mut work.stream);
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                if connections.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                    reject_busy(&mut stream);
                    continue;
                }
                connections.fetch_add(1, Ordering::SeqCst);
                let lease = SlotLease {
                    connections: Arc::clone(&connections),
                };
                if stream.set_nonblocking(false).is_err() {
                    continue; // the lease drops here: the slot is handed back
                }
                let work = Work {
                    stream,
                    accepted: Instant::now(),
                    _slot: lease,
                };
                if let Err(mut work) = queue.push(work) {
                    reject_busy(&mut work.stream);
                    // work drops here: the lease hands the slot back
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(POLL_INTERVAL);
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => {
                log::error!("the door listener stopped: {error}");
                stop.store(true, Ordering::SeqCst);
            }
        }
    }
}

fn worker(
    active: Arc<ActiveDevices>,
    queue: Arc<Queue<Work>>,
    registry: Arc<Registry>,
    shared: Arc<crate::proxy::Shared>,
    upstream_port: u16,
    capacity: u32,
    head_patience: Duration,
    observer: Option<crate::ResponseObserverFactory>,
) {
    loop {
        match queue.pop(POLL_INTERVAL) {
            Some(work) => {
                if !shared.stop.load(Ordering::SeqCst) {
                    let response_observer = observer.as_ref().map(|factory| factory());
                    proxy::handle(
                        work.stream,
                        work.accepted,
                        head_patience,
                        upstream_port,
                        capacity,
                        &shared,
                        &registry,
                        &active,
                        response_observer.as_deref(),
                    );
                }
                // The work — and with it its slot — drops here, on every
                // path an unwind included. No manual fetch_sub to forget.
            }
            None if shared.stop.load(Ordering::SeqCst) => return,
            None => {}
        }
    }
}

/// How long the busy answer gets to be written, and how much of what the client
/// already sent is read off before the close. The accept loop runs this, so
/// both are small and hard: a client that keeps writing must not stall
/// accepting.
const BUSY_WRITE: Duration = Duration::from_millis(200);
const BUSY_DRAIN_BYTES: usize = 64 * 1024;
const BUSY_DRAIN_TIME: Duration = Duration::from_millis(50);

fn reject_busy(stream: &mut TcpStream) {
    // The answer first, whole: blocking, but only for a moment. (A socket
    // accepted from the non-blocking listener may inherit that mode.)
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_write_timeout(Some(BUSY_WRITE));
    log::warn!("{}", crate::audit::line::refusal_line(503, "door.listener_busy"));
    let _ = std::io::Write::write_all(stream, BUSY_RESPONSE);
    // Then take what the client has already sent: a request left unread
    // makes the close a reset, and a reset erases the answer just written.
    // A read that cannot be made non-blocking could wait for ever on a client
    // that has stopped sending: then there is nothing to drain, only a close.
    if stream.set_nonblocking(true).is_ok() {
        drain(stream);
    }
    let _ = stream.shutdown(std::net::Shutdown::Write);
}

/// Reads off what has already arrived, giving up at the byte and time caps
/// whatever the other end is still sending. Returns the bytes taken.
fn drain(stream: &mut impl std::io::Read) -> usize {
    let mut unread = [0u8; 16 * 1024];
    let mut drained = 0usize;
    let until = Instant::now() + BUSY_DRAIN_TIME;
    while drained < BUSY_DRAIN_BYTES && Instant::now() < until {
        match stream.read(&mut unread) {
            Ok(read) if read > 0 => drained += read,
            _ => break,
        }
    }
    drained
}

fn join_all(threads: Vec<thread::JoinHandle<()>>) {
    for thread in threads {
        let _ = thread.join();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn dropping_a_lease_frees_its_slot() {
        let connections = Arc::new(AtomicUsize::new(1));
        drop(SlotLease {
            connections: Arc::clone(&connections),
        });
        assert_eq!(
            connections.load(Ordering::SeqCst),
            0,
            "a dropped work item kept its accept slot"
        );
    }

    /// A client that keeps writing must not hold the accept loop: the busy
    /// answer is written whole, the drain gives up at its caps, and the call
    /// returns.
    #[test]
    fn a_client_that_keeps_writing_cannot_stall_the_busy_answer() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(address).unwrap();
        // Armed before the other end closes: macOS refuses the option after.
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let (mut accepted, _) = listener.accept().unwrap();
        let writer = {
            let mut sender = client.try_clone().unwrap();
            thread::spawn(move || {
                let chunk = [b'x'; 16 * 1024];
                // Writes for as long as the other end takes it.
                while sender.write_all(&chunk).is_ok() {}
            })
        };
        let begun = Instant::now();
        let (done, finished) = std::sync::mpsc::channel();
        let rejecting = thread::spawn(move || {
            reject_busy(&mut accepted);
            let _ = done.send(());
        });
        assert!(
            finished.recv_timeout(Duration::from_secs(3)).is_ok(),
            "reject_busy never returned: the drain has no cap"
        );
        let took = begun.elapsed();
        rejecting.join().unwrap();
        let mut answer = Vec::new();
        let _ = client.read_to_end(&mut answer);
        let _ = writer.join();
        assert!(took < Duration::from_millis(500), "the accept loop was held for {took:?}");
        assert!(
            answer.starts_with(BUSY_RESPONSE),
            "the busy answer arrived whole: {:?}",
            String::from_utf8_lossy(&answer)
        );
    }

    /// A reader that always has more, and one that trickles: the drain stops
    /// at its byte cap and at its time cap, never when the sender does.
    #[test]
    fn the_drain_stops_at_its_byte_and_time_caps() {
        struct Endless;
        impl Read for Endless {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                Ok(buf.len())
            }
        }
        struct Trickle;
        impl Read for Trickle {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                thread::sleep(Duration::from_millis(5));
                buf[0] = 0;
                Ok(1)
            }
        }
        let (done, finished) = std::sync::mpsc::channel();
        let worker = thread::spawn(move || {
            let begun = Instant::now();
            let endless = drain(&mut Endless);
            let trickled_from = Instant::now();
            let trickled = drain(&mut Trickle);
            let _ = done.send((endless, begun.elapsed(), trickled, trickled_from.elapsed()));
        });
        let (endless, _, trickled, trickle_time) = finished
            .recv_timeout(Duration::from_secs(3))
            .expect("the drain never returned: it has no cap");
        worker.join().unwrap();
        assert!(
            (BUSY_DRAIN_BYTES..BUSY_DRAIN_BYTES + 16 * 1024).contains(&endless),
            "an endless sender is cut at the byte cap: {endless}"
        );
        assert!(
            trickle_time < Duration::from_millis(500) && trickled < BUSY_DRAIN_BYTES,
            "a slow sender is cut at the time cap: {trickled} bytes in {trickle_time:?}"
        );
    }
}
