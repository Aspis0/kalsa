# DESIGN + BUILD PLAN — the interface from scratch

Owner decision 2026-09-21 (`PLAN.md` in the lab repo, commit `ff13309b`): the whole interface is
replaced. **Corrected the same day by the owner, and this document carries the correction:** the
palette that survives is the **green** one — the app's `palettes.js` (`accent #1f5f4e`) and Kalsa
Brain's `chat/src/styles/tokens.css` (`--accent: #1f5f4e`), the same family as `BrandIcon.tsx`
(`#1F5F4E` + cream `#F4EFE4`). The "notebook" cream/teal palette that `tokens.ts` used to carry was
**dead code that nothing imported, citing a file that never existed in this repository's history**;
it has been deleted. Three assets survive: **the palette, the empty-state photograph, the logo.**

The engine, the governor, the session/KV code, the pins and the Meter are **not mine**. The new
interface calls the same services. It replaces the shell, not the machine.

---

## Part 1 — The facts everything else obeys

### 1.1 The two viewports, measured

| | Jelly Star | Galaxy S23 |
|---|---|---|
| physical | 480 × 854 px @ 220 dpi | 1080 × 2340 px @ 480 dpi |
| logical | **349 × 621 dp**, 3.0 in | **360 × 780 dp**, 6.1 in |
| app area with system bars | **349 × 325 dp** (480 × 447 px) | — |

The logical widths are nearly identical, so a layout that breaks only on width looks fine on both
and hides its bug. **Height and physical legibility are what differ**, so the design is tuned on
height and verified at 325 dp. RN 0.86 enforces **edge-to-edge on Android 15+**: the transcript
scrolls under a translucent strip and the composer sits above the gesture bar. Design for that from
the first commit, not after.

### 1.2 The palette, measured

Every pair passes in both modes, so the palette needs **no correction**: ink on page 15.53:1 light /
15.78:1 dark; accent as text 6.98 / 7.59; white on a filled accent control 7.49 / 7.59; danger 7.11 /
7.92; hairlines 1.26 / 1.51. The user's turn sits on `selection #cfe3d6`, a **1.25:1** step off the
page — deliberately the same step ChatGPT's own bubble takes (≈1.24:1) — with ink on it at 12.39:1.

Two constraints the measurements impose, both now enforced by tests
(`src/theme/design.test.ts`, 25+ cases):
- **A surface cannot be told from the page by a border** (white on `#f4f8f3` is 1.07:1), so
  elevation and whitespace carry it. This is why the empty state's suggestion rows are hairline
  rows, not white cards.
- **Inside the dark user turn, tertiary text (4.22:1) and the accent (4.49:1) are below AA.** Only
  ink and inkSoft may appear there.

### 1.3 The type

