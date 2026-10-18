# kalsa-browser

The browser already installed on the computer, driven through its accessibility
tree, as an MCP server over stdio. The plan is
`docs/PLAN-BROWSER-2026-10-17.md`; this crate is step 1 of it.

## The driver

We do not download the Playwright driver, at build time or at run time. The
release pipeline assembles it from pinned sources, verifies the archive by
SHA256, and serves it from our own location.

A **build** must therefore carry the skip flag, and a **run** must be told where
the verified driver is:

```sh
# build
PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD=1 cargo build -p kalsa-browser

# run, with a driver that is already on this machine
PLAYWRIGHT_DRIVER_PATH=/path/to/driver cargo run -p kalsa-browser
```

`PLAYWRIGHT_DRIVER_PATH` is a directory holding `node` (`node.exe` on Windows)
and `package/cli.js`. That is the whole contract with `playwright-rs`.

On every start the process clears every other `PLAYWRIGHT_*` variable from its
own environment (`src/driver_env.rs`) — `PLAYWRIGHT_NODE_EXE` and
`PLAYWRIGHT_CLI_JS` each replace the runtime or the CLI script outright, and
`PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD` is a build-time knob that has no meaning here.
`PLAYWRIGHT_DRIVER_PATH` is the only one that survives.

## Tests

`cargo test -p kalsa-browser` runs the browser tests, which launch the installed
browser headed and need a driver:

```sh
PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD=1 PLAYWRIGHT_DRIVER_PATH=/path/to/driver \
  cargo test -p kalsa-browser
```

They never download a browser: the context is launched with an `executablePath`
pointing at the installed Chrome, Edge or Brave (`src/find_browser.rs`), and
`~/Library/Caches/ms-playwright` is not touched. They do bind a loopback HTTP
server of their own, which the product guard refuses and which the tests
therefore override through Playwright's own routing when they need an origin.

## Enter

A fill is followed by Enter when the field is a single-line text-like input —
`text`, `search`, `email`, `url`, `tel`, `number` — **whether or not a `<form>`
is around it**. The form is deliberately not part of the rule: TodoMVC's
new-todo input, a chat box and most search boxes are one-line inputs with no
form at all whose keydown handler commits what was typed, and a model that
typed into one and pressed nothing was talking to a page that never heard it.

A `<textarea>`, a `contenteditable` and a `<select>` never take Enter — the
first two hold several lines by design, so a multi-line answer cannot submit
itself halfway through being written, and the third is refused outright as
`NotFillable`. A password field, and anything the page marks as a
one-time code, is refused before anything is typed into it.

Nothing here decides *whether* a write may happen. A `<form>` submits on Enter
as a non-GET, and every non-GET goes through the hold (`src/hold.rs`) — refused
in step 1, confirmed from step 4 — so the only thing this rule decides is whether
Kalsa presses the key at all. What it cannot protect on its own is the window
between the destination check and the keypress, which is re-read immediately
before Enter (`RECHECK_BODY`) and written up under *Known limits*.

## Holding a write

A write is not sent and not refused. It is **held**, and a person decides. The
store is `src/hold.rs`: cards in the order they were held, five minutes before
one is given up on (`EXPIRY`, a clock that can be injected for tests), and an
id that is **spent before anything is dispatched**, so a second press finds
nothing and nothing is ever attempted twice.

There are **two** ways a write is caught, and the difference is not a matter of
taste — the first one was built, measured, and thrown away.

**A write that would navigate is caught in the page** (`src/submit.rs`), before
the request exists. The submit event is prevented, the fields are read out of the
`FormData` the browser itself built — the site's own encoding, hidden fields
included — and the form is kept. Nothing is on the wire, so nothing can be
recalled: a decline is a request that never happened, and the page is as it was.

**A write the page makes by itself** — a `fetch`, an XHR, a `sendBeacon`, a
scripted `requestSubmit()` that got as far as the network — never navigates and
cannot be prevented from the page, so it is caught by the route and parked there
(`hold::hold_write`), with the route that would have dispatched it.

Parking a *navigation* at the route was the first shape and it does not work,
for two reasons that were both measured on this machine's browser:

