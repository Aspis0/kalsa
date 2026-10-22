//! The phone's chat, app side. The door hands a phone's turn or mail read to
//! the page as `phone-chat-request`; the page answers through
//! `brain_phone_chat_event`, and each event goes to the door's stream for its
//! request. A reply draft the page makes is kept here, and a phone's send goes
//! through the same path the panel's send button takes.

mod cards;
mod drafts;
mod events;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, OnceLock};
use std::time::Instant;

use kalsa_door::{ChatEvent, DeviceId, Opened, PhoneChat};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::browser::pending;
use crate::browser::pending::ASKED_FOR;
use crate::browser::state::BrowserState;
use crate::mail::commands::send_confirmed;
use crate::mail::state::MailState;
use cards::{Cards, Held};
use drafts::{Drafts, Owner, Ticket};

const REQUEST_EVENT: &str = "phone-chat-request";
const STOP_EVENT: &str = "phone-chat-stop";
/// **The conversations of the phones that are no longer paired.** What the page
/// forgets its own memory for when a phone is removed.
const UNPAIRED_EVENT: &str = "phone-chat-unpaired";

/// The page's event names. Anything else is refused.
const EVENTS: &[&str] = &[
    "accepted",
    "reasoning",
    "delta",
    "tool_run",
    "cards",
    "draft",
    "read",
    "browser_card",
    "browser_outcome",
    "recap",
    "error",
    "done",
];

/// The events that end their request. The request is retired after one, so a
/// later event for it is dropped.
const ENDING: &[&str] = &["read", "error", "done"];

/// One held request to let go, and why nobody was asked. **Collected by the
/// caller, sent by [`Bridge::send_declines`]** — see there for why nothing here
/// waits.
struct Decline {
    id: String,
    conversation: String,
    /// The live turn to put the outcome on, when the turn that raised this is
    /// still running and is this phone's. Empty when there is none, which is
    /// what sends the outcome to the queue instead of a socket.
    request: String,
    why: &'static str,
    /// **Whether the phone that raised this may still be told what became of
    /// it.** It is paired, and it was never shown the card, so the outcome is
    /// news it can apply — or drop, for an id it does not know. A phone that
    /// was just unpaired has no next turn to hear it on, and a press that was
    /// answered by the phone itself is said to by its own answer path.
    tell_phone: bool,
}

/// One event's data once serialized. A larger one ends its turn as an engine failure.
const MAX_EVENT_BYTES: usize = 1024 * 1024;

/// **How many cards one phone is asked about at once.** A person is being asked to
/// decide on a stranger's write; a ninth card on one screen is not a decision any
/// more, it is a queue they will clear by pressing the top one. The ninth is
/// refused at the sidecar rather than held.
const MAX_HELD: usize = 8;

/// **How many outcomes are kept for a phone that is not listening.** Sixteen is
/// more cards than the computer will ever have held for one phone at once (eight,
/// §`MAX_HELD`), so the queue is deep enough for every card the person was ever
/// asked about in one go of unanswered requests, and shallow enough that a phone
/// that never comes back is not remembered by it.
const WAITING_ROOM: usize = 16;

/// Why a hold is let go where nobody was asked about it. **One plain line each,
/// and none of them says the person refused** — a model told they refused tries
/// again, which is the opposite of what a request nobody was shown deserves.
/// Read by the sidecar, which is where the model's own outcome comes from.
const TOO_MANY: &str = "the person was already being asked about eight other requests, so this \
one was never put to them";
/// The phone was unpaired while its card was held.
const UNPAIRED: &str = "the phone that raised this was unpaired before anybody could answer it";
/// The person's five minutes were up before the press arrived.
const LATE: &str = "the person's five minutes for this request were already up when they answered";
/// The phone that raised this has no card it can draw, so nobody was asked. Read
/// in the sidecar's own sentence: "No request was sent: …, so the person was never
/// asked about it."
const NO_CARD: &str = "this phone cannot be shown the confirm card yet";
/// The turn that raised the card had ended before the card could reach its phone.
const TURN_ENDED: &str = "the turn that raised this had already ended before the card could be shown";

/// What the model is told about a card nobody answered. The same word the
/// desktop's own expiry uses, so one model reads one set of sentences.
pub(crate) const EXPIRED_OUTCOME: &str = "expired";

/// What the model is told about a request it was never put to anybody. The word
/// the sidecar settles such a decline with, so the note on the model's next turn
/// and the sentence its next browser call is prefixed with say the same thing.
/// **A proof's word**: the product speaks whatever the sidecar answered with.
#[cfg(test)]
const UNSENDABLE_OUTCOME: &str = "unsendable";

/// The request the page owns: the phone it serves and that phone's credential
/// digest, what kind of request it is, the mail a turn was pinned to, and the
/// inbox the door reads.
struct Live {
    owner: Owner,
    kind: &'static str,
    reply_for: Option<u32>,
    inbox: mpsc::Sender<ChatEvent>,
    /// **The conversation this request's browser writes are stamped with**, which
    /// is the phone's and not a turn's. It is what binds a card to the phone that
    /// may answer it, and what makes a page script's invented card find nothing:
    /// the id has to be one this bridge is actually holding for this phone.
    conversation: String,
}

