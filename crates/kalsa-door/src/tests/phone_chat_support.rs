//! The phone chat tests' harness: a door with a fake app hook the test drives,
//! and requests that keep their socket open for the stream.

use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::room_support::{devices_labeled, read_all};
use crate::clocks::Clocks;
use crate::{ChatEvent, Door, DeviceId, Opened, PhoneChat, RunningDoor};

pub(super) const TURN: &str = r#"{"messages":[{"role":"user","content":"che mail ho ricevuto oggi?"}],"reply_for":"105","language":"it"}"#;
pub(super) const DRAFT: &str = "0123456789abcdef0123456789abcdef";

/// The credential of device `n`: 64 hex characters, distinct per device.
pub(super) fn token_of(n: u32) -> String {
    format!("{n:02x}").repeat(32)
}

pub(super) fn token() -> String {
    token_of(1)
}

/// The app's side as a test drives it: every open is recorded, and the test
/// feeds the page's events through the sender it is handed.
#[derive(Default)]
pub(super) struct Page {
    pub(super) pages: Mutex<Vec<Sender<ChatEvent>>>,
    pub(super) opens: Mutex<Vec<(String, Value)>>,
    /// The device every open carried, beside `opens`: a proof about *whose*
    /// request this is needs the number the credential resolved to, which the
    /// body cannot hold and so cannot be asked about.
    pub(super) open_devices: Mutex<Vec<u32>>,
    pub(super) stops: Mutex<Vec<String>>,
    pub(super) sends: Mutex<Vec<(String, Option<String>)>>,
    pub(super) send_answer: Option<Result<String, String>>,
    /// Every browser answer, with the device that made it: a proof about whose
    /// card it was needs to see which phone pressed it.
    pub(super) answers: Mutex<Vec<(u32, String, bool)>>,
    pub(super) answer_browser: Option<Result<Value, String>>,
    pub(super) refuse_opens: bool,
    /// The devices the app holds switched off this computer's mail, by id.
    pub(super) mail_off: Vec<u32>,
}

impl PhoneChat for Page {
    fn open(&self, device: DeviceId, kind: &'static str, body: Value) -> Option<Opened> {
        {
            let mut opens = self.opens.lock().unwrap();
            opens.push((kind.to_string(), body));
            self.open_devices.lock().unwrap().push(device.value());
        }
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

    fn mail_allowed(&self, device: DeviceId) -> bool {
        !self.mail_off.contains(&device.value())
    }

    /// The app's own rule: **a card is spent before anything is dispatched**, so a
    /// second answer of the same id finds nothing at all. Modelled here rather than
    /// configured, because a harness that always says yes would prove the door
    /// forwards and nothing about whether a request can be sent twice.
    fn answer_browser(&self, device: DeviceId, card_id: &str, allow: bool) -> Result<Value, String> {
        let mut answers = self.answers.lock().unwrap();
        answers.push((device.value(), card_id.to_string(), allow));
        if answers.iter().filter(|(_, id, _)| id == card_id).count() > 1 {
            return Err("card_unknown".to_string());
        }
        self.answer_browser.clone().unwrap_or_else(|| Ok(json!({"code": "sent", "host": "shop.example"})))
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

    /// The device every open so far carried, in order.
    pub(super) fn opened_devices(&self) -> Vec<u32> {
        self.open_devices.lock().unwrap().clone()
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

/// A started door with `devices` paired phones, ids `1..=devices`.
pub(super) fn chat_door_for(
    page: Option<std::sync::Arc<Page>>,
    clocks: Clocks,
    devices: u32,
) -> (RunningDoor, SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let tokens: Vec<String> = (1..=devices).map(token_of).collect();
    let labeled: Vec<(u32, &str, &str)> = tokens
        .iter()
        .enumerate()
        .map(|(index, token)| (index as u32 + 1, "Phone", token.as_str()))
        .collect();
    let mut door = Door::new(listener, 1, devices_labeled(&labeled), 1, &crate::a_key())
        .unwrap()
        .with_clocks(clocks);
    if let Some(page) = page {
        door = door.with_phone_chat(page);
    }
    (door.start().unwrap(), address)
}

pub(super) fn chat_door(page: Option<std::sync::Arc<Page>>, clocks: Clocks) -> (RunningDoor, SocketAddr) {
    chat_door_for(page, clocks, 1)
}

/// A request whose body is written and whose socket stays open: the door
/// reads a phone that went away as a closed socket, so a half-closed request
/// would look like one.
pub(super) fn open_as(
    address: SocketAddr,
    credential: &str,
    method: &str,
    target: &str,
    body: &str,
) -> TcpStream {
    let mut stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    write!(
        stream,
        "{method} {target} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {credential}\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    stream
}

pub(super) fn open(address: SocketAddr, method: &str, target: &str, body: &str) -> TcpStream {
    open_as(address, &token(), method, target, body)
}

pub(super) fn answer(address: SocketAddr, target: &str, body: &str) -> Vec<u8> {
    read_all(&mut open(address, "POST", target, body))
}

pub(super) fn answer_as(address: SocketAddr, credential: &str, target: &str, body: &str) -> Vec<u8> {
    read_all(&mut open_as(address, credential, "POST", target, body))
}

pub(super) fn text(response: &[u8]) -> String {
    String::from_utf8_lossy(response).to_string()
}