- **A parked navigation freezes the page.** While the main frame's request is
  held, `Runtime.evaluate` on it never answers: a read times out after thirty
  seconds, and so does the re-check a fill does before pressing Enter. The
  person would look at a window that cannot be read for as long as the card is
  on screen, and the model could not read the page it is working on.
- **Aborting one leaves Chrome's own error page behind** —
  `chrome-error://chromewebdata/`, "This page has been blocked by Chrome",
  `ERR_BLOCKED_BY_CLIENT` — which is the opposite of leaving the page as it was.

A `fetch` held the same way does neither. Proved in `tests/confirm.rs`.

**A confirmed submission is sent as a form of its own**, rebuilt from the fields
that were held. Not `requestSubmit` on the form it came from: that was measured
failing, and quietly — the submit event fires, it is not prevented, the request
reaches the server, and the page never moves. The stranger has the order, the
person is still looking at the shop, and the model is about to be told a page
that does not exist. `tests/confirm.rs` proves the landing, not just the arrival,
because those are different claims.

A body the card cannot show is **refused, not held**: no readable card means no
question to ask. That is a file part, and a body in a form nobody can read. A
body over 16 KB (`MAX_BODY`) is refused for the same reason.

**What is hidden is decided on the value, never on the name.** The rule this
replaces matched names — `password`, `pin`, `cvv` — and a page chooses its own
names: it could call a password `password_x` and have a card print it in full,
or call a harmless note `pin` and have it blanked for nobody's reason. What is
hidden now is **a value the person typed into a password field while they had
the browser** — recorded in the page, by element, never as a name — and the card
says `hidden: typed by you in a password field` in its place, with no value
behind it to recover. The model is refused password fields (`input.rs`) and so
never types one: everything it typed is shown in full, however much the field is
called. `body::hide` matches on the value, so a page cannot invent a person's
password to get it hidden either.

The write a person just answered goes past the route on a **one-shot ticket for
that method and that address**, spent on first use
(`Holds::pass_next`/`takes_pass`) — so the re-submission is let through and any
other write the page makes in the meantime is held like any other.

## What the card shows, and what it does not

**Nothing is ever taken out of a card.** A field a person typed into a password
box is on the card in full, with a flag saying the window should draw it as dots
behind a Show button. The rule this replaces dropped those values where the
request was read, and it was dropped because the list of "what the person typed"
comes over `__kalsaTyped` — a binding the **page** can call. A page that called it
with the value it was sending somewhere else got a card that said "hidden: typed
by you in a password field" instead of showing what was going, which is a card a
stranger can write. That binding is now used for one thing only: deciding whether
a **GET** is held because it carries a secret. The worst a page can buy is that
its own GETs get held — a nuisance to itself.

The flag can only add dots. It comes from the element where there is one (the
catcher asks the browser's own predicate, so `autocomplete="current-password"` on
a field called `field1` is still found) and from the field's name where there is
not, and neither can remove a value.

**Where a value must not go, and what enforces it.** Not into a model message —
an outcome is a code and a host — not into the store (`store.ts` drops any note
carrying a path or a query), not onto disk, and not into a log: `Field`'s `Debug`
and `Card`'s `Debug` both print dots for a secret, so the one path into a log
line, a panic or a failing test cannot carry a password. `Serialize` is how a
value reaches the card, and it is the only place it is allowed to.

## The bytes that go

When a write is caught, **Rust keeps the whole request**: the method, the
absolute URL after `formaction` and `formmethod` are resolved, the content type,
the submitter's own name and value, and the body bytes — including the password
the *person* typed, which is held here and never on a card, a model message or a
log line. The page's copy is deleted in the same step (`submit::TAKE`), so
nothing page-visible is left for the dispatch to trust: the fire is one
synchronous `evaluate` built from Rust's payload, and no script of the page runs
between the card and the request.

