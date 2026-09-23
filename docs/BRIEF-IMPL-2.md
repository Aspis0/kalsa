# Implementation brief — slice 2 (Settings)

Sequel to `docs/BRIEF-IMPL-1.md`. The specification is `docs/DESIGN-V2.md`; the rendered target is
`docs/design/kalsa-mock-v2.html` (`?s=settings`, and `?s=menu` for the menu's language). Open your work by
pasting the block in `docs/CODER-BRIEF.md` verbatim. Repo: `/Users/marco/Projects/kalsa-ux`, branch
`ux-2026-09-21`. Your workspace cwd is another line's tree — never work there; `cd` and confirm the
branch first.

## Why this slice exists

Settings is the last surface a person meets that is still the old one: `src/screens/SettingsScreen.tsx`
is **3 050 lines** mounted through `src/host/HostOverlays.tsx:24-30`, and it carries every internal
figure on its first screen. The owner's words, twice: *why are the KV cache and the rest on the first
page?* and, about the logo, *the symbol belongs in Settings*. Both are answered here, and so is the web
toggle, which slice 1 left orphaned when it left the strip: its spec'd home is **Settings › Privacy**.

## What to build

| # | Surface | The target (DESIGN-V2 §3.3, §2) | Notes |
|---|---|---|---|
| 1 | **Screen header** | title **centred**, back chevron at the left edge (40 px ghost button), 16 dp side padding | one header for every screen; the chevron is a **nude** glyph |
| 2 | **First page** | five groups, in this order: `ASSISTENTE` (**Dove risponde**, **Modello**) · `ASPETTO` (**Tema**, **Dimensione testo**, **Lingua**) · `PRIVACY E DATI` (**Web**, **Telemetria**, **Permessi**) · `MOTORE` (**Avanzate**, one row, labelled with its entry count) · `KALSA` (the mark card) | rows 56 dp (64 when two-line), value on the right, `chevron` or toggle; a row carries **no leading icon box** but a nude 20 dp `accent` glyph |
| 3 | **Avanzate** | a second screen holding the engine material: contesto, cache KV, ragionamento, governor, soglie termiche, finestra KV, download, diagnostica | one tap behind the first page. This is the owner's central request: **nothing about the engine on the first screen** |
| 4 | **Web** | the toggle lives in `PRIVACY E DATI` and is wired to the real `toggleWebTools` path | it has **no** UI consumer today (reviewer's note 4 in slice 1). A test must pin that the toggle reaches the same handler |
| 5 | **KALSA card** | the mark (40 px, radius 12), the wordmark, `Versione 0.1.0 · locale e privato` | this is the logo's home in the interface, together with the launcher icon. The owner's decision |
| 6 | **Sheets** | any selectable list opens the sheet component: grabber 36×4, `title`, optional subtitle, rows, a full-width primary "Fatto" | the grabber is **missing today** on the shell's sheet (found on device, frame 08). Fix it in the sheet component, not per screen |
| 7 | **Reviewer's three notes from slice 1** | (a) `HostDrawer.tsx:44-47` — the argument order of `runConversationRowAction` is guarded only by a text match; make it behavioural. (b) the "not export" branch of delete is unverified (`shareConversation.test.ts:148`); cover it. (c) the sheet's buttons say bare "Esporta"/"Elimina"; give them their object | small, do them first — same files, same cycle |

## What must not change

- **The old SettingsScreen may not be deleted in this slice.** It stays mounted until its replacement
  covers the same ground; the slice adds the new surfaces and moves the truthful ones across. Say in the
  report which of the 3 050 lines still matter and which are dead.
- **Never raise a ratchet.** `src/host/fileSize.test.ts`: `src/host` ≤ 350, `HostRoot.tsx` ≤ 241 (it sits
  at exactly 241 right now — extract before you add), `src/ui/shell` ≤ 342.
- **Do not touch** `src/app/AppShell.tsx`, `src/screens/AiChatPage.tsx`, the engine, the governor, the
  session/KV, the pins, the Meter.
- **Never delete or weaken a test to go green**; report every replacement with its reason.
- No new file above ~350 lines, one responsibility per file, English in code, comments and docs.
- Do not commit, do not build, do not install: the orchestrator verifies, commits and runs the device
  capture.

## What proves it

1. `npx tsc --noEmit` and `npx jest --silent`, with exit codes and the suite count in the report.
2. For the first page, the Avanzate screen and the KALSA card: a **mock | device** pair at 349×621 and
   325 dp in `docs/captures/2026-09-23/slice2/`, by the recipe in `BRIEF-IMPL-1.md`.
3. The report in `docs/REPORT-IMPL-2.md`, with `file:line` for every claim and a line saying what you
   could not verify.

**Two traps already paid for, do not pay them twice**: a scroll container that is a flex column shrinks
its children (the Settings cards were clipping their own rows — `flex: none`), and a number in the
palette test does not prove a screen reads well: look at the rendered pixels.
