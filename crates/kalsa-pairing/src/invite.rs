//! An invitation: the square, as a link that outlives the screen.
//!
//! An invite is the same ceremony the on-screen square runs — same one-time
//! code, same per-ceremony nonce, same completion MACs, same refusals — with
//! two differences the owner asked for: it lives a day instead of two
//! minutes, and several may be out at once. The link is that ceremony's own
//! QR JSON in `base64url` behind a `#`, so the phone parses one document
//! whether it scanned a screen or opened a link, and nothing on the wire
//! changed: the phone gates the document by its `v` and the MAC vectors are
//! frozen.
//!
//! What the set owns:
//!
//! * **minting** — a day on the wall clock, an iroh node to dial (a link
//!   without one is refused, not minted half working), and a cap of ten
//!   live invitations: an eleventh is refused, never a replacement;
//! * **claiming** — every live invitation compared in constant time, only
//!   the match consumed, and wrong / expired / already used as one answer,
//!   the way the square answers them;
//! * **the file** — invitations survive a restart, a claim leaves the file
//!   before the phone is told it won (`invite::file`), and the file gets
//!   the same owner-only publication the credential store uses;
//! * **completion** — the claimed ceremony finishes through the existing
//!   `Pairing::complete`, the MAC choosing which ceremony the declaration
//!   belongs to when more than one is claimed.
//!
//! The owner's Allow is not here, and does not move: a claimed invitation
//! completes into a handshake the store holds WAITING, exactly as the square
//! does, and no phone is served before the owner presses Allow.

use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

use crate::ceremony::{ClaimResult, Pairing};
use crate::error::{CompleteError, InviteError};
use crate::handshake::Handshake;
use crate::messages::{PhoneDeclaration, PairingSeal};

mod file;
#[cfg(test)]
mod tests;

/// How long an invite lives. The square's own window is minutes; an invite
/// is a link that may sit in a message for a day, and the day is the whole
/// of the owner's exposure — after it, the code is dead wherever it went.
const INVITE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// The technical cap on invitations still ON THE TABLE at once — offered
/// and unclaimed. Ten links is enough for a person to hand around and few
/// enough that a forgotten tab cannot keep a door open indefinitely; an
/// eleventh mint is refused, never a silent eviction of the oldest. A
/// ceremony the phone has already claimed holds no slot: it left the file
/// at its claim and leaves the set when it completes or expires.
const MAX_INVITES: usize = 10;

/// Where a link puts its payload: the origin the phone opens, then the
/// square's own JSON in `base64url` without padding.
const LINK_ORIGIN: &str = "https://kalsa.io/pair#";

/// One invitation: its id, and the ceremony it is running.
struct Invite {
    id: u32,
    pairing: Pairing,
}

/// Every invitation this computer has out, and the file they live in.
///
/// One writer, like the credential store beside it: the shell owns this
/// value, and nothing in the crate shares it between threads.
pub struct Invites {
    path: PathBuf,
    invites: Vec<Invite>,
    /// The id the next mint takes. It rides the file and only moves
    /// forward, so an id is never handed out twice while the file lives —
    /// see [`Invites::take_id`].
    next_id: u32,
}

// Written by hand and printing ids and deadlines only. The ceremonies hold
// the code and the nonce, and a derived Debug would print them the first
// time anything logged the set.
impl fmt::Debug for Invites {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Invites")
            .field(
                "invites",
                &self
                    .invites
                    .iter()
                    .map(|invite| (invite.id, &invite.pairing))
                    .collect::<Vec<_>>(),
            )
            .finish()
    }
}

impl Invites {
    /// The owner's invitations as they stood: every one still inside its
    /// window, rebuilt from the file exactly as it was written. The second
    /// answer says whether the file held invitations this build did NOT
    /// bring back — unreadable, another version, or a record the window and
    /// node rules refused — which is all step 2 needs if it has to tell the
    /// owner that earlier links are gone. Records that merely expired are
    /// not counted: the day ending is not a loss.
    ///
    /// An unreadable file is an EMPTY set, never an error: nothing in it is
    /// honoured, and `open` replaces the file at once — atomically, through
    /// the same publish path as any other write — so the codes it held do
    /// not sit on disk un-honoured until the owner happens to mint. A
    /// replace that fails changes none of that: the set still comes back,
    /// and the next write tries the disk again.
    pub fn open(path: &Path, now: SystemTime) -> (Self, bool) {
        let loaded = file::read(path, now);
        let invites = Self {
            path: path.to_path_buf(),
            invites: loaded
                .invites
                .into_iter()
                .map(|(id, pairing)| Invite { id, pairing })
                .collect(),
            next_id: loaded.next_id,
        };
        if loaded.discarded {
            // The file holds invitations this build will not honour — codes
            // nobody may use, sitting in the open. A refusal that leaves
            // them on disk is only half a refusal, so the file becomes what
            // came back from it. The write's failure is swallowed: `open`
            // has no error left to give, the set in hand is the truth, and
            // the next write reports its own if the disk still refuses.
            let _ = invites.persist(None);
        }
        (invites, loaded.discarded)
    }