What is allowed past the route afterwards is checked against a `Ticket` — the
same method, address, content type and body, the content type compared without
its parameters — **and it has to be a navigation of the main frame**. That last
part is deliberate rather than fussy: request headers are *not* compared, because
the browser varies them, so anything a header can change is closed by something
that cannot be varied. A `fetch` that matches on every byte and carries
`X-HTTP-Method-Override` is never a navigation, so it is held like any other
write and the answer is still there for the navigation the dispatch starts. A page
that rewrites the field or the action after the card is held the same way, and **a
request that does not match does not spend the ticket**: burning the answer on a
probe would send nothing at all while the person was told the request had gone.

**"Sent" is the route's word.** The fire calls a `submit` captured before the
page's scripts ran — a page that replaces it is a no-op, not a silent
cancellation — and then waits, briefly, for the ticket to be claimed. Only that
is reported as sent; anything else revokes the answer and reports **unclear**,
which is never retried.

Two encodings can be written out in advance and therefore confirmed:
`application/x-www-form-urlencoded` and `text/plain`.

## What step 1 does not do

Nothing about the hold: step 1 refused every non-GET. That refusal was replaced
by the hold above, and the address rules are the only thing here that has not
moved.
## Known limits

These are the things this crate does not stop. They are here so nobody reads the
code and believes otherwise.

- **An external protocol never reaches our route, and there is no flag that
  makes it.** `mailto:`, `tel:` and friends do not become network requests:
  Chromium hands them to the operating system before anything reaches the
  network stack, so route interception is not offered them at all. Proved over a
  real browser in `tests/external_protocol.rs`, in all three shapes that can
  reach one — a form's `action`, a button's `formaction`, an anchor's `href` — and
  **none of the three is ever seen by the route.** The only related Chromium
  switches do the opposite or do not apply: `disable-sandbox-external-protocols`
  re-*allows* external protocols from sandboxed iframes, and the
  `SandboxExternalProtocolBlocked` policy covers sandboxed iframes only, not a
  top-level navigation. So the scheme refusal in `input.rs` is the only thing
  between a page and a program on this computer, which is why the default
  submitter is computed the way the browser computes it and why the destination
  is re-read immediately before Enter. Closing this properly needs something in
  front of the browser, like the redirect case below.
  **The layers above it, and what each one was measured to be worth.** The
  refusal in `input.rs` covers the elements a model names. Above it,
  `external.rs` puts the **same rule** — one definition, two callers — on the
  window, where it answers for every element of every page and every frame:
  a capture-phase `click` (runs before every handler the page has, and sees
  clicks out of a shadow tree), a capture **and** bubble-phase `submit`
  (implicit submission fires this and no click), and a wrapper around
  `HTMLFormElement.prototype.submit` (a native `submit()` fires no event at
  all). Both phases are deliberate: captured is the only thing a handler that
  stops propagation cannot get past, and bubbling on the window is the last
  moment before the activation and the only one that reads the address *after*
  the page's own handlers have had their turn with it — a page that answers its
  own click by pointing its link elsewhere is caught there and nowhere earlier.
  **An element is judged with everything above it**, in both callers. The window
  gets that from the event's `composedPath()`; the tool layer has only the
  element the model named and asks for the chain itself, because a click on a
  picture inside a link activates the link — and on this browser the picture is
  what the model gets: the accessibility tree gives the anchor an **empty name**
  and the `<img>` inside it the name and the ref (`aria-ref` on it resolves to
  `IMG < A(kalsaprobe://shop)`). Handing the rule `[el]` therefore judged the
  picture and never read the link, which is the gap
  `a_picture_inside_a_link_to_another_program_is_refused` was written for.
  **What does not exist**, measured rather than assumed: the Navigation API is
  not a layer on this browser (`'navigation' in window` is true and the
  `navigate` event never arrives — not from an init script, not from a live
  listener, not for a same-origin http click); there is no Chromium feature to
  disable the handoff (only `ExternalProtocolDialog` and its checkbox feature
  exist); and nothing in our command line suppresses a confirmation dialog.

  **What happens once something reaches the handoff: this Chrome asks the
  person.** Measured with a throwaway app registered for the scheme
  `kalsaprobetest` — a script that appends to a log and exits, and nothing else —
  under **our own launch path**, one browser per case because the prompt is modal
  and would otherwise answer the next case for us. Every shape that reached the
  handoff put up the same dialog — `Open KalsaSchemeProbe?`, `http://127.0.0.1:PORT
  wants to open this application.`, an `Always allow …` checkbox, `Cancel` and
  `Open …` — and **the handler never ran**, because the dialog waits for a click
  that nobody makes:

  - a page navigating **itself** (`location.href = 'kalsaprobetest://…'`, no click,
    no event, nothing for any of our layers to read);
  - a click on a link whose `href` is safe and whose **own handler** then navigates
    away — the guard reads `href`, allows the click, and the handoff happens after
    it has stopped looking. This is the blind spot, and it ends in a prompt;
  - the same self-navigation in a Chrome **we did not launch**, on its own profile,
    which behaves identically. So this is Chrome's own prompt: **nothing in our
    flags removes it and nothing adds it**, and there is no flag of ours to drop.

  A link the guard *can* read is refused outright and no dialog appears at all, so
  the layers here are what removes the prompt from the ordinary cases, and Chrome's
  own prompt is the backstop for the shapes they cannot see. The ceiling on what a
  page can reach by navigating itself is therefore **a modal that names the site
  and waits for the person** — not an app opening behind their back.

  **The one shape with evidence of a silent handoff is `mailto:`, and it is not
  explained.** A form submitted with a `mailto:` `formaction` opened Mail during a
  test run with no dialog in front of it, which is what the measurement above says
  should not happen for any other scheme. There is no scheme list in this build
  that would account for it — byte-scanning the 519 MB framework binary and all 976
  resource files finds `snews` nowhere except inside an unrelated anti-spam word
  blob, and no `mailto;snews;news;` in any form. Whether Chromium exempts
  `mailto:` from the prompt is **not measured**, because measuring it means handing
  an address to the person's mail client, which is the one thing these tests are
  built not to do. If it is exempt, the ceiling for that shape is a **compose
  window**: an address in a mail client, not a message — nothing is sent, and
  nothing was filled in by this crate on the way. That is the residue, and it is a
  window to notice and close rather than a mail to somebody.
  **That one check was found letting a shape through, and it is written down
  here because the mistake was a measurement that was true and irrelevant:**
  `input type=image` is absent from `form.elements`, and this crate used to read
  the default button out of `form.elements` and conclude that an image is never
  the button Enter submits with. `image` is one of the three `type` values that
  put a control in the submit-button state, so Enter in a form whose first
  submit control is an image goes with **that image's own `formaction`** — and a
  plain text field was enough to reach it. The default button is now found by
  association (`node.form`), which is the browser's own answer and the only one
  that sees an image. A test fixture is a second door into the same hole, so no
  fixture in `tests/` names a scheme this machine has an app for: a `mailto:` in
  a page hands the address to the person's mail client the moment a proof goes
  wrong, which is exactly what happened, and `tests/common/mod.rs` fails the
  build if one comes back.