/// The door's hook and the page's side of the phone's chat, in one place: the
/// live requests, the paired phones, and the drafts the page made for them.
#[derive(Default)]
pub(crate) struct Bridge {
    /// Set once the app exists. Until then no page can take a request.
    app: OnceLock<AppHandle>,
    live: Mutex<HashMap<String, Live>>,
    paired: Mutex<Vec<Owner>>,
    /// The store this bridge asks about one phone's mail, set once the app
    /// knows where the store is. NOT a cache of the answer, and the reason is
    /// a race this file once lost: a reconcile that read the store before the
    /// owner's switch was written could hand its older answer to `pair` after
    /// the command had written the newer one, and nothing would correct it —
    /// the reconcile's own equality check is blind to mail, so every later
    /// pass takes the fast path and never re-pairs. A decision that may not be
    /// cached is read where it is asked for. The store is small and a phone
    /// request is a person's action, not a loop.
    store: OnceLock<PathBuf>,
    drafts: Mutex<Drafts>,
    /// The browser cards this window's phone turns raised, and who may answer
    /// each. See [`cards`]: the same device-plus-credential binding a draft has,
    /// for the same reason.
    cards: Mutex<Cards>,
    /// **Outcomes nobody was listening for, waiting for the phone they belong
    /// to.** Keyed by device, not by turn: the phone that has to act on an
    /// outcome is the phone the card was drawn on, and the turn that raised it is
    /// usually over. Handed over at the start of that phone's next turn, in
    /// order, and dropped with the pairing — an outcome for a phone that is no
    /// longer paired is read by nobody, ever.
    waiting: Mutex<HashMap<DeviceId, Vec<Value>>>,
    /// **Answers being dispatched right now, per phone.** Keyed by the card's id
    /// and the phone that owns it, and held from the moment a phone's press has
    /// passed its pairing check until the dispatch has been sent or refused.
    /// `pair` reads it to settle a phone it is about to forget: see
    /// [`Bridge::forget`].
    answering: Mutex<HashMap<(Owner, String), Arc<AtomicBool>>>,
    /// A handshake for the proof about the window between a phone's pairing check
    /// and its dispatch: the answer stands at the gate, the test unpairs the
    /// phone, and the answer carries on. Test-only, because nothing in the
    /// product ever needs to stand still.
    #[cfg(test)]
    pause: std::sync::Condvar,
    #[cfg(test)]
    paused: Mutex<(bool, bool)>,
    /// **Whether a phone can be shown a browser card.** Off until the phone's app
    /// draws one: a card that nobody is shown is a card nobody answers, and the
    /// person would wait the whole five minutes for it. Until this is on, every
    /// card a phone's turn raises is declined at once, with the reason, and the
    /// browser is never asked to send it.
    phones_show_cards: bool,
    /// The declines a proof can read: a unit test has no app to send them through.
    #[cfg(test)]
    declined: Mutex<Vec<(String, &'static str)>>,
    /// What a proof can read of the model's telling: (id, conversation, code).
    /// A unit test has no app to emit into.
    #[cfg(test)]
    told: Mutex<Vec<(String, String, String)>>,
}

impl Bridge {
    pub(crate) fn attach(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    /// Where the owner's decisions live. Asked of the shell once, when it
    /// knows: before this, a mail question is answered NO, which is the
    /// direction an unready app fails in.
    pub(crate) fn use_store(&self, file: PathBuf) {
        let _ = self.store.set(file);
    }

    /// The paired phones, by id and credential. Called wherever the door is
    /// given a new set, before the door takes it: a draft whose phone is no
    /// longer paired under its credential is dropped first, so a reused id
    /// can never spend a forgotten phone's draft.
    pub(crate) fn pair(&self, phones: &[(DeviceId, String)]) {
        let owners: Vec<Owner> = phones
            .iter()
            .map(|(device, credential)| (*device, digest(credential)))
            .collect();
        lock(&self.drafts).keep_paired(&owners, Instant::now());
        // A phone that is no longer paired takes its cards with it, and each is
        // declined rather than dropped: the card was held, nobody is left to answer
        // it, and the model is owed the same sentence it would get from a window
        // that closed with the card on it.
        let now = Instant::now();
        let forgotten: Vec<Owner> = lock(&self.paired)
            .iter()
            .filter(|owner| !owners.contains(owner))
            .copied()
            .collect();
        let dropped = lock(&self.cards).keep_paired(&owners, now);
        // **The sidecar is told, not just the phone.** The hold lives there, and it
        // is the only thing that can let the request go: without this a forgotten
        // phone's card sits in the sidecar for the rest of its five minutes with
        // nobody left to press it, and the model's own outcome list never learns
        // that it was declined. So the decline goes down the sidecar's own path —
        // which drops the hold and settles the model-facing outcome in the
        // conversation that raised it — **but it is collected here and sent after
        // the table has been set**, because asking the sidecar is an async call and
        // this function is called from inside async contexts.
        let declining: Vec<Decline> = dropped
            .into_iter()
            .map(|card| Decline {
                id: card.id,
                conversation: card.conversation,
                request: String::new(),
                why: UNPAIRED,
                // The pairing is gone: a queued outcome would sit for a phone
                // whose next turn never comes, and the queue itself is dropped
                // below with the pairing.
                tell_phone: false,
            })
            .collect();
        // What was queued for a phone that is no longer paired goes with it.
        lock(&self.waiting).retain(|device, _| !forgotten.iter().any(|(paired, _)| paired == device));
        // **And so does anything that phone is answering this instant.** The card
        // is already gone from `cards` — `keep_paired` took it — but a press that
        // got past its own pairing check a moment ago is between that check and
        // the browser, and the request it would send belongs to a phone the owner
        // has just removed. So the answer is **marked, not waited for**: `pair`
        // runs on the reconcile thread, and waiting here would mean waiting out a
        // browser call the person is owed up to five minutes of. The dispatch
        // path asks the mark once more, immediately before it hands anything
        // over, and stops there.
        for ((owner, _), mark) in lock(&self.answering).iter() {
            if forgotten.contains(owner) {
                mark.store(true, Ordering::SeqCst);
            }
        }
        // **Told what is gone**, so the page can forget what it remembered for
        // those phones: the browser's writes it refused for a chat that has read
        // the owner's mail, which is this computer's memory and not the phone's,
        // and a phone that is unpaired and later paired again must not inherit
        // the other's chat's caution. The page is the only thing holding that
        // state, so it is the only thing that can be told.
        if !forgotten.is_empty() {
            if let Some(app) = self.app.get() {
                let gone: Vec<String> = forgotten.iter().map(|(device, _)| conversation_of(*device)).collect();
                let _ = app.emit(UNPAIRED_EVENT, gone);
            }
        }
        // **The table is set before a single card is let go.** Every lock this
        // function holds is released by this line: a decline asks the sidecar for
        // the state of a phone, and that phone must already be the one this
        // pairing says it is — not the one it was a moment ago, and never a state
        // where the table has been half-written.
        *lock(&self.paired) = owners;
        self.send_declines(declining);
    }

    /// **Asks the sidecar to let one of a phone's held requests go.**
    ///
    /// The hold is the sidecar's and only the sidecar can drop it, so the decline
    /// goes down the same road a person's own "no" goes down — which is also what
    /// puts the outcome in the store the model reads, in the conversation that
    /// raised the card. **The phone is not told**, and that is the point of the
    /// callers: every one of them is a case where the phone has no card to take
    /// down and no turn left to hear an outcome on — a write refused before it
    /// was ever drawn, a phone that has just been unpaired — so an outcome would
    /// be a frame about an id this phone never held. A window that closed under a
    /// live card is the one case the phone does need, and that goes through
    /// [`Bridge::tell_phone`] instead.
    ///
    /// Best-effort: a sidecar that is gone cannot be asked, and the card was
    /// held and nothing was let through either way, which is the truth.
    fn decline_at_the_sidecar(&self, card: &Held, why: &'static str) {
        self.send_declines(vec![Decline {
            id: card.id.clone(),
            conversation: card.conversation.clone(),
            request: card.request.clone(),
            why,
            tell_phone: false,
        }]);
    }

    /// **Sends the declines, without waiting for any of them.**
    ///
    /// **Nothing here blocks.** Asking the sidecar is a call across a pipe, and
    /// every caller of this — `route_cards` from a tauri command, `pair` from the
    /// reconcile timer, the answer path from a door thread — can be running inside
    /// an async context, where blocking on a future is a deadlock at best and a
    /// panic at worst. So the work is collected by the caller, every lock is
    /// released, and the decline is spawned onto the app's runtime to go out on
    /// its own.
    ///
    /// **Spawned, not awaited, and not refreshed.** `decline_one` spends the card
    /// in this app's own store before it asks anything, so the window and the phone
    /// already stop showing it; a refresh here would re-read the whole list and
    /// call back into `route_cards`, which decides on declines of its own — the two
    /// are callers of each other, and a refresh inside a decline is how that
    /// becomes a loop.
    ///
    /// **And a decline the sidecar settled is spoken.** The model is owed the
    /// outcome — its own write is still "awaiting confirm" to it — and the phone
    /// is handed its `browser_outcome` where it can still hear one, exactly as
    /// the expiry speaks. What the sidecar settled with is what is said: a
    /// decline that never reached the hold says nothing, because the hold's own
    /// five minutes are still what ends it.
    fn send_declines(&self, declining: Vec<Decline>) {
        // What a proof can read: a unit test has no app to send a decline through.
        #[cfg(test)]
        lock(&self.declined).extend(declining.iter().map(|decline| (decline.id.clone(), decline.why)));
        let Some(app) = self.app.get() else {
            // **A proof settles by hand.** Without an app there is no sidecar to
            // ask and no task to spawn, so the proof calls the telling itself,
            // with the code the sidecar answers such a decline with — which is
            // what makes the telling below readable without a browser at all.
            #[cfg(test)]
            for decline in &declining {
                self.settle_the_decline(decline, UNSENDABLE_OUTCOME);
            }
            return;
        };
        for decline in declining {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<BrowserState>();
                let Some(code) =
                    crate::browser::confirm::decline_one(&app, &state, &decline.id, &decline.conversation, decline.why)
                        .await
                else {
                    return;
                };
                let bridge = app.state::<std::sync::Arc<crate::Brain>>().phone_chat.clone();
                bridge.settle_the_decline(&decline, &code);
            });
        }
    }

