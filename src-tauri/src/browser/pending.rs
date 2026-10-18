//! The requests the person is being asked about (one responsibility: what the
//! window is showing a card for, and for how long).
//!
//! **This is a mirror, not the truth.** The held request lives in the sidecar,
//! which is the only thing that can dispatch or drop it. This is here so the
//! window can be told what exists without the app inventing an answer, and so a
//! card nobody gave an answer to can be taken off the window.
//!
//! **No lock is held across a call.** The guard is taken to put a card in or
//! take one out and given back before anything is asked of the sidecar. The
//! person's five minutes are not spent holding a mutex: the browser has to keep
//! answering calls the whole time they are looking at a card, and a held lock
//! would stop it — and a window closing would find a lock nobody can take.

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// How long a card is offered for. The sidecar declines anything still waiting
/// at the end of it, and this is the same five minutes: a person who presses
/// "send" five minutes later is owed nothing.
pub(crate) const ASKED_FOR: Duration = Duration::from_secs(300);

/// One request, as the window is showing it.
#[derive(Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Card {
    pub id: String,
    pub method: String,
    pub url: String,
    pub fields: Vec<Field>,
    /// The conversation whose turn caused this request. **The window draws and
    /// answers a card only in the chat it belongs to**, so a card raised in one
    /// chat cannot be pressed from another and its outcome cannot land in a
    /// conversation that never asked for the request.
    pub conversation: String,
    /// When the person was first shown this, as a clock the window can draw. It
    /// is a wall-clock stamp because it crosses the wire; what *decides* the
    /// five minutes is [`Pending::forget_stale`], which keeps its own instant
    /// here and never reads this back.
    pub asked_at_ms: u64,
}

/// **A card is printed without its secrets.** A URL can carry one — a GET held
/// for exactly that reason — and a card is what a log line, a panic or a failing
/// test reaches first. So the address is printed with every value of a field
/// marked secret replaced by dots, which is the card as the window draws it.
/// `Serialize` is how the real one reaches the person, and nowhere else.
impl std::fmt::Debug for Card {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Card")
            .field("id", &self.id)
            .field("method", &self.method)
            .field("url", &masked_address(&self.url, &self.fields))
            .field("fields", &self.fields)
            .field("conversation", &self.conversation)
            .field("asked_at_ms", &self.asked_at_ms)
            .finish()
    }
}

/// An address with every value a field marks as a secret replaced by dots.
///
/// Handled as text rather than through a URL parser: this is what a **log line**
/// prints, and a parse failure there would fall back to the whole address — which
/// is the leak this exists to stop. So anything that is not a query pair we can
/// read is left exactly as it was, and only the values whose name a secret field
/// carries are replaced.
///
/// **Decoded before it is compared, because an address is not written the way a
/// field is named.** A page that types into `pass word` puts `pass+word` or
/// `pass%20word` in the query, so comparing the encoded name against the typed
/// one finds nothing and prints the value that was there to be hidden. Names and
/// values are both read decoded, and a value that merely *carries* a secret —
/// the same containment `secret::carries` uses, because a secret does not travel
/// as one whole piece — is replaced whatever it is called.
///
/// And the whole thing is checked once more at the end: **an address that still
/// carries a secret value after masking is printed as dots, in one piece.** A
/// decode this file got wrong, a pair it could not split, a secret in the path or
/// the host — all of them end in the same place, and none of them ends in a log
/// line holding somebody's password.
fn masked_address(url: &str, fields: &[Field]) -> String {
    let secrets: Vec<&Field> = fields.iter().filter(|field| field.secret).collect();
    if secrets.is_empty() {
        return url.to_owned();
    }
    let masked = match url.split_once('?') {
        None => url.to_owned(),
        Some((address, query)) => {
            let masked: Vec<String> = query
                .split('&')
                .map(|pair| {
                    let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
                    let name = decode(name);
                    let value = decode(value);
                    let carries = secrets
                        .iter()
                        .any(|field| field.name == name || (!field.value.is_empty() && value.contains(&field.value)));
                    if carries {
                        format!("{name}={DOTS}")
                    } else {
                        pair.to_owned()
                    }
                })
                .collect();
            format!("{address}?{}", masked.join("&"))
        }
    };
    if carries_any(&masked, &secrets) { DOTS.to_owned() } else { masked }
}