- **How hard a secret is looked for depends on how long it is.** Whole-part
  equality asks about **every** value the person typed, at any length: a
  three-digit bank code is short and it is still exactly what it is when it is
  the whole of a query value. Containment inside a part asks only from
  `MIN_SECRET` (4) up, and from `PLAIN_CONTAINMENT` (8) up it stops asking
  where the value stands at all — **while a window is paused it is the page's own
  script that writes the request, and it decides what the secret is written next
  to**, so a rule that asks whether the secret stands on a boundary is a rule
  the page chooses to obey (`x` + secret + `x` is a boundary on both sides). A
  false positive only holds a request for the person to answer; a false negative
  is the secret on its way to somebody else's server.
- **Below eight characters, containment is on a boundary, and that is a trade.**
  A typed `test` is found in `token=test-9f3a` and in `/api/v2/test/session`, and
  not in `latest` or `attestation.pdf`. Without that, four ordinary letters typed
  into a password field make every ordinary address on this computer look like a
  leak — and a held read is a page that does not load, so a secret nobody guessed
  the meaning of takes the site down with it. The gap the rule opens is deliberate
  and stated where it is written: a secret **under eight characters** welded
  straight to letters or figures (`hunter2x`) is not found by containment. It is
  still found whole, and still found punctuated.
