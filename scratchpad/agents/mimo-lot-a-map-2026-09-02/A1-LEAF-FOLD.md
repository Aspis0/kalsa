# A1-LEAF-FOLD: Leaf Fold Drawer — Implementation Mapping

**Explorer:** mimo (read-only scout)  
**Date:** 2026-09-02  
**Repo:** `/Users/marco/Projects/kalsa` · branch `feat/moe-stream` · HEAD `cb238a3`  
**Concept:** Leaf Fold Drawer — origami-unfolding drawer that morphs into the Neural-leaf brand mark  
**Owner spec:** Tap-only trigger (no edge swipe), content invariant, surface morphs

---

## 0. Leaf Geometry Reference (from `assets/icon.png`)

The Neural-leaf mark is a **single closed oval leaf** (NOT lobated):

| Feature | Geometry |
|---------|----------|
| Body | Elliptical, tilted ~35° from horizontal |
| Stem | Short curve, bottom-left, ~8% of leaf length |
| Tip | Acuminate (sharp), top-right |
| Midrib | Central vein from stem to tip, slight curve |
| Neural veins | Branching cyan lines from midrib, glowing |
| Outline | Dark navy stroke around the body |
| Colors | Body: dark green (#1F5F4E light / #07101C dark), Veins: cyan (#2E6E80 light / #88c0d0 dark), Outline: navy (#17201C light / ~#0a0f13 dark) |

The drawer silhouette target is this exact leaf shape — a **single cubic-bezier closed oval + stem**, not a rectangle or multi-lobed form.

---

## 1. Drawer.tsx: What Stays, What Goes

### Props Contract (MUST remain identical)

| Prop | Type | Source in AppShell |
|------|------|--------------------|
| `open` | `boolean` | `AppShell.tsx:5289` — `open={drawerOpen}` |
| `onClose` | `() => void` | `AppShell.tsx:5291-5293` — `() => { setDrawerOpen(false); setChatSearch(""); }` |
| `brand` | `string?` | `AppShell.tsx:5294` — `brand="Kalsa"` |
| `subtitle` | `string?` | `AppShell.tsx:5295` — `subtitle={t("drawer.subtitle")}` |
| `items` | `DrawerItem[]` | `AppShell.tsx:5296` — 4 items (Settings, Account, Documents, Notes) |
| `conversationItems` | `DrawerConversationItem[]?` | `AppShell.tsx:5297` — filtered conversation list |
| `searchValue` | `string?` | `AppShell.tsx:5298` — `searchValue={chatSearch}` |
| `onSearchChange` | `(q: string) => void` | `AppShell.tsx:5299` — `onSearchChange={setChatSearch}` |
| `onNewChat` | `() => void` | `AppShell.tsx:5300` — `onNewChat={handleNewConversation}` |
| `personaLabel` | `string?` | `AppShell.tsx:5301-5305` — resolved persona name |
| `onPersonaPress` | `() => void` | `AppShell.tsx:5306-5309` — opens persona overlay |

**All 12 `setDrawerOpen` call sites in AppShell.tsx remain untouched:**

| Line | Context | Call |
|------|---------|------|
| 2073 | State declaration | `useState(false)` |
| 2080 | `handleSwitchConversation` — same conversation | `setDrawerOpen(false)` |
| 2084 | `handleSwitchConversation` — switch | `setDrawerOpen(false)` |
| 2117 | `handleNewConversation` — empty chat | `setDrawerOpen(false)` |
| 2121 | `handleNewConversation` — in-flight guard | `setDrawerOpen(false)` |
| 2146 | `handleNewConversation` — after bind | `setDrawerOpen(false)` |
| 2165 | `handleNewConversation` — empty after recheck | `setDrawerOpen(false)` |
| 2197 | `handleDeleteConversation` | `setDrawerOpen(false)` |
| 2260 | `edgeSwipe.onStart` — **TO BE REMOVED** | `setDrawerOpen(true)` |
| 2269 | `drawerItems[settings].onPress` | `setDrawerOpen(false)` |
| 2280 | `drawerItems[account].onPress` | `setDrawerOpen(false)` |
| 2290 | `drawerItems[documents].onPress` | `setDrawerOpen(false)` |
| 2300 | `drawerItems[notes].onPress` | `setDrawerOpen(false)` |
| 2811 | Overlay transition | `setDrawerOpen(false)` |
| 5252 | `onMenuPress` — hamburger tap | `setDrawerOpen(true)` ← **SOLE REMAINING ENTRY** |
| 5291 | `Drawer onClose` prop | `setDrawerOpen(false)` |
| 5307 | `onPersonaPress` | `setDrawerOpen(false)` |

### What Stays in Drawer.tsx

| Element | Lines | Reason |
|---------|-------|--------|
| `Modal` wrapper | `Drawer.tsx:74` | `visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent` — handles Android back button. MUST keep. |
| Backdrop `Pressable` | `Drawer.tsx:75` | `onPress={onClose}` with `rgba(0,0,0,0.45)` — dismiss on tap outside. MUST keep. |
| `useSafeAreaInsets()` | `Drawer.tsx:48` | Top/bottom safe area padding. MUST keep. |
| All inner content | `Drawer.tsx:86-328` | Brand header, divider, conversations (search + list + new-chat), tools section, persona selector — **completely invariant**. |
| Props types | `Drawer.tsx:18-38` | `DrawerItem`, `DrawerConversationItem`, `Props` — unchanged. |
| `useLabTheme` / `useLocale` | `Drawer.tsx:46-47` | Theme + i18n access. Keep. |

### What Gets Replaced

| Element | Lines | Replacement |
|---------|-------|-------------|
| `Animated.Value` (translateX, opacity) | `Drawer.tsx:52-53` | `useSharedValue(0)` — single progress `0→1` |
| `Animated.timing` open/close | `Drawer.tsx:55-66` | `withSpring(progress)` or `withTiming(progress)` |
| `[mounted, setMounted]` state | `Drawer.tsx:54` | Driven by `progress` shared value (keep mounted while `progress > 0`) |
| `Animated.View` (backdrop opacity) | `Drawer.tsx:75` | `useAnimatedStyle` with `opacity: progress` |
| `Animated.View` (drawer panel) | `Drawer.tsx:76-82` | SVG `<ClipPath>` morph + animated content reveal |
| `GlassPanel2` background | `Drawer.tsx:85` | Replaced by leaf-shaped SVG fill OR kept as clipped content background |
| `DRAWER_WIDTH` / `DURATION` | `Drawer.tsx:28-29` | Removed — morph is progress-driven, not width-driven |

---

## 2. Morph Geometry: Three Phases

### Phase Model

The animation is a single `progress: SharedValue<number>` from `0 → 1` (open) or `1 → 0` (close). Three visual phases overlap within this progress:

| Phase | Progress Range | Visual |
|-------|---------------|--------|
| **A: Origami unfold** | 0.00 → 0.40 | Rectangular accordion unfolds from trigger point |
| **B: Edge softening** | 0.30 → 0.70 | Sharp edges round, gradient overlay fades creases |
| **C: Leaf morph** | 0.50 → 1.00 | Silhouette → oval leaf + stem; neural veins fade in; content appears |

### Phase A: Origami Unfold (0.00 → 0.40)

**Concept:** A vertical accordion of 4-6 rectangular "faces" unfolds from the menu icon position (top-left). Each face is a gradient-shaded rectangle that rotates around a shared hinge axis, like paper unfolding.

**Implementation:**

```
Face layout (progress=0): all faces stacked at trigger point, zero width
Face layout (progress=0.2): faces partially unfolded, visible as accordion
Face layout (progress=0.4): faces fully flat = full-width rectangle
```

Each face is a `View` with:
- `width: interpolate(progress, [0, 0.4], [0, DRAWER_WIDTH])` 
- `transform: [{ rotateY: interpolate(progress, [0, 0.4], [Math.PI/2, 0]) }]`
- Gradient overlay: `LinearGradient` (or `expo-linear-gradient`) from lighter top to darker bottom per face, simulating light hitting paper folds

**Face count:** 4 faces (manageable, good fold density)

**Hinge axis:** Vertical, left edge of each face (pivot at `x=0`)

**SVG path for this phase:** NOT needed — pure `View` transforms with `useAnimatedStyle`. The rectangle is just `borderRadius: interpolate(progress, [0.3, 0.7], [0, LEAF_RADIUS])` to prepare for Phase B.

### Phase B: Edge Softening (0.30 → 0.70)

**Concept:** The flat rectangle's sharp corners round progressively. A gradient overlay simulates crease shadows fading.

**Implementation:**

```tsx
const cornerRadius = useDerivedValue(() =>
  interpolate(progress.value, [0.3, 0.7], [0, LEAF_CORNER_RADIUS], Extrapolation.CLAMP)
);

const creaseOpacity = useDerivedValue(() =>
  interpolate(progress.value, [0.3, 0.6], [0.3, 0], Extrapolation.CLAMP)
);
```

- `borderRadius` on the content container animates from 0 → large value (~60-80 on a 280px wide panel)
- Gradient "crease" lines (horizontal `View` with `LinearGradient` from transparent → shadow → transparent) fade out
- This is purely cosmetic — the container is still rectangular but with rounded corners

### Phase C: Leaf Morph (0.50 → 1.00)

**Concept:** The rounded rectangle morphs into the leaf silhouette via SVG clip path interpolation. Neural veins fade in. Content becomes visible only after leaf shape is ~80% formed.

**SVG Leaf Path Definition:**

The leaf is defined as a closed cubic Bezier path. To enable interpolation, BOTH the "rectangle" and "leaf" paths must have the **same number of control points**.

**Path strategy:** Define both shapes as cubic Bezier paths with 8 curve segments (8 × 3 = 24 control points + 1 start = 25 points total). This gives enough fidelity for the oval leaf shape while keeping the rectangle recognizable.

**Leaf path (normalized 0-1 viewBox, tilted oval):**

```
M 0.50 0.95          // stem bottom
C 0.48 0.92, 0.42 0.88, 0.38 0.82   // stem curve left
C 0.22 0.60, 0.15 0.40, 0.18 0.25   // left bulge lower
C 0.22 0.10, 0.35 0.02, 0.50 0.00   // left bulge upper → tip approach
C 0.65 0.02, 0.78 0.10, 0.82 0.25   // right bulge upper
C 0.85 0.40, 0.78 0.60, 0.62 0.82   // right bulge lower
C 0.58 0.88, 0.52 0.92, 0.50 0.95   // stem curve right
Z
```

**Rectangle path (same 8 segments, mapped to rectangular bounds):**

```
M 0.50 1.00          // stem bottom (bottom-center)
C 0.50 1.00, 0.00 1.00, 0.00 1.00   // → bottom-left
C 0.00 1.00, 0.00 0.50, 0.00 0.00   // → top-left
C 0.00 0.00, 0.00 0.00, 0.50 0.00   // → top-center
C 1.00 0.00, 1.00 0.00, 1.00 0.00   // → top-right
C 1.00 0.00, 1.00 0.50, 1.00 1.00   // → bottom-right
C 1.00 1.00, 0.50 1.00, 0.50 1.00   // → bottom-center
Z
```

**Interpolation function:**

```tsx
// Linear interpolation between two paths with matching control point counts
function interpolatePath(
  from: number[][],  // flat array of [x,y] pairs
  to: number[][],
  t: number,
): string {
  const points = from.map((p, i) => [
    p[0] + (to[i][0] - p[0]) * t,
    p[1] + (to[i][1] - p[1]) * t,
  ]);
  // Reconstruct SVG path d attribute
  return `M ${points[0][0]} ${points[0][1]} ` +
    points.slice(1).map((p, i) => {
      if (i % 3 === 0) return `C ${p[0]} ${p[1]}`;
      return `${p[0]} ${p[1]}`;
    }).join(' ') + ' Z';
}
```

**Clip path animation:**

```tsx
const clipPath = useDerivedValue(() => {
  const t = interpolate(progress.value, [0.5, 1.0], [0, 1], Extrapolation.CLAMP);
  return interpolatePath(rectPath, leafPath, t);
});
```

Rendered as:

```tsx
<Svg width={DRAWER_WIDTH} height={SCREEN_HEIGHT} style={StyleSheet.absoluteFill}>
  <Defs>
    <ClipPath id="leafClip">
      <Path d={clipPath.value} />  {/* animated via Reanimated */}
    </ClipPath>
  </Defs>
  <G clipPath="url(#leafClip)">
    {/* Content container here */}
  </G>
</Svg>
```

**⚠️ Critical Reanimated + SVG caveat:** `react-native-reanimated` 4.5.1 does NOT directly animate `d` attribute of `<Path>`. Two approaches:

1. **Option A (recommended):** Use `useDerivedValue` to compute the path string on the JS thread, then pass to `<Path d={pathString}>`. This runs on JS thread (not native) but path computation is ~25 arithmetic ops — negligible. Set `.value` trigger via shared value.

2. **Option B:** Use `react-native-reanimated`'s `interpolate` on individual numeric values, then build the `d` string in `useAnimatedStyle`. Same JS-thread cost.

3. **Option C (avoid):** SVG SMIL animation — not supported in react-native-svg.

**Neural veins fade-in:**

```tsx
const veinOpacity = useDerivedValue(() =>
  interpolate(progress.value, [0.7, 1.0], [0, 1], Extrapolation.CLAMP)
);
```

Rendered as a static SVG layer inside the clip path, with `opacity={veinOpacity.value}`.

**Content reveal:**

Content (conversations, tools, persona) is wrapped in a `View` with:

```tsx
const contentOpacity = useDerivedValue(() =>
  interpolate(progress.value, [0.75, 1.0], [0, 1], Extrapolation.CLAMP)
);

const contentStyle = useAnimatedStyle(() => ({
  opacity: contentOpacity.value,
}));
```

Content is ONLY visible once the leaf shape is ~75% formed. This prevents text from appearing in a half-morphed state.

---

## 3. Animation Driver: Reanimated 4.5.1

### Decision: Migrate from `Animated` to `Reanimated`

**Justification:**

| Factor | `Animated` (current) | `Reanimated` 4.5.1 |
|--------|---------------------|---------------------|
| Path interpolation | Not possible (native driver can't compute SVG `d`) | `useDerivedValue` computes on JS thread, renders on native |
| Shared value between components | Requires prop drilling | `useSharedValue` + `useDerivedValue` within same component |
| Spring physics | `Animated.spring` available | `withSpring` with configurable damping/stiffness |
| Worklet support | No | Yes (for future gesture-driven animations) |
| Existing usage in codebase | `Drawer.tsx` only | `AiChatPage.tsx:25-27,804-816`, `Pill.tsx:6-63` — **already used** |
| Performance | Good for simple opacity/translate | Better for complex derived values |

**Migration path:** Replace `Animated.Value` + `Animated.timing` + `Animated.parallel` with `useSharedValue` + `withSpring`/`withTiming` + `useDerivedValue` + `useAnimatedStyle`.

### Animation Parameters

```tsx
// Open animation
const openAnimation = () => {
  'worklet';
  progress.value = withSpring(1, {
    damping: 18,      // slightly underdamped for organic feel
    stiffness: 120,   // moderate speed
    mass: 0.8,        // light — snappy response
  });
};

// Close animation
const closeAnimation = () => {
  'worklet';
  progress.value = withTiming(0, {
    duration: 280,     // slightly longer than open for gentle fold-back
    easing: Easing.inOut(Easing.cubic),
  });
};
```

### Re-render Safety

| Concern | Mitigation |
|---------|-----------|
| Path string recomputation | `useDerivedValue` only recomputes when `progress.value` changes — no React re-render |
| Content opacity | `useAnimatedStyle` returns animated style — no re-render |
| SVG `<Path d={}>` | `d` is a prop on RN SVG component — Reanimated's `useAnimatedStyle` can drive it via `animatedProps` or direct `.value` read in `useDerivedValue` |
| Memoization | The path arrays (`rectPath`, `leafPath`) are module-level constants — no allocation per frame |

**Estimated per-frame cost:** ~25 floating-point multiplications for path interpolation + 1 SVG render. Well under 1ms on modern devices. No shadow/blur on the path itself (blur is on the content background via GlassPanel2).

---

## 4. Stem Anchor: Two Variants

### Leaf Geometry in Screen Coordinates

The drawer occupies the left portion of the screen. The leaf is ~280px wide (matching current `DRAWER_WIDTH`) and ~500-600px tall (covering most of the screen height).

### Variant A: Stem at Menu Icon (Top-Left)

```
Screen layout:
┌─────────────────────────────┐
│ [☰] ·····                   │  ← menu icon at (~16, ~52)
│      ·  ╱‾‾‾‾‾‾‾‾‾‾╲       │
│     ·  ╱   LEAF BODY  ╲     │  ← leaf hangs DOWN-RIGHT from icon
│    ·  ╱                 ╲   │
│   ·  ╱                   ╲  │
│  ·  ╱                     ╲ │
│ ·  ╱_______________________╲│
│  ·                           │
│  stem                        │
└─────────────────────────────┘
```

| Aspect | Assessment |
|--------|-----------|
| Trigger position | Top-left, where hamburger icon already is (`AiChatPage.tsx:4545`) |
| Leaf orientation | Stem at top-left, body hangs down-right (mirrored vs logo) |
| Thumb reach | GOOD — thumb naturally rests near bottom-right; leaf body covers that zone |
| Content layout | Leaf is widest at mid-height — conversation list (tallest content) fits naturally |
| Layout impact | Leaf extends ~280px right + ~600px down from icon. Must not overlap status bar. |
| Stem visual | Small curved stem at top-left — subtle, decorative |

### Variant B: Stem at Left Edge (Side-Anchored)

```
Screen layout:
┌─────────────────────────────┐
│         ·                   │  ← leaf tip at top-right
│        ╱ ╲                  │
│       ╱   ╲                 │
│      ╱     ╲                │  ← leaf body fills left side
│     ╱       ╲               │
│    ╱    LEAF  ╲             │
│   ╱     BODY   ╲            │
│  ╱               ╲          │
│ ╱_________________╲         │
│  ·                          │
│  stem at bottom-left        │
└─────────────────────────────┘
```

| Aspect | Assessment |
|--------|-----------|
| Trigger position | Hamburger icon at top-left, but stem anchors at bottom-left edge |
| Leaf orientation | Matches logo exactly — stem bottom-left, tip top-right |
| Thumb reach | WORSE — stem at bottom-left is hard to reach; leaf body is high |
| Content layout | Leaf tip at top wastes space; widest part is mid-to-low |
| Layout impact | Same bounding box as Variant A |
| Stem visual | More prominent, matches logo identity exactly |

### Recommendation: **Variant A (Stem at Menu Icon)**

**Rationale:**
1. **Trigger proximity:** Stem visually connects to the menu icon that triggered it — intuitive cause-effect
2. **Thumb reach:** Leaf body hangs toward the thumb zone (bottom-right of left-hand hold)
3. **Content flow:** Widest part of leaf aligns with conversation list (tallest content block)
4. **Layout safety:** Stem at top avoids conflict with bottom safe area insets
5. **Animation origin:** The origami unfolds FROM the trigger point — natural visual flow

**Variant B is recommended only if** brand identity (exact logo match) is prioritized over ergonomics. This is a decision for the owner.

---

## 5. Content Layout Inside the Leaf Oval

### Bounding Box

The leaf is clipped to an oval ~280px wide × ~550px tall (from `Drawer.tsx:28` `DRAWER_WIDTH = 280` scaled to screen height). Content must fit within this clipped region.

### Safe Padding from Curved Edge

The leaf's curved edges cut into rectangular content. Maximum inset from the oval boundary:

```tsx
const LEAF_PADDING = {
  top: 60,     // stem region + tip clearance
  bottom: 40,  // stem base
  left: 24,    // left curve
  right: 24,   // right curve (most aggressive cut)
};
```

Content container:

```tsx
<View style={{
  flex: 1,
  paddingTop: LEAF_PADDING.top,
  paddingBottom: LEAF_PADDING.bottom,
  paddingHorizontal: LEAF_PADDING.right, // symmetric
}}>
  {/* All content here */}
</View>
```

### Content Zones (Top → Bottom)

| Zone | Content | Height | Leaf Width at Zone |
|------|---------|--------|-------------------|
| **Header** | Brand name "Kalsa" + subtitle | ~50px | ~200px (near tip) |
| **Divider** | 1px line | 1px | ~200px |
| **Search** | "Chats" label + search input | ~60px | ~240px (widening) |
| **New Chat** | Button row | ~44px | ~260px |
| **Conversation List** | ScrollView (flex: 1) | Variable | ~270px (near widest) |
| **Divider** | 1px line | 1px | ~260px |
| **Tools** | "Tools" label + 4 items | ~220px | ~240px (narrowing) |
| **Persona** | Persona selector row | ~48px | ~200px (near stem) |

### ScrollView Behavior

```tsx
<ScrollView
  style={{ flex: 1 }}
  contentContainerStyle={{
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  }}
  keyboardShouldPersistTaps="handled"
>
  {/* Conversation items */}
</ScrollView>
```

- `flex: 1` — takes remaining space between header and tools
- `keyboardShouldPersistTaps="handled"` — allows tapping items while keyboard is open
- Content is already scrollable (`Drawer.tsx:143-168`)

### Keyboard Open

The leaf oval does NOT change shape when keyboard opens. The `Modal` with `transparent` + `animationType="none"` already overlays the keyboard. Content scrolls within the leaf.

**Safe area insets:** `Drawer.tsx:48` `useSafeAreaInsets()` provides `insets.top` and `insets.bottom`. The leaf's top padding accounts for the status bar; bottom padding accounts for home indicator.

### Long Lists

If conversation list exceeds available height, `ScrollView` scrolls within the leaf clip. The curved edges at top/bottom may clip the first/last items — mitigated by `paddingVertical` in `contentContainerStyle`.

---

## 6. Edge-Swipe Removal

### All Points to Modify

| File:Line | What | Action |
|-----------|------|--------|
| `AppShell.tsx:52` | `import { Gesture, GestureDetector } from "react-native-gesture-handler"` | **Remove import** — no other usage in AppShell |
| `AppShell.tsx:2255-2260` | `const edgeSwipe = Gesture.Pan().activeOffsetX(24).failOffsetY([-15,15]).hitSlop({left:0,width:48}).runOnJS(true).onStart(() => setDrawerOpen(true))` | **Delete entire block** (6 lines) |
| `AppShell.tsx:5059` | `<GestureDetector gesture={edgeSwipe}>` | **Remove wrapper** — replace with `<React.Fragment>` or remove the tag |
| `AppShell.tsx:5285` | `</GestureDetector>` | **Remove closing tag** |
| `AppShell.tsx:5252` | `onMenuPress={() => setDrawerOpen(true)}` | **KEEP** — sole remaining entry point |
| `AppShell.tsx:842` (comment) | `// ── Conversations index (swipe drawer)` | **Update comment** to remove "swipe" reference |

### Dependency Verification

| Check | Result |
|-------|--------|
| `edgeSwipe` referenced elsewhere? | **NO** — only defined at 2255, used at 5059/5285 |
| `Gesture`/`GestureDetector` used elsewhere in AppShell? | **NO** — import can be removed |
| Other code depends on `edgeSwipe`? | **NO** — it's a local `const`, not exported |
| `react-native-gesture-handler` still needed? | **YES** — other files may import it. AppShell's import line can be removed, but the package stays in `package.json` |
| `onMenuPress` still passed? | **YES** — `AppShell.tsx:5252` |

**Total removal:** ~10 lines (import cleanup + 6-line gesture definition + 2 JSX tags + 1 comment update)

---

## 7. Palette: Leaf Colors in Light/Dark

### Color Mapping from `assets/icon.png`

| Element | Icon Color | Light Theme Token | Dark Theme Token |
|---------|-----------|-------------------|------------------|
| Leaf body (dark green) | ~#1F5F4E | `accent: "#1F5F4E"` (palettes.js:47) | `accent: "#f07a3f"` — **MISMATCH** (dark accent is orange) |
| Neural veins (cyan) | ~#2E6E80 | `cyan: "#2E6E80"` (palettes.js:53) | `cyan: "#88c0d0"` (palettes.js:98) |
| Outline (navy) | ~#17201C | `ink: "#17201C"` (palettes.js:22) | `ink: "#f7f3ed"` — **INVERTED** (dark ink is light) |
| Background (dark) | ~#07101C | N/A | `shell: "#07101C"` (palettes.js:89) |

### Proposed New Tokens

Add to `palettes.js` (both light and dark `colors` objects):

```js
// Light theme — add after line 58 (after plotNs):
leafBody: "#1F5F4E",       // dark green, same as accent
leafVein: "#2E6E80",       // cyan, same as cyan token
leafVeinGlow: "rgba(46, 110, 128, 0.35)",  // translucent cyan for glow
leafOutline: "#17201C",    // navy, same as ink
leafCrease: "rgba(23, 32, 28, 0.08)",      // subtle fold shadow

// Dark theme — add after line ~115 (after plotNs):
leafBody: "#0B1727",       // dark navy (panelSolid), NOT orange accent
leafVein: "#88c0d0",       // lighter cyan for dark bg
leafVeinGlow: "rgba(136, 192, 208, 0.30)",
leafOutline: "#0a0f13",    // near-black (chrome bg)
leafCrease: "rgba(255, 255, 255, 0.06)",   // subtle fold shadow on dark
```

### Palette Type Update

Add to `src/theme/palettes.d.ts`:

```ts
leafBody: string;
leafVein: string;
leafVeinGlow: string;
leafOutline: string;
leafCrease: string;
```

### Why NOT Hardcode PNG Colors

The PNG (`assets/icon.png`) is a raster — its exact pixel colors vary with compression. The tokens above are **semantic extractions** that match the brand intent (dark green body, cyan veins) while being palette-consistent. The SVG leaf path uses these tokens, not pixel-sampled values.

---

## 8. Accessibility + Reduce Motion

### Trigger Accessibility

| Attribute | Value | File:Line |
|-----------|-------|-----------|
| `accessibilityRole` | `"button"` | `AiChatPage.tsx:4549` — already on Menu pressable |
| `accessibilityLabel` | `t("chat.a11yMenu")` = `"Menu"` | `AiChatPage.tsx:4548` |
| `accessibilityHint` | Add: `"Opens navigation drawer"` | **NEW** — add to Menu pressable |

### Drawer Content Accessibility

All existing a11y attributes are preserved (they're in the invariant content):

| Element | a11y | File:Line |
|---------|------|-----------|
| Search input | `accessibilityLabel={t("drawer.searchChats")}` | `Drawer.tsx:119` |
| New chat button | `accessibilityLabel={t("drawer.newChat")}` | `Drawer.tsx:128` |
| Conversation items | `accessibilityLabel={item.title}`, `accessibilityState={{selected}}` | `Drawer.tsx:149-150` |
| Tool items | Implicit via `Pressable` | `Drawer.tsx:191` |
| Persona button | `accessibilityRole="button"`, `accessibilityLabel={t("drawer.personas")}` | `Drawer.tsx:215-216` |

### Reduce Motion

```tsx
import { AccessibilityInfo } from 'react-native';

// In LeafDrawer component:
const [reduceMotion, setReduceMotion] = useState(false);

useEffect(() => {
  AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
  return () => sub.remove();
}, []);

// Animation selection:
const openAnimation = () => {
  'worklet';
  if (reduceMotion) {
    // Fallback: simple fade + slide (no morph)
    progress.value = withTiming(1, { duration: 200 });
  } else {
    progress.value = withSpring(1, { damping: 18, stiffness: 120, mass: 0.8 });
  }
};
```

**Reduced-motion fallback:** Skip the origami + morph phases. Use a simple fade-in (`opacity: 0→1`) with a subtle slide from left (`translateX: -40→0`). Content appears immediately (no delayed reveal). This is a ~15-line addition.

### Screen Reader Flow

1. User focuses Menu button → hears "Menu" + "Opens navigation drawer"
2. User taps → drawer opens → focus moves to first focusable element in drawer (search input or first conversation)
3. User navigates through conversations, tools, persona
4. User taps backdrop or presses Back → drawer closes → focus returns to Menu button

**Focus management:** Add `accessibilityViewIsModal={true}` to the drawer container `View` (replacing `Modal`'s default behavior if needed). The existing `Modal` with `onRequestClose` already handles this on Android.

---

## 9. File Plan

### New File: `src/theme/components/LeafDrawer.tsx`

| Section | Est. Lines | Content |
|---------|-----------|---------|
| Imports | 15 | React, Reanimated, SVG, theme, i18n, tokens |
| Path constants | 40 | `rectPath`, `leafPath` arrays (25 points each), `interpolatePath` function |
| `interpolatePath` | 20 | Linear interpolation of control points |
| Component definition | 10 | `export function LeafDrawer(props: Props)` — same `Props` type as current Drawer |
| Shared values | 8 | `progress`, `reduceMotion` state |
| Animation callbacks | 20 | `openAnimation`, `closeAnimation` (worklets) |
| `useEffect([open])` | 12 | Trigger open/close based on `open` prop |
| Phase A: Origami faces | 35 | 4 `View` faces with `useAnimatedStyle` for rotateY + width |
| Phase B: Edge softening | 15 | `borderRadius` animation + crease gradient fade |
| Phase C: Leaf morph | 25 | SVG clip path interpolation + vein opacity |
| Content container | 40 | Same content as current Drawer (invariant), wrapped in animated clip |
| Reduced-motion fallback | 15 | Simple fade+slide variant |
| **Total** | **~255** | |

### Fate of Current `Drawer.tsx`

| Option | Recommendation |
|--------|---------------|
| **Rewrite in-place** | **YES** — rename `Drawer.tsx` → keep filename, replace implementation. The export name `Drawer` stays, all import sites unchanged. |
| Keep old as `LegacyDrawer.tsx` | Not needed — no A/B testing planned |
| Delete | After LeafDrawer.tsx is verified working |

**Migration strategy:**
1. Create `LeafDrawer.tsx` as new file
2. Update `src/theme/components/index.ts` to export `LeafDrawer as Drawer`
3. Verify all AppShell imports resolve
4. Delete old `Drawer.tsx` content, replace with re-export or rename

Actually, simpler: **rewrite `Drawer.tsx` in-place.** The export signature is identical. No import changes needed anywhere.

### `src/theme/components/index.ts`

Check current export:

```bash
grep -n 'Drawer' src/theme/components/index.ts
```

If `Drawer` is re-exported from `index.ts`, the in-place rewrite means zero import changes.

### Test Status

| Check | Result |
|-------|--------|
| Existing tests for Drawer? | **NONE** — grep found zero `.test.*` files referencing Drawer |
| Existing tests for AiChatPage? | **NONE** |
| Existing tests for AppShell? | **NONE** |
| Regression risk from test breakage | **ZERO** |

### Regression Risk from 12 Call-Sites

| Risk | Mitigation |
|------|-----------|
| Props contract change | **NONE** — props type is identical |
| `setDrawerOpen` behavior change | **NONE** — still boolean open/close |
| `onClose` callback semantics | **NONE** — backdrop tap + Android back still call `onClose` |
| `key={fontScaleId}` on Drawer | **NONE** — component remounts on font scale change, same behavior |
| `onRequestClose` on Modal | **NONE** — Android back still triggers close |

**Total regression risk: VERY LOW** — the external interface is completely preserved.

---

## 10. Performance

### Per-Frame Cost Breakdown

| Operation | Thread | Est. Cost |
|-----------|--------|-----------|
| `interpolatePath` (25 points × 2 coords) | JS (via `useDerivedValue`) | ~0.02ms |
| SVG `<Path d={}>` render | Native (RN SVG) | ~0.3ms |
| 4 origami face `useAnimatedStyle` | UI (Reanimated worklet) | ~0.05ms each = 0.2ms |
| `borderRadius` interpolation | UI | ~0.01ms |
| Vein opacity | UI | ~0.01ms |
| Content opacity | UI | ~0.01ms |
| GlassPanel2 (opaque mode) | Native | ~0.1ms (no BlurView) |
| **Total per frame** | | **~0.7ms** |

At 60fps, each frame has ~16.7ms budget. 0.7ms is **4% of frame budget** — negligible.

### Potential Performance Pitfalls

| Pitfall | Risk | Mitigation |
|---------|------|-----------|
| SVG re-render on every progress change | LOW — RN SVG is optimized for small paths | Single `<Path>` element, no nested SVGs |
| Shadow/blur on leaf path | **AVOID** — drop shadows on curved SVG paths are expensive | Use `GlassPanel2 opaque` mode (no BlurView). Add shadow via a separate `View` with `shadow*` props if needed. |
| 4 origami face views | LOW — simple `View` transforms | Use `collapsable` prop if needed |
| `useDerivedValue` JS thread | LOW — 25 multiplications | Could move to worklet if needed, but not necessary |
| Memory: path arrays | NEGLIGIBLE — 25 `[x,y]` pairs × 2 paths = 100 floats | Module-level constants, no allocation |

### Optimization Notes

- `GlassPanel2` MUST use `opaque={true}` (like current Drawer at `Drawer.tsx:85`) — opaque mode skips `BlurView` entirely (`GlassPanel2.tsx:40-55`)
- The SVG clip path is a single `<Path>` — no complex SVG tree
- Origami faces are plain `View`s with `transform` — Reanimated handles these on UI thread
- Content inside the clip is standard React Native layout — no SVG involved

---

## 11. Risks + Design Decisions for Owner

### Decisions Required

| Decision | Options | Recommendation |
|----------|---------|---------------|
| **Stem anchor** | A: At menu icon (top-left) vs B: At left edge (side) | **A** — better ergonomics, natural trigger-to-content flow |
| **Leaf body color** | Use existing `accent` token (#1F5F4E) vs new dedicated token | **New `leafBody` token** — allows future brand evolution without breaking accent |
| **Neural veins** | Show during morph (phase C) vs only when fully open | **During morph** (fade in 0.7→1.0) — gives organic "awakening" feel |
| **Animation duration** | Spring (damping 18, stiffness 120) ≈ 400ms vs fixed timing 350ms | **Spring** — more organic, auto-adjusts to device performance |
| **Origami face count** | 4 faces vs 6 faces | **4** — sufficient density, less visual noise |
| **Content reveal timing** | At 75% morph vs 100% morph | **75%** — content appears as leaf shape is recognizable, avoids "pop" at end |
| **Reduced-motion** | Simple fade+slide vs disable entirely | **Simple fade+slide** — still provides visual feedback |

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|-----------|
| SVG path interpolation jank on low-end devices | Medium | Low | Fallback to simple fade+slide (reduced-motion path covers this) |
| Leaf shape doesn't match brand expectations | High | Medium | Owner review of SVG path at progress=1.0 before merge |
| Content clipped by leaf curves on small screens | Medium | Medium | Test on iPhone SE (375px) — increase `LEAF_PADDING` if needed |
| Android `Modal` + SVG clip interaction | Low | Low | Modal is already used with SVG in BrandIcon — no known issues |
| Stem anchor looks disconnected from menu icon | Low | Medium | Variant A anchors stem AT the icon — visual connection is built-in |
| 12 `setDrawerOpen` call-sites break | **ZERO** | **NONE** | Props contract is identical — verified exhaustively |

### Estimated Effort

| Task | Lines | Risk |
|------|-------|------|
| `LeafDrawer.tsx` (new) | ~255 | Medium — SVG path definition needs visual tuning |
| `palettes.js` + `palettes.d.ts` | ~12 | Low |
| `AppShell.tsx` edge-swipe removal | ~10 | Very low |
| `AiChatPage.tsx` a11y hint | ~2 | Very low |
| **Total** | **~279** | **Medium** — concentrated in leaf path geometry |

---

## Files Read

| File | Lines | Purpose |
|------|-------|---------|
| `src/theme/components/Drawer.tsx` | 1-329 | Current drawer — full component, all state/animations/content |
| `src/app/AppShell.tsx` | 2073,2255-2260,5059,5285-5308 | Drawer state, edge swipe, GestureDetector wrapper, Drawer rendering |
| `src/screens/AiChatPage.tsx` | 4517-4558 | ChatNavBar — menu icon trigger, a11y labels |
| `src/theme/components/GlassPanel2.tsx` | 1-70 | Glass panel — opaque mode, BlurView usage |
| `src/theme/palettes.js` | 1-144 | Full light + dark palette — all color tokens |
| `src/theme/palettes.d.ts` | 1-110 | Palette type definitions |
| `src/theme/tokens.ts` | 1-50 | Spacing, radius, shadows |
| `src/theme/icons/BrandIcon.tsx` | 1-250 | SVG icon system — react-native-svg usage patterns |
| `src/theme/components/QuickActionSheet.tsx` | 1-82 | Alternative sheet pattern — Modal + GlassPanel2 |
| `assets/icon.png` | 1024×1024 PNG | Neural-leaf mark — visual reference for path definition |
| `app.config.js` | 7-9 | Brand icon comment — "Neural-leaf mark" |
| `src/engine/regenState.ts` | 1-101 | Shared state (not touched by A1) |
