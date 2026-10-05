use std::io;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::queue::Queue;
use crate::registry::Registry;
use crate::{proxy, Door, DoorError, RunningDoor, ActiveDevices, BUSY_RESPONSE, MAX_CONNECTIONS, QUEUE, REAP_INTERVAL, WORKERS};

/// One accepted connection waiting for a worker. `pub(super)` because the
/// running door keeps the line shutdown closes, and the line holds these.
pub(super) struct Work {
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
    let mut threads = Vec::with_capacity(WORKERS + 3);

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
                queue.close();
                stop_threads(threads);
                return Err(DoorError::Thread(error));
            }
        }
    }

    let queue_wait = door.clocks.queue_wait;
    let sweeper_stop = Arc::clone(&stop);
    let sweeper_queue = Arc::clone(&queue);
    let result = thread::Builder::new()
        .name("kalsa-door-sweeper".into())
        .spawn(move || sweeper(sweeper_stop, sweeper_queue, queue_wait));
    match result {
        Ok(thread) => threads.push(thread),
        Err(error) => {
            stop.store(true, Ordering::SeqCst);
            queue.close();
            stop_threads(threads);
            return Err(DoorError::Thread(error));
        }
    }

    let reaper_stop = Arc::clone(&stop);
    let reaper_registry = Arc::clone(&registry);
    let result = thread::Builder::new()
        .name("kalsa-door-reaper".into())
        .spawn(move || reaper(reaper_stop, reaper_registry));
    match result {
        Ok(thread) => threads.push(thread),
        Err(error) => {
            stop.store(true, Ordering::SeqCst);
            queue.close();
            stop_threads(threads);
            return Err(DoorError::Thread(error));
        }
    }

    let address = door.address;
    let upstream_port = door.upstream_port;
    let listener = door.listener;
    let accept_stop = Arc::clone(&stop);
    let accept_connections = Arc::clone(&connections);
    let accept_queue = Arc::clone(&queue);
    #[cfg(test)]
    let accept_passes = Arc::new(AtomicUsize::new(0));
    #[cfg(test)]
    let accept_counter = Arc::clone(&accept_passes);
    let result = thread::Builder::new()
        .name(ACCEPTOR_THREAD.into())
        .spawn(move || {
            accept_loop(
                listener,
                accept_queue,
                accept_stop,
                accept_connections,
                #[cfg(test)]
                accept_counter,
            )
        });
    match result {
        Ok(thread) => threads.push(thread),
        Err(error) => {
            stop.store(true, Ordering::SeqCst);
            queue.close();
            stop_threads(threads);
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
        queue,
        wake: address,
        #[cfg(test)]
        accept_passes,
        threads: Mutex::new(threads),
        room: door.room,
        shared: Some(shared),
    })
}

/// How long one wake connect may take. A listener that is there accepts at
/// once and one that is gone refuses at once; this bound only covers the
/// third case, a backlog nobody is reading.
const WAKE_TIMEOUT: Duration = Duration::from_millis(300);
/// How many times the wake is tried before the door gives up on the connect.
/// The acceptor may be mid-accept on a real connection when the first attempt
/// lands, so one failure is not a verdict.
const WAKE_TRIES: u32 = 5;
/// The pause between wake attempts.
const WAKE_RETRY: Duration = Duration::from_millis(50);
/// How long the door's threads are given to leave it. A worker can be inside
/// an answer's whole ceiling (see `clocks`), and the process is on its way
/// out: a thread still running past this is left to die with the process, and
/// named in one warning. Never a silent give-up, never an unbounded wait.
const JOIN_DEADLINE: Duration = Duration::from_secs(2);
/// How often the bounded join looks at a thread that has not finished. The
/// wait is a poll because std's `join` has no deadline, and this runs once,
/// on the way out.
const JOIN_POLL: Duration = Duration::from_millis(10);

/// The acceptor thread's name, in one place: the spawn below and the
/// question a failed wake asks of the handles.
pub(super) const ACCEPTOR_THREAD: &str = "kalsa-door";

/// Whether the acceptor is still in the door, asked of the handles a stop is
/// about to wait on (before they are joined). A wake that did not land is
/// only news while this is true: an acceptor that already left answers a
/// refused connect with nobody left to lose.
pub(super) fn acceptor_waiting(threads: &[thread::JoinHandle<()>]) -> bool {
    threads
        .iter()
        .any(|thread| thread.thread().name() == Some(ACCEPTOR_THREAD) && !thread.is_finished())
}

