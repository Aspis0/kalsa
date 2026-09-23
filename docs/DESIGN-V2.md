# DESIGN v2 — the interface, rewritten

Owner approval 2026-09-22: *"direzione giusta!"*, with one correction — the page is **white tending to
green**, not neutral white. This document **supersedes Part 2 of `docs/DESIGN.md`**. Part 1 of that
file (the measured facts: viewports, palette ratios, the honesty inventory) still stands, and Part 3
still names the work order. Where the two disagree about how something looks, this file wins.

Sources for the direction: the ChatGPT mobile case study (Akshat Khare, Medium, 2023-06-19) — **Inter**,
a green used as a **fill**, the side menu as the navigation hub, and **dark mode as a deliverable** —
and the two reference sheets the owner sent: solid full-width green primary buttons, large near-black
headings, white cards on a near-white page with hairline separators and almost no shadow, fields with a
grey placeholder and a trailing action, outlined chips, 56 dp rows with a leading icon and a chevron,
sheets with a full-width primary action, typeset mathematics, a dark code card with a language label and
a copy control, and message actions as ghost icons.

The rendered reference for every screen is `docs/design/kalsa-mock-v2.html` (modes `?s=menu`, `settings`,
`conv`, `empty`, `stream`, `switch`, `room`); the v1|v2 pairs are in
`docs/captures/2026-09-22/design-v2/`.

---

## 1. Foundation

### 1.1 Colour roles, measured

Every pair below is computed, not chosen by eye. Light and dark are the same roles with different values.

| Role | Light | Dark | Ratio (light / dark) |
|---|---|---|---|
| `page` — the ground | `#eef5f0` | `#0f1512` | ink on page 16.30 / 16.10 |
| `surface` — cards, sheets, fields | `#fbfdfb` | `#161d19` | ink on surface 17.66 / 14.95 |
| `tint` — selected row, metadata chip | `#e6f1e9` | `#1d2722` | ink on tint 15.9 / 13.4 |
| `line` — hairline | `#dfe9e2` | `#26302b` | line off the page 1.122 / 1.355 |
| `ink` — body | `#12171a` | `#eaf1ec` | — |
| `ink2` — secondary | `#2b3330` | `#ccd7d1` | on page 11.71 / 12.50 |
| `ink3` — metadata only | `#5f6b66` | `#96a49c` | on page 5.01 / 7.12 |
| `brand` — fills | `#1f5f4e` | `#2b7a63` | white on it 7.49 / 5.16 |
| `accent` — links, icons | `#1f5f4e` | `#7fbfa6` | on page 6.76 / 8.72 |
| `selection` — the user's own turn | `#cfe3d6` | `#25423a` | ink on it 13.42 / 9.53 |
| `danger` | `#8a3b32` | `#e0a49b` | on page 7.11 / 8.4 |
| `wait` — bespoke, never an alarm | `#f8f2e4` / `#6a5729` | `#241f14` / `#e6cf9a` | ink on it 8.1 / 9.9 |

Five rules the measurements impose, and tests must hold them:

1. **A surface is never separated from the page by a border** (1.084:1 light, 1.077 dark does not read):
   elevation and whitespace carry it. This is why tinted rows are tinted, not outlined.
2. **`ink3` is for metadata.** A sentence a person must read carries `ink` or `ink2`.
3. **White text only on `brand` fills** (7.49:1 light, 5.16:1 dark). Nothing else in the palette may
   carry white text.
4. **Inside the user's turn** (`selection`) only `ink` and `ink2` may appear.
5. **`brand` is a fill colour, `accent` is a text and icon colour.** In dark mode they are different
   values, because the light fill is too dark to read on a dark page (3.58:1) and the light accent is
   too light to carry white text.

### 1.2 Type

**Inter** for chrome, controls, metadata and prose outside answers; **Source Serif 4** for the answer's
reading text; **IBM Plex Mono** for code, figures and tabular values. Weight lives in the face name —
a numeric `fontWeight` beside a custom family is silently ignored on Android.

