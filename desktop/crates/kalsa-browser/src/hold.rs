//! What a request that passed the guard may do next (one responsibility: the
//! write that is held, the card that shows it, and the one answer that spends it).
//!
//! Data channels follow normal browser behavior unless recorded-secret
//! protection requires this hold. Intercepted submissions retain confirmation.
//!
//! **The call does not wait for the person.** The MCP deadline is 60 s and a
//! person is slower than that, so a held request is answered with its id at once
//! and the answer comes as a separate call. That is why this is a store and not
//! a field on a call: a route outlives the call that made it.
//!
//! **The id is spent before dispatch, on either answer, and never retried.** A
//! press that landed and an answer that never arrived is reported as ambiguous,
//! because a second attempt is a second message to a stranger's server.
//!
//! **Nothing is held across a call.** The mutex is taken to move a held request
//! in or out and given back before the route is dispatched.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::future::BoxFuture;
use tokio::sync::Mutex;

use playwright_rs::protocol::{Request, Route};

use crate::body::{self, Field};
use crate::label;

/// One field of a card. Re-exported because the card is public and a caller
/// reading it is reading fields.
pub use crate::body::Field as CardField;

/// How long a held request waits for a person. Past this it is declined and told
/// so: a request nobody answered is not one we may send later.
pub(crate) const EXPIRY: Duration = Duration::from_secs(300);

/// **How long the driving of a confirmed submission waits for the navigation
/// that follows it.** A server that answers with a redirect sends it as soon as
/// it has the answer, so this is generous rather than tight — and it is a bound
/// all the same, because a window the person cannot take back is worse than a
/// receipt that arrives a moment late.
const REDIRECT_WINDOW: Duration = Duration::from_secs(2);

/// **How long the driving of a confirmed submission waits for the answer to the
/// request the person approved.** The request is in flight until the server
/// answers, and a navigation in flight is ours. **Bounded**, because a server
/// that never answers must not hold the window for ever.
const ANSWER_WINDOW: Duration = Duration::from_secs(10);

/// **The prefix a phone's claim carries.** A desktop's conversation is a plain
/// name and never carries it, and that is what tells the two apart.
const PHONE: &str = "phone:";

/// **The claim a phone's turn makes on the page: the phone's own number, the
/// pairing it belongs to, and the turn's own id.**
///
/// **The split lives here and nowhere else.** Two crates read this string — the
/// brain that builds it and this crate that rules on it — and a rule kept in two
/// places is a rule that will be read two ways.
///
/// **Neither half may hold a colon**, so the three parts can be told apart:
/// the number and the pairing are digits and hex, and the turn is a request id.
pub fn phone_claim(device: &str, pairing: &str, turn: &str) -> String {
    format!("{PHONE}{device}:{pairing}:{turn}")
}

/// **The name of a phone's conversation: the phone alone.**
pub fn phone_conversation(device: &str) -> String {
    format!("{PHONE}{device}")
}

/// **Whether a name belongs to a phone.** A phone's conversation and a phone's
/// claim both carry the prefix; a desktop's conversation never does.
pub fn is_phone(name: &str) -> bool {
    name.starts_with(PHONE)
}

/// **Whether two claims are the same phone's.**
///
/// **The phone and the pairing together are what may take a claim over; the turn
/// is what the claim is of.** A device id is reused once the top one is
/// forgotten, so the id alone cannot tell the old phone from the next one
/// paired under it — and a claim that carried only the id would be taken over by
/// that next phone, which would then read the page the old one left claimed. So
/// the pairing is part of the name, and a claim of another pairing is nobody's
/// to take. A desktop's conversation is nobody's phone, so no desktop's claim is
/// ever taken over by anything.
pub fn same_phone(one: &str, other: &str) -> bool {
    match (parts_of(one), parts_of(other)) {
        (Some((device, pairing)), Some((other_device, other_pairing))) => {
            device == other_device && pairing == other_pairing
        }
        _ => false,
    }
}

/// **The phone and the pairing a claim names, when it names both.**
fn parts_of(name: &str) -> Option<(&str, &str)> {
    let (device, rest) = name.strip_prefix(PHONE)?.split_once(':')?;
    let (pairing, _turn) = rest.split_once(':')?;
    if device.is_empty() || pairing.is_empty() {
        return None;
    }
    Some((device, pairing))
}

/// The future that dispatches or drops a held request. What the browser does
/// with one is the caller's business; what this store does with it — once, and
/// only once — is its own.
///
/// **It answers whether it went.** A write taken out of the page and put back
/// later has to find the page again to be sent, and a page that has moved on
/// cannot be. That is not a failure to retry: it is reported as ambiguous,
/// because a second attempt is a second message to a stranger's server.
pub(crate) type Answering = Box<dyn FnOnce(bool) -> BoxFuture<'static, bool> + Send>;

/// The card a person reads: the request itself, and nothing that is not.
#[derive(Clone, PartialEq, Eq)]
pub struct Card {
    /// What the person is asked about, and what an answer quotes.
    pub id: String,
    pub method: String,
    pub url: String,
    pub fields: Vec<Field>,
    /// The conversation that caused the write. **Set by the store when it holds
    /// the card**, never by the caller: an id that chose its own conversation
    /// would be an id that could be asked in the wrong chat.
    pub conversation: String,
    /// Where it goes, computed by [`destination_of`] when the card is built.
    /// **`None` is a card with no destination**, and a card with no destination
    /// cannot be sent: there is nothing for a person to be agreeing to.
    pub destination: Option<Destination>,
}

/// **A secret is not printed here either.** The address on a card can carry one —
/// a GET held for exactly that reason — and `Card` is the thing a log line, a
/// panic or a failing test reaches first. So it is printed with every secret
/// value in the address replaced by dots, which is the card as the window draws
/// it. `Serialize` is what carries the real one, to the person and nowhere else.
impl std::fmt::Debug for Card {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Card")
            .field("id", &self.id)
            .field("method", &self.method)
            .field("url", &masked_address(&self.url, &self.fields))
            .field("fields", &self.fields)
            .field("conversation", &self.conversation)
            .field("destination", &self.destination)
            .finish()
    }
}

/// An address with every value the card marks as a secret replaced by dots.
fn masked_address(url: &str, fields: &[Field]) -> String {
    let Ok(parsed) = url::Url::parse(url) else {
        return url.to_owned();
    };
    let mut masked = parsed.clone();
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    for (name, value) in parsed.query_pairs() {
        let secret = fields.iter().any(|field| field.name == *name && field.secret);
        query.append_pair(&name, if secret { crate::body::DOTS } else { &value });
    }
    let query = query.finish();
    masked.set_query(if query.is_empty() { None } else { Some(&query) });
    // **What masking could not do by name is caught at the end anyway.** A secret
    // in the path, or a value the query spelled differently, is in no pair this
    // loop could replace — and a card is what a log line, a panic or a failing
    // test reaches first. So the address is read once more, and one that still
    // carries a value of a field marked secret is printed as dots in one piece:
    // a log line that says nothing about where the address went is worth more
    // than one that holds somebody's password.
    let printed = masked.to_string();
    if fields
        .iter()
        .filter(|field| field.secret && !field.value.is_empty())
        .any(|field| printed.contains(&field.value))
    {
        return crate::body::DOTS.to_owned();
    }
    printed
}

/// What became of a held request once it was answered, expired, or went away.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Outcome {
    /// The person said yes and it was dispatched. **The host, not the address:**
    /// a path or a query on a stranger's site is theirs, and an outcome is a
    /// thing that reaches the model and then a disk.
    Sent { host: String },
    /// The person said no. Nothing was sent, and the page is as it was.
    Declined,
    /// Nobody answered in time. Nothing was sent.
    Expired,
    /// The window went while it waited. Nothing was sent.
    Gone,
    /// A body the person cannot be shown. Nothing was sent, and this is why.
    Unrenderable(String),
    /// The press landed and the answer never came back. **Never retried.**
    Ambiguous,
}

impl Outcome {
    /// **What happened, in one word.**
    ///
    /// This is the whole of what crosses into the app. Everything else about an
    /// outcome — the sentence the model reads, the line the person is shown — is
    /// built from this code and a validated host, by whoever shows it, out of
    /// their own words. Nothing a stranger's server wrote is ever carried across
    /// that line, and a note cannot be a page's sentence with our punctuation on
    /// the end of it.
    pub fn code(&self) -> &'static str {
        match self {
            Outcome::Sent { .. } => "sent",
            Outcome::Declined => "declined",
            Outcome::Expired => "expired",
            Outcome::Gone => "gone",
            Outcome::Unrenderable(_) => "unsendable",
            Outcome::Ambiguous => "unclear",
        }
    }

    /// The host of the request that was sent, and only the host: parsed, never
    /// trimmed out of a string, so a path, a query, a port or a fragment cannot
    /// ride here however the page wrote the address.
    pub fn host(&self) -> Option<&str> {
        match self {
            Outcome::Sent { host } => Some(host.as_str()),
            _ => None,
        }
    }

    /// The sentence the model reads. It says what happened and never repeats a
    /// payload: the model is told a request existed, never what it carried.
    pub fn sentence(&self) -> String {
        match self {
            Outcome::Sent { host } => format!("The request you asked about was sent by the person: {host}."),
            Outcome::Declined => {
                "The person did not allow the request you asked about, so nothing was sent and the page is as it was.".to_owned()
            }
            Outcome::Expired => {
                "Nobody answered the request you asked about, so it was declined and nothing was sent.".to_owned()
            }
            Outcome::Gone => {
                "The browser window closed before the request you asked about was answered, so nothing was sent.".to_owned()
            }
            Outcome::Unrenderable(why) => format!("No request was sent: {why}, so the person was never asked about it."),
            Outcome::Ambiguous => {
                "Whether the request you asked about was sent could not be established. It has not been tried again.".to_owned()
            }
        }
    }
}

/// The host of an address, or nothing at all when it has none to give.
///
/// **Parsed, never cut.** Taking the text up to the first `/` or `?` is what puts
/// a stranger's path — and whatever they wrote in the query — into a sentence that
/// a model reads. A URL parser returns the host or it fails; there is no version
/// of this that hands back half an address.
pub fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url).ok()?.host_str().map(str::to_owned)
}

/// What a yes is told when the card named nowhere to go. Said to the model, in
/// the plain line every other refusal uses, and to the person by whatever window
/// they are looking at — a sentence is not the thing that stops this; the button
/// being gone is. It is here so the two do not say different things.
pub const NOWHERE: &str =
    "the request goes somewhere this computer cannot name, so there was nothing to confirm and nothing was sent";

/// **Where a held request goes, said once by the machine that will send it.**
///
/// Three fields and nothing else: the host in the form the resolver is given —
/// **ASCII, punycode where it has to be, lower case** — the port when it is not
/// the scheme's own default, and whether the connection is the secure one. No
/// scheme name, no user, no path, no query.
///
/// **This exists because two parsers of the same address are two answers.** The
/// sidecar sends what the page asked for; a window on the far end of a phone
/// then works out what host that is, by hand, from the text. A hand-written rule
/// and the browser's own disagree about a backslash, an extra `@` or a space —
/// and a card showing one host over a request going to another is the one card
/// that must never exist. So the host is computed **here**, by the parser the
/// browser itself uses, and every window is shown the same three fields.
///
/// **`None` is a real answer.** An address that names no host cannot be parsed
/// into one, and a card with nothing to show is not a card anybody may press
/// "send" on: there is no destination to agree to. A decline is still allowed,
/// because dropping a request needs no destination at all.
#[derive(Clone, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    pub host: String,
    /// `None` when the address does not name a port, or names the one its own
    /// scheme would use anyway — which is what makes "not the default" a fact
    /// about the scheme rather than a comparison done by whoever is reading it.
    pub port: Option<u16>,
    /// Whether the connection is encrypted: `https`, or nothing else.
    pub secure: bool,
}

/// **One parser, one answer.** The `url` crate follows WHATWG, which is what the
/// browser follows, so the host here is the host the request will actually go
/// to — punycode for an international name, the part before the last `@`, and
/// nothing at all for a backslash that WHATWG reads as a path separator.
///
/// The port is the one the parser already dropped as the scheme's default: a
/// reader never has to know what a scheme's default is, and a card cannot show
/// `shop.example:443` for an address that simply reads `shop.example`.
pub fn destination_of(url: &str) -> Option<Destination> {
    let parsed = url::Url::parse(url).ok()?;
    Some(Destination {
        // **Lower case, because a host is not case sensitive and two spellings
        // of one host are one destination.** `host_str` is already ASCII —
        // punycode where the address was written in anything else.
        host: parsed.host_str()?.to_ascii_lowercase(),
        port: parsed.port(),
        secure: parsed.scheme() == "https",
    })
}

/// What a host-only answer got back.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Answer {
    /// The id was held, and has now been spent.
    Spent(Outcome),
    /// No such id: never held, already spent, or expired. A second press lands
    /// here, which is what makes an answer single-use.
    Unknown,
}

/// A request waiting, the card that describes it, and when it started.
struct Held {
    card: Card,
    began: Instant,
    answer_it: Answering,
}

/// One outcome and the conversation that caused it.
type Settled = (String, Outcome);

/// **The driving of the window, and the name that tells two of them apart.**
///
/// **The name is what makes a release conditional.** Two submissions of one chat
/// are two drivings, and the conversation alone cannot say which is which: a
/// watch that ends late must let go of the driving that is still its own, and
/// never of the one that has taken the window since.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Driver {
    conversation: String,
    token: u64,
}

/// **The window's own state, in one lock and one place.**
///
/// **Three things that have to be read and written without awaiting, and that
/// have to agree with each other.** Who is driving the window, how many
/// main-frame navigations the route has seen, and the one write already
/// answered — the ticket a confirmed submission is let past on.
///
/// **One lock, and not two.** The count and the owner are read together: a
/// navigation counted as ours and then found nobody's is a page that lost its
/// owner between one look and the next, and a release that lands between the
/// two is exactly how that happened. The ticket is here for the same reason the
/// release is: **a `Drop` cannot await**, so the thing a guard has to take back
/// has to be in a cell a guard can reach without waiting for anybody.
#[derive(Default)]
struct Window {
    /// **Who is driving the window right now**, and nobody at all when no call
    /// of ours is.
    driver: Option<Driver>,
    /// **How many main-frame navigations the route has seen.** It is what tells
    /// a confirmed submission's own navigation from the one that follows it: a
    /// server may answer the request the person approved with a redirect, and
    /// that redirect is a second navigation the browser makes on its own.
    ///
    /// **Counted here rather than in the landings**, because the question this
    /// count answers is about the *route* — it is the route that sees a
    /// navigation, and the route is what has to say whether that navigation
    /// was ours.
    navigations: u64,
    /// **The one write already answered**, which the route is to let past rather
    /// than hold again. **Exactly one, matched on the whole request, and spent
    /// on first use** — see [`Ticket`]. **And the duty of ending the driving it
    /// belongs to**, so that the watch the route starts is the watch that holds
    /// the right to let go of it.
    pass: Option<Pass>,
}

/// **The duty of letting go of the driving, and the right to do it once.**
///
/// **Shared, because the duty passes.** The call that drives the window and the
/// watch that ends it are two things, and the duty is one: the call arms it
/// into the ticket, the route hands it to the watch it starts, and the watch is
/// what lets go of the driving. Exactly one of them lets go — the other is
/// told the duty is not its own any more — and **the watch's own guard is what
/// lets go of it when the watch dies before it has**.
///
/// **And the duty knows the driving it is about.** A release is conditional on
/// the name: the watch of a submission that has already been overtaken finds the
/// window driving somebody else's submission, and leaves it alone.
///
/// **Shared by an `Arc`, and not copied.** The flag inside says whether the
/// driving has been let go, and two copies of the flag would be two answers to
/// the same question.
#[derive(Debug)]
pub struct Duty {
    /// **The name of the driving this duty is about.** Two submissions of one
    /// chat are two drivings, and the conversation alone cannot tell them apart.
    token: u64,
    /// **Whether the driving has been let go.** One duty, one release: two
    /// guards share this duty and only the first to let go does anything.
    released: std::sync::atomic::AtomicBool,
}

