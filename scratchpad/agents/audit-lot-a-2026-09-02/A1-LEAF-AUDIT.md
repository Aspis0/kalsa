# A1 Leaf Fold Drawer — Hostile Audit

**Auditor:** A1 (read-only, no delegation)  
**Date:** 2026-09-02  
**Repo:** `/Users/marco/Projects/kalsa`  
**Scope:** Drawer.tsx, DrawerContent.tsx, LeafPaper.tsx, leafPath.ts, useLeafFold.ts, AppShell.tsx (drawer portion), palettes.js/d.ts

---

## 1. Fit / Content Inside Leaf

### Finding 1.1 — Content padding matches demo: CONFIRMED

`leafPath.ts:11-13` defines `LEAF_PAD_TOP = 138`, `LEAF_PAD_X = 34`, `LEAF_PAD_BOTTOM = 92`.  
`leafPath.ts:24-28` scales these to screen: `paddingTop: (138/800)*height`, `paddingHorizontal: (34/390)*width`, `paddingBottom: (92/800)*height`.  
Demo `leaf-fold-v9.html` uses `padding:138px 34px 92px` on a 390×800 stage. **Exact match.**

### Finding 1.2 — No clip-path on content: CONFIRMED (by design)

`Drawer.tsx:88-97` — the content `Animated.View` has no `clipPath`. It uses padding + flex layout only.  
`LeafPaper.tsx:1` comment + `Drawer.tsx:79-92` — LeafPaper is a separate layer behind content.  
Constraint doc says "No CSS clip-path on content in the final working version." **Compliant.**

### Finding 1.3 — Tools have flexShrink:0: CONFIRMED

`DrawerContent.tsx:210` — `<View style={{ flexShrink: 0, gap: 6 }}>` wraps the tools list.  
`DrawerContent.tsx:51` — section label has `flexShrink: 0`.  
**Tools will not shrink.** Correct.

### Finding 1.4 — Header does NOT have flexShrink:0: PLAUSIBLE (minor risk)

`DrawerContent.tsx:57-65` — header row has `flexShrink: 0` ✓ (line 63). The inner brand+subtitle `View` has `flex: 1, minWidth: 0` (line 66) which is fine — `flex: 1` on the inner wrapper doesn't affect the outer row's shrink behavior since the outer row has `flexShrink: 0`.

**Refuted.** I misread initially — the header row does have `flexShrink: 0` at line 63.

### Finding 1.5 — Persona button double-close: CONFIRMED (bug)

`DrawerContent.tsx:76-78`:
```tsx
onPress={() => {
  onPersonaPress();
  onClose();    // ← calls Drawer's onClose
}}
```

`AppShell.tsx:5298-5300`:
```tsx
onPersonaPress={() => {
  Keyboard.dismiss();
  setDrawerOpen(false);   // ← also closes drawer
  setActiveOverlay({ kind: "personas" });
}}
```

`Drawer.tsx:87` passes `onClose` to `DrawerContent`, which calls `onClose` after `onPersonaPress()`.  
`AppShell.tsx:5282` — `Drawer onClose` prop also calls `setDrawerOpen(false)`.

**Result:** `setDrawerOpen(false)` fires twice (once from `onPersonaPress`, once from `DrawerContent.onClose`). React batches this into a single render — functionally harmless but semantically wrong. The intent is: `onPersonaPress` opens the personas overlay and closes the drawer. The `DrawerContent.onClose()` call is **redundant** and creates a confusing contract where callers of `onPersonaPress` must know it also triggers `onClose`.

**Verdict: CONFIRMED — redundant double-close, not a crash but a contract smell.**

### Finding 1.6 — Empty conversations: CONFIRMED (no crash)

`DrawerContent.tsx:134-205` — if `conversationItems` is undefined or empty, `showConversations` is false (line 134), and the fallback `<View style={{ flex: 1 }} />` (line 205) fills the space. No crash on empty list.

### Finding 1.7 — fontScale remount: CONFIRMED (correct behavior)

