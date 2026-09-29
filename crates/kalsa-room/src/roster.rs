//! The room's roster: which pairing device is which member, the member ids
//! the room itself mints, and the display names members set.
//!
//! Member ids are room-local and deliberately not the pairing device id:
//! the pairing store re-mints its highest id after a forget
//! (`kalsa-pairing/src/store.rs`), and a room that used pairing ids would
//! hand a returning phone the old member's name and authorship. The roster
//! assigns each device its own member id at first sight and RETIRES it
//! when the device is forgotten; a device id that comes back gets a fresh
//! member, and the retired id's messages keep it, showing the name it had.
//!
//! The file is a whole-document state, so it rides the pairing store's
//! owner-only publication (temp beside the target, flushed, renamed). A
//! roster the store cannot trust refuses the whole room: unlike the
//! transcript, which recovers its longest intact prefix and loses only
//! words, a half-trusted roster attributes words to the wrong person,
//! which is worse than being closed. A key naming a reserved id — the
//! host, the AI — is a hand edit claiming to name someone whose name has
//! its own rules, and is refused with the rest; the same fail-closed
//! answer the pairing store gives a half-recognised set.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{MemberId, RoomError};

pub(crate) const ROSTER_NAME: &str = "room-roster.json";
const ROSTER_VERSION: u8 = 1;
/// The AI's display name: fixed, unforgeable, refused to every member in
/// every casing.
pub const AI_NAME: &str = "Kalsa";
/// The most a display name may be, after trimming.
const MAX_NAME_BYTES: usize = 40;
/// The highest member number the roster mints. Above it sit the two
/// reserved wire ids — the AI, then the host.
const MAX_MEMBER: u32 = u32::MAX - 2;

#[derive(Serialize, Deserialize)]
struct StoredRoster {
    v: u8,
    next_member: u32,
    devices: BTreeMap<u32, u32>,
    retired: BTreeSet<u32>,
    names: BTreeMap<u32, String>,
    host_name: Option<String>,
}

#[derive(Clone)]
pub(crate) struct Roster {
    next_member: u32,
    devices: HashMap<u32, MemberId>,
    retired: HashSet<u32>,
    names: HashMap<u32, String>,
    host_name: Option<String>,
}

impl Roster {
    pub(crate) fn empty() -> Self {
        Self {
            next_member: 1,
            devices: HashMap::new(),
            retired: HashSet::new(),
            names: HashMap::new(),
            host_name: None,
        }
    }

    /// The member id a device already has, without minting one.
    pub(crate) fn member_of(&self, device: u32) -> Option<MemberId> {
        self.devices.get(&device).copied()
    }

    /// A roster with `device` enrolled under a fresh member id. `None`
    /// means the counter reached the reserved range: refused, never
    /// wrapped — a wrapped counter would mint a duplicate member.
    pub(crate) fn with_device(&self, device: u32) -> Option<(Self, MemberId)> {
        if self.next_member > MAX_MEMBER {
            return None;
        }
        let member = MemberId::Member(self.next_member);
        let mut updated = self.clone();
        updated.next_member += 1;
        updated.devices.insert(device, member);
        Some((updated, member))
    }

    /// A roster with the device's member retired: the mapping goes, the
    /// member id never returns, and the name stays for the history its
    /// member authored. `None` when the device was never enrolled.
    pub(crate) fn without_device(&self, device: u32) -> Option<(Self, MemberId)> {
        let member = self.devices.get(&device).copied()?;
        let MemberId::Member(number) = member else {
            return None;
        };
        let mut updated = self.clone();
        updated.devices.remove(&device);
        updated.retired.insert(number);
        Some((updated, member))
    }

    pub(crate) fn with_name(&self, member: MemberId, name: String) -> Self {
        let mut updated = self.clone();
        if let MemberId::Member(number) = member {
            updated.names.insert(number, name);
        }
        updated
    }

    pub(crate) fn with_host_name(&self, name: String) -> Self {
        let mut updated = self.clone();
        updated.host_name = Some(name);
        updated
    }

