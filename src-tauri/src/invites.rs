//! The shell's side of the invitation set: one set for the app, opened once
//! at startup, and the four calls the Devices page will make.
//!
//! An invitation is the pairing square's own ceremony made to outlive the
//! screen — a day instead of two minutes, a link instead of a scan, several
//! at once — and nothing about what the phone does changes: the claim is the
//! same one-time code compared the same way, the completion the same MAC,
//! and the owner's Allow is still what admits the phone, which
//! `pairing::Desk` stores waiting either way. What this module owns is the
//! shell's discipline around `kalsa_pairing::Invites`:
//!
//! * **one set, opened once** — opening REPLACES a file it had to discard,
//!   so it happens at startup beside `pairing.json`, before the transport
//!   serves, and nowhere else. The discarded flag rides every list, so the
//!   page can tell the owner that earlier links are gone;
//! * **one writer** — every method takes the set's lock. The desk takes it
//!   only inside its own state lock, the order every store write follows;
//!   the page's commands take it alone;
//! * **plain words, no secrets** — a refusal reaches the page in English
//!   with nothing of the invitation inside it: no code and no link in an
//!   error string, a DTO, or a Debug.

use std::fmt;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use kalsa_pairing::{ClaimResult, Handshake, InviteError, Invites, PairingSeal, PhoneDeclaration};
use serde::Serialize;
use tauri::State;

use crate::{Brain, Desk};

/// The invite file's name. The directory is the pairing file's — this
/// module is handed that file, never a path of its own choosing.
const INVITES_FILE: &str = "invites.json";

/// What the page is told when there is no node id to put in a link. Both
/// ways the road is not open — the switch in Advanced, or a road that could
/// not open — land here, and the sentence claims neither: the page already
/// shows the road's own words beside the switch.
const NO_ROAD: &str = "An invitation is a link to this computer, and it can only lead over \
                       this computer's internet road, which is not open.";

/// One invitation as the page lists it: the id its buttons name and the
/// moment it dies. Never the code — a countdown needs neither.
#[derive(Serialize)]
pub(crate) struct InviteDto {
    id: u32,
    /// Whole seconds since the epoch, for the page's own arithmetic.
    expires_at: u64,
}

/// The answer to `brain_invite_list`: what is out, and whether startup had
/// to throw a file away to get here.
#[derive(Serialize)]
pub(crate) struct InviteListDto {
    /// The file beside `pairing.json` could not be honoured when this app
    /// started, so whatever invitations it held are gone — the set replaced
    /// the file and moved on. Produced exactly once, at startup; nothing
    /// else in the app can make it true.
    discarded: bool,
    invites: Vec<InviteDto>,
}

struct Inner {
    invites: Invites,
    discarded: bool,
}

/// The invitations this app has out: one set, one lock, one file.
pub(crate) struct InviteSet {
    inner: Mutex<Inner>,
}

// Hand-written, like every other holder of the ceremony's secrets in this
// tree: ids, deadlines and the flag — never the links, which are the codes
// base64'd. A derived Debug would print them the first time anything logged
// the set, and `pairing::Desk` holds one of these.
impl fmt::Debug for InviteSet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let inner = self.lock();
        f.debug_struct("InviteSet")
            .field("discarded", &inner.discarded)
            .field("invites", &inner.invites)
            .finish()
    }
}

impl InviteSet {
    /// This app's invitations, opened from the file beside `pairing_file`.
    /// Called once, at startup, before the transport serves: opening a file
    /// it cannot honour REPLACES that file, so two opens would be two
    /// writers over one disk, and the second would only ever see what the
    /// first left.
    pub(crate) fn open(pairing_file: &Path) -> Self {
        let path = pairing_file.with_file_name(INVITES_FILE);
        let (invites, discarded) = Invites::open(&path, SystemTime::now());
        Self {
            inner: Mutex::new(Inner {
                invites,
                discarded,
            }),
        }
    }

    /// What the page draws: every invitation's id and deadline, plus the
    /// startup flag. Neither a code nor a link is in this answer, and none
    /// can be added without the page asking for a link by id.
    pub(crate) fn list(&self) -> InviteListDto {
        let inner = self.lock();
        InviteListDto {
            discarded: inner.discarded,
            invites: inner
                .invites
                .list()
                .into_iter()
                .map(|(id, expires_at)| InviteDto {
                    id,
                    expires_at: expires_at
                        .duration_since(UNIX_EPOCH)
                        .map_or(0, |age| age.as_secs()),
                })
                .collect(),
        }
    }