| Role | Family | Size / line / weight / tracking | Where |
|---|---|---|---|
| display | Inter | 26 / 32 / 700 / −0.02em | screen titles inside sheets and full screens |
| title | Inter | 21 / 26 / 700 / −0.015em | the drawer's wordmark, section titles |
| headline | Inter | 17 / 22 / 600 / −0.01em | a card's own title, a row's emphasis |
| body | Inter | 15 / 21 / 400 | controls, rows, composer, notices |
| bodyStrong | Inter | 15 / 21 / 600 | primary button labels, the selected row |
| secondary | Inter | 12.5 / 17 / 400 | a row's second line, timestamps |
| label | Inter | 11 / 14 / 700 / +0.09em, caps | group headers (`LE TUE CHAT`, `MODELLO`) |
| reading | Source Serif 4 | 17 / 28 / 400 | the answer |
| readingLead | Source Serif 4 | 17 / 28 / 600 | the answer's lead-in sentence |
| mono | IBM Plex Mono | 12.5 / 18 / 400 | code, token counts, sizes, memory figures |
| monoLabel | IBM Plex Mono | 11 / 14 / 500 / +0.06em | a code card's language row |

### 1.3 Space, radii, elevation

- **Space**: 4, 8, 12, 16, 20, 24, 32. Screen gutter **16** (was 14). Card padding **16**. Row height
  **56** (a two-line row is 64). Section gap **24**. Between a group and its label **8**.
- **Radii**: `button`, `field`, `row`, `iconButton` **14**; `card`, `image` **16**; `sheet` **22**;
  `chip`, `badge`, `toggle` **999**; and **the composer's field is the one capsule (999 at 56 dp)** — the
  chat input is a single shape, while a form field is a rectangle. The three-way comparison that settled
  it is `docs/captures/2026-09-22/design-v2/pair-composer-3ways.png`: a capsule with a circle inside
  reads as one object, a rectangle with a square inside reads as two geometries fighting. Nothing else
  is rounded above a 22 radius.
- **Elevation**: two levels. `e1 = 0 0 0 1px rgba(18,23,26,.055)` — the hairline that makes a card a
  card; `e2 = 0 1px 2px rgba(18,23,26,.05), 0 6px 18px rgba(18,23,26,.06)` — only for what floats over
  content (the composer, a sheet, a menu). Shadows on chips, chips of sources and small controls are
  removed in v2: they are hairlines now.

### 1.4 Icons

lucide, **1.75 stroke**, 20 px inside rows and controls, 18 px inside chips, 24 px only for a screen's
own leading action. Every interactive node carries a `testID` and an accessible name, and a **48 dp
touch box** (the painted control may be smaller: 44 px send, 36 px ghost action, 32 px chip).

One pictogram is load-bearing and must not be swapped for a coloured dot: **the device glyph beside the
model's name** — `smartphone` while the answer comes from this phone, `monitor` while it comes from the
server brain — 13 px in `accent`, on the pill's second line (the owner asked for exactly this). The pill
carries **no brand mark**: it is a control, not a surface, and the logo competes with the model's name.
The logo's homes are the launcher icon and the `KALSA` card at the foot of Settings.

### 1.6 What is not decoration

A rule the v2 pass was written against, because the first version of it read as a toy:

- **No metaphors** — with one exception the owner set explicitly: **the thinking cloud**, the desktop's own element, which appears while the model is thinking and nowhere else. Everything else in the interface is shaped like what it is.
- **No pill soup.** A container is a hairline, not a shadow, unless the thing floats over content. A
  row of metadata (sources, tools) is text with separators and mono indices, not a row of pills.
- **Type carries the hierarchy, not ornament.** When a screen needs emphasis, the size or the weight
  moves; it is never a tint, an emoji, a dashed border or a gradient.
- **No boxed icons.** A glyph never sits inside a container of its own: the strip's menu button, the
  actions under an answer, the icons in a Settings row and the badges in a sheet are **bare glyphs**
  inside a 48 dp touch box. A container is reserved for exactly two things: the logo's mark inside the
  model pill, and the one filled primary action (the send circle). Boxed icons were the second thing
  the owner named after the composer's shape (`pair-icons-2ways.png`).
- **One filled green per screen.** It marks the single primary action.

### 1.7 Motion

Inherited from `DESIGN.md` 2.11 and unchanged: the answer enters 200–250 ms fade + 8–12 dp rise
(`cubic-bezier(0,0,.38,.9)`); the streaming caret pulses 1 → 0.35 → 1 over 1 s, linear, frozen solid as
text arrives; send ⇄ stop cross-fades with a 90° rotation in 150–200 ms, spring `dampingRatio 0.9`; the
sheet 250–300 ms spring `dampingRatio 0.85` with a 150 ms scrim; a held control changes state in ≤100 ms
and **a tap on a disabled control does nothing**. Never animated: history, the user's own message,
per-token text, whole-page theme swaps.

