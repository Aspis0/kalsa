use std::io;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::registry::Registry;
use crate::{proxy, Door, DoorError, RunningDoor, ActiveDevices, BUSY_RESPONSE, DeviceSet, MAX_CONNECTIONS, POLL_INTERVAL, QUEUE, REAP_INTERVAL, WORKERS};

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
    let (sender, receiver) = mpsc::sync_channel(QUEUE);
    let receiver = Arc::new(Mutex::new(receiver));
    let mut threads = Vec::with_capacity(WORKERS + 2);

    for index in 0..WORKERS {
        let worker_stop = Arc::clone(&stop);
        let worker_active = Arc::clone(&active);
        let worker_receiver = Arc::clone(&receiver);
        let worker_registry = Arc::clone(&registry);
        let worker_devices = Arc::clone(&door.devices);
        let worker_chats = Arc::clone(&chats);
        let port = door.upstream_port;
        let capacity = door.capacity;
        let head_patience = door.head_patience;
        let observer = door.response_observer.clone();
        let result = thread::Builder::new()
            .name(format!("kalsa-door-worker-{index}"))
            .spawn(move || {
                worker(
                    worker_stop,
                    worker_active,
                    worker_receiver,
                    worker_registry,
                    worker_devices,
                    worker_chats,
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
                drop(sender);
                join_all(threads);
                return Err(DoorError::Thread(error));
            }
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
        .spawn(move || accept_loop(listener, sender, accept_stop, accept_connections));
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
    sender: mpsc::SyncSender<Work>,
    stop: Arc<AtomicBool>,
    connections: Arc<AtomicUsize>,
) {
    while !stop.load(Ordering::SeqCst) {
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
                match sender.try_send(work) {
                    Ok(()) => {}
                    Err(mpsc::TrySendError::Full(mut work)) => {
                        reject_busy(&mut work.stream);
                        // work drops here: the lease hands the slot back
                    }
                    Err(mpsc::TrySendError::Disconnected(mut work)) => {
                        reject_busy(&mut work.stream);
                        eprintln!("kalsa door worker pool stopped");
                        stop.store(true, Ordering::SeqCst);
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(POLL_INTERVAL);
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => {
                eprintln!("kalsa door listener stopped: {error}");
                stop.store(true, Ordering::SeqCst);
            }
        }
    }
}

fn worker(
    stop: Arc<AtomicBool>,
    active: Arc<ActiveDevices>,
    receiver: Arc<Mutex<mpsc::Receiver<Work>>>,
    registry: Arc<Registry>,
    devices: Arc<DeviceSet>,
    chats: Arc<crate::paging::Chats>,
    upstream_port: u16,
    capacity: u32,
    head_patience: Duration,
    observer: Option<crate::ResponseObserverFactory>,
) {
    loop {
        let result = receiver
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(POLL_INTERVAL);
        match result {
            Ok(work) => {
                if !stop.load(Ordering::SeqCst) {
                    let response_observer = observer.as_ref().map(|factory| factory());
                    proxy::handle(
                        work.stream,
                        work.accepted,
                        head_patience,
                        upstream_port,
                        capacity,
                        &devices,
                        &chats,
                        &registry,
                        &stop,
                        &active,
                        response_observer.as_deref(),
                    );
                }
                // The work — and with it its slot — drops here, on every
                // path an unwind included. No manual fetch_sub to forget.
            }
            Err(mpsc::RecvTimeoutError::Timeout) if stop.load(Ordering::SeqCst) => return,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn reject_busy(stream: &mut TcpStream) {
    let _ = stream.set_nonblocking(true);
    let _ = std::io::Write::write_all(stream, BUSY_RESPONSE);
}

fn join_all(threads: Vec<thread::JoinHandle<()>>) {
    for thread in threads {
        let _ = thread.join();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
