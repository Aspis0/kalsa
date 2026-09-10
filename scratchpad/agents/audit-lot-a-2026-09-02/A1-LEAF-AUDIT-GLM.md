# A1 Leaf Fold Drawer — Post-Fix Hostile Audit (A1-GLM)

**Auditor:** A1 (GLM), read-only, no delegation, single pass over every scoped file + demo.
**Date:** 2026-09-04
**Repo:** `/Users/marco/Projects/kalsa`
**Constraint:** `scratchpad/design/A1-LEAF-FIT-CONSTRAINT.md` (locked 2026-09-04)
**Demo:** `scratchpad/design/leaf-fold-v9.html` (v11.1, read in full)
**Prior audit:** `A1-LEAF-AUDIT.md` (re-checked item by item; two of its claims are wrong — see REFUTED).

Every finding carries a quoted line read directly from the file. All nits listed; none omitted.

---

## Angle 1 — Fit geometry / padding math vs demo 138/34/92

### F1.1 — Padding constants match demo exactly: CONFIRMED (solid)
`leafPath.ts:7-9`
```ts
export const LEAF_PAD_TOP = 138;
export const LEAF_PAD_X = 34;
export const LEAF_PAD_BOTTOM = 92;
```
`leafPath.ts:31-33` scales by `LEAF_VB_H`/`LEAF_VB_W` (800/390), matching the demo's `padding:138px 34px 92px` on a 390×800 stage (`leaf-fold-v9.html`, `#onleaf` rule). Proportional scaling to arbitrary screen size is a reasonable generalization of the fixed demo stage. **Compliant.**

### F1.2 — No clip-path on content: CONFIRMED (solid)
`Drawer.tsx:92-94`
```tsx
<Animated.View
  pointerEvents={fold.contentLive ? "auto" : "none"}
  style={[styles.fill, pad, fold.contentStyle]}
>
```
No clip on content; geometry + padding only, per the constraint's "No CSS clip-path on content". **Compliant.**

### F1.3 — Tools never shrink: CONFIRMED (solid)
`DrawerContent.tsx:207` — `<View style={{ flexShrink: 0, gap: 6 }}>` wraps the tools list; divider at `DrawerContent.tsx:205` also `flexShrink: 0`. Chats are the flex/scroll region (`DrawerContent.tsx:160` `flex: 1, minHeight: 0`). Matches demo layout model. **Compliant.**

