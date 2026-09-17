# The desktop chat: what exists, what I verified, and how to proceed

Written 2026-09-17, night, after an overnight build by an open-source-only agent and my own
review. Everything below was checked on disk or run; nothing is repeated from the agent's
report on trust.

## 1. What actually exists

`/Users/marco/Projects/crescent-chat` — 14 commits, clean tree, `npm run build` green.
~2500 lines under `src/`, 33 Playwright screenshots in `shots/`, a `LOG.md` diary.

Dependencies, whole list: `react`, `react-dom`, `react-markdown` (MIT), `remark-gfm` (MIT),
plus `@playwright/test` (Apache-2.0) as a dev dependency. No Electron, no UI kit, no
highlighter, no state library, no telemetry.

The palette is the one asked for: `--accent: #1f5f4e` on `--page: #f4f8f3`, dark theme in the
same hue with a lightened accent `#75b3a0`, error red desaturated to `#8a3b32` and used as text
and border only, never as a fill.

**`src-tauri/` has no Rust crate** — only `tauri.conf.json`, a capabilities file and three
icons. There is no `Cargo.toml`, no `main.rs`. The app has never run as a desktop binary; every
screenshot is a browser. The agent said so itself, which is to its credit, but it means "desktop
app" is still a claim about a web page.

## 2. What I verified that no report claimed

The agent was blocked on "a real endpoint" and tested only against its own mock. A mock proves
the parser agrees with the mock. So I ran **its own client code against a real llama-server**:
`b10950`, Trinity-Nano-Q4_K_M, Metal, `--parallel 1 --ctx-size 4096`, on 127.0.0.1:8139,
transpiling `src/lib/chat.ts` and driving it from node.

- Normal stream: **first token 152 ms**, 116 `onToken` callbacks, 669 characters, 1.79 s total,
  clean prose. No `<|channel|>` or template tokens leaked into the text.
- Abort mid-stream at 0.7 s: threw `kind="aborted"`, kept **143 partial characters**, and the
  server answered the next request in **130 ms** — the slot is released, the Stop button does not
  strand the server.

So the client is not mock-shaped. That was the single largest unknown and it is closed.

## 3. Defects I found by looking, not by reading the log

1. **Opening the crescent dims the whole page like a modal.** `shots/02-streaming.png` and
   `shots/07-crescent20.png` are washed out next to `shots/01-empty.png` and
   `shots/03-code.png`, which are crisp. The same scrim used for the Settings dialog
   (`shots/17-settings.png`) is used for a *navigation* element. In `02` it dims an answer
   that is still streaming — the one moment the reader's eye is on the text. A switcher
   should not have modal weight.
2. **In `02-streaming` the open crescent overlaps the user's own message bubble.** The arc sits
   on top of the thread instead of pushing it down.
3. **Storage failure is silent.** `src/lib/store.ts:63` swallows a `localStorage` write failure
   with the comment *"Storage full or unavailable: the session keeps working in memory."* True,
   and the user is never told their conversations have stopped being saved. For the audience
   this app is for, silent data loss is the worst possible failure mode.
4. **Cold start parses the entire history.** `readAll()` (`src/lib/store.ts:25`) reads one
   `localStorage` key holding every conversation with every message nested inside, and
   `JSON.parse`s the lot before the first paint. Twenty threads of two hundred messages go
   through the parser to render a list of twenty titles.
5. **No first-token deadline.** `src/lib/chat.ts` has no timeout: a server that accepts the
   connection and never writes leaves the three dots forever, with only Stop to escape.
6. **`[DONE]` returns without cancelling the body.** `src/lib/chat.ts:92` returns from inside
   the read loop; the `finally` releases the reader lock but never calls `cancel()`, so the
   response body is left unconsumed. Same on the non-ok path at line 73.

None of these is fatal. 1 and 3 are the two I would fix before anyone else sees it.

## 4. The decision