impl Duty {
    /// **Lets go of the driving — if this duty is still the one driving.**
    ///
    /// **Once, and only for the driving it is about.** The flag says the duty
    /// is spent, so the second guard to let go does nothing; and the name says
    /// whose driving it was, so a watch that ends late does not take the window
    /// away from the submission that has it.
    fn let_go(&self, holds: &Holds) {
        if self.released.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        holds.let_go_of(self.token);
    }
}

/// **What a confirmed submission is waiting for: the duty that ends it, and the
/// navigation it starts from.**
///
/// **One per submission.** Two submissions can overlap — the watch of the first
/// is still waiting when the second is confirmed — and each has to wait for its
/// own navigation: a watch that read a shared count would wait from the other's
/// baseline, and the one that ended first would take the driving away from the
/// one still waiting.
#[derive(Clone, Debug)]
pub struct Approved {
    /// **The duty of ending the driving this submission owns.** The watch holds
    /// it, so the watch is what lets go of the driving — and what lets go of it
    /// when it dies before it has.
    duty: Arc<Duty>,
    /// **The navigation count this submission started from.** The watch waits
    /// for the navigation that follows it, and for that one only.
    baseline: u64,
}

/// The one write already answered, and the duty of ending the driving it
/// belongs to.
struct Pass {
    ticket: Ticket,
    duty: Arc<Duty>,
    /// **Whether the route has taken this pass.**
    ///
    /// **Set under the lock that takes the pass out, and read under it too.**
    /// From the moment the route spends the ticket the duty belongs to the
    /// watch it starts, and a guard that let go of it here would take the window
    /// away from the submission that has it. A flag read outside the lock could
    /// miss a pass that was being spent at that very moment.
    taken: Arc<std::sync::atomic::AtomicBool>,
}

/// **The armed pass, and the driving it is armed for.**
///
/// **The pass lives under this guard, and the guard is what takes it back.** The
/// ticket is armed for one driving, and the route may spend it at any moment —
/// so a call that is cut short between arming the ticket and spending it must
/// not leave the ticket armed: a later request that matches it would go
/// through without a new approval, and the person would never have been asked.
///
/// **So the guard's drop does two things, and the second one is a "not".**
/// * **If the ticket was never spent**, the guard takes it back — the answer is
///   thrown away — and lets go of the driving, because nobody else owns it.
/// * **If the ticket was spent**, the duty belongs to the watch the route
///   started, and the guard leaves it alone: the watch is what ends the
///   driving, and the watch is what lets go of it.
///
/// **And both are decided under one lock.** Whether the ticket was spent and
/// what is left of it are one fact, read together with the store's own answer —
/// a guard that read the flag on its own could see a pass that was being spent
/// right now, and let go of a driving the watch owns.
pub struct Armed {
    holds: Holds,
    /// **The driving this pass is armed for.** It is the guard that lets go of
    /// the window, and it is here so that the decision about whether to let go
    /// of it is made in one place.
    driving: Option<Driving>,
    /// **Whether the route has taken the ticket.** The same flag the pass
    /// carries, so that the two of them cannot disagree.
    taken: Arc<std::sync::atomic::AtomicBool>,
}

impl Drop for Armed {
    fn drop(&mut self) {
        let Some(driving) = self.driving.take() else {
            return;
        };
        if self.holds.take_the_pass_back(&driving.duty, &self.taken) {
            // **The route spent the ticket**: the watch it started owns the
            // driving now, and the watch is what lets go of it. A guard that
            // let go of it here would take the window away from the submission
            // that has it.
            driving.hand_over();
            return;
        }
        // **The ticket was never spent**: it is thrown away — so that a later
        // request that matches it does not go through without a new approval —
        // and the driving is still ours, because nobody else will let go of it.
        // Dropping the guard is what lets go of it.
        drop(driving);
    }
}

#[derive(Default)]
struct Inner {
    /// In the order they were held: the newest is last, which is the one a call
    /// that just acted is waiting to hear about.
    held: Vec<Held>,
    /// What the model has not been told yet, carried on its next tool result:
    /// it cannot act on an answer before it acts at all.
    /// Every outcome, each with the conversation it belongs to. **Kept whole**
    /// until the conversation that caused it comes back for it, because an
    /// outcome drained by whoever happens to be calling next is an outcome in the
    /// wrong chat.
    outcomes: Vec<Settled>,
    /// The conversation whose call is **running right now**. A request we caused
    /// — a click, a fill — belongs to it.
    calling: String,
    /// The conversation of the call that last **navigated this page**, captured
    /// when it did. A request the page makes by itself, later, belongs to this:
    /// its document was written by that call, and the page cannot say otherwise.
    navigated: String,
    /// What the page calls its named fields, read by the call that last acted, and the
    /// address of the document they were read from. A write is labelled from these only
    /// while its own document is still that one; see `label.rs`.
    labels: Option<PageLabels>,
    /// What the person typed into a secret field on the page in this window. The
    /// window's own state rather than a side table, so **opening another address
    /// forgets it** and a secret typed on one site cannot mask — or hold — a
    /// request on another.
    typed: crate::secret::Typed,
}

/// What the page was read to say about its fields, and the address it was read from.
#[derive(Clone)]
struct PageLabels {
    url: String,
    labels: HashMap<String, String>,
}

/// The held writes, keyed by the id the card shows. Cheap to clone and cloned
/// into the route handler, which outlives the call that installed it.
#[derive(Clone)]
pub struct Holds {
    inner: Arc<Mutex<Inner>>,
    /// What time it is, as a function so a test can move it.
    now: Arc<dyn Fn() -> Instant + Send + Sync>,
    /// **Pausa belongs to the window, not to one page.** It is a separate cell
    /// for that reason: a person can press it before the browser has opened
    /// anything at all, and a page that starts afterwards has to find the window
    /// already paused. The same window's `Sessions` writes this cell and every
    /// `Holds` it ever hands out reads it, so there is one answer to "is this
    /// paused" rather than one per page that could disagree.
    paused: Arc<std::sync::atomic::AtomicBool>,
    /// **Who is driving the window right now.** Its own cell, and not a field
    /// of `Inner`, for one reason: **it has to be let go without awaiting.** A
    /// call that panics unwinds, and the release has to happen on that way out
    /// too — see [`Driving`], which is what lets go of it.
    ///
    /// A plain lock, and not the store's own: the store is behind an async
    /// mutex, and a `Drop` cannot await one.
    ///
    /// **And it carries the name of the driving, not only the conversation.**
    /// Two submissions of one chat are two drivings, and a release that is not
    /// conditional on the name would take the window away from the submission
    /// that has it — see [`Holds::let_go_of`].
    ///
    /// **The navigation count and the armed ticket are in it too**, because both
    /// have to be read and written without awaiting as well, and because the
    /// count and the owner have to be read together — see [`Window`].
    window: Arc<std::sync::Mutex<Window>>,
    /// **The names of the drivings of this window.** A counter, and it is what
    /// tells two of them apart: the conversation alone cannot, because two
    /// submissions of one chat are two drivings.
    tokens: Arc<std::sync::atomic::AtomicU64>,
    /// **A test's gate, between the count of a navigation and the judgment of
    /// who owns the page.**
    ///
    /// It exists so a proof can put a release exactly where the two used to be
    /// apart: the count on one side of it, the owner on the other. With the two
    /// under one lock, a release that arrives at the gate cannot get between
    /// them — and a proof that says so is a proof about the lock and not about
    /// a lucky ordering.
    #[cfg(test)]
    gate: Arc<std::sync::Mutex<Option<Box<dyn Fn() + Send + Sync>>>>,
}

impl Default for Holds {
    fn default() -> Self {
        Self::new()
    }
}

/// **The promise that the call driving the window will let go of it.**
///
/// **The release is on every way out of the call** — the answer it gave, the
/// error it hit, the panic it took, the wait that was cut short — because the
/// person has the window back only when nobody is driving it. A release that
/// ran only on the happy path left the window ours after a panic: the next
/// navigation the person made was then read as ours, the page they had opened
/// by hand stayed ours, and a phone was shown a picture of it.
///
/// The guard drops on a panic too — that is what a `Drop` is for — and it is
/// the only thing that lets go of the driving, so a call cannot end by
/// accident and leave the window driven.
///
/// **And the release is conditional, and it is once.** The duty it carries says
/// which driving it is about, so a guard that is left over from a submission
/// that has been overtaken does not take the window away from the one that has
/// it; and two guards that share a duty let go of it once between them.
pub struct Driving {
    holds: Holds,
    /// **The duty of letting go of the driving.** Shared with the watch that
    /// ends it, so that exactly one of the two lets go of it.
    duty: Arc<Duty>,
    /// Whether this guard may still let go. A guard that has let go already, or
    /// that has handed the duty over, does not.
    may_let_go: bool,
}

impl Driving {
    /// **Lets go of the driving now.** The call is done with the window and the
    /// person has it back.
    pub fn release(mut self) {
        self.may_let_go = false;
        self.duty.let_go(&self.holds);
    }

    /// **Hands the driving to the watch that ends it.**
    ///
    /// A confirmed submission is answered with a navigation that is ours too,
    /// and that navigation is not this call's to release: the thing that waited
    /// for it does that. So the guard gives up the right to release and keeps
    /// the driving as it is.
    ///
    /// **The duty is already with the watch, and this is what says so.** The
    /// ticket is armed with the duty — the route spends it and hands it to the
    /// watch it starts — so the watch that ends the driving is the one that
    /// holds the right to end it, and a watch that dies before it has lets go
    /// of the driving on its way out. A guard that was only disarmed here would
    /// leave the window driven for ever when that watch died.
    pub fn hand_over(mut self) {
        self.may_let_go = false;
    }
}

impl Drop for Driving {
    fn drop(&mut self) {
        if self.may_let_go {
            self.duty.let_go(&self.holds);
        }
    }
}

impl Holds {
    pub fn new() -> Self {
        Self::of_one_window()
    }

    /// A store of holds bound to a window's own pause, so a pause pressed
    /// before the window started is the pause the first page finds.
    pub fn bound_to(paused: Arc<std::sync::atomic::AtomicBool>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            now: Arc::new(Instant::now),
            paused,
            window: Arc::new(std::sync::Mutex::new(Window::default())),
            tokens: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            #[cfg(test)]
            gate: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    fn of_one_window() -> Self {
        Self::bound_to(Arc::new(std::sync::atomic::AtomicBool::new(false)))
    }

    /// The held writes, with the clock the caller supplies. **Only a test has
    /// any reason to name one**, and the one it names is the only thing that
    /// makes five minutes something a test can watch.
    #[cfg(test)]
    pub fn on_a_clock(now: impl Fn() -> Instant + Send + Sync + 'static) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            now: Arc::new(now),
            paused: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            window: Arc::new(std::sync::Mutex::new(Window::default())),
            tokens: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            #[cfg(test)]
            gate: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    /// **Names the call that is running now.** Every request it causes carries
    /// that id, and an answer that does not quote it finds nothing: a card raised
    /// in one chat cannot be pressed in another, and a note cannot land in a
    /// conversation that never asked for the request.
    pub async fn in_conversation(&self, conversation: &str) {
        self.inner.lock().await.calling = conversation.to_owned();
    }

    /// **Puts back both stamps a claim overwrote and then never made.** An open
    /// that failed did not move the window: the page keeps the owner it had, and
    /// the last actor goes back to whoever it was. [`Holds::claim_for_turn`]
    /// writes both, so this writes both.
    pub async fn restore_stamps(&self, navigated: &str, calling: &str) {
        let mut inner = self.inner.lock().await;
        inner.navigated = navigated.to_owned();
        inner.calling = calling.to_owned();
    }

    /// **Takes the page for a turn's open, or says whose it is — in one step.**
    /// The owner is read and the page is stamped under the same lock, so no other
    /// call can take the page between the check and the claim. A page another
    /// conversation holds is refused with `None`, and nothing is written.
    /// Otherwise the page and the last actor are the caller's, and the stamps the
    /// claim replaced come back, so an open that never lands can give them back.
    ///
    /// **A phone may take over a claim of its own from a turn that has ended.**
    /// The door allows one live turn per phone, so a claim of this phone's
    /// belongs to a turn that is over — and a release that never came is not a
    /// claim anybody else may hold: without this, a lost release would lock the
    /// phone out of its own page for the rest of the pairing. Another phone's
    /// claim, and a desktop's, are still refused.
    pub async fn claim_for_turn(&self, conversation: &str) -> Option<(String, String)> {
        let mut inner = self.inner.lock().await;
        let held_by_another = !inner.navigated.is_empty()
            && inner.navigated != conversation
            && !same_phone(&inner.navigated, conversation);
        if held_by_another {
            return None;
        }
        let replaced = (inner.navigated.clone(), inner.calling.clone());
        inner.navigated = conversation.to_owned();
        inner.calling = conversation.to_owned();
        Some(replaced)
    }

    /// **Says that one of our calls is driving the window right now**, and hands
    /// back the promise that it will let go.
    ///
    /// The call that opens a page, clicks on it or fills a field is the reason
    /// the main frame moves, and a navigation it causes is ours: the page stays
    /// the conversation's. The call says when it is done, and what happens to
    /// the window after that is the person's.
    ///
    /// **The release is the guard's, and not the call's.** A call that ended
    /// without releasing — because it returned early, because it failed, or
    /// because it panicked — left the window ours for ever: the next
    /// navigation the person made was then read as ours, the page they had
    /// opened by hand stayed ours, and a phone was shown a picture of it.
    ///
    /// **And every driving has a name.** The name is what a later release is
    /// conditional on, and two submissions of one chat are two drivings: the
    /// watch of the first one must not take the window away from the second.
    pub fn drive(&self, conversation: &str) -> Driving {
        let token = self.tokens.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let driver = Driver { conversation: conversation.to_owned(), token };
        self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).driver = Some(driver);
        Driving {
            holds: self.clone(),
            duty: Arc::new(Duty { token, released: std::sync::atomic::AtomicBool::new(false) }),
            may_let_go: true,
        }
    }

    /// **Lets go of the driving — if the window is still driven by that one.**
    ///
    /// **Conditional, and that is the whole of it.** Two submissions can
    /// overlap: the watch of the first one ends while the second is still
    /// waiting for its answer, and a release that was not conditional would
    /// take the driving away from the one that has it. The navigation the
    /// second submission is waiting for would then lose its owner, and the page
    /// it lands on would belong to nobody.
    ///
    /// **Not awaited, because a `Drop` cannot await.** This is the release the
    /// guard makes, and the guard is what makes it on every way out.
    ///
    /// **And it is the same lock the navigation count is counted under**, so a
    /// release cannot land between a navigation being counted and the owner
    /// being read — see [`Holds::a_main_frame_navigation`].
    fn let_go_of(&self, token: u64) {
        let mut window = self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if window.driver.as_ref().is_some_and(|driver| driver.token == token) {
            window.driver = None;
        }
    }

    /// **Who is driving the window right now**, and nobody at all when no call
    /// of ours is.
    pub fn driving_now(&self) -> Option<String> {
        self.window
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .driver
            .as_ref()
            .map(|driver| driver.conversation.clone())
    }

    /// **The name of the driving, if there is one.** A test's tool: the name is
    /// what tells two drivings apart, and nothing the person reads says so.
    #[cfg(test)]
    pub fn driving_owner(&self) -> Option<u64> {
        self.window
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .driver
            .as_ref()
            .map(|driver| driver.token)
    }

    /// **Lets a turn's claim on the page go — when the claim is still its own.**
    /// Both stamps go: the conversation that opened the page, and the one acting
    /// on it, so the page is left belonging to nobody and the next turn may take
    /// it.
    ///
    /// **The name is what makes the release safe.** The claim belongs to the turn
    /// that opened the page, and it is the turn's end that lets it go — but a
    /// turn's end is not always in order with the claims around it: a release
    /// that arrives after another conversation has taken the page must leave that
    /// page exactly as it is. So the stamps are let go only where they are still
    /// the caller's, and **whether they were is what comes back**: a release that
    /// found nothing of its own let nothing go.
    ///
    /// A page the person moved by hand is nobody's already, and only an open of
    /// our own makes a page ours again — a click on a page we do not own is not
    /// owning it.
    pub async fn forget_owner(&self, conversation: &str) -> bool {
        let mut inner = self.inner.lock().await;
        if inner.navigated != conversation {
            return false;
        }
        inner.navigated.clear();
        inner.calling.clear();
        true
    }

    /// What a request **we** caused is stamped with: the call in flight.
    pub async fn stamp_for_our_call(&self) -> String {
        self.inner.lock().await.calling.clone()
    }

    /// What a request **the page** made by itself is stamped with: the call that
    /// navigated the page it came from.
    pub async fn stamp_for_the_page(&self) -> String {
        self.inner.lock().await.navigated.clone()
    }

    /// What the person typed into a secret field here, for the route and the
    /// card. Cheap to read: the catcher fills it as they type, over a binding,
    /// so nothing here has to ask the page.
    /// Records what the page calls its fields, as the call that is acting reads them,
    /// with the address of the document they were read from.
    pub async fn learn_labels(&self, url: String, labels: HashMap<String, String>) {
        self.inner.lock().await.labels = Some(PageLabels { url, labels });
    }

    /// What the page calls its named fields, **only for the document they were read
    /// from**: a write from any other document is labelled by nothing, and the card
    /// draws the names.
    pub async fn labels_for(&self, document_url: &str) -> HashMap<String, String> {
        match &self.inner.lock().await.labels {
            Some(read) if read.url == document_url => read.labels.clone(),
            _ => HashMap::new(),
        }
    }

    /// Forgets what the page was read to say. Called when the window opens an address,
    /// and for every navigation the window makes: the labels of the page left behind
    /// are not the labels of the page that comes next.
    pub async fn forget_labels(&self) {
        self.inner.lock().await.labels = None;
    }

    /// Every request the window makes goes through here before anything else: a
    /// navigation is a new document, so what was read from the old one is forgotten.
    ///
    /// **And a navigation of the main frame that no call of ours caused leaves
    /// the page belonging to nobody.** The person has the window, they press a
    /// link or type an address, and the document on the screen is one they
    /// opened: it belongs to no conversation, and a phone asking for a picture
    /// of it is refused as `not_yours`. A navigation that arrives while one of
    /// our calls is driving the window is ours, and the page stays ours.
    ///
    /// **Only the main frame counts.** An iframe that navigates is not the page
    /// the person is looking at, and a page's own `fetch` never was.
    pub async fn see_request(&self, request: &Request) {
        if request.is_navigation_request() {
            self.forget_labels().await;
            if is_main_frame_navigation(request) {
                self.a_main_frame_navigation().await;
            }
        }
    }

    /// **A navigation of the main frame, and what it means for the owner.**
    ///
    /// **Counted and judged together, under one lock.** The count is what
    /// tells a confirmed submission's own navigation from the one that follows
    /// it — the redirect a server may answer with — and the two must not be
    /// read at two different moments: a navigation counted as ours and then
    /// found nobody's is a page that lost its owner between one look and the
    /// next.
    ///
    /// **And that is why the count and the owner are in the same cell.** The
    /// count used to be taken under the store's own lock and the owner read
    /// under the window's, and a release could land between the two: the
    /// navigation was counted as ours, and the owner was found to be nobody's.
    /// One lock, one look, one answer.
    pub async fn a_main_frame_navigation(&self) {
        // **One critical section.** The count and the judgment are one fact
        // about one moment, and they are read together.
        let ours = {
            let mut window = self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            window.navigations += 1;
            #[cfg(test)]
            self.at_the_navigation_gate();
            window.driver.is_some()
        };
        if !ours {
            let mut inner = self.inner.lock().await;
            inner.navigated.clear();
            inner.calling.clear();
        }
    }

    /// **Calls the test's gate, if there is one.**
    ///
    /// **It is called between the count and the judgment**, which is the one
    /// place a release could get between them — and the place a proof puts one
    /// to see whether it can.
    #[cfg(test)]
    fn at_the_navigation_gate(&self) {
        let gate = self.gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(gate) = gate.as_ref() {
            gate();
        }
    }

    /// **Puts a gate between the count of a navigation and the judgment of who
    /// owns the page.** A test's tool, and nothing the product can reach.
    #[cfg(test)]
    pub fn gate_the_navigation(&self, gate: impl Fn() + Send + Sync + 'static) {
        *self.gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Box::new(gate));
    }

