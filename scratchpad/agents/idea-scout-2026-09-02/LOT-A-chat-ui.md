# LOT-A: Chat UI Reconnaissance

## A1. "Menu half moon on one side / circular menu in the middle"

**Current implementation:**
- **Drawer navigation**: `src/app/AppShell.tsx:2072-2073` — `drawerOpen` state controls a side drawer
- **Drawer component**: `src/theme/components/Drawer.tsx:82-242` — slides from LEFT side, width 280px
- **Menu trigger**: `src/screens/AiChatPage.tsx:4773-4785` — `<Menu>` icon in top-left nav bar (`ChatNavBar` component)
- **Nav bar**: `src/screens/AiChatPage.tsx:4685-4731` — `ChatNavBar` renders Menu icon (left), share icon (right), new-chat icon (right)
- **Drawer items declared**: `src/app/AppShell.tsx:2261-2308` — `drawerItems` useMemo defines: Settings, Account, Documents, Notes
- **Drawer conversations**: `src/app/AppShell.tsx:2235-2260` — `drawerConversationItems` for chat list with search

**What exists:**
- Left-side sliding drawer (not half-moon, not circular)
- Menu icon in top-left corner of chat page
- Drawer contains: brand name, conversation list with search, tool items (Settings/Account/Documents/Notes), Persona selector

**FEASIBILITY INPUT**: Structural — replacing the drawer with a half-moon or circular menu requires rewriting `Drawer.tsx` and the menu trigger positioning in `AiChatPage.tsx`, plus adjusting the nav bar layout. Touches 2-3 files but the interaction model change is significant.

---

## A2. "'More' should not show what's already shown as copy, regenerate etc"

**Current implementation:**
- **Message action chips** (visible row below messages):
  - `src/screens/AiChatPage.tsx:5249-5270` (user messages): Copy chip + More chip
  - `src/screens/AiChatPage.tsx:5387-5420` (assistant messages): Copy chip + Read Aloud chip + Regenerate chip + More chip
- **"More" opens a modal menu**: `src/screens/AiChatPage.tsx:4131-4212` — `messageMenu` state triggers a bottom-sheet Modal
- **Modal menu contents** (`src/screens/AiChatPage.tsx:4170-4210`):
  - Copy (always shown)
  - Save to Notes (if `onSaveToNotes` exists)
  - Translate
  - Read Aloud (assistant only)
  - Regenerate (assistant only, not while sending)
  - Edit (user only, not while sending)
  - Cancel

**Duplication identified:**
- **Copy**: Shown as a chip AND in the More menu → `AiChatPage.tsx:5255` (chip) + `AiChatPage.tsx:4176-4186` (modal)
- **Regenerate**: Shown as a chip on assistant messages AND in the More menu → `AiChatPage.tsx:5399-5407` (chip) + `AiChatPage.tsx:4197-4207` (modal)
- **Read Aloud**: Shown as a chip on assistant messages AND in the More menu → `AiChatPage.tsx:5390-5398` (chip) + `AiChatPage.tsx:4188-4196` (modal)

**FEASIBILITY INPUT**: Contained change — removing duplicate items from the More modal (or from the chip row) touches only `AiChatPage.tsx`. Need to decide which surface keeps which actions.

---

## A3. "Regenerate doesn't make sense"

**Current implementation:**
- **Regenerate function**: `src/screens/AiChatPage.tsx:3075-3175` — `regenerate` useCallback
- **What it does**: Truncates history to the target assistant message, finds the original user message that produced it, re-sends that user text via `handleSendTracked` with the same attachments → same prompt re-run (no new seed)
- **Trigger locations**:
  - Chip: `src/screens/AiChatPage.tsx:5399-5407` — `<MessageActionChip>` with Sparkles icon
  - Modal: `src/screens/AiChatPage.tsx:4197-4207` — `AttachSheetRow` in More menu
- **State management**: `regenInFlightRef`, `regenAbortRef`, `regenGenerationRef`, `regenHandleSendPassRef` (all in `src/engine/regenState.ts`)
- **Guard rails**: Blocks if already sending/regen in flight; uses generation token for stale-turn protection

**Removing it would touch:**
- `AiChatPage.tsx`: Remove chip rendering (~5399-5407) and modal row (~4197-4207)
- `AiChatPage.tsx`: Remove `regenerate` callback (~3075-3175) and `onRegenerateStable` (~3177-3179)
- `AiChatPage.tsx`: Remove `ChatMessageRowProps.onRegenerate` prop threading
- `src/engine/regenState.ts`: Can keep refs (used by edit flow too)

**FEASIBILITY INPUT**: Contained change — removing regenerate is primarily deleting UI triggers + the callback in `AiChatPage.tsx`. The edit-message flow (`editMessage` at ~3188-3290) uses similar infrastructure but is independent. Low risk.

---

## A4. "Web option/button should be in the text box, together with forcing notes and documents"

**Current implementation:**
- **Web search toggle**: Currently NOT a standalone button — it's inside the **attach sheet** modal:
  - `src/screens/AiChatPage.tsx:4534-4544` — "Deep Research" row in `attachSheetOpen` modal (Search icon + `t("chat.deepResearch")`)
  - Toggles `researchMode` state (line ~1731), which arms the next send as deep research