/// Wakes a listener blocked in `accept` with a loopback connect carrying
/// nothing: the acceptor takes the connection as its wake, checks the stop
/// flag and leaves. Tried a few times, because the acceptor may be mid-accept
/// on a real connection when the first attempt lands. False when no attempt
/// landed — the caller says so, because a door that cannot be woken is a door
/// whose acceptor will not come back.
pub(super) fn wake(address: std::net::SocketAddr) -> bool {
    for attempt in 0..WAKE_TRIES {
        if TcpStream::connect_timeout(&address, WAKE_TIMEOUT).is_ok() {
            return true;
        }
        if attempt + 1 < WAKE_TRIES {
            thread::sleep(WAKE_RETRY);
        }
    }
    false
}

/// Forgets kept answers whose retention ran out, whether or not anything
/// else ever touches the registry again. One interruptible wait for the whole
/// period: `stop_threads` unparks this thread on the way down, and a park that
/// never happened is not a wake lost — `park_timeout` keeps the permit.
fn reaper(stop: Arc<AtomicBool>, registry: Arc<Registry>) {
    while !stop.load(Ordering::SeqCst) {
        registry.reap();
        thread::park_timeout(REAP_INTERVAL);
    }
}

/// Answers the clients whose wait in the line ran out. An answer can hold a
/// worker for half an hour, so the bound has to be kept by someone who is not
/// a worker: this thread sleeps on the line's own condvar until the oldest
/// item's wait ends — no poll, and no wake at all while the line is empty.
fn sweeper(stop: Arc<AtomicBool>, queue: Arc<Queue<Work>>, bound: Duration) {
    while !stop.load(Ordering::SeqCst) {
        let Some(expired) = queue.take_expired(bound) else {
            return; // the line closed: the door is stopping
        };
        for mut work in expired {
            // The join is waiting on this thread now; a batch of busy answers
            // must not hold it up. The clients left unread meet the close.
            if stop.load(Ordering::SeqCst) {
                return;
            }
            reject_busy(&mut work.stream);
        }
    }
}

fn accept_loop(
    listener: std::net::TcpListener,
    queue: Arc<Queue<Work>>,
    stop: Arc<AtomicBool>,
    connections: Arc<AtomicUsize>,
    #[cfg(test)] passes: Arc<AtomicUsize>,
) {
    while !stop.load(Ordering::SeqCst) {
        #[cfg(test)]
        passes.fetch_add(1, Ordering::SeqCst);
        match listener.accept() {
            Ok((mut stream, _)) => {
                // The wake a shutdown sends: a loopback connect to this very
                // listener, carrying nothing. The accept lands here, the flag
                // is already set, and the connection is dropped unread.
                if stop.load(Ordering::SeqCst) {
                    return;
                }
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
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => {
                log::error!("the door listener stopped: {error}");
                stop.store(true, Ordering::SeqCst);
                // The workers wait on the line, not on the flag: a door that
                // can accept no more must close it or they sleep for good.
                queue.close();
                return;
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
    // A closed line is the door stopping; work already in it against the stop
    // flag is dropped, not served.
    while let Some(work) = queue.pop() {
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
        // The work — and with it its slot — drops here, on every path an
        // unwind included. No manual fetch_sub to forget.
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
    // The answer first, whole: blocking, but only for a moment. The listener
    // accepts in blocking mode, so this mostly settles a mode already right —
    // and the answer must not be lost to a `WouldBlock` on the one socket that
    // inherited something else.
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

pub(super) fn stop_threads(threads: Vec<thread::JoinHandle<()>>) {
    let left = join_all_until(threads, JOIN_DEADLINE);
    if !left.is_empty() {
        let names: Vec<&str> = left
            .iter()
            .filter_map(|thread| thread.thread().name())
            .collect();
        log::warn!("the door did not stop within {JOIN_DEADLINE:?}: still running {names:?}");
    }
}

/// The bounded join: a thread that has finished is joined, one that has not
/// finished by `bound` is handed back for the caller to drop (detach it).
/// Every wait is against one absolute deadline, so a whole set of stuck
/// threads costs `bound` and not `bound` each. The reaper sleeps a whole
/// `REAP_INTERVAL` between stop checks, so each thread is unparked first;
/// unparking a thread that is not parked only sets a permit its next park
/// consumes, and an early unpark costs one extra reap at worst.
fn join_all_until(
    threads: Vec<thread::JoinHandle<()>>,
    bound: Duration,
) -> Vec<thread::JoinHandle<()>> {
    // Every thread is unparked before the first wait, so the reaper's whole
    // period is cut even when an earlier thread is the one that never leaves.
    for thread in &threads {
        thread.thread().unpark();
    }
    let until = Instant::now() + bound;
    let mut left = Vec::new();
    for thread in threads {
        while !thread.is_finished() && Instant::now() < until {
            thread::sleep(JOIN_POLL);
        }
        if thread.is_finished() {
            let _ = thread.join();
        } else {
            left.push(thread);
        }
    }
    left
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
