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
    "error",
    "done",
];

/// The events that end their request. The request is retired after one, so a
/// later event for it is dropped.
const ENDING: &[&str] = &["read", "error", "done"];

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

/// What the model is told about a card nobody answered. The same word the
/// desktop's own expiry uses, so one model reads one set of sentences.
pub(crate) const EXPIRED_OUTCOME: &str = "expired";

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
        for card in dropped {
            // **The sidecar is told, not just the phone.** The hold lives there,
            // and it is the only thing that can let the request go: without this
            // a forgotten phone's card sits in the sidecar for the rest of its
            // five minutes with nobody left to press it, and the model's own
            // outcome list never learns that it was declined. So the decline goes
            // down the sidecar's own path — which drops the hold and settles the
            // model-facing outcome in the conversation that raised it — and the
            // phone is told as well.
            self.decline_at_the_sidecar(&card, UNPAIRED);
        }
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
        *lock(&self.paired) = owners;
    }

    /// **Asks the sidecar to let one of a phone's held requests go.**
    ///
    /// The hold is the sidecar's and only the sidecar can drop it, so the decline
    /// goes down the same road a person's own "no" goes down — which is also what
    /// puts the outcome in the store the model reads, in the conversation that
    /// raised the card. **The phone is not told**, and that is the point of the
    /// callers: every one of them is a case where the phone has no card to take
    /// down — a write refused before it was ever drawn, a phone that has just been
    /// unpaired — so an outcome would be a frame about an id this phone never
    /// held. A window that closed under a live card is the one case the phone
    /// does need, and that goes through [`Bridge::tell_phone`] instead.
    ///
    /// Best-effort: a sidecar that is gone cannot be asked, and the card was
    /// held and nothing was let through either way, which is the truth.
    fn decline_at_the_sidecar(&self, card: &Held, why: &'static str) {
        if let Some(app) = self.app.get() {
            let state = app.state::<BrowserState>();
            // Blocked on, not awaited: this runs from the reconcile thread, which
            // is not one of ours, exactly as an answer is dispatched.
            tauri::async_runtime::block_on(async {
                crate::browser::confirm::decline_one(app, &state, &card.id, &card.conversation, why).await
            });
        }
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
    fn start_live(
        &self,
        request: &str,
        device: DeviceId,
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
            self.tell_model(&card, EXPIRED_OUTCOME);
        }
        for card in cards {
            let Some(device) = device_of(&card.conversation) else {
                continue;
            };
            let Some(owner) = self.paired_owner(device) else {
                continue;
            };
            // The card goes to the turn that raised it. A turn that has ended has
            // no socket left to carry it, and the sidecar's own five minutes will
            // decline it: **no phone means no card, and no card means nothing is
            // sent.** The model is told, so it is not left believing the write is
            // still waiting.
            let Some(request) = self.request_of(owner, &card.conversation) else {
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
                let held = Held {
                    owner,
                    conversation: card.conversation,
                    request,
                    id: card.id,
                    method: card.method,
                    url: card.url,
                    fields: card.fields,
                    created: now,
                };
                self.decline_at_the_sidecar(&held, TOO_MANY);
                continue;
            }
            let held = Held {
                owner,
                conversation: card.conversation.clone(),
                request,
                id: card.id.clone(),
                method: card.method.clone(),
                url: card.url.clone(),
                fields: card.fields.clone(),
                created: now,
            };
            if lock(&self.cards).note(held.clone(), now) {
                self.send_card(&held);
            }
        }
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
        // **The queue is a phone's inbox, not a store.** It is a run of outcomes
        // for cards that phone is no longer drawing, so it is bounded the way a
        // screen is: when it is full the oldest goes, because the newest is the
        // one about the card it last saw. Nothing is dropped silently — every
        // outcome in it is about a card the person can no longer answer, and the
        // computer's own five minutes has already settled all of them.
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
                // **The card is spent and no answer came back**, which is the
                // window's own case: unclear to the person and to the model, and
                // never retried.
                crate::browser::confirm::Dispatch::Answered(Err(refused)) => {
                    crate::browser::confirm::answer_failed(app, &state, &id, &conversation).await;
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
                self.report(&held, crate::browser::confirm::UNCLEAR, None);
                return Err(code);
            }
        };
        self.report(&held, &code, host.as_deref());
        Ok(outcome_wire(&held.id, &code, host.as_deref()))
    }

    /// Tells the phone what became of its card.
    fn report(&self, card: &Held, code: &str, host: Option<&str>) {
        self.tell_phone(card, code, host);
    }

    /// **Tells the model, through the same per-conversation note the desktop's own
    /// outcomes ride.** Used only where no answer path already said it — a card
    /// that expired, a phone that unpairs — because an outcome nobody hears is an
    /// outcome a model goes on believing has not happened.
    fn tell_model(&self, card: &Held, code: &str) {
        if let Some(app) = self.app.get() {
            let _ = app.emit(
                crate::browser::confirm::ANSWERED,
                crate::browser::confirm::Answered {
                    id: card.id.clone(),
                    conversation: card.conversation.clone(),
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

impl PhoneChat for Bridge {
    fn open(&self, device: DeviceId, kind: &'static str, body: Value) -> Option<Opened> {
        let app = self.app.get()?;
        let owner = self.paired_owner(device)?;
        let request = random_hex()?;
        let asking = asking(owner, device, &body);
        let events = self.start_live(&request, device, kind, &asking);
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
        "url": card.url,
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