    /// **Lets go of the driving — if the window's cell can be touched.**
    ///
    /// **It says whether it got in**, and that is the whole of what a proof
    /// about the count and the judgment needs to know: a release that cannot
    /// get the cell did not happen, and a release that did happen took the
    /// owner away.
    #[cfg(test)]
    pub fn try_let_go_of(&self, token: u64) -> bool {
        let Ok(mut window) = self.window.try_lock() else {
            return false;
        };
        if window.driver.as_ref().is_some_and(|driver| driver.token == token) {
            window.driver = None;
            return true;
        }
        false
    }

    /// **How many main-frame navigations the route has seen.** A test's tool:
    /// the count is what tells a confirmed submission's own navigation from
    /// the one that follows it.
    #[cfg(test)]
    pub fn navigations_so_far(&self) -> u64 {
        self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).navigations
    }

    pub async fn typed(&self) -> crate::secret::Typed {
        self.inner.lock().await.typed.clone()
    }

    /// Forgets it, for a window that has opened somewhere else.
    /// Records a value as one the person typed into a secret field.
    ///
    /// **For a proof, and for the product's own catcher**: it is the same
    /// add-only list the page can add to, so a proof that wrote it directly is
    /// writing the same thing the page writes, not a side door round it.
    pub async fn typed_in(&self, field: u64, value: &str) {
        self.inner.lock().await.typed.record(field, value.to_owned());
    }

    pub async fn forget_typed(&self) {
        self.inner.lock().await.typed.forget();
    }

    /// Whether the person has the window, which the route asks before it holds
    /// anything.
    pub fn paused(&self) -> bool {
        self.paused.load(std::sync::atomic::Ordering::SeqCst)
    }

    /**The person pressed Pausa, or Resume. Nothing here dispatches: a pause is
    /// about what happens next, not a claim about what already happened, and a
    /// card already on the window is still answerable — pausing is not
    /// declining.*/
    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, std::sync::atomic::Ordering::SeqCst);
    }

    /// **Holds a write and answers with its id.** Nothing is dispatched: the
    /// page is waiting, and the person has not said anything yet.
    ///
    /// **The conversation is passed in, not read from the store.** What stamps a
    /// card is the request that caused it, and the two callers know that: our own
    /// action knows the call, and the route knows the page it is watching. A
    /// store-wide "current" is the wrong shape — a request that arrives while a
    /// different chat is reading would be stamped with that chat, and the person
    /// who caused it could not answer their own card.
    ///
    /// **Eight per conversation, and the ninth is not held.** A person is being
    /// asked to decide on a stranger's write; eight on one screen is already as
    /// much as anybody reads, and a ninth is answered by pressing the top one. So
    /// the store refuses it — the same number the phone side keeps, because it is
    /// the same screen — and the caller is told, in one line, that the request
    /// went nowhere rather than left in a hold with a route parked behind it.
    pub async fn hold(&self, mut card: Card, conversation: &str, answer_it: Answering) -> String {
        let mut inner = self.inner.lock().await;
        // The id is made before anything is decided, so a caller that is told its
        // request went nowhere is still holding the id the model was given.
        card.id = new_id();
        let id = card.id.clone();
        if inner.held.iter().filter(|held| held.card.conversation == conversation).count() >= MAX_HELD {
            drop(inner);
            self.refuse(FULL).await;
            // The route is answered as a refusal, not parked: there is no card to
            // ask about, so there is nothing to wait for.
            (answer_it)(false).await;
            return id;
        }
        card.conversation = conversation.to_owned();
        let began = (self.now)();
        inner.held.push(Held { card, began, answer_it });
        id
    }

    /// A body the person cannot be shown is not held at all: there is no card to
    /// ask about, and holding a request nobody can see is a request waiting to
    /// be sent on a shrug.
    pub async fn refuse(&self, why: impl Into<String>) {
        let mut inner = self.inner.lock().await;
        let whose = inner.calling.clone();
        inner.outcomes.push((whose, Outcome::Unrenderable(why.into())));
    }

    /// What the model has not been told yet, in the order it happened.
    /// **What happened, in the conversation that caused it — and nothing else.**
    ///
    /// An outcome belongs to the turn whose request it settles. Draining the lot
    /// would hand one chat the news about another chat's request, and the news is
    /// a sentence about something a person decided: which is not a thing to read
    /// in a conversation that never asked. What is not taken stays here, for the
    /// conversation it belongs to.
    pub async fn take_outcomes(&self, conversation: &str) -> Vec<Outcome> {
        let mut inner = self.inner.lock().await;
        let (mine, theirs): (Vec<Settled>, Vec<Settled>) =
            inner.outcomes.drain(..).partition(|(whose, _)| whose == conversation);
        inner.outcomes = theirs;
        mine.into_iter().map(|(_, outcome)| outcome).collect()
    }

    /// The card for one held request, for the person about to be asked.
    pub async fn card(&self, id: &str) -> Option<Card> {
        self.inner.lock().await.held.iter().find(|held| held.card.id == id).map(|held| held.card.clone())
    }

    /// How many are waiting. A window with none of these has nothing to draw.
    pub async fn waiting(&self) -> usize {
        self.expire().await;
        self.inner.lock().await.held.len()
    }

    /// Every held request's card, oldest first, for a window that is drawing
    /// them all.
    pub async fn cards(&self) -> Vec<Card> {
        self.expire().await;
        self.inner.lock().await.held.iter().map(|held| held.card.clone()).collect()
    }

    /// The ids of what is waiting, so a call can tell which hold is its own.
    pub async fn ids(&self) -> Vec<String> {
        self.expire().await;
        self.inner.lock().await.held.iter().map(|held| held.card.id.clone()).collect()
    }

    /// The person's answer. **The id is taken before anything is dispatched**, so
    /// a second press finds nothing, and nothing is ever attempted twice.
    pub async fn answer(&self, id: &str, conversation: &str, yes: bool) -> Answer {
        self.answer_why(id, conversation, yes, None).await
    }

    /// The same, with **the reason the caller is giving the request up**, which is
    /// not always that the person said no.
    ///
    /// **A decline that nobody was asked for is not a decline.** When the app lets
    /// a hold go because there is nobody left to answer it — a phone that has been
    /// unpaired, a write refused for want of a decision — `why` is what the model
    /// is told, in the same plain line every other refusal uses. Settling those as
    /// `Declined` would tell the model the person refused, which is the one thing
    /// it would then be right to try again.
    pub async fn answer_why(&self, id: &str, conversation: &str, yes: bool, why: Option<&str>) -> Answer {
        // Expiry comes first: a request nobody answered may not still be sent.
        self.expire().await;
        // Found and taken in **one** acquisition of the lock. Two acquisitions
        // were two chances: two answers to the same id could both read the same
        // index before either removed it, and the second `remove` would then take
        // whatever had moved into that place instead — a stranger's next request,
        // sent or dropped by somebody answering the wrong card.
        let taken = {
            let mut inner = self.inner.lock().await;
            let at = inner.held.iter().position(|held| held.card.id == id);
            at.map(|at| inner.held.remove(at))
        };
        let Some(held) = taken else {
            return Answer::Unknown;
        };
        // **The card answers only where it was raised.** A request belongs to the
        // conversation whose turn caused it, so a card from one chat cannot be
        // pressed from another: the id is not a capability, it is a question, and
        // a question asked in the wrong place gets no answer.
        //
        // It is put back rather than dropped. The person who did cause it is
        // still looking at it, and taking their card away because a stranger's
        // chat asked first would be a denial of service run by a page's timings.
        if held.card.conversation != conversation {
            self.inner.lock().await.held.push(held);
            return Answer::Unknown;
        }
        // **A card with nowhere to go cannot be sent, by anybody.** The press was
        // a yes and the address names no host, so there was no destination for the
        // person to be agreeing to — and a window that offered the button anyway
        // would be offering them a decision they could not make. The request is
        // dropped, not dispatched, and the model is told it went nowhere. **A
        // decline is still a decline**, above: dropping a request needs nowhere
        // to send it.
        if yes && held.card.destination.is_none() {
            // **It is stopped, not left.** The answer is what continues or aborts
            // the route, so a refusal that never calls it would leave a held
            // navigation standing — one the browser may finish on its own, which is
            // exactly what the card was holding it for. Answered as a no, then
            // settled with the reason there was nothing to confirm.
            let _ = (held.answer_it)(false).await;
            let outcome = Outcome::Unrenderable(NOWHERE.to_owned());
            self.inner.lock().await.outcomes.push((held.card.conversation.clone(), outcome.clone()));
            return Answer::Spent(outcome);
        }
        // The mutex is given back before the request is dispatched: nothing that
        // waits on the network is ever waited on holding it.
        let dispatched = (held.answer_it)(yes).await;
        let outcome = match (yes, dispatched) {
            // **Nobody was asked**, so that is what is said: a decline with a
            // reason is not the person refusing, and a model told they refused
            // would try again.
            (false, _) => match why {
                Some(why) => Outcome::Unrenderable(why.to_owned()),
                None => Outcome::Declined,
            },
            (true, true) => Outcome::Sent { host: host_of(&held.card.url).unwrap_or_default() },
            // It was answered yes and could not be sent. Say so, and never try
            // again.
            (true, false) => Outcome::Ambiguous,
        };
        self.inner.lock().await.outcomes.push((held.card.conversation.clone(), outcome.clone()));
        Answer::Spent(outcome)
    }

    /// Lets the write the person just answered go, instead of being held again.
    ///
    /// **The ticket is armed for one driving, and the duty of ending it rides
    /// along.** The route spends the ticket and hands the duty to the watch it
    /// starts, and that watch is what lets go of the driving when the
    /// navigation has passed — or when the watch dies before it has.
    ///
    /// **And the guard that comes back with it owns the ticket.** A call that is
    /// cut short between arming the ticket and spending it must not leave the
    /// ticket armed: a later request that matches it would go through without a
    /// new approval. So the guard's drop takes the ticket back when nobody
    /// spent it, and leaves the duty to the watch when somebody did.
    ///
    /// **The driving comes with it, and does not come back.** The guard holds
    /// the right to let go of the window, so that the decision about whether to
    /// let go of it is made in one place — and the route that spends the ticket
    /// hands it to the watch it starts, which is what lets go of it then.
    ///
    /// **Not awaited, and that is the point.** Arming the ticket and handing
    /// back the guard is one act, with no wait in the middle of it: a call
    /// cancelled between the two would leave the ticket armed with nobody to
    /// take it back.
    pub fn pass_next(&self, ticket: Ticket, driving: Driving) -> Armed {
        let taken = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let duty = driving.duty.clone();
        self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).pass =
            Some(Pass { ticket, duty: duty.clone(), taken: taken.clone() });
        Armed { holds: self.clone(), driving: Some(driving), taken }
    }

    /// **Takes the armed ticket back, and says whether the route had spent it.**
    ///
    /// **One lock for the question and the answer.** Whether the ticket was
    /// spent and what is left of it are one fact, and the store's cell says
    /// both together: a guard that read the flag on its own could see a ticket
    /// that was being spent at that very moment, and let go of a driving the
    /// watch owns.
    ///
    /// `true` means the watch owns the driving now — the route spent the
    /// ticket — and the guard must leave it alone. `false` means the ticket was
    /// still armed, and it has now been thrown away: the duty is still the
    /// guard's own.
    fn take_the_pass_back(&self, duty: &Arc<Duty>, taken: &std::sync::atomic::AtomicBool) -> bool {
        let mut window = self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if window.pass.as_ref().is_some_and(|pass| Arc::ptr_eq(&pass.duty, duty)) {
            // **The ticket is still armed**: it is thrown away, so that a later
            // request that matches it does not go through without a new
            // approval.
            window.pass = None;
            return false;
        }
        // **The ticket is gone.** Either the route spent it — and the watch it
        // started owns the driving — or the dispatch threw it away, and the
        // driving is still ours. The flag says which, and it is read under this
        // lock, so a route that is spending it right now cannot be missed.
        taken.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// **Throws the answer away.** Used when the dispatch could not be carried
    /// out: the person said yes, and nothing went — so the answer must not be
    /// left where a later request of ours could pick it up and send.
    pub async fn revoke_pass(&self) {
        self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).pass = None;
    }

    /// Whether an answer is still waiting to be claimed, which is how a dispatch
    /// finds out that the request it started never arrived.
    pub async fn answer_pending(&self) -> bool {
        self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).pass.is_some()
    }

    /// Waits, briefly, for the route to claim the answer — **true when it did**.
    ///
    /// This is the only thing that turns "the form was submitted" into "the
    /// request the person approved went", and it is asked of the route rather
    /// than of the page: the page is where a lie would come from.
    pub async fn wait_for_spent(&self, window: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + window;
        loop {
            if !self.answer_pending().await {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }

    /// Whether **this** request is the one just answered, asked of the store by
    /// the route before it holds anything.
    ///
    /// **The whole of [`Ticket::matches`], and not a part of it.** A `fetch`
    /// carrying the same method, address, content type and bytes is not the
    /// request the person was shown — it is the same request made by somebody
    /// else's code, and spending the answer on it is how "yes" turns into
    /// "something else". It is held like any other write, and the ticket is left
    /// there for the navigation that really is ours.
    ///
    /// **And what the submission is waiting for comes back with it.** The duty
    /// of ending the driving, and the navigation count this submission starts
    /// from: **both are this submission's own**, because two submissions can
    /// overlap and each of them has to wait for its own navigation and let go
    /// of its own driving.
    ///
    /// **One lock, and no wait inside it.** The ticket is spent and the baseline
    /// is taken together, so the count cannot move between the two, and a route
    /// that is cancelled cannot be cancelled between them either: the watch it
    /// starts is what owns the driving from that moment on.
    pub async fn takes_pass(&self, request: &Request) -> Option<Approved> {
        let mut window = self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let pass = window.pass.as_ref()?;
        if !pass.ticket.matches(request) {
            return None;
        }
        let duty = pass.duty.clone();
        // **The route spends it here**, under the lock that took it out, so the
        // guard that armed it sees the fact at the same moment the watch that
        // owns the driving is given it.
        pass.taken.store(true, std::sync::atomic::Ordering::SeqCst);
        window.pass = None;
        // **This navigation is the one the person approved**, and it is counted
        // as it goes by: the navigation that follows it — the redirect a server
        // may answer with — is ours too, and the watch below waits for it.
        // **The count is this submission's own baseline**, taken here, where
        // the ticket is spent: a watch that read a shared count would wait from
        // another submission's baseline.
        Some(Approved { duty, baseline: window.navigations })
    }

    /// **Watches the answer of the request the person has just approved.**
    ///
    /// **A server may answer with a redirect, and a redirect is a navigation the
    /// browser makes on its own.** It is ours, exactly as the first one is: the
    /// receipt of what the person agreed to is the page they are owed, and a
    /// redirect is how a server sends it. So the driving does not end with the
    /// request — it ends with the navigation that follows it, and waiting for
    /// that navigation is what this is.
    ///
    /// **It runs on a task of its own**, so the person who pressed the button
    /// is not kept waiting for a server that has already answered, and the
    /// answer to the press goes out as soon as the request is on its way.
    ///
    /// **The wait is bounded.** A server that answers and does not redirect has
    /// nothing more to send, and a window held by a watch that waits for ever
    /// is a window the person cannot take back.
    pub fn watch_the_landing(&self, request: Request, approved: Approved) {
        self.spawn_the_watch(
            approved,
            async move {
                // **The answer to the request the person approved.** The request
                // is in flight until the server answers, and a navigation in
                // flight is ours: the receipt of what the person agreed to is
                // the page they are owed. It is waited for and not assumed, and
                // it is waited for **bounded**: a server that never answers must
                // not hold the window for ever.
                let _answered = tokio::time::timeout(ANSWER_WINDOW, request.response())
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .flatten();
            },
            REDIRECT_WINDOW,
        );
    }

    /// **The watch, on a task of its own, and the guard it owns.**
    ///
    /// **The guard is made here and moved into the task.** A watch that is
    /// cancelled before it has ever run still drops it, and the drop is what
    /// lets go of the driving — so the cleanup of an abnormal end does not
    /// depend on the task having started. A guard that was only disarmed by the
    /// call that handed the driving over would leave the window driven for ever
    /// when the watch died.
    fn spawn_the_watch<F>(
        &self,
        approved: Approved,
        answer: F,
        window: Duration,
    ) -> tokio::task::JoinHandle<()>
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        let holds = self.clone();
        let guard = self.guard_of(approved.duty.clone());
        tokio::spawn(async move {
            holds.watch_for_the_landing(approved, guard, answer, window).await;
        })
    }

    /// **Waits for the navigation that follows the one the person approved, and
    /// then lets go of the driving.**
    ///
    /// **The guard is the watch's own**, and it is held for the whole watch: it
    /// is what lets go of the driving when the navigation has passed, and what
    /// lets go of it when the watch dies before it has.
    async fn watch_for_the_landing<F>(
        &self,
        approved: Approved,
        guard: Driving,
        answer: F,
        window: Duration,
    ) where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        answer.await;
        // **And the navigation that follows the submission's own.** A server may
        // answer with a redirect, and a redirect is a navigation the browser
        // makes on its own — ours, exactly as the first one is. **A redirect
        // the browser makes as a request of its own** — a page that sends the
        // browser on, which is what most receipts do — is a navigation the
        // route sees, and it is judged like any other: with nobody driving it,
        // it would be the person's own, and it would take the page away from
        // the conversation that earned it.
        self.wait_for_the_navigation(approved.baseline, window).await;
        // **And the window is the person's again — if this submission still has
        // it.** A watch that ends late finds the window driving somebody else's
        // submission, and leaves it to them.
        guard.release();
    }

    /// **The guard for a driving this duty is about, without taking it again.**
    ///
    /// **The watch's own copy of the duty.** It is what lets go of the driving
    /// when the navigation has passed, and what lets go of it when the watch
    /// dies before it has.
    fn guard_of(&self, duty: Arc<Duty>) -> Driving {
        Driving { holds: self.clone(), duty, may_let_go: true }
    }

    /// **Waits for the navigation that follows the confirmed submission's own.**
    ///
    /// **From this submission's own baseline, and not from a shared count.**
    /// Two submissions can overlap, and the watch of the first one is still
    /// waiting when the second is confirmed: each of them waits for the
    /// navigation that follows its own submission, and neither waits for the
    /// other's.
    ///
    /// Bounded, and it says why: the browser makes the redirect as soon as it
    /// has the answer, and a window the person cannot take back is worse than
    /// a receipt that arrives a moment later.
    ///
    /// **And it says whether the navigation came**, because that is the whole
    /// of what the wait is for.
    async fn wait_for_the_navigation(&self, baseline: u64, window: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + window;
        loop {
            if self.navigation_has_moved(baseline).await {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }

    /// **Whether a main-frame navigation has passed since the one this confirmed
    /// submission caused.**
    ///
    /// **From this submission's own baseline.** A count that was shared between
    /// two submissions would answer the question for the wrong one, and the watch
    /// of the submission that came first would wait for a navigation that is
    /// not its own.
    async fn navigation_has_moved(&self, baseline: u64) -> bool {
        self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).navigations > baseline
    }

    /// The four-part comparison on its own, with no request and no frame.
    ///
    /// **A test's tool and nothing the product can reach.** The route asks
    /// [`Self::takes_pass`], which asks the whole of [`Ticket::matches`]; there is
    /// no path from a request to this, and that is the point. It stays for the
    /// case it is good at — telling two bodies apart without a browser — and it
    /// is deliberately *not* what a probe is stopped by: a probe with a
    /// byte-identical body passes this and is still held, because it is not a
    /// navigation.
    ///
    /// **And it answers what the route answers, and no less.** The submission's
    /// own duty and its own baseline come back with it, so a proof about two
    /// overlapping submissions is a proof about the same thing the route does.
    #[cfg(test)]
    pub async fn takes_parts(&self, method: &str, url: &str, content_type: &str, body: &[u8]) -> Option<Approved> {
        let mut window = self.window.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let pass = window.pass.as_ref()?;
        if !pass.ticket.matches_parts(method, url, content_type, body) {
            return None;
        }
        let duty = pass.duty.clone();
        pass.taken.store(true, std::sync::atomic::Ordering::SeqCst);
        window.pass = None;
        Some(Approved { duty, baseline: window.navigations })
    }

    /// Declines everything nobody answered. Called when the window goes: a held
    /// request with nobody left to answer it is not dispatched.
    pub async fn decline_all(&self, outcome: Outcome) {
        let taken: Vec<Held> = self.inner.lock().await.held.drain(..).collect();
        for held in taken {
            // **Each card's outcome lands in that card's conversation**, so a
            // window closing over two chats tells each of them about its own.
            self.inner.lock().await.outcomes.push((held.card.conversation.clone(), outcome.clone()));
            (held.answer_it)(false).await;
        }
    }

    /// Everything past its five minutes, declined and said so. Asked of the
    /// store rather than waited for on a timer: a request that has expired must
    /// not be dispatchable even if nobody noticed, and a person is not owed a
    /// background task to be answered.
    async fn expire(&self) {
        let now = (self.now)();
        let taken = {
            let mut inner = self.inner.lock().await;
            let mut expired = Vec::new();
            let mut index = 0;
            while index < inner.held.len() {
                if now.duration_since(inner.held[index].began) >= EXPIRY {
                    expired.push(inner.held.remove(index));
                } else {
                    index += 1;
                }
            }
            expired
        };
        for held in taken {
            self.inner.lock().await.outcomes.push((held.card.conversation.clone(), Outcome::Expired));
            (held.answer_it)(false).await;
        }
    }
}

