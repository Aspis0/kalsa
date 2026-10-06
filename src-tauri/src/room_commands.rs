//! The room view's Tauri commands: the five entries the webview invokes,
//! the shapes they answer with, and the error codes — the store's own
//! sentences never cross this boundary, only stable codes the page
//! translates (or stays silent on).

use serde::Serialize;
use std::sync::Arc;

use crate::room::{self, CallOutcome, Labels};
use kalsa_room::{Entry, MemberId, Room};

/// One row of the room's member list, as the host's view reads it. Names
/// are resolved here, once, from the room and the pairing labels; a
/// former member keeps the name it had.
#[derive(Serialize)]
pub struct RoomMemberDto {
    pub member_id: u32,
    pub name: String,
    pub kind: &'static str,
    pub former: bool,
}

/// The AI guest's visible state, names only.
#[derive(Serialize)]
pub struct RoomAiDto {
    pub state: &'static str,
    pub running: Option<String>,
    pub queue: Vec<String>,
    pub you_pending: bool,
}

#[derive(Serialize)]
pub struct RoomInfoDto {
    /// The transcript's epoch (ROOM-PROTOCOL.md §7): the page keeps it and
    /// replaces — never merges — what it holds when it moves.
    pub epoch: String,
    /// The room could not be opened on this computer. The page shows its
    /// one quiet sentence and nothing else; there is nothing to fix here.
    pub open: bool,
    pub room_name: String,
    pub you: u32,
    pub members: Vec<RoomMemberDto>,
    pub ai: RoomAiDto,
}

/// One transcript entry, with its author's display name and the former
/// mark the protocol promises.
#[derive(Serialize)]
pub struct RoomEntryDto {
    pub seq: u64,
    pub member_id: u32,
    pub name: String,
    pub former: bool,
    pub text: String,
    pub time: u64,
    pub call_ai: bool,
    /// The media this entry carries, descriptors whole; absent when the
    /// entry carries none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<Vec<crate::room_media::RoomMediaDto>>,
    /// The AI's own answer carries how many of the room's messages it
    /// read; `None` on everyone else's.
    pub read: Option<u32>,
}

/// The landed entry plus what became of its call.
#[derive(Serialize)]
pub struct RoomPostDto {
    #[serde(flatten)]
    pub entry: RoomEntryDto,
    pub ai_call: Option<&'static str>,
    pub refusal: Option<&'static str>,
}

/// Why a command did not do what it was asked: a stable code the page
/// translates (or stays silent on). The doc's error table is the list.
#[derive(Serialize)]
pub struct RoomCommandError {
    pub code: &'static str,
}

impl RoomCommandError {
    pub(crate) fn internal() -> Self {
        Self { code: "internal" }
    }
}

fn command_error(error: kalsa_room::PostError) -> RoomCommandError {
    match error {
        kalsa_room::PostError::TextTooLong => RoomCommandError { code: "too_large" },
        kalsa_room::PostError::ClientIdReused => RoomCommandError {
            code: "client_msg_id_reused",
        },
        kalsa_room::PostError::Media(media) => media_command_error(media),
        kalsa_room::PostError::ReadOnly => RoomCommandError { code: "read_only" },
        kalsa_room::PostError::EmptyText
        | kalsa_room::PostError::BadClientMsgId
        | kalsa_room::PostError::NotAMember => RoomCommandError {
            code: "bad_request",
        },
        kalsa_room::PostError::Io(_) => RoomCommandError::internal(),
    }
}

/// The shelf's refusals as stable codes — the same table the door answers
/// a phone's media routes with.
pub(crate) fn media_command_error(error: kalsa_room::MediaError) -> RoomCommandError {
    let code = match error {
        kalsa_room::MediaError::BadRequest => "bad_request",
        kalsa_room::MediaError::Incomplete => "media_incomplete",
        kalsa_room::MediaError::BadSha => "media_bad_sha",
        kalsa_room::MediaError::BadMagic => "media_bad_magic",
        kalsa_room::MediaError::TooManyPixels => "media_too_many_pixels",
        kalsa_room::MediaError::TooLarge => "too_large",
        kalsa_room::MediaError::Full => "room_media_full",
        kalsa_room::MediaError::Unknown => "media_not_found",
        kalsa_room::MediaError::NotYours => "media_not_yours",
        kalsa_room::MediaError::Forbidden => "media_forbidden",
        kalsa_room::MediaError::Io(_) => "internal",
    };
    RoomCommandError { code }
}