### F1.4 — Vertical fit overflow on short screens at fontScale xl: PLAUSIBLE BUG
Nothing clips the content layer, and RN/Yoga's default `flexShrink: 0` means all fixed rows (header, search, divider, sections, 4 tool rows) can overflow the padded box if they exceed available height. Worst case, height ≈ 667 (SE-class), fontScale xl = 1.3 (`typography.ts:65-70`), subtitle + search + new-chat present:
padTop 115 + header ≈57 + search ≈57 + "Chats" section ≈27 + new-chat ≈52 + divider 17 + "Tools" section 27 + 4 tool rows ≈228 + gaps 18 + padBottom 77 ≈ **675 > 667**. Tools would paint past the bottom padding into the leaf taper / off the silhouette — violating the hard rule "all tool rows … Nothing painted outside the green". Not reproducible on the dev device set presumably; but the constraint says EVERY piece of drawer UI sits inside the leaf fill, and at xl + small phone it doesn't.
**Fix direction:** scale the pad/row paddings with fontScale, or let tool rows shrink (they won't), or clamp drawer content to a ScrollView when fixed rows exceed the band.

### F1.5 — Tools content sizes match demo: CONFIRMED
Tool rows: `DrawerContent.tsx:206-211` — `paddingHorizontal: 14, paddingVertical: 11` and icon `size={17}` match demo `.ltool` (`padding:11px 14px`, `.lic` 17px). Gap 6 matches `.ltools` `gap:6px`. Search field `borderRadius: 12` (`DrawerContent.tsx:116`) matches demo `.lsearch` radius 12 (tile default 14 is correctly overridden). **Solid.**

---

## Angle 2 — Animation math vs demo

### F2.1 — Per-frame formulas are an exact port: CONFIRMED (solid)
- `useLeafFold.ts:15-17` `smooth(t) = t*t*(3-2*t)` with internal clamp == demo `smooth` + call-site clamps.
- `useLeafFold.ts:23-25` `flapScaleX = interpolate(smooth(clamp01((v-0.18)/0.7)),[0,1],[-1,1])` == demo `foldT/sx`.
- `useLeafFold.ts:27-31` `paperScale`: full `smooth(clamp01(v/0.28))` → 0.12→1; reduced `smooth(v)` → 0.18→1 — both identical to demo `render()`.
- `useLeafFold.ts:114` `late = clamp01((v - 0.78) / 0.18)` + `translateY (1-late)*8` == demo `onleaf` reveal.
- `useLeafFold.ts:122,131` `motion = clamp01((0.92-v)/0.12)*clamp01((v-0.08)/0.12)`; crease ×0.85, shade ×0.55 — both identical to demo `edge`/`flapShade`.
- Durations `useLeafFold.ts:61,69` — 1400 open / 980 close / 240 / 200 reduced, exact demo match.
- Paper opacity cut `paperStyle`: `v > 0.008 ? 1 : 0` == demo `open = v>0.008`. **All CONFIRMED.**

### F2.2 — Open/close easing choreography deviates from the locked demo: PLAUSIBLE BUG
Demo `openDrawer()` (full motion) uses a hand-tuned 3-phase curve:
```js
if(x<0.20) target = lerp(0, 0.22, smooth(x/0.20));
else if(x<0.82){ ... t<0.35 ? (t/0.35)²*0.35 : t<0.70 ? lerp(0.35,0.78,...) : lerp(0.78,1,1-(1-(t-0.70)/0.30)²) ... target = lerp(0.22, 0.90, u); }
else target = lerp(0.90, 1, smooth((x-0.82)/0.18));
```
and `closeDrawer()` a two-stage settle: `x<0.55 → lerp(from, 0.18, …)` then `→ 0`. The RN port (`useLeafFold.ts:62,69`) replaces both with stock `Easing.out(Easing.cubic)` / `Easing.in(Easing.cubic)`. The demo's staged curves (slow fold-start, drift, snap; close with a visible pre-settle) were deliberately tuned in v9 — they are the locked visual reference. The port keeps the durations but not the character. The constraint doesn't explicitly pin easing, but "post-fix" parity with v11.1 is the premise of this audit: **report as deviation from reference**. Fix direction: port the two piecewise curves as custom `Easing.bezier` chains or a worklet mapping x→v.

### F2.3 — Content-interactive threshold 0.88 vs demo 0.897: CONFIRMED NIT
`useLeafFold.ts:87` — `() => progress.value > 0.88`. Demo: `onleaf.style.pointerEvents = late>0.65 ? "auto":"none"` ⇒ v > 0.78 + 0.65×0.18 = **0.897**. RN flips 1.7pt earlier; at flip, content opacity `late ≈ 0.556` — taps enabled while content is ~56% opaque (demo: ~66%). Tiny; list it and move on.

### F2.4 — Reduce-motion path: CONFIRMED (correct)
`useLeafFold.ts:24-31` — reduced forces `flapScaleX=1` (no fold) and paper from 0.18 (vs 0.12 full), `paperScale` reduced uses `smooth(v)` full-range — same as demo `reduced` branches. Durations 240/200 match. Three-layer adaptation (duration, geometry, content timing) intact.

### F2.5 — Flap back-face swap via JS state has frame lag vs demo: PLAUSIBLE NIT
Demo swaps `flapPath.setAttribute("fill", sx<0 ? "var(--leafBack)" : "url(#gBodyR)")` per-frame on the same thread as the transform. RN splits: transform is UI-thread (`flapStyle`), colors are React state (`useLeafFold.ts:79-83`):
```ts
() => flapScaleX(progress.value, reduceSv.value) < 0,
(back, prev) => { if (back !== prev) runOnJS(setShowBack)(back); },
```
Around the sx=0 crossing there is an inherent 1–2 frame window where the flipped flap shows the previous face's colors (front gradient while already mirrored, or vice versa). Visually a brief flash at the crease cross. Demo doesn't have this hop. Cheap fix: render both faces (front-colored LeafHalf + overlaying back-colored LeafHalf driven by an animated opacity threshold) instead of state-swapping props.

### F2.6 — Close-completion unmount race: CONFIRMED SAFE (verified, not hand-waved)
`useLeafFold.ts:65-76` — close callback fires only `if (finished)`. When a re-open replaces the running close, Reanimated invokes the cancelled animation's callback with `finished=false` → no `setMounted(false)`. Ordering of a queued `runOnJS(setMounted)(false)` vs a later re-open effect is safe: the completion is dispatched from UI before a subsequent tap can be processed, so `setMounted(false)` executes before the re-open effect re-sets it to `true`. No lost drawer, no unmount-while-open. **No finding.**

### F2.7 — `runOnJS(setShowBack)`/`runOnJS(setContentLive)` after unmount: CONFIRMED NIT (prior nit 3.6, still present, still minor)
`useLeafFold.ts:79-89` — no unmount guard on either reaction. Reachable only when the *parent* unmounts the Drawer mid-anim (fontScaleId remount at `AppShell.tsx:5279`, or app teardown). React 18 makes setState-on-unmounted a no-op; no crash. Keep as accepted-risk nit; a `mountedRef` guard would silence it for free.

### F2.8 — Font-scale remount while open re-plays the whole fold: CONFIRMED NIT (intentional but jarring)
`AppShell.tsx:5279` — `key={fontScaleId}`. On scale change with the drawer open, the new instance initializes `mounted=open` and `progress=0` (`useLeafFold.ts:39`), then animates 0→1 over 1400ms — the drawer visually re-folds and re-opens. The `AppShell.tsx:5043` comment documents the remount intent, not the re-animation. Nit: seed `progress` with `open ? 1 : 0` on first effect run, or skip the animation when remounting while open.

---

## Angle 3 — transformOrigin, SVG ids, crease alignment

### F3.1 — transformOrigin is now a 2-tuple everywhere: CONFIRMED FIXED
`Drawer.tsx:81` — `style={[styles.fill, { transformOrigin: [originX, originY] }, fold.paperStyle]}`
`LeafPaper.tsx:100` — `style={[StyleSheet.absoluteFill, { transformOrigin: [foldX, height / 2] }, flapStyle]}`
Both prior 3-tuples are gone. This is the documented 2-value form. Prior finding 3.1 closed.

### F3.2 — Unfold origin drifts from the real menu button: PLAUSIBLE BUG
`Drawer.tsx:62-69`
```tsx
const MENU_HIT = 36;
const MODEL_BAR_BODY = 48;
const NAV_ROW = 48;
...
const originX = spacing.md + MENU_HIT / 2;
const originY = insets.top + MODEL_BAR_BODY + NAV_ROW / 2;
```
- `originX` is exact: the ChatNavBar menu button sits at `paddingHorizontal: spacing.md (14)` with `width: 36` → center x = 32 = 14 + 18 (`AiChatPage.tsx:4546-4557`). ✓
- `NAV_ROW = 48` exact: inner nav row `height: 48`, `alignItems:"center"`, button 36 → center offset 24 (`AiChatPage.tsx:4548-4552`). ✓
- `MODEL_BAR_BODY = 48` is **wrong-ish and not stable**: the AppShell model bar is content-sized, not fixed 48 (`AppShell.tsx:5055-5059`: `paddingTop: insets.top + 4, paddingBottom: 2`; children: title `bodyMd` lineHeight 22 (`typography.ts:119-123`) + chip Pressable `paddingVertical: 3` + `monoXs` lineHeight 15 (`AppShell.tsx:5139`)). Idle height ≈ 4+22+21+2 = **49** (1px off), and it grows:
  - download progress bar adds `height:4 + marginBottom: spacing.xs(6)` = +10px (`AppShell.tsx:5168-5180`),
  - `modelError` text row adds ~16+6 = +22px (`AppShell.tsx:5182-5195`),
  - at fontScale xl (1.3) the idle bar is ≈62px → +14px.
  During download/error states (and always at xl) the unfold therefore scales from a point 10–22px above the actual menu-button center. Visual-only, transient, but it's the one geometric anchor the whole fold hangs off, and it's a magic constant pretending to be a measurement.
**Fix direction:** measure the model-bar height (onLayout → context) or at least compute it from the same typography constants; don't hardcode 48.

### F3.3 — Crease position vs fold axis: prior finding 3.4 REFUTED (my re-check of the prior audit)
Prior audit claimed the crease is 1.5px off the fold axis. Wrong — it confused the bar's left edge with its center:
`LeafPaper.tsx:125-130`
```tsx
{
  position: "absolute",
  left: foldX - 1.5,
  top: height * (70 / LEAF_VB_H),
  width: 3,
  height: height * (640 / LEAF_VB_H),
```
Bar center = `foldX - 1.5 + 1.5 = width/2`. Fold axis in screen space = `(LEAF_FOLD_X/LEAF_VB_W)·width = (195/390)·width = width/2` (axis is the clip edge `M 195 42 L 195 794 …`, `leafPath.ts:26-27`). **Exactly centered.** Demo does the identical thing: `#edge{ … left:193.5px … }` = 195 − 1.5 on a 390 stage. Prior finding 3.4 is a misread. **REFUTED — no defect.**

### F3.4 — Flap origin hardcoded to width/2 instead of the fold-axis token: CONFIRMED NIT
`LeafPaper.tsx:82` — `const foldX = width / 2;` and `:100` uses it as the flap transform origin. Correct *only* because `LEAF_FOLD_X (195) === LEAF_VB_W/2` — a coincidence nothing asserts. `leafPath.ts:12-13`:
```ts
export const LEAF_FOLD_X = 195;
export const LEAF_FOLD_Y = 400;
```
**Both constants are dead exports** (grep across `src/`: zero consumers outside leafPath.ts). If anyone nudges `LEAF_FOLD_X` or reshapes `LEAF_D`, the flap mirror axis and the crease silently de-sync from the SVG silhouette. Fold them together: `const foldX = (LEAF_FOLD_X / LEAF_VB_W) * width` (and delete `LEAF_FOLD_Y` or use it).

### F3.5 — Hardcoded SVG clip/gradient IDs: prior nit 3.2 still present: CONFIRMED NIT
`LeafPaper.tsx:91-107` — `clipId="leafClipL"`, `gradId="leafGradL"`, `clipId="leafClipR"`, `gradId="leafGradR"`. Document-global SVG ids; safe only because exactly one LeafPaper exists. Any second instance (future overlay drawer, two-theme preview) collides silently. `useId()` exists for exactly this. Unfixed from prior audit.

### F3.6 — Flap path differs from demo's separate flapPath: PLAUSIBLE NIT
Demo's `#flapPath` uses bottom control points `C 255 790, 220 792, 195 794 / C 170 792, 135 790, 80 765` — deliberately *lower* than the base's `785/785` (`leaf-fold-v9.html`), i.e. the flap sags a hair past the base to overlap the seam. RN renders `LEAF_D` for **both** halves (`LeafPaper.tsx:63` `d={LEAF_D}` in the shared LeafHalf; `leafPath.ts:16-24` uses 785) → the two halves abut exactly at x=foldX with zero overlap. On Android's anti-aliased SVG edges that can show a hairline backdrop-colored seam down the crease at full open. ~5 viewBox units of difference; possibly invisible on device — verify on hardware; if a seam shows, reintroduce the demo's overlap.

### F3.7 — Crease/shade rest state: CONFIRMED (correct)
`creaseStyle`/`shadeStyle` (`useLeafFold.ts:119-135`) both go to opacity 0 as sx→±1 (`edgeAmt = 1-|sx|`), and at v=0 the `motion` term is 0. Satisfies the constraint's "Leave decorative veins/midrib when open: Do NOT" — crease exists only mid-fold. ✓

### F3.8 — Shade gradient deviates from demo: CONFIRMED NIT
`LeafPaper.tsx:112-118`
```tsx
<LinearGradient
  colors={["rgba(0,0,0,0.35)", "transparent"]}
  start={{ x: 0, y: 0 }}
  end={{ x: 1, y: 0 }}
```
vs demo `#flapShade`: `background:linear-gradient(90deg, var(--shade) 0%, transparent 55%)` with `--shade: rgba(10,32,24,.32)` light / `rgba(0,0,0,.45)` dark. Three divergences: (a) single hardcoded neutral 0.35 for both themes vs theme-aware demo values (light demo is green-tinted and *lighter* 0.32; dark demo is *heavier* 0.45); (b) RN fades linearly across the full half-width while demo holds ~solid until 55% then falls off — RN's shade is visibly wider/softer at the crease; (c) not a palette token at all. The gradient *direction* (dark at flap-local left = crease side, mirrored correctly when flipped) is right in both.

### F3.9 — Crease missing the demo's glow: CONFIRMED NIT
Demo `#edge{ … box-shadow:0 0 6px rgba(0,0,0,.2); }`. RN crease (`LeafPaper.tsx:120-132`) is a bare 3px rounded bar — no shadow. Minor parity loss on a transient element; list or drop deliberately.

### F3.10 — SVG stroke distortion under non-uniform viewBox stretch: CONFIRMED NIT (accepted)
`LeafPaper.tsx:47-48` — `viewBox="0 0 390 800"` with `preserveAspectRatio="none"` stretched to e.g. 390×844 scales strokes non-uniformly (vertical ~1.055×). Same technique as the demo on its fixed stage; sub-pixel on all real devices. Accepted, listed for completeness.

---

## Angle 4 — Races: pointerEvents, backdrop, Modal

### F4.1 — pointerEvents gating correct, `box-none` layering correct: CONFIRMED (solid)
`Drawer.tsx:80` paper container `pointerEvents="box-none"`; `LeafPaper` root and all its layers `pointerEvents="none"` (`LeafPaper.tsx:69,80,111,122`); content gated `Drawer.tsx:93`. Net: pre-live taps pass through to the backdrop Pressable → close; while live, taps on leaf padding consume and don't close — identical to demo (`#onleaf` pointer-events auto captures its padding too). **Solid.**

### F4.2 — Backdrop is tappable for the entire open animation (demo gates at v>0.05): CONFIRMED NIT
`Drawer.tsx:75-76` — backdrop Pressable has no progress gating. Demo: `backdrop.style.pointerEvents = v>0.05 ? "auto" : "none"`. In RN the Modal means nothing exists beneath to receive "passed-through" taps, so there is no functional difference — but the asymmetry vs demo is real and the tap-to-cancel path is a hair more eager. List as documentation-grade nit.

### F4.3 — Android hardware back during open/close: CONFIRMED (correct)
`Drawer.tsx:73` — `onRequestClose={onClose}`. During close, `onClose` is a no-op state-wise (drawerOpen already false; effect deps unchanged → close animation not restarted). During open, back replaces with a clean close-from-current. ✓

### F4.4 — Modal unmount gating: CONFIRMED (correct)
`Drawer.tsx:71` — `if (!fold.mounted) return null;` after all hooks; Modal exists only during the fold lifecycle; `visible` (bare = true) is safe because unmount is driven by `mounted`. ✓

---

## Angle 5 — Double-close / callback contracts

### F5.1 — Persona double-close removed: CONFIRMED FIXED
`DrawerContent.tsx:76` — `onPress={onPersonaPress}` — the `onClose()` after-call is gone (prior 1.5). AppShell's handler still self-closes (`AppShell.tsx:5296-5300`: `Keyboard.dismiss(); setDrawerOpen(false); setActiveOverlay({kind:"personas"})`). Prior bug closed.

### F5.2 — But the fix created an asymmetric, undocumented contract: CONFIRMED BUG (contract)
Now persona is the **only** row that must close the drawer *itself*; every other row closes via `DrawerContent`:
- new-chat: `DrawerContent.tsx:136-139` `onPress={() => { onNewChat(); onClose(); }}`
- conversation: `DrawerContent.tsx:166-170` `item.onPress(); onClose();`
- tools: `DrawerContent.tsx:211-214` `onPress(); onClose();`
`onPersonaPress`'s type is `() => void` — nothing in the Props contract says "you must close the drawer inside this callback". A future consumer passing a handler that only opens an overlay leaves the drawer open under it. Meanwhile the three other paths keep the *opposite* implicit contract ("handler must NOT close; the drawer closes itself") — and indeed the AppShell tool handlers **do** self-close (`AppShell.tsx:2262,2273,2283,2293`: `setDrawerOpen(false)` inside each tool's onPress), producing a redundant double `setDrawerOpen(false)` on every tool/chat/new-chat press (harmless — React batches — but it is the exact pattern just excised from persona, one fix and four survivors).
**Fix direction (pick one and document it):** restore `onClose()` inside DrawerContent for persona (and strip `setDrawerOpen(false)` from AppShell's persona handler), or strip self-closes from all four AppShell tool handlers and document "handlers must not close the drawer; drawer closes itself" — except persona stays parent-closed. Consistency > which side wins.

### F5.3 — Search clear-on-close contract: CONFIRMED (correct)
`AppShell.tsx:5281-5284` — `onClose={() => { setDrawerOpen(false); setChatSearch(""); }}`. Since every row path funnels through `onClose()` (persona via its own handler + overlay — note: **persona does not clear search**; the drawer unmounts anyway and chatSearch persists — hmm: `onPersonaPress` does NOT call Drawer's onClose, so `setChatSearch("")` never runs on the persona path. Residual search text survives into the next drawer open. Minor UX wart; list as nit bundled with F5.2's contract cleanup.)

### F5.4 — Overlay-exclusivity on tool presses: CONFIRMED (correct)
`AppShell.tsx:2258-2296` — each tool dismisses keyboard, closes drawer, opens its exclusive overlay. Comment at `AppShell.tsx:5230-5237` documents miniapp policy. No conflict with drawer close ordering (all synchronous, batched). ✓

### F5.5 — handleSwitchConversation early-return still closes: CONFIRMED (correct)
`AppShell.tsx:2076-2085` — both early returns (`!id`, same activeId) call `setDrawerOpen(false)` before returning. All paths of new-chat/delete close. ✓

---

## Angle 6 — Security, secrets, memory leaks

### F6.1 — No secrets/console logging: CONFIRMED (clean)
Grep across all scoped files: zero `console.*`, zero `log(`, no credential-ish identifiers. Only imports are theme/UI tokens. **Clean.**

### F6.2 — AccessibilityInfo subscription cleanup: CONFIRMED (correct)
`useLeafFold.ts:47-54`
```ts
AccessibilityInfo.isReduceMotionEnabled().then(apply);
const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", apply);
return () => sub.remove();
```
`sub.remove()` in cleanup; `reduceSv` is stable; dep array `[reduceSv]` correct. **No leak.**

### F6.3 — `.isReduceMotionEnabled().then(apply)` without `.catch`: CONFIRMED NIT
`useLeafFold.ts:50` — a rejected promise (exotic Android/TV/web backends) = unhandled rejection. One `.catch(() => {})` away from bulletproof.

### F6.4 — Shared-value writes after unmount are safe: CONFIRMED (no finding)
The `apply` callback only writes `reduceRef.current`/`reduceSv.value` — no setState — so late resolution is harmless.

---

## Angle 7 — Edge cases

### F7.1 — Empty chats: CONFIRMED (correct)
`DrawerContent.tsx:134` `Array.isArray(conversationItems)`; empty array → header + empty ScrollView, no crash (`:164` map only when `showConversations`). AppShell always supplies ≥1 meta (`AppShell.tsx:2236`), so the truly-empty state is defensive only. ✓

### F7.2 — Missing callbacks: CONFIRMED (correct)
`onPersonaPress` gate `DrawerContent.tsx:75` (`{onPersonaPress ? … : null}`); `onSearchChange` gate `:104`; `onNewChat` gate `:134`. All optional props degrade cleanly. `items` is required (non-optional) so its unguarded `.map` is fine. ✓

### F7.3 — Font scale remount: CONFIRMED (works; see F2.8 for the re-fold animation nit)
`typography.ts:186-199` mutates the live singleton in place, so static-import reads in DrawerContent do pick up new sizes after the `key={fontScaleId}` remount. ✓

### F7.4 — Brand text doesn't scale: CONFIRMED NIT
`DrawerContent.tsx:67` — `<Text style={[typography.displayMd, { color: colors.ink, fontSize: 20 }]}>{brand}</Text>`. The hardcoded `fontSize: 20` override defeats the font-scale machinery (`applyFontScale` rescales `displayMd.fontSize` 18→23.4 at xl, but the inline 20 wins). Every other drawer string grows at xl; the brand doesn't. Either drop the override (demo brand is 20px at scale 1; displayMd is 18 — that's *why* the override exists) or scale it: `fontSize: 20 * fontScale`.

