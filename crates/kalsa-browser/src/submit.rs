//! The submission a click or an Enter would have sent, caught in the page and
//! kept there (one responsibility: take a write that would navigate out of the
//! browser's hands, and give it back only when a person says so).
//!
//! **Why this exists instead of holding the route.** A held route was the first
//! shape and it does not work, for two reasons that were both measured on the
//! browser this runs on:
//!
//! - **A parked navigation freezes the page.** While the main frame's request is
//!   held, `Runtime.evaluate` on it never answers: a read times out after thirty
//!   seconds, and so does the re-check a fill does before pressing Enter. The
//!   person would be looking at a window that cannot be read for as long as the
//!   card is on screen — five minutes — and the model could not read the page it
//!   is working on. A `fetch` held the same way does not do this; only a
//!   navigation does.
//! - **Aborting one replaces the page with Chrome's own error page.**
//!   `chrome-error://chromewebdata/`, "This page has been blocked by Chrome",
//!   `ERR_BLOCKED_BY_CLIENT`. A decline is meant to leave the page as it was,
//!   and this is the opposite of that.
//!
//! So a write that would navigate is caught **in the page, before the request
//! exists**: the submission event is prevented, the fields are read out of the
//! `FormData` the browser itself built — the site's own encoding, hidden fields
//! included — and the form is kept. A person saying yes asks the form to submit
//! for real. A person saying no drops it, and nothing was ever on the wire.
//!
//! A write the page makes on its own — a `fetch`, an XHR, a `sendBeacon` — is
//! not a navigation and cannot be prevented from the page. Those still go
//! through the route, where `hold::hold_write` parks them, and a parked one does
//! not freeze anything.
//!
//! **The catcher is armed only around our own action.** A person using the
//! window is never swallowed: a submission while the catcher is disarmed goes
//! straight out, exactly as it always did.

use std::future::Future;

use playwright_rs::protocol::Page;
use url::form_urlencoded;
use serde::Deserialize;