/// A card's id: **128 bits from the operating system**, written as hex.
///
/// A counter (`c1`, `c2`) says how many requests this browser has ever made, so
/// a page can work out the id of the card above it on the screen and name it
/// itself. What an id protects is not the person but the answer: a guessable one
/// is a card another conversation could press.
fn new_id() -> String {
    let mut bytes = [0_u8; 16];
    // A failure here is not something to paper over with a counter, which is the
    // thing being replaced. Failing to reach the OS is not a state this can
    // continue in.
    getrandom::getrandom(&mut bytes).expect("the operating system has entropy");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// **What is allowed past the route after a person answered.**
///
/// The whole request, not a description of it: the method, the address, the
/// content type and the bytes. Matching on anything less is what let a page
/// re-point a confirmed write at the same address with a different body, and a
/// name and an address together are no protection at all against that.
///
/// The ticket is **one request and spent on first sight**. Anything the page
/// sends in the meantime is held like any other write, and the one that comes
/// back is checked before it is allowed through — so if a rebuild were ever not
/// what the card showed, what happens is that the request is held and the person
/// is told it was unclear, rather than that something else went out.
///
/// **It is also a navigation of the main frame, and that is what closes the
/// header question.** Headers the browser varies — `user-agent`, `accept*`,
/// `sec-*`, `referer`, `cookie`, `content-length` — cannot be compared, so
/// comparing the rest of them instead would be a list somebody has to keep
/// right. A request that means something different server-side under a header we
/// ignore is not stopped by ignoring the header; it is stopped by **not being
/// able to claim the ticket at all**: a `fetch`, an XHR or a beacon is never a
/// navigation request, so a page racing the approved write with
/// `X-HTTP-Method-Override` and the same URL and body is not let through. A
/// frame's own navigation cannot claim it either, so only the navigation FIRE
/// starts — in the main document — is let through.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Ticket {
    method: String,
    url: String,
    content_type: String,
    body: Vec<u8>,
}

impl Ticket {
    /// The ticket for a request the browser has already built, read straight off
    /// it. Resuming that request sends those bytes by definition.
    pub fn of(request: &Request) -> Self {
        Self {
            method: request.method().to_ascii_uppercase(),
            url: request.url().to_owned(),
            content_type: request.headers().get("content-type").cloned().unwrap_or_default(),
            body: request.post_data_buffer().unwrap_or_default(),
        }
    }

    /// The ticket for a request Kalsa built, from the bytes it captured.
    pub fn of_parts(method: &str, url: &str, content_type: &str, body: Vec<u8>) -> Self {
        Self {
            method: method.to_ascii_uppercase(),
            url: url.to_owned(),
            content_type: content_type.to_owned(),
            body,
        }
    }

    /// Whether the request now in front of us is the one this ticket was made
    /// for. The content type is compared without its parameters, because the
    /// browser adds `;charset=UTF-8` to some encodings and that is not a
    /// different request.
    ///
    /// **A navigation of the main frame, or nothing.** A sub-resource that
    /// happens to carry the same method, address and bytes — a `fetch` with the
    /// same URL and body and a header that changes what the server does with it
    /// — is not the request the person was shown, and is held.
    pub fn matches(&self, request: &Request) -> bool {
        if !is_main_frame_navigation(request) {
            return false;
        }
        self.matches_parts(
            request.method(),
            request.url(),
            &request.headers().get("content-type").cloned().unwrap_or_default(),
            &request.post_data_buffer().unwrap_or_default(),
        )
    }

    /// The comparison itself, over the four things that make a request a
    /// request. Split out so it can be proved without a browser: **the body is
    /// what is being compared, and a name and an address that match prove
    /// nothing.**
    pub fn matches_parts(&self, method: &str, url: &str, content_type: &str, body: &[u8]) -> bool {
        let kind = |value: &str| value.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        self.method.eq_ignore_ascii_case(method)
            && self.url == url
            && kind(&self.content_type) == kind(content_type)
            && self.body == body
    }
}

/// Whether this request is the main document's and nothing else: a
/// navigation, in the frame with no parent.
///
/// **An iframe that navigates is not the page the person is looking at**, and
/// a page's own `fetch` never was: both are the page talking, and the window
/// the person has is the one at the top.
fn is_main_frame_navigation(request: &Request) -> bool {
    request.is_navigation_request() && request.frame().is_some_and(|frame| frame.parent_frame().is_none())
}

/// Whether this method is a read. A GET is the only one: a HEAD asks the site to
/// do the work of answering just as a GET does, and every other method is a
/// write somebody has to agree to.
///
/// Public beside [`hold_write`] and for the same reason: a browser test stands
/// in for the address decision, never for this one.
pub fn is_read(method: &str) -> bool {
    method.eq_ignore_ascii_case("GET")
}

/// **The longest address a card may carry.** Eight kilobytes is far past any
/// address a person reads and far short of the one-megabyte frame a phone's card
/// event has to fit in, so a card at its caps — a maximum body in every one of
/// two hundred fields — still crosses whole. **Capped here, where the card is
/// made**, so the rule is one number in one place rather than the same number
/// restated by a caller on each side of the wire.
pub const MAX_URL: usize = 8 * 1024;

/// **How many held requests one conversation may have waiting at once.** Eight,
/// and the same eight the phone bridge keeps, because it is the same screen: a
/// person is being asked to decide on a stranger's write, and a ninth is a queue
/// they clear by pressing the top one.
pub const MAX_HELD: usize = 8;

/// What the model is told about a write refused because the person was already
/// being asked about eight others. One plain line, said once, and nothing held.
const FULL: &str = "the person was already being asked about eight other requests, so this one was never put to them";

/// What the model is told about an address too long to draw a card for. One
/// plain line, and no card: the request was refused rather than held, so nothing
/// is waiting for anybody.
///
/// **Public because both roads hold requests**, and a cap that only one of them
/// applied would be a cap with a hole in it: the route sees a request the page
/// asked the network for, and `mcp::held_submission` sees one caught off the
/// page before it got there. A card built from an address nobody capped is a
/// card the phone's frame cannot hold.
pub const TOO_LONG: &str = "its address is longer than 8 KiB, which is more than a card can show a person";