    /// **Says what became of one settled decline: to the model, and — where the
    /// phone may still be listening — to the phone.**
    ///
    /// The model is told through the same per-conversation note the expiry rides,
    /// because a model whose write was let go without a word goes on believing
    /// the person is still deciding about it. The phone is handed the same
    /// outcome the person's own answer produces: on the turn's stream while the
    /// turn that raised it is live, and in the queue it reads at its next turn
    /// when it is not. It applies the ones it knows and drops the rest — a card
    /// it was never shown leaves nothing to take down.
    fn settle_the_decline(&self, decline: &Decline, code: &str) {
        self.tell_model(&decline.id, &decline.conversation, code);
        if !decline.tell_phone {
            return;
        }
        let wire = outcome_wire(&decline.id, code, None);
        if self.emit_to(&decline.request, "browser_outcome", wire.clone()) {
            return;
        }
        let Some(device) = device_of(&decline.conversation) else {
            return;
        };
        self.queue_for(device, wire);
    }


    /// Whether this phone may read this computer's mail, as of this question.
    ///
    /// Asked of the store, which is the one place the owner's decision is
    /// written, so no answer here can be older than the file. Anything that is
    /// not a clear yes is a no: no store yet, a store that cannot be read, a
    /// device the store does not hold — each is a mailbox that stays shut
    /// rather than one that opens on a guess.
    fn mail_allowed(&self, device: DeviceId) -> bool {
        let Some(file) = self.store.get() else {
            return false;
        };
        kalsa_pairing::store::load_devices(file)
            .ok()
            .and_then(|devices| devices.into_iter().find(|stored| stored.id == device.value()))
            .is_some_and(|stored| stored.mail)
    }

