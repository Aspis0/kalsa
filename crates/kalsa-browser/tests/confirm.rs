//! The write that is held, the card that shows it, and the answer that spends it.
//!
//! Every test here drives a **real form in a real browser** and watches the
//! fixture server, which is the only thing that can say whether a request was
//! dispatched: a card that exists proves a request was *offered*, never that it
//! went. So each one asks the server, not the store, and the store is only ever
//! asked what the person is about to be shown.
//!
//! The route that holds here is **the product's own** (`hold::hold_write`). The
//! fixture is on this computer's own network, which the guard refuses by
//! address, so `common::browser_allowing` stands in for the address decision and
//! nothing else — exactly as it already stands in for it everywhere else.

mod common;

use kalsa_browser::hold::{self, Outcome};
use kalsa_browser::{input, mcp, snapshot};
use playwright_rs::protocol::Page;
use std::time::{Duration, Instant};

/// The host of an address, for the outcome an answer is checked against. An
/// outcome names where a request went and nothing else — no path, no query.
fn host_of(url: &str) -> String {
    kalsa_browser::hold::host_of(url).expect("an address with a host")
}

/// An id is 128 random bits, so this is its shape and nothing about its value:
/// a card id is a capability and a test must not depend on what it happens to be.
fn is_a_card_id(id: &str) -> bool {
    id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// A shop, with three ways to make it send something and one body that cannot be
/// shown. Every one of them is a way a page really sends a request.
const SHOP: &str = r#"
  <h1>the shop</h1>
  <form id="order" action="/order" method="post">
    <label for="city">the city</label>
    <input id="city" name="city" type="text">
    <label for="what">the item</label>
    <input id="what" name="item" type="text">
    <input type="hidden" name="csrf" value="a-token-the-model-never-wrote">
    <button type="submit">buy it</button>
  </form>
  <form id="second" action="/order" method="post">
    <label for="note">a note</label>
    <input id="note" name="note" type="text">
    <button type="button" onclick="document.getElementById('second').requestSubmit()">send it</button>
  </form>
  <button type="button" onclick="fetch('/login', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'user=giulia&password_x=hunter2'})">sign in</button>
  <button type="button" onclick="fetch('/note', {method: 'POST', body: 'just a sentence'})">post a sentence</button>
  <button type="button" onclick="(() => {
    const form = new FormData();
    form.append('cv', new Blob(['%PDF-1.4'], {type: 'application/pdf'}), 'cv.pdf');
    fetch('/upload', {method: 'POST', body: form});
  })()">upload a file</button>
  <form id="upload" action="/upload" method="post" enctype="multipart/form-data">
    <label for="cv">a file to send</label>
    <input id="cv" name="cv" type="file">
    <button type="submit">upload it</button>
  </form>
  <p id="after">nothing has been sent</p>
  <script>
    document.addEventListener('submit', () => {
      document.getElementById('after').textContent = 'the form submitted';
    });
  </script>
"#;

/// What the browser asked the fixture to do, in its own words, so a test can say
/// "nothing new arrived" without counting the page it is already standing on.
#[derive(Clone)]
struct Arrivals(common::Arrived);

impl Arrivals {
    fn of(arrived: &common::Arrived) -> Self {
        Self(arrived.clone())
    }

    fn so_far(&self) -> usize {
        self.0.requests().len()
    }

    /// The lines added since this was taken — the requests a test caused.
    fn since(&self, mark: usize) -> Vec<String> {
        self.0.requests().into_iter().skip(mark).collect()
    }
}

/// Clicks through **the product's own hold**, so a proof about what a click
/// sends is a proof about what a click sends. `None` means the click caused no
/// write at all — or one there is no card for, which is a refusal and not a hold.
async fn clicking(page: &Page, holds: &hold::Holds, id: &str) -> Option<String> {
    let before = holds.ids().await;
    let (clicked, held) = mcp::acting(page, holds, common::CHAT, &before, common::the_fixture, input::click(page, id)).await;
    clicked.expect("the click lands");
    held
}

/// The same click, for the proofs that one write *is* held.
async fn click_holds(page: &Page, holds: &hold::Holds, id: &str) -> String {
    clicking(page, holds, id).await.expect("the click sent something the person has not agreed to")
}

/// Fills and lets Enter do what it does, the same way.
async fn filling(page: &Page, holds: &hold::Holds, id: &str, text: &str) -> (bool, Option<String>) {
    let before = holds.ids().await;
    let (filled, held) = mcp::acting(page, holds, common::CHAT, &before, common::the_fixture, input::fill(page, id, text)).await;
    (filled.expect("the field is filled"), held)
}

/// A sign-in page whose password box is named after nothing in particular: what
/// is hidden is decided on the value, not on what the page calls the field.
const LOGIN: &str = r#"
  <h1>the shop</h1>
  <form id="login" action="/login" method="post">
    <label for="account">the account</label>
    <input id="account" name="account" type="text">
    <label for="passphrase_2">the passphrase</label>
    <input id="passphrase_2" name="passphrase_2" type="password">
    <button type="submit">sign in</button>
  </form>
"#;

/// **A page whose own navigation is a GET carrying what the person just typed** —
/// the shape that is a read by method and a secret by content — plus a field
/// whose `autocomplete` is a *list* of tokens, which is where the three copies
/// of "is this a secret field" had drifted apart.
const LEAKY: &str = r#"
  <h1>the leaky shop</h1>
  <form id="leak" action="/go" method="get">
    <label for="secret">the passphrase</label>
    <input id="secret" name="password" type="password">
    <button type="submit">carry it</button>
  </form>
  <form id="racer" action="/order" method="post">
    <input type="hidden" name="city" value="Bologna">
    <button type="submit">race it</button>
  </form>
  <form id="tokens" action="/tokens" method="post">
    <input type="hidden" name="who" value="giulia">
    <label for="listed">the listed one</label>
    <input id="listed" name="listed" type="text" autocomplete="section-login current-password">
      <button type="submit" name="go" value="now">post it</button>
  </form>
  <form id="script" action="javascript:window.__kalsaRan = true" method="post">
    <input type="hidden" name="note" value="a-script-action">
    <button type="submit">run it</button>
  </form>
  <form id="mail" action="mailto:someone@shop.example" method="post">
    <input type="hidden" name="note" value="a-mail-action">
    <button type="submit">mail it</button>
  </form>
"#;