/// **Holds one write, or refuses it.** The route that would have dispatched it
/// is parked in the store with the card, and this handler returns without
/// answering it: an answer arrives on its own call, minutes later.
///
/// A body the person cannot be shown is not held — there would be no card to ask
/// about — so it is refused here and the model is told why on its next call.
///
/// Data-channel requests reach this hold through the typed-secret checks.
/// Intercepted navigation submissions retain their confirmation path.
/// Public because the browser tests stand in for the **address** decision and
/// not for this one: they route a fixture through here so a real form post can be
/// held for real, the same way `guard::install` holds it.
pub async fn hold_write(
    holds: &Holds,
    request: &Request,
    route: Route,
) -> Result<(), playwright_rs::Error> {
    let headers = request.headers();
    let content_type = headers.get("content-type").cloned().unwrap_or_default();
    let body = request.post_data_buffer().unwrap_or_default();
    // **An address nobody is going to read is not a card.** The address crosses
    // as it is, whole, to the window, to the phone and into the note the model
    // reads, so a page that puts twenty kilobytes in its query would spend the
    // person's screen and the phone's one-megabyte frame on a line they cannot
    // check — and a card that cannot be checked is a card they cannot answer. It
    // is refused here for the same reason a body the person cannot be shown is:
    // there would be no card to ask about, so the model is told why instead.
    if request.url().len() > MAX_URL {
        holds.refuse(TOO_LONG).await;
        route.abort(Some("blockedbyclient")).await?;
        return Ok(());
    }
    // What the person typed into a secret field, on this side of the wire.
    let typed = holds.typed().await.values();
    // A read that is not one has nothing in a body to show: what it carries is
    // in its address, and the address is shown whole.
    if is_read(request.method()) {
        let shown = address_of(request.url(), &typed);
        return park(holds, shown, route).await;
    }
    let mut fields: Vec<Field> = match body::show(&content_type, &body) {
        // **The real values, flagged where a name reads as a secret or where the
        // value is one the person typed.** A request that got this far has no
        // element behind it, so that is all there is — and all it can do is add
        // dots.
        body::Shown::Fields(fields) => fields
            .into_iter()
            .map(|one| body::Field {
                secret: one.secret || crate::secret::holds(&one.value, &typed),
                ..one
            })
            .collect(),
        body::Shown::Refused(why) => {
            holds.refuse(why).await;
            route.abort(Some("blockedbyclient")).await?;
            return Ok(());
        }
    };
    let page_url = request.frame().map(|frame| frame.url()).unwrap_or_default();
    label::apply(&mut fields, &holds.labels_for(&page_url).await, &typed);
    // **And the query, after the body.** A write's data is in two halves and the
    // card has to show both: the person is asked about `POST /api` while the
    // bytes that leave carry `?msg=…`. They come after the fields the page wrote
    // into its form, which is the order they were written in, and they are read
    // strictly — a value in the query that is not text refuses the write, as an
    // unreadable body does.
    match query_fields(request.url(), &typed) {
        Ok(query) => fields.extend(query),
        Err(why) => {
            holds.refuse(why).await;
            route.abort(Some("blockedbyclient")).await?;
            return Ok(());
        }
    }
    // **`park` computes the destination**, so the card is built here without one:
    // there is one place in the crate that decides it, and this is not it.
    park(
        holds,
        Card {
            id: String::new(),
            method: request.method().to_ascii_uppercase(),
            url: request.url().to_owned(),
            fields,
            conversation: String::new(),
            destination: None,
        },
        route,
    )
    .await
}

/// **The fields a held write's query carries.**
///
/// `Ok` is the fields, empty when the address has no query or does not parse —
/// the same answer the read path gives, since there is nothing to read then.
/// `Err` is why there is no card: a value in the query is not text, which is a
/// request a person cannot check and therefore cannot be asked about.
///
/// **The query is marked exactly as a body field is** — by its own name, or
/// because it carries a value the *person* typed. A page can make its own fields
/// dotty and nothing else, whichever half of the request they are in.
pub(crate) fn query_fields(url: &str, typed: &[String]) -> Result<Vec<Field>, &'static str> {
    let Ok(parsed) = url::Url::parse(url) else {
        return Ok(Vec::new());
    };
    let Some(query) = parsed.query() else {
        return Ok(Vec::new());
    };
    let Some(fields) = body::query_fields(query) else {
        return Err(body::NOT_TEXT);
    };
    Ok(fields
        .into_iter()
        .map(|one| body::Field { secret: one.secret || crate::secret::holds(&one.value, typed), ..one })
        .collect())
}

/// **Parks the route with a card.** Resuming **this** route sends the bytes the
/// browser already built, so the request that goes out is the one the card was
/// drawn from by definition. No ticket is needed for it: there is nothing to
/// rebuild and nothing for the page to have changed in between.
async fn park(holds: &Holds, mut card: Card, route: Route) -> Result<(), playwright_rs::Error> {
    // **The one place a card's destination is decided.** Every card is parked
    // here, so every window — this desktop's and every phone's — is shown the same
    // host for the same request, and none of them works it out for itself.
    card.destination = destination_of(&card.url);
    let parked = route.clone();
    // A request the page made by itself belongs to the call that navigated the
    // page it came from, not to whichever chat happens to be reading now.
    let conversation = holds.stamp_for_the_page().await;
    holds
        .hold(card, &conversation, Box::new(move |yes| {
            Box::pin(async move {
                if yes {
                    parked.continue_(None).await.is_ok()
                } else {
                    let _ = parked.abort(Some("blockedbyclient")).await;
                    false
                }
            })
        }))
        .await;
    Ok(())
}

/// **A read as a card: the address, whole.**
///
/// The person has to see where it goes and exactly what it carries — including
/// the value it is being held for, which is the whole reason it is being asked
/// about at all. A card that printed an edited address could not be checked
/// against the one that goes out, so the address is shown as it is, and a query
/// parameter that reads as a secret is marked, which changes how the window
/// draws it and nothing else.
pub(crate) fn address_of(url: &str, typed: &[String]) -> Card {
    let Ok(parsed) = url::Url::parse(url) else {
        return Card {
            id: String::new(),
            method: "GET".to_owned(),
            url: url.to_owned(),
            fields: Vec::new(),
            conversation: String::new(),
            destination: None,
        };
    };
    let mut fields: Vec<Field> = parsed
        .query_pairs()
        .map(|(name, value)| {
            // **By name or by value.** The name is what a page can choose, and a
            // page that names its password field `field1` should not get to read
            // it over the person's shoulder either — while a value the *person*
            // typed is theirs whatever it is called.
            let secret = body::secret_name(&name) || crate::secret::holds(&value, typed);
            body::Field { secret, name: name.into_owned(), value: value.into_owned(), label: None }
        })
        .collect();
    // **A secret in the path is a secret nobody can see on the card.** The query
    // is read pair by pair, so a query value that is one the person typed is
    // marked where it is; a path segment that carries the same value is in no
    // pair, so nothing above finds it — and the address is shown whole, so it
    // would go to the person, and to every log line that prints the card, with a
    // value in it that the fields beside it are careful not to print. So it is
    // **named here**, as a field of its own: the card then says what is in the
    // path that it should not, which is the only thing a masker, a person or a
    // log line can act on.
    if crate::secret::carries(url, typed) && !fields.iter().any(|field| field.secret) {
        if let Some(part) = parsed
            .path_segments()
            .into_iter()
            .flatten()
            .find(|segment| typed.iter().filter(|value| value.chars().count() >= crate::secret::MIN_SECRET).any(|value| segment.contains(value.as_str())))
        {
            fields.push(body::Field { secret: true, name: "the path".to_owned(), value: part.to_owned(), label: None });
        }
    }
    Card {
        id: String::new(),
        method: "GET".to_owned(),
        url: url.to_owned(),
        fields,
        conversation: String::new(),
        // **From the parsed address, not from the text beside it**: `parsed` is
        // the parser's own reading of what the browser will send.
        destination: destination_of(url),
    }
}

/// Said the moment a request is held, in the shape a host reads an id back out
/// of. The model quotes it and is told what became of it on its next call.
///
/// **Public because the lab plays a person**, in `--fake` mode only: it has to
/// be handed the same sentence the product hands a person, or the lab would be
/// driving a copy of the hold rather than the hold.
pub fn awaiting(id: &str) -> String {
    format!(
        "awaiting confirm {id}: this request is held and nothing has been sent. The person is shown \
         what it carries and will decide. Nothing else is needed; the next call says what became \
         of it."
    )
}

#[cfg(test)]
mod tests {
    use super::{
        address_of, destination_of, query_fields, Answer, Approved, Card, Driving, Holds, Outcome, Ticket, EXPIRY, FULL,
        MAX_HELD, NOWHERE,
    };
    use crate::body::Field;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    /// A clock a test moves by hand, so five minutes is something a test can
    /// watch go by instead of something it has to believe.
    struct Clock {
        base: Instant,
        millis: Arc<AtomicU64>,
    }

    impl Clone for Clock {
        fn clone(&self) -> Self {
            Self { base: self.base, millis: self.millis.clone() }
        }
    }

    impl Clock {
        fn new() -> Self {
            Self { base: Instant::now(), millis: Arc::new(AtomicU64::new(0)) }
        }

        fn now(&self) -> Instant {
            self.base + Duration::from_millis(self.millis.load(Ordering::SeqCst))
        }

        fn advance(&self, by: Duration) {
            self.millis.fetch_add(by.as_millis() as u64, Ordering::SeqCst);
        }
    }

    /// The conversation these tests drive a window from.
    const CHAT: &str = "chat-a";

    async fn holds_in(conversation: &str) -> Holds {
        let holds = Holds::new();
        holds.in_conversation(conversation).await;
        holds
    }

    async fn holds_on_a_clock(now: impl Fn() -> Instant + Send + Sync + 'static, conversation: &str) -> Holds {
        let holds = Holds::on_a_clock(now);
        holds.in_conversation(conversation).await;
        holds
    }

    fn card() -> Card {
        Card {
            id: String::new(),
            method: "POST".to_owned(),
            url: "https://shop.example/order".to_owned(),
            fields: vec![Field { name: "city".to_owned(), value: "Bologna".to_owned(), secret: false, label: None }],
            // Stamped by `hold`, which is the point: whatever is here is replaced.
            conversation: "chat-asked-for-it".to_owned(),
            // A real card names where it goes, and these tests are about cards
            // that do; the one that has no destination says so on purpose.
            destination: destination_of("https://shop.example/order"),
        }
    }

    /// **The query is on the card, after the body.** A write carries data in two
    /// halves and the person is asked about both: the card shows what the page
    /// wrote into the form, and then what the address carries with it — in that
    /// order, which is the order they were written in.
    #[test]
    fn a_write_carries_its_query_on_the_card_after_the_fields_it_wrote() {
        let typed = vec!["hunter2".to_owned()];
        let fields = query_fields("https://shop.example/order?msg=Ciao+Giulia&token=hunter2", &typed)
            .expect("a query of text is shown");
        assert_eq!(
            fields,
            vec![
                Field { name: "msg".to_owned(), value: "Ciao Giulia".to_owned(), secret: false, label: None },
                // The value the person typed is theirs whatever it is called.
                Field { name: "token".to_owned(), value: "hunter2".to_owned(), secret: true, label: None },
            ],
            "the value the person typed is marked, and it is still there in full"
        );
    }

    /// **An address with no query is not a refusal, and neither is one that does
    /// not parse** — there is nothing in it to show, which is a card without
    /// those fields rather than a write nobody can be asked about.
    #[test]
    fn a_write_with_no_query_carries_no_query_fields() {
        assert_eq!(query_fields("https://shop.example/order", &[]).expect("nothing to refuse"), Vec::<Field>::new());
        assert_eq!(query_fields("not an address", &[]).expect("nothing to refuse"), Vec::<Field>::new());
    }

    /// **A value in the query that is not text is a write there is no card for.**
    /// A card with a replacement character in it would show a value nobody sent,
    /// so the write is refused — the same reason, and the same line, as a body
    /// carrying bytes that are not text.
    #[test]
    fn a_query_value_that_is_not_text_refuses_the_write() {
        assert_eq!(query_fields("https://shop.example/order?msg=%FF", &[]), Err(crate::body::NOT_TEXT));
    }

    /// A card the sidecar could not name a host for: the fields are there and the
    /// destination is not, which is the one state a person may not send from.
    fn without_a_destination() -> Card {
        Card { destination: None, ..card() }
    }

    /// **The host is the browser's own reading, not a rule written here.** Every
    /// case below is one a hand-written parser gets wrong: a backslash is a path
    /// separator to WHATWG, the host is after the **last** `@`, whitespace is
    /// stripped, and an international name arrives punycoded. A card that showed a
    /// different host than the request goes to is the one card that must never
    /// exist, so this is the parser that decides and nothing else is.
    #[test]
    fn the_destination_is_what_the_browser_would_resolve_and_not_what_the_text_says() {
        for (address, host, port, secure) in [
            // The plain case, and a host written in capitals: a host is not case
            // sensitive, so two spellings of it are one destination.
            ("https://shop.example/order", "shop.example", None, true),
            ("https://SHOP.Example/order", "shop.example", None, true),
            // **A backslash is a `/`**, so this is shop.example with the rest in
            // its path — not another host sitting at the end of it.
            ("https://shop.example\\@evil.example/x", "shop.example", None, true),
            // **The host is after the last `@`.** What is before it is a user, and
            // a user can be anything, an `@` included.
            ("https://shop.example@evil.example/x", "evil.example", None, true),
            ("https://a@shop.example@evil.example/x", "evil.example", None, true),
            // Whitespace around the address is not part of it, and a tab inside it
            // is not part of it either.
            ("  https://shop.example/x  ", "shop.example", None, true),
            ("https://shop\t.example/x", "shop.example", None, true),
            // **An international name is punycode**, which is the form the resolver
            // is given and the only one a card may show.
            ("https://пример.рф/x", "xn--e1afmkfd.xn--p1ai", None, true),
            ("https://Пример.РФ/x", "xn--e1afmkfd.xn--p1ai", None, true),
            // **Lower case is the host's, label by label**: a name written in
            // capitals is the same name, and only the label that was capital is
            // changed.
            ("https://SHOP.Пример.РФ/x", "shop.xn--e1afmkfd.xn--p1ai", None, true),
            // **A default port is no port**: the parser drops it, so a reader never
            // has to know what a scheme's default is.
            ("https://shop.example:443/x", "shop.example", None, true),
            ("http://shop.example:80/x", "shop.example", None, false),
            // And a port that is not the default is the one the address names.
            ("http://shop.example:8080/x", "shop.example", Some(8080), false),
            ("https://shop.example:8443/x", "shop.example", Some(8443), true),
        ] {
            let said = destination_of(address).unwrap_or_else(|| panic!("{address} names a host"));
            assert_eq!(said.host, host, "the host of {address}");
            assert_eq!(said.port, port, "the port of {address}");
            assert_eq!(said.secure, secure, "and whether {address} is secure");
        }
    }

    /// **An address with no host has no destination**, and that is a real answer
    /// rather than a parse failure to apologise for: there is nothing for a person
    /// to be agreeing to, so there is nothing to show them.
    #[test]
    fn an_address_with_no_host_has_no_destination() {
        for address in ["not an address", "mailto:giulia@example.org", "/only/a/path", ""] {
            assert_eq!(destination_of(address), None, "{address} names no host");
        }
    }

    /// **A card with no destination cannot be sent by anybody.** The press was a
    /// yes and there was nowhere to send it, so the request is dropped and the
    /// model is told so — and **a decline is still a decline**, because turning a
    /// request down needs no destination at all.
    #[tokio::test]
    async fn a_card_with_no_destination_is_dropped_on_a_yes_and_taken_on_a_no() {
        let holds = holds_in(CHAT).await;
        let sent = Sent::default();
        let (answering, sent) = sent.answering();
        let id = holds.hold(without_a_destination(), CHAT, answering).await;

        let refused = holds.answer(&id, CHAT, true).await;
        assert_eq!(refused, Answer::Spent(Outcome::Unrenderable(NOWHERE.to_owned())), "a yes with nowhere to go");
        assert!(!sent.dispatched(), "and nothing was dispatched, by anybody, on it");
        assert_eq!(sent.calls(), 1, "the held request was told to stop, not left standing");
        assert!(sent.dropped(), "which is a decline of it: nothing was let through");

        // **The decline is the one answer that never needed a destination.**
        let sent = Sent::default();
        let (answering, sent) = sent.answering();
        let id = holds.hold(without_a_destination(), CHAT, answering).await;
        assert_eq!(holds.answer(&id, CHAT, false).await, Answer::Spent(Outcome::Declined));
        assert!(!sent.dispatched(), "and a decline still sends nothing");
    }

    /// What a held request did when it was answered, so a test can say it was
    /// dispatched once and never twice — and, with `cannot_go`, that a request
    /// which could not be sent at all is reported as ambiguous.
    #[derive(Clone)]
    struct Sent {
        dispatched: Arc<AtomicBool>,
        dropped: Arc<AtomicBool>,
        /// How many times the closure was run at all. A boolean cannot tell "one
        /// dispatch" from "two dispatches of the same thing", and for a race the
        /// second is the whole question.
        calls: Arc<AtomicUsize>,
        cannot_go: bool,
    }