**Keep it, and make it kalsa-brain's frontend — but do not merge it as a second app.**

The reasoning, in the order that matters:

- **The expensive part is done and it is the right part.** The chat surface is where the state,
  the streaming and the error copy live, and it is the part that is hard to get right in the
  1430 lines of vanilla JS the desktop app is written in today. The wizard pages
  (`setup.js` 134, `model.js` 126, `advanced.js` 169, `status.js` 206, `pairing.js` 261 — 896
  lines of JS total) are the cheap part: they are mostly forms and status readouts, and porting
  them into TSX is a bounded job.
- **The error copy is already better than ours.** `shots/05-denied.png` reads *"The server did
  not accept the key. It answered 401 — the token is missing, wrong, or expired. Check it in
  Settings and try again."* with a Try again and an Open settings. That register is the whole
  product thesis for someone who knows nothing.
- **A mixed stack is worse than either stack.** Half vanilla and half React in one Tauri window
  means two ways to do everything, forever.

**But the store is the phone's, not this one's.** The phone app already splits a conversation
index (`INDEX_KEY = "kalsa.conversations.v1"`, holding a `ConversationMeta` per chat with
`title`, `preview`, `searchBlob`, `hasMessages`) from the messages themselves, which live one
key per conversation (`messagesKey(id)` → `kalsa.messages.<id>`). Rendering the list therefore
never touches a message payload, and search runs against a capped blob rather than the history.
That design is both more scalable than the desktop's single blob and already shipped.
`src/lib/store.ts:8` declares exactly the seam for it:

> The ONLY module that knows where conversations live. […] a future backend replaces
> `createStore()` without touching any component.