/// The body the server received at one path, waiting for it to arrive: the
/// answer is given the moment it is spent and the bytes land a moment after
/// that, so this is the wait for the wire and not for the person.
async fn poll_for_body(arrived: &common::Arrived, path: &str, tries: usize) -> Option<String> {
    for _ in 0..tries {
        if let Some(body) = arrived.body_of(path) {
            return Some(body);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    None
}

/// Waits for a request the person allowed to actually reach the site. The answer
/// is given the moment it is spent, and the request is on the wire a moment
/// after that: this is the wait for the wire, not for the person.
async fn reached(seen: &Arrivals, mark: usize, count: usize) -> Vec<String> {
    for _ in 0..100 {
        if seen.since(mark).len() >= count {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    seen.since(mark)
}

/// The ref on the line naming this element. **Any** bracketed ref, not one
/// shaped like `e12`: the generation a ref is written with changes after a
/// navigation, and a helper that only understood one of them would fail on the
/// second page of every test.
fn ref_on(read: &str, name: &str) -> Option<String> {
    let line = read.lines().find(|line| line.contains(name) && line.contains('['))?;
    let open = line.find('[')?;
    let close = line[open..].find(']')? + open;
    Some(line[open + 1..close].to_string())
}

/// The ref a read printed for an element, found the way a model finds it.
async fn ref_of(page: &Page, name: &str) -> String {
    let read = snapshot::snapshot(page, 1).await.expect("the page reads");
    ref_on(&read, name).unwrap_or_else(|| panic!("no read line names {name} with a ref:\n{read}"))
}

/// The ref, once the page is there. A page that has just moved needs a moment,
/// and a test that read once and panicked would be a test about timing.
async fn ref_of_eventually(page: &Page, name: &str, tries: usize) -> String {
    for _ in 0..tries {
        if let Ok(read) = snapshot::snapshot(page, 1).await {
            if let Some(found) = ref_on(&read, name) {
                return found;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let read = snapshot::snapshot(page, 1).await.unwrap_or_else(|why| panic!("the page does not read: {why}"));
    panic!("no read line names {name} with a ref at {}:\n{read}", page.url());
}

fn named<'a>(fields: &'a [hold::CardField], name: &str) -> Option<&'a str> {
    fields.iter().find(|field| field.name == name).map(|field| field.value.as_str())
}

/// **Enter is what a form submits on**, so this is the write a model most easily
/// causes without meaning to. The request is held with the payload as it would
/// have been sent, hidden field included, and the fixture has heard nothing.
#[tokio::test]
async fn a_form_submit_from_enter_is_held_with_the_payload_as_it_would_have_been_sent() {
    let (base, arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-enter", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    let city = ref_of(&page, "the city").await;
    let (pressed, waiting) = filling(&page, &holds, &city, "Bologna").await;
    assert!(pressed, "Enter is pressed");

    let waiting = waiting.expect("the submit is held, and nothing was sent");
    assert!(is_a_card_id(&waiting), "the submit is held, and it has an id: {waiting}");
    assert_eq!(seen.since(before), Vec::<String>::new(), "a held request reaches nobody");

    let card = holds.card(&waiting).await.expect("the card the person reads");
    assert_eq!(card.method, "POST");
    assert_eq!(card.url, format!("{base}/order"));
    assert_eq!(named(&card.fields, "city"), Some("Bologna"), "the value as it was written");
    assert_eq!(
        named(&card.fields, "csrf"),
        Some("a-token-the-model-never-wrote"),
        "a hidden field is a field: the card is what the site would really receive"
    );

    // And the person saying yes is what sends it — not the fill, and not the
    // wait.
    holds.answer(&waiting, common::CHAT, true).await;
    let went = reached(&seen, before, 1).await;
    assert_eq!(went.len(), 1, "the request went after the answer: {went:?}");
    assert!(went[0].starts_with("POST /order"), "and it went as it was written");
}

/// A click on submit is held the same way, and only the person's yes dispatches
/// it. The page is left exactly as it was until then.
#[tokio::test]
async fn a_click_on_submit_is_held_and_only_the_person_sends_it() {
    let (base, arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-click", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    let buy = ref_of(&page, "buy it").await;
    let waiting = click_holds(&page, &holds, &buy).await;
    assert!(is_a_card_id(&waiting), "the click's request is held: {waiting}");
    assert_eq!(seen.since(before), Vec::<String>::new(), "nothing was sent by the click");
    let card = holds.card(&waiting).await.expect("a card");
    assert_eq!(card.method, "POST");
    assert_eq!(holds.answer(&waiting, common::CHAT, false).await, hold::Answer::Spent(Outcome::Declined));
    assert_eq!(seen.since(before), Vec::<String>::new(), "a decline sends nothing");
    assert_eq!(page.url(), format!("{base}/"), "and the browser is still on the page it was on");
    assert!(
        snapshot::snapshot(&page, 1).await.expect("the page reads").contains("the shop"),
        "the page is as it was — not Chrome's error page, which is what aborting a held \
         navigation used to leave behind"
    );
}

/// A scripted `requestSubmit()` is a route like any other: the page did it
/// without a click, and it is held without a click.
#[tokio::test]
async fn a_scripted_request_submit_is_held_the_same_way_a_click_is() {
    let (base, arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-scripted", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    let send = ref_of(&page, "send it").await;
    let waiting = click_holds(&page, &holds, &send).await;
    assert!(is_a_card_id(&waiting), "a scripted submit is held: {waiting}");
    assert_eq!(seen.since(before), Vec::<String>::new());
    assert_eq!(holds.answer(&waiting, common::CHAT, true).await, hold::Answer::Spent(Outcome::Sent { host: host_of(&format!("{base}/order")) }));
    assert_eq!(reached(&seen, before, 1).await.len(), 1, "and it went only once the person said so");
}

/// **A body a card cannot show honestly is refused, not held.** There would be
/// no card to ask about, and a request nobody can see is not one to ask about.
///
/// The page builds the body itself: a file input sends nothing until a file is
/// chosen, so a `Blob` with a filename is the honest way to make a browser send
/// a multipart part that carries a file.
#[tokio::test]
async fn a_body_the_person_cannot_be_shown_is_refused_and_nothing_is_sent() {
    let (base, arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-file", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    let upload = ref_of(&page, "upload a file").await;
    assert!(clicking(&page, &holds, &upload).await.is_none(), "a file is caught and refused, never held");
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert!(holds.ids().await.is_empty(), "nothing is held: there is no card to ask about");
    assert_eq!(seen.since(before), Vec::<String>::new(), "and nothing was sent");
    assert_eq!(
        holds.take_outcomes(common::CHAT).await,
        vec![Outcome::Unrenderable("the request carries a file, and a card cannot show a file".to_owned())],
        "and the model is told why, in one line"
    );
}

/// **An address nobody is going to read is not a card.** The address crosses as it
/// is, whole, to the window, to the phone and into the note the model reads, so a
/// page that puts twenty kilobytes in its query would spend the person's screen —
/// and, on the phone's side, a card event that has to fit in one megabyte — on a
/// line they cannot check. A card that cannot be checked is a card they cannot
/// answer, so the write is refused: nothing is held, nothing is sent, and the
/// model is told why in one line.
///
/// The button builds the address, so the request is exactly at the cap, and the
/// cap is the sidecar's own number rather than a copy of it.
#[tokio::test]
async fn an_address_over_the_cap_is_refused_and_nothing_is_held() {
    let long = format!(
        r#"<h1>the shop</h1>
  <button type="button" onclick="fetch('/order?q=' + 'a'.repeat({}), {{method: 'POST', body: 'x'}}); this.textContent = 'sent'">fill the query</button>
  <script>document.addEventListener('submit', () => {{}});</script>"#,
        hold::MAX_URL
    );
    let (base, arrived) = common::serve(&[common::page(&long)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-long-url", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    let long_ref = ref_of(&page, "fill the query").await;
    assert!(clicking(&page, &holds, &long_ref).await.is_none(), "an address over the cap is refused, never held");
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert!(holds.ids().await.is_empty(), "nothing is held: there is no card to ask about");
    assert_eq!(seen.since(before), Vec::<String>::new(), "and nothing was sent");
    let said = holds.take_outcomes(common::CHAT).await;
    assert_eq!(said.len(), 1, "and the model is told once: {said:?}");
    assert!(
        matches!(&said[0], Outcome::Unrenderable(why) if why.contains("8 KiB")),
        "in one plain line saying why: {said:?}"
    );
}

/// **The id is spent before dispatch and never retried.** The second press finds
/// nothing, so a person who presses twice has sent one request.
#[tokio::test]
async fn an_answer_is_single_use_and_the_second_press_sends_nothing_more() {
    let (base, arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-twice", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    let buy = ref_of(&page, "buy it").await;
    let id = click_holds(&page, &holds, &buy).await;

    assert!(matches!(holds.answer(&id, common::CHAT, true).await, hold::Answer::Spent(_)));
    assert_eq!(holds.answer(&id, common::CHAT, true).await, hold::Answer::Unknown, "a second press finds nothing");
    assert_eq!(reached(&seen, before, 1).await.len(), 1, "one request, not two");
}

/// **A second browser call runs while a confirm is pending.** This is the test
/// that says no mutex is held across a held route: the person has minutes to
/// answer, and everything else has to keep working in the meantime.
#[tokio::test]
async fn the_browser_still_answers_while_a_request_is_waiting_for_the_person() {
    let (base, _arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-concurrent", &base).await;

    let buy = ref_of(&page, "buy it").await;
    let id = click_holds(&page, &holds, &buy).await;

    // A read, while the person has not answered anything yet.
    let read = snapshot::snapshot(&page, 1).await.expect("a read runs while a confirm is pending");
    assert!(read.contains("the shop"));
    // And the person can still be shown the card, which is what the window does
    // with it for as long as it is waiting.
    assert!(holds.card(&id).await.is_some(), "the card is still there to be read");

    holds.answer(&id, common::CHAT, true).await;
}

/// The call does not wait for the person, so it answers **inside the MCP
/// deadline** with an id. A held navigation never finishes, so a call that waited
/// for the page would answer with a driver error at the deadline instead.
#[tokio::test]
async fn the_call_answers_within_the_deadline_while_the_request_is_still_held() {
    let (base, arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-deadline", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    let buy = ref_of(&page, "buy it").await;
    let began = Instant::now();
    let held_by = click_holds(&page, &holds, &buy).await;
    let took = began.elapsed();

    assert!(is_a_card_id(&held_by), "and it is held before the call answers: {held_by}");
    assert!(took < Duration::from_secs(10), "the call answered in {took:?}, not inside the deadline");
    assert_eq!(seen.since(before), Vec::<String>::new(), "and nothing was sent while it waited");
}

/// A `fetch` that writes is a request like any other: it does not navigate, and
/// it is still held.
///
/// **What the person typed is hidden, and what the model typed is not.** The
/// model filled this form, so nothing here is anyone's secret and the card shows
/// it in full — including the field the page has named to look like a secret.
#[tokio::test]
async fn what_the_model_typed_is_shown_in_full_even_under_a_secret_name() {
    let (base, arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-fetch", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    let sign_in = ref_of(&page, "sign in").await;
    let waiting = click_holds(&page, &holds, &sign_in).await;
    assert!(is_a_card_id(&waiting), "a scripted write is held too: {waiting}");
    assert_eq!(seen.since(before), Vec::<String>::new());
    let card = holds.card(&waiting).await.expect("a card");

    assert_eq!(named(&card.fields, "user"), Some("giulia"));
    assert_eq!(
        named(&card.fields, "password_x"), Some("hunter2"),
        "the page named this to get it hidden and it is not: a name is not evidence"
    );
    // **A name may add dots; it may never take a value away.** This request came
    // from the page's own `fetch`, so there is no element behind it and the name
    // is all there is to go on — which is why `password_x` is drawn as dots. The
    // value is on the card either way, and pressing Show gives it back.
    let dotted = card.fields.iter().find(|field| field.name == "password_x").expect("the field is there");
    assert_eq!(dotted.value, "hunter2", "a name can add dots and cannot remove a value");
    assert!(dotted.secret, "and this one does read as a password");
    assert!(!card.fields.iter().any(|field| field.name == "user" && field.secret), "while an ordinary field is not dotted");
}

/// **A value the person typed into a password field is on the card, flagged.**
///
/// The card is what they are deciding on, and the decision is whether a
/// stranger's site may have their password: a card that had already thrown it
/// away could not answer that, and neither could one that printed it by accident.
/// So it is there in full, marked so the window draws it as dots behind a Show
/// button, and absent from everything that prints.
#[tokio::test]
async fn a_value_the_person_typed_is_on_the_card_and_printed_nowhere() {
    let (base, arrived) = common::serve(&[common::page(LOGIN), common::page_at("/login", "<h1>signed in</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-typed-secret", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    page.evaluate::<(), ()>(
        r"() => {
          const set = (id, value) => {
            const el = document.getElementById(id);
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          set('account', 'giulia');
          set('passphrase_2', 'hunter2');
        }",
        None,
    )
    .await
    .expect("the person types");
    let sign_in = ref_of(&page, "sign in").await;
    let waiting = click_holds(&page, &holds, &sign_in).await;
    let card = holds.card(&waiting).await.expect("a card");

    let typed = card.fields.iter().find(|field| field.name == "passphrase_2").expect("the field is there");
    assert!(typed.secret, "it is flagged, so the window draws it as dots");
    assert_eq!(typed.value, "hunter2", "and the person can read it when they ask to");
    assert!(!format!("{card:?}").contains("hunter2"), "while nothing that prints it ever does: {card:?}");
    assert_eq!(
        named(&card.fields, "account"),
        Some("giulia"),
        "what they typed into an ordinary field is not a secret and is not dotted"
    );

    // And the model is told a request existed and not one word of what it said.
    holds.answer(&waiting, common::CHAT, false).await;
    for outcome in holds.take_outcomes(common::CHAT).await {
        let said = outcome.sentence();
        assert!(!said.contains("hunter2") && !said.contains("giulia"), "{said}");
    }
    assert_eq!(seen.since(before), Vec::<String>::new(), "and a decline sent nothing");
}

/// The other way a write has no card: not a file, but a body in a form nobody
/// can read. A `fetch` with a plain string body is `text/plain` whatever the
/// page meant by it, and there is no honest way to show that as fields.
#[tokio::test]
async fn a_write_in_a_form_the_card_cannot_show_is_refused_rather_than_guessed_at() {
    let (base, arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-opaque", &base).await;

    let seen = Arrivals::of(&arrived);
    let before = seen.so_far();
    let note = ref_of(&page, "post a sentence").await;
    assert!(clicking(&page, &holds, &note).await.is_none(), "an unreadable body is refused, not held");
    tokio::time::sleep(Duration::from_millis(300)).await;

    assert!(holds.ids().await.is_empty(), "there is no card to ask about");
    assert_eq!(seen.since(before), Vec::<String>::new(), "and nothing was sent");
    assert_eq!(
        holds.take_outcomes(common::CHAT).await,
        vec![Outcome::Unrenderable("the request is sent in a form the person cannot read".to_owned())],
        "and the model is told why, in one line"
    );
}

/// **The real password reaches the server.** A card is drawn with the password
/// hidden — it must be — and the person cannot read it. If the value that
/// arrives is the empty string the card showed instead, the form has been
/// "sent" as something nobody agreed to, and the whole mechanism is a way of
/// quietly substituting one request for another.
///
/// So the fixture records bodies, and this is the claim: what the server got is
/// the password the person actually typed.
#[tokio::test]
async fn a_confirmed_login_sends_the_password_the_person_actually_typed() {
    let (base, arrived) = common::serve(&[common::page(LOGIN)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-real-secret", &base).await;

    page.evaluate::<(), ()>(
        r"() => {
          const set = (id, value) => {
            const el = document.getElementById(id);
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          set('account', 'giulia');
          set('passphrase_2', 'the-real-password');
        }",
        None,
    )
    .await
    .expect("the person types");
    let sign_in = ref_of(&page, "sign in").await;
    let id = click_holds(&page, &holds, &sign_in).await;

    // **The card carries it and prints none of it.** The person is being asked
    // whether their password may go; a card that had already thrown it away
    // could not answer that, and `Debug` is the one path into a log.
    let card = holds.card(&id).await.expect("a card");
    let password = named(&card.fields, "passphrase_2").expect("the field is on the card");
    assert_eq!(password, "the-real-password", "the person can read it, because that is what goes");
    assert!(!format!("{card:?}").contains("the-real-password"), "and nothing that prints a card ever does: {card:?}");

    holds.answer(&id, common::CHAT, true).await;
    let body = poll_for_body(&arrived, "/login", 20).await.unwrap_or_default();
    assert!(
        body.contains("passphrase_2=the-real-password"),
        "the server received the password the person typed, and the card showed it hidden: {body}"
    );
    assert!(body.contains("account=giulia"), "and the rest of the form with it: {body}");
}

/// **What goes out is what the card was drawn from, and not what the page would
/// now like it to be.** The card is a promise about bytes. Between the card being
/// drawn and the person pressing, the page can do anything at all to its own
/// form — and the request that leaves must still be the one that was approved.
#[tokio::test]
async fn a_page_that_changes_its_form_after_the_card_does_not_change_what_is_sent() {
    let (base, arrived) = common::serve(&[common::page(SHOP)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-tampered", &base).await;

    let city = ref_of(&page, "the city").await;
    let (pressed, held) = filling(&page, &holds, &city, "Bologna").await;
    assert!(pressed);
    let id = held.expect("the submit is held");
    let card = holds.card(&id).await.expect("a card");
    assert_eq!(named(&card.fields, "city"), Some("Bologna"), "the card says what was approved");

    // The page rewrites its own form while nobody is looking.
    page.evaluate::<(), ()>(
        r"() => {
          const field = document.getElementById('city');
          field.value = 'Somewhere else entirely';
          field.setAttribute('value', 'Somewhere else entirely');
          document.getElementById('order').setAttribute('action', '/pay');
        }",
        None,
    )
    .await
    .expect("the page rewrites itself");

    holds.answer(&id, common::CHAT, true).await;
    let body = poll_for_body(&arrived, "/order", 20).await.unwrap_or_default();
    assert!(
        body.contains("city=Bologna") && !body.contains("Somewhere else entirely"),
        "what left is the approved value, not the page's: {body}"
    );
    assert!(
        !arrived.received().iter().any(|one| one.line.contains("/pay")),
        "and not the address the page swapped in either"
    );
}

/// **The request going out is not the same as the page arriving.** A confirm
/// that dispatches and leaves the browser where it was has sent a stranger's
/// form and shown the model a page that never existed — so the landing is
/// proved, not just the arrival.
#[tokio::test]
async fn a_confirmed_submit_lands_the_page_on_what_the_server_answers() {
    let (base, arrived) = common::serve(&[
        common::page(SHOP),
        common::page_at("/order", "<h1>the order went through</h1>"),
    ])
    .await;
    let (_sessions, page, holds) = common::confirming_window("confirm-lands", &base).await;

    let buy = ref_of(&page, "buy it").await;
    let id = click_holds(&page, &holds, &buy).await;
    assert_eq!(holds.answer(&id, common::CHAT, true).await, hold::Answer::Spent(Outcome::Sent { host: host_of(&format!("{base}/order")) }));

    let landed = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if page.url() == format!("{base}/order") {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or(false);
    assert!(landed, "a confirmed submit leaves the page where it was: {} arrived {:?}", page.url(), arrived.requests());
    assert!(snapshot::snapshot(&page, 1).await.expect("the page reads").contains("the order went through"));
}

/// **A GET carrying a value the person typed into a password field is held like
/// a write.** The method says this is a read and the bytes say otherwise: the
/// same message to that server as the POST it came from, with the secret in a
/// place nobody is looking. So it is parked, the person is asked, and the card
/// says where it goes with the secret taken out of it.
#[tokio::test]
async fn a_get_carrying_the_password_the_person_typed_is_held_like_a_write() {
    let (base, arrived) = common::serve(&[common::page(LEAKY), common::page_at("/go", "<h1>gone</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-leaky-get", &base).await;

    page.evaluate::<(), ()>(
        r"() => {
          const el = document.getElementById('secret');
          el.focus();
          el.value = 'the-real-password';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }",
        None,
    )
    .await
    .expect("the person types");
    // Nothing has been asked of the sidecar about this value yet: the page says so
    // over the binding, and the route reads it without a round trip.
    assert_eq!(holds.typed().await.values(), vec!["the-real-password".to_owned()], "the window knows what they typed");

    // The person's own submit: a navigation, which a parked route would freeze.
    page.evaluate::<(), ()>("() => document.getElementById('leak').requestSubmit()", None)
        .await
        .expect("the person submits");
    let held = wait_for_card(&holds, 40).await;
    assert!(held.is_some(), "a GET carrying their password is held, not let through");

    let id = held.expect("a card");
    let card = holds.card(&id).await.expect("the card the person reads");
    assert_eq!(card.method, "GET", "and it is the GET, shown as it would be sent: {card:?}");
    assert!(card.url.contains("/go"), "where it goes is shown: {}", card.url);
    assert!(!format!("{card:?}").contains("the-real-password"), "and never what it carries");
    assert!(
        card.fields.iter().any(|field| field.secret),
        "and it says which one, without saying what it is: {:?}",
        card.fields
    );
    assert!(!arrived.asked_for("/go"), "and nothing has reached the server");

    assert_eq!(holds.answer(&id, common::CHAT, true).await, hold::Answer::Spent(Outcome::Sent { host: host_of(&base) }));
    // A GET form puts its fields in the target, so the line names `/go?password=…`
    // — and the fixture answers on whatever it is asked for.
    for _ in 0..20 {
        if arrived.requests().iter().any(|line| line.split_whitespace().nth(1).is_some_and(|target| target.starts_with("/go"))) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        arrived.requests().iter().any(|line| line.split_whitespace().nth(1).is_some_and(|target| target.starts_with("/go"))),
        "the server has it only because the person said so: {:?}",
        arrived.requests()
    );
}

/// **The same secret in the path is the same thing**, and a read with no secret
/// is left alone: the check is on what an address carries, not on the shape of a
/// path.
#[tokio::test]
async fn a_plain_read_is_never_held_by_the_secret_check() {
    let (base, arrived) =
        common::serve(&[common::page(LEAKY), common::page_at("/catalog?page=2", "<h1>the catalogue</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-plain-read", &base).await;

    page.evaluate::<(), ()>(
        r"() => {
          const el = document.getElementById('secret');
          el.focus();
          el.value = 'the-real-password';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }",
        None,
    )
    .await
    .expect("the person types");
    let read = page.goto(&format!("{base}/catalog?page=2"), None).await;
    assert!(read.is_ok(), "a read that carries none of it goes out as it always did");
    assert!(arrived.requests().iter().any(|line| line.contains("page=2")), "and reached the server");
    assert_eq!(holds.waiting().await, 0, "with no card about a page that is only a page");
}

/// **One definition of a secret field, used by all three.** The field here is
/// `autocomplete="section-login current-password"`: one field with two tokens in
/// its list. The model is refused it, and what the *person* types into it is
/// emptied from the card — which is the second half only working because the
/// refusal and the catcher read the same predicate.
#[tokio::test]
async fn a_field_with_a_token_list_is_a_secret_to_the_model_and_to_the_card() {
    let (base, _arrived) = common::serve(&[common::page(LEAKY), common::page_at("/tokens", "<h1>posted</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-token-list", &base).await;

    let listed = ref_of(&page, "the listed one").await;
    let refused = input::fill(&page, &listed, "written-by-the-model").await;
    assert_eq!(refused.err().map(|error| error.reason().to_owned()), Some(refused_text()), "the model is refused a field that is a secret");

    // The person types their own into it, and what they type is what is taken
    // out of the card.
    page.evaluate::<(), ()>(
        r"() => {
          const el = document.getElementById('listed');
          el.focus();
          el.value = 'typed-by-the-person';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }",
        None,
    )
    .await
    .expect("the person types");
    assert_eq!(holds.typed().await.values(), vec!["typed-by-the-person".to_owned()], "the catcher tracked it too");

    let post = ref_of(&page, "post it").await;
    let id = click_holds(&page, &holds, &post).await;
    let card = holds.card(&id).await.expect("a card");
    assert!(!format!("{card:?}").contains("typed-by-the-person"), "while nothing that prints it ever does: {card:?}");
    assert_eq!(
        named(&card.fields, "listed"),
        Some("typed-by-the-person"),
        "the card carries what the person typed, because that is what is about to be sent"
    );
}

/// **An address the guard refuses is refused before a card exists.** A form whose
/// action is `javascript:` or `mailto:` never gets as far as the network — the
/// route only sees what the network is asked for — so a caught submission has to
/// be judged at the same door, or it is the one write Kalsa would hold and then
/// dispatch into a scheme the guard refuses everywhere else.
#[tokio::test]
async fn a_caught_submission_to_a_refused_address_is_never_held() {
    let (base, arrived) = common::serve(&[common::page(LEAKY)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-scheme", &base).await;
    // The page load itself is a request to the server; what must not arrive is
    // anything either of these actions would have sent.
    let asked_before = arrived.requests().len();

    for scheme in ["javascript:window.__kalsaRan = true", "mailto:someone@shop.example"] {
        // **The product's own decision this time**, not the stand-in: what is
        // being proved is that a caught submission is judged at all.
        let caught = kalsa_browser::submit::Submission {
            method: "POST".to_owned(),
            url: scheme.to_owned(),
            enctype: "application/x-www-form-urlencoded".to_owned(),
            pairs: vec![("note".to_owned(), "hello".to_owned())],
            has_file: false,
            target: None,
            secrets: Vec::new(),
        };
        assert!(
            kalsa_browser::mcp::held_submission(&page, &holds, common::CHAT, kalsa_browser::mcp::the_address, Some(caught))
                .await
                .is_none(),
            "{scheme} is refused, not held"
        );
        let said = holds.take_outcomes(common::CHAT).await.last().expect("the model is told").sentence();
        assert!(said.contains("No request was sent"), "{scheme}: what it was told — {said}");
    }
    assert_eq!(holds.waiting().await, 0, "and nothing is left on the window");
    assert_eq!(arrived.requests().len(), asked_before, "and nothing reached the server");
}

/// **And the click that would have started one is refused before that.** The
/// address is judged twice on purpose: once when the element is chosen, and once
/// where the request is caught. The first stops the ordinary case; the second is
/// the one that cannot be skipped.
#[tokio::test]
async fn a_click_on_a_submit_whose_action_is_another_program_is_refused() {
    let (base, arrived) = common::serve(&[common::page(LEAKY)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-scheme-click", &base).await;
    let asked_before = arrived.requests().len();

    for label in ["run it", "mail it"] {
        let button = ref_of(&page, label).await;
        let (landed, held) = mcp::acting(
            &page,
            &holds,
            common::CHAT,
            &[],
            common::the_fixture,
            input::click(&page, &button),
        )
        .await;
        let refused = landed.expect_err("the click is refused");
        assert!(
            refused.reason().contains("another program"),
            "{label}: what it was told — {}",
            refused.reason()
        );
        assert!(held.is_none(), "{label}: and no card was raised for it");
    }
    assert_eq!(holds.waiting().await, 0, "with nothing on the window");
    assert_eq!(arrived.requests().len(), asked_before, "and nothing on the wire");
}

const NAVIGATION: &str = r#"async payload => {
    const [url, body] = JSON.parse(payload);
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    document.body.appendChild(form);
    for (const pair of new URLSearchParams(body)) {
        const field = document.createElement('input');
        field.type = 'hidden';
        field.name = pair[0];
        field.value = pair[1];
        form.appendChild(field);
    }
    form.submit();
}"#;

/// **A probe with the approved request's own bytes cannot claim the answer.**
///
/// This is the claim that was made and was false. The route compared method,
/// address, content type and body; a `fetch` carrying all four byte for byte
/// passed that test, so it spent the person's answer and went, and whether that
/// happened came down to which request reached the route first. **The route asks
/// the whole of the ticket now**, which includes what the request *is*: the
/// person's submission is a navigation of the main frame, and a page's `fetch`
/// never is one.
///
/// **No race, so no luck.** The ticket is armed here and the probe is issued from
/// script, where it can only ever be a fetch. There is no ordering to get right,
/// and the old code fails this on every run. What is proved is the thing that was
/// wrong: the answer survives the probe, and the real navigation still spends it.
#[tokio::test]
async fn a_probe_that_is_not_a_navigation_cannot_spend_the_answer() {
    let (base, arrived) =
        common::serve(&[common::page(SHOP), common::page_at("/order", "<h1>the order went through</h1>")]).await;
    let (_playwright, _context, page, holds) = common::browser_allowing_holding("hold-probe", &base, "").await;
    page.goto(&base, None).await.expect("the fixture is open");

    // Exactly what the form below would send, to the byte.
    let order = format!("{base}/order");
    let body = "city=Bologna";
    holds.pass_next(kalsa_browser::hold::Ticket::of_parts(
        "POST",
        &order,
        "application/x-www-form-urlencoded",
        body.as_bytes().to_vec(),
    ))
    .await;

    // The probe: same method, same address, same content type, same bytes, and
    // not a navigation because it was never going to be one.
    page.evaluate::<String, ()>(
        r#"async payload => {
            const [url, body] = JSON.parse(payload);
            await fetch(url, {
              method: 'POST',
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              body,
            });
        }"#,
        Some(&serde_json::json!([order, body]).to_string()),
    )
    .await
    .ok();
    // Long enough for the probe to have been held rather than merely slow.
    tokio::time::sleep(Duration::from_millis(600)).await;

    assert!(
        arrived.body_of("/order").is_none(),
        "a fetch spent the answer and went: {:?}",
        arrived.received()
    );
    assert!(holds.answer_pending().await, "and it spent the answer, so the real request cannot go");

    // The real thing: a form that navigates, with the same address and the same
    // body. This is the request the person was shown, and it is the one the
    // answer was for.
    page.evaluate::<String, ()>(NAVIGATION, Some(&serde_json::json!([order, body]).to_string())).await.ok();

    let sent = poll_for_body(&arrived, "/order", 30).await.unwrap_or_default();
    assert!(sent.contains(body), "the navigation the person approved went: {sent}");
    assert!(!holds.answer_pending().await, "and it spent the answer, once");
}

#[tokio::test]
async fn a_page_that_replaces_submit_does_not_stop_the_approved_request() {
    let (base, arrived) = common::serve(&[common::page(LEAKY), common::page_at("/tokens", "<h1>posted</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-replaced-submit", &base).await;

    page.evaluate::<(), ()>("() => { HTMLFormElement.prototype.submit = function () {}; }", None)
        .await
        .expect("the page takes submit over");
    let post = ref_of(&page, "post it").await;
    let id = click_holds(&page, &holds, &post).await;
    assert!(is_a_card_id(&id), "the submit is held first: {id}");

    assert_eq!(
        holds.answer(&id, common::CHAT, true).await,
        hold::Answer::Spent(Outcome::Sent { host: host_of(&base) }),
        "and it goes, because the dispatch was never the page's method"
    );
    let body = poll_for_body(&arrived, "/tokens", 20).await.unwrap_or_default();
    assert!(body.contains("listed"), "with what the card showed: {body}");
}

/// **A dispatch that could not be carried out is unclear, and revokes itself.**
/// Taking the captured functions away is the honest version of a page that stops
/// the dispatch: nothing went, so the model must not be told it did — and the
/// answer is revoked so no later request can pick it up.
#[tokio::test]
async fn a_page_that_takes_the_dispatch_away_is_told_unclear_and_sends_nothing() {
    let (base, arrived) = common::serve(&[common::page(LEAKY), common::page_at("/tokens", "<h1>posted</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-stolen-dispatch", &base).await;

    page.evaluate::<(), ()>("() => { window.__kalsaSubmit = null; window.__kalsaApply = null; }", None)
        .await
        .expect("the page takes the dispatch away");
    let post = ref_of(&page, "post it").await;
    let id = click_holds(&page, &holds, &post).await;
    assert!(is_a_card_id(&id), "the submit is still held first: {id}");
    let before = arrived.requests().len();

    assert_eq!(
        holds.answer(&id, common::CHAT, true).await,
        hold::Answer::Spent(Outcome::Ambiguous),
        "answered yes, nothing went, and that is exactly what unclear means"
    );
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(arrived.requests().len(), before, "and nothing reached the server afterwards");
    assert!(!holds.answer_pending().await, "and the answer is revoked, so nothing can claim it later");
}

/// **The submitter's entry is in the body once.** `FormData(form, submitter)` is
/// the browser's own construction and already includes the button that started
/// the submission; appending it again put every named submit button on the wire
/// twice, and on the card with it.
#[tokio::test]
async fn a_named_submit_button_is_sent_once_and_not_twice() {
    let (base, arrived) = common::serve(&[common::page(LEAKY), common::page_at("/tokens", "<h1>posted</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-submitter-once", &base).await;

    let post = ref_of(&page, "post it").await;
    let id = click_holds(&page, &holds, &post).await;
    let card = holds.card(&id).await.expect("a card");
    assert_eq!(
        card.fields.iter().filter(|field| field.name == "go").count(),
        1,
        "the button's own entry is one field, as the browser writes it: {:?}",
        card.fields
    );
    assert_eq!(named(&card.fields, "go"), Some("now"), "with the value it has");

    holds.answer(&id, common::CHAT, true).await;
    let body = poll_for_body(&arrived, "/tokens", 20).await.unwrap_or_default();
    assert_eq!(body.matches("go=now").count(), 1, "and the server received it once: {body}");
}

/// **A request the page makes later belongs to the navigation, not to whoever is
/// calling.** A timer the page set is still the request that caused it — and the
/// conversation that has to answer for it is the one that drove the page there.
#[tokio::test]
async fn a_delayed_request_belongs_to_the_navigation_that_made_the_page() {
    let (base, _arrived) = common::serve(&[common::page(LEAKY)]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-delayed", &base).await;
    holds.navigated_by("chat-a").await;

    // A different chat is calling when the page's own request arrives.
    holds.in_conversation("chat-b").await;
    page.evaluate::<(), ()>(
        r"() => {
          fetch('/note', {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: 'note=a delayed write',
          });
        }",
        None,
    )
    .await
    .expect("the page writes on its own");

    let id = wait_for_card(&holds, 40).await.expect("the write is held");
    let card = holds.card(&id).await.expect("a card");
    assert_eq!(card.conversation, "chat-a", "and it belongs to the page's navigation, not to the caller");
    assert_eq!(
        holds.answer(&id, "chat-b", true).await,
        hold::Answer::Unknown,
        "so the chat that was merely reading cannot answer it"
    );
    assert!(matches!(holds.answer(&id, "chat-a", false).await, hold::Answer::Spent(_)), "and the one that caused it can");
}

/// **A card for a GET carries its address whole, and the value in it is the
/// value on the card.** The person is being asked about a password in a query;
/// the address is what goes, and the flag says the window draws it as dots.
#[tokio::test]
async fn a_get_card_shows_the_address_that_will_be_sent() {
    let (base, _arrived) = common::serve(&[common::page(LEAKY), common::page_at("/go?password=hunter2", "<h1>gone</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-get-card", &base).await;

    page.evaluate::<(), ()>(
        r"() => {
          const el = document.getElementById('secret');
          el.focus();
          el.value = 'hunter2';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }",
        None,
    )
    .await
    .expect("the person types");
    page.evaluate::<(), ()>("() => document.getElementById('leak').requestSubmit()", None)
        .await
        .expect("they submit");
    let id = wait_for_card(&holds, 40).await.expect("a card");
    let card = holds.card(&id).await.expect("the card");
    assert_eq!(card.url, format!("{base}/go?password=hunter2"), "the address is shown as it will be sent");
    assert_eq!(named(&card.fields, "password"), Some("hunter2"), "with the value on it");
    assert!(card.fields.iter().any(|field| field.name == "password" && field.secret), "and flagged");
    assert!(!format!("{card:?}").contains("hunter2"), "while nothing that prints it ever does: {card:?}");
}

/// **A page cannot get a value off a card by calling it a secret.** The binding
/// `__kalsaTyped` is page-visible, and a page may call it with whatever it likes:
/// the worst that used to buy was a card that said "typed by you in a password
/// field" about the very value it was sending somewhere else. Now the card
/// carries what will be sent, whatever the page claims, and the claim only
/// decides how it is drawn.
#[tokio::test]
async fn a_page_that_claims_its_exfiltrated_value_was_typed_hides_nothing() {
    let (base, arrived) = common::serve(&[common::page(LEAKY), common::page_at("/tokens", "<h1>posted</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("confirm-claim", &base).await;

    // The page registers its own payload as something the person typed, twice:
    // once under the binding, and once with a field name that reads as a secret.
    page.evaluate::<(), ()>(
        r"() => {
          if (typeof window.__kalsaTyped === 'function') window.__kalsaTyped(0, 'the-exfiltrated-secret');
          const field = document.createElement('input');
          field.type = 'hidden';
          field.name = 'user_password';
          field.value = 'the-exfiltrated-secret';
          document.getElementById('tokens').append(field);
        }",
        None,
    )
    .await
    .expect("the page says so");
    assert_eq!(
        holds.typed().await.values(),
        vec!["the-exfiltrated-secret".to_owned()],
        "and the window believes it — which is all the binding can do now"
    );

    let post = ref_of(&page, "post it").await;
    let id = click_holds(&page, &holds, &post).await;
    let card = holds.card(&id).await.expect("a card");
    let claimed = named(&card.fields, "user_password").expect("the field is on the card");
    assert_eq!(claimed, "the-exfiltrated-secret", "with the value the site is really going to receive");
    assert!(!format!("{card:?}").contains("the-exfiltrated-secret"), "and nothing prints it: {card:?}");

    holds.answer(&id, common::CHAT, false).await;
    assert!(!arrived.asked_for("/tokens"), "a declined card sends nothing, and the claim changed nothing");
}

/// **Paused: the person is acting, and we do not hold what they do.** A card is
/// already waiting — pausing is not declining — and their own submission goes out
/// as it always did. Resume re-arms: the next write of ours is held again.
#[tokio::test]
async fn while_paused_the_persons_own_submit_goes_and_resume_holds_ours_again() {
    let (base, arrived) = common::serve(&[common::page(SHOP), common::page_at("/order", "<h1>the order went through</h1>")]).await;
    let (sessions, page, holds) = common::confirming_window("confirm-paused", &base).await;

    // A card first, so "pausing is not declining" is on the window while we test.
    let city = ref_of(&page, "the city").await;
    let (pressed, held) = filling(&page, &holds, &city, "Bologna").await;
    assert!(pressed);
    let waiting = held.expect("a card before the pause");
    assert_eq!(holds.waiting().await, 1, "and it is still answerable while paused");

    // **Through the window, not through the page's own store.** Pausa is the
    // person's claim on the window and the route reads the window's cell, so a
    // proof that wrote the store directly would be writing the other half of a
    // flag the product only ever sets in one place.
    sessions.set_paused(true);
    assert!(sessions.paused(), "the window is paused");

    let before = arrived.requests().len();
    page.evaluate::<(), ()>("() => document.getElementById('order').requestSubmit()", None)
        .await
        .expect("the person submits");
    assert!(poll_for_body(&arrived, "/order", 20).await.is_some(), "their own submission went out as it always did");
    assert_eq!(holds.waiting().await, 1, "and nothing new was held: their acting is not ours to hold");
    assert!(arrived.requests().len() > before, "the server saw it");

    // Their submit moved the window, so the model has to come back to the shop —
    // and after a resume, what it does there is held again.
    assert_eq!(page.url(), format!("{base}/order"), "their submit went through, so the page moved");
    page.goto(&base, None).await.expect("back to the shop");
    let _ = page.wait_for_load_state(Some(playwright_rs::protocol::WaitUntil::Load)).await;
    sessions.set_paused(false);
    let buy = ref_of_eventually(&page, "buy it", 20).await;
    let after = click_holds(&page, &holds, &buy).await;
    assert_ne!(after, waiting, "after a resume our own write is held again, with its own card");
    assert_eq!(holds.waiting().await, 2);
    assert_eq!(holds.answer(&waiting, common::CHAT, false).await, hold::Answer::Spent(Outcome::Declined), "and the old card is still answerable");
}

/// **Pausa is the person's claim on the window, not the page's licence to send.**
///
/// It used to let *every* request through. That is right for a click and wrong
/// for a `fetch`: a page that keeps posting to a server while the person sits
/// reading is not the person acting, and a pause that waved it through was a
/// pause that held nothing at all. The rule is now the shape of the request — a
/// navigation of the main frame — and everything else falls through to the rules
/// below it, which is where the held writes and the secret-carrying GET live.
#[tokio::test]
async fn while_paused_the_persons_navigation_goes_and_the_pages_own_writes_do_not() {
    let (base, arrived) = common::serve(&[
        common::page(SHOP),
        common::page_at("/order", "<h1>the order went through</h1>"),
        common::page_at("/telemetry", "<h1>noted</h1>"),
    ])
    .await;
    let (sessions, page, holds) = common::confirming_window("confirm-paused-fetches", &base).await;

    sessions.set_paused(true);
    assert!(sessions.paused(), "the window is paused");

    // **A page's own post is not the person acting.** It is held, like any other
    // write, and nothing reaches the server.
    page.evaluate::<String, ()>(
        // **Fired, not awaited.** A held request is a request that never answers,
        // and a promise waiting on one is a test that never finishes.
        r#"url => {
            fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: 'beacon=telemetry',
            }).catch(() => {});
        }"#,
        Some(&format!("{base}/telemetry")),
    )
    .await
    .ok();
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(
        arrived.body_of("/telemetry").is_none(),
        "a page's own post went out while the person was holding the browser: {:?}",
        arrived.received()
    );
    assert_eq!(holds.waiting().await, 1, "and it is held as a card, which is what a write is");

    // **The person's own submission still goes**, or pausing would freeze the
    // page they are using — the one thing a pause may not do.
    page.evaluate::<(), ()>("() => document.getElementById('order').requestSubmit()", None)
        .await
        .expect("the person submits");
    assert!(poll_for_body(&arrived, "/order", 20).await.is_some(), "their own navigation went out as it always did");

    // **A GET carrying a secret is still held while paused.** Pausing is about
    // what the person is doing; it is not a permission for the page to mail a
    // passphrase to whoever, and that check sits below the pause on purpose.
    page.goto(&base, None).await.expect("back to the shop");
    let _ = page.wait_for_load_state(Some(playwright_rs::protocol::WaitUntil::Load)).await;
    holds.typed_in(1, "hunter2-the-passphrase").await;
    page.evaluate::<String, ()>(
        // Fired and not awaited, for the same reason.
        r#"payload => {
            const [base, secret] = JSON.parse(payload);
            fetch(base + '/telemetry?k=' + encodeURIComponent(secret)).catch(() => {});
        }"#,
        Some(&format!(r#"["{base}","hunter2-the-passphrase"]"#)),
    )
    .await
    .ok();
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(
        !arrived.asked_for("/telemetry?k="),
        "a GET carrying a passphrase went out while the browser was paused: {:?}",
        arrived.requests()
    );
}

/// **One chat is never told what happened in another.**
///
/// The outcome is how a model learns a person decided something, and it is said
/// in front of the next tool call. Which call it is said in front of used to be
/// whoever happened to call next: drain the store, hand over everything, and a
/// chat that never asked about a request would be told which host it went to.
/// Both halves are now matched on the conversation that caused them, and this
/// proves the one that matters — that B's tool result contains nothing of A's.
#[tokio::test]
async fn an_outcome_is_told_to_the_conversation_that_caused_it_and_to_no_other() {
    let (base, _arrived) = common::serve(&[common::page(SHOP)]).await;
    let (sessions, page, holds) = common::confirming_window("confirm-told", &base).await;

    // Chat A drives a write and answers it: no. That outcome is A's news.
    holds.in_conversation("chat-a").await;
    let city = ref_of(&page, "the city").await;
    let (pressed, held) = filling(&page, &holds, &city, "Bologna").await;
    assert!(pressed);
    let id = held.expect("chat A raised a card");
    assert_eq!(holds.card(&id).await.map(|card| card.conversation), Some("chat-a".to_owned()));
    assert!(matches!(holds.answer(&id, "chat-a", false).await, hold::Answer::Spent(_)), "and it is answered in A");

    // **B asks next and is told nothing.** This is the whole claim.
    holds.in_conversation("chat-b").await;
    // **The sentence the model would read, not the name of the variant.** What
    // this is about is what reaches a transcript.
    let no = "did not allow";
    let said_to_b = mcp::told_for(&sessions, "chat-b").await;
    assert!(!said_to_b.contains(no), "chat B was told about chat A's request: {said_to_b}");

    // **A asks next and is told.** The outcome waited rather than being lost.
    let said_to_a = mcp::told_for(&sessions, "chat-a").await;
    assert!(said_to_a.contains(no), "chat A was not told about its own request: {said_to_a}");
    // And it is told once.
    let again = mcp::told_for(&sessions, "chat-a").await;
    assert!(again.is_empty(), "and not again on the next call: {again}");
}

/// **Pausa refuses all five, the three reads as well as the two writes.** The
/// gate in the chat registry is not the only one: a caller that skipped it still
/// stops here, and the refusal is the same sentence for every tool. It is
/// answered before the arguments are read — a paused `browser_click` is told the
/// browser is paused, not that it has never heard of its element, so a model
/// retrying with another ref is not sent round the same loop.
#[tokio::test]
async fn a_paused_browser_refuses_all_five_and_reads_no_arguments() {
    let (base, _arrived) = common::serve(&[common::page(SHOP)]).await;
    let server = kalsa_browser::mcp::BrowserServer::new(common::profile("pause-all-five"));
    let json = serde_json::json!({});

    // Paused through the host-only tool, which is the path the app's own
    // `brain_browser_pause` command takes — not by setting the flag behind it.
    let pressed = server.call_named("browser_pause", json.clone()).await.expect("the pause tool");
    assert!(!pressed.refused, "pausing is not a refusal: {}", pressed.text);

    let calls: [(&str, serde_json::Value); 5] = [
        ("browser_open", serde_json::json!({ "url": format!("{base}/") })),
        // An empty page number and a ref that no snapshot ever issued: while
        // the browser is paused the answer is the pause and not either of them.
        ("browser_read", json.clone()),
        ("browser_find", serde_json::json!({ "text": "buy it" })),
        ("browser_click", serde_json::json!({ "ref": "e99" })),
        ("browser_type", serde_json::json!({ "ref": "e99", "text": "x" })),
    ];
    for (name, args) in calls {
        let answer = server.call_named(name, args).await.unwrap_or_else(|why| panic!("{name} is a tool: {why}"));
        assert!(answer.says(true, "the browser is paused"), "{name} was not refused for the pause: {}", answer.text);
    }

    // And the window says the same thing after a resume, so the refusals above
    // were the pause rather than a browser that could not start.
    server.call_named("browser_resume", json).await.expect("the resume tool");
    let after = server.call_named("browser_read", serde_json::json!({})).await.expect("the read tool");
    assert!(!after.text.contains("the browser is paused"), "a resumed browser is not paused: {}", after.text);
}

/// The line the model is refused with, from the sidecar's own refusal rather than
/// a copy of it here.
fn refused_text() -> String {
    input::Refused::Password.reason().to_owned()
}

/// Waits for a card to appear, which is the person being asked — the one thing
/// these tests have to wait for.
async fn wait_for_card(holds: &kalsa_browser::hold::Holds, tries: usize) -> Option<String> {
    for _ in 0..tries {
        if let Some(id) = holds.ids().await.into_iter().next() {
            return Some(id);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    None
}