/// **Wrapped, because an init script runs in the page's world.** The password
/// predicate is a top-level `const` and the catcher holds its state in a block of
/// its own; both used to be the page's, so a site declaring the same name threw a
/// `SyntaxError` and we broke it. The whole script is an IIFE, and the only thing
/// left on `window` is the catcher's state — which Rust's own `ARM` and `TAKE`
/// have to reach, so it cannot be a closure. It holds no address and no way to
/// submit: what a page can do to it is described where it is written.
const CATCHER: &str = r"
  (() => {
    const held = { armed: false, mark: 0, caught: [], typed: [] };
    // Non-enumerable and not reassignable: a page can still read the catcher's
    // own bookkeeping, and there is no version of this where it cannot — but it
    // cannot be replaced before a submission, and it does not show up in a page's
    // own `for (const key in window)`.
    Object.defineProperty(window, '__kalsa', { value: held, enumerable: false, writable: false, configurable: false });
    // What the **person** typed into a password field, kept here in the page and
    // never handed over as a value. The model is refused password fields
    // (`input.rs`), so anything in this list is theirs and nobody else's — which
    // is what makes it the one thing a card must not repeat back.
    //
    // **This is a list of what happened, not state the dispatch trusts.** Every
    // byte of the request is handed to Rust and kept there; what this window
    // still holds is deleted the moment it has been read. See `FIRE`.
    addEventListener('input', (event) => {
      const el = event.target;
      if (!el || !isSecretField(el) || !el.value) return;
      let seen = held.typed.find((one) => one.el === el);
      const field = seen ? seen.id : held.typed.length;
      if (seen) seen.value = el.value;
      else held.typed.push({ el, id: field, value: el.value });
      // **The same value, over to this side.** The route has to know what a
      // request carries before it lets it through, and asking the page about
      // that would be one round trip to the driver per subresource — a GET is
      // the one request that has to be checked for it. This runs in the capture
      // phase, so it is dispatched before the page's own handler for the same
      // keystroke can navigate anywhere with it.
      if (typeof window.__kalsaTyped === 'function') window.__kalsaTyped(field, el.value);
    }, true);
    // Capture, so this runs before any handler the page wrote, and so
    // `preventDefault` is ours to call on the way past them.
    addEventListener('submit', (event) => {
      const form = event.target;
      if (!held.armed || !form) return;
      // One action causes one submission, so the catcher spends itself here:
      // a page that goes on to submit again is its own doing, not ours.
      held.armed = false;
      const submitter = event.submitter;
      const attribute = (el, name) => (el && el.getAttribute ? el.getAttribute(name) : null);
      // The submitter overrides the form: `formaction` and `formmethod` on a
      // button are what the browser sends, so what we capture is what the
      // browser would have sent, not what the form says.
      const method = String(attribute(submitter, 'formmethod') || attribute(form, 'method') || '').toUpperCase() || 'GET';
      const enctype = String(attribute(submitter, 'formenctype') || attribute(form, 'enctype') || 'application/x-www-form-urlencoded').toLowerCase();
      const action = attribute(submitter, 'formaction') ?? attribute(form, 'action') ?? location.href;
      // A GET form is a read, a `dialog` form does not navigate at all, and
      // neither is a write. **Neither is held.**
      if (method === 'GET' || method === 'DIALOG') return;
      event.preventDefault();
      let url = location.href;
      try { url = new URL(action, location.href).href; } catch (error) {}
      const pairs = [];
      // Which of these fields the browser itself calls password-class, read off
      // the elements rather than off their names: a field called `field1` with
      // An `autocomplete` of current-password is a password field whatever the
      // element is called. This only marks the card's drawing — the value is unchanged.
      const secrets = [];
      let hasFile = false;
      try {
        for (const [name, value] of new FormData(form, submitter)) {
          if (typeof value !== 'string') { hasFile = true; continue; }
          pairs.push([name, value]);
          const control = Array.from(form.elements || []).find((el) => el && el.name === name);
          if (control && isSecretField(control)) secrets.push(name);
        }
      } catch (error) {
        // `FormData(form, submitter)` throws when the submitter is not a member
        // of the form. A submission we cannot read is one we cannot show.
        hasFile = true;
      }
      // **The submitter's own entry is already in there.** `new FormData(form,
      // submitter)` is the browser's own construction and it includes the
      // button that started the submission, name and value, exactly as the
      // browser would send it. Appending it again put every named submit button
      // on the wire twice, and the card with it — so what the person approved
      // and what a server receives were both different from what the browser
      // would have sent on its own.
      held.caught.push({ method, url, enctype, pairs, hasFile, target: attribute(form, 'target') ?? null, secrets });
    }, true);
  })();
";

// The password-class test is written into this script from `secret`'s two Rust
// lists, and it is written *in* rather than assigned to `window`: a page could
// replace a global before the person types anything, and what this predicate
// decides is whether what they type is tracked at all. `input.rs` builds the
// same predicate into its own expressions from the same lists, so the thing the
// card hides and the thing a fill refuses cannot drift apart either way.

const ARM: &str = "() => { const held = window.__kalsa; held.armed = true; held.mark = held.caught.length; }";

/// Hands the request over and **deletes it from the page** in the same step: from
/// here on the only copy is Rust's, and nothing the window still holds is
/// anything the dispatch will read.
const TAKE: &str = r"() => {
  const held = window.__kalsa;
  held.armed = false;
  const caught = held.caught[held.mark];
  if (!caught) return null;
  held.caught.splice(held.mark, 1);
  return { method: caught.method, url: caught.url, enctype: caught.enctype, pairs: caught.pairs, hasFile: caught.hasFile, target: caught.target, secrets: caught.secrets || [] };
}";