### F7.5 — Keyboard vs bottom tools: PLAUSIBLE NIT
No keyboard-avoidance inside the Modal; on Android, typing in search can cover the tools block (which sits at the drawer bottom). Demo is keyboardless so this is uncharted; on-device check needed. If it bites: `KeyboardAvoidingView` inside the Modal or scroll-on-focus.

### F7.6 — Empty search results have no feedback: CONFIRMED NIT
`filterConversations` ("Non-empty query whose tokens were all dropped → includes match on title + searchBlob") can still yield zero items; the drawer then shows the "Chats" header and a blank scroll region — no "no results" row. Demo is static so no parity reference; pure UX gap.

### F7.7 — Landscape: REFUTED (non-issue)
`app.config.js:5` — `orientation: "portrait"`. The proportional-squash concern is moot.

### F7.8 — Search input polish: CONFIRMED NIT (bundle)
`DrawerContent.tsx:105-126` — `returnKeyType="search"` with no `onSubmitEditing` (dead action), no `textContentType="search"`, no `clearButtonMode`, no `keyboardAppearance` (dark mode keyboard follows OS, fine — but explicitness is cheap). Also the demo search row has a magnifier icon; RN has a bare TextInput. All micro; listed.

### F7.9 — i18n keys: CONFIRMED (present)
`drawer.personas`/`personaNone`/`toolsSection`/`searchChats`/`newChat`/`chats`/`untitled`/`subtitle`/`account`/`deleteChat` all exist in `src/i18n/en.ts`/`it.ts` (verified lines 37-46 etc.). ✓