**Inter** for the interface, **Source Serif 4** as the reading face for the answer, **IBM Plex Mono**
for code and figures. Source Serif 4 and Plex Mono are already bundled; **Inter is the only new
dependency**. The reading serif is not taste: Claude ships serif response body with a sans chrome,
and the app already reached for a serif in the chat body — the instinct was right, the pairing was
not (`typography.ts` declared `body = Bricolage` but `bodyItalic = SourceSerif4_400Regular_Italic`,
so an italic word jumped to another family's serif). Faces go from **12 loaded to 10 loaded**,
measured after the change rather than estimated — and **9 of those 10 are referenced by a role**:
`Inter_700Bold` is loaded and referenced by none. An audit caught this document saying 10 in one
place and 9 in another without either number saying what it counted.
`IBMPlexMono_700Bold` stays, because `monoXs` is consumed by `AppShell.tsx:6959`, `RecentCard.tsx:71`,
`MetricCard.tsx:19`, `Pill.tsx:96` and `WizardStepper.tsx:78`, and dropping it would have silently
un-bolded real UI. (`MetricRow.tsx:29` was the sixth consumer an earlier version of this document
cited; it uses `monoSm` plus an explicit `fontFamilies.monoBold` override, so the conclusion holds
through a different mechanism.) The boot gate (`App.tsx:142` blocks the first paint until the fonts
load) still gets shorter.

The Android trap, already documented in the repo and encoded as a test: **weight lives in the face
name**; a numeric `fontWeight` beside a custom family is silently ignored on device.

### 1.4 What the machine can and cannot tell us (the honesty inventory)

Read from the code, not assumed. The interface may show only what is observable.

| state | observable? | evidence |
|---|---|---|
| unreachable / error | **yes** | a closed code table `remote_brain_*` including `_network`, `_timeout`, `_busy`, `_model_missing` |
| reachable | **yes**, on the `remote-brain` branch only | a probe with a 10 s timeout |
| streaming | **yes** | the SSE stream *is* the state |
| model loading | **partial** | the engine's `/health` answers until ready; nothing polls it |
| **server busy with a named device** | **NO** | the fact exists in four pieces on the PC (`lib.rs:127-180` `ActiveDevices`, `devices.rs:179-184` `label(id)`, the join at `main.rs:243-265`, the DTO at `metrics.rs:37-42`) but **none is on a socket a phone can open** — they travel over Tauri IPC only. One route away. |
| **queue position / "you are next"** | **NO** | the door runs a bounded in-process wait — `mpsc::sync_channel(QUEUE)` with `QUEUE = 8` (`crates/kalsa-door/src/lib.rs:79-80`) — and refuses with `reject_busy` only when that fills (`server.rs:154-161`). So a wait exists and is bounded; what does not exist is a **position**: the registry is an unordered map with no waiter list, and `docs/WHAT-IS-MISSING.md:670-673` says exactly that — *"the waiting queue exists in the same process"*, while there is "no 'busy with X', no 'you are next', no per-device queue position anywhere in the code" |
| **waiting, with no answer yet** | **yes, as elapsed time** | the request is outstanding, so the phone can say it is still waiting — and cannot say what for, or how much longer |

**Consequence for the design**: the "server busy — you are next" card **is removed from the mock**,
because it printed a sentence the machine has no data for. What replaces it is only what is
observable: the PC is busy, and the request is still outstanding. The card returns if the PC ever
exposes the active-device set or a position — PC-side work, not mine. An earlier version of this row
said "there is no queue", which the very lines it cited contradicted: there is one, it is bounded,
and it refuses.

### 1.5 What already exists, and what is a trap

- **The real remote client exists on the branch `remote-brain`** (not mine, kept apart on purpose):
  `src/engine/remote/` (**30 files, 16 of them non-test** — this document said 19 until an audit
  counted; the branch tip is five days older than the claim), `src/screens/RemoteBrainSettings.tsx`, the PC modelled as a
  **virtual catalog row** (`kalsa-remote-mac`, `listed: false`), a global backend switch
  (`kalsa.engine.backend` = `"local" | "remote"`) with a single-writer gate
  (`beginBackendSwitch`, `backendWriteIntent`). The two branches have diverged:
  `git rev-list --left-right --count ux-2026-09-21...remote-brain` = **408 / 189**, with two merge
  bases. **The switcher must adopt that gate, not duplicate it** — two switches over one key would
  collide, and this is the dependency Part 4 now lists.
- **`src/mobile/*.js` is a trap**: four real committed modules, imported by **nothing**, and they
  speak to a **Cloudflare AI gateway**, not to Kalsa Brain. Foreign code from another project.
- **A conversation has no model identity.** `ConversationMeta` is six fields with no model, on both
  branches. So "the chat remembers where it runs" is **not UI work**: storage and the switch must
  become per-conversation first.
- **The tool name already reaches the UI and is thrown away.** `LlamaService.ts:5031` emits
  `onTool?.({ name, arguments })`, the bridge forwards `{ kind: "tool", tool }`
  (`engineCallbackBridge.ts:65`), and the consumer (`AiChatPage.tsx:2623-2651`) reads only
  `payload?.proposed_actions`, which is empty for a tool payload, so nothing renders. **Rendering
  the tools is not an invention; it is un-dropping data that already arrives** — the cheapest win
  in the project.
- **That trace does not survive a reopen, deliberately** (`AiChatPage.tsx:709-713`): after a reload,
  an answer that used four tools is indistinguishable from one that used none. Persisting it means
  writing a per-message tool list into the history path — a decision with a cost, taken in step 4.
- **Sources DO survive**: the source strip is persisted on the message
  (`AiChatPage.tsx:715-731`). So sources and tools must be treated as one family, and today only
  half of it persists.
- **The privacy vocabulary is a lie.** `toolPrivacyBadges.d.ts:1` declares
  `"local" | "lan" | "cloud-blocked" | "export"`, but the implementation is a dead five-entry table
  whose ids do not match the tool names, which uses only two of the four values, and in which
  **`lan` and `cloud-blocked` appear nowhere in the repository**. If the interface is to say "this
  runs on your LAN", that classification must be **built**.
- **Half the tools are invisible.** Of the eight, four produce something the user can inspect
  (web_search sources, web_fetch card + PDF pages, `[N]` citations, the miniapp); `document_chat`
  passages, `write_note`, `device_info`, `device_calc` and `calendar_agenda` exist only as
  `role: "tool"` engine messages that never reach `Message[]`.
- **The answer's renderer already exists and its only consumer is in the forbidden layer**:
  `src/chat/MarkdownText.tsx` over the pure parser `src/chat/markdown.ts`, used by
  `AiChatPage.tsx:5573` and by nothing else. It takes the old `ThemeColors` through
  `useLabTheme`/`useTypography` rather than `design.ts`, and the new shell mounts no theme
  provider, so reuse is an adapter plus the three block kinds §2.2 lists.
- **Permissions are scattered and three tools have none.** Web search toggles only in the chat
  header; device and calendar only in Settings; `write_note`, `document_chat` and `create_miniapp`
  have no toggle at all.
- **Two component files carry the old palette and nothing imports them.**
  `src/theme/components/Surface.tsx` and `Button.tsx` are imported by no file in `src/` or `App.tsx`,
  and `Button.tsx:51` uses `shadows.accent`, whose colour is the stale orange `#f07a3f`
  (`tokens.ts:47`). Dead today, a trap tomorrow: the first person who reaches for a ready-made
  button gets an orange shadow in a green app. Found while adding `elevation` to `design.ts` — this
  plan's step-2 brief assumed shadow tokens already lived in the design layer, and they did not;
  the only ones were these. **Deletion proposed, awaiting the owner's word**, as with the dead
  `notebook` palette, and subject to the same check: nothing imports them.

---

## Part 2 — The design

### 2.1 Three bands

```
┌───────────────────────────────┐
│ strip      where it runs, what it is doing, and the switch
├───────────────────────────────┤
│ transcript the conversation, and nothing else
├───────────────────────────────┤
│ composer   what acts on this turn
└───────────────────────────────┘
```

The strip is the machine's voice and the only place allowed to say what the phone is doing. It is
also the switcher: name of the model, where it runs, the state, a chevron — **once the remote client
lands** (§1.5, Part 4.5). Until then the strip reports and does not switch, because a switch with
nothing behind it is a control that lies. Tapping it opens a sheet
listing **this phone** and the paired PCs, each with its state and its models. It collapses to one
line on the smallest screen.

### 2.2 The transcript

- **Only the user's turn is boxed**: a tinted capsule, right-aligned, no border, no tail, max 78 %.
- **The answer is bare**: serif ink on the page, full measure, no container, no avatar. On 349 dp
  that returns the ~32 dp a bubble would cost on every line — roughly 34 to 38 characters per line.
- **Rhythm**: 6 dp between the user's turn and its own answer (they are one turn), **26 dp between
  turns**, 12–16 dp between paragraphs. Grouping is by proximity; separators are never used between
  turns.
- **Markdown is real for what the renderer already does, and only that.** *Corrected by step 3's
  inventory, which found this section claiming more than the repository can do.* What exists:
  `src/chat/MarkdownText.tsx` (404 lines) over a pure parser `src/chat/markdown.ts` (677 lines),
  supporting paragraphs, H1–H3, ordered and unordered lists with depth, blockquotes, thematic
  rules, inline bold/italic/code, links (non-http downgraded to text) and the `[N]` citation
  chips. **What does not exist anywhere in the repository: tables, display equations, fenced code
  and images.** Fenced blocks are split out upstream and drawn by `CodeFenceBlock`, which lives
  inside `AiChatPage`, not in the renderer; and stacked fractions have no React Native
  implementation at all — the only "formula" anywhere is a plain string in the miniapp renderer.
  So tables and equations are **work, not a port**, and step 3b is a build. The renderer's single
  consumer is `AiChatPage.tsx:5573`, so reusing it means adapting its colour contract (it takes the
  old `ThemeColors`, not `design.ts`) rather than moving a file.
- **The rhythm, as numbers the layout module owns**: 6 dp between the user's capsule and its own
  answer, 26 dp between turns, 14 dp between the paragraphs of one answer (band 12–16), and the
  capsule capped at 78 % of the reading column. A three-column table needs 351 dp at the minimum
  readable cell width, so at 349 dp it **always** scrolls — a property of a pure function
  (`tableScrollDecision`), not of a stylesheet someone has to remember to read.
- A day marker sits between two hairlines: a 42 dp box, kept while the transcript band has at
  least 320 dp and dropped below that. The 320 is a **chosen** floor, labelled as chosen in the
  code, because the arithmetic fixes only the band it must sit inside.
- **Where the conversation sits** — owner's decision 2026-09-21: **it grows from the top while it
  fits, and sticks to the bottom once it overflows.** A short conversation begins at the top, exactly
  as the desktop app does, with no void shoving it down; the moment the content is taller than the
  band the view stays at the end, so the newest turn sits one thumb above the composer. The owner
  chose bottom-anchoring and named the three failures it is known for; they are requirements here,
  and none of them can be proven by a screenshot:
  1. **Not knowing which message is last.** While pinned, the band always shows the end: bottom
     padding of at least one line so the composer never covers the last line, and the view follows
     both an append and a growth — but only while it is pinned.
  2. **The answer writing above itself and then below it.** One cause: a placeholder born in one
     place and the real text arriving in another. So **one list entry per message**, created when the
     answer starts and never re-created — the cloud, the tool rows and the text all render inside
     that entry, and the cloud becomes text in place. An extra placeholder entry that is later
     replaced is forbidden by this rule.
  3. **The view fighting the reader.** It unpins after **10 dp** of upward scroll, nothing moves
     while it is unpinned, and there is exactly one control to return to the end.
  The decision is a **pure state machine** (`transcriptScroll.ts`) with those three rules as tests;
  `Transcript.tsx` only obeys it.

### 2.3 The thinking cloud

The owner's own element, ported from Kalsa Brain and **already written in React Native**:
`src/ui/thinking/` — `thinkingTiming.ts` (pure), `thoughtMotion.ts` (pure geometry), `ThoughtCloud.tsx`,
with **50 tests** and the frame callback switched off at rest and under reduce-motion. The numbers
come from the desktop source: window 2000 ms, write throttle 350 ms, period 1.8 s clamped to
0.7–2.4 s, rate = arrivals/2, rise 14 px with scale 0.7 → 0.45, settle 900 ms with 0/120/240 ms
stagger, breathe 2.6 s to scale 1.012, cloud radii 24/28/26/18, puffs 26×26 and 15×15, trail 9/7/5.

One deliberate deviation, kept and commented: the rise rides 12 px higher than the desktop, because
the reference's animation uses `backwards` fill only and **snaps visibly** when the settle ends.

Status: 97 suites / 1287 tests green. Not yet mounted anywhere — it is mounted in step 3.

### 2.4 Tool rows

One quiet, collapsed row per tool call, above the answer, as the desktop's `ToolActivity` does:
*"one quiet, collapsed line per call"*. Labels already exist and are translated
(`"Searching the web…"`, `"Fetching page…"`, `"Reading document…"`). The data already arrives and is
currently discarded (§1.5), so this is the cheapest visible win. The rows state what the answer
stands on without spending a line of prose.

**Decision, 2026-09-21: the rows are volatile and are NOT persisted.** They are live activity, not
history, and the durable evidence of what an answer stands on is the **sources**, which are already
saved on the message (`AiChatPage.tsx:715-731`). Keeping the rows transient means the history write
path — guarded, epoch-stamped and load-bearing — is not touched for this, and it agrees with the
existing deliberate rule at `AiChatPage.tsx:709-713`. The cost is accepted: after a reopen the rows
are gone and the sources remain.

### 2.5 Sources, as chips

Small text chips under the answer: the citation index and the host. **No favicons and no previews** —
the desktop states the reason and it holds twice as hard on the phone: fetching an icon is a request
out of the app and would leak the domains the user searched. Only a public `http(s)` address is
tappable; `javascript:`, `data:`, `file:` and the machine's own server stay text with reduced
emphasis.

### 2.6 Mini apps

A card in the transcript: title, a short metric row, an **Apri** affordance, and a line saying it is
interactive — a mini app that looks static is worse than none. Interaction happens on a full-screen
sheet, because the renderer can draw **39 block kinds** including scientific plots with fits, unit
conversions with formulas and a Grubbs outlier test; a three-metric grid fits at 349 dp, a plot with
a fit does not.

Two defects to fix while porting, both found in the inventory:
- **The registry lies**: `editable_table`, `input_table`, `segmented_control` and the `table` family
  declare interactivity they do not have (they render through a read-only table). Do not carry the
  lie forward.
- **A user-visible string is outside the catalogue**: `"Grubbs alpha 0.05: G … / critical …"` is
  hardcoded in the renderer. With two languages that is a bug.

### 2.7 The composer, and the one invariant

- One row: attach, field, mic, send on the accent fill.
- **Typing the next message while the model generates is allowed**; only sending is held. On a slow
  phone the wait is long and preparing the next question is the useful thing to do.
- **A control that cannot be used must say why.** The old composer showed "Fai una domanda…" while
  `editable` was false (`AiChatPage.tsx:4337-4339`), and the same on three composer chips including
  the document entry point. In the new shell, a place that refuses input never shows the input
  placeholder and always carries one line of reason.
- The attachment is an explicit chip — *"Legge da fisica.pdf"* — never a bare filename, because a
  chip with no label is a rebus.

**The keyboard, and why the shell cannot ignore it.** This app ships `targetSdk=36` with
`edgeToEdgeEnabled`, so on Android 15+ `windowSoftInputMode="adjustResize"` **no longer shrinks the
window**: the IME draws over the app and `useWindowDimensions()` keeps reporting the full height. That
was read from the installed React Native 0.86 sources rather than assumed — `DeviceInfoModule.kt`
computes the window from `computeCurrentWindowMetrics` with no IME term; `ReactRootView.java` treats the
keyboard as an **inset** (`WindowInsetsCompat.Type.ime()`) and never resizes the root; and
`safe-area-context`'s bottom inset sums status bars, cutout, navigation bars and caption bar with **no**
`ime()`. The emulator then confirmed it: `mInputShown=true`, window still 621 dp, which is why the 325 dp
case had to be pinned by hand. A shell that lays its bands out from the window height alone therefore
puts the composer **under the keyboard**, and no capture would have caught it, because the capture was
pinning the height itself.

Decision, taken before mounting the shell:

- `shellGeometry` gains a **fourth input, the keyboard height**, and the available height becomes
  `height - keyboardHeight`. The 349x325 dp case stops being a simulation and becomes the geometry of an
  open keyboard — which is what this document has claimed it was all along.
- The height is fed as **discrete state**, set when the keyboard settles (`keyboardDidShow` /
  `keyboardDidHide`) and never per frame: a per-frame React value would re-render the whole shell at
  animation rate. The visual transition belongs to Reanimated on the UI thread — the same split the
  existing chat already uses (`kbPad` over the root, chosen there because its frame-diff formula
  under-lifted by a constant, `AiChatPage.tsx:3936-3940`) and the same reason the cloud's own animation
  never touches React state.
- The height comes from `react-native-keyboard-controller`, which the app already ships (1.21.9) and
  which reads the IME from native insets. **The safe-area bottom inset must never be used for this**:
  it excludes the IME, and stacking the two double-counts — a trap the existing composer's comment
already records.
- The transcript's pin re-decides when the keyboard settles, through the `resize` cause it already
  has.
- `scripts/ci-screens.sh:647` and `:690-693` already assert "composer bottom ≤ IME top" for the old
  app. **That assertion must be extended to the new shell before it is mounted**, because it is the only
  check in the project that would fail when this breaks.

### 2.8 Stop, and its four outcomes

| outcome | what the user sees |
|---|---|
| stopped by the user | the partial answer stays, marked, still copyable |
| stopped before any token | the user's turn and one line: nothing was generated |
| stopped by the device (thermal) | what happened and what the app did, with the only actions the engine can honour: wait, stop |
| failed | the engine's reason, in danger, never a generic apology |

One control, `send` when idle and `stop` when generating, entering a visible **Stopping…** state that
lasts until the engine confirms release — the thing the old 3 s watchdog skipped. The invariant: the
interface never claims the machine has stopped before the machine has.

### 2.9 Local, remote, and the queue

The strip says **where the answer comes from** (`su questo telefono` / `su Kalsa Brain · PC`) and is
the switch. What may be drawn, per §1.4: reachable, unreachable, the error code's meaning, streaming,
partially loading. **Not** the device set and **not** a queue, until the PC exposes them.

The fit gate prices the **phone's** RAM and is therefore meaningless for a model on the PC: in remote
mode it must be translated or bypassed, and that is not my decision to take.

### 2.10 Permissions in one place

Today they are in two places and three tools have none (§1.5). The new shell has **one** surface for
"what the assistant may do", with the privacy classification that must be built (local / lan /
cloud-blocked / export) rather than borrowed from the dead table.

### 2.11 Motion, with values

| movement | value | source |
|---|---|---|
| the user's own turn entering | **none, 0 ms** | it carries no new information |
| the answer entering | 200–250 ms fade + 8–12 dp rise, `cubic-bezier(0,0,.38,.9)` | IBM Carbon entrance |
| streaming caret | opacity 1 → 0.35 → 1 over 1 s, linear, frozen solid as text arrives | a hard blink fights the arriving text |
| per-token fade | **never** — a render storm; completed blocks may fade 100 ms | — |
| send ↔ stop | 150–200 ms, cross-fade with 90° rotation, spring `dampingRatio 0.9`; the return shorter | NN/g: exits ~25 % shorter |
| cloud → answer | the row collapses in 150–200 ms; the live indicator cross-fades to `Ha pensato per Ns` | AI Elements' auto-close pattern |
| expand / collapse | 200–240 ms open, 150–200 ms close, contents offset ~30 ms | Carbon's 240 ms "expansion" |
| sheet | 250–300 ms spring `dampingRatio 0.85`, scrim 150 ms, dismissable by gesture | HIG: let people cancel motion |
| scroll during streaming | **instant, no easing**; disengage after 10 dp of user scroll, then a pill fades in over 100 ms | a lagging rubber band looks broken |
| a held control | state change ≤100 ms; **a tap on a disabled control does nothing** | HIG, NN/g frequency rule |

Never animated: history scrolled into view, the user's own message, per-token text, whole-page theme
swaps, and anything oscillating at ~0.2 Hz. Reduce-motion is honoured everywhere; in Reanimated 4
animations default to `ReduceMotion.System` and return the target immediately.

---

## Part 3 — The build plan

Each step is small, and each names what proves it. `tsc --noEmit` and `jest --silent` green at every
step, plus emulator screenshots at **480×854/220** and **1080×2340/480**, and the 325 dp case.

| # | what is built | what proves it | who |
|---|---|---|---|
| 0 | **The design layer**, already written: `src/theme/design.ts` + `design.test.ts` (green palette, measured, with the role constraints as tests) | 25+ test cases, incl. the negative ones that pin why a value is confined to a role | done |
| 1 | **The type layer**: Inter installed, `typography.ts` repointed, the italic defect closed, faces 12 loaded → 10 (9 referenced by a role) | the boot gate is green; **the contrast/scale test this step promised was never written — it is step 1b** | done, except 1b |
| 1b | **The type-layer test**: every role's family is in the loaded set, the scale is monotone, and the italic face's family equals the body's | three assertions, each of which fails on one of the two defects step 1 actually had: the missing reading face, and the italic that jumped family | coder |
| 2 | **The shell**: three bands, no content, no engine calls, edge-to-edge with the gesture bar | `shellGeometry.test.ts` at 349×621, 360×780 and 349×325: the bands sum to the available height, every interactive box is ≥48 dp, the composer never overlaps the gesture inset, the strip collapses to one line at 325 dp. Screenshots at all three, per the proof regime below | coder |
| 2b | **The three sizes in one capture**: `ShellPreview` cycles 621 / 325 / 780 on a tap | `ShellPreview` no longer holds a height constant; the proof regime fixes the native-build cost at one | coder |
| 3 | **The transcript**: user capsule, bare serif answer, markdown incl. equations and tables, day marker, the cloud mounted | a long answer, a three-column table and a code block at 349 dp, each with a screenshot; the cloud's 50 tests stay green | coder + explorer |
| 4 | **Tool rows and sources chips**: render the tool names that already arrive; chips with no network fetch; the rows stay **volatile** (§2.4) | a test per tool name rendering; a test that no image is fetched; a reopen test asserting the rows are **absent** while the **sources are present** | coder |
| 5 | **The composer**: type-while-generating, send/stop/stopping, the held-reason invariant, the attach chip | one test per held state; the 48 dp check in the geometry module (not a render sweep — the stack cannot sweep a render); the "no invite without a reason" test | coder |
| 6 | **Stop's four outcomes** | one test each, including stopped-before-any-token | coder |
| 7 | **Mini apps**: the transcript card + the full-screen sheet, the 39 block kinds ported without the registry's false interactivity | one screenshot per block family at 349 dp; the `editable_table` lie removed and reported | coder |
| 8 | **Local vs remote**: the strip as a switcher, the endpoint sheet, the states that are honestly observable; the queue card **held back** until the PC exposes the device set | a test per observable state, at the **data layer**; and a test proving the state layer never produces a device-set or a queue-position value at all — "not drawn" is a rendering property this stack cannot assert | coder + explorer |
| 9 | **Permissions in one place**, with the privacy classification built rather than borrowed | a test per tool × mode; the scattered toggles retired and reported | coder |
| 10 | **Settings**, split into preferences and a device/engine surface, internal jargon out of the user path | the accessibility sweep over both surfaces | coder |
| 11 | **The `testID` + a11y sweep** across everything built | a **source-level check**, not a render check: a test asserting every interactive node in the new UI carries a `testID` and an accessible name. A test that *walks a screen* needs a harness this repository does not have | coder |

**The proof regime, and why it is written down.** The first version of this table promised proofs
this stack cannot execute. `jest.config.js` runs `testEnvironment: "node"` with
`testMatch: ["**/*.test.ts"]` — no `.tsx` — and the project has neither `react-test-renderer` nor
`@testing-library/react-native`. All 97 suites are pure logic, including the two nearest a screen
(`sheetCopyVisible.test.ts`, `regenTarget.test.ts`), which assert plain functions and mocked
handlers, never a rendered tree. So "every control clears 48 dp with an accessibility-bounds test"
and "a test that walks every screen" were unexecutable as written.

The decision, and it is reversible: **no component-render harness is added.** The arithmetic the
sizes and the 48 dp rule depend on lives in **pure `.ts` modules** — the pattern the thought cloud
already uses (`thinkingTiming.ts`, `thoughtMotion.ts`) — where a real test in the existing node
stack can prove it. The pixels are proven by **screenshots** at the three sizes. Neither pretends to
prove the other. If a later step genuinely needs a rendered assertion, that becomes its own step
with its own dependency (`react-test-renderer` or `@testing-library/react-native`, plus a jest
preset that is not `node`), and adding it is the owner's decision rather than a quiet import.

**Tests replaced.** Today **no test in the suite asserts a screen layout** — the entire UI is
untested, which is itself a finding. So nothing needs replacing yet; the work adds coverage. The one
file rewritten is my own `design.test.ts` from earlier in the day, because it was written against the
wrong palette. Any replacement is reported, never a deletion to make a build go green.

**And the pixels must not compile an engine.** The first capture attempt did exactly that: it compiled
`llama.cpp` — 2661 translation units — to photograph a React layout, and the NDK's `ninja` spawned
**21 concurrent `clang`** at 43–53 % each, load average 36, because `--max-workers=2` does not reach
that layer: AGP invokes `ninja -C <dir> <targets>` with **no `-j`**, the bundled ninja reads only
`NINJA_STATUS` from the environment, and no gradle property bounds it. The CI recipe's
`CMAKE_BUILD_PARALLEL_LEVEL: "2"` and `NINJAFLAGS: "-j2"` are no-ops for the same reason; CI only
survives because its runner has four cores. The preview never initialises the engine — `SHELL_PREVIEW`
returns before `ModelCatalogBoot` — so the C++ build can simply be turned off: pass
`-PrnllamaBuildFromSource=false` on the command line, because a command-line `-P` outranks
`android/gradle.properties`. Three claims an earlier version of this paragraph made were false and
are corrected here: the property is **not** false by default (**`android/gradle.properties:65` sets it
true**, written by the Expo plugin `plugins/withLlamaFromSource.js`); the package ships **no prebuilt
engine** (`node_modules/llama.rn/bin/arm64-v8a/` holds only OpenCL and Hexagon blobs — the
`librnllama*.so` in the tree are outputs of an earlier from-source build); and `-PrnllamaHexagon=false`
has **zero consumers** in the installed `llama.rn`, so it is decorative. `KALSA_LLAMA_FROM_SOURCE=0`
throws at prebuild, which means it can only ever turn the source build on. The recipe that works,
measured: `--console=plain --no-daemon --max-workers=2 -PreactNativeArchitectures=arm64-v8a
-PrnllamaBuildFromSource=false`, **47 s, zero C++ compilers, load peaking at 9 instead of 36** — and an
APK with no `librnllama*.so` is harmless for a preview, because `RNLlama.loadNative` is called only
from `RNLlamaModule.install` inside a `try/catch`, and `NativeRNLlama.ts:8` uses the non-throwing
`TurboModuleRegistry.get`. And the Hexagon landmine stays for anyone who builds the engine:
`~/.hexagon-sdk` present makes `llama.rn` auto-enable a DSP build that fails for missing QAIC artifacts.

**The capture is gated on the machine, not just on the tree.** A build plus an emulator is the
heaviest thing this project does, and the Mac is shared with another session that owns it for its own
work; while that is true, no gradle and no AVD. The pixels wait, and nothing else does: everything above
can be written, tested and reviewed without compiling.

**The recipe, for when the machine is free.** `SHELL_PREVIEW = true` in `App.tsx` (and back to `false`
afterwards), then one build — `--console=plain --no-daemon --max-workers=2
-PreactNativeArchitectures=arm64-v8a -PrnllamaBuildFromSource=false`, which measured 47 s with zero C++
compilers — on the `jelly480` AVD (480x854 at 220 dpi = 349x621 dp). Tapping goes through the harness in
`scripts/ci-lib.sh`, which finds nodes by their accessible name instead of fixed coordinates. The three
cases, and the rule that makes a capture trustworthy:

1. the live window (349x621 dp), keyboard down;
2. **325 dp only with the keyboard really up** — focus the composer field, then assert the IME is shown
   (`dumpsys input_method`); if it is not, the picture is of a shell sitting in the top third of an empty
   screen and it must not be shipped as evidence;
3. 780 dp belongs to the S23's window (360x780 dp), on an AVD built from the same system image.

`ShellPreview`'s size bar prints the window's own height, so each PNG says which case it is, and it adds a
warning line whenever the pinned height differs from the live window — a misleading capture now carries its
own indictment in the image. And `ShellPreview.tsx` was supposed to be removed in step 3, which did not
happen: the shell is still not mounted inside the running app, so the preview is the only consumer and
stays until that mount is a step of its own.

**Verification for every step**: `npx tsc --noEmit`, `npx jest --silent`, emulator screenshots at
both real viewports. **A screenshot needs no C++ build** — see above — and the emulator capture has
one more requirement worth writing down: Reanimated's animations are checked by the UI runtime, so a
plain JavaScript easing (React Native's `Easing`) **crashes the app on mount** with "Tried to
synchronously call a Remote Function". The cloud hit exactly that, and the only reason any screenshot
exists is that the capture set `transition_animation_scale 0`, which Android reports as reduce-motion;
that suppresses the three animated paths, so **the rise, the settle and the breathe remain unproven by
pixels** until a capture runs with motion on. **And the pixel proof must not cost a native build per iteration.** That rule
exists because it was broken once: step 2's first capture attempt built the **release** APK (which
the CI harness uses) twice — once for 349x621 and again for 349x325 — because the preview's screen
height was a **compile-time constant**. Each build ran the NDK with ~8 parallel `clang` jobs and
flattened the machine for minutes, for a change of one number.

So: a JS-only change must never require a compilation. In development the bundle comes from Metro
and reloads on save; a **debug** build is the right one to look at pixels, and the release APK is
for CI evidence. Anything that must be compared at more than one size is switched **at runtime**,
not by editing a constant — `ShellPreview` cycles 621 / 325 / 780 on a tap for exactly this reason.
If a native build is genuinely needed, cap its workers so the machine stays usable. A screenshot
costs one build, once, and then only reloads. The Jelly is confirmed by screencap when the coordinator releases it;
**installing on a phone happens only when he says the phone is free, `adb install -r` only, never
uninstall, and I report the sha256 of what I left on it.** The S23 is off-limits. Audits go to the
Reviewer profile before anything is reported as done.

---

## Part 4 — Dependencies that are not mine

1. **The PC must expose the active-device set** for "server busy with <name>" to be drawable.
2. **A queue must be built** for "you are next" to mean anything; today the door refuses instead.
3. **A conversation needs a model identity** in storage before a chat can remember that it runs on
   the PC.
4. **The fit gate must be translated or bypassed in remote mode**, since it prices the phone's RAM.
5. **The remote client must land in this tree.** `src/engine/remote/` does not exist on
   `ux-2026-09-21`; it lives on `remote-brain`, 408 commits from this branch's merge base with two
   merge bases of its own. Steps 8 and 9 assume it, and the switcher must adopt that branch's gated
   switch instead of building a second one over the same key.

The dependency this list used to carry — persisting the per-message tool list — is **closed by
decision: not persisted** (§2.4).
