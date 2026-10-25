//! What this window may not hand to another program (one responsibility: the
//! destination rule, and the page-level listener that enforces it).
//!
//! **Chromium hands an external protocol to the operating system before anything
//! becomes a network request**, so no route sees it — that is measured, in
//! `tests/external_protocol.rs`, and it is why this file exists. What was left was
//! a check per shape, in the tool layer, and a shape is anything a page can name:
//! a link, a submit button, an image button, a form's own action, a control
//! named by a `form` attribute, an icon inside a button, a label's control, a
//! shadow tree. Any of those that the tool layer missed was a way for a model to
//! open the person's mail client, and one of them was.
//!
//! **So the rule is read once here and enforced twice from it.** [`READING`] is
//! the whole of "where would this go", moved out of `input.rs` so the tool layer
//! and this listener cannot disagree about it. `input.rs` asks it before a click
//! or a write and tells the model; [`install`] puts it on the window, where it
//! answers for every element of every page, and where nothing the page does later
//! can move the destination out from under it.
//!
//! **Why a listener is the layer that works here**, measured on this browser:
//! the Navigation API is absent (`'navigation' in window` is true, and the
//! `navigate` event never arrives — not from an init script, not from a live
//! listener, not for a same-origin http click), route interception never sees an
//! external protocol, and no Chromium switch or profile preference stops the
//! handoff. What does work is the event pipeline the page already has: a
//! **capture-phase** listener on the window runs before any listener the page
//! registers, sees clicks that came out of a shadow tree (they are composed), and
//! can cancel the activation with `preventDefault`. It is the only place where
//! "where would this go" and "did it go" are the same task.
//!
//! **What is still open, and why it is not ours.** A page that runs
//! `location.href = 'mailto:…'` on itself is not reaching anything we offer it —
//! no tool, no route, no listener in the page can see that navigation on this
//! browser — and the person is watching the window it happens in. It is written
//! down in the crate README rather than papered over here.

use playwright_rs::protocol::BrowserContext;