    /// One page event for one request. A name the request's kind does not take,
    /// or a shape the phone would not be shown safely, is refused and forwards
    /// nothing; an event for a request that is unknown or finished is dropped
    /// without a word.
    fn accept(&self, request: &str, name: &str, data: Value) -> Result<(), &'static str> {
        let name = EVENTS
            .iter()
            .copied()
            .find(|known| *known == name)
            .ok_or("unknown_event")?;
        if !data.is_object() {
            return Err("bad_request");
        }
        let Some((owner, kind, pin)) = lock(&self.live)
            .get(request)
            .map(|live| (live.owner, live.kind, live.reply_for))
        else {
            return Ok(());
        };
        events::check(kind, pin, name, &data)?;
        // **A card is only ever shown to the phone that owns it.** The page is the
        // WebView and a script in it can send anything, so the ids it names are
        // checked against what this bridge is really holding for this phone: a
        // forged id, another phone's id, and an id this turn did not raise are one
        // refusal, and nothing of the event is passed on.
        if matches!(name, "browser_card" | "browser_outcome") {
            let owned =
                events::card_id(&data).is_some_and(|id| lock(&self.cards).shows(request, &owner, &id));
            if !owned {
                return Err("card_unknown");
            }
        }
        if data.to_string().len() > MAX_EVENT_BYTES {
            self.forward(request, "error", json!({"code": "engine"}));
            return Ok(());
        }
        let data = if name == "draft" {
            self.keep_draft(owner, &data)
        } else {
            Some(data)
        };
        match data {
            Some(data) => self.forward(request, name, data),
            None => self.forward(request, "error", json!({"code": "engine"})),
        }
        Ok(())
    }

    /// Stores a draft the page made, already checked, under a fresh id, and
    /// returns what the phone is shown. The recipient is shown, never kept: a
    /// send takes the stored mail.
    fn keep_draft(&self, owner: Owner, data: &Value) -> Option<Value> {
        let reply_to_id = events::reply_id(data.get("reply_to_id"))?;
        let text = |key: &str| data.get(key)?.as_str().map(str::to_string);
        let (to, to_name, subject, body) = (
            text("to")?,
            text("to_name")?,
            text("subject")?,
            text("body")?,
        );
        let draft_id = random_hex()?;
        let stored = lock(&self.drafts).insert(
            draft_id.clone(),
            owner,
            reply_to_id,
            subject.clone(),
            body.clone(),
            Instant::now(),
        );
        if !stored {
            return None;
        }
        Some(json!({
            "draft_id": draft_id,
            "reply_to_id": reply_to_id.to_string(),
            "to": to,
            "to_name": to_name,
            "subject": subject,
            "body": body,
        }))
    }

    /// Passes an event to the door. An ending event, or one the door no longer
    /// reads, retires the request.
    ///
    /// **The queue is handed over just after `accepted` has gone out**, never
    /// before: the door drops any event that arrives ahead of `accepted`, so a
    /// drain placed anywhere else is a drain into nothing.
    fn forward(&self, request: &str, name: &str, data: Value) {
        let mut live = lock(&self.live);
        let delivered = live.get(request).is_some_and(|entry| {
            entry
                .inbox
                .send(ChatEvent {
                    name: name.to_string(),
                    data,
                })
                .is_ok()
        });
        if !delivered || ENDING.contains(&name) {
            live.remove(request);
            drop(live);
        } else if name == "accepted" {
            // The gate is given back first: the drain asks the table for the
            // device, and holding the lock across it would be a lock taken to
            // find out who is listening.
            drop(live);
            self.accepted(request);
        }
    }

    /// **Registers a live request for a phone.**
    ///
    /// Split out of [`PhoneChat::open`] so it can be proven without an app to emit
    /// into. It starts the stream and nothing else: **the queue of outcomes the
    /// phone was not listening for is handed over later**, by
    /// [`Bridge::accepted`], and it was this function's own drain that dropped
    /// every one of them — the door throws away any event that arrives before
    /// `accepted` (`chat::turn`, the `_ if accepted && STREAMED` arm), so an
    /// outcome written here was consumed and never written to the wire.
    ///
    /// Returns the receiver the door reads, and a sender kept so the card of this
    /// turn can be written to it later.
    /// **Whose turn this is comes from `asking`, not from a second argument.**
    /// The owner is the phone the door resolved the credential to, so it is the
    /// one thing that decides where this turn's cards are drawn — and a device
    /// passed beside it would be a second answer to the same question.
    fn start_live(
        &self,
        request: &str,
        kind: &'static str,
        asking: &Asking,
    ) -> mpsc::Receiver<ChatEvent> {
        let (inbox, events) = mpsc::channel();
        lock(&self.live).insert(
            request.to_string(),
            Live {
                owner: asking.owner,
                kind,
                reply_for: asking.reply_for,
                inbox,
                conversation: asking.conversation.clone(),
            },
        );
        events
    }

    /// **A turn is accepted: hand the phone what it was not listening for.**
    ///
    /// **Only here, and only for a turn.** `accepted` is the first frame the door
    /// lets through, so this is the earliest moment an outcome can be written and
    /// still reach the wire — before it, the door reads the event and drops it.
    /// And it is a *turn* only: a mail read takes `accepted`, `read` and `error`
    /// and nothing else, so an outcome written into a read's stream would be
    /// dropped there too — worse, a read is not a place a browser card was ever
    /// raised from, so a phone has nothing to apply it to. The queue waits for
    /// the phone's next **turn** instead, which is where its cards are drawn.
    ///
    /// The outcomes go out first, before anything the turn itself will say: the
    /// phone takes the card off its screen before it can press a button that can
    /// only be refused.
    fn accepted(&self, request: &str) {
        let Some(entry) = lock(&self.live).get(request).map(|entry| (entry.kind, entry.owner.0, entry.inbox.clone()))
        else {
            return;
        };
        let (kind, device, inbox) = entry;
        if kind != "turn" {
            return;
        }
        let waiting = lock(&self.waiting).remove(&device).unwrap_or_default();
        for said in waiting {
            let _ = inbox.send(ChatEvent { name: "browser_outcome".to_string(), data: said });
        }
    }

    fn paired_owner(&self, device: DeviceId) -> Option<Owner> {
        lock(&self.paired)
            .iter()
            .copied()
            .find(|(paired, _)| *paired == device)
    }

    /// **Takes the cards a phone's turn raised out of the window's draw and gives
    /// them to the phone instead.**
    ///
    /// Called with everything the sidecar is holding. The window is told only
    /// about the rest, so a phone's write is never drawn on a desktop the owner
    /// may be looking at — and a card the phone is not there to answer, because
    /// its turn has ended or the phone is gone, is declined rather than left
    /// waiting for a press that cannot come.
    pub(crate) fn route_cards(&self, cards: Vec<pending::Card>) {
        let now = Instant::now();
        // **A card nobody answered inside the person's five minutes is declined,
        // and both the phone and the model are told.** Nobody asked for this
        // outcome, so nothing else says it: the sidecar has given the card up, and
        // a model that is not told goes on carrying a request it believes is still
        // waiting for an answer.
        for card in lock(&self.cards).expired(now).into_iter().collect::<Vec<_>>() {
            self.report(&card, EXPIRED_OUTCOME, None);
            self.tell_model(&card.id, &card.conversation, EXPIRED_OUTCOME);
        }
        // **Every decline this call decides on leaves with it**, rather than being
        // asked for under the locks it was found under. See
        // [`Bridge::send_declines`].
        let mut declining: Vec<Decline> = Vec::new();
        for card in cards {
            let Some(device) = device_of(&card.conversation) else {
                // A phone's conversation with no usable number names no phone that could be
                // shown the card: declined at once, not left to the sidecar's five minutes.
                if is_phone_conversation(&card.conversation) {
                    declining.push(Decline {
                        id: card.id,
                        conversation: card.conversation,
                        request: String::new(),
                        why: NO_CARD,
                        tell_phone: false,
                    });
                }
                continue;
            };
            // **A card a phone cannot answer is declined at once.** Nobody is asked and
            // nothing is sent, and the model is told why in the sidecar's own sentence.
            // The person is never made to wait out the five minutes for a card that
            // nobody can draw. An unpaired phone's card is declined the way `pair`
            // declines the cards of a phone it forgets — and is told nothing, for
            // there is no next turn of that pairing to hear it.
            let Some(owner) = self.paired_owner(device) else {
                declining.push(Decline {
                    id: card.id,
                    conversation: card.conversation,
                    request: String::new(),
                    why: UNPAIRED,
                    tell_phone: false,
                });
                continue;
            };
            if !self.phones_show_cards {
                // The turn may well be live — the model is waiting on its
                // "awaiting confirm" — so the outcome goes on its stream when
                // there is one, and the queue when there is not.
                let request = self.request_of(owner, &card.conversation).unwrap_or_default();
                declining.push(Decline {
                    id: card.id,
                    conversation: card.conversation,
                    request,
                    why: NO_CARD,
                    tell_phone: true,
                });
                continue;
            }
            // The card goes to the turn that raised it. **No turn means no socket, and
            // no socket means no card:** the card is declined here, and nothing is sent.
            let Some(request) = self.request_of(owner, &card.conversation) else {
                declining.push(Decline {
                    id: card.id,
                    conversation: card.conversation,
                    request: String::new(),
                    why: TURN_ENDED,
                    tell_phone: true,
                });
                continue;
            };
            // **Eight is as many as one phone is ever asked about at once.**
            // A person is being asked to decide on a stranger's write, and a ninth
            // card on the same screen is not a decision any more — it is a queue
            // they will clear by pressing the top one. So the write is refused
            // rather than held: the sidecar lets it go without dispatching and
            // the model is told once, in one line, why. It never reaches the
            // phone, because a card nobody is shown is a card nobody answers.
            if lock(&self.cards).held_in(&card.conversation) >= MAX_HELD {
                // **Collected, not sent here**: `route_cards` runs inside a tauri
                // command, which is an async context, and the sidecar is a pipe
                // across a process. The decline goes out after every lock is let
                // go, so nothing here blocks and nothing is asked while a table is
                // half-read.
                declining.push(Decline {
                    id: card.id,
                    conversation: card.conversation,
                    request,
                    why: TOO_MANY,
                    tell_phone: true,
                });
                continue;
            }
            let held = Held {
                owner,
                conversation: card.conversation.clone(),
                request,
                id: card.id.clone(),
                method: card.method.clone(),
                url: card.url.clone(),
                destination: card.destination.clone(),
                fields: card.fields.clone(),
                created: now,
            };
            if lock(&self.cards).note(held.clone(), now) {
                self.send_card(&held);
            }
        }
        self.send_declines(declining);
    }

    /// The live turn a phone is running, if any. **Device plus credential**: the
    /// id alone would let a phone that has taken another's number speak for it.
    fn request_of(&self, owner: Owner, conversation: &str) -> Option<String> {
        lock(&self.live)
            .iter()
            .find(|(_, live)| live.owner == owner && live.conversation == conversation)
            .map(|(request, _)| request.clone())
    }

    /// **Puts one card on the phone's socket, once.**
    ///
    /// **One path, and it is the door's own.** The card is written into the live
    /// request's event stream, which is the same stream the phone's turn is
    /// already reading. It used to be written there *and* emitted to the window,
    /// which forwarded it onto the same socket by hand — so a phone was sent
    /// every card twice, once per road. A relay is not a second delivery, it is
    /// a second way to reach the one socket that was already open.
    fn send_card(&self, card: &Held) {
        self.emit_to(&card.request, "browser_card", card_wire(card));
    }

    /// **Stands the dispatch still, once, so a proof can watch the window.**
    /// Idle until a proof asks for it; an answer that reaches the gate says so
    /// and waits to be let go.
    #[cfg(test)]
    fn arrived(&self) {
        let mut state = lock(&self.paused);
        if !state.0 {
            return;
        }
        state.1 = true;
        self.pause.notify_all();
        while state.0 {
            state = self.pause.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    /// **Asks for the next answer to stand at the gate.** Armed before the answer
    /// is started, never after: an answer that reaches an unarmed gate walks
    /// straight through it, and a proof waiting for one that already went is a
    /// proof that waits for ever.
    #[cfg(test)]
    fn arm_gate(&self) {
        *lock(&self.paused) = (true, false);
        self.pause.notify_all();
    }

    /// **Waits until an answer is standing at the gate.** [`Bridge::release`] lets
    /// it go on.
    #[cfg(test)]
    fn wait_at_the_gate(&self) {
        let mut state = lock(&self.paused);
        while !state.1 {
            state = self.pause.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    /// Lets a held answer go on.
    #[cfg(test)]
    fn release(&self) {
        let mut state = lock(&self.paused);
        state.0 = false;
        self.pause.notify_all();
    }

    /// **Tells a phone what became of one of its cards, when it did not ask.**
    /// An answer the phone asked for comes back in its own response; an expiry, a
    /// window that closed and a phone that unpairs are the three nobody asked.
    ///
    /// **On the stream when there is one, and on the next turn when there is
    /// not.** A card expires five minutes after it was shown and a turn is over
    /// in seconds, so most outcomes have nobody listening, and a phone left
    /// holding a card that was already declined will press a button that can only
    /// be refused. So an outcome with no stream to go down is **queued for the
    /// device**, and the next turn that phone starts is handed its own queue
    /// before anything else — where the phone applies it to the ids it still
    /// holds and drops the ones it does not.
    fn tell_phone(&self, card: &Held, code: &str, host: Option<&str>) {
        let wire = outcome_wire(&card.id, code, host);
        let Some(device) = device_of(&card.conversation) else {
            return;
        };
        if self.emit_to(&card.request, "browser_outcome", wire.clone()) {
            return;
        }
        self.queue_for(device, wire);
    }

    /// **Queues one outcome for the phone it belongs to, for its next turn.**
    ///
    /// The queue is a phone's inbox, not a store. It is a run of outcomes for
    /// cards that phone is no longer drawing, so it is bounded the way a screen
    /// is: when it is full the oldest goes, because the newest is the one about
    /// the card it last saw. Nothing is dropped silently — every outcome in it
    /// is about a card the person can no longer answer, and the computer's own
    /// five minutes has already settled all of them.
    fn queue_for(&self, device: DeviceId, wire: Value) {
        let mut queue = lock(&self.waiting);
        let waiting = queue.entry(device).or_default();
        waiting.push(wire);
        let excess = waiting.len().saturating_sub(WAITING_ROOM);
        if excess > 0 {
            waiting.drain(..excess);
        }
    }

    /// **Writes one event onto a live request's stream, and says whether there
    /// was one.** A card with nowhere to go is not sent to anybody, and the
    /// caller is the only one that can tell — so this hands the answer back
    /// rather than swallowing it.
    fn emit_to(&self, request: &str, name: &str, data: Value) -> bool {
        let inbox = lock(&self.live).get(request).map(|live| live.inbox.clone());
        match inbox {
            Some(inbox) => inbox.send(ChatEvent { name: name.to_string(), data }).is_ok(),
            None => false,
        }
    }

    /// **A window closed with this phone's cards on it.** Each is declined: the
    /// card was held, nobody is left to answer it, and nothing was let through.
    pub(crate) fn decline_cards(&self, cards: Vec<pending::Card>) {
        for card in cards {
            let Some(device) = device_of(&card.conversation) else {
                continue;
            };
            let Some(owner) = self.paired_owner(device) else {
                continue;
            };
            let held = Held {
                owner,
                conversation: card.conversation,
                request: String::new(),
                id: card.id,
                method: card.method,
                url: card.url,
                destination: card.destination,
                fields: card.fields,
                created: Instant::now(),
            };
            self.report(&held, crate::browser::confirm::DECLINED, None);
        }
    }

    /// **Answers a card, exactly once.** The card is taken before anything is
    /// dispatched, so a second answer of the same id finds nothing and a dispatch
    /// that then fails is reported rather than retried.
    ///
    /// **The pairing is asked twice, and the second answer is the one that
    /// counts.** The first is what finds the card; the second is asked after the
    /// card has been spent and before the sidecar is given anything, so a phone
    /// the owner unpaired while its finger was on the button cannot dispatch a
    /// request its turn raised. Between the two sits nothing but taking the card,
    /// which is the whole of the window a pair change has to land in — and
    /// `pair` runs its own decline under the same table, so a card this phone
    /// no longer holds is refused either way.
    pub(crate) fn answer_card(&self, device: DeviceId, card_id: &str, allow: bool) -> Result<Value, String> {
        let Some(owner) = self.paired_owner(device) else {
            return Err(cards::UNKNOWN.to_string());
        };
        let held = lock(&self.cards).take(owner, card_id, Instant::now()).map_err(str::to_string)?;
        if self.paired_owner(device) != Some(owner) {
            // **Spent and declined, and nothing was dispatched** — the browser is
            // told through the sidecar's own path, and the phone is not told at
            // all: it is not paired, so a queued outcome would be a line read by
            // nobody.
            self.decline_at_the_sidecar(&held, UNPAIRED);
            return Err(crate::browser::confirm::DECLINED.to_string());
        }
        // **From here to the browser, this answer is a thing `pair` can stop.**
        // The mark is set before the deadline is read and taken down after the
        // dispatch has been sent or refused, so the whole of the window in which
        // a request could leave is inside it.
        let stop = Arc::new(AtomicBool::new(false));
        lock(&self.answering).insert((owner, held.id.clone()), Arc::clone(&stop));
        // **The last look, as close to the browser as this code can get.** A
        // phone unpaired since the check above stops here: nothing is handed over,
        // and the phone is told the request is not going to be sent — which is
        // true. The gap between this and the browser's own call is a handful of
        // instructions; closing it entirely would mean holding this thread's lock
        // across a call the person is owed five minutes for, which is a far worse
        // trade than the gap.
        #[cfg(test)]
        self.arrived();
        if stop.load(Ordering::SeqCst) {
            lock(&self.answering).remove(&(owner, held.id.clone()));
            // **The browser and the model, and not the phone.** The phone is gone:
            // an outcome queued for it would sit in a run nothing will ever read,
            // because the next turn under that pairing never comes.
            self.decline_at_the_sidecar(&held, UNPAIRED);
            return Err(crate::browser::confirm::DECLINED.to_string());
        }
        // **And the person's five minutes are the lane.** A press arrives with
        // what is left of the card's own budget, and the wait for the browser is
        // bounded by it: a browser that stops answering must not hold a door
        // thread — and this one is the door's — for ever. Already up means the
        // request was never given to anything, and the press is told so.
        let left = budget_left(&held, Instant::now());
        if left.is_zero() {
            self.decline_at_the_sidecar(&held, LATE);
            self.tell_phone(&held, crate::browser::confirm::UNCLEAR, None);
            return Err(crate::browser::confirm::UNCLEAR.to_string());
        }
        let Some(app) = self.app.get() else {
            lock(&self.answering).remove(&(owner, held.id.clone()));
            self.report(&held, crate::browser::confirm::DECLINED, None);
            return Err("no_runner".to_string());
        };
        // **The same answer the desktop's own button goes through**, so the id is
        // spent inside the sidecar before anything is dispatched and the outcome
        // reaches the model the same way whichever phone pressed. A failure here
        // is still reported: the card was spent and nobody can say what went.
        //
        // Blocked on, not awaited: the door calls a hook from a thread of its own
        // with no runtime of ours, exactly as a mail send is dispatched.
        let state = app.state::<BrowserState>();
        let id = held.id.clone();
        let conversation = held.conversation.clone();
        let outcome = tauri::async_runtime::block_on(async {
            // **Bounded by the card's own budget, and the lane is released either
            // way.** `await_dispatch` is where the wait happens, so a sidecar
            // that never answers ends this lane when the person's five minutes
            // are up rather than holding a door thread for ever — and because the
            // request was already at the sidecar when the wait began, what that
            // is reported as is `unclear`, never `declined`: that server may
            // already have it, and a model told "declined" will try again.
            match crate::browser::confirm::await_dispatch(
                left,
                crate::browser::confirm::answer(app, &state, id.clone(), conversation.clone(), allow),
            )
            .await
            {
                crate::browser::confirm::Dispatch::Answered(Ok(said)) => {
                    Ok(crate::browser::confirm::outcome_of(&said))
                }
                // **The window's own case has already been said, once.** `answer`
                // says it itself — and it says nothing at all about a press that
                // never went, because there is nothing to be unclear about: the
                // browser was busy, the request was never sent, and the card is
                // still waiting where it was raised.
                crate::browser::confirm::Dispatch::Answered(Err(refused)) => {
                    Err(refused.code().to_string())
                }
                crate::browser::confirm::Dispatch::Unclear => {
                    crate::browser::confirm::answer_failed(app, &state, &id, &conversation).await;
                    Err(crate::browser::confirm::UNCLEAR.to_string())
                }
            }
        });
        // **Every way out of here takes the mark down**, so an answer that was
        // refused, that timed out or that the browser never answered does not
        // leave a phone looking as though it were still answering something.
        lock(&self.answering).remove(&(owner, held.id.clone()));
        let (code, host) = match outcome {
            Ok(outcome) => outcome,
            Err(code) => {
                // **A press that never went is not a verdict about the request.**
                // Nothing was sent, so the phone is told nothing: an outcome
                // about it would be the phone saying it was settled when it was
                // not. The busy browser gives the card back; the card that was
                // already resolved elsewhere stays gone — and both are the same
                // family, read from the one list.
                self.report_a_refusal(&held, &code);
                return Err(code);
            }
        };
        self.report(&held, &code, host.as_deref());
        Ok(outcome_wire(&held.id, &code, host.as_deref()))
    }

    /// **The phone's preview of the page this computer is showing.**
    ///
    /// **The pairing is checked twice, and the second answer counts.** The
    /// second is asked after the picture has been taken and before a byte of it
    /// leaves, so a phone the owner removed under the capture gets no picture.
    ///
    /// **The conversation is this phone's own**, named from the device the
    /// door authenticated: a phone cannot ask for somebody else's page.
    pub(crate) fn preview(&self, device: DeviceId) -> Result<Value, String> {
        self.preview_guarded(device, || self.take_preview(device))
    }

    /// The preview, with the picture behind a seam, so the pairing rule can be
    /// proved without a browser.
    fn preview_guarded<F>(&self, device: DeviceId, capture: F) -> Result<Value, String>
    where
        F: FnOnce() -> Result<Value, String>,
    {
        let Some(owner) = self.paired_owner(device) else {
            // This computer does not know this phone, so it will not answer for
            // it. The door has already refused a credential it does not hold.
            return Err(crate::browser::preview::Code::Unavailable.as_str().to_string());
        };
        let Some(key) = preview_key() else {
            return Err(crate::browser::preview::Code::Unavailable.as_str().to_string());
        };
        // **From here to the hand-over, a pairing change can stop this.** The
        // mark is set before the picture is taken and taken down however the
        // picture ends.
        let mark = Arc::new(AtomicBool::new(false));
        lock(&self.answering).insert((owner, key.clone()), Arc::clone(&mark));
        let _guard = PreviewMark { bridge: self, owner, key };
        #[cfg(test)]
        self.arrived();
        let captured = capture();
        // **The last look, as close to the hand-over as this code can get.** A
        // phone unpaired since the check above gets no picture, and one
        // unpaired under the capture is stopped by the mark. What has already
        // gone out is not recalled — there is no way to recall it — but nothing
        // leaves here either.
        if self.paired_owner(device) != Some(owner) || mark.load(Ordering::SeqCst) {
            return Err(crate::browser::preview::Code::Cancelled.as_str().to_string());
        }
        captured
    }

    /// The picture, through the browser this computer already has open.
    ///
    /// **Nothing is started for it.** A preview of a page that is not open is
    /// an answer, not a reason to open a window on the person's desk.
    fn take_preview(&self, device: DeviceId) -> Result<Value, String> {
        let Some(app) = self.app.get() else {
            return Err(crate::browser::preview::Code::Unavailable.as_str().to_string());
        };
        let state = app.state::<BrowserState>();
        let conversation = conversation_of(device);
        // Blocked on, not awaited: the door calls a hook from a thread of its
        // own with no runtime of ours, exactly as a card's answer is dispatched.
        tauri::async_runtime::block_on(state.browser().preview(&conversation))
            .map_err(|code| code.as_str().to_string())
    }

    /// Tells the phone what became of its card.
    fn report(&self, card: &Held, code: &str, host: Option<&str>) {
        self.tell_phone(card, code, host);
    }

    /// **Reports a refusal as an outcome — unless the press never went.**
    ///
    /// **A press that never went is not a verdict**, so there is nothing to
    /// report: nothing was sent, and an outcome would be this app saying the
    /// request was settled when it was not. The busy browser and the card that
    /// was already resolved elsewhere are both that, and they are read from the
    /// one list.
    ///
    /// Returns whether it reported.
    fn report_a_refusal(&self, card: &Held, code: &str) -> bool {
        if self.a_press_that_never_went(card, code) {
            return false;
        }
        self.report(card, crate::browser::confirm::UNCLEAR, None);
        true
    }

    /// **A press that never went leaves nothing behind, and is not reported.**
    ///
    /// **The family is one list**, and it is the list the window's own rule
    /// reads (`BrowserError::a_press_that_never_went`, which is what
    /// `leaves_an_outcome` is read the other way round): the browser was busy,
    /// or the request was not waiting for an answer any more. Both leave the
    /// request unsent, so neither of them leaves an outcome behind — an outcome
    /// about a request that never left would be this app saying the request was
    /// settled when it was not, and the model would go on believing it had an
    /// answer it does not have.
    ///
    /// **And the two are not the same thing to the card.** The busy browser means
    /// the request is still held at the sidecar and the card is still the
    /// person's to press, so **the card goes back on the table**, with the budget
    /// it had — the five minutes the person was given are the five minutes they
    /// had, and a card that came back with a fresh budget would be a card that
    /// could be sat on for ever.
    ///
    /// Without this the card was gone from the phone's table for a press that
    /// never reached anything: the next press was a press about nothing —
    /// `card_unknown` — and the person was told their answer had gone to a card
    /// that had never been there. The desktop's own reducer puts the card back
    /// on a busy browser for exactly this reason; the phone's table has to do
    /// the same, or the phone is the one place where a busy browser loses the
    /// card.
    ///
    /// **A card that was already resolved elsewhere stays gone.** The request
    /// had its verdict — from the decline that took it, or from the expiry that
    /// removed it — and there is nothing left to press about it, so it does not
    /// come back: a card that came back would be a card the person could press
    /// again only to be refused again. It is left off the table, and the phone
    /// is told the fixed code for it, which is the app's own sentence for a
    /// request that is not waiting for an answer any more.
    ///
    /// Returns whether this was such a press.
    fn a_press_that_never_went(&self, card: &Held, code: &str) -> bool {
        if !crate::browser::error::BrowserError::a_press_that_never_went(code) {
            return false;
        }
        if code == crate::browser::error::BrowserError::Busy.code() {
            lock(&self.cards).note(card.clone(), Instant::now());
        }
        true
    }
    /// **Tells the model, through the same per-conversation note the desktop's own
    /// outcomes ride.** Used only where no answer path already said it — a card
    /// that expired, a request that was let go without a press — because an
    /// outcome nobody hears is an outcome a model goes on believing has not
    /// happened.
    fn tell_model(&self, id: &str, conversation: &str, code: &str) {
        #[cfg(test)]
        lock(&self.told).push((id.to_owned(), conversation.to_owned(), code.to_owned()));
        if let Some(app) = self.app.get() {
            let _ = app.emit(
                crate::browser::confirm::ANSWERED,
                crate::browser::confirm::Answered {
                    id: id.to_owned(),
                    conversation: conversation.to_owned(),
                    code: code.to_owned(),
                    host: None,
                },
            );
        }
    }

    fn send_draft(
        &self,
        device: DeviceId,
        draft_id: &str,
        edited: Option<String>,
    ) -> Result<String, String> {
        let app = self.app.get().ok_or("mail.failed")?;
        let state = app.state::<MailState>();
        self.send_draft_via(
            device,
            draft_id,
            edited,
            |owner| self.paired_owner(device) == Some(owner),
            |ticket| {
                let sent = tauri::async_runtime::block_on(send_confirmed(
                    app,
                    &state,
                    ticket.reply_to_id,
                    ticket.subject,
                    ticket.body,
                ));
                sent.map_err(|error| {
                    log::warn!("a phone's mail send was refused: {}", error.code());
                    error.code().to_string()
                })
            },
        )
    }

    /// The send with its pairing check and its mail supplied. The caller's owner
    /// comes from the paired set and the draft must be that owner's; the caller
    /// is checked again once the draft is taken, just before the mail goes.
    fn send_draft_via(
        &self,
        device: DeviceId,
        draft_id: &str,
        edited: Option<String>,
        still_paired: impl FnOnce(Owner) -> bool,
        mail: impl FnOnce(Ticket) -> Result<String, String>,
    ) -> Result<String, String> {
        let owner = self.paired_owner(device).ok_or("draft_unknown")?;
        let ticket = lock(&self.drafts)
            .begin(owner, draft_id, edited, Instant::now())
            .map_err(str::to_string)?;
        let mut outcome = SendOutcome {
            drafts: &self.drafts,
            draft_id,
            sent: false,
        };
        if !still_paired(owner) {
            return Err("draft_unknown".to_string());
        }
        let sent = mail(ticket)?;
        outcome.sent = true;
        Ok(sent)
    }
}

/// Ends a draft's send however the send ends. The send can unwind, and a draft
/// left in flight would refuse every later send of it. Spent only on success.
struct SendOutcome<'a> {
    drafts: &'a Mutex<Drafts>,
    draft_id: &'a str,
    sent: bool,
}

impl Drop for SendOutcome<'_> {
    fn drop(&mut self) {
        lock(self.drafts).finish(self.draft_id, self.sent, Instant::now());
    }
}

/// **Takes the mark down however the preview ends.** A mark left behind would
/// let a later pairing change stop a picture that has already ended.
struct PreviewMark<'a> {
    bridge: &'a Bridge,
    owner: Owner,
    key: String,
}

