# The design delta — what the mock asks for and what the app shows

Written 2026-09-22 after the owner's verdict: *"it is all identical to the old app"*. The verdict is
correct, and the record should say so plainly.

`mock/index.html` is the approved design (rendered by headless Chrome at 349x621 into `mock/n-*.png`
and `mock/00-foglio-completo.png`), and `docs/DESIGN.md` Part 2 describes it. The build implemented
that design **inside the transcript band only**. Every other surface is either the old app's screen,
called unchanged, or deviates from the mock in ways a user sees in the first two seconds. The cause
is written down too: `docs/PARITY.md` Deliverable 3c — "Files the rewrite must NOT touch — call
them" — lists the drawer surface and the seven overlay screens, so the rule that guided the work
protected the old appearance. `docs/DESIGN.md:443` had the Settings rebuild as step 10; it was never
executed, and steps 8, 9, 11 are open for the same reason.

## The delta, one row per visible surface

`compare-N-*.png` in this directory is the evidence: the mock render on the left, the device frame on
the right, both at 349x621 dp.

| # | Surface | The mock | The app | Evidence |
|---|---|---|---|---|
| 1 | The strip and the model pill | Pill carries the **logo mark** and a **green status dot** with `Su questo telefono`; the only other control is `+` | No mark, no dot; a **Web toggle** sits in the strip, and the model state appears as **two extra rows** under it (`Pronto · locale`, the battery estimate) that the mock does not draw | `compare-3-conversation.png`, `compare-4-empty-state.png` |
| 2 | The empty state | The photograph alone, full width, and nothing over it | `Buonasera.` printed over the photograph, a welcome line, suggestion cards, and a toolbar row (`Ricerca approfondita`, `Note`) the mock does not draw | `compare-4-empty-state.png` |
| 3 | Message actions | Three **ghost icon buttons** | Labelled white pills (`Copia`, `Leggi ad alta voce`) | `compare-3-conversation.png` |
| 4 | The composer | The attachment chip with the file name and an `×`, a **filled green arrow**, sans placeholder | No attachment chip, a square stop control, a serif placeholder | `compare-3-conversation.png` |
| 5 | The menu | A **flat green sheet**: a full-width filled `Nuova chat`, then grouped rows with icons (Documenti, Note, Impostazioni, Account) | The old **leaf-fold dome**: `Kalsa / Locale · privato`, a `Predefinita` pill, a search box, `CONVERSAZIONI`, white cards | `compare-1-menu.png` |
| 6 | Settings and the other six overlays | `settingsScreen()` in the mock: **groups, not a list of sixteen rows** (`mock/index.html:183`), in the mock's language | The old screens, unchanged: 5 359 lines, grey page, white cards, system fonts, `Aa — La volpe marrone` | `compare-2-settings.png`, `11-settings-old-screen.png` |
| 7 | Display equations | An inline equation typeset as a fraction in the answer | Absent: the owner cut display equations on 2026-09-21 | `compare-3-conversation.png` |

## The order the surfaces get rebuilt, and what proves each

Every slice ends with the same artefact: a `compare-N-*.png` pair at 349x621 and 325 dp, mock on the
left, device on the right. A slice is done when the two sides agree on geometry, type, colour and
elevation — or when the difference is written down here as a decision.

1. **The strip and the model state** — the mark and the status dot return to the pill, the two extra
   rows leave, the Web toggle moves out of the strip.
2. **The empty state** — the photograph alone; greeting, welcome line and suggestion cards leave
   unless the owner keeps them deliberately.
3. **The menu** — the flat sheet replaces the leaf dome. The leaf (`leafPath.ts`, `LeafPaper.tsx`,
   `useLeafFold.ts`, `Drawer.tsx`) goes with it.
4. **The composer** — the attachment chip, icon actions, the filled arrow.
5. **Settings and the six overlays** — the mock's language, one screen per slice (this is `DESIGN.md`
   step 10, finally executed).
6. **Display equations** — only if the owner restores the decision he cut.

## The one question that must be answered before code moves

Is `mock/index.html` the target, or does the mock itself get raised first (larger type, deeper green,
more air — the owner's ChatGPT reference)? If the mock is raised, the mock is edited first and the
code follows it. Building twice is what this document exists to prevent.