/// **What a click or a submission would do, read the way the browser reads it.**
///
/// One definition, two callers: the tool layer asks it before it acts so the
/// model is told, and [`GUARD`] asks it on the window so the browser is stopped
/// whatever the page does. Two copies of this rule is how the image-button shape
/// reached another program in the first place.
///
/// The clauses, in the order they are asked:
///
///  1. **The form this action is really in** — found by the browser's own
///     association, which is what a `form` attribute naming a form elsewhere on
///     the page needs, and by the control an icon or a label's text lives in.
///  2. **The default button**, because that is where Enter goes. Found by asking
///     every control whether *it* is this form's, and `input type=image` counts:
///     `image` is one of the three `type` values that put a control in the
///     submit-button state, and `form.elements` does not list it. Walking
///     `form.elements` instead found no default button at all in a form whose
///     only submit control is an image, and Enter went with the image's own
///     `formaction`. Measured on this browser: a form holding a text field and an
///     image button answers `form.elements` with the text field alone.
///  3. **Every address that could be followed**: the form's action and method,
///     the default button's `formaction` and `formmethod`, the control's own two,
///     and the link of every shape — HTML anchor, image-map area, SVG anchor
///     whose href is an `SVGAnimatedString`, and anything inside one, which
///     `composedPath` is how a shadow tree is walked.
pub(crate) const READING: &str = r"
  const answer = (verdict, extra) => Object.assign({ verdict, isInput: false, kind: '' }, extra || {});
  // An address with no scheme in it is fine: the browser resolves it against the
  // page. An address that cannot be resolved at all is not, and is answered with
  // something `opens` will not take — a destination we cannot name is a
  // destination we cannot rule out.
  const protocolOf = value => {
    if (value === null || value === undefined || value === '') return '';
    try { return String(new URL(value, location.href).protocol); } catch (error) { return 'unresolvable'; }
  };
  const opens = value => value === '' || value === 'http:' || value === 'https:';
  // A browser ignores a method it does not know and uses GET. Refusing is
  // stricter than the browser, and costs a page nothing legitimate.
  const knownMethod = value => value === '' || value === 'get' || value === 'post' || value === 'dialog';
  const methodOf = (node, attribute) => node === null || node === undefined
    ? ''
    : String(node.getAttribute(attribute) || '').toLowerCase();
  // **`tagName` is case-sensitive and an SVG element keeps its own case**, so an
  // SVG anchor reads as 'a' where an HTML one reads as 'A'. Comparing it raw is
  // how a drawn link stopped being a link.
  const tagOf = (node) => String((node && node.tagName) || '').toUpperCase();
  const anchorOf = (node) => {
    if (!node || typeof node.getAttribute !== 'function') return null;
    const tag = tagOf(node);
    if (tag !== 'A' && tag !== 'AREA') return null;
    // **An anchor is an anchor whether or not it has an `href` attribute.** An
    // SVG anchor written the older way carries only `xlink:href`, and asking for
    // `href` first is how a drawn link stopped being one.
    return node;
  };
  const linkHref = (node) => {
    // An SVG anchor's href is an SVGAnimatedString rather than a string, and may
    // live in the xlink namespace rather than as a plain attribute.
    //
    // **Measured on this Chrome:** an SVG anchor written with only `xlink:href`
    // answers `href.baseVal` with that address anyway, so the first line below is
    // the one that finds it — the attribute fallback cannot be reached here, and
    // no test on this browser can bite on it. It stays because it is what the
    // address is when the IDL does not reflect it, and because deleting it is
    // exactly the kind of quiet edit that leaves the next engine unprotected.
    const drawn = node.href && node.href.baseVal;
    if (drawn) return String(drawn);
    return node.getAttribute('xlink:href') || node.getAttribute('href') || null;
  };
  // The control a click submits with, where the attributes must be read from:
  // the button or input wrapping an icon, the labelled control, or the element.
  const submitterEl = el => controlOf(el) || el;
  const controlOf = el => {
    // 1. **Inside a button or an input.** A `<span>`, an `<svg>` or an `<img>`
    //    that is a button's icon has no `form` property: it is not
    //    form-associated, it is *inside* something that is.
    if (el.closest && el.closest('button, input') !== null) return el.closest('button, input');
    // 2. **A label, or anything inside one.** `label.control` is the element the
    //    label is for, and a click anywhere on the label activates that element.
    const label = el.closest ? el.closest('label') : null;
    if (label !== null && label.control) return label.control;
    return null;
  };
  const formOf = el => {
    const control = controlOf(el);
    if (control !== null) return control.form || null;
    return (el.form || (el.closest && el.closest('form'))) || null;
  };
  // The default button: the first submit button in tree order that this form owns
  // and that is not disabled. `.type` carries the IDL default, so a `<button>`
  // with no attribute reads as `submit` and an `<input>` with none reads as
  // `text`, which is not one.
  const isDefaultButton = node => {
    if (node.disabled) return false;
    const type = String(node.type || '').toLowerCase();
    const tag = tagOf(node);
    if (tag === 'BUTTON') return type === 'submit' || type === '';
    return tag === 'INPUT' && (type === 'submit' || type === 'image');
  };
  const defaultButtonOf = form => {
    if (form === null || form === undefined) return null;
    for (const node of form.ownerDocument.querySelectorAll('button, input')) {
      if (node.form === form && isDefaultButton(node)) return node;
    }
    return null;
  };
  // **The chain of elements a click on this one goes through.** The window layer
  // has a real event to take a path from; the tool layer has only the element the
  // model named, and a click on a `<span>` or an `<img>` inside an `<a>` is an
  // activation of **that anchor** — so judging the inner element judges nothing
  // and the link walks straight through. A shadow root's `parentNode` is null,
  // which is why the way out of one is its host: `getRootNode().host`.
  const pathOf = (el) => {
    const path = [];
    for (let node = el; node; node = node.parentNode || (node.getRootNode && node.getRootNode().host) || null) {
      path.push(node);
    }
    return path;
  };
  // Every address this action could send the browser to, and one line: the first
  // that is not somewhere a browser may go is the reason.
  const badDestinationOf = (el, path) => {
    for (const node of path && path.length ? path : [el]) {
      if (!node || typeof node.getAttribute !== 'function') continue;
      const anchor = anchorOf(node);
      if (anchor !== null) {
        const href = linkHref(anchor);
        if (href !== null && !opens(protocolOf(href))) return true;
      }
      if (tagOf(node) === 'FORM') {
        if (!opens(protocolOf(node.getAttribute('action')))) return true;
        if (!knownMethod(methodOf(node, 'method'))) return true;
      }
      if (isDefaultButton(node)) {
        if (!opens(protocolOf(node.getAttribute('formaction')))) return true;
        if (!knownMethod(methodOf(node, 'formmethod'))) return true;
      }
    }
    const form = formOf(el);
    if (form !== null && form !== undefined) {
      const submitter = defaultButtonOf(form);
      if (!opens(protocolOf(form.getAttribute('action')))) return true;
      if (!knownMethod(methodOf(form, 'method'))) return true;
      if (submitter !== null && !opens(protocolOf(submitter.getAttribute('formaction')))) return true;
      if (submitter !== null && !knownMethod(methodOf(submitter, 'formmethod'))) return true;
    }
    const own = submitterEl(el);
    if (!opens(protocolOf(own.getAttribute && own.getAttribute('formaction')))) return true;
    if (!knownMethod(methodOf(own, 'formmethod'))) return true;
    return false;
  };
  // The same question for a whole form, which is what a native `form.submit()`
  // and a `submit` event are about.
  const formIsSomewhereSafe = (form) => !badDestinationOf(form, [form]);
