//! The door's line vocabulary: one function per kind of line, each a shape a
//! report can grep and a test can pin.
//!
//! Nothing here is ever handed a body, a query or a credential. A chat id is
//! the one client value that reaches these functions, and [`id_hash`] is what
//! it becomes — the first four bytes of its SHA-256, enough to join two lines
//! about one chat and useless as a name.

use sha2::{Digest, Sha256};

use crate::devices::DeviceId;

/// The slot a device was handed without taking it from anyone.
pub(crate) fn assigned_line(slot: u32, device: DeviceId) -> String {
    format!("slot {slot} assigned: device {}", device.value())
}

/// A seat taken from another device, and whether the evicted chat reached
/// the disk before the slot was reused.
pub(crate) fn handover_line(
    slot: u32,
    from: DeviceId,
    to: DeviceId,
    saved: bool,
    code: Option<&str>,
) -> String {
    let saved = if saved { "yes" } else { "no" };
    let code = code.map(|code| format!(" code {code}")).unwrap_or_default();
    format!(
        "slot {slot} handover: device {} -> device {} saved {saved}{code}",
        from.value(),
        to.value()
    )
}

/// The chat the seat's return brought back from disk, before the request
/// that took the seat continues it.
pub(crate) fn recall_line(slot: u32, device: DeviceId, chat: &str) -> String {
    format!(
        "slot {slot} recall: device {} chat {} restored before the request",
        device.value(),
        id_hash(chat)
    )
}

/// One disk-tier action: the chat hash, what happened, and how long it took.
/// `bytes` is the file's size on disk where one was read. The device is
/// `None` only for a call that was not given the device and would not parse
/// a name this door built.
pub(crate) fn chat_line(
    action: &str,
    slot: u32,
    device: Option<DeviceId>,
    chat: &str,
    outcome: &str,
    millis: u64,
    bytes: Option<u64>,
) -> String {
    let size = bytes
        .map(|bytes| format!("{bytes}b"))
        .unwrap_or_else(|| "?b".to_string());
    let device = device
        .map(|device| device.value().to_string())
        .unwrap_or_else(|| "?".to_string());
    format!(
        "chat {action}: slot {slot} device {device} chat {} {outcome} {millis}ms {size}",
        id_hash(chat)
    )
}

/// The engine stopped holding what the map claimed, as the door saw it.
pub(crate) fn residency_line(relaxed: usize) -> String {
    format!("engine residency invalidated: {relaxed} slot(s) -> evicted")
}

/// A refusal that never reached `handle`: the accept loop's busy answer.
pub(crate) fn refusal_line(status: u16, reason: &str) -> String {
    format!("door refusal: status {status} reason {reason}")
}

/// A chat id's log handle: the first four bytes of its SHA-256, hex. Enough
/// to join two lines about one chat, useless as a name.
pub(crate) fn id_hash(id: &str) -> String {
    Sha256::digest(id.as_bytes())
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "0f1e2d3c-5a6b-4c7d-8e9f-001122334455";

    #[test]
    fn a_recall_line_names_the_hash_and_never_the_id() {
        let line = recall_line(0, DeviceId::new(0), UUID);
        assert_eq!(
            line,
            format!(
                "slot 0 recall: device 0 chat {} restored before the request",
                id_hash(UUID)
            )
        );
        assert!(!line.contains(UUID), "{line}");
        assert!(!line.contains("0f1e2d3c"), "{line}");
    }

    #[test]
    fn a_chat_line_names_the_hash_and_never_the_id() {
        let line = chat_line("activate", 0, Some(DeviceId::new(2)), UUID, "ok", 12, Some(4096));
        assert_eq!(
            line,
            format!(
                "chat activate: slot 0 device 2 chat {} ok 12ms 4096b",
                id_hash(UUID)
            )
        );
        assert!(!line.contains(UUID), "{line}");
        assert!(!line.contains("0f1e2d3c"), "{line}");
        // The same id always reads the same, and two ids do not collide in
        // the 32 bits the line spends on them here.
        assert_eq!(id_hash(UUID), id_hash(UUID));
        assert_ne!(id_hash(UUID), id_hash("0f1e2d3c-5a6b-4c7d-8e9f-001122334456"));
        // A refused action carries the code; the size may be unknown.
        let refused = chat_line(
            "erase",
            1,
            Some(DeviceId::new(5)),
            UUID,
            "code door.files",
            3,
            None,
        );
        assert!(refused.ends_with("code door.files 3ms ?b"), "{refused}");
        assert!(!refused.contains(UUID), "{refused}");
    }

    #[test]
    fn a_slot_line_names_the_two_devices_and_whether_it_was_saved() {
        assert_eq!(
            assigned_line(0, DeviceId::new(4)),
            "slot 0 assigned: device 4"
        );
        assert_eq!(
            handover_line(1, DeviceId::new(4), DeviceId::new(2), true, None),
            "slot 1 handover: device 4 -> device 2 saved yes"
        );
        assert_eq!(
            handover_line(1, DeviceId::new(4), DeviceId::new(2), false, Some("door.save_refused")),
            "slot 1 handover: device 4 -> device 2 saved no code door.save_refused"
        );
        assert_eq!(
            residency_line(2),
            "engine residency invalidated: 2 slot(s) -> evicted"
        );
        assert_eq!(
            refusal_line(503, "door.listener_busy"),
            "door refusal: status 503 reason door.listener_busy"
        );
    }
}
