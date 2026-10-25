# Kalsa desktop, Hearth: rules for the coders

**The mockup HTML is the source of truth.** Every screen and state is in `dev/mockups-v4/hearth/*.html`, which is generated from `dev/mockups-v4/_src/` (`node build.mjs`). When this page and a mockup disagree, the mockup wins. Copy, and every change to it, is in `INVENTORY.md`. Don't invent a screen, a state or a sentence: if one is missing, ask.

## Tokens

### Colours
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F4F1E9` | `#191A16` | page (cream paper) |
| `--rail` | `#ECE8DD` | `#131410` | icon rail, segmented tracks, quiet fills |
| `--card` | `#FBFAF5` | `#22241E` | cards, bubbles, composer, dialogs |
| `--line` | `#DDD7C8` | `#33362D` | borders, separators |
| `--tx` | `#23261E` | `#EEECE3` | primary text |
| `--tx2` | `#53584A` | `#BEBFB0` | secondary text |
| `--tx3` | `#646A5B` | `#A2A494` | muted text, hints (AA on `--bg`) |
| `--ac` | `#3F6B3A` | `#A9CF8E` | sage: primary buttons, your bubble, toggles |
| `--ac-ink` | `#FFFFFF` | `#16220F` | text on `--ac` |
| `--ac-soft` | `#E2E8D4` | `#2A3423` | tints, active rail item, chips |
| `--ac-tx` | `#3A6334` | `#B8DA9F` | green text and links |
| `--ring` | `#74B266` | `#8FD07A` | power ring, bullets, tree leaves |
| `--track` | `#E2DCCC` | `#2C2F27` | progress-bar track |
| warning fill / ink | `#F3E3C8` / `#7A5418` | `#3A3022` / `#E8C489` | warnings |
| `--err-ink` | `#9B3B2E` | `#F0A08F` | error text and icons |
| `--err-wash` | `#FBF1EE` | `#2B2220` | error card background, failed update block |
| `--err-line` | `#EBCFC8` | `#4A322C` | error card border |
| `--err-soft` | `#F6DDD7` | `#3D2A25` | error card icon disc |
| danger button | `#9B3B2E` | same | Delete only |

Contrast: all text pairs pass WCAG AA. Don't put `--tx3` on `--rail` for text smaller than 15px.

### Type
System stack only: `-apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui`. Headlines use the Display cuts (`"SF Pro Display"`, `"Segoe UI Variable Display"`).

| Role | Size / line height | Weight |
|---|---|---|
| Hero headline (Home, first run) | 44 / 50 | 600, letter-spacing −0.025em |
| Page title | 38 / 44 | 600 |
| Card title | 24–26 / 31–32 | 650 |
| Status sentence | 21 / 30 | 400, `--tx2` |
| Primary button | 19 | 600 |
| Chat text (bubbles) | 17 / 26–28 | 400 |
| Body, controls | 16 / 25 | 400–600 |
| Rail labels, hints | 15 | 500 |
| Meta (time, notes) | 13–14 | 400–600 |

Nothing a person must read is smaller than 13px.

### Radii
Pills and buttons are fully rounded (radius = height / 2). Cards and groups use 22. AI choice cards use 26. Dialogs use 28. The composer uses 28. Bubbles use 24 with one 6px corner on the speaker's side. Icon squares use 14.

### Spacing
Use a 4px grid. Most steps are 8, 12, 16, 18, 22, 24, 28 and 32. Content columns are centred: chat 780px, settings 720px, Your AI 840px. Tap targets are at least 44px high; primary actions are 52–60px.

### Shadows
Shadows are warm and soft, made from `--sh`: `rgba(80,70,40,.28)` in light, `rgba(0,0,0,.6)` in dark.
- Raised card: `0 16px 36px -20px var(--sh)`
- Popover: `0 24px 60px -18px var(--sh)`
- Dialog: `0 30px 80px -20px var(--sh)`

Flat surfaces use a 1px `--line` border and no shadow.