";

/// **The listener, on the window, at document start.**
///
/// Three doors, and each is here because the other two do not cover it — all three
/// measured on this browser:
///
/// - **`click`, captured.** It runs before every listener the page registers, so
///   a page that answers `click` by rewriting its own `href` or `formaction` is
///   too late. It sees clicks out of a shadow tree (they are composed events) and
///   `preventDefault` cancels the activation.
/// - **`submit`, captured.** Implicit submission — Enter in a field — fires this
///   and no click, so the click listener never sees it.
/// - **`HTMLFormElement.prototype.submit`.** A native `submit()` fires no event at
///   all, so the other two never see it. This is the same capture-the-real-method
///   trick `submit.rs` uses, for the same reason.
const LISTENERS: &str = r"
  const refuse = (event, node, submitter) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    // **The button that started the submission is judged before anything else**,
    // because it is the one that overrides the form: `requestSubmit(btn)` sends
    // `btn`'s own `formaction` and `formmethod`, whatever the form says. It is
    // asked through the same rule, which already reads a default button's two
    // attributes — it is put at the head of the path rather than special-cased,
    // so there is no second copy of the rule to drift.
    const everywhere = submitter ? [submitter, ...path] : path;
    if (!badDestinationOf(node, everywhere)) return;
    // **Cancellation, not silence.** `preventDefault` stops the activation;
    // `stopPropagation` would also stop the page seeing the event, which is
    // more than this layer's business — and the proof of it working is that a
    // page's own handler still runs while the page does not navigate.
    event.preventDefault();
  };
  // **Both phases, because each catches what the other cannot.** A capture-phase
  // listener runs before every handler the page has, so it reads the address as
  // the document wrote it — which is the earliest it can be wrong, and the only
  // place a handler that stops propagation cannot get past. A bubble-phase
  // listener on the window runs *after* every handler below it, so it reads the
  // address as the click will actually use it — a page that answers `click` by
  // pointing its own link somewhere else is caught here and nowhere earlier.
  // Refusing on either is the whole of it.
  for (const capture of [true, false]) {
    addEventListener('click', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      const node = path.find((one) => one && ['A', 'AREA', 'BUTTON', 'INPUT', 'FORM'].includes(tagOf(one))) || event.target;
      refuse(event, node, null);
    }, capture);
    addEventListener('submit', (event) => refuse(event, event.target, event.submitter), capture);
  }
  const realSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (!formIsSomewhereSafe(this)) return;
    return realSubmit.call(this);
  };
";

/// **The script, wrapped so that nothing of ours is a binding in the page's
/// world.** `READING` and the listeners are top-level `const`s — a name like
/// `answer` or `pathOf` — and an init script runs in the page's global scope, so
/// those were **page globals**: a site whose own classic script declares the same
/// name throws `SyntaxError: Identifier 'answer' has already been declared`, and we
/// break a real site over a name nobody chose. The whole script is therefore an
/// IIFE: the same names, in a scope of our own, and a page's `window` has nothing
/// of ours in it at all.
pub fn guard() -> String {
    format!("(() => {{\n{READING}\n{LISTENERS}\n}})()")
}

/// Put the listener on the whole context, so it is in every frame of every page
/// this window ever opens — including a popup, and including a frame the page
/// created after we were already looking.
pub async fn install(context: &BrowserContext) -> Result<(), playwright_rs::Error> {
    context.add_init_script(&guard()).await
}

#[cfg(test)]
mod tests {
    use super::{guard, READING};

    /// The reading is in the window **and** in the tool layer, or the two answers
    /// to "where would this go" have become two answers.
    #[test]
    fn the_destination_rule_is_read_from_the_one_definition() {
        let shipped = guard();
        for clause in [
            "const opens = value => value === '' || value === 'http:' || value === 'https:'",
            "const badDestinationOf = (el, path)",
            "node.form === form",
            "type === 'submit' || type === 'image'",
        ] {
            assert!(shipped.contains(clause), "the window no longer reads {clause}");
        }
        assert!(shipped.contains(READING), "the window's rule is not the shared one");
    }

    /// An image is a default button for Enter, and `form.elements` is not where
    /// it lives: measured on this browser, a form holding a text field and an
    /// image button answers `form.elements` with the text field alone, and Enter
    /// went with the image's own `formaction` — which is a mail client.
    #[test]
    fn the_default_button_is_found_by_association_and_counts_an_image() {
        assert!(
            READING.contains("tag === 'INPUT' && (type === 'submit' || type === 'image')"),
            "an image is not a submit button to Enter again"
        );
        assert!(READING.contains("node.form === form"), "the default button is not found by association");
        assert!(!READING.contains("for (const node of form.elements)"), "the old walk that missed images is back");
    }

