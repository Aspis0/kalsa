# Implementation brief — slice 1 (the new UX on the device)

Owner's order, 2026-09-22: *"puoi iniziare il lavoro vero, entro domani mattina voglio vedere la nuova
ux"*. This brief is the coder's entry point. **Open your work by pasting the block in
`docs/CODER-BRIEF.md` verbatim**, then read, in this order:

1. **`docs/DESIGN-V2.md`** — the specification. Tokens, components, screens, states, dark mode. This
   file wins over `docs/DESIGN.md` Part 2.
2. **`docs/design/kalsa-mock-v2.html`** — the rendered target. Modes: `?s=conv`, `menu`, `settings`,
   `stream`, `switch`, `empty`, `attesa`. Render any of them with
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu
   --hide-scrollbars --window-size=349,621 --force-device-scale-factor=3 --screenshot=out.png
   "file:///<abs>/docs/design/kalsa-mock-v2.html?s=conv"`.
3. **`docs/captures/2026-09-22/design-v2/`** — every before|after pair, and the four device frames from
   the Jelly Star run. The pairs are the acceptance criterion.

## What slice 1 changes, in the order a user sees it

| # | Surface | The target | Where it lands |
|---|---|---|---|
| 1 | **Strip** | 56 dp: a nude 44 px menu glyph, then the **model pill** — capsule 44 dp, radius 999, `surface`, 1 px `line`, `e1`, one line: the model's short name (flex:none), a 13 px `accent` device glyph (`smartphone` / `monitor`), the short label `Locale` / `Kalsa Brain` in 11.5 px `ink3`, a chevron. **No** brand mark, **no** `+`, **no** web switch, **no** status rows | `src/ui/shell/Shell.tsx` |
| 2 | **Model state** | `Pronto · locale` and the battery line leave the strip: they belong to the pill's sheet, opened by tapping it | `Shell.tsx` + the sheet in `src/host/HostChatSurface.tsx` |
| 3 | **Composer** | **one capsule**, 56 dp, radius 999, `surface`, 1 px `line`, `e2`: a nude 40 px attach glyph, the text, a nude 40 px mic, a **40 px circular filled send**. Above it the attachment chip as a pill and the hold line in `secondary`. **No** permanent toolbar row (`Ricerca approfondita` / `Note` move into the attach sheet) | `src/ui/shell/ShellComposer.tsx`, `ComposerToolbar.tsx` |
| 4 | **Menu** | the flat sheet: mark 36 px + `Kalsa` in 24/700, a full-width **primary `Nuova chat`**, the search field, the label `LE TUE CHAT`, rows 56 dp with a nude leading icon, then the foot group `Documenti / Note / Impostazioni / Account`. **The leaf goes** | a new drawer surface replacing `src/theme/components/Drawer.tsx`; delete `leafPath.ts`, `LeafPaper.tsx`, `useLeafFold.ts` once nothing imports them |
| 5 | **Empty state** | the photograph alone (gutter, radius 16, nothing printed over it) | `src/host/welcomeBlock.tsx` |
| 6 | **Icons** | never boxed: glyphs sit nude in a 48 dp touch box. A container is reserved for the logo's mark and for the single filled primary action | everywhere in `src/ui/shell/**` |
| 7 | **Tokens** | `src/theme/design.ts` gets the v2 roles and the five constraints of `DESIGN-V2.md` §1.1 as tests; `typography.ts` gets the §1.2 scale | `src/theme/**` |

**Slice 2, immediately after**: Settings (first page = Assistente / Aspetto / Privacy e dati / Motore →
Avanzate / Kalsa; the engine material one tap behind) and then the other five overlays.

## What must not happen

- **Do not raise a ratchet.** `src/host/fileSize.test.ts`: `src/host` ≤ 350, `HostRoot.tsx` ≤ 241,
  `src/ui/shell` ≤ 342. Cut a seam; never edit a number to make room.
- **Do not touch** `src/app/AppShell.tsx`, `src/screens/AiChatPage.tsx` (the controller), the engine,
  the governor, the session/KV, the pins, the Meter.
- **Never delete or weaken a test to go green.** Report every replacement.
- **No new file above ~350 lines**, one responsibility per file, and the responsibility must be nameable
  in one phrase.
- The old screens stay mounted until their replacement lands in the same slice.

## What proves it

1. `npx tsc --noEmit` and `npx jest --silent` — exit codes quoted, suite count reported.
2. For each surface: a **mock | device** pair at 349×621 and one at 325 dp, in
   `docs/captures/<date>/impl-1/`, produced by the recipe in `docs/HANDOFF-2026-09-21.md` (build with
   `-PrnllamaBuildFromSource=true` and `HEXAGON_SDK_ROOT=/nonexistent-hexagon-sdk`, install with
   `adb install -r`, screenshots with the animation scales at 1, dumps with them at 0).
3. The Jelly Star's sha256 after the install, reported.
4. What could not be verified, said plainly.

**One trap worth carrying here**: a scroll container that is a flex column shrinks its children — the
Settings cards were clipping their own rows until they were `flex: none`. Look at the pixels; the
checks did not catch it.