---

## Angle 8 — Props contract + edge swipe

### F8.1 — Props surface unchanged: CONFIRMED (solid)
`Drawer.tsx:14-38` — same 11 props as pre-A1; `index.ts:8` export unchanged; single consumer `AppShell.tsx:5278-5301`. No new required props. ✓

### F8.2 — Edge swipe fully gone: CONFIRMED (solid)
Grep `AppShell.tsx` for `Gesture|GestureDetector|Pan|edgeSwipe|swipe|ReanimatedSwipe`: **zero hits**. Sole opener is `AppShell.tsx:5244` — `onMenuPress={() => setDrawerOpen(true)}`. All 15 `setDrawerOpen(false)` sites (2079, 2083, 2116, 2120, 2145, 2164, 2196, 2262, 2273, 2283, 2293, 2804, 5282, 5298 + close in handler list) are tap/flow-driven. Constraint "Keep edge-swipe open (tap-only): Do NOT" satisfied. ✓

### F8.3 — Accessibility roles patchy: CONFIRMED NIT
`DrawerContent.tsx:77` persona has `accessibilityRole="button"`; new-chat (`:140`), conversation rows (`:167-170`), and tool rows (`:211`) have labels at best, no role — VoiceOver announces them without the "button" trait. Backdrop Pressable (`Drawer.tsx:76`) has **no label at all** and spans the screen — the only focusable element while content is non-live. Add roles + `accessibilityLabel={t("common.close")}`-style label on the backdrop.