    /// **Three doors, because each one covers a shape the other two cannot see.**
    /// A native `form.submit()` fires no event; implicit submission fires a
    /// `submit` and no click; a link fires a click and nothing else. All three
    /// measured, and all three refuse by asking the same rule.
    #[test]
    fn a_click_a_submission_and_a_native_submit_are_all_answered_here() {
        let shipped = guard();
        assert!(shipped.contains("addEventListener('click'"), "a click is not answered on the window");
        assert!(shipped.contains("addEventListener('submit'"), "an implicit submission is not answered on the window");
        assert!(shipped.contains("HTMLFormElement.prototype.submit = function"), "a native form.submit() is not answered");
        // **And every one of the two is registered in both phases.** Captured,
        // because a handler that stops propagation cannot get past it; bubbling
        // on the window, because that is the last moment before the activation
        // and the only one that reads the address *after* the page's own handlers
        // have had their turn with it.
        assert_eq!(shipped.matches("for (const capture of [true, false])").count(), 1, "both phases are not registered");
        assert_eq!(shipped.matches("addEventListener(").count(), 2, "a click, a submit, and nothing else");
        assert_eq!(shipped.matches(", capture);").count(), 2, "the click and the submit must both be in both phases");
        // **And nothing of ours is left on the page.** The whole script is an
        // IIFE, so `answer`, `pathOf` and the rest are in a scope of our own: a
        // site whose own script declares the same name is not stopped from
        // declaring it, and a page cannot reach any of this by name.
        assert!(shipped.starts_with("(() => {"), "the script is not wrapped, so its consts are the page's: {shipped}");
        assert!(shipped.trim_end().ends_with("})()"), "the wrapper is not closed");
        assert!(!shipped.contains("window.__kalsa"), "a global is left in the page: {shipped}");
    }

    /// **The button that starts a submission is judged.** `requestSubmit(btn)`
    /// sends `btn`'s own `formaction` and `formmethod` whatever the form says, so
    /// the submitter goes at the head of the path — through the same rule, not a
    /// second copy of it — and a submission whose *button* is the dangerous one is
    /// refused as surely as a form whose action is.
    #[test]
    fn the_button_that_starts_a_submission_is_judged_before_anything_else() {
        let shipped = guard();
        assert!(shipped.contains("refuse(event, event.target, event.submitter)"), "the submitter is not read: {shipped}");
        assert!(shipped.contains("submitter ? [submitter, ...path] : path"), "the submitter is not judged by the same rule: {shipped}");
    }

    /// A shadow tree is walked by `composedPath`, so a link nobody can name from
    /// the outside is read like any other.
    #[test]
    fn a_click_from_inside_a_shadow_tree_is_read_too() {
        assert!(guard().contains("event.composedPath"), "the click is only read at the element, so a shadow tree is missed");
    }

    /// **The chain above the element is part of the question.** A click on a
    /// picture inside a link activates the link, and on this browser the picture
    /// is what the model is handed: the accessibility tree gives the anchor an
    /// empty name and the `<img>` inside it the name and the ref. The window
    /// layer gets that from `composedPath`; the tool layer has no event and asks
    /// for it. A shadow root's `parentNode` is null, which is why the walk asks
    /// its host.
    #[test]
    fn an_element_is_read_together_with_everything_above_it() {
        let shipped = guard();
        assert!(shipped.contains("const pathOf = (el)"), "there is no way to ask for the chain above an element");
        assert!(shipped.contains("node.getRootNode().host"), "the walk stops at a shadow root");
        // **And the two layers still share one rule**: the window answers from a
        // real event's path, the tool from the one it can build.
        assert_eq!(shipped.matches("badDestinationOf(").count(), 2, "the window's click, and the whole-form question");
    }

    /// An SVG anchor written the older way carries `xlink:href`, and it is read.
    /// The `href.baseVal` line is what actually finds it on this Chrome — see
    /// [`READING`] — so this pins the clause rather than proving it, which is the
    /// honest description of both.
    #[test]
    fn a_drawn_link_is_read_by_its_animated_href_and_by_its_xlink_attribute() {
        assert!(READING.contains("const drawn = node.href && node.href.baseVal"), "the animated href is not read");
        assert!(READING.contains("node.getAttribute('xlink:href') || node.getAttribute('href')"), "the attribute is not read");
    }

    /// `about:blank` is what the browser itself opens a popup on, and refusing it
    /// would break the window rather than protect it; http and https are what a
    /// page is allowed to go to. Everything else is another program's.
    #[test]
    fn the_two_schemes_a_page_may_use_are_http_and_https_and_nothing_else_is_added() {
        assert!(READING.contains("const opens = value => value === '' || value === 'http:' || value === 'https:'"));
    }
}