    /// One more invitation, alive for a day. The link is an iroh link: a
    /// phone that scans it must have this computer's node to dial, so
    /// minting without one is an error rather than a link that stops at the
    /// code. The invite is on disk before this answers — a link the owner
    /// is about to copy must outlive the process that made it.
    pub fn mint(
        &mut self,
        reachable: &str,
        node: Option<&str>,
        tailnet: Option<&str>,
        now: SystemTime,
    ) -> Result<u32, InviteError> {
        let outstanding = self
            .invites
            .iter()
            .filter(|invite| matches!(invite.pairing, Pairing::Offered(_)))
            .count();
        if outstanding >= MAX_INVITES {
            return Err(InviteError::Full);
        }
        let node = node
            .filter(|address| !address.is_empty())
            .ok_or(InviteError::NoNode)?;
        let pairing = Pairing::offer(reachable, Some(node), tailnet, now, INVITE_TTL)
            .map_err(InviteError::Offer)?;
        let id = self.take_id()?;
        self.invites.push(Invite { id, pairing });
        if let Err(error) = self.persist(None) {
            // The file kept the set it had, so the set keeps it too: an
            // invite the disk never saw must not be on the table here.
            self.invites.pop();
            return Err(error);
        }
        Ok(id)
    }

    /// What the page draws: every invitation alive in the set — still
    /// shareable, or claimed and waiting to finish — with the deadline that
    /// is its own. Never the code: a countdown does not need the secret, and
    /// the list is what the UI renders.
    pub fn list(&self) -> Vec<(u32, SystemTime)> {
        self.invites
            .iter()
            .filter_map(|invite| Some((invite.id, invite.pairing.expires_at()?)))
            .collect()
    }

    /// The link to share: the origin, then this invitation's own QR JSON in
    /// `base64url` without padding — the same bytes the square would have
    /// shown, so nothing about what the phone parses depends on which of the
    /// two it met. `None` for an id the set does not hold, and for a
    /// ceremony that has moved past its offer: a claimed invitation's link
    /// is spent, and there is no square left behind it.
    pub fn link(&self, id: u32) -> Option<String> {
        let invite = self.invites.iter().find(|invite| invite.id == id)?;
        let payload = invite.pairing.qr_payload()?;
        Some(format!("{LINK_ORIGIN}{}", URL_SAFE_NO_PAD.encode(payload)))
    }

    /// Take an invitation back: its code stops working at once and its link
    /// is worth nothing, because the set is what answers a claim. An id the
    /// set does not hold changes nothing and writes nothing, the way
    /// forgetting an unknown device answers `Ok`.
    pub fn cancel(&mut self, id: u32) -> Result<(), InviteError> {
        let Some(index) = self.invites.iter().position(|invite| invite.id == id) else {
            return Ok(());
        };
        let cancelled = self.invites.remove(index);
        if let Err(error) = self.persist(None) {
            // The file kept the invitation, so the set keeps it: the owner
            // asked for a cancellation this disk would contradict.
            self.invites.insert(index, cancelled);
            return Err(error);
        }
        Ok(())
    }

    /// A phone presents a code from a link. Every live invitation is
    /// compared — the ceremony's own constant-time compare — and only the
    /// one it matches is consumed; wrong, expired and already used are one
    /// answer, because three answers would tell a guesser which part of the
    /// guess was close.
    ///
    /// The file loses the invitation BEFORE this can say it claimed: a
    /// restart must never bring a used code back. A write that fails leaves
    /// the invitation live in memory and on disk alike and reports the
    /// file, never a success the disk would contradict on the next start.
    ///
    /// From a claim that succeeds, the ceremony is MEMORY-ONLY: the file no
    /// longer holds it, so a restart drops it and the phone needs a new
    /// link. One use wins over a link that outlives this process — which is
    /// the trade the whole method exists to make.
    pub fn claim(&mut self, presented: &str, now: SystemTime) -> Result<ClaimResult, InviteError> {
        // Every live invitation is compared, not just up to the first hit:
        // how long this walk takes must not say which one (if any) matched.
        let mut matched = None;
        for (index, invite) in self.invites.iter().enumerate() {
            if invite.pairing.matches_offer(presented, now) && matched.is_none() {
                matched = Some(index);
            }
        }
        let Some(index) = matched else {
            return Ok(ClaimResult::Rejected);
        };
        let id = self.invites[index].id;
        self.persist(Some(id))?;
        if matches!(
            self.invites[index].pairing.claim(presented, now),
            ClaimResult::Claimed
        ) {
            return Ok(ClaimResult::Claimed);
        }
        // The set matched this code a moment ago, so this arm is not meant
        // to be reachable — and it still must not cost the owner an
        // invitation: the file has lost it, so the file is told it is back
        // on the table, memory and disk agree again, and the phone is
        // answered like any other miss.
        self.persist(None)?;
        Ok(ClaimResult::Rejected)
    }

