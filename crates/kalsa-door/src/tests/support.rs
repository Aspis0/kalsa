//! Fixtures shared by the door's test submodules: a recording upstream and
//! the small readers and builders over it.

use std::io;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use super::*;

/// A canned upstream for the slot tests: it counts every accepted
/// connection, records the complete request head it read, and answers 200
/// with no body. The count is the proof that a refusal happened before any
/// socket was opened; the recorded heads are the proof of which slot and
/// which private headers the door sealed.
pub(super) struct RecordingUpstream {
    pub(super) port: u16,
    accepts: Arc<AtomicUsize>,
    heads: Arc<Mutex<Vec<Vec<u8>>>>,
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl RecordingUpstream {
    pub(super) fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let stop = Arc::new(AtomicBool::new(false));
        let accepts = Arc::new(AtomicUsize::new(0));
        let heads = Arc::new(Mutex::new(Vec::new()));
        let thread_stop = Arc::clone(&stop);
        let thread_accepts = Arc::clone(&accepts);
        let thread_heads = Arc::clone(&heads);
        let handle = thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            while !thread_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        thread_accepts.fetch_add(1, Ordering::SeqCst);
                        // Each connection is served on its own thread: a
                        // held exchange must not stop the next accept.
                        let heads = Arc::clone(&thread_heads);
                        thread::spawn(move || {
                            let mut stream = stream;
                            stream.set_nonblocking(false).unwrap();
                            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                            let mut head = Vec::new();
                            if read_until(&mut stream, b"\r\n\r\n", &mut head).is_err() {
                                return;
                            }
                            heads.lock().unwrap().push(head);
                            let _ = std::io::Write::write_all(
                                &mut stream,
                                b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                            );
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => return,
                }
            }
        });
        Self {
            port,
            accepts,
            heads,
            stop,
            handle: Some(handle),
        }
    }

    pub(super) fn accepts(&self) -> usize {
        self.accepts.load(Ordering::SeqCst)
    }

    pub(super) fn heads(&self) -> Vec<Vec<u8>> {
        self.heads.lock().unwrap().clone()
    }
}

impl Drop for RecordingUpstream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// Every value the head carries for a field name, case-insensitively.
pub(super) fn header_values(head: &[u8], name: &str) -> Vec<String> {
    let text = String::from_utf8_lossy(head);
    text.lines()
        .filter_map(|line| line.split_once(':'))
        .filter(|(field, _)| field.trim().eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim().to_string())
        .collect()
}

/// The one sealed slot header, asserted present exactly once.
pub(super) fn sealed_slot(head: &[u8]) -> u32 {
    let values = header_values(head, "x-kalsa-slot");
    assert_eq!(
        values.len(),
        1,
        "the head must carry exactly one sealed slot header: {}",
        String::from_utf8_lossy(head)
    );
    values[0]
        .parse()
        .unwrap_or_else(|_| panic!("the sealed slot is not a number: {}", values[0]))
}

/// Devices with explicit ids, for tests where a device must keep its id
/// across a set change (`door_devices` numbers by position).
pub(super) fn device_set(entries: &[(u32, &str)]) -> Devices {
    let entries = entries
        .iter()
        .map(|(id, token)| {
            DeviceEntry::new(
                DeviceId::new(*id),
                format!("device {id}"),
                token.to_string(),
            )
            .unwrap()
        })
        .collect();
    Devices::new(entries).unwrap()
}