---

## 2. Components

Each entry is the anatomy a coder implements; states are named because a missing state is a defect.

| Component | Anatomy and sizes | States |
|---|---|---|
| **Button, primary** | full width (or content width inside a row), 52 dp, radius 14, `brand` fill, label `bodyStrong` white, **no shadow** | default, pressed (`brandDeep`), disabled (`tint` + `ink3`), loading (label swapped for a 18 px spinner) |
| **Button, secondary** | 52 dp, `surface` fill, 1 px `line`, `bodyStrong` ink | pressed (`tint`), disabled |
| **Button, tertiary** | label only, `accent`, 44 dp tall with 16 dp horizontal padding | pressed, disabled |
| **Button, danger** | as secondary with `danger` label and `danger` hairline | pressed, disabled |
| **Icon button** | 44 px painted in a 48 dp box, radius 14, `surface` + `e1`; ghost variant: no container, `ink3` | default, pressed (`tint`), selected (`tint` + `accent`), disabled |
| **Chip** | pill, 32 dp, 1 px `line`, `surface`, 12.5 label, optional 18 px leading icon, optional trailing `×` | default, selected (`brand` fill, white label), disabled |
| **Model pill** | **capsule**, 48 dp, `surface`, 1 px `line`, `e1`: the model's short name in `bodyStrong`, a second line carrying a 13 px `accent` **device glyph** and where it runs, and a 20 px chevron. No brand mark. Radius 999 so it agrees with the composer | local (`smartphone`, "Su questo telefono"), server brain (`monitor`, "Su Kalsa Brain"), loading (the glyph becomes a 14 px spinner), refused (the pill goes `tint` + `ink3`) |
| **Field (forms)** | 52 dp, radius 14, `surface`, 1 px `line`, 15 px `ink`, placeholder `ink3`, optional 20 px leading icon, optional trailing 24 dp action | empty, filled, focused (`accent` hairline + `accent` caret), error (`danger` hairline) |
| **Composer field** | **one capsule**: 56 dp, radius 999, `surface`, 1 px `line`, `e2`; inside it, left to right: a 40 px ghost attach button, the text (15.5 px sans), a 40 px ghost mic, and a **40 px circular filled send**. A circle inside a capsule, never a square inside a rectangle | empty (placeholder `ink3`), focused, held (the circle goes `tint` + `ink3`, and the hold line says why), stop (the same circle carries a square glyph) |
| **Search field** | as Field with a leading magnifier and a trailing clear `×` that appears only when non-empty | — |
| **List row** | 56 dp (64 with a second line), 12/16 padding, optional 20 px leading icon in `accent`, `headline`-weight label, `secondary` second line, optional trailing value in `ink3` or a 14 px chevron | default, pressed (`tint`), selected (`tint` + bold), disabled |
| **Card / group** | `surface`, radius 16, `e1`, no inner padding of its own; rows inside carry `line` separators that do not reach the left edge if a leading icon is present | — |
| **Badge** | pill, 20–24 dp tall, 11/700 label; neutral (`tint` + `ink3`), accent (`brand` fill + white), warning (`wait` colours) | — |
| **Toggle** | 48×28 track radius 999, `brand` when on, `line2` when off, 20 px white thumb with a 2 px inset | on, off, disabled |
| **Sheet** | bottom sheet, top radius 22, `surface`, `e3`, 20/16/16 padding, a 36×4 grabber centred 8 dp from the top, a `title` heading, an optional `secondary` subtitle, content, then a full-width primary action | open, dragging, dismissed |
| **Banner** | full-width block, radius 16, 14/16 padding, 20 px leading icon, `headline` line + `secondary` line | information (`tint`), waiting (`wait`), error (`danger` at 8 % fill, `danger` hairline) |
| **Notice (toast)** | one slot, bottom 96, radius 14, `ink` fill at 92 % opacity, white 14 px text, 4 s | shown, replaced |
| **Code card** | ground `#1b1f1d`, radius 16, a label row with `monoLabel` language and a 32 dp copy icon, then `mono` code with three accents (keyword, string, comment) | default, copied |
| **Table** | header row `label` uppercase `ink3`, rows 44 dp, hairline rules, cells 15 px; horizontal scroll only when a column's measured content exceeds the width | — |
| **Mathematics** | inline and display, Source Serif italic, real fractions, `reading` size | — |
| **Message bubble (user)** | `selection` fill, radius 18, 12/16 padding, body text, max 78 % width, right-aligned | — |
| **Answer** | no container: `surface` is the page; `reading` text, 0 left padding beyond the gutter | streaming (caret), stopped (see below), error |
| **Source chip** | 32 dp, radius 10, `surface`, 1 px `line`, 12 px label, a `mono` index in `accent` | live (tappable), unavailable (dashed `line2`, `ink3`) |
| **Tool row** | `tint` pill, 28 dp, 12 px label, 14 px icon in `accent`, grouped into one wrapping row per turn | running, done |
| **Thinking — the cloud** | **the owner's own element, and the only metaphor the interface is allowed**: a `surface` card, radius 22, `e1`, carrying a ticker line — the current thought in 13 px Source Serif italic with a right fade — and a `Mostra ▾` text button; two small attached bubbles on its top edge and a **trail of three shrinking circles below-left** (9/7/5 dp, insets 0/2/5) that **rises**: 14 px of travel, scale 0.7 → 0.45, opacity 0 → 1 → 0, the three staggered a third of a period apart, the period 1.8 s clamped to 0.7–2.4 s and paced by the reasoning tokens (rate = arrivals / 2), plus the card's own 2.6 s breath at scale 1.012. The numbers are `src/ui/thinking/thoughtMotion.ts`'s and the app already runs them; at rest the rings stay drawn | live (the trail rises, the ticker advances), collapsed, expanded (the whole thought in a card) |
| **Stop marker** | a row in `wait` colours with a 20 px icon and 13 px text, placed where the answer stopped | stopped by the user, stopped by the engine |
| **Attachment chip** | 36 dp, radius 10, `surface`, 1 px `line`, 16 px file icon, filename in `headline`, trailing `×` | uploading, ready, failed |
| **Progress** | 4 px track radius 999, `tint` ground, `brand` fill, no shadow; the percentage always appears as text beside it | determinate, indeterminate |
| **Jump pill** | 36 dp pill, `surface`, `silence` ring (`#1f5f4e` at 1 px, 5.97:1), 16 px down icon, label "Alla fine" | shown, hidden |
| **Empty-state block** | the photograph, full gutter width, radius 16, aspect 4:3, **nothing printed over it** | image present, image missing (a solid `tint` block of the same size) |