    impl Default for Sent {
        fn default() -> Self {
            Self {
                dispatched: Arc::new(AtomicBool::new(false)),
                dropped: Arc::new(AtomicBool::new(false)),
                calls: Arc::new(AtomicUsize::new(0)),
                cannot_go: false,
            }
        }
    }

    impl Sent {
        /// A request the page has moved on from: answered yes, and it cannot be
        /// sent. Reported, never retried.
        fn unsendable() -> Self {
            Self { cannot_go: true, ..Self::default() }
        }

        fn answering(&self) -> (super::Answering, Sent) {
            let sent = self.clone();
            let closure: super::Answering = Box::new(move |yes| {
                Box::pin(async move {
                    sent.calls.fetch_add(1, Ordering::SeqCst);
                    if !yes {
                        sent.dropped.store(true, Ordering::SeqCst);
                        return false;
                    }
                    if sent.cannot_go {
                        return false;
                    }
                    sent.dispatched.store(true, Ordering::SeqCst);
                    true
                })
            });
            (closure, self.clone())
        }

        fn dispatched(&self) -> bool {
            self.dispatched.load(Ordering::SeqCst)
        }

        fn dropped(&self) -> bool {
            self.dropped.load(Ordering::SeqCst)
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    /// The id is spent by the first answer, and the second press finds nothing:
    /// one request, answered once, never attempted twice.
    #[tokio::test]
    async fn an_id_is_spent_by_the_first_answer_and_the_second_finds_nothing() {
        let holds = holds_in(CHAT).await;
        let sent = Sent::default();
        let (answering, sent) = sent.answering();
        let id = holds.hold(card(), CHAT, answering).await;

        assert_eq!(holds.answer(&id, CHAT, false).await, Answer::Spent(Outcome::Declined));
        assert!(sent.dropped(), "a decline drops the request and never dispatches it");
        assert!(!sent.dispatched());

        assert_eq!(holds.answer(&id, CHAT, true).await, Answer::Unknown, "a second press must find nothing");
        assert!(!sent.dispatched(), "a spent id must never dispatch a second request");
        assert_eq!(holds.answer("never-held", CHAT, true).await, Answer::Unknown);
    }

    /// A yes dispatches that same held request, and the model is told it was
    /// sent — once, and with the address it went to.
    #[tokio::test]
    async fn a_yes_dispatches_the_held_request_and_says_so() {
        let holds = holds_in(CHAT).await;
        let sent = Sent::default();
        let (answering, sent) = sent.answering();
        let id = holds.hold(card(), CHAT, answering).await;

        assert_eq!(holds.answer(&id, CHAT, true).await, Answer::Spent(Outcome::Sent { host: "shop.example".to_owned() }));
        assert!(sent.dispatched(), "the held request is the one that goes");
        assert_eq!(holds.take_outcomes(CHAT).await, vec![Outcome::Sent { host: "shop.example".to_owned() }]);
    }

    /// The card is the request as it would have been received, and the id on it
    /// is the one an answer quotes.
    #[tokio::test]
    async fn the_card_is_the_request_and_the_id_on_it_is_the_one_answered() {
        let holds = holds_in(CHAT).await;
        let sent = Sent::default();
        let (answering, _) = sent.answering();
        let id = holds.hold(card(), CHAT, answering).await;

        let shown = holds.card(&id).await.expect("the card is there to be read");
        assert_eq!(shown.id, id);
        assert_eq!(shown.method, "POST");
        assert_eq!(shown.url, "https://shop.example/order");
        assert_eq!(shown.fields[0], Field { name: "city".to_owned(), value: "Bologna".to_owned(), secret: false, label: None });
        assert_eq!(holds.waiting().await, 1);
    }

    /// Nobody answered in time, so it is declined and the model is told — and it
    /// is declined on this store's own clock, not on a timer somebody has to
    /// remember to start.
    #[tokio::test]
    async fn a_request_nobody_answered_expires_and_cannot_be_sent_afterwards() {
        let clock = Clock::new();
        let reader = clock.clone();
        let holds = holds_on_a_clock(move || reader.now(), CHAT).await;
        let sent = Sent::default();
        let (answering, sent) = sent.answering();
        let id = holds.hold(card(), CHAT, answering).await;

        clock.advance(EXPIRY - Duration::from_secs(1));
        assert_eq!(holds.waiting().await, 1, "it is still inside the five minutes");

        clock.advance(Duration::from_secs(2));
        assert_eq!(holds.cards().await, Vec::<Card>::new(), "an expired request is no longer a card");
        assert_eq!(holds.take_outcomes(CHAT).await, vec![Outcome::Expired]);
        assert!(sent.dropped() && !sent.dispatched(), "an expired request is never dispatched");

        assert_eq!(holds.answer(&id, CHAT, true).await, Answer::Unknown, "an expired id may not be sent");
        assert!(!sent.dispatched());
    }

    /// The window going declines everything that was waiting and dispatches
    /// nothing. One call, not one per held request: the model is told the
    /// window closed, once.
    #[tokio::test]
    async fn the_window_going_declines_everything_that_was_waiting() {
        let holds = holds_in(CHAT).await;
        let sent = Sent::default();
        let (first, sent) = sent.answering();
        holds.hold(card(), CHAT, first).await;
        let (second, _) = sent.answering();
        let id = holds.hold(card(), CHAT, second).await;
        assert_eq!(holds.waiting().await, 2);

        holds.decline_all(Outcome::Gone).await;
        assert_eq!(holds.cards().await, Vec::<Card>::new());
        assert_eq!(holds.answer(&id, CHAT, true).await, Answer::Unknown);
        assert!(sent.dropped() && !sent.dispatched(), "nothing is dispatched when the window goes");
        // **One per card, not one per window.** Each is stamped with the
        // conversation that caused it, so a window closing over two chats tells
        // each of them about its own and neither about the other's.
        assert_eq!(holds.take_outcomes(CHAT).await, vec![Outcome::Gone, Outcome::Gone]);
    }

    /// **Eight requests, and the ninth is not held.** A person is being asked to
    /// decide on a stranger's write, and one screen holding eight of them is
    /// already as much as anybody reads — a ninth is answered by pressing the top
    /// one. So the store refuses it: the route is answered as a refusal rather
    /// than parked, and the model is told in one line that the request went
    /// nowhere. Nothing is left in a hold with a page waiting behind it.
    #[tokio::test]
    async fn a_ninth_request_in_one_conversation_is_refused_and_not_held() {
        let holds = holds_in(CHAT).await;
        let mut sent = Vec::new();
        for _ in 0..MAX_HELD {
            let (route, _) = Sent::default().answering();
            holds.hold(card(), CHAT, route).await;
            sent.push(Sent::default());
        }
        assert_eq!(holds.waiting().await, MAX_HELD, "every request up to the cap is held");

        let (route, refused) = Sent::default().answering();
        holds.hold(card(), CHAT, route).await;
        assert!(refused.dropped() && !refused.dispatched(), "the ninth request is answered as a refusal, not parked");
        assert_eq!(holds.waiting().await, MAX_HELD, "and it is not held");
        assert_eq!(
            holds.take_outcomes(CHAT).await,
            vec![Outcome::Unrenderable(FULL.to_owned())],
            "and the model is told once, in one plain line"
        );

        // Another conversation's cap is its own.
        let other = holds_in("chat-b").await;
        let (route, refused) = Sent::default().answering();
        other.hold(card(), "chat-b", route).await;
        assert!(!refused.dropped(), "one conversation was refused for another's backlog");
    }

    /// **A decline nobody asked for is not a decline.** The app lets a hold go
    /// when there is nobody left to answer it — a phone that was unpaired, a write
    /// refused for want of a decision — and settles it with its own reason. Told
    /// "declined", the model reads that the person refused and tries again, which
    /// is the one thing a request nobody was shown must not earn.
    #[tokio::test]
    async fn a_decline_with_a_reason_says_nobody_was_asked_and_not_that_the_person_said_no() {
        let holds = holds_in(CHAT).await;
        let (sent, _answered) = Sent::default().answering();
        let id = holds.hold(card(), CHAT, sent).await;

        assert_eq!(
            holds.answer_why(&id, CHAT, false, Some("the phone that raised this was unpaired")).await,
            Answer::Spent(Outcome::Unrenderable("the phone that raised this was unpaired".to_owned()))
        );
        assert!(!_answered.dispatched(), "nothing was sent");
        assert_eq!(
            holds.take_outcomes(CHAT).await,
            vec![Outcome::Unrenderable("the phone that raised this was unpaired".to_owned())],
            "and the model is told why, in the same plain line every other refusal uses"
        );

        // And a person's own no is still a plain decline, with no reason attached.
        let (sent, _answered) = Sent::default().answering();
        let id = holds.hold(card(), CHAT, sent).await;
        assert_eq!(holds.answer(&id, CHAT, false).await, Answer::Spent(Outcome::Declined));
    }

    /// Nothing waiting means nothing to say: a window with no held request must
    /// not report one to the model.
    #[tokio::test]
    async fn a_window_with_nothing_waiting_says_nothing() {
        let holds = holds_in(CHAT).await;
        holds.decline_all(Outcome::Gone).await;
        assert_eq!(holds.take_outcomes(CHAT).await, Vec::new());
        assert_eq!(holds.cards().await, Vec::<Card>::new());
    }

    /// A body the person cannot be shown is refused with a reason, not held: a
    /// request nobody can see is not one to ask about.
    #[tokio::test]
    async fn a_body_that_cannot_be_shown_is_refused_and_nothing_is_held() {
        let holds = holds_in(CHAT).await;
        holds.refuse("the request carries a file, and a card cannot show a file").await;
        assert_eq!(holds.waiting().await, 0);
        assert_eq!(
            holds.take_outcomes(CHAT).await,
            vec![Outcome::Unrenderable("the request carries a file, and a card cannot show a file".to_owned())]
        );
    }

    /// The sentence names the id in a shape a host reads back, and promises
    /// nothing false. No payload is in it: the model is told a request existed,
    /// never what it carried.
    #[test]
    fn the_sentence_names_the_id_and_no_payload() {
        let said = super::awaiting("c7");
        assert!(said.starts_with("awaiting confirm c7"), "{said}");
        assert!(said.contains("nothing has been sent"), "{said}");
        for outcome in [
            Outcome::Sent { host: "shop.example".to_owned() },
            Outcome::Declined,
            Outcome::Expired,
            Outcome::Gone,
            Outcome::Unrenderable("the request carries a file, and a card cannot show a file".to_owned()),
            Outcome::Ambiguous,
        ] {
            let sentence = outcome.sentence();
            assert!(sentence.ends_with('.'), "{sentence}");
            assert!(!sentence.contains("Bologna") && !sentence.contains("hunter2"), "{sentence}");
        }
    }

    /// **The card carries the real value and prints none of it.** A field that
    /// reads as a secret is marked so the window draws dots, and `Debug` — the
    /// only way a field could reach a log or a failing assertion — shows the
    /// dots instead. What the person reads is `Serialize`, and that is the
    /// value that will be sent.
    #[test]
    fn a_secret_field_is_on_the_card_in_full_and_printed_as_dots() {
        let crate::body::Shown::Fields(fields) =
            crate::body::show("application/x-www-form-urlencoded", b"account=giulia&passphrase_2=hunter2")
        else {
            panic!("a form body is shown");
        };
        let card = Card {
            id: "c1".to_owned(),
            method: "POST".to_owned(),
            url: "https://shop.example/login".to_owned(),
            fields,
            conversation: CHAT.to_owned(),
            destination: destination_of("https://shop.example/login"),
        };
        assert!(card.fields[1].secret, "the password field is flagged: {:?}", card.fields[1]);
        assert_eq!(card.fields[1].value, "hunter2", "and the person can read it, because that is what goes");
        assert!(!card.fields[0].secret && card.fields[0].value == "giulia", "and what is not a secret is not flagged");
        assert!(!format!("{card:?}").contains("hunter2"), "nothing prints it: {card:?}");
    }

    /// **A write that was answered yes and could not be sent is ambiguous, and
    /// is never tried again.** It is the one outcome the model must not read as
    /// "not sent": the press landed, and whether the stranger's server saw
    /// anything could not be established.
    #[tokio::test]
    async fn a_write_that_could_not_be_sent_is_reported_as_ambiguous_and_not_retried() {
        let holds = holds_in(CHAT).await;
        let (answering, sent) = Sent::unsendable().answering();
        let id = holds.hold(card(), CHAT, answering).await;

        assert_eq!(holds.answer(&id, CHAT, true).await, Answer::Spent(Outcome::Ambiguous));
        assert!(!sent.dispatched() && !sent.dropped(), "it went nowhere and nothing dropped it");
        assert_eq!(holds.answer(&id, CHAT, true).await, Answer::Unknown, "and it is not tried again");
    }

    /// **Two answers to one id are one answer.** Not because a second press is
    /// refused politely afterwards, but because taking the entry and dispatching
    /// it cannot both be half done: under one lock, whichever answer got there
    /// first took the request and the other found nothing, whatever order they
    /// arrived in or how long the dispatch took.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn two_answers_to_one_id_dispatch_once_and_the_other_finds_nothing() {
        let holds = holds_in(CHAT).await;
        let (answering, sent) = Sent::default().answering();
        let id = holds.hold(card(), CHAT, answering).await;
        let other = holds.clone();
        let same_id = id.clone();

        let (one, two) = tokio::join!(holds.answer(&id, CHAT, true), other.answer(&same_id, CHAT, true));

        assert!(matches!(one, Answer::Spent(_)), "one answer spent the card: {one:?}");
        assert_eq!(two, Answer::Unknown, "and the other found nothing, whatever the order");
        assert!(sent.dispatched(), "it was dispatched");
        assert_eq!(sent.calls(), 1, "exactly once: a request is never attempted twice");
        assert_eq!(holds.ids().await, Vec::<String>::new(), "and nothing is left waiting");
    }

    /// The same race with a request behind it: **the loser must not take the next
    /// card by accident.** This is precisely what two acquisitions of the lock
    /// bought — both answers read index 0, and the second `remove` landed on
    /// whatever had moved into it, so a stranger's next request would be sent or
    /// dropped by somebody answering a card that had already been dealt with.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn an_answer_that_finds_nothing_takes_the_next_request_with_it() {
        let holds = holds_in(CHAT).await;
        let (first_answer, first) = Sent::default().answering();
        let id = holds.hold(card(), CHAT, first_answer).await;
        let (next_answer, next) = Sent::default().answering();
        let next_id = holds.hold(card(), CHAT, next_answer).await;
        let other = holds.clone();
        let same_id = id.clone();

        let (one, two) = tokio::join!(holds.answer(&id, CHAT, true), other.answer(&same_id, CHAT, false));

        assert!(
            matches!(one, Answer::Spent(_)) || matches!(two, Answer::Spent(_)),
            "one answer spent the card: {one:?} and {two:?}"
        );
        assert_eq!(holds.ids().await, vec![next_id], "the card behind is still waiting");
        assert!(!next.dispatched() && !next.dropped(), "and it was neither sent nor dropped");
        assert_eq!(first.calls() + next.calls(), 1, "exactly one request was dealt with");
    }

    /// **The ticket is the whole request, not a description of it.** A page that
    /// re-points a confirmed write at the same address with a different body is
    /// the attack this closes, and matching on method and URL alone walks
    /// straight into it.
    #[test]
    fn a_ticket_matches_the_whole_request_and_not_a_description_of_it() {
        let ticket = Ticket::of_parts(
            "POST",
            "https://shop.example/order",
            "application/x-www-form-urlencoded",
            b"city=Bologna&qty=1".to_vec(),
        );
        let same = |method: &str, url: &str, kind: &str, body: &[u8]| {
            ticket.matches_parts(method, url, kind, body)
        };

        assert!(same("post", "https://shop.example/order", "application/x-www-form-urlencoded", b"city=Bologna&qty=1"));
        assert!(
            same("POST", "https://shop.example/order", "application/x-www-form-urlencoded; charset=UTF-8", b"city=Bologna&qty=1"),
            "a charset parameter is the same request, not a different one"
        );

        assert!(!same("POST", "https://shop.example/order", "application/x-www-form-urlencoded", b"city=Bologna&qty=99"),
            "the same address with a different body is a different request");
        assert!(!same("POST", "https://shop.example/order", "application/x-www-form-urlencoded", b""),
            "and so is the same address with none");
        assert!(!same("POST", "https://shop.example/pay", "application/x-www-form-urlencoded", b"city=Bologna&qty=1"),
            "another address is another request");
        assert!(!same("PUT", "https://shop.example/order", "application/x-www-form-urlencoded", b"city=Bologna&qty=1"),
            "and so is another method");
        assert!(!same("POST", "https://shop.example/order", "application/json", b"city=Bologna&qty=1"),
            "and another content type");
    }