    /// Who may post: the host always, a member while its device is
    /// enrolled, the AI never through the member path (it has `post_ai`).
    pub(crate) fn is_live(&self, member: MemberId) -> bool {
        match member {
            MemberId::Host => true,
            MemberId::Ai => false,
            MemberId::Member(_) => self.devices.values().any(|id| *id == member),
        }
    }

    pub(crate) fn name_of(&self, member: MemberId) -> Option<String> {
        match member {
            MemberId::Ai => Some(AI_NAME.to_string()),
            MemberId::Host => self.host_name.clone(),
            MemberId::Member(number) => self.names.get(&number).cloned(),
        }
    }

    /// Whether `folded` — a trimmed, lowercased candidate — is free for
    /// `who`: not worn by another live member and not worn by the host. A
    /// retired member's name stays in the file for the history it
    /// explains, but stops being "taken" the moment its member leaves.
    pub(crate) fn name_is_free(&self, folded: &str, who: MemberId) -> bool {
        let worn = |name: &str| fold(name) == folded;
        let members_busy = self.devices.values().any(|member| {
            *member != who
                && matches!(member, MemberId::Member(number) if self
                    .names
                    .get(number)
                    .is_some_and(|name| worn(name)))
        });
        let host_busy = who != MemberId::Host && self.host_name.as_deref().is_some_and(worn);
        !(members_busy || host_busy)
    }

    fn stored(&self) -> StoredRoster {
        StoredRoster {
            v: ROSTER_VERSION,
            next_member: self.next_member,
            devices: self
                .devices
                .iter()
                .map(|(device, member)| (*device, member.wire()))
                .collect(),
            retired: self.retired.iter().copied().collect(),
            names: self
                .names
                .iter()
                .map(|(member, name)| (*member, name.clone()))
                .collect(),
            host_name: self.host_name.clone(),
        }
    }
}

/// Why a name was refused. The words below are all a client sees; the io
/// error stays in the value for the app's local log, where paths belong.
#[derive(Debug)]
pub enum NameError {
    Empty,
    TooLong,
    /// A control, format, bidi or zero-width character — anything that
    /// renders as nothing and can make two different names look alike.
    Invisible,
    /// "Kalsa" in any casing: the AI's name is not takeable.
    Reserved,
    Taken,
    NotAMember,
    Io(std::io::Error),
}

impl std::fmt::Display for NameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => f.write_str("a name cannot be empty"),
            Self::TooLong => f.write_str("the name is too long"),
            Self::Invisible => {
                f.write_str("a name cannot hold invisible characters")
            }
            Self::Reserved => f.write_str("that name belongs to the assistant"),
            Self::Taken => f.write_str("someone in this room already wears that name"),
            Self::NotAMember => f.write_str("that member is not in this room"),
            Self::Io(_) => f.write_str("the room's store failed on disk"),
        }
    }
}

/// The one name rule, shared by the setter and the loader: trimmed, some
/// text, short enough in bytes, nothing invisible. Comparison happens on
/// [`fold`]ings, so "MARCO" does not dodge "Marco"; two names that differ
/// only in Unicode composition (é as one character or as two) are
/// different names in v1 — an honest limit, stated in the protocol.
pub fn valid(name: &str) -> Result<String, NameError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(NameError::Empty);
    }
    if name.len() > MAX_NAME_BYTES {
        return Err(NameError::TooLong);
    }
    if name.chars().any(is_invisible) {
        return Err(NameError::Invisible);
    }
    Ok(name.to_string())
}

/// The folded form compared for uniqueness and for the reserved name:
/// trimmed, then lowercased by Unicode's own simple lowercasing. No
/// composition normalization is applied — std has none, and pulling a
/// crate for it buys little a household name needs.
pub(crate) fn fold(name: &str) -> String {
    name.chars().flat_map(char::to_lowercase).collect()
}

fn is_invisible(c: char) -> bool {
    c.is_control() || is_format_mark(c)
}