/// Builds the request Rust captured and submits it, **in one synchronous turn**.
///
/// The payload is Rust's, not the page's: it arrives as an argument and the form
/// is built and submitted before any other script gets a turn, so a page cannot
/// change a field between the card being drawn and the request being sent. The
/// route then checks the request that actually goes out against what Rust
/// captured, so if the rebuild were ever not what the card showed, the request is
/// held rather than sent — and the person is told it was unclear.
///
/// `submit()`, not `requestSubmit()`: it fires no submit event, so the catcher
/// cannot catch the one the person has already agreed to, and the page cannot
/// change the form on the way out.
///
/// **There is no captured copy of the browser's `submit` any more, and that is
/// the point.** It used to be stashed in `window.__kalsaSubmit` before the page
/// ran, so a dispatch could call it whatever the page did afterwards — but a
/// global on `window` is a function the page can call itself, with any form it
/// likes, and that call went round the destination rule in `external.rs`
/// entirely. Calling `outgoing.submit()` asks for whatever `submit` is at this
/// moment, which is normally the wrapper `external.rs` installed — so the
/// dispatch is judged by the same rule as any other click, and **cannot reach a
/// scheme that is not http or https even if a page built the form**. If the page
/// replaced `submit` after we installed ours, the dispatch calls the page's, the
/// route never sees the ticket spent, and this reports [`Fired::Unclear`]: which
/// is what it is.
const FIRE: &str = r"(request) => {
  const outgoing = document.createElement('form');
  outgoing.method = request.method;
  outgoing.action = request.url;
  outgoing.enctype = request.enctype;
  if (request.target) outgoing.target = request.target;
  for (const [name, value] of request.pairs) {
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = name;
    field.value = value;
    outgoing.appendChild(field);
  }
  document.body.appendChild(outgoing);
  outgoing.submit();
  return true;
}";

/// What the dispatch did, which is not the same as whether it was asked for.
///
/// **"Sent" is a claim about the wire**, and only the route knows it: the
/// ticket was spent by the request FIRE started. A page that made `submit` a
/// no-op, or that took the functions this needed away, is reported as
/// **unclear** — which is what it is — and the ticket is revoked so nothing can
/// claim the answer later.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fired {
    /// The route saw the request this ticket was made for, and let it through.
    Sent,
    /// It was not established that anything went. **Never retried.**
    Unclear,
}

/// What the person typed into a password field in this window, for the write a
/// page made by itself.
///
/// **Ask the page, not the network.** A `fetch` carrying a password the person
/// logged in with is bytes on the wire with no element behind them any more, and
/// the only place that still knows which values were theirs is the document that
/// saw the keystrokes. These are compared by value and never shown: see
/// `body::hide`. An empty list is the honest answer when nothing can be asked —
/// the page may have gone — and it means the card shows what was sent.
/// The request a held write will send, **kept in Rust**.
///
/// This is the whole of the invariant: what passes the route is byte-for-byte
/// what this says and what the card was drawn from. The window caught the
/// submission and handed it over; the window's own copy is deleted in the same
/// step (`TAKE`) and nothing in the page is read again at dispatch time.
///
/// The values here are **real**, the person's password included. That is what
/// has to go out — a card that showed a password the server never received
/// would be the lie this exists to prevent — and they live here and nowhere
/// else: not on the card, not in an outcome sentence, not in a log.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Submission {
    pub method: String,
    pub url: String,
    pub enctype: String,
    /// `(name, value)`, in the order the browser wrote them.
    pub pairs: Vec<(String, String)>,
    pub has_file: bool,
    pub target: Option<String>,
    /// The names of the fields the browser's own predicate calls password-class.
    /// **What the card draws as dots, and nothing more** — the values above are
    /// unchanged, because a card the person cannot read is not a card they can
    /// decide on.
    #[serde(default)]
    pub secrets: Vec<String>,
}

/// Why a submission has no card.
///
/// A body the browser would encode with a boundary **it chooses at submit time**
/// cannot be reproduced from the fields: the boundary is not knowable before the
/// request is built, so there is no way to promise the bytes that go out are the
/// ones the card showed. Rather than send something that is nearly what was
/// approved — which is the one thing this whole mechanism is for — a multipart
/// form is refused, with one line saying why.
pub fn unrenderable(submission: &Submission) -> Option<&'static str> {
    if submission.has_file {
        return Some("the request carries a file, and a card cannot show a file");
    }
    match submission.enctype.as_str() {
        "application/x-www-form-urlencoded" | "text/plain" => None,
        _ => Some("the request is sent in a form the person cannot read"),
    }
}