impl Drop for PreviewMark<'_> {
    fn drop(&mut self) {
        lock(&self.bridge.answering).remove(&(self.owner, self.key.clone()));
    }
}

/// The key one preview is marked under. **Unique, because two previews of the
/// same phone must not share a mark.**
fn preview_key() -> Option<String> {
    random_hex().map(|hex| format!("preview-{hex}"))
}

impl PhoneChat for Bridge {
    fn open(&self, device: DeviceId, kind: &'static str, body: Value) -> Option<Opened> {
        let app = self.app.get()?;
        let owner = self.paired_owner(device)?;
        let request = random_hex()?;
        let asking = asking(owner, device, &body);
        let events = self.start_live(&request, kind, &asking);
        let mut payload = json!({"request": request});
        payload[kind] = body;
        payload["kind"] = json!(kind);
        // **The phone's own number, this way and not the other way.** The door
        // resolved `device` from the credential the phone authenticated with, so
        // this is not something the phone said — a phone cannot learn it, the
        // pairing seal hands back the credential and nothing else. It is told
        // here so the page can stamp this turn's browser writes with the
        // conversation only that phone may answer, and it is the one thing that
        // decides where a card is drawn. Anything the phone put in its body under
        // this name is dropped by the door before it gets here.
        payload["device"] = json!(conversation_device(&asking.conversation));
        // What that phone may reach on this computer, asked of the store as
        // this request arrives. The page offers no mail tool to a phone whose
        // switch is off, and a turn is still answered either way — a phone may
        // talk to Kalsa without reading the owner's mail.
        payload["mail"] = json!(self.mail_allowed(device));
        if app.emit(REQUEST_EVENT, payload).is_err() {
            lock(&self.live).remove(&request);
            return None;
        }
        Some(Opened { request, events })
    }