- **A secret that is re-encoded before it is sent is a secret this crate cannot
  follow.** `secret::carries` looks for what the person typed **inside** the
  address — in a host label, a path segment, a query name or value, anywhere a
  server would read it, and percent-decoded first so `%68unter2` is `hunter2`
  here too. That is containment rather than equality on purpose: a real secret
  travels welded to something else, and equality would pass every one of them.
  What it does not do is **undo an encoding**. A value base64'd, hex'd, XOR'd or
  chopped into pieces before it goes into a query parameter is a different string
  by the time it reaches the address, and this crate has no way to know it was
  ever a secret — the information is gone by the time it is looking. So
  `?data=eyJ2IjoiaHVudGVyMiJ9` is not found, and saying otherwise would be a
  claim about a decoder this crate does not have. Closing it means deciding the
  encodings worth decoding and paying for it on every GET; it is a real gap, not
  a rounding error, and it is written here so nobody reads the code above and
  believes otherwise.
- **A body is read by the same rule, and a body nobody could read is read as
  carrying one.** `secret::part_carries` is that one rule: whole-part equality at
  any length, containment from `MIN_SECRET` up — and from `PLAIN_CONTAINMENT` up
  wherever it stands — asked about a field's **name** as well as its value and
  about the bytes of the body as a net underneath them — because a secret welded
  to a suffix, put where the server reads it as the key, or hidden in a multipart
  part the parser dropped is the same mail either way.
  The paused-navigation check in `guard.rs` asks it of the address and of the
  body, and **fails closed**: a body in a form no card can be drawn for (an
  opaque kind, a file part, one too large to show) and a request whose headers
  say a body was sent and whose bytes never arrived both count as *may be
  carrying it*, so such a request goes out only where the person already is. What
  that costs is stated in `guard.rs`: `form.elements` is not the wire, a name the
  reader lowercases is only found in the raw text, and a body with a secret
  percent-encoded into it is found by the decoded field — which is why all three
  are read.
- **A multipart form is refused, not approximated.** The browser chooses the
  boundary when it builds the request, so the bytes cannot be written out before
  the card exists, and there is then no way to promise that what goes is what the
  person was shown. A request in `multipart/form-data`, or carrying a file part,
  is refused with one line saying why, and nothing is sent. This is a decision of
  this slice, not an oversight: sending something close to what was approved is
  the one thing the hold exists to prevent. Closing it means building the body
  ourselves and proving the browser would have encoded it identically.
- **A GET is not free of effect.** The route refuses what would write to a site,
  but a GET can log someone in, count a click, or start a payment at the far end.
  Opening is a thing a person does on purpose.
- **A redirect is not intercepted.** In this stack a redirect followed within a
  navigation is never offered to a route handler: the first hop is judged and the
  second is not, and the browser follows it. `Landings::refused` refuses to read a
  page we ended up on, so the model is never shown what a redirected page
  says — but the request was made. Closing this needs something in front of the
  browser.
- **Network-specific NAT64 prefixes.** `64:ff9b::/96` and the local-use
  `64:ff9b:1::/48` are read and refused. A network that translates through a
  prefix of its own choosing is a network nothing here can recognise.
- **DNS rebinding.** A name is resolved here and Chrome resolves it again for
  itself, so a name that answered us with a public address can answer Chrome with
  a private one. The flag that would fix it — `--host-resolver-rules` — is one
  static rule string applied to every lookup, so it cannot ask a per-request
  question. This wants a local proxy on the computer, which is not built.
- **DOM mutation between a read and an action.** A page can change between the
  moment the model read an element and the moment it acts on it. The destination
  checks are done in the same task as the action, which closes the one window
  that mattered, but the element itself is still whatever the page has made it.
