//! What a request that passed the guard may do next (one responsibility: the
//! write that is held, the card that shows it, and the one answer that spends it).
//!
//! Slice 1 refused every non-GET. Step 4 holds it instead: the route catches the
//! request, nothing is dispatched, and the card shows **that request** — URL,
//! method, and the fields as sent — so the person's yes is given to the payload
//! the site would really have received, never to a guess about it.
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
    /// The one write already answered, which the route is to let past rather
    /// than hold again. **Exactly one, matched on the whole request, and spent
    /// on first use** — see [`Ticket`].
    pass: Option<Ticket>,
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
}

impl Default for Holds {
    fn default() -> Self {
        Self::new()
    }
}

impl Holds {
    pub fn new() -> Self {
        Self::of_one_window()
    }

    /// A store of holds bound to a window's own pause, so a pause pressed
    /// before the window started is the pause the first page finds.
    pub fn bound_to(paused: Arc<std::sync::atomic::AtomicBool>) -> Self {
        Self { inner: Arc::new(Mutex::new(Inner::default())), now: Arc::new(Instant::now), paused }
    }

    fn of_one_window() -> Self {
        Self::bound_to(Arc::new(std::sync::atomic::AtomicBool::new(false)))
    }

    /// The held writes, with the clock the caller supplies. **Only a test has
    /// any reason to name one**, and the one it names is the only thing that
    /// makes five minutes something a test can watch.
    #[cfg(test)]
    pub fn on_a_clock(now: impl Fn() -> Instant + Send + Sync + 'static) -> Self {
        Self { inner: Arc::new(Mutex::new(Inner::default())), now: Arc::new(now), paused: Arc::new(std::sync::atomic::AtomicBool::new(false)) }
    }

    /// **Names the call that is running now.** Every request it causes carries
    /// that id, and an answer that does not quote it finds nothing: a card raised
    /// in one chat cannot be pressed in another, and a note cannot land in a
    /// conversation that never asked for the request.
    pub async fn in_conversation(&self, conversation: &str) {
        self.inner.lock().await.calling = conversation.to_owned();
    }

    /// **Records the conversation that navigated this page**, for a request the
    /// page makes on its own afterwards. This is captured per navigation rather
    /// than read from whoever is calling, because a card belongs to the turn
    /// that caused the request: a timer A's page set, firing while some other
    /// chat happens to be reading, is still A's request.
    pub async fn navigated_by(&self, conversation: &str) {
        let mut inner = self.inner.lock().await;
        inner.navigated = conversation.to_owned();
        inner.calling = conversation.to_owned();
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
    pub async fn see_request(&self, request: &Request) {
        if request.is_navigation_request() {
            self.forget_labels().await;
        }
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
    pub async fn pass_next(&self, ticket: Ticket) {
        self.inner.lock().await.pass = Some(ticket);
    }

    /// **Throws the answer away.** Used when the dispatch could not be carried
    /// out: the person said yes, and nothing went — so the answer must not be
    /// left where a later request of ours could pick it up and send.
    pub async fn revoke_pass(&self) {
        self.inner.lock().await.pass = None;
    }

    /// Whether an answer is still waiting to be claimed, which is how a dispatch
    /// finds out that the request it started never arrived.
    pub async fn answer_pending(&self) -> bool {
        self.inner.lock().await.pass.is_some()
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
    pub async fn takes_pass(&self, request: &Request) -> bool {
        let mut inner = self.inner.lock().await;
        if !inner.pass.as_ref().is_some_and(|wanted| wanted.matches(request)) {
            return false;
        }
        inner.pass = None;
        true
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
    #[cfg(test)]
    pub async fn takes_parts(&self, method: &str, url: &str, content_type: &str, body: &[u8]) -> bool {
        let mut inner = self.inner.lock().await;
        if !inner.pass.as_ref().is_some_and(|wanted| wanted.matches_parts(method, url, content_type, body)) {
            return false;
        }
        inner.pass = None;
        true
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
/// `X-HTTP-Method-Override` and the same URL and body gets held like any other
/// write. A frame's own navigation cannot claim it either, so only the
/// navigation FIRE starts — in the main document — is let through.
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
        if !request.is_navigation_request() || request.frame().and_then(|frame| frame.parent_frame()).is_some() {
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
const TOO_LONG: &str = "its address is longer than 8 KiB, which is more than a card can show a person";

/// **Holds one write, or refuses it.** The route that would have dispatched it
/// is parked in the store with the card, and this handler returns without
/// answering it: an answer arrives on its own call, minutes later.
///
/// A body the person cannot be shown is not held — there would be no card to ask
/// about — so it is refused here and the model is told why on its next call.
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
    // A read that is not one has nothing in a body to show: what it carries is
    // in its address, and the address is shown whole.
    if is_read(request.method()) {
        let typed = holds.typed().await.values();
        let shown = address_of(request.url(), &typed);
        return park(holds, shown, route).await;
    }
    let typed = holds.typed().await.values();
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
    park(holds, Card { id: String::new(), method: request.method().to_ascii_uppercase(), url: request.url().to_owned(), fields, conversation: String::new() }, route).await
}

/// **Parks the route with a card.** Resuming **this** route sends the bytes the
/// browser already built, so the request that goes out is the one the card was
/// drawn from by definition. No ticket is needed for it: there is nothing to
/// rebuild and nothing for the page to have changed in between.
async fn park(holds: &Holds, card: Card, route: Route) -> Result<(), playwright_rs::Error> {
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
        return Card { id: String::new(), method: "GET".to_owned(), url: url.to_owned(), fields: Vec::new(), conversation: String::new() };
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
    Card { id: String::new(), method: "GET".to_owned(), url: url.to_owned(), fields, conversation: String::new() }
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
    use super::{address_of, Answer, Card, Holds, Outcome, Ticket, EXPIRY, FULL, MAX_HELD};
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
        }
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
        holds.pass_next(Ticket::of_parts("POST", "https://shop.example/order", "text/plain", b"a=1".to_vec())).await;

        assert!(
            !holds.takes_parts("POST", "https://shop.example/order", "text/plain", b"a=2").await,
            "the same address with a different body is held, not let through"
        );
        assert!(
            holds.takes_parts("POST", "https://shop.example/order", "text/plain", b"a=1").await,
            "and the approved request still has its ticket"
        );
        assert!(
            !holds.takes_parts("POST", "https://shop.example/order", "text/plain", b"a=1").await,
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
        holds.navigated_by(CHAT).await;

        // B is calling when the page's own request arrives.
        holds.in_conversation("chat-b").await;
        assert_eq!(holds.stamp_for_our_call().await, "chat-b", "what B causes is B's");
        assert_eq!(holds.stamp_for_the_page().await, CHAT, "but what the page does is still A's");

        // And B navigating is what moves it: a navigation destroys the document
        // that could have made that request.
        holds.navigated_by("chat-b").await;
        assert_eq!(holds.stamp_for_the_page().await, "chat-b");
    }
}