    /// **A probe does not spend the answer, and does not get through.** A page
    /// that races the approved request with something else gets that something
    /// held like any other write, and the approved request still goes — which
    /// is the only ordering where both halves of that are true.
    ///
    /// **Over the four parts only, and on purpose.** What the route really does
    /// is asked of a real request with a real frame, and a real frame is the
    /// whole of the rule: a probe with a byte-identical body is not a navigation
    /// and must not be able to claim the answer. This is the comparison without
    /// that, kept for the case it is good at — telling two bodies apart.
    #[tokio::test]
    async fn a_request_that_is_not_the_one_approved_neither_goes_nor_spends_the_answer() {
        let holds = holds_in(CHAT).await;
        let driving = holds.drive(CHAT);
        let _armed =
            holds.pass_next(Ticket::of_parts("POST", "https://shop.example/order", "text/plain", b"a=1".to_vec()), driving);

        assert!(
            holds.takes_parts("POST", "https://shop.example/order", "text/plain", b"a=2").await.is_none(),
            "the same address with a different body is held, not let through"
        );
        assert!(
            holds.takes_parts("POST", "https://shop.example/order", "text/plain", b"a=1").await.is_some(),
            "and the approved request still has its ticket"
        );
        assert!(
            holds.takes_parts("POST", "https://shop.example/order", "text/plain", b"a=1").await.is_none(),
            "which is spent on use, so a second one is held too"
        );
    }

    /// **An outcome is a code and a host, and a host is parsed out of the
    /// address — never cut out of it.** Everything past this point is said by
    /// whoever shows it, in their own words, and what they are given is what a
    /// stranger's server must not be able to choose. A path, a query and a
    /// fragment are all of theirs: a session token in a query is the reason.
    #[test]
    fn an_outcome_carries_a_code_and_a_parsed_host_and_nothing_of_the_rest() {
        let injected = "https://shop.example/checkout?token=sk-live-SECRET&next=//evil.example";
        assert_eq!(super::host_of(injected).as_deref(), Some("shop.example"), "the query is not the host");

        let sent = Outcome::Sent { host: super::host_of(injected).expect("an https address has a host") };
        assert_eq!(sent.code(), "sent");
        assert_eq!(sent.host(), Some("shop.example"));
        for said in [sent.sentence(), format!("{sent:?}")] {
            assert!(!said.contains("SECRET"), "nothing of the query is carried: {said}");
            assert!(!said.contains("evil.example"), "and nothing of the address after it: {said}");
            assert!(!said.contains('/'), "nor even a slash: {said}");
        }
        // A code is one of the six, and there is no seventh way to say it.
        assert_eq!(
            [
                Outcome::Sent { host: "shop.example".to_owned() },
                Outcome::Declined,
                Outcome::Expired,
                Outcome::Gone,
                Outcome::Unrenderable("the request carries a file, and a card cannot show a file".to_owned()),
                Outcome::Ambiguous,
            ]
            .map(|outcome| outcome.code()),
            ["sent", "declined", "expired", "gone", "unsendable", "unclear"]
        );
        // An address with no host to give says so rather than inventing one.
        assert_eq!(super::host_of("mailto:someone@shop.example"), None, "no host, no host");
    }

    /// **A read as a card: the address a person can judge, whole.** The value is
    /// on it — that is the reason the person is being asked — and a parameter
    /// whose name reads as a secret is marked, which changes the drawing and
    /// nothing else.
    #[test]
    fn a_read_that_carries_a_secret_is_a_card_with_the_whole_address_on_it() {
        let card = address_of("https://shop.example/go?password=hunter2&page=2", &["hunter2".to_owned()]);
        assert_eq!(card.method, "GET");
        assert_eq!(card.url, "https://shop.example/go?password=hunter2&page=2", "the address as it will be sent");
        let password = card.fields.iter().find(|one| one.name == "password").expect("the query is listed field by field");
        assert_eq!(password.value, "hunter2", "with its value, because that is what the card is for");
        assert!(password.secret, "and marked so the window can draw it as dots");
        assert!(card.fields.iter().any(|one| one.name == "page" && !one.secret && one.value == "2"));
        assert!(!format!("{card:?}").contains("hunter2"), "and nothing prints it: {card:?}");

        assert!(address_of("https://shop.example/app.css", &["hunter2".to_owned()]).fields.is_empty(), "an address with no query lists nothing");

        // A value the person typed is dotted whatever the parameter is called.
        let flipped = address_of("https://shop.example/go?field1=hunter2", &["hunter2".to_owned()]);
        assert!(flipped.fields[0].secret, "a type-flipped name does not get to read it: {:?}", flipped.fields[0]);
    }

    /// **A secret in the path is named on the card, because nothing else would
    /// show it.** The query is read pair by pair, so a query value the person
    /// typed is marked where it is. A path segment carrying the same value is in
    /// no pair: the card would show the address whole, with a value in it that
    /// the fields beside it are careful never to print — to the person, and to
    /// every log line that prints a card. So the card says what is in the path
    /// that it should not, and from then on the value is something the drawing,
    /// the masker and the log all know about.
    #[test]
    fn a_secret_in_the_path_is_named_on_the_card_and_printed_nowhere() {
        let card = address_of("https://shop.example/acct/hunter2/orders", &["hunter2".to_owned()]);
        let named = card.fields.iter().find(|one| one.secret && one.value.contains("hunter2"));
        assert_eq!(named.map(|one| one.value.as_str()), Some("hunter2"), "the path segment is named as a secret: {:?}", card.fields);
        assert_eq!(card.url, "https://shop.example/acct/hunter2/orders", "while the address still goes as it will be sent");
        assert!(!format!("{card:?}").contains("hunter2"), "and nothing prints it: {card:?}");

        // A path that carries nothing the person typed is left as it was.
        let plain = address_of("https://shop.example/acct/4471/orders", &["hunter2".to_owned()]);
        assert!(plain.fields.is_empty(), "an ordinary path is not dressed up: {:?}", plain.fields);
        // And a value too short to be a secret is not looked for anywhere.
        assert!(address_of("https://shop.example/acct/ab/orders", &["ab".to_owned()]).fields.is_empty(), "two characters is not a secret");
        // A secret the query already accounts for is not named twice.
        let both = address_of("https://shop.example/go?token=hunter2", &["hunter2".to_owned()]);
        assert_eq!(both.fields.len(), 1, "the query pair already says so: {:?}", both.fields);
    }

    /// **An id is 128 bits of the operating system's own randomness, and two
    /// requests never share one.** A counter says how many writes this browser
    /// has made, which is a thing a page can count: it would work out the id of
    /// the card above its own on the screen and name it itself. An id protects
    /// the answer, and a guessable one is a card somebody else can press.
    #[tokio::test]
    async fn an_id_is_128_random_bits_and_two_requests_never_share_one() {
        let holds = holds_in(CHAT).await;
        let mut ids = Vec::new();
        for _ in 0..64 {
            let (answering, _) = Sent::default().answering();
            ids.push(holds.hold(card(), CHAT, answering).await);
        }
        for id in &ids {
            assert_eq!(id.len(), 32, "128 bits written as hex: {id}");
            assert!(id.chars().all(|c| c.is_ascii_hexdigit()), "and nothing else: {id}");
        }
        let unique: std::collections::HashSet<&String> = ids.iter().collect();
        assert_eq!(unique.len(), ids.len(), "no id is ever handed out twice");
    }

    /// **A card belongs to the conversation whose turn raised it, and answers
    /// only there.** The id is a question about one request; the conversation is
    /// what says whose. Without it a chat that never caused a write could press
    /// a button in another, and its outcome would land in a conversation that
    /// never asked for it.
    #[tokio::test]
    async fn a_card_answers_only_in_the_conversation_that_caused_it() {
        let holds = holds_in(CHAT).await;
        let (answering, sent) = Sent::default().answering();
        let id = holds.hold(card(), CHAT, answering).await;
        assert_eq!(holds.card(&id).await.expect("the card is there").conversation, CHAT, "and it says so");

        assert_eq!(
            holds.answer(&id, "chat-b", true).await,
            Answer::Unknown,
            "another chat cannot press this button"
        );
        assert!(!sent.dispatched() && sent.calls() == 0, "and nothing is sent for asking");
        assert_eq!(holds.waiting().await, 1, "and the person who caused it still has their card");

        assert_eq!(holds.answer(&id, CHAT, true).await, Answer::Spent(Outcome::Sent { host: "shop.example".to_owned() }));
        assert!(sent.dispatched(), "its own conversation still answers it");
    }

    /// **A card carries the conversation that caused it, and the store does not
    /// get to change that afterwards.** Two chats drive one window in turn; each
    /// of their cards says whose it is, and neither can answer the other's. The
    /// store's own "who is calling" says nothing about a card already held — that
    /// is the difference between a request belonging to the turn that caused it
    /// and a card belonging to whoever happened to be looking.
    #[tokio::test]
    async fn two_conversations_hold_two_cards_and_neither_can_answer_the_others() {
        let holds = holds_in(CHAT).await;
        let (first_answering, first) = Sent::default().answering();
        let from_a = holds.hold(card(), CHAT, first_answering).await;

        // B takes the window over, exactly as a second chat would.
        holds.in_conversation("chat-b").await;
        let (second_answering, _) = Sent::default().answering();
        let from_b = holds.hold(card(), "chat-b", second_answering).await;

        assert_eq!(holds.card(&from_a).await.expect("A's card is there").conversation, CHAT, "and it still says so");
        assert_eq!(holds.card(&from_b).await.expect("B's card is there").conversation, "chat-b");
        assert_ne!(from_a, from_b, "two cards, not one seen twice");
        assert_eq!(
            holds.answer(&from_a, "chat-b", true).await,
            Answer::Unknown,
            "chat B cannot answer chat A's request, whatever it is calling now"
        );
        assert!(!first.dispatched(), "and chat A's request is untouched");
    }

    /// **A request the page makes on its own belongs to the call that navigated
    /// the page**, however many calls have run since. This is the case a shared
    /// "current conversation" gets wrong: a timer chat A's page set, firing while
    /// chat B is reading, is still A's request and must be A's card.
    #[tokio::test]
    async fn a_request_the_page_makes_later_belongs_to_the_navigation_not_to_the_caller() {
        let holds = holds_in(CHAT).await;
        holds.claim_for_turn(CHAT).await.expect("the page was free to take");

        // B is calling when the page's own request arrives.
        holds.in_conversation("chat-b").await;
        assert_eq!(holds.stamp_for_our_call().await, "chat-b", "what B causes is B's");
        assert_eq!(holds.stamp_for_the_page().await, CHAT, "but what the page does is still A's");

        // And B navigating is what moves it: a navigation destroys the document
        // that could have made that request. The owner moves the way the product
        // moves it now — A's turn ends and B's takes the page — so B is what the
        // page's own requests are stamped with from here on.
        assert!(holds.forget_owner(CHAT).await, "A's claim did not let go");
        holds.claim_for_turn("chat-b").await.expect("the page was free to take");
        assert_eq!(holds.stamp_for_the_page().await, "chat-b");
    }

    /// **A phone's next turn takes over the claim its own last turn left behind.**
    ///
    /// The release at a turn's end is best-effort, and a release that never came
    /// leaves the page stamped with that turn's claim: without a way back, the
    /// phone was then locked out of its own page for the rest of the pairing,
    /// and so was the desktop. The door allows one live turn per phone, so a
    /// claim of this phone's belongs to a turn that is over — and the next turn
    /// of that phone may take it.
    #[tokio::test]
    async fn a_phones_next_turn_takes_over_the_claim_its_own_last_turn_left_behind() {
        let holds = holds_in("phone:1").await;
        holds.claim_for_turn("phone:1:pair-a:turn-1").await.expect("the phone took the page nobody held");
        assert_eq!(holds.stamp_for_the_page().await, "phone:1:pair-a:turn-1");

        // The turn ended, and its release never came.
        assert!(
            holds.claim_for_turn("phone:1:pair-a:turn-2").await.is_some(),
            "the phone was locked out of its own page"
        );
        assert_eq!(holds.stamp_for_the_page().await, "phone:1:pair-a:turn-2", "and the page is the new turn's");
    }

    /// **And a claim of another phone's, or of a desktop's, is still refused.**
    /// The takeover is the phone's own and nobody else's.
    #[tokio::test]
    async fn a_claim_of_another_phone_or_of_a_desktop_is_not_taken_over() {
        let holds = holds_in(CHAT).await;
        holds.claim_for_turn("phone:1:pair-a:turn-1").await.expect("the phone took the page nobody held");

        assert!(holds.claim_for_turn("phone:2:pair-b:turn-1").await.is_none(), "another phone took the page");
        assert!(holds.claim_for_turn(CHAT).await.is_none(), "the desktop took a phone's page");
        assert_eq!(holds.stamp_for_the_page().await, "phone:1:pair-a:turn-1", "the page changed hands");
    }

    /// **A phone does not take over a desktop's claim either.** The takeover is
    /// one phone's own, and a desktop's page is nobody else's to take.
    #[tokio::test]
    async fn a_phone_does_not_take_over_a_desktops_claim() {
        let holds = holds_in(CHAT).await;
        holds.claim_for_turn(CHAT).await.expect("the desktop took the page nobody held");

        assert!(holds.claim_for_turn("phone:1:pair-a:turn-1").await.is_none(), "the phone took the desktop's page");
        assert_eq!(holds.stamp_for_the_page().await, CHAT, "the page changed hands");
    }

    /// **A phone paired again under a number another phone once had does not
    /// take over that phone's claim.**
    ///
    /// A device id is reused once the top one is forgotten, so the next phone
    /// paired under it is another phone and not the old one — and the page the
    /// old phone left claimed is the old phone's: it may hold the old phone's
    /// session, and the new phone has no business reading it. So the claim names
    /// the pairing as well as the phone, and a claim of another pairing is
    /// nobody's to take.
    #[tokio::test]
    async fn a_phone_paired_again_under_the_same_number_does_not_take_over_the_old_phones_claim() {
        let holds = holds_in("phone:1").await;
        holds.claim_for_turn("phone:1:pair-a:turn-1").await.expect("the phone took the page nobody held");

        // The old phone is forgotten and another is paired under its number.
        assert!(
            holds.claim_for_turn("phone:1:pair-b:turn-1").await.is_none(),
            "the new phone took the old phone's page"
        );
        assert_eq!(holds.stamp_for_the_page().await, "phone:1:pair-a:turn-1", "and the page changed hands");

        // The old phone's own next turn still may: the claim is its own.
        assert!(
            holds.claim_for_turn("phone:1:pair-a:turn-2").await.is_some(),
            "the phone was locked out of its own page"
        );
        assert_eq!(holds.stamp_for_the_page().await, "phone:1:pair-a:turn-2");
    }

    /// **The claim names its phone, its pairing and its turn, and the phone and
    /// the pairing together are what a claim is taken over by.** The split is one
    /// rule in one place: the phone may take over, the turn may not, and a
    /// desktop's name is neither.
    #[test]
    fn a_claim_names_its_phone_its_pairing_and_its_turn() {
        assert_eq!(super::phone_claim("2", "pair-a", "turn-1"), "phone:2:pair-a:turn-1");
        assert_eq!(super::phone_conversation("2"), "phone:2");
        assert!(
            super::same_phone("phone:2:pair-a:turn-1", "phone:2:pair-a:turn-2"),
            "one pairing's claims are the same phone's"
        );
        assert!(!super::same_phone("phone:2:pair-a:turn-1", "phone:3:pair-a:turn-1"), "and another phone's are not");
        assert!(
            !super::same_phone("phone:2:pair-a:turn-1", "phone:2:pair-b:turn-1"),
            "and another pairing's are not, though the number is the same"
        );
        assert!(!super::same_phone("phone:2:pair-a:turn-1", CHAT), "and a desktop's are not");
        assert!(!super::same_phone("phone:2:pair-a:turn-1", "phone:2"), "a phone's conversation alone is not a claim");
        assert!(super::is_phone("phone:2:pair-a:turn-1") && !super::is_phone(CHAT), "a phone's name says so");
    }