    /// Retire every invitation whose window has closed — a claim that never
    /// finishes included: its window is the offer's, it holds no slot, and
    /// once it is dead nothing here needs it for. Nothing lingers to be
    /// shown as "expired": a dead invitation leaves the list, stops matching
    /// a code, and is dropped from the file. Only a dying OFFER writes — a
    /// claim left the disk at claim time, so there is nothing there to
    /// remove.
    pub fn expire_if_due(&mut self, now: SystemTime) -> Result<(), InviteError> {
        let mut dropped_offer = false;
        self.invites.retain_mut(|invite| {
            let was_offer = matches!(invite.pairing, Pairing::Offered(_));
            invite.pairing.expire_if_due(now);
            let alive = matches!(invite.pairing, Pairing::Offered(_) | Pairing::Claimed(_));
            dropped_offer |= !alive && was_offer;
            alive
        });
        if dropped_offer {
            self.persist(None)?;
        }
        Ok(())
    }

    /// The phone's completion, offered to every ceremony that is claimed:
    /// the MAC decides which one the declaration belongs to, so the set does
    /// not have to know. A refusal changes nothing — the ceremony's own
    /// rule, and no stranger's guess ends a claim. A ceremony that pairs
    /// leaves the set: its invitation is spent, and the file has not held
    /// it since the claim.
    pub fn complete(
        &mut self,
        declaration: PhoneDeclaration,
        now: SystemTime,
    ) -> Result<(Handshake, PairingSeal), CompleteError> {
        for index in 0..self.invites.len() {
            if !matches!(self.invites[index].pairing, Pairing::Claimed(_)) {
                continue;
            }
            let outcome = self.invites[index].pairing.complete(declaration.clone(), now);
            match outcome {
                Ok(done) => {
                    self.invites.remove(index);
                    return Ok(done);
                }
                // Entropy is reachable only AFTER the MAC verified, so this
                // is the ceremony the declaration is for. It stays claimed
                // and the phone may ask again — nothing it presented caused
                // the failure.
                Err(error @ CompleteError::Entropy) => return Err(error),
                Err(CompleteError::Refused) => continue,
            }
        }
        Err(CompleteError::Refused)
    }

    /// The invitations the file is written from: every offer still on the
    /// table, as the square's own JSON, plus the id counter. A claimed
    /// ceremony is not among them and never can be — the file stopped
    /// holding it at its claim, which is why a claimed invitation exists
    /// only in this process's memory until it completes or expires.
    /// `except` is how the claim's own write names the invitation the phone
    /// has matched while it is still an offer here.
    fn persist(&self, except: Option<u32>) -> Result<(), InviteError> {
        let records = self
            .invites
            .iter()
            .filter_map(|invite| {
                if Some(invite.id) == except || !matches!(invite.pairing, Pairing::Offered(_)) {
                    return None;
                }
                Some(file::Record {
                    id: invite.id,
                    expires_at: invite.pairing.expires_at()?,
                    payload: invite.pairing.qr_payload()?,
                })
            })
            .collect();
        file::write(&self.path, self.next_id, records)
    }

    /// The next id, once. It comes from the counter the file carries, not
    /// from the records that happen to have survived a read: an id is never
    /// handed out twice while this file lives, so a stale row's [`link`]
    /// finds nothing rather than a different, live invitation. The counter
    /// only moves forward, and the id space running out is the one mint it
    /// refuses — [`InviteError::Full`] again, because no new invitation can
    /// be named.
    ///
    /// [`link`]: Invites::link
    fn take_id(&mut self) -> Result<u32, InviteError> {
        let id = self.next_id;
        self.next_id = id.checked_add(1).ok_or(InviteError::Full)?;
        Ok(id)
    }
}
