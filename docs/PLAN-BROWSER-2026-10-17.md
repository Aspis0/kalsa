# Plan: a browser Kalsa drives (beta)

Owner decisions, 2026-10-17 (fixed; this plan does not reopen them):

- **Driver:** `playwright-rs =0.20.1`, **assembled by us** from pinned upstream sources, hosted on our own download location, pinned by SHA256, verified before it runs. Never fetched from npm or nodejs.org at runtime. Not in the installer.
- **Browsers:** installed Chrome / Edge / Brave only. **Chromium is out** (`dev/lab-browser-rs/src/tools.rs:15` still lists it; the port drops it). No browser found → the tool is not offered, with one plain line saying why.
- **Profile:** a dedicated Kalsa directory under app data. Never the user's profile, never copied from it. Logins persist; Settings has one **"Clear Kalsa's browser data"** that wipes it. Forced, not preferred: since Chrome 136 the remote debugging switches are ignored on the default data directory ([developer.chrome.com/blog/remote-debugging-port](https://developer.chrome.com/blog/remote-debugging-port)).
- **Visible window only.** No headless. **Closing the window ends the session** — there is no paused-session timeout beyond that.
- **Model tools:** `open`, `read {page}`, `find`, `click`, `type {ref, text}`. **No `submit` anywhere**: the code decides Enter.
- **The model never types into a password field.** `type` on one is refused, with a plain line telling the model to ask the person to type it in the window.
- **Every non-http(s) navigation is refused outright in slice 1** — `mailto:`, `tel:`, `javascript:`, `file:`, `data:`, everything else. **No OS handoff, no confirm.**
- **Downloads are refused outright in slice 1.** The context is created with downloads not accepted (`protocol/browser_context/options.rs:290`), so there is nothing to ask about and nowhere for a file to land. No download confirm exists in this plan.
- **Service workers are blocked on the context and WebSockets are refused**, so route interception sees every request the page makes.
- **A confirm covers every non-GET request** the page issues — form posts, `fetch`, XHR, `sendBeacon`, scripted submits — not only form posts. GET navigations (a `method=get` form, a link click) are reads, and that is stated in Risks.
- **Confirms are decided in code, never by the model.** The model is told a request is `awaiting confirm <id>` and is told the outcome — it is never shown the card, never sees the payload outside the fenced tool result, and **has no tool that can answer one**.
- **Minimum browser: Chrome / Edge / Brave 142 or newer.** Older builds get the local-network protection only from our own route refusal, so on anything older the tool is not offered, with one plain line saying why.
- **Page text is untrusted**, arms addresses like `web_fetch`, and closes the text-to-tool-call channel like any other outside content.
- **Not in the Room** in slice 1.

Spike: `dev/lab-browser-rs/`, `dev/lab-browser/` (untracked labs). Accepted 2026-10-17.
Revised after three luna hostile audits, 2026-10-17.

## What the spike proved

- `playwright-rs 0.20.1` drove the installed Google Chrome 155.0.8059.84 over a throwaway profile. `~/Library/Caches/ms-playwright` was **byte-identical before and after**: no browser download happened.
- Driver **146 MB**, binary **6.0 MB**, clean release build **27 s** with the driver already cached.
- `--backend rs` ran the same tasks, verifiers and records as `--backend node`; both exit 0.
- **Task 2's opening snapshot is byte-identical** between backends (5450 chars, 0 differing lines). The Brooklyn article differs by **one line**, from Playwright **1.63** (node) vs **1.64** (driver).
- Live models on the real sidecar: Qwen 10/10, Gemma 12B 10/10, Gemma E4B 8/10.

**Two bugs the spike found, fixed in both parsers** (`dev/lab-browser/snapshot.mjs:38`, `dev/lab-browser-rs/src/tree.rs:42`): Playwright 1.64 began emitting value-less props (`[expanded]`), which a `key=value`-only regex cannot strip. The node parser had the same latent defect, hidden only by 1.63 — **the node driver must reach 1.64 before beta.**

## Enter, decided in code

Fill, then press Enter **iff** the node is an `HTMLInputElement` of type `text, search, email, url, tel, number`, **with or without a `<form>` ancestor**. Otherwise do not: a `<textarea>`, a `contenteditable` or a `<select>` is filled and left alone — the first two hold several lines by design, so a multi-line answer cannot submit itself, and the third is not a field anyone types into at all.