---

## Angle 9 — Dead code / unused tokens

### F9.1 — Dead exports `LEAF_FOLD_X`/`LEAF_FOLD_Y`: CONFIRMED NIT
See F3.4. Zero consumers; also a fragility (axis coincidence unasserted). Delete or wire up.

### F9.2 — Drawer.tsx constants all used: CONFIRMED (no dead code)
`MENU_HIT`/`MODEL_BAR_BODY`/`NAV_ROW` feed originX/originY (`Drawer.tsx:66-69`); all imports used in every scoped file (checked individually). Prior audit's "no dead imports" stands except the leafPath constants above.

### F9.3 — leafVein tokens still missing from palettes: CONFIRMED MISSING (acceptable)
`palettes.js:78-83` (light) and `:145-150` (dark) contain only `leafBody`, `leafBodyDeep`, `leafBack`, `leafStroke`, `leafTile`, `leafTileActive`; `palettes.d.ts:54-59` types exactly those six. The spec's `leafVein`/`leafVeinGlow`/`leafOutline`/`leafCrease` were never added. **Acceptable:** the fold design has no veins; outline+crease re-use `leafStroke`. But the divergence should be written down in the spec, not left as silent drift. (Note `leafStroke` dark `rgba(136,192,208,0.4)` is the demo's *cyan* — it reads as an outline tint, fine.)

