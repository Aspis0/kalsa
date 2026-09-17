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
