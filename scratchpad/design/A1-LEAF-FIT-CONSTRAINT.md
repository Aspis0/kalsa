# A1 Leaf Fit Constraint (locked 2026-09-04)

Visual reference demo: `scratchpad/design/leaf-fold-v9.html` (= v11.1)
Live: https://d7c48b41.kalsa-leaf-fold.pages.dev/ (or https://kalsa-leaf-fold.pages.dev/)

## Hard rule (Marco)

**Every piece of drawer UI must sit inside the leaf fill** — header, search, chat list, persona, and **all tool rows** (Settings, Account, Documents, Notes). Nothing clipped by the curve, nothing painted outside the green.

## What worked in the demo (v11.1)

- Nearly full-screen leaf: soft tip only at top; mid/bottom almost full phone width.
- Content padding in the **wide band** (not in the tip/taper): demo used ~`padding: 138px 34px 92px` on a 390×800 stage.
- **No CSS clip-path on content** in the final working version — geometry + padding only.
- Chats: flex scroll region; tools: fixed vertical list at bottom inside the wide band.
- Origami open: `scaleX(-1→1)` book fold (2D — RN Modal/`overflow` flattens 3D).
- Close complete: stage fully hidden at progress≈0 (only bud icon remains).
- Geometric audit: every visible element had ≥6px margin inside the full leaf path (0 FAIL).

## Do NOT

- Put tools in the pointed tip.
- Clip content to an aggressive organic path that eats header/persona.
- Leave decorative veins/midrib when open.
- Keep edge-swipe open (tap-only).

## Veins (intentional omission)

v11.1 open drawer has **no veins / midrib**. RN palettes do not add `leafVein` / `leafVeinGlow` — not drift. Outline uses `leafStroke`; crease is fold-only.