### F9.4 — Palette values match demo exactly: CONFIRMED (solid)
Light: `#DCEFE2 / #A8D0B8 / #6FA88A / #6A9A7C / rgba(255,255,255,0.55) / 0.82` == demo `--leaf1/--leaf2/--leafBack/--leafStroke/--tile/--tileActive`. Dark: `#2C6750 / #174032 / #0E2A20 / rgba(136,192,208,0.4) / rgba(0,0,0,0.28) / 0.42` == demo `.dark` block. Exact.

### F9.5 — Backdrop color hardcoded, matches neither theme: CONFIRMED BUG (small)
`Drawer.tsx:76`
```tsx
<Pressable onPress={onClose} style={[styles.fill, { backgroundColor: "rgba(0,0,0,0.45)" }]} />
```
Demo: light `--backdrop: rgba(0,0,0,.42)`, dark `rgba(0,0,0,.55)`. RN hardcodes a single neutral 0.45 for both themes — bypassing the palette system *and* matching neither reference value. Should be a `colors.backdrop`-style token (new) at minimum, ideally with the demo's two values.

---

## Prior-nit re-check table

| Prior finding | Status now |
|---|---|
| 3.1 transformOrigin 3-tuple | **FIXED** — 2-tuples at `Drawer.tsx:81`, `LeafPaper.tsx:100` |
| 1.5 persona double-close | **FIXED** — `DrawerContent.tsx:76` (but see F5.2 contract asymmetry; 4 other double-close sites remain) |
| 3.4 crease 1.5px offset | **REFUTED** — prior audit misread bar-left-edge as bar-center; bar is exactly centered on the fold axis (F3.3) |
| 3.2 hardcoded SVG IDs | **STILL PRESENT** — `LeafPaper.tsx:91-107` (F3.5) |
| 3.6 runOnJS post-unmount | **STILL PRESENT** — `useLeafFold.ts:79-89`, React 18 no-op (F2.7) |
| 9.2 leafVein tokens missing | **STILL MISSING** — acceptable, document it (F9.3) |
| 4.2 "RN 0.88 more conservative than demo 0.65" | **REFUTED (prior audit error)** — demo's 0.65 is on `late`, i.e. v>0.897; RN's 0.88 is slightly *more permissive* (F2.3) |