**The form is not part of the rule, and holding out for it is what made the rule wrong.** TodoMVC's new-todo input, a chat box and most search boxes are single-line inputs with no form at all, whose keydown handler commits what was typed: under a form-only rule a model typed its answer into one and pressed nothing, and the page never heard the rest of the request. That is the model watching a field take its words and do nothing with them. E4B's todomvc failure was this, and it was a code fix after all.

What pressing Enter can cost is a request, and that is the hold's business, not this rule's: every write Enter can set off is a non-GET, and a non-GET is held like every other write — refused in slice 1, confirmed from step 4. A JS app that commits on Enter issues no request at all, so there is nothing there to hold. The destination re-read immediately before the key goes down (`RECHECK_BODY`) is unchanged.

Proved by unit tests over these shapes **and** over a real browser in `tests/input.rs`, where a one-line field inside a form and one with no form both take Enter, a textarea and an editable block do not, and a `<select>` is refused before anything is written.

## Submission is a held request, not a cancelled event

A `preventDefault` on the submit event is not enough, for two separate reasons. It loses the payload — the card would be guessing what the site was about to receive. And it only ever sees *form* submits, including a scripted `requestSubmit()`, which does fire the submit event; `fetch()`, XHR and `sendBeacon()` never go through that event at all. So **every non-GET request the page makes is intercepted at the route** — POST, PUT, PATCH, DELETE, form posts, `fetch`/XHR, `sendBeacon`, all of them.

1. The route **holds** the request. Nothing is sent.
2. The confirm card shows **the actual held request**: URL, method, and the serialized body field names with values **exactly as sent**, hidden fields included.
3. On confirm, **that same held request continues**. On decline it is aborted and the model is told plainly.

This binds the card to the payload the site would really have received, and it covers script-initiated submits because a script's request is a route like any other. The Enter rule above stands unchanged by this: a JS app that commits on Enter issues no request, so there is nothing to hold, and a form that submits on Enter issues a non-GET, which is held like any other write.

GET navigations — form submits with `method=get`, and link clicks — are **reads**. That is stated in Risks, not buried.

**What the card may show.** Only bodies we can render honestly: `application/x-www-form-urlencoded`, `multipart/form-data` text fields, and JSON up to **16 KB**. Anything else — a different content type, a multipart part that carries a file, a JSON body over the cap — is **refused with one plain line** telling the model the person cannot see this request. We do not show a truncated payload and call it the real one.

## The call does not wait for the person

The MCP deadline is **60 s** (`crates/kalsa-mcp/src/session.rs:20`, applied to every tool call at `:59`). A person reading a request card is slower than that, so the tool call **cannot** stay pending across a confirm. Instead:

- The held route lives in the sidecar, keyed by an id.
- The tool call **returns `awaiting confirm <id>` immediately**, inside the deadline, and the turn continues without an answer about the request.
- **Confirm and decline are separate calls.** They take the id, and the id is spent whether the answer is yes or no.
- The pending confirms are an **independent store** in the app, not a field on the call. **No mutex is held across `host.call().await`** — mail's shape (`src-tauri/src/mail/state.rs:28-29` takes the slot guard, `:39-47` holds it across `host.call(...).await`) is exactly right for a short mailbox call and exactly wrong here: holding the slot for minutes would lock out every other browser command, and would break the moment a window closes.
- **Auto-decline after 5 minutes**, and on window close. A held request nobody answered is not dispatched; the route is released and the model is told it expired.

## Every confirm is consumed before dispatch, never retried

This holds for **every** confirm, not only forms. The id is taken before the action is dispatched. If the press landed and the answer never arrived, the outcome is reported as **ambiguous** and is never retried: a retried submit is a second message to a stranger's server.

## Navigation and address refusal, at the route

Enforced on **every** request the browser makes — navigations, redirects, popups, form actions and subresources — not only on `open`.

