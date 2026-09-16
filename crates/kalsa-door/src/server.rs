use std::io;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Instant;

use crate::{proxy, Door, DoorError, RunningDoor, MAX_CONNECTIONS, POLL_INTERVAL, QUEUE, WORKERS};

struct Work {
    stream: TcpStream,
    accepted: Instant,
}

pub(super) fn start(door: Door) -> Result<RunningDoor, DoorError> {
    let stop = Arc::new(AtomicBool::new(false));
    let active = Arc::new(AtomicUsize::new(0));
    let (sender, receiver) = mpsc::sync_channel(QUEUE);
    let receiver = Arc::new(Mutex::new(receiver));
    let mut threads = Vec::with_capacity(WORKERS + 1);

    for index in 0..WORKERS {
        let worker_stop = Arc::clone(&stop);
        let worker_active = Arc::clone(&active);
        let worker_receiver = Arc::clone(&receiver);
        let credential = door.credential;
        let port = door.upstream_port;
        let result = thread::Builder::new()
            .name(format!("kalsa-door-worker-{index}"))
            .spawn(move || {
                worker(
                    worker_stop,
                    worker_active,
                    worker_receiver,
                    credential,
                    port,
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

    let address = door.address;
    let listener = door.listener;
    let accept_stop = Arc::clone(&stop);
    let accept_active = Arc::clone(&active);
    let result = thread::Builder::new()
        .name("kalsa-door".into())
        .spawn(move || accept_loop(listener, sender, accept_stop, accept_active));
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
        threads: Mutex::new(threads),
    })
}

fn accept_loop(
    listener: std::net::TcpListener,
    sender: mpsc::SyncSender<Work>,
    stop: Arc<AtomicBool>,
    active: Arc<AtomicUsize>,
) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                if active.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                    reject_busy(&mut stream);
                    continue;
                }
                active.fetch_add(1, Ordering::SeqCst);
                if stream.set_nonblocking(false).is_err() {
                    active.fetch_sub(1, Ordering::SeqCst);
                    continue;
                }
                let work = Work {
                    stream,
                    accepted: Instant::now(),
                };
                match sender.try_send(work) {
                    Ok(()) => {}
                    Err(mpsc::TrySendError::Full(mut work)) => {
                        active.fetch_sub(1, Ordering::SeqCst);
                        reject_busy(&mut work.stream);
                    }
                    Err(mpsc::TrySendError::Disconnected(mut work)) => {
                        active.fetch_sub(1, Ordering::SeqCst);
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
    active: Arc<AtomicUsize>,
    receiver: Arc<Mutex<mpsc::Receiver<Work>>>,
    credential: [u8; crate::TOKEN_BYTES],
    upstream_port: u16,
) {
    loop {
        let result = receiver
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(POLL_INTERVAL);
        match result {
            Ok(work) => {
                if !stop.load(Ordering::SeqCst) {
                    proxy::handle(
                        work.stream,
                        work.accepted,
                        upstream_port,
                        &credential,
                        &stop,
                    );
                }
                active.fetch_sub(1, Ordering::SeqCst);
            }
            Err(mpsc::RecvTimeoutError::Timeout) if stop.load(Ordering::SeqCst) => return,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn reject_busy(stream: &mut TcpStream) {
    let _ = stream.set_nonblocking(true);
    let _ = std::io::Write::write_all(
        stream,
        b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
}

fn join_all(threads: Vec<thread::JoinHandle<()>>) {
    for thread in threads {
        let _ = thread.join();
    }
}