---

## What's solid (so the fix list isn't all doom)

- Fit padding is a byte-exact port of the demo's 138/34/92 with sane proportional scaling (F1.1).
- Every per-frame animation formula, threshold, and duration matches v11.1 exactly (F2.1); reduce-motion adaptation is three-layer and correct (F2.4).
- Races I tried to break — close-completion vs re-open, back-button during anim, backdrop during anim — are all safe by construction (F2.6, F4.3, F4.4).
- Edge swipe eradicated; props contract unchanged; empty/missing-callback cases guarded; no leaks; no secrets.
- Palette values are an exact match to the demo in both themes.

---

## Ordered fix list

**Blockers:** none found. (No crash, no data-loss, no security, no leak. F1.4/F3.2 are the closest calls.)

**Bugs (fix in this order):**

1. **F3.2** — Unfold origin `MODEL_BAR_BODY=48` is a magic constant for a content-sized model bar; drifts 1px idle, +10px during download, +22px during error, +14px at fontScale xl. `Drawer.tsx:66-69` + `AppShell.tsx:5055-5059`. Measure or compute.
2. **F5.2** — Callback contract asymmetry: persona must self-close, everything else must not; four double-close sites remain (`AppShell.tsx:2262,2273,2283,2293`). Pick one contract, enforce it, document it in Props. Also fix persona path not clearing `chatSearch` (F5.3).
3. **F9.5** — Backdrop color hardcoded `rgba(0,0,0,0.45)`, bypasses palette, matches neither demo value (0.42 light / 0.55 dark). `Drawer.tsx:76`.
4. **F2.2** — Open/close easing replaced with stock cubic vs the demo's tuned staged curves — the fold's character differs from the locked reference. `useLeafFold.ts:62,69`.
5. **F1.4** — Vertical fit can overflow the leaf band at fontScale xl on ~667px-tall screens (subtitle+search+new-chat case ≈675px > 667px). `DrawerContent.tsx` fixed-row stack.
6. **F3.6** — Flap reuses `LEAF_D` so the halves abut exactly where the demo deliberately overlapped them (785 vs 790 control points) — potential 1px crease seam on Android at full open. `LeafPaper.tsx:63`.
7. **F4.5(n)** — Modal sets `statusBarTranslucent` but not `navigationBarTranslucent` (`Drawer.tsx:73`): Android edge-to-edge bottom-band behavior unverified; the leaf's bottom padding math depends on it. Verify on device; add if the paper doesn't reach the nav-bar edge.