- **Research mode chip**: `src/screens/AiChatPage.tsx:4005-4022` — shown above composer when `researchMode` is true (dismissible)
- **Notes/Documents attach**: Also in the attach sheet modal:
  - `src/screens/AiChatPage.tsx:4507-4533` — Photo Library, Take Photo, PDF/Word, Library Document rows
  - `docPickOpen` nested picker for library documents
- **Composer today**: `src/screens/AiChatPage.tsx:4025-4128` — TextInput + `ComposerActionRow` (attach button, mic, send/stop)
- **ComposerActionRow**: `src/screens/AiChatPage.tsx:4621-4683` — left: attach button; right: mic + send

**What moving into the composer would touch:**
- `AiChatPage.tsx`: Rewrite `ComposerActionRow` to include web-research toggle, notes button, documents button inline
- `AiChatPage.tsx`: Remove or restructure the attach sheet modal (currently holds all these actions)
- Potentially create a new `ComposerToolbar` component for the expanded inline controls

**FEASIBILITY INPUT**: Structural — moving web/notes/documents from a modal sheet into inline composer controls requires rewriting the composer layout and action row. The attach sheet would be simplified or removed. Touches primarily `AiChatPage.tsx` but the UX flow change is significant.

---

## A5. "Background less green but still green"

**Current implementation:**
- **Palette definitions**: `src/theme/palettes.js:1-144`
- **Light theme shell (background)**: `src/theme/palettes.js:25` — `shell: "#E8EEE7"` (sage green-grey)
- **Dark theme shell**: `src/theme/palettes.js:89` — `shell: "#07101C"` (navy, not green)
- **Material layers** (light): `src/theme/palettes.js:56-58` — `materialTop/Mid/Bottom: "#E8EEE7"` (same as shell)
- **Panel colors** (light): `src/theme/palettes.js:28-34` — various lighter greens/whites
- **Glow accents** (light): `src/theme/palettes.js:65-66` — `glowTop/glowMid` use `accent` (#1F5F4E) with low opacity
- **Usage**: `colors.shell` is used as background throughout — `AiChatPage.tsx:4757` (`backgroundColor: colors.shell`), nav bars, modals, etc.
- **Palette type**: `src/theme/palettes.d.ts` — `ThemeColors` type defines all color tokens
- **Theme provider**: `src/ui/labTheme.tsx` — simple context wrapper reading from palette

**Token to change**: `shell` in `palettes.js` light theme (line 25). Currently `#E8EEE7` — a muted sage green. Making it "less green but still green" means shifting hue toward grey while keeping green undertone (e.g., `#E8EAE7` or `#E6E9E5`).

**FEASIBILITY INPUT**: Contained change — single token edit in `src/theme/palettes.js:25`. If dark theme also needs adjustment, add a second edit at line 89. No structural coupling.

---

## A6. "Show the websources with colors"

**Current implementation:**
- **Source type**: `src/screens/AiChatPage.tsx:175-186` — `MessageSource` type with `title`, `url`, `authors`, `doi`, `provider`
- **Source rendering**: `src/screens/AiChatPage.tsx:5403-5460` — horizontal `ScrollView` of source cards below assistant messages
- **Source card styling**: `src/screens/AiChatPage.tsx:5423-5458` — each card has:
  - `colors.panelSolid` background
  - `colors.line` border
  - Number badge: `colors.accent` background, `colors.accentSoft` bg
  - Provider label: `colors.muted` text (shows "via brave", "via exa", etc.)
  - Title: `colors.ink` text
- **Provider info**: `src/agent/webSearchTool.ts:103-120` — `mapSearchSourcesToChat` passes `provider` field from search results
- **Markdown citations**: `src/chat/MarkdownText.tsx:338-355` — `[N]` citations in text render as tappable chips with `colors.accent` + `colors.accentSoft`

**What "show with colors" would touch:**
- `AiChatPage.tsx:5423-5458` — Add provider-specific color mapping (e.g., Brave=orange, Exa=purple, Tavily=blue)
- Could add a color map keyed on provider string → background/text color pair
- Currently all source cards use the same `panelSolid`/`line`/`accent` colors regardless of provider

**FEASIBILITY INPUT**: Contained change — adding provider-based color coding to the source card rendering in `AiChatPage.tsx:5423-5458`. Would need a provider→color mapping object (5-10 lines) and conditional styling on each card. 1 file, low risk.

---

## Files Read

| File | Lines | Purpose |
|------|-------|---------|
| `src/screens/AiChatPage.tsx` | 1-5824 | Main chat page — menu, composer, message actions, regenerate, sources |
| `src/app/AppShell.tsx` | 1-5458 | App shell — drawer state, drawer items, overlay management |
| `src/theme/components/Drawer.tsx` | 1-242 | Side drawer component |
| `src/theme/palettes.js` | 1-144 | Color palette definitions (light/dark) |
| `src/theme/palettes.d.ts` | 1-110 | Palette type definitions |
| `src/theme/tokens.ts` | 1-78 | Spacing, radius, notebook palette, shadows |
| `src/ui/labTheme.tsx` | 1-12 | Theme context provider |
| `src/agent/webSearchTool.ts` | 1-130 | Web search tool + source mapping |
| `src/chat/MarkdownText.tsx` | 1-100 | Markdown rendering with citation chips |