`AppShell.tsx:5275` — `<Drawer key={fontScaleId} ...>`. On font scale change, Drawer remounts. `useLeafFold` reinitializes `progress` to 0, then `useEffect([open, progress])` animates to 1. Drawer reopens with new font sizes. **Intentional.**

---

## 2. Security / Secrets

### Finding 2.1 — No credential logging in drawer files: CONFIRMED

`Drawer.tsx`, `DrawerContent.tsx`, `LeafPaper.tsx`, `leafPath.ts`, `useLeafFold.ts` — `grep` for `console.`, `log(`, `password`, `secret`, `token`, `credential`, `apiKey` returns zero hits.  
The only `spacing` import hit (`Drawer.tsx:6`) is the spacing token, not a credential.

**Clean. No leaks.**

---

## 3. Bugs

### Finding 3.1 — transformOrigin 3-tuple on RN: CONFIRMED (latent risk)

`Drawer.tsx:81`:
```tsx
style={[styles.fill, { transformOrigin: [originX, originY, 0] }, fold.paperStyle]}
```

`LeafPaper.tsx:100`:
```tsx
style={[StyleSheet.absoluteFill, { transformOrigin: [foldX, height / 2, 0] }, flapStyle]}
```

React Native's `transformOrigin` accepts a `Point` (2D `{x, y}`) or a string. Passing a 3-element array `[x, y, 0]` is **not officially documented**. On iOS this works (Core Animation ignores the Z). On Android, Hermes + the new architecture may silently ignore the Z or throw.

**The implementation should use `[originX, originY]` (2D) instead of `[originX, originY, 0]` (3D).** The Z=0 has no visual effect — it's dead weight that risks a runtime warning on strict RN versions.

**Verdict: CONFIRMED — works today but is undocumented API surface. 2-tuple would be correct.**

### Finding 3.2 — SVG hardcoded clip/gradient IDs: PLAUSIBLE (collision risk)

`LeafPaper.tsx:91-107`:
```tsx
clipId="leafClipL"
gradId="leafGradL"
clipId="leafClipR"
gradId="leafGradR"
```

If two `LeafPaper` instances render simultaneously (e.g., during a remount race), SVG `url(#leafClipL)` references in the same document would collide. Currently safe because only one `Modal` with one `LeafPaper` exists. But this is **fragile** — any future code that renders two drawers (e.g., an overlay drawer) would break silently.

**Verdict: PLAUSIBLE — not a bug today, but a latent trap.**

### Finding 3.3 — showBack initial state: CONFIRMED (correct)

`useLeafFold.ts:40` — `const [showBack, setShowBack] = useState(true)`.  
When closed (progress=0), `flapScaleX(0, 0) = interpolate(smooth(clamp01((0-0.18)/0.7)), [0,1], [-1,1])` = `interpolate(0, [0,1], [-1,1])` = `-1`. Since `-1 < 0`, `useAnimatedReaction` sets `showBack = true`. Flap starts showing back face. On open, it transitions to front. Matches demo behavior.

### Finding 3.4 — Crease offset rounding on non-390px screens: CONFIRMED (cosmetic)

`LeafPaper.tsx:122`:
```tsx
left: foldX - 1.5,
```

Where `foldX = width / 2`. On a 375px screen: `foldX = 187.5`, `left = 186.0`.  
The SVG fold axis in `leafPath.ts:17` is `LEAF_FOLD_X = 195` in a 390-wide viewBox, which maps to `(195/390)*375 = 187.5` on a 375px screen. The crease is at 186.0, off by **1.5px** from the fold axis.

On a 430px screen: `foldX = 215`, `left = 213.5`. SVG maps to `(195/390)*430 = 215`. Off by 1.5px.

The crease is consistently **1.5px left of center** due to `width / 2 - 1.5` instead of `(LEAF_FOLD_X / LEAF_VB_W) * width`. At 390px it's exact because `(195/390)*390 - 1.5 = 193.5` while the fold axis is at 195. Wait — let me recalculate:

At 390px: `foldX = 195`, `left = 193.5`. SVG fold axis = 195. **Off by 1.5px even at the reference width.**

The crease is meant to sit on the fold axis. It's 1.5px to the left. At stroke width 3px, the crease spans 186→189 on a 375px screen, while the fold axis is at 187.5. The crease is **nearly centered** but not quite.