**Nits (all of them):**

8. F3.5 — hardcoded `leafClipL/R`, `leafGradL/R` SVG ids (`LeafPaper.tsx:91-107`) — useId().
9. F3.4/F9.1 — dead `LEAF_FOLD_X`/`LEAF_FOLD_Y` + `width/2` hardcoding the axis coincidence (`leafPath.ts:12-13`, `LeafPaper.tsx:82,100,126`).
10. F2.7 — unguarded `runOnJS(setShowBack)`/`runOnJS(setContentLive)` post-unmount (`useLeafFold.ts:79-89`) — add mountedRef guard.
11. F2.5 — back-face color swap via JS state lags the UI-thread flip by 1–2 frames (flash at sx≈0 crossing) (`useLeafFold.ts:79-83`).
12. F2.3 — contentLive threshold 0.88 vs demo-equivalent 0.897; taps enable at ~56% content opacity (`useLeafFold.ts:87`).
13. F2.8 — font-scale remount while open replays the 1400ms fold from zero (`AppShell.tsx:5279`, `useLeafFold.ts:39`).
14. F3.8 — shade gradient hardcoded `rgba(0,0,0,0.35)` linear-to-100% vs demo's themed 0.32/0.45 holding to 55% (`LeafPaper.tsx:112-118`).
15. F3.9 — crease missing demo's `box-shadow: 0 0 6px rgba(0,0,0,.2)` glow (`LeafPaper.tsx:120-132`).
16. F7.4 — brand `fontSize: 20` hardcoded, doesn't scale with fontScale (`DrawerContent.tsx:67`).
17. F8.3 — missing `accessibilityRole="button"` on new-chat/conversation/tool rows; unlabeled full-screen backdrop Pressable (`DrawerContent.tsx:140,167,211`, `Drawer.tsx:76`).
18. F7.6 — empty search results: no "no results" feedback row (`DrawerContent.tsx:164` region).
19. F7.8 — search input: `returnKeyType="search"` with no `onSubmitEditing`, no `textContentType`, no `clearButtonMode`, no magnifier icon vs demo (`DrawerContent.tsx:105-126`).
20. F6.3 — `isReduceMotionEnabled().then(apply)` without `.catch` (`useLeafFold.ts:50`).
21. F4.2 — backdrop tappable from progress 0 vs demo's v>0.05 gate (`Drawer.tsx:75-76`).
22. F3.10 — non-uniform viewBox stretch distorts SVG strokes ~5% vertically; accepted, note it (`LeafPaper.tsx:47-48`).
23. F9.3 — leafVein/leafVeinGlow/leafOutline/leafCrease tokens still absent from palettes; acceptable, but write the divergence into the spec (`palettes.js:78-83,145-150`).
24. F5.3 — persona path leaves residual `chatSearch` (bundle with #2).
25. F7.5 — no keyboard avoidance; tools can be covered while typing search on Android (`Drawer.tsx` Modal) — verify on device.
26. Cosmetic parity micro-nits, listed for completeness: persona dot is flat `colors.accent` vs demo's accent→cyan gradient dot; divider lacks the demo's 2px horizontal inset (`DrawerContent.tsx:205`); "›" chevron is a text glyph not an icon (`DrawerContent.tsx:99`); drawer content text uses global `ink`/`muted` rather than the demo's leaf-tuned `tink`/`cmuted` tints.

*End of report. Files read in full: Drawer.tsx, DrawerContent.tsx, LeafPaper.tsx, leafPath.ts, useLeafFold.ts, AppShell.tsx (drawer sections 2071-2305, 4990-5310, 5225-5310), palettes.js, palettes.d.ts, typography.ts, tokens, AiChatPage.tsx (ChatNavBar), ConversationsStore.ts, leaf-fold-v9.html, A1-LEAF-FIT-CONSTRAINT.md.*