- Every non-http(s) scheme refused outright, slice 1, no OS handoff and no confirm.
- Refused when the host is `localhost`, a literal loopback / private / link-local IP, or a `.local` name.
- Enforced in route interception, so a redirect cannot slip past a check made at open time.
- Popups open in the same controlled context or are refused.
- **Service workers are blocked on the context** (`serviceWorkers: "block"`), because Playwright says so in terms: *"browserContext.route() will not intercept requests intercepted by Service Worker… We recommend disabling Service Workers when using request interception by setting serviceWorkers to 'block'."* ([playwright.dev/docs/api/class-browsercontext](https://playwright.dev/docs/api/class-browsercontext); the option exists at `protocol/browser_context/options.rs:411`). Without this, a page that registers a worker could issue requests **behind the route**, and every refusal above would be a rule with a hole in it.
- **WebSockets are refused in slice 1** via `routeWebSocket` (`protocol/browser_context/network.rs:261`): the handler closes every socket rather than letting one open. A socket is a channel we neither hold nor show, so it cannot be confirmed.
- **Downloads are refused**: the context does not accept them (`protocol/browser_context/options.rs:290`), so there is no file on disk and no download confirm anywhere in this plan.

**A second layer, and it is a backstop only for literal targets.** Chrome's Local Network Access permission prompt launched in Chrome 142 ([developer.chrome.com/blog/local-network-access](https://developer.chrome.com/blog/local-network-access)). But the same post is explicit about what Chrome can know *before* resolving: *"The request hostname is a private IP literal (e.g., 192.168.0.1). The request hostname is a .local domain."* — and its own example comments that a *"Public domain is not exempt… even if it resolves to a local network address."* So LNA is a browser-level backstop for **literal** private targets, on top of our route refusal, and it is not a rebinding defence. That is why the minimum version is 142: on anything older the tool is simply not offered.

**Residual risk we cannot close:** a public name that resolves to a private address (DNS rebinding) — the route sees a public host, and the name resolves later. I found **no Chrome launch flag that blocks rebinding**; `--host-resolver-rules` pins resolution but is not a rebinding defence. Our route refusal of literal private addresses and `.local` remains the primary defence, and rebinding is accepted risk, stated here.

## Untrusted page text

- **Arming.** Every tool that returns page text — `open`, `read`, `find`, `click`, `type` — puts its addresses into the provenance corpus. The gate at `chat/src/lib/tools/fetchProvenance.ts:157` admits `web_search` and `web_fetch` today; the browser tools join **there and nowhere else**.
- **The model's own argument.** `web_fetch` strips the fragment, takes the provenance refusal, then the gate, at `chat/src/lib/tools/registry.ts:160-173`. **This plan adds the same three steps for `browser_open`**, in `registry.ts`, before the browser is asked for anything. Tested on the argument directly: a URL the model invented is refused, and a credential-bearing link is caught whole.
- **Closing the channel.** `WEB_NAMES` (`chat/src/lib/toolLoop.ts:316-320`) is exactly the set whose results are outside content a stranger can speak into. The browser tools **join** it, so the recovery guard at `chat/src/lib/toolLoop.ts:190-192` is off after any browser result, not only a web one. Snapshot text is fenced per call with a random marker.

## Storage and logs

- **This plan adds the stub.** Today `forDisk` returns a non-mail run **unchanged** — `if (!isMailRun(run.name))` returns the run as it is, arguments and result included (`chat/src/lib/store.ts:303-305`) — and only the mail branch that follows blanks them (`chat/src/lib/store.ts:309-315`). A browser run would put page text in `localStorage`. So a browser branch is **added** to `forDisk` (`chat/src/lib/store.ts:293`) keeping name and a count, never arguments or result, with a test that plants a page body and finds it absent from what is written.
- Diagnostics carry **no page text, no URL query string, no form value**. A test plants all three and asserts they appear in no log, no error, no panic message and no report.

## Confirm routing

- **The device that started the turn confirms.** A phone turn gets the phone card; a desktop turn gets the desktop card. **There is no desktop→phone confirm path at all.**
- Device-bound, single-use, short-lived. **What we reuse:** the device→owner binding (`src-tauri/src/phone_chat.rs:210`) and the lifetime idea (`src-tauri/src/phone_chat/drafts.rs:12`), with the phone card shaped on `~/Projects/kalsa/src/ui/shell/MailDraftCard.tsx:5-7`, whose confirm is the only sender and whose spent id it copies.
- **What we do not reuse: mail's retry.** A mail draft that fails *"waits for the person to try again"* (`src-tauri/src/phone_chat/drafts.rs:120-121`), which is right for composing a message and wrong here. A browser confirm is **consumed before dispatch and is never retried**, on any outcome: if the press landed and the answer never came back, the result is reported as ambiguous, never attempted a second time. Re-trying a held request is a second message to a stranger's server.
- The card shows the held request. If the person typed into a password field **during a takeover**, that field's value is **masked on every card** — the model never types one, but a person might.
- Until step 5 lands the browser tools are filtered out of `phoneTools` (`chat/src/lib/phone/phoneTurn.ts:30-34`), as mail is. After it, they are offered and **every confirm fails closed** if the phone cannot be reached.

## Cancellation, and one page at a time

- Pause and Stop carry an **out-of-band cancel token, checked before every side effect**.
- **Pause stops the next action, and cannot undo a dispatched one.** A click already sent, a request already held but confirmed, a navigation already in flight: none of it is recalled. The rule is stated plainly on the Pausa control, because the alternative — pretending it is reversible — would be a lie in the UI.
- **One page is driven by one turn.** A second turn gets a plain "browser busy", never a second browser.
- Window closed or driver crash mid-call is a clean, single error, never a retry.

## Steps

Each is shippable alone and ends with a review.

### 1. Sidecar + snapshot port

Moves the spike into `crates/kalsa-browser` and nothing else.

- `src/main.rs` — rmcp stdio server
- `src/mcp.rs` — the tool surface, hand-written, as `crates/kalsa-mail/src/mcp.rs:1-4`
- `src/tree.rs` — the aria-tree parser
- `src/snapshot.rs` — parts and find
- `src/refs.rs` — ref ↔ node
- `src/input.rs` — click / fill / Enter, with the Enter rule
- `src/launch.rs` — launch the installed browser with the Kalsa profile
- `src/find_browser.rs` — macOS `.app` paths, Windows `App Paths` (no Chromium)
- `src/guard.rs` — scheme and address refusal at the route
- `src/hold.rs` — hold every non-GET request
- `src/context.rs` — the context options that make the route authoritative: downloads not accepted, service workers blocked, WebSockets refused

**One parser, not two.** The lab stops carrying its own copy: `dev/lab-browser-rs` becomes a thin wrapper depending on `kalsa-browser`, so a snapshot fix lands in the lab and the product together. It is deleted when the product ships.

Proof: unit tests for the Enter rule (four shapes), the parser (`[expanded]`, single-quoted names), `find_browser` on a table of real paths, scheme and address refusal on navigations **and** subresources, and a held POST from both a form and `fetch()`. **Context proofs, and they are the ones that could quietly pass while the hole stays open:** a page that registers a service worker and fetches through it is still seen by the route (or never runs at all); a `new WebSocket()` is closed and the page observes it closed; a click on a download link leaves **no file** anywhere. **Window-closed-mid-call and driver-crash tests live here**, at the sidecar boundary. The battery runs against **the product crate** with a **pre-verified driver fixture**, on tasks **1, 2, 3, 5, 6** — task 4 submits a form and belongs to step 4.
**Does not:** offer a tool to any model, download anything, or draw a confirm.

### 2. Host wiring + driver download

- `src-tauri/src/browser/mod.rs`, `state.rs`, `commands.rs`, `error.rs`
- `src-tauri/src/browser/driver.rs` — verify and resolve
- `src-tauri/src/browser/fetch.rs` — the transfer, and the cancel token it reads
- `src-tauri/src/browser/unpack.rs` — the archive into a directory, refusing any name that climbs
- `src-tauri/src/browser/tree.rs` — the tree digest, pinned beside the archive digest
- `src-tauri/src/browser/profile.rs` — the profile dir, and **Clear Kalsa's browser data**
- `src-tauri/src/browser/DownloadDriver.tsx` — **the first-use UI: press, progress, cancel, failure**
- `chat/src/components/browser/ClearBrowserData.tsx`
- `tool_pins.json` — beside `mail.*` (`src-tauri/src/mail/tool_pins.json:3-6`)
- `program.rs` — the digest pin, shaped on `src-tauri/src/mail/program.rs:10`

**The pending-confirm store is step 4, not this one.** Nothing here holds a request, so there is nothing to keep; `pending.rs` lands with `confirm.rs` and the card, and inherits the no-mutex-across-a-call rule from the note in *The call does not wait for the person*.
**Clear refuses while a download is running** (both write under the same app-data folder), and from step 3 **while a browser session is open** — a profile directory in use is not one to empty underneath a live browser. That second refusal lands in step 3 with the session it belongs to.

**Where the driver comes from.** `playwright-rs` fetches `playwright-core` from npm and Node from nodejs.org (`driver_urls.rs:51-65`) with **no digest check** (`driver_assembly.rs:141-156`). So the build sets `PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD`, and the **release pipeline assembles the driver itself** from those sources at pinned versions, verifies the result, and publishes the archive on our own download location.

At sidecar launch the environment is set explicitly, because `playwright-rs` honours overrides we do not want: **`PLAYWRIGHT_DRIVER_PATH`** points at the verified directory, which short-circuits the whole fallback chain (`driver.rs:13`, resolved at `:88`), while **`PLAYWRIGHT_NODE_EXE` and `PLAYWRIGHT_CLI_JS` are cleared** — each replaces the runtime and the CLI script outright, and setting both means *"no driver directory is needed at all"* (`driver.rs:25-31`, `:69-81`). `PLAYWRIGHT_DRIVER_CACHE_DIR` is deliberately **not** treated as a runtime control: upstream describes it only as moving where `build.rs` assembled the driver (`driver.rs:17`), so it is set **at build time**, where it belongs, and the runtime relies on `PLAYWRIGHT_DRIVER_PATH` instead. **The extracted driver's digest is re-verified on every launch**, so a tampered cache directory cannot survive a restart.

First use is an explicit press with progress in plain Italian; it never blocks the chat.
Proof: a test deletes the cache, re-runs, and asserts the digest is checked before any browser starts; a tampered archive is refused and nothing launches; unsetting the pin makes the tool disappear rather than run unpinned; a poisoned `PLAYWRIGHT_NODE_EXE` in the ambient environment does not change which driver runs. Cancellation and "browser busy" tests.
**Does not:** offer the tools to the chat, or wire a confirm.

### 3. Chat read tools + provenance

Offers **`open`, `read`, `find` only.** Click and type appear in step 4, with the confirms that guard them.

- `chat/src/lib/tools/browserCall.ts` — one Tauri command per call, shaped on `mailCall.ts:1-12`
- `chat/src/lib/tools/browserTools.ts` — the definitions
- `chat/src/lib/tools/registry.ts:63` (`offeredTools`) — desktop only, and only when a browser exists
- `registry.ts:160-173` — the same fragment-strip, provenance and gate steps added for `browser_open`
- `fetchProvenance.ts:157` — the three tools arm addresses
- `toolLoop.ts:316-320` — the tools join `WEB_NAMES`
- `store.ts:293` — the new stub branch in `forDisk`
- `runToolCall.ts:54` — the envelope, the abort path, the busy refusal

Proof, all with `open` alone — no click and no type in this step: a page carrying `https://evil.example/x` arms a later fetch, allowed; a URL the model invented is refused; a `169.254.169.254` link present in the page is refused when followed; a page full of `<|tool_call_start|>` markup produces no tool call, and no recovery after any browser result; a reload shows a stub, not the page; the log-privacy test plants page text, a query string and a form value and finds none.
**Does not:** click, type, or write to any site.

### 4. Desktop confirm card

- `src-tauri/src/browser/confirm.rs` — single-use and short-lived, borrowing the lifetime and device binding from `phone_chat/drafts.rs:12` and `:92-118` but **not** its retry rule
- `src-tauri/src/browser/pending.rs` — the held requests by id: its own map, **no mutex held across a call**, 5-minute auto-decline (moved here from step 2, which holds nothing)
- `chat/src/components/browser/BrowserConfirm.tsx` — shaped on `SendConfirm.tsx:9-12`
- `chat/src/components/browser/BrowserPause.tsx` — Pausa / Riprendi, stating that pause stops the next action
- `i18n/` — five languages

Click and type are offered from here and not before. A password field refuses the type and asks for takeover instead.
Proof: a held POST from Enter, from click-on-submit and from scripted `requestSubmit()`, each stopped before dispatch and each showing the payload as sent, hidden fields included; a body in a content type we cannot render honestly, and a multipart part carrying a file, are each refused with one line; **the tool call returns `awaiting confirm <id>` well inside the 60 s deadline while the request is still held, and a second browser call still runs while that confirm is pending** — that is the test that proves no mutex is held across it; the id is consumed before dispatch and a second press is refused; a declined submit changes nothing on the page and the model is told; a password field is never typed into; **an unanswered confirm auto-declines at 5 minutes and, closing the window, releases the held route without dispatching it**; **pause leaves the just-dispatched click in place and stops the next action**; **window-closed-mid-call and driver-crash tests at the UI boundary** too.
**Does not:** reach the phone.

### 5. Phone confirm round-trip (both repos)

- `chat/src/lib/phone/phoneRequest.ts:13-18` — **`PhoneTurn` carries the request id and the device**, so the confirm can be routed to the turn's own device
- `chat/src/lib/phone/phoneRunner.ts:46-49` — passes that request through to the turn
- `chat/src/lib/runToolCall.ts:54` — **a confirm context instead of `null`** for browser tools
- `chat/src/lib/phone/phoneTurn.ts:30-34` — the filter that held the tools back is lifted
- `src-tauri/src/phone_chat.rs` — **a new event in the accepted set** (`:29-40`), with schema and protocol tests
- `docs/PHONE-CHAT-PROTOCOL.md` — the new event documented
- `~/Projects/kalsa` — `BrowserConfirmCard.tsx` beside `MailDraftCard.tsx:5-7`, showing the held request and masking any password field the person typed during takeover

Proof: a phone turn confirms on the phone and the desktop acts; a desktop turn never draws a phone card; unpair mid-flight and the confirm dies; an unreachable phone fails the confirm closed; the protocol tests accept the new event and reject a malformed one.
**Does not:** put a browser in the Room.

### 6. Lab acceptance on the real app path

Qwen, Gemma 12B and Gemma E4B against the shipped sidecar through the desktop app: `--runs 3`, thinking off. Gates, set before the run:
- every judged task passes on **at least two of three** models;
- task 2 passes **with `answerSeen` true** — a price recalled from memory is not a browser working;
- **task 6 is judged by the owner against the page**, by hand; it has no code verifier and never will;
- no confirm is skipped by any model on any run;
- no run reaches Playwright's own browsers;
- no page text, query string or form value in any log.

The Enter rule is **not** gated here; it is proved by the unit tests in step 1.

## Packaging

Mail's packaging step is **not wired yet** — `docs/PLAN-MAIL-MCP-2026-10-14.md:276` says so. This plan wires `externalBin`/resources for **both** sidecars, so `kalsa-browser` is not the second one waiting on it. The driver archive is a separate download, not an installer payload.

## Risks

- **146 MB on first use**, on a metered connection. It waits on an explicit press, shows progress, and never blocks the chat.
- **Driver drift.** 1.63 vs 1.64 already moved our snapshots by one line. The pin is the defence; a driver bump is a release event, never a background update.
- **A page is hostile**: slow, enormous, or trying to make the model leave. The part cap, the fence, the step cap and the scheme refusal are mitigations, and none substitutes for the confirms.
- **GET navigations are reads and a GET can have effects.** A signed-out page, a "mark as read", a tracking pixel, a form with `method=get`. Confirming every GET would make the tool unusable, so this is accepted risk — stated here rather than buried. Only non-GET requests are held.
- **DNS rebinding** against our own address refusal: no Chrome flag blocks it and none was found. Chrome's Local Network Access does not close it either — it recognises a private IP literal and a `.local` name before resolving, and by its own example not a public name that happens to resolve privately. Accepted risk, stated here and not solved.
- **Chrome can change beneath us.** The remote-debugging restriction is already load-bearing for the profile decision.
- **E4B-class models.** Two of three pass today. Every further fix belongs in the code, never in the prompt.

## Open questions I cannot resolve

- **Where the driver archive is hosted.** A Kalsa download location, pinned and served over HTTPS, is required; the owner has not chosen one. Until it exists the "pinned SHA256" is a digest of whatever arrived, which is weaker than the phrase sounds.
- **Does the Room get confirms later?** Excluded from slice 1; the confirm store is device-bound and single-use, so it is a placement question, not a model one.
- **Which languages ship first.** The confirm cards need five; the browser tool's own copy may be Italian-first, like mail drafts.