/// std has no general-category API, so the format ranges a name can hide
/// in are listed by hand: the zero-width and bidi controls (Cf) that make
/// two different strings render as one, and their neighbours that exist
/// only to steer rendering. These are the ranges that matter in a name;
/// the list is stated as the store's own rule, not as Unicode's entirety.
fn is_format_mark(c: char) -> bool {
    matches!(c as u32,
        0x00AD
        | 0x0600..=0x0605
        | 0x061C
        | 0x070F
        | 0x08E2
        | 0x180E
        | 0x200B..=0x200F
        | 0x202A..=0x202E
        | 0x2060..=0x2064
        | 0x2066..=0x2069
        | 0xFEFF
        | 0xFFF9..=0xFFFB
        | 0x110BD
        | 0x110CD
        | 0x13430..=0x1343F
        | 0x1BCA0..=0x1BCA3
        | 0x1D173..=0x1D17A
        | 0xE0001
        | 0xE0020..=0xE007F)
}

/// Reads the roster back. No file yet is a fresh room — the same absence
/// every store in this app reads as a beginning.
pub(crate) fn load(path: &Path) -> Result<Roster, RoomError> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Roster::empty());
        }
        Err(error) => return Err(error.into()),
    };
    let stored: StoredRoster = serde_json::from_slice(&bytes)
        .map_err(|_| RoomError::Corrupt("roster file does not parse"))?;
    if stored.v != ROSTER_VERSION {
        return Err(RoomError::Corrupt("roster file is from a newer format"));
    }
    if stored.next_member > MAX_MEMBER {
        return Err(RoomError::Corrupt(
            "the roster's member counter is in the reserved range",
        ));
    }
    let reserved = |member: u32, why: &'static str| -> Result<u32, RoomError> {
        (member <= MAX_MEMBER).then_some(member).ok_or(RoomError::Corrupt(why))
    };
    let mut devices = HashMap::new();
    for (device, member) in stored.devices {
        let member = reserved(member, "a device maps to a reserved member id")?;
        devices.insert(device, MemberId::Member(member));
    }
    let mut enrolled = HashSet::new();
    for member in devices.values() {
        if !enrolled.insert(*member) {
            return Err(RoomError::Corrupt("two devices map to one member id"));
        }
    }
    let mut retired = HashSet::new();
    for member in stored.retired {
        retired.insert(reserved(member, "a retired member id is reserved")?);
    }
    let mut names = HashMap::new();
    for (member, name) in stored.names {
        let member = reserved(member, "a name is stored for a reserved member id")?;
        let name = stored_name(&name)?;
        if !devices.values().any(|id| *id == MemberId::Member(member))
            && !retired.contains(&member)
        {
            return Err(RoomError::Corrupt(
                "a name is stored for a member the roster does not hold",
            ));
        }
        names.insert(member, name);
    }
    let host_name = match stored.host_name {
        Some(name) => Some(stored_name(&name)?),
        None => None,
    };
    let roster = Roster {
        next_member: stored.next_member,
        devices,
        retired,
        names,
        host_name,
    };
    if let Some(host) = roster.host_name.as_deref() {
        if !roster.name_is_free(&fold(host), MemberId::Host) {
            return Err(RoomError::Corrupt("two live members hold one name"));
        }
    }
    Ok(roster)
}

/// A stored name must be one the store would have taken: the same rule the
/// setter applies, so a hand edit cannot put past the store what the store
/// refuses from a member.
fn stored_name(name: &str) -> Result<String, RoomError> {
    let name = valid(name).map_err(|_| RoomError::Corrupt("a stored name is not one the store would take"))?;
    if fold(&name) == fold(AI_NAME) {
        return Err(RoomError::Corrupt("a stored name is not one the store would take"));
    }
    Ok(name)
}

/// Publishes the whole roster atomically, before the caller touches its
/// memory: a member exists when the file says so, not when a `HashMap`
/// does.
pub(crate) fn publish(path: &Path, roster: &Roster) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(&roster.stored()).expect("the roster always serializes");
    kalsa_pairing::store::write_owner_only(path, &bytes)
}