    fn stop(&self, request: &str) {
        if lock(&self.live).remove(request).is_some() {
            if let Some(app) = self.app.get() {
                let _ = app.emit(STOP_EVENT, json!({"request": request}));
            }
        }
    }

    fn send(
        &self,
        device: DeviceId,
        draft_id: &str,
        body: Option<String>,
    ) -> Result<String, String> {
        self.send_draft(device, draft_id, body)
    }

    fn mail_allowed(&self, device: DeviceId) -> bool {
        self.mail_allowed(device)
    }

    /// **A phone's answer to one of its own browser cards.** The id and the phone
    /// are checked against what this app is actually holding for that device and
    /// credential, and the answer itself is the desktop's own: same code, same
    /// spend-before-dispatch, same outcome to the model.
    fn answer_browser(&self, device: DeviceId, card_id: &str, allow: bool) -> Result<Value, String> {
        self.answer_card(device, card_id, allow)
    }

    /// **A phone's preview of the page this computer is showing.** The picture
    /// and the two facts beside it, or the code the phone reads.
    fn preview(&self, device: DeviceId) -> Result<Value, String> {
        Bridge::preview(self, device)
    }
}

/// The device a phone conversation names, or `None` for a conversation that is
/// not one. **The prefix is the whole rule**: a desktop conversation is a UUID and
/// can never begin with it, so this can only ever name a phone.
pub(crate) fn device_of(conversation: &str) -> Option<DeviceId> {
    let number = conversation.strip_prefix("phone:")?;
    number.parse().ok().map(DeviceId::new)
}