/// Whether a secret value is anywhere in an address, raw or decoded — **the
/// check the masker makes on its own output**, so a masking it could not do by
/// name is caught anyway.
///
/// **It is not a check on the fields.** It asks the address, and it asks it
/// whole: a value that is in the path or the host is in no query pair to replace,
/// and the fields beside it are careful never to print — so an address that still
/// carries one is printed as dots in one piece. Every card reaches a `Debug`, and
/// a `Debug` is what a log line, a panic and a failing test read first.
fn carries_any(address: &str, secrets: &[&Field]) -> bool {
    let decoded = decode(address);
    secrets.iter().any(|field| {
        !field.value.is_empty() && (address.contains(&field.value) || decoded.contains(&field.value))
    })
}

/// A percent-decoded, form-decoded string: `%20` and `+` are both a space.
/// Anything that is not a valid escape is left as it was, because this is a log
/// line and a broken escape is not a reason to print less of it than it can.
fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'+' => {
                out.push(b' ');
                at += 1;
            }
            b'%' if at + 2 < bytes.len() => {
                match (hex(bytes[at + 1]), hex(bytes[at + 2])) {
                    (Some(high), Some(low)) => {
                        out.push(high << 4 | low);
                        at += 3;
                    }
                    _ => {
                        out.push(bytes[at]);
                        at += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// One field of a card: the value as it will be sent, and whether the window
/// should draw it as dots.
///
/// **A secret field carries its value.** The card exists so a person can check
/// what a stranger's site is about to receive, and a card that blanks one of its
/// own fields — on the page's word, or on anything the page can call — cannot be
/// checked. So the value crosses here, and `secret` is a drawing instruction: the
/// window shows dots and a Show button, and the person reads it when they want to.
///
/// What must not happen is the value going anywhere else, and that is what the
/// `Debug` below is for: it is how a field would reach a log line or a panic,
/// and it prints dots. `Serialize` is how it reaches the card, and it is the one
/// place the real value is allowed.
#[derive(Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Field {
    pub name: String,
    pub value: String,
    pub secret: bool,
    /// The words the page puts beside the field, for the person to read next to its
    /// value. **Display only**, cleaned and capped by the sidecar, and absent when the
    /// page gave none. A phone that predates it ignores the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// What stands in for a value in anything that is not the card.
const DOTS: &str = "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}";

impl std::fmt::Debug for Field {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Field")
            .field("name", &self.name)
            .field("value", &if self.secret { DOTS } else { &self.value })
            .field("secret", &self.secret)
            .finish()
    }
}

/// A card, and the instant it first appeared. The two are kept apart because
/// they are two different jobs: one is read by a renderer, the other is only
/// ever compared against a clock on this side.
#[derive(Clone)]
struct Shown {
    card: Card,
    since: Instant,
}

/// What the window is currently showing.
#[derive(Default)]
pub(crate) struct Pending(Mutex<Vec<Shown>>);

impl Pending {
    /// Replaces what is on the window with what the sidecar says is waiting,
    /// **keeping the time each card first appeared**. The sidecar is the truth
    /// about what exists; this is the only thing that knows how long a person
    /// has already been looking at it.
    pub(crate) fn replace_with(&self, from_sidecar: Vec<Card>, now: Instant) {
        let mut cards = self.lock();
        let mut kept = Vec::with_capacity(from_sidecar.len());
        for mut card in from_sidecar {
            // Both clocks are carried over, not just the one used to give up: a
            // card redrawn must show the moment it first appeared, and it is the
            // same moment the five minutes are counted from.
            if let Some(earlier) = cards.iter().find(|shown| shown.card.id == card.id) {
                card.asked_at_ms = earlier.card.asked_at_ms;
            }
            let since =
                cards.iter().find(|shown| shown.card.id == card.id).map(|shown| shown.since).unwrap_or(now);
            kept.push(Shown { card, since });
        }
        *cards = kept;
    }

    /// Everything still inside the person's five minutes, oldest first.
    ///
    /// Asked of rather than waited for, like the sidecar's own: a request that
    /// has expired must not be dispatchable even if nobody noticed, and a person
    /// is not owed a background task to be answered.
    pub(crate) fn forget_stale(&self, now: Instant) -> Vec<String> {
        let mut cards = self.lock();
        let mut stale = Vec::new();
        let mut index = 0;
        while index < cards.len() {
            if now.duration_since(cards[index].since) >= ASKED_FOR {
                stale.push(cards.remove(index).card.id);
            } else {
                index += 1;
            }
        }
        stale
    }

    /// **Takes a card off the window only where it was raised.** An id from one
    /// chat is not a card the other one can answer, and it is left on the window
    /// rather than dropped: the person who caused it is still looking at it, and
    /// taking it away because somebody else asked first is a card denied by a
    /// timing race.
    pub(crate) fn spend_in(&self, id: &str, conversation: &str) -> Option<Card> {
        let mut cards = self.lock();
        let at = cards.iter().position(|shown| shown.card.id == id && shown.card.conversation == conversation)?;
        Some(cards.remove(at).card)
    }

    /// What the window draws, oldest first.
    pub(crate) fn cards(&self) -> Vec<Card> {
        self.lock().iter().map(|shown| shown.card.clone()).collect()
    }

    /// Everything off the window: the window is gone, so nothing is waiting to
    /// be answered any more.
    pub(crate) fn clear(&self) {
        self.lock().clear();
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Shown>> {
        self.0.lock().expect("the pending cards are not poisoned")
    }
}

/// A card as the sidecar described it, ready to cross the wire.
pub(crate) fn card_of(id: &str, method: &str, url: &str, conversation: &str, fields: Vec<Field>) -> Card {
    Card {
        id: id.to_owned(),
        method: method.to_owned(),
        url: url.to_owned(),
        conversation: conversation.to_owned(),
        fields,
        asked_at_ms: now_ms(),
    }
}

/// Milliseconds since the epoch, saturating rather than wrapping: a clock set
/// before 1970 is a clock to ignore, not one to underflow on.
pub(crate) fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_millis() as u64).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{card_of, Card, Field, Pending, ASKED_FOR, DOTS};
    use std::time::{Duration, Instant};

    /// The conversation these tests are holding cards for.
    const CHAT: &str = "chat-a";

    /// Puts cards on the window the way the app does: the sidecar's list is what
    /// is on it, and the window is what keeps the time each was first shown.
    fn show(pending: &Pending, cards: Vec<Card>) {
        pending.replace_with(cards, Instant::now());
    }

    /// Whether one card is on the window, read the way the window draws it.
    fn is_shown(pending: &Pending, id: &str) -> bool {
        pending.cards().iter().any(|shown| shown.id == id)
    }

    fn card(id: &str) -> Card {
        card_of(
            id,
            "POST",
            "https://shop.example/order",
            CHAT,
            vec![Field { name: "city".to_owned(), value: "Bologna".to_owned(), secret: false, label: None }],
        )
    }

    /// A card is on the window until it is answered, and answering it twice is
    /// one answer: the second press finds nothing to press about.
    #[test]
    fn a_card_is_shown_until_it_is_answered_and_then_it_is_gone() {
        let pending = Pending::default();
        show(&pending, vec![card("c1")]);
        assert_eq!(pending.cards().len(), 1);
        assert!(is_shown(&pending, "c1"));

        assert_eq!(pending.spend_in("c1", CHAT).map(|gone| gone.id), Some("c1".to_owned()));
        assert_eq!(pending.spend_in("c1", CHAT), None, "a second press finds nothing");
        assert_eq!(pending.cards().len(), 0);
    }

    /// The same id is one card, not two to draw on top of each other.
    #[test]
    fn the_same_request_is_one_card() {
        let pending = Pending::default();
        show(&pending, vec![card("c1")]);
        show(&pending, vec![card("c1")]);
        assert_eq!(pending.cards().len(), 1, "the sidecar listing it twice is one card on the window");
    }

    /// Two requests at once are two cards, and answering one leaves the other.
    #[test]
    fn two_requests_are_two_cards_and_answering_one_leaves_the_other() {
        let pending = Pending::default();
        show(&pending, vec![card("c1"), card("c2")]);
        assert_eq!(pending.cards().len(), 2);
        pending.spend_in("c1", CHAT);
        assert!(is_shown(&pending, "c2"));
    }

    /// A window closing takes its cards with it: there is nobody left to answer.
    #[test]
    fn a_window_that_goes_takes_its_cards_with_it() {
        let pending = Pending::default();
        show(&pending, vec![card("c1")]);
        pending.clear();
        assert_eq!(pending.cards().len(), 0);
    }

    /// The sidecar is the truth about what is waiting; this is the only thing
    /// that knows how long a person has already been looking at it. Redrawing a
    /// card must not hand anybody their five minutes back.
    #[test]
    fn the_sidecar_says_what_exists_and_the_window_says_how_long_it_has_been_there() {
        let pending = Pending::default();
        show(&pending, vec![card("c1")]);
        let first_seen = pending.cards()[0].asked_at_ms;
        std::thread::sleep(Duration::from_millis(5));

        pending.replace_with(vec![card("c1"), card("c2")], Instant::now());
        assert_eq!(pending.cards().len(), 2, "the sidecar's two cards are the window's two");
        assert_eq!(
            pending.cards()[0].asked_at_ms,
            first_seen,
            "a card already on screen keeps the time it was first shown"
        );

        pending.replace_with(Vec::new(), Instant::now());
        assert_eq!(pending.cards().len(), 0, "and a card the sidecar no longer holds is gone");
    }

    /// Nobody answered inside the five minutes, so the card comes off the window
    /// and is never offered again — the app's half of the same five minutes the
    /// sidecar enforces.
    #[test]
    fn a_card_nobody_answered_is_given_up_on_and_never_offered_again() {
        let pending = Pending::default();
        show(&pending, vec![card("c1")]);
        assert_eq!(pending.forget_stale(Instant::now()), Vec::<String>::new(), "a fresh card stays");

        std::thread::sleep(Duration::from_millis(5));
        pending.replace_with(Vec::new(), Instant::now());
        show(&pending, vec![card("c1")]);
        let stale = pending.forget_stale(Instant::now() + ASKED_FOR + Duration::from_secs(1));
        assert_eq!(stale, vec!["c1".to_owned()], "an old card is given up on");
        assert_eq!(pending.cards().len(), 0, "and it is not on the window again");
    }

    /// **A URL is printed without the values its card marks as secret.** A GET
    /// is held for carrying one, so the address on the card carries it too, and a
    /// card is what a log line, a panic or a failing test reaches first.
    #[test]
    fn an_address_is_printed_with_its_secret_values_dotted() {
        let fields = vec![
            Field { name: "password".to_owned(), value: "hunter2".to_owned(), secret: true, label: None },
            Field { name: "page".to_owned(), value: "2".to_owned(), secret: false, label: None },
        ];
        let printed = format!(
            "{:?}",
            card_of("c1", "GET", "https://a.example/go?password=hunter2&page=2", CHAT, fields)
        );
        assert!(!printed.contains("hunter2"), "the value never reaches a log: {printed}");
        assert!(printed.contains("password=\u{2022}"), "and says there is one there: {printed}");
        assert!(printed.contains("page=2"), "while everything else is printed as it is: {printed}");

        let nothing = card_of("c1", "GET", "https://a.example/app.css", CHAT, Vec::new());
        assert!(format!("{nothing:?}").contains("app.css"), "an address with no query is printed as it is");
    }

    /// **A field is named the way a person named it, and an address is written
    /// the way an address is written.** `pass word` goes into the query as
    /// `pass+word` or `pass%20word`, so a masker that compares the two as they
    /// stand finds no match and prints the value it exists to hide.
    #[test]
    fn a_secret_under_a_written_name_is_dotted_too() {
        let fields = vec![Field { name: "pass word".to_owned(), value: "hunter2".to_owned(), secret: true, label: None }];
        for written in ["pass+word=hunter2", "pass%20word=hunter2"] {
            let printed =
                format!("{:?}", card_of("c1", "GET", &format!("https://a.example/go?{written}"), CHAT, fields.clone()));
            assert!(!printed.contains("hunter2"), "the value reached a log through {written}: {printed}");
            assert!(printed.contains("\u{2022}"), "and the address is still there, dotted: {printed}");
        }
    }

    /// **A secret does not travel as one whole piece, and it is not always under
    /// the name a page chose for it** — the same containment `secret::carries`
    /// uses, because a value welded to an id is the same mail to a stranger's
    /// server as the value on its own.
    #[test]
    fn a_secret_value_is_dotted_whatever_the_page_called_the_field() {
        let fields = vec![Field { name: "token".to_owned(), value: "hunter2".to_owned(), secret: true, label: None }];
        let printed = format!(
            "{:?}",
            card_of("c1", "GET", "https://a.example/go?session=prefix-hunter2-suffix&page=2", CHAT, fields)
        );
        assert!(!printed.contains("hunter2"), "a value inside a bigger one still reached a log: {printed}");
        assert!(printed.contains("page=2"), "while the rest of the address is still readable: {printed}");
    }

    /// **What masking could not do by name is caught at the end anyway, and the
    /// check is on the address rather than on the fields.** A secret in the path
    /// or the host is in no query pair to replace, so the whole address is printed
    /// as dots: a log line that says nothing about where the address went is worth
    /// more than one that holds somebody's password. The sidecar is what names a
    /// path secret, so a card that arrives here with no field at all has nothing
    /// to check against — this is the last thing standing between an address and
    /// a log, and it is deliberately blind to the field names.
    #[test]
    fn a_secret_is_dotted_wherever_it_sits_and_whatever_the_field_is_called() {
        let fields = vec![Field { name: "a-form-field".to_owned(), value: "hunter2".to_owned(), secret: true, label: None }];
        // No query pair carries it, and its name matches nothing, so the field
        // cannot be used to find it: the whole address is dotted.
        for url in ["https://a.example/hunter2/page", "https://hunter2.example/page"] {
            let printed = format!("{:?}", card_of("c1", "GET", url, CHAT, fields.clone()));
            assert!(!printed.contains("hunter2"), "the value reached a log through {url}: {printed}");
            assert!(printed.contains("url: \"\u{2022}"), "and the address itself is not printed: {printed}");
        }

        // **And an address that carries nothing is not treated as one that might.**
        // This is containment, not suspicion: a field marked secret is a value the
        // person does not want read out, and a page may hold one and not put it
        // in every address it makes. Hiding every address would leave the person
        // unable to tell what they are agreeing to.
        for url in ["https://a.example/go?session=zzz", "https://a.example/go"] {
            let printed = format!("{:?}", card_of("c1", "GET", url, CHAT, fields.clone()));
            assert!(printed.contains("a.example"), "an address that carries nothing is still read: {printed}");
        }
    }
    #[test]
    fn an_address_still_carrying_a_secret_is_printed_as_dots() {
        let fields = vec![Field { name: "token".to_owned(), value: "hunter2".to_owned(), secret: true, label: None }];
        for url in ["https://a.example/hunter2/page", "https://hunter2.example/page"] {
            let printed = format!("{:?}", card_of("c1", "GET", url, CHAT, fields.clone()));
            assert!(!printed.contains("hunter2"), "the value reached a log: {printed}");
            assert!(printed.contains("url: \"\u{2022}"), "and the address itself is not printed: {printed}");
        }
        // A field with no value carries nothing, so it cannot make an address
        // unsafe: it still dots the pair it is named after, and no other.
        let empty = vec![Field { name: "token".to_owned(), value: String::new(), secret: true, label: None }];
        let printed = format!("{:?}", card_of("c1", "GET", "https://a.example/go?token=x&page=2", CHAT, empty));
        assert!(printed.contains("token=\u{2022}"), "its own name is still dotted: {printed}");
        assert!(printed.contains("page=2"), "and an empty value takes nothing else with it: {printed}");
        assert!(printed.contains("a.example"), "nor is the whole address hidden: {printed}");
    }

    /// **A card says when it was shown, and a secret field crosses with its
    /// value.** The window is the only place that value is wanted: the person is
    /// deciding whether a stranger's site may have it, and a card that does not
    /// say is not a card they can decide on.
    #[test]
    fn a_card_carries_a_time_the_window_can_draw_and_a_secret_field_crosses_in_full() {
        let built = card_of(
            "c1",
            "POST",
            "https://shop.example/login",
            CHAT,
            vec![Field { name: "password".to_owned(), value: "hunter2".to_owned(), secret: true, label: None }],
        );
        assert_eq!(built.method, "POST");
        assert!(built.asked_at_ms > 0, "a card with no time is a card with no clock");
        assert!(built.fields[0].secret, "the field is flagged, so the window draws it as dots");
        assert_eq!(built.fields[0].value, "hunter2", "and the person can read it when they ask to");
        assert!(!format!("{built:?}").contains("hunter2"), "while nothing that prints a field ever does");

        assert_eq!(ASKED_FOR, Duration::from_secs(300), "the window gives up when the sidecar does");
        assert!(DOTS.chars().all(|dot| dot == '\u{2022}'), "and what stands in for it is dots");
    }
}