---

## 3. Screens

### 3.1 Conversation

**The strip** — 56 dp: the drawer's icon button (ghost, 44 px, **nude glyph**), the **model pill** — **a
capsule**, 48 dp, radius 999, `surface`, 1 px `line`, `e1`, holding the model's short name in
`bodyStrong`, a second line with a **13 px `accent` device glyph** (`smartphone` / `monitor`) and where
it runs, and a chevron — and nothing else. **Nothing else lives in the strip**: no `+` (the new chat is
the menu's primary action, and a second door to it was redundant), **no brand mark** (the logo lives in
the launcher icon and in Settings), no web switch (it moves to Settings › Privacy), and the model's
progress, error and battery lines live inside the pill's own sheet, opened by tapping it. The dot that
used to sit on the second line is gone: a colour says "something", a glyph says *where*.

**The transcript** — the answer has no container. States, each with its line:
empty (the photograph alone), waiting for the first token (the strip of three dots and the composer's
hold line), thinking (the thinking card), streaming (the caret after the last text, scroll instant),
tool rows, sources, mini-app card, stopped by the user (**`Fermato da te`** with the vertical rule of
the `wait` colour at the answer's break), stopped by the engine or the content filter (the same row in
`danger`), error (the engine's own sentence, verbatim, in a `danger` banner).

**The composer** — **one capsule**, 56 dp, radius 999, `surface` with a 1 px `line` and `e2`: inside it,
the 40 px ghost attach button, the text, the 40 px ghost mic, and a **40 px circular filled send** (the
accent fill is the screen's single filled green; the attachment chip above it is a pill, so the two
shapes agree). While a turn runs the same circle carries a square glyph. Above the capsule: the
attachment chip, and the hold line in `secondary` when sending is refused (**the one invariant: a
control never invites a tap it cannot honour, and it always says why in one line**). The templates,
research and notes entries live inside the attach sheet, not in a permanent toolbar row.

### 3.2 The menu (the drawer)

A **white sheet**, full height, 16 padding: the mark (36 px) with "Kalsa" in `title`, then a full-width
**primary "Nuova chat"**, then the search field, then the label `LE TUE CHAT` and the conversation rows
(56 dp, leading icon, title, `secondary` preview), then at the foot the group rows: **Documenti, Note,
Impostazioni, Account**. The leaf-fold dome is gone; so are the persona pill, the `CONVERSAZIONI`
heading and the white cards around each row.

### 3.3 Settings, split in two

Every screen with a back button uses one header: **the title centred** on the width, the back chevron at
the left edge (a 40 px ghost button), 16 px of side padding, and the content in cards below it. Rows sit
on the **content axis** — a Settings row carries **no leading icon**, so its label lines up with the
group header above it; an icon there pushes the text off the axis and makes the screen read misaligned
(the owner's word). One implementation trap, learned by looking at the render: the scrolling column is a
flex container, so its cards must be `flex: none` — otherwise they shrink and clip their own rows.

`Settings › Preferenze` — groups of cards: **Aspetto** (lingua, dimensione testo, tema chiaro/scuro/
sistema), **Conversazione** (invio con invio, salvataggio automatico, note). Rows 56 dp, value on the
right, a tap opens a sheet with the options as rows and a full-width primary "Fatto".
`Settings › Questo telefono` — **Modello** (nome, dove gira, contesto, cache KV, ragionamento,
quantizzazione), **Motore** (governor, soglie termiche, finestra KV, download with the progress row and
the RAM verdict), **Privacy** (web, permessi, memoria condivisa). Every internal figure keeps its unit
and its `mono` face; no sentence explains the engine to a person who did not ask. The screen closes with a `KALSA` card —
the mark (40 px, radius 12), the wordmark, and `Versione 0.1.0 · locale e privato` — which is where the
logo lives in the interface, together with the launcher icon.

### 3.4 Documents, Notes, Personas, Account, Pro, Help

Same grammar: a `title` screen header with a back icon button, groups of cards of rows, one primary
action per screen (open a document, write a note, create a persona). Editing happens in a sheet, never
inline in the list.

### 3.5 The switch sheet, the hold states

Local vs PC: a sheet with two option rows (44 dp icon badge, name, one line of truth), the selected one
carrying a `brand` tick; where the machine cannot tell us something (`DESIGN.md` 1.4), the row says only
what is observable. A turn waiting on the PC shows a `wait` banner in the transcript, not a fake queue
position.

### 3.6 The model picker and the download

A sheet of model rows (name, size in `mono`, a RAM badge), the current one ticked; a download row shows
the progress bar, the percentage, and the engine's refusal sentence verbatim when the device cannot run
it — before the transfer starts, not after.

---

## 4. Dark mode

Values in §1.1. Rules: the photograph keeps its own light treatment and sits on `surface`; the code
card's ground (`#1b1f1d`) is lifted to `#202623` so it separates from the dark surface; the user's turn
is `selection #25423a` with `ink` text (9.53:1); the caret and the trail use `accent`; hairlines are
`line #26302b`. The theme follows the system by default and is switchable in Settings › Aspetto.

---

## 5. Implementation map

| Spec | Where it lands |
|---|---|
| Tokens §1.1–1.4 | `src/theme/design.ts` (values + a test per rule in §1.1's five constraints) |
| Type §1.2 | `src/theme/typography.ts` (one role per line, no numeric weights) |
| Components §2 | `src/ui/shell/**`, one file per component, ≤350 lines each, `src/host/fileSize.test.ts` as the ratchet |
| Screens §3.1 | the mounted shell (`HostChatSurface` + `src/ui/shell/*`) |
| Menu §3.2 | a new drawer surface replacing `src/theme/components/Drawer.tsx`; the old leaf files deleted |
| Settings §3.3 | the first screen rewritten out of `src/screens/SettingsScreen.tsx` (3 050 lines) into preferences + device surfaces |
| Overlays §3.4 | one screen per slice, out of `src/screens/*` |
| Dark §4 | the same tokens with a second value set, verified on device |

**Acceptance for every slice**: the mock|device pair at 349×621 and 325 dp, side by side, in
`docs/captures/<date>/`; `tsc --noEmit` and `jest --silent` green; the ratchets no higher than before.

## 6. What this document does not design

The room (`docs/DESIGN-ROOMS.md`, deferred by the owner), remote queue visuals beyond what the PC
publishes, the 39 mini-app block kinds (they keep the host's chrome; the renderer is not ours), display
equations (cut by the owner on 2026-09-21 — the reference restores them only if he says so), and the
launcher icon, which stays as it is.