fn name_command_error(error: kalsa_room::NameError) -> RoomCommandError {
    match error {
        kalsa_room::NameError::TooLong => RoomCommandError {
            code: "name_too_long",
        },
        kalsa_room::NameError::Reserved => RoomCommandError {
            code: "name_reserved",
        },
        kalsa_room::NameError::Taken => RoomCommandError { code: "name_taken" },
        kalsa_room::NameError::Framing => RoomCommandError {
            code: "name_framing",
        },
        kalsa_room::NameError::MixedScripts => RoomCommandError {
            code: "name_mixed_scripts",
        },
        kalsa_room::NameError::Empty
        | kalsa_room::NameError::Invisible
        | kalsa_room::NameError::NotAMember => RoomCommandError {
            code: "bad_request",
        },
        kalsa_room::NameError::Io(_) => RoomCommandError::internal(),
    }
}

fn member_dto(room: &Room, labels: &Labels, member: MemberId, kind: &'static str) -> RoomMemberDto {
    RoomMemberDto {
        member_id: member.wire(),
        name: room::wire_name(room, labels, member),
        kind,
        former: room.is_former(member),
    }
}

fn entry_dto(room: &Room, labels: &Labels, entry: &Entry) -> RoomEntryDto {
    RoomEntryDto {
        seq: entry.seq,
        member_id: entry.member.wire(),
        name: room::wire_name(room, labels, entry.member),
        former: room.is_former(entry.member),
        text: entry.text.clone(),
        time: entry.time,
        call_ai: entry.call_ai,
        media: (!entry.media.is_empty()).then(|| {
            entry
                .media
                .iter()
                .map(crate::room_media::RoomMediaDto::of)
                .collect()
        }),
        read: (entry.member == MemberId::Ai).then_some(entry.read),
    }
}

/// The room's own state as the host's view opens: the member list, whose
/// turn it is, and who waits. The host sees everything — no join floor.
#[tauri::command]
pub fn brain_room(
    desk: tauri::State<'_, crate::Desk>,
    brain: tauri::State<'_, Arc<crate::Brain>>,
) -> Result<RoomInfoDto, RoomCommandError> {
    let Some(room) = brain.room.get() else {
        return Ok(RoomInfoDto {
            epoch: String::new(),
            open: false,
            room_name: String::new(),
            you: MemberId::Host.wire(),
            members: Vec::new(),
            ai: RoomAiDto {
                state: "idle",
                running: None,
                queue: Vec::new(),
                you_pending: false,
            },
        });
    };
    let labels = room::device_labels(&desk);
    let stored = kalsa_pairing::store::load_devices(&desk.pairing_file).unwrap_or_default();
    let mut members = vec![member_dto(room, &labels, MemberId::Host, "host")];
    for device in &stored {
        // The host's own record is the first row; the guest's seat is the
        // AI's, and never a member.
        if device.kind == crate::DeviceKind::Host || device.id == kalsa_door::ROOM_DEVICE {
            continue;
        }
        if let Ok(member) = room.enroll(device.id) {
            members.push(member_dto(room, &labels, member, "phone"));
        }
    }
    members.push(member_dto(room, &labels, MemberId::Ai, "ai"));
    let turns = room.turn_state();
    Ok(RoomInfoDto {
        epoch: room.epoch(),
        open: true,
        room_name: stored
            .iter()
            .find(|device| device.kind == crate::DeviceKind::Host)
            .map(|device| room::room_title(&device.label))
            .unwrap_or_default(),
        you: MemberId::Host.wire(),
        members,
        ai: RoomAiDto {
            state: turns.state,
            running: turns
                .running
                .map(|member| room::wire_name(room, &labels, member)),
            queue: turns
                .pending
                .iter()
                .map(|member| room::wire_name(room, &labels, *member))
                .collect(),
            you_pending: turns.running == Some(MemberId::Host)
                || turns.pending.contains(&MemberId::Host),
        },
    })
}