So: keep the interface, throw away the localStorage implementation, and put the PC's store
behind it. Two smaller disagreements to settle at the same time: the phone calls the field
`text`, the desktop calls it `content` (OpenAI's name); and neither has a `parentId` yet — when
one is added it must be additive, per `docs/PRIOR-ART-CHAT-UIS.md`.

**What this implies architecturally.** The PC runs the server, so the PC chat talks to
`127.0.0.1` with no door in the path. If the phone's chats are to continue on the PC, the PC has
to be the store of record and the phone a client with a cache — not two peers merging. That
follows from where the model already lives; it is not a new requirement.

## 5. Not decided — needs the owner

- **The name.** "Crescent Chat" was a codename chosen to keep the product out of a channel that
  trains on its prompts. Whether the desktop chat is a second window, a tab, or the app itself
  is a product call.
- **Signing and the bundle.** `tauri init` plus an Apple signing identity. Nothing technical
  blocks it; it costs money and an account.
- **Whether the wizard and the chat are one window.** Cheapest is one window with the chat as
  the home surface and setup behind Settings. Not obviously right.

## 6. Correction: the crescent is not a conversation list

Owner, on reading the screenshots: *"mettere le chat nella mezzaluna è follia, ci si mette anni
a scrollare tutto. La mezzaluna deve avere un'altra funzione."* He is right, and the mistake is
mine — my brief told the agent to make it a conversation switcher.

The arithmetic alone settles it: six points visible, paged with arrows. Twenty conversations is
four pages of arrow-clicking; two hundred is forty. A list of documents grows without limit and
needs search, recency and grouping — none of which a fixed arc can offer.

And it was never that. In `devboule-v2`, `src/app/Shell.tsx:196` reads
`<div className="crescent-shell" role="navigation" aria-label="Devboule surfaces">` and
`Shell.tsx:74` lays out `SURFACE_KEYS`. The crescent is **top-level navigation over a fixed,
small set of surfaces**. `CRESCENT_VISIBLE_COUNT = 6` is a design constant, not a paging
compromise.

That fits this app exactly, and it fits the merge decided in §4: the surfaces are Chat, Models,
Server, Devices, Advanced, Settings — six, the same six the wizard pages already are. Paging
disappears entirely.

> **Superseded 2026-09-17 by `docs/THE-BRAIN-IS-THE-HOME.md`.** Listing Chat among the
> surfaces makes the conversation a peer of the settings page — six items in an arc are
> still six tabs. The brain is the home the app opens on, the chat is what happens inside
> it after you type in the brain's own writing bar, and the crescent carries the brain's
> five surfaces plus the way back. The rest of this section — that the crescent is
> navigation over a small fixed set, never a conversation list — stands.

Conversations move to what a list of documents needs: a vertical list grouped by recency, a
`⌘K` search, rename and delete. `docs/PRIOR-ART-CHAT-UIS.md` §2.6 already records where that
keyboard map comes from.

On the scrim, the owner is also right that it is deliberate — it is the same veil the Settings
dialog uses. The defect narrows to one case: it must not dim an answer that is still streaming.

## 7. The independent audit

Run on a different model from the one that wrote the code. It read the sources, re-derived the
colour arithmetic independently, executed the real `chat.ts` against seventeen synthetic
streams, rendered the real `Markdown.tsx` through `react-dom/server`, and measured the CSS in a
real Chromium. Fourteen findings, plus a list of things it checked and cleared.

**Re-verified by me on disk, not relayed on trust:**

- **`var(--white)` is not defined.** `src/components/CrescentNav.css:141` and `:195` both set
  `color: var(--white)` over `background: var(--accent)`. `grep` finds the token nowhere else in
  the repo — it is never declared. An undefined custom property makes the declaration invalid at
  computed-value time, so `color` inherits: the active point's glyph renders at **2.23:1** in
  light and **2.08:1** in dark. It is visible in `shots/24-active-nav.png`, and `LOG.md:195` had
  already promoted it to a design choice ("glifo scuro").
  The colour is not the serious part. `scripts/palette.mjs` certifies 22/22 PASS against
  **literal pairs** the app does not render on those elements; the arithmetic is correct (all
  twenty-two numbers reproduce under an independent implementation) but the list of pairs never
  touches the CSS. This is the same defect class as
  `tests-that-rebuild-their-subject`: a check whose contract is with itself.
- **Model markdown can call arbitrary hosts.** `src/components/Markdown.tsx:64` passes only
  `pre`/`code`/`a` overrides — no `allowedElements`, no `img`. `![x](https://host/p.gif?c=…)`
  becomes a real `<img>`, i.e. a network request carrying IP, time and `Referer`, and an exit
  channel for conversation text placed in the query. `README.md:9` promises the opposite:
  *"the only network call the app ever makes is the user-configured endpoint"*. `index.html` has
  no meta CSP, so in `dev`/`preview` the request goes out. (Raw HTML and `javascript:` URLs are
  already neutralised by react-markdown v9 — that side is clean.)
- **`completionsUrl` doubles `/v1`.** Executed, not read:
  `https://api.openai.com/v1` → `https://api.openai.com/v1/v1/chat/completions`; same for
  `http://localhost:11434/v1` and `https://openrouter.ai/api/v1`. That is the base URL every
  provider publishes, and the error shown (`Thread.tsx:33`) carries neither the status nor the
  URL, so the user cannot see what happened.
- **Sending in one conversation stops another's stream, and the same file knows better.**
  `src/App.tsx:258` computes a conversation-scoped streaming flag for the Thread; six lines
  later `src/App.tsx:264` hands the Composer the **global** one. So: generate in A, open B,
  type, press Enter → `Composer.tsx:37` calls `onStop()`, A's answer is truncated and marked
  stopped, and B's text is neither sent nor cleared.

**Relayed, consistent with code I read but not independently reproduced:** a 200 response that
is not SSE is dropped in silence and reported as "unreachable"; a stream that ends without
`[DONE]` is announced as "Response complete."; a storage-quota failure is swallowed while the
listeners still fire, so the UI shows messages that are not on disk; unvalidated message
elements plus no error boundary anywhere turn corrupted storage into a blank window with no way
back to Settings; two windows overwrite each other's conversations.

**Checked and cleared, with evidence:** no secrets in the 33 committed PNGs (chunk-level parse
plus OCR of all of them, and a sweep of every blob in git history); no third-party network in
the sources or the bundle; the SSE frame reassembly is correct across split chunks, CRLF, two
events in one chunk, malformed JSON mid-stream and multibyte UTF-8 split across reads; the token
appears only in the `Authorization` header — there is not a single `console.` call in `src/`;
`tsc --noEmit` exits 0.

All of it is now in front of the agent that wrote the code, together with the crescent
correction, as one brief.

## 8. The fix for §7's first finding, proven by mutation

The agent replaced the literal-pair script with `scripts/contrast-dom.mjs`, which reads
`getComputedStyle()` from a live page in both themes and takes the background from the first
opaque ancestor. Its header says what it is for: *"An undefined token (the --white bug) fails
here because the computed value is what the user gets, not what we meant."*

A check nobody has watched fail is not a verified check — that is the whole lesson of §7. So I
copied the tree to a scratch directory (never the live one, an agent was writing in it), served
it on a spare port and ran the mutation:

- unmutated: **exit 0**, 44 pairs, including `7.49 PASS active nav point (rgb(255,255,255) on
  rgb(31,95,78))` — the element that was broken.
- `color: var(--accent-ink)` → `color: var(--white)` on `CrescentNav.css:141`: **exit 1**,
  `2.23 FAIL active nav point (rgb(23,32,28) on rgb(31,95,78))` in light and `2.08 FAIL` in dark.

Those are the same two numbers the auditor measured independently. The check has teeth.

Scratch tree removed, live tree untouched.

## 9. Final state, verified by running it

Twenty-one commits, clean tree, 3401 lines across 27 files, 33 screenshots — all reproducible
(28 from `scripts/shots.mjs`, 5 from `scripts/verify.mjs`; no orphans, which was worth checking
because the earlier `29-motion-*` PNGs had none).

Every suite run by me, not reported to me:

| | result |
|---|---|
| `npm run build` | exit 0 |
| `node scripts/verify.mjs` | exit 0, 55 assertions |
| `node scripts/contrast-dom.mjs` | exit 0, 56 computed pairs |

And two mutations, because a check nobody has watched fail is not a check:

- `color: var(--accent-ink)` → `var(--white)` on `CrescentNav.css:141` → **exit 1**, `2.23 FAIL`
  light, `2.08 FAIL` dark.
- `img: BlockedImage` commented out in `Markdown.tsx:120` → **exit 1**, `FAIL zero img
  elements`, `FAIL notice shown`.

Both restored; `git status` clean afterwards.

**The end-to-end that was still missing.** Everything above still ran against a mock. So I
started the real llama-server (b10950, Trinity, 127.0.0.1:8139), served the app, seeded nothing
but the endpoint, typed a question in the real UI and pressed Enter:

- first rendered paragraph at **200 ms**, 126 characters of real generated prose at 404 ms;
- **zero external requests** — every request went either to the app's own assets or to
  127.0.0.1:8139. Measured by listening on Playwright's `request` event, not asserted by the
  app about itself.

The crescent now carries six labelled surfaces (Chat, Models, Server, Devices, Advanced,
Settings) with no paging arrows, and conversations live in a sidebar with a `⌘K` search,
recency groups, a preview line and inline rename. The contrast suite covers the new sidebar
elements by name (`sidebar new`, `sidebar search`, `sidebar title`, `sidebar preview`,
`sidebar group`, `blocked image`), so the pale-looking "+ New chat" in a dimmed screenshot is a
measured pair, not a guess — undimmed it is the deep accent with white text.

**What is still true from §5**: there is no Rust crate, so this is a very well-verified web
page, not yet a signed desktop binary. Naming, signing and one-window-or-two remain the owner's
calls. Nothing has been pushed.