    /// **A call that panics lets go of the window.**
    ///
    /// The release is on **every** way out of a call — the answer it gave, the
    /// error it hit, the panic it took, the wait that was cut short — because
    /// the person has the window back only when nobody is driving it. A
    /// release that ran only on the happy path left the window ours after a
    /// panic, and a window that is ours when nobody is driving it is a window
    /// the person cannot take back.
    ///
    /// **The unwind is the real one.** The guard is dropped by the panic, exactly
    /// as a call that panicked in the middle of driving the window would drop
    /// it — and a `Drop` is what runs on that way out.
    #[tokio::test]
    async fn a_call_that_panics_lets_go_of_the_window() {
        let holds = holds_in(CHAT).await;

        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _driving = holds.drive(CHAT);
            assert_eq!(holds.driving_now().as_deref(), Some(CHAT), "the call is driving the window");
            panic!("the call went down in the middle of driving the window");
        }));

        assert!(panicked.is_err(), "the call panicked, as this proof says it does");
        assert_eq!(holds.driving_now(), None, "and the panic let go of the window");
    }

    /// **And the page the person opens by hand after that is nobody's.**
    ///
    /// This is what the panic costs when it is not paid: the person's next
    /// navigation is read as ours — the window was still driving — so the page
    /// they opened by hand stays ours, and a phone is shown a picture of a page
    /// they opened themselves. The navigation is the person's own, and with
    /// nobody driving the window it takes the page back.
    #[tokio::test]
    async fn the_page_the_person_opens_after_a_panic_is_nobody_s() {
        let holds = holds_in(CHAT).await;
        holds.claim_for_turn(CHAT).await.expect("the page was free to take");
        assert_eq!(holds.stamp_for_the_page().await, CHAT, "the page is ours to begin with");

        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _driving = holds.drive(CHAT);
            panic!("the call went down in the middle of driving the window");
        }));

        // **The person's own navigation**, with nobody driving the window.
        holds.a_main_frame_navigation().await;

        assert_eq!(holds.stamp_for_the_page().await, "", "the page belongs to nobody");
        assert_eq!(holds.stamp_for_our_call().await, "", "not even to the last actor");
    }

    /// **A call that hands the driving over does not let go of it.** A confirmed
    /// submission is answered with a navigation that is ours too, and that
    /// navigation is not the call's to release: the watch that waited for it
    /// does that. So the guard gives up the right to release and keeps the
    /// driving as it is.
    #[tokio::test]
    async fn a_guard_that_hands_the_driving_over_does_not_let_go_of_it() {
        let holds = holds_in(CHAT).await;

        holds.drive(CHAT).hand_over();

        assert_eq!(holds.driving_now().as_deref(), Some(CHAT), "the driving is still ours");
    }

    /// **A call that ends lets go of the window**, and it says so on the way
    /// out rather than on the way in: the person has the window back as soon as
    /// the call is done with it.
    #[tokio::test]
    async fn a_call_that_ends_lets_go_of_the_window() {
        let holds = holds_in(CHAT).await;

        let driving = holds.drive(CHAT);
        assert_eq!(holds.driving_now().as_deref(), Some(CHAT));
        driving.release();

        assert_eq!(holds.driving_now(), None, "the window is the person's again");
    }

    /// A confirmed submission, and what the route is given for it: **the duty
    /// of ending the driving it owns, and the navigation it starts from.**
    ///
    /// The same two things the product's route is given, asked of the store
    /// without a request: a proof about two overlapping submissions is a proof
    /// about the same thing the route does.
    async fn approve(holds: &Holds, driving: Driving, url: &str) -> Approved {
        let ticket = Ticket::of_parts("POST", url, "text/plain", url.as_bytes().to_vec());
        let _armed = holds.pass_next(ticket, driving);
        holds.takes_parts("POST", url, "text/plain", url.as_bytes()).await.expect("the submission is approved")
    }

    /// **The request these proofs are about**: one write, one order.
    const ORDER: &str = "https://shop.example/order";
    /// The body of that request, byte for byte.
    const BODY: &[u8] = b"a=1";

    /// **The ticket for that request**, armed for one driving.
    fn ticket_of_the_order() -> Ticket {
        Ticket::of_parts("POST", ORDER, "text/plain", BODY.to_vec())
    }

    /// **Two confirmed submissions that overlap, and each of them ends its own
    /// driving.**
    ///
    /// The watch of the first submission is still waiting when the second one
    /// is confirmed, and the first watch ends while the second is still waiting
    /// for its answer. **A release that was not conditional would take the
    /// driving away from the second submission**: the navigation it is waiting
    /// for would lose its owner, the receipt would belong to nobody, and the
    /// page the person is looking at would fall out of the conversation that
    /// earned it.
    ///
    /// **The two watches run at once, and the interleaving is arranged rather
    /// than waited for.** The first watch is let go through a channel and ends
    /// on the navigation that is its own receipt; the second watch is never let
    /// go and is still waiting when the first one ends. **And both handles are
    /// collected**, so a watch that panicked would fail the proof instead of
    /// being forgotten.
    #[tokio::test]
    async fn two_submissions_that_overlap_each_release_their_own_driving() {
        let holds = holds_in(CHAT).await;

        // **The first submission**, and the driving that belongs to it.
        let first = holds.drive(CHAT);
        let first_owner = holds.driving_owner().expect("the first submission drives the window");
        let first_approved = approve(&holds, first, "https://shop.example/one").await;
        // **And the driving is still ours.** The guard that armed the ticket
        // hands it over to the watch the route started rather than letting go
        // of it — the watch is what ends it — and this is what says that it did.
        assert_eq!(holds.driving_owner(), Some(first_owner), "the first submission still drives the window");

        // **And the second, while the first watch is still waiting.**
        let second = holds.drive(CHAT);
        let second_owner = holds.driving_owner().expect("the second submission drives the window");
        let second_approved = approve(&holds, second, "https://shop.example/two").await;
        assert_ne!(first_owner, second_owner, "two drivings, and two names for them");

        // **Both watches, running at once.** Each is let go through a channel;
        // the first is let go first, and the second is still waiting when the
        // first one ends.
        let (go, wait) = tokio::sync::oneshot::channel::<()>();
        let (go_second, wait_second) = tokio::sync::oneshot::channel::<()>();
        let first_task =
            holds.spawn_the_watch(first_approved, async move { let _ = wait.await; }, Duration::from_secs(30));
        let second_task =
            holds.spawn_the_watch(second_approved, async move { let _ = wait_second.await; }, Duration::from_secs(30));

        // **The first watch is let go**, and waits for the navigation that is
        // its own receipt.
        go.send(()).expect("the first watch is waiting for it");
        holds.a_main_frame_navigation().await;

        // **The first watch ends**, and it ends its own driving and no other.
        first_task.await.expect("the first watch is not a panic");
        assert_eq!(
            holds.driving_owner(),
            Some(second_owner),
            "the driving is still the second submission's: the first watch did not take it away"
        );
        assert_eq!(holds.driving_now().as_deref(), Some(CHAT), "and the window is still being driven");

        // **And the second watch is still waiting**: it was never let go, and
        // the first watch ending is not what ends it.
        assert!(!second_task.is_finished(), "the second watch is still waiting for its own answer");

        // **And the receipt of the second submission is still its own.** A
        // navigation while the second submission is driving is ours, and the
        // page stays the conversation's.
        holds.claim_for_turn(CHAT).await.expect("the page was free to take");
        holds.a_main_frame_navigation().await;
        assert_eq!(holds.stamp_for_the_page().await, CHAT, "the receipt belongs to the conversation");

        // **And the second watch ends the second driving, and only that one.**
        go_second.send(()).expect("the second watch is waiting for it");
        second_task.await.expect("the second watch is not a panic");
        assert_eq!(holds.driving_now(), None, "and now the window is the person's again");
    }

    /// **A ticket that was armed and then abandoned is taken back.**
    ///
    /// The call that arms the ticket can be cut short — the window closes, the
    /// person walks away, the app is shut down — and **the ticket it armed must
    /// not stay armed**: a later request that matches it would go through
    /// without a new approval, and the person would never have been asked.
    ///
    /// **And the window comes back.** The call that armed the ticket was
    /// driving the window, and nobody else owns it.
    #[tokio::test]
    async fn a_ticket_that_was_armed_and_then_abandoned_is_taken_back() {
        // **The control**: an armed ticket lets the request it was armed for
        // through — so what the proof below shows is the difference the abort
        // makes, and not a ticket that never worked.
        let control = holds_in(CHAT).await;
        let control_driving = control.drive(CHAT);
        let _control_armed = control.pass_next(ticket_of_the_order(), control_driving);
        assert!(
            control.takes_parts("POST", ORDER, "text/plain", BODY).await.is_some(),
            "an armed ticket lets its own request through"
        );

        // **And the abort**: the call that armed the ticket is cut short, and
        // nobody has spent it.
        let holds = holds_in(CHAT).await;
        let driving = holds.drive(CHAT);
        let armed = holds.pass_next(ticket_of_the_order(), driving);
        drop(armed);

        // **So a later request that matches the ticket does not go through**:
        // it is held like any other write, and the person is asked again.
        assert!(
            holds.takes_parts("POST", ORDER, "text/plain", BODY).await.is_none(),
            "the ticket was taken back, so the request is held like any other"
        );
        // **And the window is the person's again**: nobody else owns it.
        assert_eq!(holds.driving_now(), None, "the driving was let go of");
    }

    /// **A ticket that was spent is left to the watch.**
    ///
    /// The route spends the ticket and hands the duty to the watch it starts,
    /// and the watch is what ends the driving. **So a call that is cut short
    /// after the ticket was spent must not let go of the driving**: the watch
    /// owns it, and a guard that let go of it here would take the window away
    /// from the submission that has it — before the watch that is waiting for
    /// the receipt has finished.
    #[tokio::test]
    async fn a_ticket_that_was_spent_is_left_to_the_watch() {
        let holds = holds_in(CHAT).await;
        let driving = holds.drive(CHAT);
        let armed = holds.pass_next(ticket_of_the_order(), driving);

        // **The route spends the ticket**, and hands it to the watch it starts.
        let approved = holds
            .takes_parts("POST", ORDER, "text/plain", BODY)
            .await
            .expect("the request is the one the person approved");

        // **And now the call is cut short.**
        drop(armed);

        // **The driving is still ours**: the watch owns it, and the guard did
        // not take the window away from the submission that has it.
        assert_eq!(holds.driving_now().as_deref(), Some(CHAT), "the watch still has the driving");

        // **And the watch ends it**, when its own wait is over.
        let task = holds.spawn_the_watch(approved, std::future::ready(()), Duration::from_millis(50));
        task.await.expect("the watch is not a panic");
        assert_eq!(holds.driving_now(), None, "and now the window is the person's again");
    }

    /// **A release cannot get between the count of a navigation and the
    /// judgment of who owns the page.**
    ///
    /// The count is what tells a confirmed submission's own navigation from the
    /// one that follows it, and the judgment is what says whether the page is
    /// ours. **They have to be read at the same moment**: a navigation counted
    /// as ours and then found nobody's is a page that lost its owner between
    /// one look and the next, and the receipt of what the person approved
    /// belongs to nobody.
    ///
    /// **So the release is put exactly where the two used to be apart** — at the
    /// gate between them — and it cannot get in: the count and the owner are
    /// under one lock, and the release needs that lock.
    #[tokio::test]
    async fn a_release_cannot_get_between_the_count_and_the_judgment() {
        let holds = holds_in(CHAT).await;
        let _driving = holds.drive(CHAT);
        holds.claim_for_turn(CHAT).await.expect("the page was free to take");
        let token = holds.driving_owner().expect("the window is being driven");

        // **The release, at the gate between the count and the judgment.**
        let releaser = holds.clone();
        let got_in = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let said = got_in.clone();
        holds.gate_the_navigation(move || {
            said.store(releaser.try_let_go_of(token), std::sync::atomic::Ordering::SeqCst);
        });

        holds.a_main_frame_navigation().await;

        // **The release could not get in**, because the count is taken under the
        // lock that holds the owner.
        assert!(!got_in.load(std::sync::atomic::Ordering::SeqCst), "the release cannot get between the count and the judgment");
        // **And the navigation was counted**: it is the receipt of a submission.
        assert_eq!(holds.navigations_so_far(), 1, "the navigation was counted");
        // **And the page is still the conversation's** — the owner was read at
        // the same moment the count was taken, and nobody had let go of the
        // driving then.
        assert_eq!(holds.stamp_for_the_page().await, CHAT, "the page keeps its owner");
    }

    /// **Each submission waits for its own navigation.**
    ///
    /// A confirmed submission is answered with a navigation that is ours, and
    /// the watch waits for the navigation that follows it. **Two submissions
    /// that overlap each have their own baseline**: the navigation that is the
    /// first one's receipt came before the second one was confirmed, so it is
    /// not the second one's — and a watch that read a shared count would wait
    /// for the wrong one, and let go at the wrong time.
    #[tokio::test]
    async fn each_submission_waits_for_its_own_navigation() {
        let holds = holds_in(CHAT).await;

        // The first submission, and the navigation that is its receipt.
        let first = holds.drive(CHAT);
        let first_approved = approve(&holds, first, "https://shop.example/one").await;
        holds.a_main_frame_navigation().await;
        // The second submission, confirmed after that navigation: its own
        // baseline is one further on.
        let second = holds.drive(CHAT);
        let second_approved = approve(&holds, second, "https://shop.example/two").await;

        // **The first watch sees its own receipt** — the navigation that came
        // after its own baseline.
        assert!(
            holds.wait_for_the_navigation(first_approved.baseline, Duration::from_millis(50)).await,
            "the first submission sees the navigation that is its own receipt"
        );
        // **And the second watch does not**: that navigation came before its
        // baseline, so it is not its receipt, and the second watch is still
        // waiting for its own.
        assert!(
            !holds.wait_for_the_navigation(second_approved.baseline, Duration::from_millis(50)).await,
            "and the second submission does not: that navigation is not its own"
        );
    }

    /// **A watch that dies lets go of the driving.**
    ///
    /// The watch is a task of its own, and a task can end in ways nobody
    /// planned: cancelled, or ended by a panic. **The duty it holds is what
    /// cleans up** — the guard is dropped on the way out, and the drop is what
    /// lets go of the driving. A guard that was only disarmed by the call that
    /// handed the driving over would leave the window driven for ever when the
    /// watch died, and the person's own navigation would be read as ours.
    #[tokio::test]
    async fn a_watch_that_dies_lets_go_of_the_driving() {
        let holds = holds_in(CHAT).await;

        let driving = holds.drive(CHAT);
        let owner = holds.driving_owner().expect("the submission drives the window");
        let approved = approve(&holds, driving, "https://shop.example/one").await;
        // **The call hands the driving over**, as the call that fires a
        // confirmed submission does: the watch is what ends it. **The guard
        // that armed the ticket is what hands it over**, and it does it by
        // itself once it finds the ticket spent.
        assert_eq!(holds.driving_owner(), Some(owner), "the driving is still ours");

        // **The watch, on a task of its own.** The answer never comes, so the
        // watch is still waiting when it is killed — and the guard it owns is
        // dropped on the way out, whether the task is killed before it has run
        // or while it waits.
        let task = holds.spawn_the_watch(approved, std::future::pending::<()>(), Duration::from_secs(30));
        // Long enough for the task to have started and taken the guard.
        tokio::time::sleep(Duration::from_millis(100)).await;
        task.abort();
        let _ = task.await;

        assert_eq!(holds.driving_owner(), None, "the dead watch let go of the driving");
        assert_eq!(holds.driving_now(), None, "and the window is the person's again");
    }
}