/// Whether a conversation belongs to a phone, so the window does not draw what it
/// cannot answer.
pub(crate) fn is_phone_conversation(conversation: &str) -> bool {
    cards::is_phone_conversation(conversation)
}

/// The conversation one phone's browser calls are stamped with, named in one place
/// so the window's rule and the bridge's rule cannot drift apart.
pub(crate) fn conversation_of(device: DeviceId) -> String {
    cards::conversation_of(device)
}

/// **Hands the bridge whatever the sidecar is holding.** Every card that belongs
/// to a phone goes to that phone, and one that belongs to nobody — a turn that
/// has ended, a phone that is gone — is declined rather than left waiting.
pub(crate) fn route_cards(app: &AppHandle, cards: Vec<pending::Card>) {
    let brain = app.state::<std::sync::Arc<crate::Brain>>();
    brain.phone_chat.route_cards(cards);
}

/// **A window closed with phone cards on it.** They are declined like the window's
/// own, and each phone is told, because "the window closed" is not a sentence that
/// reaches a device across the road.
pub(crate) fn decline_phones(app: &AppHandle, cards: Vec<pending::Card>) {
    let brain = app.state::<std::sync::Arc<crate::Brain>>();
    brain.phone_chat.decline_cards(cards);
}

/// What one arriving request is, decided before the app is asked to show it.
///
/// Split out of [`PhoneChat::open`] because **this is the one place a phone's
/// identity is chosen**, and it has to be provable without an app to emit into.
/// `device` is the credential's own — the door resolved it from the Bearer
/// before any body was parsed — and `body` is read for `reply_for` and for
/// nothing else. A phone cannot learn its own number (the pairing seal hands
/// back the credential and nothing else) and the door builds the turn body
/// without a `device` at all, so there is nothing here for a body to name
/// another phone with.
pub(crate) struct Asking {
    pub(crate) owner: Owner,
    pub(crate) conversation: String,
    pub(crate) reply_for: Option<u32>,
}