/// The body a submission will send, exactly as the browser encodes it.
///
/// **Only the two encodings whose bytes can be written out in advance.** A
/// multipart body cannot: its boundary is drawn when the browser builds it. The
/// route checks what actually went against [`crate::hold::Ticket`], so a
/// mismatch is held rather than sent — the invariant is enforced at dispatch,
/// not assumed here.
pub fn body_of(submission: &Submission) -> Option<Vec<u8>> {
    match submission.enctype.as_str() {
        "application/x-www-form-urlencoded" => {
            let mut out = form_urlencoded::Serializer::new(String::new());
            for (name, value) in &submission.pairs {
                out.append_pair(name, value);
            }
            Some(out.finish().into_bytes())
        }
        // `text/plain` is what a form sends when nothing else is said: the pairs
        // on their own lines, with the browser's own CRLF and no encoding.
        "text/plain" => {
            let mut out = String::new();
            for (name, value) in &submission.pairs {
                out.push_str(name);
                out.push('=');
                out.push_str(value);
                out.push_str("\r\n");
            }
            Some(out.into_bytes())
        }
        _ => None,
    }
}

/// The content type the route will see for a submission, spelled the way the
/// browser spells it so the ticket compares equal to what arrives.
pub fn content_type_of(submission: &Submission) -> String {
    submission.enctype.clone()
}

/// Installed once per window, and by an init script so that it is there again
/// after every navigation: a listener on one document dies with that document,
/// and a window that has navigated once must still catch the next write.
pub async fn install(page: &Page) -> Result<(), playwright_rs::Error> {
    let catcher = format!("{PREDICATE}{CATCHER}", PREDICATE = crate::secret::classifier_declaration());
    // **One script, not two.** There is no captured `submit` to order against
    // anything any more: what used to be a second init script is gone, so there
    // is no window in which this one could take the browser's method before
    // `external.rs` wrapped it.
    page.add_init_script(&catcher).await
}


/// Runs `act` with the catcher armed, and hands back what it caught.
///
/// **`take` runs whatever `act` did.** A page left armed would swallow the
/// person's own next submission, so the disarm is not conditional on the action
/// having succeeded.
pub async fn caught_by<T, F>(page: &Page, act: F) -> (T, Option<Submission>)
where
    F: Future<Output = T>,
{
    let _ = page.evaluate::<(), ()>(ARM, None).await;
    let acted = act.await;
    let caught = page.evaluate::<(), Option<Submission>>(TAKE, None).await.ok().flatten();
    (acted, caught)
}

/// Sends the request this card is about, from the copy Rust kept, and says what
/// became of it.
///
/// **It is the route that reports the answer, not this.** The evaluation can only
/// say a form was submitted; the ticket is what says the request the person
/// approved actually arrived, and only the route sees it. So the ticket is
/// revoked the moment the evaluation fails or says no, and waited on briefly
/// when it says yes — a page that made `submit` a no-op gets an evaluation that
/// succeeds and a request that never goes, which is [`Fired::Unclear`] and never
/// [`Fired::Sent`].
pub async fn fire(page: &Page, caught: &Submission, holds: &crate::hold::Holds) -> Fired {
    // Only what the request is: the flags are for the card, and nothing the page
    // is handed back is anything the page did not already have.
    let request = serde_json::json!({
        "method": caught.method,
        "url": caught.url,
        "enctype": caught.enctype,
        "target": caught.target,
        "pairs": caught.pairs.clone(),
    });
    if !page.evaluate::<serde_json::Value, bool>(FIRE, Some(&request)).await.unwrap_or(false) {
        holds.revoke_pass().await;
        return Fired::Unclear;
    }
    if holds.wait_for_spent(DISPATCH_WINDOW).await {
        Fired::Sent
    } else {
        // The form was submitted and nothing arrived that this answer covers:
        // whether that server saw anything is exactly what is not established.
        holds.revoke_pass().await;
        Fired::Unclear
    }
}

/// How long the dispatch waits for the route to say. A submission that goes out
/// is in flight in about a millisecond; this is the bound for "it never came",
/// not a wait anybody can feel.
const DISPATCH_WINDOW: std::time::Duration = std::time::Duration::from_secs(3);
