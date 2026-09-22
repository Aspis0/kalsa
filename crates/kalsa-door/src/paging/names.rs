//! The door's own file names: how they are built, and how they are read back.
//!
//! `file_name` and [`owner`] are one format on two paths — the builder knows
//! the arguments, the sweep only has the bytes — so they live together and
//! share one [`SUFFIX`] spelling: a parser that drifted from the builder
//! would read some of the door's own files as unknown (leaked) or, worse,
//! someone else's file as a device's (deleted).

use super::io::STAGING;
use crate::devices::DeviceId;

/// What every save ends with. Written and peeled in one place, so the
/// suffix cannot be spelled two ways.
const SUFFIX: &str = ".bin";

/// The name, and the door builds it: flat, because `fs_validate_filename`
/// rejects separators, and carrying the device and the model so a file can
/// never be read back into another device's slot by accident.
pub(super) fn file_name(model: &str, device: DeviceId, id: &str) -> String {
    format!("d{}-m{model}-c{id}{SUFFIX}", device.value())
}

/// The shape both branches of the app's `uid()` produce: lowercase letters,
/// digits and dashes, 8 to 64 of them. No dot, no separator, no leading dash —
/// and each of those is a refusal, never something the door repairs.
pub(super) fn valid_id(id: &str) -> bool {
    (8..=64).contains(&id.len())
        && !id.starts_with('-')
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// The device a file name says the file belongs to, or `None` for a name
/// this door never wrote. The sweep's "leave it alone" rule lives here:
/// `None` means *unknown*, never *orphan*.
///
/// The exact inverse of [`file_name`] over [`valid_id`]: `d` plus a
/// canonical decimal id — `Display` never pads, so `d01` is not a name we
/// wrote — then `-m` plus eight lowercase hex, then `-c` plus a chat id the
/// door would have accepted, then [`SUFFIX`], with one staging suffix
/// optionally peeled first. The model is fixed-width, and that is what makes
/// the `-c` boundary unambiguous even when the chat id itself carries
/// dashes.
///
/// Those eight-wide lowercase hex are not born in this file: they are
/// guaranteed at the door's boundary, where
/// [`with_model_hash`](crate::Door::with_model_hash) is the field's only
/// writer and refuses any other shape with
/// [`InvalidModelHash`](crate::DoorError::InvalidModelHash) before a name
/// can be built — the exact inverse above stands on that check, so moving
/// the boundary moves what `owner` may assume.
///
/// The model is checked for *shape*, never against the current pin: a file
/// written under an older model belongs to its device like any other and
/// dies with it.
pub(super) fn owner(file: &str) -> Option<DeviceId> {
    let base = file.strip_suffix(STAGING).unwrap_or(file);
    let base = base.strip_suffix(SUFFIX)?;
    let rest = base.strip_prefix('d')?;
    let (digits, rest) = rest.split_once('-')?;
    let id: u32 = digits.parse().ok()?;
    if id.to_string() != digits {
        return None;
    }
    let rest = rest.strip_prefix('m')?;
    let model = rest.get(..8)?;
    let rest = rest.get(8..)?;
    let hex = |byte: u8| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte);
    if !model.bytes().all(hex) {
        return None;
    }
    let chat = rest.strip_prefix("-c")?;
    valid_id(chat).then_some(DeviceId::new(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `-c` boundary is the fixed model's to hold, never the chat id's:
    /// an id that itself carries `-c` (twice, here) is still read back as
    /// one id, because the model's eight characters are consumed before the
    /// prefix is ever looked for. Without this a chat the door did write
    /// would sit in the sweep's "unknown, leave it alone" pile forever.
    #[test]
    fn a_chat_id_containing_the_c_boundary_is_still_accepted() {
        let name = file_name("a1b2c3d4", DeviceId::new(4), "a-cb-cdefg");
        assert_eq!(owner(&name), Some(DeviceId::new(4)));
    }
}