## Components
- **Rail (112px):** the leaf mark, then Home, Chat, Room and Settings. Help and Phones sit at the bottom. Each item is a 24px icon in a 60×42 pill with a 15px label under it. The active item gets an `--ac-soft` pill and a 650-weight label. There is no "Soon" anywhere.
- **Power button (Home):** a 172px bezel (`--bezel`, inset shadow) holding a 142px domed face (radial `--face1`→`--face2`) with a 52px power icon.
  - **On:** a 4px `--ring` ring at −10px with a soft glow, and a sage icon.
  - **Off:** no ring, grey icon.
  - **Starting / stopping:** a part ring that turns.
  - **Resting:** the ring at 45% opacity.
  - **Problem:** an amber ring.
  - Under the button, in order: the hint ("Press to turn off"), the headline, one sentence, one primary action, and "Using Qwen 3.6 · Details ›".
- **Buttons:** primary uses `--ac` fill and secondary uses a 1.5px `--line` border, both pill-shaped. Heights are 60 (hero), 52 (default) and 44 (small). Every button has a text label: no icon-only buttons except dialog close and the copy icon.
- **AI cards (first-run Pick, Your AI):** two cards side by side. The selected one has a 2.5px `--ac` border, a raised shadow and a check in its radio. Each card shows the title ("Smartest" / "Quickest"), one line, "Needs N GB of space", and the model name small. Technical numbers live only in Details and For experts.
- **Bubbles:** yours is `--ac` fill with `--ac-ink` text, aligned right. Kalsa's is `--card` with a `--line` border, aligned left, max 660px. Web search shows as one small "Searched the web ›" line inside Kalsa's bubble and expands to sources.
- **Message action row:** under each finished Kalsa message, 6px below it.
  - A 14px copy icon (two overlapping squares, `--tx3`) in a 26px hit area.
  - On hover the area gets a `--rail` tint (dark `#2C2F27`). After copying, the icon becomes a check in `--ac-tx` for about 1.5s.
  - Then the time ("12:30 PM", 13px, `--tx3`).
  - No label and no border.
  - The row is absent while a reply is still being written, and on failure, "interrupted" and "no answer" endings.
- **Composer:** a 28-radius `--card` box. The text line comes first (17px). Under it, one row: "Attach a file" (`--ac-soft` pill), optionally Think, then the disclaimer centred in 14px `--tx3`, then Send (`--ac` pill). While Kalsa writes, Send becomes Stop (`--tx` fill). Nothing sits below the box.
- **Chat list:** opened from the "Chats ▾" button as a 440px popover. It contains New chat, Search with ⌘K, and the chats with when they happened. Rename happens inline; Delete asks in a dialog. There is never a second permanent sidebar.
- **Toggles:** 58×34 with a 28px white knob, `--ac` when on and `#CFC8B6` when off. They apply at once, with no Save button.
- **Segmented control:** a `--rail` track with a `--card` thumb, used for Look (Light · Dark · Automatic).
- **Settings groups:** `--card` rows with a minimum height of 70–78px. Each row has a 17px title and a 15px `--tx2` explanation. A longer note opens inline behind a green "…›" link.
- **Notices:**
  - **Banner:** a `--card` row with a 40px round icon, the text and its buttons.
  - **Update sheet:** slides up from the bottom of Home.
  - **Toast:** a `--tx`-filled pill at the bottom centre.
  - **Dialog:** 560px wide, 28 radius, with a scrim. Its icon circle is green for normal dialogs and amber for destructive or warning ones.
- **Tree progress (download, then tune):** the inline SVG in `_src/tree.mjs` + `_src/tree-hearth.mjs`. The whole drawing comes from one progress value `p` (0..1): seed, sprout, young tree, full tree with blossoms. To animate, tween `p`.
  - Under the tree: the headline, a 560×14 bar (`--track`, `--ac` fill), one plain line in GB and minutes, and "This happens only once."
  - When nothing can be measured, the bar shows a moving segment.
  - On failure the tree desaturates and the bar turns amber.
- **For experts:** reached only from the bottom of Your AI. It carries a "FOR EXPERTS" tag. Knob names stay technical, each with an (i) popover giving What it is / What it's for / Usual values.

## Pronoun rule (all five languages)
- **English:** Kalsa is "it" ("turn it on", "it can make mistakes"), never "she/her".
- **Italian, Spanish, French:** feminine ("lei", "ella", "elle"; "accendila", "enciéndela", "allume-la").
- **Chinese:** 它.

## Other rules
- **Simplicity test:** a 70-year-old understands each screen in 3 seconds. Each screen has one primary action.
- **No technical numbers** (tokens/s, GB of memory, context) outside Your AI → Details and For experts. The download size is said as "Needs N GB of space".
- **Dark theme:** use the same tokens. Only colours change, never layout.