/// A page of the room's transcript for the host, who sees all of it.
#[tauri::command]
pub fn brain_room_history(
    desk: tauri::State<'_, crate::Desk>,
    brain: tauri::State<'_, Arc<crate::Brain>>,
    after: Option<u64>,
    before: Option<u64>,
    limit: Option<usize>,
) -> Result<Vec<RoomEntryDto>, RoomCommandError> {
    let Some(room) = brain.room.get() else {
        return Ok(Vec::new());
    };
    let labels = room::device_labels(&desk);
    let limit = limit.unwrap_or(100).clamp(1, 200);
    let page = match (after, before) {
        (Some(after), _) => room.page_after(1, after, limit),
        (None, Some(before)) => room.page_before(1, before, limit),
        (None, None) => room.newest_page(1, limit),
    }
    .map_err(|_| RoomCommandError {
        code: "bad_request",
    })?;
    Ok(page
        .messages
        .iter()
        .map(|entry| entry_dto(room, &labels, entry))
        .collect())
}

/// The host's own message into the room, with the call flag the button
/// carries — the store itself adds a call for "@Kalsa" in the text — and
/// the media ids of blobs the host uploaded to the shelf.
#[tauri::command]
pub fn brain_room_post(
    brain: tauri::State<'_, Arc<crate::Brain>>,
    desk: tauri::State<'_, crate::Desk>,
    client_msg_id: String,
    text: String,
    call_ai: bool,
    media: Option<Vec<String>>,
) -> Result<RoomPostDto, RoomCommandError> {
    let Some(room) = brain.room.get() else {
        return Err(RoomCommandError::internal());
    };
    let entry = room::host_post(
        room,
        &client_msg_id,
        &text,
        call_ai,
        media.as_deref().unwrap_or(&[]),
    )
    .map_err(command_error)?;
    let labels = room::device_labels(&desk);
    let dto = entry_dto(room, &labels, &entry);
    // The message landed; the call is taken only if a running door can
    // drive it — a queue nobody serves would hold the host's call until
    // restart, which is a lie the page cannot see past.
    let outcome = if !entry.call_ai {
        CallOutcome {
            ai_call: None,
            refusal: None,
        }
    } else {
        let door = brain
            .door
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|active| Arc::clone(&active.door)));
        match door {
            Some(door) => {
                let outcome = room::take_host_call(room, &client_msg_id, |member, turn| {
                    door.drive_room_turn(member, turn)
                });
                CallOutcome {
                    ai_call: outcome.ai_call,
                    refusal: outcome.refusal,
                }
            }
            None => CallOutcome {
                ai_call: Some("refused"),
                refusal: Some("could_not_start"),
            },
        }
    };
    Ok(RoomPostDto {
        entry: dto,
        ai_call: outcome.ai_call,
        refusal: outcome.refusal,
    })
}

/// The host's own display name in this room.
#[tauri::command]
pub fn brain_room_set_name(
    brain: tauri::State<'_, Arc<crate::Brain>>,
    name: String,
) -> Result<String, RoomCommandError> {
    let Some(room) = brain.room.get() else {
        return Err(RoomCommandError::internal());
    };
    room::set_host_display_name(room, &name).map_err(name_command_error)
}

/// The host stops the running answer. `false` when nothing is running:
/// the page shows Stop only while a turn runs, so a click that raced the
/// end simply does nothing.
#[tauri::command]
pub fn brain_room_stop(
    brain: tauri::State<'_, Arc<crate::Brain>>,
) -> Result<bool, RoomCommandError> {
    Ok(room::stop_turn(brain.inner()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-brain-room-commands-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// The DTOs are the page's only view of the room: an UNNAMED host must
    /// cross nameless ("" — the page localizes the default), and every other
    /// member crosses with its name. The AI's name is the assistant's own.
    #[test]
    fn the_dtos_carry_the_unnamed_host_as_empty_for_the_page_to_localize() {
        let dir = scratch("dto-wire-name");
        let room = Room::open(&dir).unwrap();
        let labels = Labels {
            by_device: HashMap::new(),
            host: "This computer".to_string(),
        };

        let host = member_dto(&room, &labels, MemberId::Host, "host");
        assert_eq!(host.name, "", "the default name is the page's to localize");

        let said = room
            .post(MemberId::Host, "host-1", "ciao", false, &[])
            .expect("the host's message lands");
        let said = entry_dto(&room, &labels, &said);
        assert_eq!(said.name, "", "entries follow the same rule");

        let ai = member_dto(&room, &labels, MemberId::Ai, "ai");
        assert_eq!(ai.name, "Kalsa", "the assistant crosses by its name");
    }
}
