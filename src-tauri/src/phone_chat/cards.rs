//! The browser cards a phone's turn raised, and the one answer each of them takes.
//!
//! **A card is the sidecar's, and this is a mirror of which phone owns it.** The
//! held request lives in the sidecar, which is the only thing that can dispatch or
//! drop it; this says who may press it, for how long, and once.
//!
//! **Bound to a device and a credential, like a draft.** Device ids are reused once
//! the top one is forgotten, so the id alone cannot tell a forgotten phone from the
//! next one paired under it — the credential digest is half of the key for that
//! reason, and the same half a mail send is checked on.
//!
//! **Taken before the dispatch, never after.** An answer is spent here first, so a
//! second press of the same card finds nothing and a dispatch that then fails is
//! reported as unclear rather than retried: the request may already be at a
//! stranger's server, and trying again is how it goes twice.

use std::collections::HashMap;
use std::time::Instant;

use kalsa_browser::hold::{is_phone, phone_claim, phone_conversation};
use kalsa_door::DeviceId;

use crate::browser::pending::{Destination, Field, ASKED_FOR};

use super::drafts::Owner;

/// A card, and everything an answer needs to spend it correctly.
#[derive(Clone)]
pub(super) struct Held {
    pub(super) owner: Owner,
    /// **The claim of the turn that raised the card**, which the sidecar
    /// stamped: the phone's conversation and that turn's own name. A card is
    /// drawn, answered and reported in the turn that caused it and no other,
    /// and this is the name that says which turn that was.
    pub(super) conversation: String,
    /// The turn it was raised on, so a card can only be shown to the phone that
    /// is actually listening for it.
    pub(super) request: String,
    pub(super) id: String,
    pub(super) method: String,
    pub(super) url: String,
    /// **Where it goes, as the sidecar's parser read the address.** It is copied
    /// here rather than worked out again: a phone parsing `url` with a rule of its
    /// own is a phone that can show one host over a request going to another. The
    /// three fields are the protocol's §3.1 `destination`, and a phone draws them
    /// as they are.
    pub(super) destination: Option<Destination>,
    pub(super) fields: Vec<Field>,
    /// When it was first shown to the phone, which is also when the sidecar
    /// started counting: both are the same five minutes from the same moment.
    pub(super) created: Instant,
}

/// **What a phone may not do.** An id nobody is holding, and an id another phone
/// is holding, are the same answer on purpose: telling a stranger which cards this
/// computer is showing is a thing to refuse, not to describe.
pub(super) const UNKNOWN: &str = "card_unknown";
/// Past the person's five minutes. The sidecar has given it up on by now, so an
/// answer arriving now is owed nothing — and saying so is what tells the phone to
/// take the card off its screen.
pub(super) const EXPIRED: &str = "card_expired";

#[derive(Default)]
pub(super) struct Cards {
    entries: HashMap<String, Held>,
}

impl Cards {
    /// Remembers a card for its phone. The same id twice is one card: a refresh
    /// runs after every browser call, and a card the phone already has is not sent
    /// to it again.
    pub(super) fn note(&mut self, card: Held, now: Instant) -> bool {
        self.expired(now);
        if self.entries.contains_key(&card.id) {
            return false;
        }
        self.entries.insert(card.id.clone(), card);
        true
    }

