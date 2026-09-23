# Design direction — the bar the owner pointed at (2026-09-22)

Written after the owner's verdict that the app is aesthetically the same as the one it replaced, and
his correction of the target: study the ChatGPT mobile case study (Akshat Khare, Medium, 2023-06-19)
and the two reference sheets he sent, then design to *that* bar rather than to the current mock.

## What the references actually say (sourced, not inferred)

From the case study: the interface face is **Inter**; the primary colour is **`#4BA282`** — a medium
green used as a *fill*; the side menu is the navigation hub (new chat, conversations, settings); and
**night mode and dark mode are part of the deliverable**, not an afterthought.

From the reference sheets: **solid deep-green full-width buttons** with white semibold labels; large
near-black headings; **white cards on a pale page** with hairline separators and almost no shadow;
**form fields** with grey placeholders, a leading icon and a trailing action; **chips** as outlined
pills for choices; **list rows** of 56–64 dp with a leading icon and a chevron; a numeric picker and a
dial for ranges; bottom sheets with a full-width primary action; and, in the chat sheet, **typeset
mathematics**, a **dark code card** with a language label and a copy control, and message actions as
**ghost icons** rather than labelled pills.

## The tokens this direction sets

| Token | v1 mock (today) | v2 (this direction) | Why |
|---|---|---|---|
| Page | `#f4f8f3` | `#f8faf9` | the reference's page is nearly white; green is carried by the accent, not the ground |
| Surface | `#ffffff` | `#ffffff` | unchanged |
| Primary fill | `--g600 #1f5f4e`, used sparingly | `--brand #1f5f4e` for **every** primary control | the reference's green is a button colour, not a tint |
| Tinted row | `--g100 #dce8e2` | `--g50 #eef4f1` for selected rows; selection stays `#cfe3d6` | less green in bulk |
| Text | `#17201c` / `#5b6b62` | `#12171a` / `#5f6b66` | same family, slightly harder |
| Hairline | `#dfe6e0` | `#e6eae7` | separators do the work shadows did |
| Radii | pill 999, card 20, sheet 28 | **button/field/row 14, card 16, sheet 22, chip 999** | the reference is rounded, not pill-shaped |
| Elevation | three soft levels used everywhere | **hairline for cards, one soft level for floating only** (composer, sheets) | kills the "everything floats" look |
| Type — display | — | **26/700** (screen titles) | the reference's headings are large and bold |
| Type — title | 21/600 serif | **21/700 sans** for chrome, serif kept for reading | chrome is sans, answers are serif |
| Type — body | 13.5 | **15** | 13.5 is the old app's density |
| Type — reading | 16 serif | **17/1.66 serif** | reading face earns its size |
| Type — section label | 10.5/700 caps | 11/700 caps, `+0.09em` | unchanged in kind, larger |
| Controls | send 38 px circle | **44 px, radius 12, filled** | 48 dp boxes with 44 px paint; the reference's tap sizes |

## Component rules

- **Primary button**: full width, 52 dp, `--brand` fill, white 15/600 label, radius 14, **no shadow**.
- **Secondary**: white fill, hairline border, ink label. **Tertiary**: accent label, no container.
- **Field**: 52 dp, white, hairline, radius 14, sans placeholder in `--ink3`, leading icon, trailing
  action; focus raises the hairline to the accent.
- **Row**: 56 dp, leading 20 px accent icon, 15 px label, optional 12 px secondary line, chevron.
  Rows live in white cards; the card carries the hairline, never each row.
- **Chip**: outlined pill, 32 dp; selected = `--brand` fill, white label.
- **Message actions**: ghost icons, 36 dp, `--ink3`, no container; the copy confirmation is the only
  one that fills.
- **Code card**: `#1b1f1d` ground, 12.5 mono, syntax in three accents, a label row with the language
  and a copy control.
- **Mathematics**: inline and display, typeset — the reading face's italic with real fractions.
- **Dark mode**: page `#101613`, surface `#182019`, ink `#e8f0ea`, accent `#4ba282` for text,
  `#1f5f4e` for fills, hairlines `#26302b`. Specified now, built with the first surface.

## The mapping, surface by surface

| Surface | What changes first |
|---|---|
| Strip | the pill keeps the mark and the status dot; 44 dp ghost `+`; nothing else lives there |
| Transcript | reading 17, action row as ghost icons, source chips outlined, code card dark |
| Composer | 52 dp field with a hairline, filled 44 px send, attachment chip outlined, no toolbar row |
| Menu | white sheet, 24/700 title, full-width primary `Nuova chat`, grouped rows with icons |
| Settings | groups of white cards with 56 dp rows, sans chrome, no system-font leftovers |
| Empty state | the photograph alone, then the composer; suggestions as rows, not cards |
| Everywhere | the leaf is gone (`leafPath.ts`, `LeafPaper.tsx`, `useLeafFold.ts`, `Drawer.tsx`) |

The mock rendered with these tokens is `docs/design/kalsa-mock-v2.html`; its renders and the
v1|v2 pairs are in `docs/captures/2026-09-22/design-v2/`.