- **Asynchronous page handlers between the last check and the key press.** Filling
  a field fires `input` and `change`, and a page can answer either by rewriting the
  form's `action`, the submitter's `formaction`, or the field's `formmethod`. So the
  destination check runs a **second** time, in its own task, immediately before Enter
  is pressed (`input.rs`, `RECHECK_BODY`), and a form that changed is refused with
  nothing pressed. What that does not cover is a handler that runs *after* the
  recheck — `await`, a timer, a `requestAnimationFrame` — which can change the form
  in the gap between our evaluate returning and the key press arriving. That gap is
  the width of one round trip to the browser, and no ordering inside the page can
  close it. What covers it instead: the route refuses the non-GET request before it
  is sent, and from step 4 every non-GET request is *held* and confirmed, so a form
  rewritten in that window submits into a card a person saw.
- **Secrets in plain-text fields.** A password field is refused by type and by
  `autocomplete`, and a field that turns into one when focused is caught by
  reading the type after the focus. A secret typed into a plain text field is a
  secret in a plain text field, and nothing here notices.
- **Prompt injection, until step 3.** Page text is returned to the model fenced
  and with the run recoverable, or it is not, and until it is a page can say
  anything it likes in the voice of a person.
- **The provenance gate is the model gate, and it runs in the renderer.** The
  rule that an address must already have appeared in the conversation lives in
  `chat/src/lib/tools/fetchProvenance.ts`, not here, so a renderer that does not
  run it can call `brain_browser_open` directly with any address. What still
  applies to such a call is the route guard below and everything in
  `guard.rs`: non-http(s) schemes are refused, private and loopback addresses are
  refused, and the landing record still has to agree before any text is read.

### A closed window, told apart from a refusal

**A tool result can say the window is gone, and the host should read that field
rather than the sentence.** When the person closes the browser themselves, the
call that noticed answers with one of our own sentences and forgets the session —
the same shape as any other refusal, and the host cannot tell from prose that this
one means "there is no window any more" rather than "Kalsa would not". So the
answer carries the fact beside the text:

```jsonc
{
  "isError": true,
  "content": [{ "type": "text", "text": "the browser was closed…" }],
  "structuredContent": { "kalsa": { "gone": true } }
}
```

- **Read it at `structuredContent.kalsa.gone === true`.** It is present on exactly
  one answer — `view::gone`, reached only from `mcp.rs`'s `gone()`, which is
  called only when the window could not be reached — and **absent on every other
  result**, so its absence is the normal case and nothing has to be guessed from
  the text. A mark on any other answer would close a window that is still there,
  which is the worse failure, and a test asserts it is on only that one.
- **The text is unchanged and still there for the model.** The mark is added
  beside it, never in place of it.
- **In this crate** the same fact is on `mcp::Said::gone`, so a proof here reads it
  without parsing JSON.
- **`tool_pins.json` is unaffected.** `kalsa_mcp::digest::tool_digest` hashes a
  tool's **definition** — name, description and input schema — through
  `serde_json::to_value(&Tool)`; it never sees a result. A change to a result is
  therefore not a change to a pin, and no pin needs regenerating for this.

### Accepted, with the backstop that is left

Each of these is a page acting on itself, and each ends the same way: at Chrome's
own **"Open …?"** dialog, measured in the browser this runs on and written down
above — the handler is not launched until a person clicks it. That is the backstop
for all three, and it is the only thing behind the first two.

- **A page that replaces `Event.prototype.preventDefault`, `composedPath`, or
  calls `stopPropagation` after rewriting its own link.** Our listeners read the
  address and call `preventDefault`; a page that has replaced the method we would
  call is choosing not to be stopped, and there is no way to cancel an activation
  from script once that is true. **Backstop: the dialog**, and the model is
  watching a window where a dialog has appeared.
- **A closed shadow root.** `composedPath()` reports a closed root as the host,
  and an element inside a root nobody has opened is not something a read returns
  a ref for, so the tool layer cannot be pointed at one. **Backstop: the dialog**,
  and the tool layer's own refusal of everything it can name.
- **`window.open` and a `meta refresh` to an external scheme.** Neither fires a
  click or a submit event we see, and neither is something a read names. **Backstop:
  the dialog**, exactly as for a page that navigates itself. The fixture sweep in
  `tests/common/mod.rs` now treats both spellings as a fixture naming a real
  scheme, so a test cannot reintroduce one — that is about our own proofs, not
  about a page at runtime.
