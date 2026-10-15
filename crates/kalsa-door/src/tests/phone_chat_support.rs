//! The phone chat tests' harness: a door with a fake app hook the test drives,
//! and requests that keep their socket open for the stream.

use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::room_support::{devices_labeled, read_all};
use crate::clocks::Clocks;
use crate::{ChatEvent, Door, DeviceId, Opened, PhoneChat, RunningDoor};

pub(super) const TURN: &str = r#"{"messages":[{"role":"user","content":"che mail ho ricevuto oggi?"}],"reply_for":"105","language":"it"}"#;
pub(super) const DRAFT: &str = "0123456789abcdef0123456789abcdef";

pub(super) fn token() -> String {
    "ab".repeat(32)
}

/// The app's side as a test drives it: every open is recorded, and the test
/// feeds the page's events through the sender it is handed.
#[derive(Default)]
pub(super) struct Page {
    pub(super) pages: Mutex<Vec<Sender<ChatEvent>>>,
    pub(super) opens: Mutex<Vec<(String, Value)>>,
    pub(super) stops: Mutex<Vec<String>>,
    pub(super) sends: Mutex<Vec<(String, Option<String>)>>,
    pub(super) send_answer: Option<Result<String, String>>,
    pub(super) refuse_opens: bool,
}

impl PhoneChat for Page {
    fn open(&self, _device: DeviceId, kind: &'static str, body: Value) -> Option<Opened> {
        self.opens.lock().unwrap().push((kind.to_string(), body));
        if self.refuse_opens {
            return None;
        }
        let (sender, events) = mpsc::channel();
        let mut pages = self.pages.lock().unwrap();
        pages.push(sender);
        Some(Opened {
            request: format!("req-{}", pages.len()),
            events,
        })
    }

    fn stop(&self, request: &str) {
        self.stops.lock().unwrap().push(request.to_string());
    }

    fn send(&self, _device: DeviceId, draft_id: &str, body: Option<String>) -> Result<String, String> {
        self.sends.lock().unwrap().push((draft_id.to_string(), body));
        self.send_answer
            .clone()
            .unwrap_or_else(|| Ok("segreteria@studio.example.it".to_string()))
    }
}

impl Page {
    /// The sender of the `index`th open, once the door has made it.
    pub(super) fn page(&self, index: usize) -> Sender<ChatEvent> {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(sender) = self.pages.lock().unwrap().get(index) {
                return sender.clone();
            }
            assert!(Instant::now() < deadline, "the door never opened request {index}");
            thread::sleep(Duration::from_millis(5));
        }
    }

    pub(super) fn opened(&self) -> Vec<(String, Value)> {
        self.opens.lock().unwrap().clone()
    }

    /// Waits until the door has stopped request `request`, or gives up.
    pub(super) fn stopped(&self, request: &str) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if self.stops.lock().unwrap().iter().any(|stop| stop == request) {
                return true;
            }
            thread::sleep(Duration::from_millis(5));
        }
        false
    }
}

pub(super) fn event(name: &str, data: Value) -> ChatEvent {
    ChatEvent {
        name: name.to_string(),
        data,
    }
}

pub(super) fn chat_door(page: Option<std::sync::Arc<Page>>, clocks: Clocks) -> (RunningDoor, SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let token = token();
    let mut door = Door::new(listener, 1, devices_labeled(&[(1, "Phone", token.as_str())]), 1)
        .unwrap()
        .with_clocks(clocks);
    if let Some(page) = page {
        door = door.with_phone_chat(page);
    }
    (door.start().unwrap(), address)
}

/// A request whose body is written and whose socket stays open: the door
/// reads a phone that went away as a closed socket, so a half-closed request
/// would look like one.
pub(super) fn open(address: SocketAddr, method: &str, target: &str, body: &str) -> TcpStream {
    let mut stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    write!(
        stream,
        "{method} {target} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {}\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        token(),
        body.len()
    )
    .unwrap();
    stream
}

pub(super) fn answer(address: SocketAddr, target: &str, body: &str) -> Vec<u8> {
    read_all(&mut open(address, "POST", target, body))
}

pub(super) fn text(response: &[u8]) -> String {
    String::from_utf8_lossy(response).to_string()
}