**Verdict: CONFIRMED — 1.5px systematic offset from fold axis. Negligible visually (3px stroke absorbs it), but wrong in principle.**

### Finding 3.5 — No null crashes in drawer files: CONFIRMED

`DrawerContent.tsx:134` — `Array.isArray(conversationItems)` guards the list.  
`DrawerContent.tsx:171` — `conversationItems.map(...)` only runs when `showConversations` is true.  
`DrawerContent.tsx:75` — `onPersonaPress` is guarded by `{onPersonaPress ? (...) : null}`.  
No unguarded `.map()` on potentially undefined arrays.

### Finding 3.6 — showBack state set via runOnJS during unmount: PLAUSIBLE (minor)

`useLeafFold.ts:79-82`:
```tsx
useAnimatedReaction(
  () => flapScaleX(progress.value, reduceSv.value) < 0,
  (back, prev) => {
    if (back !== prev) runOnJS(setShowBack)(back);
  },
);
```

If the component unmounts while the animation is running, `runOnJS(setShowBack)` could fire after unmount. React will warn (setState on unmounted component) but won't crash. Same for `setContentLive` at lines 84-87.

**Verdict: PLAUSIBLE — React warning in dev mode, no prod crash. Low severity.**

---

## 4. Races

### Finding 4.1 — Rapid open/close toggle: PLAUSIBLE (visual stutter)

If user taps Menu → immediately taps backdrop → immediately taps Menu within <100ms:

1. `open` goes true → `progress` starts animating 0→1 (1400ms)
2. `open` goes false → Reanimated **replaces** the animation with 1→0 (980ms)
3. `open` goes true → Reanimated replaces again with current→1

Each replacement is instant — no blending. The paper will visually "jump" to wherever `progress` is at replacement time, then animate from there. With `Easing.out(cubic)` on open and `Easing.in(cubic)` on close, the easing curves are different, causing a non-smooth transition.

Demo handles this identically (linear lerp with `cancelAnim()`). **This is inherent to the animation model, not a bug.**

**Verdict: PLAUSIBLE — expected behavior, matches demo, not fixable without animation blending.**

### Finding 4.2 — pointerEvents content gating: CONFIRMED (correct)

`Drawer.tsx:93`:
```tsx
pointerEvents={fold.contentLive ? "auto" : "none"}
```

`useLeafFold.ts:84-87` — `contentLive` becomes true when `progress.value > 0.88`. Content is non-interactive until 88% open. Prevents accidental taps on half-visible content.

Demo uses `onleaf.style.pointerEvents = late>0.65 ? "auto" : "none"` (demo threshold is 0.65, not 0.88). The RN implementation is **more conservative** (0.88 vs 0.65). This means content becomes interactive later than in the demo — a deliberate tightening.

**Verdict: CONFIRMED — correct behavior, more conservative than demo.**

### Finding 4.3 — Modal onRequestClose: CONFIRMED (correct)

`Drawer.tsx:77` — `<Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>`. Android back button triggers `onClose`. `onClose` is `() => { setDrawerOpen(false); setChatSearch(""); }` from `AppShell.tsx:5282-5284`. Standard pattern. No race.

---

## 5. Memory Leaks

### Finding 5.1 — reduce-motion subscription cleanup: CONFIRMED (correct)

`useLeafFold.ts:45-53`:
```tsx
useEffect(() => {
  const apply = (v: boolean) => { ... };
  AccessibilityInfo.isReduceMotionEnabled().then(apply);
  const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", apply);
  return () => sub.remove();
}, [reduceSv]);
```

`sub.remove()` is called on cleanup. **No leak.**  
`reduceSv` is a `useSharedValue` (stable reference across renders). Dependency array is correct.

### Finding 5.2 — No leaked listeners in drawer files: CONFIRMED

All `useEffect` hooks in `useLeafFold.ts` return cleanup functions. No `addEventListener` without corresponding `removeEventListener`. No timers without `clearTimeout`.

---

## 6. Edge Cases

### Finding 6.1 — Reduce motion: CONFIRMED (correct)