fn asking(owner: Owner, device: DeviceId, body: &Value) -> Asking {
    Asking {
        owner,
        conversation: conversation_of(device),
        reply_for: body
            .get("reply_for")
            .and_then(Value::as_str)
            .and_then(|id| id.parse().ok()),
    }
}

fn conversation_device(conversation: &str) -> String {
    conversation.strip_prefix("phone:").unwrap_or_default().to_owned()
}

/// **What is left of the person's five minutes for one card.** Zero is a real
/// answer, not a near miss: a card at its budget is owed nothing, and the press
/// that arrives for it is told so rather than raced.
fn budget_left(card: &Held, now: Instant) -> std::time::Duration {
    ASKED_FOR.saturating_sub(now.saturating_duration_since(card.created))
}

/// What the phone is shown for one card. **The real value crosses, with a flag
/// saying to draw it as dots** — the card is the thing the person decides on, so
/// it is drawn exactly as the desktop draws it: dots and a Show, the value in no
/// log and nowhere else. `Debug` is the reason: it is how a card reaches a panic,
/// and it prints dots.
///
/// **`answer_in_ms` is the person's budget left, counted from when the card was
/// first shown** — not an absolute time. The two clocks here are the computer's,
/// and a phone cannot read them: a phone whose clock is a day out, or half an
/// hour out, would read a wall-clock deadline as either already past or not yet
/// arrived. So what crosses is a duration, and the phone counts it down from the
/// moment the card arrived, which is the only moment it knows for certain.
/// `asked_at_ms` stays for the window's own drawing and for logs, where the
/// computer's clock is the right one.
fn card_wire(card: &Held) -> Value {
    let left = ASKED_FOR.saturating_sub(card.created.elapsed());
    json!({
        "card_id": card.id,
        "method": card.method,
        // **The address, whole, for a phone that parses it. And the destination,
        // for a phone that does not**: one machine said where this goes, and a
        // phone shows what it was told rather than working it out. `url` stays
        // for the phones that know no better (docs §3.1).
        "url": card.url,
        "destination": card.destination,
        "fields": card.fields,
        "asked_at_ms": pending::now_ms(),
        "answer_in_ms": left.as_millis() as u64,
    })
}

/// What became of a card, and nothing else: a code from the desktop's own closed
/// set, and a host already reduced to a bare name. No sentence is sent — the
/// phone writes its own, out of these two things.
fn outcome_wire(card_id: &str, code: &str, host: Option<&str>) -> Value {
    let mut wire = json!({"card_id": card_id, "code": code});
    if let Some(host) = host {
        wire["host"] = json!(host);
    }
    wire
}

/// The page's event, as the page sends it.
#[tauri::command]
pub(crate) fn brain_phone_chat_event(
    brain: State<'_, std::sync::Arc<crate::Brain>>,
    request: String,
    event: String,
    data: Value,
) -> Result<(), String> {
    brain
        .phone_chat
        .accept(&request, &event, data)
        .map_err(str::to_string)
}

/// Sixteen random bytes as lowercase hex: a request id, or a draft id.
fn random_hex() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// The digest that stands for a credential in the drafts table. The credential
/// itself is never kept here.
fn digest(credential: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"kalsa-phone-identity-v1");
    hasher.update(credential.as_bytes());
    hasher.finalize().into()
}

/// A panic in one request's handling must not silence every other request.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