    /// **Spends the card, and hands back what the answer needs.** The id is gone
    /// before the caller has dispatched anything, whatever happens next.
    pub(super) fn take(&mut self, owner: Owner, id: &str, now: Instant) -> Result<Held, &'static str> {
        // **Nothing is taken until the card has been found, aged and checked.**
        // A refusal that took the card with it would let any phone that knows an
        // id destroy a card the owner is still holding — and the check has to come
        // before the removal, not after, for exactly that reason.
        let Some(card) = self.entries.get(id) else {
            return Err(UNKNOWN);
        };
        if now.duration_since(card.created) >= ASKED_FOR {
            // Gone, and told as expired: an expired card is answerable by nobody,
            // so leaving it would only invite a press that cannot succeed.
            self.entries.remove(id);
            return Err(EXPIRED);
        }
        if card.owner != owner {
            return Err(UNKNOWN);
        }
        self.entries.remove(id).ok_or(UNKNOWN)
    }

    /// Whether this turn is allowed to show this card to its phone. The page is
    /// the WebView and a script in it can send anything: a card is only drawn for
    /// the request that raised it, and only for the phone that owns it.
    pub(super) fn shows(&self, request: &str, owner: &Owner, id: &str) -> bool {
        self.entries.get(id).is_some_and(|card| card.request == request && &card.owner == owner)
    }

    /// **Whether this computer is already holding a card.** A refresh re-routes
    /// every card the sidecar is holding, so a card the phone already has is
    /// one to leave alone — and one not to count against the phone's cap.
    pub(super) fn holds(&self, id: &str) -> bool {
        self.entries.contains_key(id)
    }

    /// How many cards one phone is holding, so the caller can refuse the
    /// next one instead of stacking a screen full of decisions on one phone.
    ///
    /// **Counted per phone, not per turn.** A card is stamped with the turn that
    /// raised it, and a phone's next turn is stamped with a different name, so a
    /// count per stamp would let one phone be asked about eight cards on this
    /// turn and eight more on the next.
    pub(super) fn held_for(&self, device: DeviceId) -> usize {
        self.entries.values().filter(|card| card.owner.0 == device).count()
    }

    /// **Drops the cards of every phone not in `paired`, and hands them back** so
    /// each one is told it was declined rather than vanishing. A phone that comes
    /// back with the same id under a new credential finds nothing: the cards went
    /// when the old phone was forgotten.
    pub(super) fn keep_paired(&mut self, paired: &[Owner], now: Instant) -> Vec<Held> {
        self.expired(now);
        let gone: Vec<String> =
            self.entries.values().filter(|card| !paired.contains(&card.owner)).map(|card| card.id.clone()).collect();
        gone.into_iter().filter_map(|id| self.entries.remove(&id)).collect()
    }

    /// The cards past the person's five minutes, taken off the table. Run on each
    /// access, so a secret value in an expired card does not outlive the next touch
    /// of this table.
    pub(super) fn expired(&mut self, now: Instant) -> Vec<Held> {
        let stale: Vec<String> = self
            .entries
            .values()
            .filter(|card| now.duration_since(card.created) >= ASKED_FOR)
            .map(|card| card.id.clone())
            .collect();
        stale.into_iter().filter_map(|id| self.entries.remove(&id)).collect()
    }

    /// The card ids this phone is holding, for a proof and for the owner's teardown.
    #[cfg(test)]
    pub(super) fn ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.entries.keys().cloned().collect();
        ids.sort();
        ids
    }
}

/// The conversation a phone's browser calls are stamped with.
///
/// **One per device, for the life of the pairing, not per turn.** A card is
/// answered in the conversation that raised it and its outcome is read by the next
/// turn *of the same phone*, so the key has to outlive the turn — and it has to be
/// the phone, because the phone is who may answer and who is told. A desktop
/// conversation is a UUID and never carries this prefix, so the two can never be
/// confused for one another.
///
/// **The name itself is the browser's.** `kalsa-browser` owns the shape of a
/// phone's claim and the rule that reads it, so the two crates cannot go on
/// reading the same string two ways.
pub(super) fn conversation_of(device: DeviceId) -> String {
    phone_conversation(&device.value().to_string())
}

/// Whether a conversation belongs to a phone. The window asks this before it
/// draws: a card for a phone is drawn on that phone and on no desktop.
pub(crate) fn is_phone_conversation(conversation: &str) -> bool {
    is_phone(conversation)
}

/// **The claim one turn makes on the page**: the phone's conversation and the
/// turn's own id.
///
/// **The claim belongs to the turn, not to the phone for the life of the
/// pairing.** The protocol says so, and the reason is a release: the turn's end
/// is what lets the page go, and a release that names one turn must not let go
/// of a claim another turn holds. A name per device cannot tell the two apart —
/// a late release would find the next turn's claim and take the page from it —
/// so the name carries the turn, and a release that finds nothing of its own
/// lets nothing go.
///
/// **Built in one place, and the window is handed it.** The sidecar treats the
/// name as a name, so the two halves of the computer — the window that stamps
/// the browser calls and the bridge that reads the card back — have to be
/// saying the same thing; the bridge builds it and the window is given it, so
/// they cannot drift apart. **And the shape of it is the browser's**, which is
/// where the rule that reads a claim lives.
pub(super) fn stamp_of(device: DeviceId, request: &str) -> String {
    phone_claim(&device.value().to_string(), request)
}