`useLeafFold.ts:55-77` — when `open` changes, reads `reduceRef.current`. If reduced: 240ms open, 200ms close. If not: 1400ms open, 980ms close.

`useLeafFold.ts:24-34` — `flapScaleX` and `paperScale` both check `reduced` parameter and skip origami unfold when reduced. Paper scales from 0.18→1 (reduced) or 0.12→1 (full). Flap stays at scaleX=1 (no fold) when reduced.

`useLeafFold.ts:103-112` — content opacity in reduced mode: `smooth(v)` (immediate, no late reveal). Full mode: late reveal at 78% progress.

**All three mechanisms (duration, geometry, content timing) adapt to reduce motion. Correct.**

### Finding 6.2 — Missing onPersonaPress: CONFIRMED (correct)

`DrawerContent.tsx:75` — `{onPersonaPress ? (...) : null}`. If undefined, persona button is not rendered. Header row still shows brand + subtitle.

### Finding 6.3 — Font scale remount: CONFIRMED (correct, see 1.7)

### Finding 6.4 — Keyboard open: CONFIRMED (no special handling needed)

`Drawer.tsx:77` — `Modal transparent animationType="none"` overlays the keyboard. Content scrolls within the modal. No keyboard avoidance needed — the leaf shape doesn't change.

---

## 7. Props Contract

### Finding 7.1 — Props identical to pre-A1: CONFIRMED

`Drawer.tsx:14-38` defines:
```
open, onClose, brand, subtitle, items, conversationItems,
searchValue, onSearchChange, onNewChat, personaLabel, onPersonaPress
```

`AppShell.tsx:5275-5300` passes exactly these props. No new required props. No removed props.  
`src/theme/components/index.ts:8` — `export { Drawer, type DrawerItem, type DrawerConversationItem }` — unchanged export.

### Finding 7.2 — Edge swipe fully removed: CONFIRMED

`AppShell.tsx` — `grep` for `edgeSwipe`, `Gesture.Pan`, `GestureDetector` returns **zero hits**.  
The only `setDrawerOpen(true)` is at `AppShell.tsx:5244` — `onMenuPress={() => setDrawerOpen(true)}`.  
Sole entry point confirmed. No gesture-based drawer opening.

### Finding 7.3 — All 14 setDrawerOpen(false) call sites intact: CONFIRMED

Lines: 2079, 2083, 2116, 2120, 2145, 2164, 2196, 2262, 2273, 2283, 2293, 2804, 5282, 5298. All are `setDrawerOpen(false)` — none modified by A1.

---

## 8. Dead Code

### Finding 8.1 — No dead imports: CONFIRMED

`Drawer.tsx` imports: React, Modal, Pressable, StyleSheet, useWindowDimensions, View, Animated, useSafeAreaInsets, useLabTheme, spacing, DrawerContent, LeafPaper, leafContentPad, useLeafFold. All used.

`DrawerContent.tsx` imports: React, Pressable, ScrollView, Text, TextInput, View, useLocale, useLabTheme, BrandIcon, radius, spacing, typography, DrawerConversationItem, DrawerItem. All used.

`LeafPaper.tsx` imports: React, StyleSheet, View, ViewStyle, LinearGradient, Animated, AnimatedStyle, Svg, ClipPath, Defs, SvgGradient, Path, Stop, leafPath constants. All used.

`useLeafFold.ts` imports: useEffect, useRef, useState, AccessibilityInfo, Easing, interpolate, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming. All used.

`leafPath.ts` — all exports (`LEAF_VB_W`, `LEAF_VB_H`, `LEAF_PAD_TOP`, `LEAF_PAD_X`, `LEAF_PAD_BOTTOM`, `LEAF_FOLD_X`, `LEAF_FOLD_Y`, `LEAF_D`, `LEAF_CLIP_LEFT`, `LEAF_CLIP_RIGHT`, `leafContentPad`) are consumed by `LeafPaper.tsx` and/or `Drawer.tsx`.

**No dead code found.**

---

## 9. Palette Compliance

### Finding 9.1 — Leaf tokens present in both themes: CONFIRMED