    /// One more invitation, and the link to hand out. `None` says the set
    /// minted an id whose ceremony carries no square to link to — the page
    /// words that itself rather than being handed half a thing.
    pub(crate) fn create(
        &self,
        reachable: &str,
        node: Option<&str>,
        tailnet: Option<&str>,
        now: SystemTime,
    ) -> Result<Option<String>, InviteError> {
        let mut inner = self.lock();
        let id = inner.invites.mint(reachable, node, tailnet, now)?;
        Ok(inner.invites.link(id))
    }

    /// The link for an id the page already showed, so the owner can copy it
    /// again. `None` when that invitation is gone — spent, cancelled or
    /// expired — and the page says which of those it cannot know: gone.
    pub(crate) fn link(&self, id: u32) -> Option<String> {
        self.lock().invites.link(id)
    }

    /// The owner takes an invitation back: its code stops working at once.
    pub(crate) fn cancel(&self, id: u32) -> Result<(), InviteError> {
        self.lock().invites.cancel(id)
    }

    /// A phone presents a code. `true` is the one thing that ever answered
    /// 200: the ceremony moved. Everything else — wrong, expired, already
    /// used, a file that could not be written — is `false`, because the
    /// transport turns `false` into the square's own single 403 and no
    /// answer may say which it was.
    pub(crate) fn claim(&self, presented: &str, now: SystemTime) -> bool {
        matches!(
            self.lock().invites.claim(presented, now),
            Ok(ClaimResult::Claimed)
        )
    }

    /// The page's poll: every invitation whose day ended leaves the set and
    /// its file here, on the same tick that retires an expired square. A
    /// write that fails is swallowed — the next poll and the next write try
    /// again, and the page's read must still be answered.
    pub(crate) fn expire_if_due(&self, now: SystemTime) {
        let _ = self.lock().invites.expire_if_due(now);
    }

    /// The phone's completion, for a declaration whose MAC belongs to one of
    /// these ceremonies. `None` is the square's own refusal for every cause
    /// — no ceremony claimed, wrong proof, a window that closed — so the
    /// transport's 403 is the same byte either way. The answer carries the
    /// link's own deadline so the retained seal cannot outlive it.
    pub(crate) fn complete(
        &self,
        declaration: PhoneDeclaration,
        now: SystemTime,
    ) -> Option<(SystemTime, Handshake, PairingSeal)> {
        self.lock().invites.complete(declaration, now).ok()
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// The page's words for a refusal. Plain English, and nothing of the
/// invitation inside: an error string is shown to a person, and a code must
/// never reach one by that road.
fn words(error: InviteError) -> String {
    match error {
        InviteError::NoNode => NO_ROAD.to_string(),
        InviteError::Full => {
            "This computer already has as many invitations as it can hold. Cancel one to \
             make another."
                .to_string()
        }
        InviteError::Offer(_) => "This invitation could not be made. Try again.".to_string(),
        InviteError::Io(_) => {
            "This invitation could not be saved. Check this computer's permissions and try \
             again."
                .to_string()
        }
    }
}

/// The owner asks for an invitation: a link that lives a day, is good for
/// one phone, and still waits for the owner's Allow at the end. The answer
/// is the link itself — the page copies it — and the only refusal with a
/// reason of its own is the road that carries it: a link with no node id
/// behind it would lead nowhere, so no invitation is minted without one.
#[tauri::command]
pub(crate) async fn brain_invite_create(
    brain: State<'_, Brain>,
    desk: State<'_, Desk>,
) -> Result<String, String> {
    let Some(node) = brain.road_node_id() else {
        return Err(NO_ROAD.to_string());
    };
    let tailnet = crate::tailnet_now(&brain, &desk).await;
    let link = desk
        .desk
        .invites()
        .create(
            &desk.reachable,
            Some(&node),
            tailnet.as_deref(),
            SystemTime::now(),
        )
        .map_err(words)?;
    link.ok_or_else(|| "This invitation could not be made. Try again.".to_string())
}

/// Everything the page lists: the ids, the deadlines, and whether startup
/// threw a file away. No code and no link is in this answer.
#[tauri::command]
pub(crate) fn brain_invite_list(desk: State<Desk>) -> InviteListDto {
    desk.desk.invites().list()
}

/// The link for an id the page is showing, so the owner can copy it again
/// while it is still out.
#[tauri::command]
pub(crate) fn brain_invite_link(desk: State<Desk>, id: u32) -> Result<String, String> {
    desk.desk
        .invites()
        .link(id)
        .ok_or_else(|| "That invitation is no longer valid.".to_string())
}

/// The owner takes an invitation back. An id the set does not hold changes
/// nothing and answers `Ok` — the page's own refresh is what tells it the
/// invitation is already gone.
#[tauri::command]
pub(crate) fn brain_invite_cancel(desk: State<Desk>, id: u32) -> Result<(), String> {
    desk.desk.invites().cancel(id).map_err(words)
}

#[cfg(test)]
mod tests;