`palettes.js:82-87` (light): `leafBody: "#DCEFE2"`, `leafBodyDeep: "#A8D0B8"`, `leafBack: "#6FA88A"`, `leafStroke: "#6A9A7C"`, `leafTile: "rgba(255,255,255,0.55)"`, `leafTileActive: "rgba(255,255,255,0.82)"`.

`palettes.js:149-154` (dark): `leafBody: "#2C6750"`, `leafBodyDeep: "#174032"`, `leafBack: "#0E2A20"`, `leafStroke: "rgba(136,192,208,0.4)"`, `leafTile: "rgba(0,0,0,0.28)"`, `leafTileActive: "rgba(0,0,0,0.42)"`.

`palettes.d.ts` — all six leaf tokens typed as `string`. ✓

### Finding 9.2 — LeafPaper colors prop uses leafBody/leafBodyDeep/leafBack/leafStroke: CONFIRMED

`LeafPaper.tsx:9-12` — `Colors` type requires `leafBody`, `leafBodyDeep`, `leafBack`, `leafStroke`.  
`Drawer.tsx:82-88` passes `colors` from `useLabTheme()` which includes these tokens.

**Note:** The spec (`A1-LEAF-FOLD.md:§7`) proposed new tokens `leafVein`, `leafVeinGlow`, `leafOutline`, `leafCrease`. **None of these were added.** The implementation uses `leafStroke` for both outline and crease, and has no vein tokens. This is acceptable since the implementation opted for a simpler fold-based design without SVG veins, but it diverges from the spec's color proposal.

---

## Summary

### Ship Blockers

**None.** No crashes, no data loss, no security issues, no memory leaks.

### Bugs to Fix

| # | Severity | Finding | File:Line |
|---|----------|---------|-----------|
| 3.1 | **Medium** | `transformOrigin: [x, y, 0]` — 3-tuple undocumented on RN. Use 2-tuple `[x, y]`. | `Drawer.tsx:81`, `LeafPaper.tsx:100` |
| 1.5 | **Low** | Double-close on persona press — `onPersonaPress()` then `DrawerContent.onClose()` both close drawer. Redundant `onClose()` call in DrawerContent. | `DrawerContent.tsx:78` |

### Nits

| # | Finding | File:Line |
|---|---------|-----------|
| 3.4 | Crease `left: foldX - 1.5` is 1.5px off the SVG fold axis. Use `(LEAF_FOLD_X / LEAF_VB_W) * width` instead of `width / 2 - 1.5`. | `LeafPaper.tsx:122` |
| 3.2 | SVG clip/gradient IDs are hardcoded strings. Safe today (single Modal) but fragile if a second drawer instance ever renders. | `LeafPaper.tsx:91-107` |
| 3.6 | `runOnJS(setShowBack)` / `runOnJS(setContentLive)` can fire after unmount. React dev warning, no prod crash. | `useLeafFold.ts:79-87` |
| 9.2 | Spec proposed `leafVein`/`leafVeinGlow`/`leafOutline`/`leafCrease` tokens — not added. Implementation uses simpler fold design. Acceptable divergence. | `palettes.js` |

### What's Solid

- **Fit constraint:** Padding matches demo exactly. No clip-path on content. Tools have `flexShrink: 0`. Header has `flexShrink: 0`.
- **Security:** Zero credential logging across all drawer files.
- **Animation math:** `smooth()`, `flapScaleX()`, `paperScale()`, crease/shade opacity — all match demo formulas exactly.
- **Reduce motion:** Three-layer adaptation (duration, geometry, content timing). Subscription properly cleaned up.
- **Props contract:** Identical to pre-A1. All 14 `setDrawerOpen(false)` sites untouched. Edge swipe fully removed (zero `Gesture`/`GestureDetector` references in AppShell).
- **Edge swipe removal:** Complete. Only `setDrawerOpen(true)` is `onMenuPress` at `AppShell.tsx:5244`.
- **Mount/unmount:** `mounted` state drives `Modal visible`. Close animation completes before unmount via `runOnJS(setMounted)` in `withTiming` callback.
- **Empty state:** No crash on empty conversations, missing persona, or missing search.
