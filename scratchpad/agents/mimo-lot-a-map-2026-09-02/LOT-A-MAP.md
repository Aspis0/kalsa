# LOT-A: Chat UI — Deep Mapping Report

**Explorer:** mimo (read-only scout)  
**Date:** 2026-09-02  
**Repo:** `/Users/marco/Projects/kalsa` · branch `feat/moe-stream` · HEAD `cb238a3`  
**Baseline:** idea-scout 2026-09-02 report (`/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/idea-scout-2026-09-02/LOT-A-chat-ui.md`)

---

## A1. Menu: Half-Moon Lateral / Circular Central (Both Variants)

### 1. Current Drawer Infrastructure

#### State Management (AppShell.tsx)

| Concept | File:Line | Detail |
|---------|-----------|--------|
| `drawerOpen` state | `AppShell.tsx:2073` | `useState(false)` — sole source of truth for drawer visibility |
| `setDrawerOpen(true)` triggers | `AppShell.tsx:2260` | `edgeSwipe.onStart(() => setDrawerOpen(true))` — pan gesture from left edge |
| `setDrawerOpen(true)` — button | `AppShell.tsx:5252` | `onMenuPress={() => setDrawerOpen(true)}` — ChatNavBar menu icon |
| `setDrawerOpen(false)` calls | `AppShell.tsx:2080,2084,2117,2121,2146,2197,2269,2280,2290,2300,2811,5291` | 12 call sites: switch conversation, new conversation, delete, drawer item press, persona press, overlay open |
| `drawerItems` (tools) | `AppShell.tsx:2261-2308` | `useMemo` — 4 items: Settings, Account, Documents, Notes. Each calls `Keyboard.dismiss()` → `setDrawerOpen(false)` → `setActiveOverlay(...)` |
| `drawerConversationItems` | `AppShell.tsx:2235-2260` | `useMemo` — filtered conversations list with search, active highlighting, long-press delete |
| `chatSearch` state | `AppShell.tsx:2074` (inferred) | `useState("")` — drives conversation search in drawer |

#### Drawer Component (Drawer.tsx)

| Concept | File:Line | Detail |
|---------|-----------|--------|
| Component definition | `Drawer.tsx:39` | `export function Drawer({...})` — named export |
| Width constant | `Drawer.tsx:28` | `const DRAWER_WIDTH = 280` |
| Animation duration | `Drawer.tsx:29` | `const DURATION = 220` (ms) |
| Animation engine | `Drawer.tsx:8-9` | `Animated` from `react-native` — **NOT** Reanimated. Uses `Easing.out(Easing.cubic)` / `Easing.in(Easing.cubic)` |
| Open animation | `Drawer.tsx:55-58` | `Animated.parallel([translateX 0→DRAWER_WIDTH, opacity 0→1])` — slide from left |
| Close animation | `Drawer.tsx:59-66` | `Animated.parallel([translateX → -DRAWER_WIDTH, opacity → 0])` — slide back left |
| Overlay (backdrop) | `Drawer.tsx:75` | `<Pressable onPress={onClose}>` with `backgroundColor: "rgba(0,0,0,0.45)"` |
| Container | `Drawer.tsx:76-82` | `Animated.View` with `position: absolute, top/bottom: 0, left: 0, width: DRAWER_WIDTH` |
| BackHandler (Android) | `Drawer.tsx:74` | `onRequestClose={onClose}` on `<Modal>` — Android back button triggers close |
| Safe area insets | `Drawer.tsx:48` | `useSafeAreaInsets()` — `paddingTop: insets.top, paddingBottom: insets.bottom` on GlassPanel2 |
| GlassPanel2 | `Drawer.tsx:85` | `opaque` variant with `rounded="lg"`, but `borderRadius: 0` override |
| Conversations section | `Drawer.tsx:97-169` | ScrollView with search TextInput, new-chat button, conversation list |
| Tools section | `Drawer.tsx:171-221` | Static items (Settings/Account/Documents/Notes) + Persona selector |
| Props | `Drawer.tsx:31-38` | `open, onClose, brand, subtitle, items, conversationItems?, searchValue?, onSearchChange?, onNewChat?, personaLabel?, onPersonaPress?` |

#### Menu Trigger (AiChatPage → AppShell)

| Concept | File:Line | Detail |
|---------|-----------|--------|
| ChatNavBar definition | `AiChatPage.tsx:4517-4618` | `React.memo(function ChatNavBar({colors, t, onMenuPress, onExport, onNewChat}))` |
| Menu icon (hamburger) | `AiChatPage.tsx:4545-4558` | `<Menu size={20} color={colors.ink} />` — lucide-react-native `Menu` icon, 36×36 pressable |
| `onMenuPress` prop threading | `AiChatPage.tsx:3750` | `<ChatNavBar onMenuPress={onMenuPress}` — received from AppShell |
| AppShell passes callback | `AppShell.tsx:5252` | `onMenuPress={() => setDrawerOpen(true)}` |

#### Edge Swipe Gesture (AppShell.tsx)

| Concept | File:Line | Detail |
|---------|-----------|--------|
| Gesture definition | `AppShell.tsx:2255-2260` | `Gesture.Pan()` from `react-native-gesture-handler` |
| `activeOffsetX(24)` | `AppShell.tsx:2256` | Requires 24px horizontal movement before activating |
| `failOffsetY([-15, 15])` | `AppShell.tsx:2257` | Vertical scroll within ±15px cancels the gesture |
| `hitSlop({ left: 0, width: 48 })` | `AppShell.tsx:2258` | Only from left edge, 48px hit zone |
| `runOnJS(true)` | `AppShell.tsx:2259` | Executes on JS thread (not UI thread) |
| `onStart` → open | `AppShell.tsx:2260` | `onStart(() => setDrawerOpen(true))` |
| GestureDetector wrapping | `AppShell.tsx:~5240` | `<GestureDetector gesture={edgeSwipe}>` wraps the entire chat page content |

#### Drawer Rendering in AppShell

| Concept | File:Line | Detail |
|---------|-----------|--------|
| `<Drawer>` usage | `AppShell.tsx:5287-5308` | Props: `open={drawerOpen}`, `onClose={() => setDrawerOpen(false); setChatSearch("")}`, `brand="Kalsa"`, `subtitle={t("drawer.subtitle")}`, `items={drawerItems}`, `conversationItems={drawerConversationItems}`, search/newChat/persona props |

### 2. Existing Components in `src/theme/components/` (Reusable Animation Primitives)

#### QuickActionSheet.tsx

| Concept | File:Line | Detail |
|---------|-----------|--------|
| Definition | `QuickActionSheet.tsx:16` | `export function QuickActionSheet({visible, onClose, onAction})` |
| Animation | `QuickActionSheet.tsx:33` | `animationType="slide"` — RN built-in Modal slide animation |
| No Reanimated | — | Uses only RN `Modal` + `Pressable` + `View` + `Text` |
| Pattern | — | Bottom sheet with action rows (New Chat, Web Search, New Miniapp, Open Last) |
| GlassPanel2 | `QuickActionSheet.tsx:39` | Same glass panel pattern as Drawer |
| Safe area | `QuickActionSheet.tsx:29` | `useSafeAreaInsets()` for bottom padding |

#### Toolbar.tsx

| Concept | File:Line | Detail |
|---------|-----------|--------|
| Definition | `Toolbar.tsx:9` | `export function Toolbar({children, position, style})` |
| Purpose | — | Simple horizontal row container with optional top/bottom border |
| No animation | — | Pure layout component |

#### ActionRow.tsx

| Concept | File:Line | Detail |
|---------|-----------|--------|
| Definition | `ActionRow.tsx:16` | `export function ActionRow({disabled, leading, onPress, subtitle, style, title, trailing})` |
| Pattern | — | Pressable row with leading icon, title, subtitle, trailing chevron |
| Uses Surface | `ActionRow.tsx:28` | `<Surface variant="subtle">` component |
| No animation | — | Pure layout + press opacity |

#### Reusable Animation Patterns Found

| Pattern | File:Line | Library |
|---------|-----------|---------|
| `Animated.timing` + `Easing` | `Drawer.tsx:55-66` | `react-native` built-in `Animated` |
| `useSharedValue` + `useAnimatedStyle` | `AiChatPage.tsx:25-27,804-816` | `react-native-reanimated` 4.5.1 |
| `withTiming` opacity pulse | `Pill.tsx:42-63` | `react-native-reanimated` |
| `Gesture.Pan()` edge swipe | `AppShell.tsx:2255` | `react-native-gesture-handler` 2.32.0 |
| `Svg, Path, Rect` | `BrandIcon.tsx:12` | `react-native-svg` 15.15.4 |
| `GlassPanel2` opaque panel | `Drawer.tsx:85`, `QuickActionSheet.tsx:39` | Custom component — `src/theme/components/GlassPanel2.tsx` |

### 3. i18n Keys (Drawer/Menu)

| Key | en.ts Line | it.ts (mirrors) |
|-----|-----------|-----------------|
| `drawer.subtitle` | en.ts:35 | ✓ |
| `drawer.toolsSection` | en.ts:36 | ✓ |
| `drawer.chats` | en.ts:37 | ✓ |
| `drawer.newChat` | en.ts:38 | ✓ |
| `drawer.searchChats` | en.ts:39 | ✓ |
| `drawer.untitled` | en.ts:40 | ✓ |
| `drawer.deleteChat` | en.ts:41 | ✓ |
| `drawer.deleteChatConfirm` | en.ts:42 | ✓ |
| `drawer.notes` | en.ts:43 | ✓ |
| `drawer.personas` | en.ts:44 | ✓ |
| `drawer.personaNone` | en.ts:45 | ✓ |
| `drawer.account` | en.ts:46 | ✓ |
| `chat.a11yMenu` | en.ts:495 | ✓ |
| `quickActions.*` | en.ts:59-63 | ✓ |

### 4. Blast Radius & Hidden Couplings

| Concern | Detail |
|---------|--------|
| **Gesture conflict — Android back** | `Drawer.tsx:74`: Modal `onRequestClose={onClose}` handles Android hardware back. A new circular/half-moon menu must also handle `BackHandler` or use a Modal with `onRequestClose`. Currently no explicit `BackHandler.addEventListener` in AiChatPage (grep: 0 results) |
| **Gesture conflict — Android edge swipe** | `AppShell.tsx:2255-2260`: `Gesture.Pan().hitSlop({left:0, width:48})` from `react-native-gesture-handler`. Android 10+ system back gesture uses ~20dp zones from screen edges. The 48px hit zone may conflict. RN GestureHandler 2.32.0 `exclusionRect` API is limited to 200dp and documented as fragile. |
| **Gesture conflict — iOS swipe-back** | iOS edge swipe (navigation pop) can conflict with a left-edge pan gesture. The `activeOffsetX(24)` threshold mitigates but doesn't eliminate. |
| **Keyboard interaction** | `Drawer.tsx` opens via Modal — keyboard is visible when user taps hamburger. `Drawer.tsx:189`: no explicit `Keyboard.dismiss()` in Drawer itself; callers in `drawerItems` do `Keyboard.dismiss()` before `setDrawerOpen(false)`. A new menu must handle keyboard state. |
| **Safe area insets** | `Drawer.tsx:48`: `useSafeAreaInsets()` for top/bottom padding. Any new menu needs the same. |
| **Reanimated 4.5.1 availability** | `AiChatPage.tsx:25-27` imports `useAnimatedStyle, useSharedValue` from `react-native-reanimated`. Available project-wide. Can be used for new animations. |
| **GestureHandler 2.32.0 availability** | `AppShell.tsx:52` imports `Gesture, GestureDetector` from `react-native-gesture-handler`. Available project-wide. |
| **react-native-svg 15.15.4** | `BrandIcon.tsx:12` imports `Svg, Path, Rect`. Available for SVG path-based curved shapes. |
| **No existing tests** | Zero test files reference Drawer, ChatNavBar, ComposerActionRow, MessageActionChip, AttachSheetRow, or QuickActionSheet. No tests to break. |
| **AppShell coupling** | Drawer state (`drawerOpen`, `setDrawerOpen`) lives in AppShell. Both variants require modifying AppShell's state management + the Drawer component. |

### 5. Variant A: Half-Moon Lateral

#### Concept
Replace the rectangular left-sliding drawer with a drawer whose right edge is a **curved SVG path** (half-moon / crescent shape). The drawer still slides from the left, but the visible edge is concave rather than a straight vertical line.

#### Architecture

```
AppShell.tsx
  └── drawerOpen state (unchanged)
  └── <Drawer> component (rewritten)
       └── GlassPanel2 background (reused)
       └── SVG mask/clip on the right edge (NEW)
       └── Same content: brand, conversations, tools, persona
```

#### File Changes

| File | Change | Est. Lines |
|------|--------|-----------|
| `Drawer.tsx` | Replace straight-edge container with SVG-curved clip path. Add `clipId` + `<ClipPath>` using `react-native-svg`. Keep `Animated.timing` slide. | ~40 lines changed |
| `AppShell.tsx` | No structural changes — `drawerOpen` + `Drawer` props stay the same. Only need to ensure `GestureDetector` hitSlop doesn't conflict with curved edge. | ~0-5 lines |
| `AiChatPage.tsx` | No changes (menu icon trigger stays) | 0 |

#### SVG Curve Implementation

```tsx
// In Drawer.tsx — replace the right-edge straight line with a curve
import Svg, { ClipPath, Path, Rect } from "react-native-svg";

// Inside the Animated.View for the drawer panel:
<Svg width={DRAWER_WIDTH + CURVE_WIDTH} height="100%" style={{ position: "absolute", top: 0, left: 0 }}>
  <ClipPath id="halfMoonClip">
    <Path d={`M0,0 L${DRAWER_WIDTH},0 
              Q${DRAWER_WIDTH + CURVE_WIDTH},50% ${DRAWER_WIDTH},100% 
              L0,100% Z`} />
  </ClipPath>
  <Rect clipPath="url(#halfMoonClip)" width="100%" height="100%" fill="..." />
</Svg>
```

Actually, in React Native SVG, the clip would be applied via `clipPath` prop on a wrapping `View` — but RN Views don't support SVG clip paths directly. The practical approach:

1. **Option A (simpler):** Use a `Path`-shaped backdrop overlay on the right side of the drawer that masks the straight edge with a curved shape matching the shell background color. This is cosmetic — the hit area remains rectangular.
2. **Option B (precise):** Use `react-native-reanimated` `useAnimatedStyle` to animate a `mask-image` CSS (via `react-native` `StyleSheet`) with a radial gradient or SVG data URI. Limited cross-platform support.
3. **Option C (recommended):** Keep the drawer rectangular but add a **decorative SVG overlay** on the right edge that draws the curved visual. The gesture area stays rectangular. This is the safest approach given RN limitations.

#### Gesture Conflicts

| Platform | Issue | Mitigation |
|----------|-------|-----------|
| Android 10+ | System back gesture (~20dp from edge) overlaps with drawer's left edge | `activeOffsetX(24)` already requires 24px movement. The curved visual edge doesn't change the hit zone. |
| iOS | Edge swipe back (navigation) | Same as today — the drawer is a Modal, not a navigation stack screen. No conflict. |
| Keyboard | Drawer opens over keyboard | Same as today — Modal overlays everything. |

#### UX Risks

- **Discoverability:** The curved edge is visually distinctive but the hamburger icon trigger stays the same — no change to discoverability.
- **Thumb reach:** The curved right edge reduces the touch target for right-side items. With `DRAWER_WIDTH=280`, items are well within thumb reach on most devices.
- **Animation smoothness:** The SVG clip path approach (Option C) has zero performance impact since it's a static decorative overlay.

#### Feasibility: **Contained** (~40-50 lines changed, 1 file primary)

---

### 6. Variant B: Circular Radial Menu (Central)

#### Concept
Replace the hamburger icon + drawer with a **radial/circular menu** that opens centered on the screen (or anchored to the menu button position). Items fan out in a circle with icons.

#### Critical Design Decision: Content Separation

The current drawer contains **two fundamentally different content types**:
1. **Conversation list** (variable length, scrollable, searchable) — cannot fit in a radial menu
2. **Tool items** (fixed: Settings, Account, Documents, Notes) + Persona selector — good radial candidates

**Proposed separation:**
- **Radial menu:** Tool items only (Settings, Account, Documents, Notes, Persona, New Chat) — 6 items max, perfect for a 6-sector circle
- **Conversation list:** Move to a separate surface — either:
  - A bottom sheet triggered by a dedicated "Conversations" item in the radial menu
  - A horizontal scrolling bar at the top of the chat (like browser tabs)
  - Keep the existing drawer approach but ONLY for conversations (rebranded as "conversation drawer")

#### Architecture

```
AiChatPage.tsx (or new RadialMenu.tsx)
  └── RadialMenu component (NEW)
       └── Overlay (transparent backdrop)
       └── Center trigger point (where hamburger was)
       └── Animated sector items (Reanimated spring)
       └── Each item: icon + label, pressable
  └── ConversationSheet (NEW or refactored Drawer)
       └── Bottom sheet with conversation list only
```

#### File Changes

| File | Change | Est. Lines |
|------|--------|-----------|
| `src/theme/components/RadialMenu.tsx` | **NEW** — Radial menu component with animated sectors | ~150-200 lines |
| `Drawer.tsx` | Refactor to conversation-only bottom sheet OR keep for conversations triggered from radial menu | ~50-80 lines changed |
| `AiChatPage.tsx` | Replace `<ChatNavBar onMenuPress={...}>` hamburger with radial menu trigger. Position the radial menu overlay. | ~20-30 lines changed |
| `AppShell.tsx` | Refactor `drawerItems` → radial menu items. Split `drawerConversationItems` into separate state. Modify `drawerOpen` → two states: `radialMenuOpen` + `conversationSheetOpen`. | ~40-60 lines changed |

#### Radial Menu Animation (Reanimated 4.5.1)

```tsx
// Pseudocode for radial menu animation
const isOpen = useSharedValue(0);
const/itemAngles = [0, 60, 120, 180, 240, 300]; // 6 items

// Each item animates outward from center on open
const itemStyle = useAnimatedStyle(() => {
  const progress = withSpring(isOpen.value, { damping: 12, stiffness: 180 });
  const radius = 80; // distance from center
  const angle = itemAngles[index] * (Math.PI / 180);
  return {
    transform: [
      { translateX: withSpring(progress * Math.cos(angle) * radius) },
      { translateY: withSpring(progress * Math.sin(angle) * radius) },
      { scale: withSpring(progress) },
    ],
    opacity: progress,
  };
});
```

#### Gesture Conflicts

| Platform | Issue | Mitigation |
|----------|-------|-----------|
| Android back | Must close radial menu on hardware back | Add `BackHandler.addEventListener` in RadialMenu component |
| Scroll conflict | Radial menu overlay must block scroll underneath | Transparent backdrop `<Pressable>` captures all touches |
| Keyboard | Open/close must dismiss keyboard | `Keyboard.dismiss()` on open |

#### UX Risks

- **Discoverability:** HIDDEN — radial menus are not standard mobile patterns. Users may not discover them without onboarding.
- **Thumb reach:** Central positioning is good for one-handed use. Items at top of circle may be hard to reach on large phones.
- **6-item limit:** Radial menus work for ≤8 items. Current drawer has: Settings, Account, Documents, Notes, Persona, New Chat = 6 items. Tight but feasible.
- **Conversation access:** Moving conversations out of the primary drawer is a significant UX change. Needs user testing.
- **Accessibility:** Radial menus are challenging for screen readers. Each item needs explicit `accessibilityRole="button"` and the menu needs `accessibilityViewIsModal`.

#### Feasibility: **Structural** (~260-370 lines new/changed, 3-4 files, high UX risk)

---

## A2. "More" Menu Should Not Duplicate Visible Chips

### 1. Current State — Complete Duplication Map

#### Message Action Chips (Visible Row)

| Chip | File:Line | Role | Condition |
|------|-----------|------|-----------|
| Copy | `AiChatPage.tsx:5319-5324` | user + assistant | Always (when not streaming, text non-empty) |
| Read Aloud | `AiChatPage.tsx:5326-5340` | assistant only | `onSpeak` exists |
| Regenerate | `AiChatPage.tsx:5342-5348` | assistant only | `onRegenerate` exists |
| More | `AiChatPage.tsx:5349-5354` | user + assistant | Always (opens modal) |

#### "More" Modal Menu Items

| Item | File:Line | Role | Duplicates Chip? |
|------|-----------|------|-----------------|
| Copy | `AiChatPage.tsx:4201-4218` | always | **YES** — Copy chip at 5319 |
| Save to Notes | `AiChatPage.tsx:4220-4229` | if `onSaveToNotes` | No |
| Translate | `AiChatPage.tsx:4230-4236` | always | No |
| Read Aloud | `AiChatPage.tsx:4238-4256` | assistant only | **YES** — Read Aloud chip at 5326 |
| Regenerate | `AiChatPage.tsx:4257-4272` | assistant, !sending | **YES** — Regenerate chip at 5342 |
| Edit | `AiChatPage.tsx:4273-4282` | user, !sending | No |
| Cancel | `AiChatPage.tsx:4284-4290` | always | No |

#### Decision: What stays in More?

After removing duplicates, the More menu for **assistant messages** retains: Save to Notes, Translate, Edit (N/A for assistant), Cancel.  
After removing duplicates, the More menu for **user messages** retains: Save to Notes, Translate, Edit, Cancel.

The More menu becomes: **Save to Notes + Translate + Edit (user only) + Cancel** — 3-4 items, no duplication.

### 2. i18n Keys

| Key | en.ts Line | Used In |
|-----|-----------|---------|
| `chat.more` | en.ts:509 | More chip label |
| `common.copy` | en.ts:22 | Copy chip + More menu |
| `voice.readAloud` | en.ts:310 | Read Aloud chip + More menu |
| `voice.stopReading` | en.ts:311 | Read Aloud chip (active state) |
| `chat.regenerate` | en.ts:508 | Regenerate chip + More menu |
| `notes.saveToNotes` | en.ts:469 (inferred) | More menu only |
| `translate.title` | en.ts:538 (inferred) | More menu only |
| `chat.edit` | en.ts:510 | More menu only |
| `common.cancel` | en.ts:10 | More menu only |

### 3. Blast Radius

| Concern | Detail |
|---------|--------|
| **Files touched** | `AiChatPage.tsx` only |
| **Chips removed from More** | 3 `AttachSheetRow` blocks (Copy, Read Aloud, Regenerate) |
| **Callback cleanup** | None needed — `onCopyText`, `handleReadAloud`, `regenerate` are still used by chips |
| **MessageActionChip component** | No changes needed — it's generic |
| **Tests** | None exist for these components |

### 4. Feasibility: **Contained** (~15-25 lines removed from `AiChatPage.tsx`)

---

## A3. Remove "Regenerate" (Chip + Menu + Callback)

### 1. Current Regenerate Touchpoints

| Touchpoint | File:Line | What to Remove |
|------------|-----------|----------------|
| **Regenerate chip** | `AiChatPage.tsx:5342-5348` | `<MessageActionChip icon={<Sparkles/>} label={t("chat.regenerate")} onPress={() => onRegenerate(m.id)} />` |
| **Regenerate in More menu** | `AiChatPage.tsx:4257-4272` | `<AttachSheetRow icon={<Sparkles/>} label={t("chat.regenerate")} onPress={...regenerate(id)...}` |
| **`regenerate` callback** | `AiChatPage.tsx:3040-3162` | `const regenerate = useCallback(async (targetMsgId) => {...})` — 123 lines |
| **`regenerateRef`** | `AiChatPage.tsx:3163-3164` | `const regenerateRef = useRef(regenerate); regenerateRef.current = regenerate;` |
| **`onRegenerateStable`** | `AiChatPage.tsx:3165-3168` | `const onRegenerateStable = useCallback((id: string) => { void regenerateRef.current(id); }, []);` |
| **`onRegenerate` prop in ChatMessageRow** | `AiChatPage.tsx:3710` | `onRegenerate={onRegenerateStable}` — prop passed to row renderer |
| **ChatMessageRowProps.onRegenerate** | `AiChatPage.tsx:~246` | Prop definition in the row's type |
| **ChatMessageRow usage of onRegenerate** | `AiChatPage.tsx:5342-5348` | Conditional render of Regenerate chip |

### 2. What to KEEP

| Item | File:Line | Reason |
|------|-----------|--------|
| `regenState.ts` (all refs) | `src/engine/regenState.ts:33-40` | Used by `editMessage` flow (`AiChatPage.tsx:3177-3290`) — edit uses same `regenInFlightRef`, `regenAbortRef`, `regenGenerationRef`, `regenHandleSendPassRef` for its generation-gated logic |
| `editMessage` callback | `AiChatPage.tsx:3177-3290` | Edit flow is independent and must stay |
| Edit chip in More menu | `AiChatPage.tsx:4273-4282` | Edit feature stays |

### 3. i18n Keys to Remove/Keep

| Key | en.ts Line | Action |
|-----|-----------|--------|
| `chat.regenerate` | en.ts:508 | **Remove** — no longer used |
| `chat.cancelRegenerate` | en.ts:511 | **Remove** — no longer used |
| `chat.regenCostHint` | en.ts:513 | **Remove** — no longer used |
| `chat.regenBusy` | en.ts:514 | **Remove** — no longer used |
| `chat.regenFailed` | en.ts:518 | **Keep** — still used by `editMessage` error handling |
| `chat.edit` | en.ts:510 | **Keep** — edit feature stays |
| `settings.modelLowRamRegenNote` | en.ts:271 | **Keep** — documentation string, not UI |

### 4. Blast Radius

| Concern | Detail |
|---------|--------|
| **Files to modify** | `AiChatPage.tsx` (remove ~140 lines), `src/i18n/en.ts` (remove 3 keys), `src/i18n/it.ts` (mirror removals) |
| **editMessage flow** | **NOT affected** — uses same `regenState.ts` refs but independent code path |
| **Concurrent send guard** | `regenInFlightRef` still blocks concurrent sends in edit flow |
| **Stale closure protection** | `regenGenerationRef` still bumped by `clearChat` — edit flow depends on this |
| **ChatMessageRow props** | Remove `onRegenerate` from type + destructuring + chip render. Other props untouched. |
| **Tests** | No tests to break |
| **AppShell.tsx** | No changes needed |

### 5. Feasibility: **Contained** (~140 lines removed from AiChatPage, 3 i18n keys removed, 0 structural changes)

---

## A4. Web Toggle + Notes/Documents Inline in Composer

### 1. Current State — Complete Component Map

#### ComposerActionRow (AiChatPage.tsx:4579-4618)

```
ComposerActionRow (React.memo)
  Props: canSend, sending, pdfBlocked, voiceBlocksComposer, voiceUi, voiceReady, colors, t, onAttach, onMic, onSendOrStop
  Layout: [attach button] ──────── [mic button] [send/stop button]
  No web toggle, no notes, no documents — purely attach/mic/send
```

#### Research Mode (Deep Research)

| Concept | File:Line | Detail |
|---------|-----------|--------|
| `researchMode` state | `AiChatPage.tsx:1112` | `useState(false)` — one-shot flag for next send |
| `researchModeRef` | `AiChatPage.tsx:1113-1114` | Mirror ref for stale closure protection |
| Research mode chip | `AiChatPage.tsx:3995-4022` | Dismissible chip above composer: `<Pressable onPress={() => setResearchMode(false)}>` — shows `t("chat.deepResearchActive")` |
| Deep research row in attach sheet | `AiChatPage.tsx:4534-4544` | `<AttachSheetRow icon={<Search/>} label={t("chat.deepResearch")} onPress={() => { setAttachSheetOpen(false); setResearchMode(true); }}>` |
| Consumption in send path | `AiChatPage.tsx:2274-2277` | `const armedResearch = researchModeRef.current; const useResearch = armedResearch || keywordResearch; if (armedResearch) setResearchMode(false);` |
| Clear on new chat | `AiChatPage.tsx:1713` | `researchModeRef.current = false; setResearchMode(false);` |

#### Web Tools Toggle (AppShell — NOT in AiChatPage)

| Concept | File:Line | Detail |
|---------|-----------|--------|
| `webToolsEnabled` state | `AppShell.tsx:690` | `useState(true)` — persists web search on/off |
| `webToolsEnabledRef` | `AppShell.tsx:691-692` | Mirror ref |
| Toggle UI | `AppShell.tsx:5135-5165` | Pill in model bar: `<Pressable onPress={toggleWebTools}>` with Globe icon + "Web" text + strikethrough when off |
| Tool list consumed | `AppShell.tsx:1927` | `...(webToolsEnabled ? [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] : [])` — adds/removes tools from agent options |
| Passed to AiChatPage | `AppShell.tsx:5253` (inferred) | `webToolsEnabled` is in AppShell scope, not passed as prop to AiChatPage |

**Important:** The web toggle is in the **model bar** (AppShell), not in AiChatPage. Moving it to the composer requires either:
- Passing `webToolsEnabled` + `setWebToolsEnabled` as props to AiChatPage
- Or lifting the state differently

#### Attach Sheet (Modal)

| Concept | File:Line | Detail |
|---------|-----------|--------|
| `attachSheetOpen` state | `AiChatPage.tsx:1115` | `useState(false)` |
| Open trigger | `AiChatPage.tsx:3465-3469` | `onComposerAttach` callback → `setAttachSheetOpen(true)` |
| Attach button in ComposerActionRow | `AiChatPage.tsx:4600-4615` | `<Pressable onPress={onAttach}>` with `BrandIcon name="attach"` |
| Sheet content | `AiChatPage.tsx:4380-4430` | 5 rows: Photo Library, Take Photo, PDF/Word, Library Document, Deep Research |
| `docPickOpen` nested picker | `AiChatPage.tsx:4432-4475` | Sub-sheet for library document selection |

#### What Gets Moved Inline

| Current (in attach sheet) | Target (inline in composer) | State changes |
|---------------------------|----------------------------|---------------|
| Deep Research row | Toggle button/chip in composer toolbar | `researchMode` state stays, trigger moves |
| Library Document row | Button in composer toolbar | `docPickOpen` state stays, trigger moves |
| Photo Library row | **Keep in sheet** (or inline if desired) | `addImageAttachment("library")` |
| Take Photo row | **Keep in sheet** (or inline if desired) | `addImageAttachment("camera")` |
| PDF/Word row | **Keep in sheet** (or inline if desired) | `addPdfAttachment()` |

### 2. Proposed Composer Layout

```
┌─────────────────────────────────────────┐
│ [Research 🔍] [Doc 📄] [Attach 📎]     │  ← NEW inline toolbar row
│ ┌─────────────────────────────────────┐ │
│ │ TextInput (multiline)              │ │
│ └─────────────────────────────────────┘ │
│                        [🎤] [→]         │  ← existing mic + send
└─────────────────────────────────────────┘
```

### 3. i18n Keys

| Key | en.ts Line | Current Usage | New Usage |
|-----|-----------|---------------|-----------|
| `chat.deepResearch` | en.ts:520 | Attach sheet row label | Inline toggle label |
| `chat.deepResearchActive` | en.ts:521 | Chip above composer | Could become inline toggle active state |
| `chat.libraryDocument` | en.ts:478 | Attach sheet row label | Inline button label |
| `chat.photoLibrary` | en.ts:474 | Attach sheet row | Stays in sheet (or inline) |
| `chat.takePhoto` | en.ts:475 | Attach sheet row | Stays in sheet (or inline) |
| `chat.pdfOrWord` | en.ts:477 | Attach sheet row | Stays in sheet (or inline) |
| `chat.a11yAttach` | en.ts:504 | Attach button a11y | May need update for new toolbar |

### 4. Blast Radius

| Concern | Detail |
|---------|--------|
| **Files to modify** | `AiChatPage.tsx` (composer rewrite ~60-80 lines), possibly `AppShell.tsx` (pass webToolsEnabled) |
| **State consolidation** | `attachSheetOpen` → may become partially redundant if most actions move inline. Could simplify to "remaining actions only" sheet (photo/camera/pdf). |
| **`docPickOpen`** | Stays as nested state — library document picker needs a list modal regardless |
| **`researchMode`** | State stays, trigger moves from sheet to inline toggle. Consumption in send path unchanged. |
| **`webToolsEnabled`** | Currently in AppShell. For a unified "web" inline toggle, need to either: (a) pass state+setter as props to AiChatPage, or (b) keep web toggle in AppShell model bar AND add a research mode toggle in composer (they serve different purposes: web=tool availability, research=one-shot deep research) |
| **Keyboard** | Inline toolbar must not interfere with keyboard avoidance (`kbPad` animated style at `AiChatPage.tsx:804`) |
| **Tests** | None exist |

### 5. Feasibility: **Structural** (~60-80 lines changed in AiChatPage, possible 5-10 lines in AppShell for prop threading)

---

## A5. Background "Less Green but Still Green" (Light Theme)

### 1. Current Palette Tokens

| Token | File:Line | Current Value | Purpose |
|-------|-----------|---------------|---------|
| `shell` (light) | `palettes.js:25` | `#E8EEE7` | Main page background |
| `shellElevated` (light) | `palettes.js:26` | `#F4F8F3` | Elevated surfaces |
| `panelSolid` (light) | `palettes.js:27` | `#FFFFFF` | Opaque panels |
| `panel` (light) | `palettes.js:28` | `#F4F8F3` | Subtle panel bg |
| `panelSoft` (light) | `palettes.js:29` | `#EDF2EC` | Soft panel bg |
| `surfaceSunken` (light) | `palettes.js:37` | `#D8E0D7` | Sunken surfaces |
| `materialTop/Mid/Bottom` (light) | `palettes.js:38-40` | `#E8EEE7` | Material layers (same as shell) |
| `line` (light) | `palettes.js:41` | `#D3DAD2` | Borders |
| `lineStrong` (light) | `palettes.js:42` | `#C2CAC1` | Strong borders |
| `lineSoft` (light) | `palettes.js:43` | `#DFE5DE` | Soft borders |
| `accent` (light) | `palettes.js:47` | `#1F5F4E` | Primary accent (teal-green) |
| `accentSoft` (light) | `palettes.js:49` | `#DCE6DE` | Accent tint |

### 2. Color Analysis

Current `#E8EEE7` decomposes to RGB(232, 238, 231):
- R=232, G=238, B=231 → Hue ~105° (yellow-green), Saturation ~3%, Lightness ~92%
- This is a very desaturated sage green — already quite grey

"Less green but still green" means:
- Shift hue slightly toward neutral (reduce green channel or add red/blue)
- Keep the subtle green undertone
- Maintain WCAG AA contrast with `ink: #17201C` (currently ~14:1 ratio — very safe)

### 3. Token to Change

| Token | File:Line | Action |
|-------|-----------|--------|
| `shell` (light) | `palettes.js:25` | Change `#E8EEE7` → suggestion: `#E8EAE7` (reduce green by 4) or `#E6E9E5` (more neutral) |
| All other tokens | — | **No changes needed** — they are relative to shell and maintain harmony |
| `shell` (dark) | `palettes.js:89` | `#07101C` — already navy, not green. No change needed. |

### 4. i18n Keys

None — pure color token change.

### 5. Blast Radius

| Concern | Detail |
|---------|--------|
| **Files to modify** | `src/theme/palettes.js` — single line change |
| **Downstream** | Every component using `colors.shell` auto-updates: `AiChatPage.tsx:3755` (chat bg), Drawer, all screens |
| **Contrast** | Must verify WCAG AA with new value against `ink: #17201C` and `muted: #58615B` |
| **Tests** | No color tests exist |

### 6. Feasibility: **Contained** (1 line change, single file)

---

## A6. Web Sources with Provider Colors

### 1. Current Source Rendering

| Concept | File:Line | Detail |
|---------|-----------|--------|
| Source card container | `AiChatPage.tsx:5415-5458` | `<ScrollView horizontal>` with source cards |
| Card styling | `AiChatPage.tsx:5423-5430` | `backgroundColor: colors.panelSolid`, `borderColor: colors.line` — **same for all providers** |
| Number badge | `AiChatPage.tsx:5431-5440` | `color: colors.accent`, `backgroundColor: colors.accentSoft` — same for all |
| Provider label | `AiChatPage.tsx:5441-5456` | `color: colors.muted` — shows "via brave", "via exa-mcp", etc. |
| Provider mapping | `AiChatPage.tsx:5446-5455` | `exa-mcp` → `t("settings.providerExaMcp")`, `exa` → `t("settings.providerExa")`, `brave` → `t("settings.providerBrave")`, `tavily` → `t("settings.providerTavily")`, `fetch` → `t("settings.providerFetch")` |
| Source type | `AiChatPage.tsx:175-186` | `MessageSource = {title, url?, authors?, doi?, provider?}` |
| Provider set | `search/registry.ts:28` | `SearchProviderId = "exa-mcp" | "exa" | "brave" | "tavily"` |

### 2. Provider → Color Mapping (Proposed)

| Provider | Brand Color | Suggested Card Accent |
|----------|------------|----------------------|
| `exa-mcp` | Exa brand blue `#2872E0` | Blue tint |
| `exa` | Exa brand blue `#2872E0` | Blue tint |
| `brave` | Brave orange `#FB542B` | Orange tint |
| `tavily` | Tavily blue `#4A90D9` | Blue tint |
| `fetch` | Neutral `#6B7280` | Grey (no brand) |

### 3. Implementation

Add a `PROVIDER_COLORS` map in `AiChatPage.tsx` (or a shared constants file):

```tsx
const PROVIDER_COLORS: Record<string, { accent: string; soft: string }> = {
  "brave":    { accent: "#FB542B", soft: "#FDEEE8" },
  "exa":      { accent: "#2872E0", soft: "#E8F0FD" },
  "exa-mcp":  { accent: "#2872E0", soft: "#E8F0FD" },
  "tavily":   { accent: "#4A90D9", soft: "#E8F2FC" },
  "fetch":    { accent: "#6B7280", soft: "#F3F4F6" },
};
```

Then in source card rendering (`AiChatPage.tsx:5423-5458`):
- Number badge: `backgroundColor: providerColors.accent ?? colors.accent`
- Card border: `borderColor: providerColors.accent ?? colors.line` (with lower opacity)
- Provider label: `color: providerColors.accent ?? colors.muted`

### 4. i18n Keys

No new keys — existing `t("errors.sourceVia", {provider})` pattern stays. The color is purely visual.

### 5. Blast Radius

| Concern | Detail |
|---------|--------|
| **Files to modify** | `AiChatPage.tsx` only (~15-20 lines: color map + 3 conditional styles) |
| **Dark theme** | Provider colors must work on both light and dark backgrounds. Brand colors are designed for white backgrounds — may need lighter variants for dark theme. |
| **WCAG** | Provider-colored number badge text must maintain contrast. Use white text on colored backgrounds. |
| **Citation chips** | `MarkdownText.tsx:338-355` — inline `[N]` citation chips currently use `colors.accent` globally. Could optionally be provider-colored too, but that's a separate enhancement. |
| **Tests** | None exist |

### 6. Feasibility: **Contained** (~15-20 lines changed, 1 file)

---

## Files Read

| File | Lines | Purpose |
|------|-------|---------|
| `src/screens/AiChatPage.tsx` | 1-5823 | Main chat page — composer, message actions, sources, regenerate, attach sheet, research mode |
| `src/app/AppShell.tsx` | 1-5457 | App shell — drawer state, web tools toggle, edge swipe gesture, overlay management |
| `src/theme/components/Drawer.tsx` | 1-329 | Side drawer component — Animated timing, Modal, GlassPanel2, conversation list, tools |
| `src/theme/components/QuickActionSheet.tsx` | 1-82 | Bottom sheet quick actions — Modal slide, no Reanimated |
| `src/theme/components/Toolbar.tsx` | 1-36 | Simple horizontal row container |
| `src/theme/components/ActionRow.tsx` | 1-68 | Pressable row with leading/trailing elements |
| `src/theme/palettes.js` | 1-144 | Color palette definitions (light: Sage paper, dark: Navy glass) |
| `src/theme/palettes.d.ts` | 1-110 | Palette type definitions |
| `src/theme/tokens.ts` | 1-78 | Spacing, radius, shadows |
| `src/theme/components/GlassPanel2.tsx` | — | Glass panel used by Drawer and QuickActionSheet |
| `src/theme/icons/BrandIcon.tsx` | 1-~50 | SVG icons via react-native-svg |
| `src/engine/regenState.ts` | 1-101 | Shared regen locks — used by both regenerate and edit flows |
| `src/chat/MarkdownText.tsx` | 1-~400 | Markdown rendering with citation chips |
| `src/agent/webSearchTool.ts` | 1-160 | Web search tool + source mapping |
| `src/search/registry.ts` | 1-125 | Search provider registry — exa-mcp, exa, brave, tavily |
| `src/i18n/en.ts` | 1-1106 | English locale strings |
| `src/i18n/it.ts` | 1-1061 | Italian locale strings (mirrors en.ts) |

---

## Delta vs Scout 2026-09-02

### Anchor Drift Corrections

| Claim in Scout | Actual | Status |
|---------------|--------|--------|
| `AppShell.tsx:2072-2073` — `drawerOpen` state | `AppShell.tsx:2073` | **MINOR DRIFT** — line shifted by +1 |
| `Drawer.tsx:82-242` — component | `Drawer.tsx:39-329` | **SIGNIFICANT DRIFT** — component starts earlier (line 39 not 82), ends later (329 not 242). File grew substantially. |
| `AiChatPage.tsx:4773-4785` — Menu trigger | `AiChatPage.tsx:4545-4558` | **DRIFT** — Menu icon at 4545, not 4773. ChatNavBar definition at 4517. |
| `AiChatPage.tsx:4685-4731` — ChatNavBar | `AiChatPage.tsx:4517-4618` | **DRIFT** — ChatNavBar at 4517, not 4685. |
| `AiChatPage.tsx:5249-5270` — user message chips | `AiChatPage.tsx:5319-5354` | **DRIFT** — chips section starts at 5319, not 5249 |
| `AiChatPage.tsx:5387-5420` — assistant message chips | `AiChatPage.tsx:5319-5354` | **CORRECTION** — same chip block serves both user and assistant (conditional `onSpeak`/`onRegenerate`). Scout incorrectly split into two blocks. |
| `AiChatPage.tsx:4131-4212` — messageMenu modal | `AiChatPage.tsx:4171-4290` | **DRIFT** — modal starts at 4171, not 4131. Content extends to 4290. |
| `AppShell.tsx:2261-2308` — drawerItems | `AppShell.tsx:2261-2308` | **MATCH** ✓ |
| `AppShell.tsx:2235-2260` — drawerConversationItems | `AppShell.tsx:2235-2260` | **MATCH** ✓ |
| `AiChatPage.tsx:4534-4544` — deep research row | `AiChatPage.tsx:4534-4544` | **MATCH** ✓ |
| `AiChatPage.tsx:4507-4533` — attach rows | `AiChatPage.tsx:4399-4430` | **DRIFT** — attach sheet rows start at 4399, not 4507 |
| `AiChatPage.tsx:4025-4128` — composer | `AiChatPage.tsx:4025-4165` | **DRIFT** — composer section extends to 4165 |
| `AiChatPage.tsx:4621-4683` — ComposerActionRow | `AiChatPage.tsx:4579-4618` | **DRIFT** — at 4579, not 4621 |
| `AiChatPage.tsx:3075-3175` — regenerate | `AiChatPage.tsx:3040-3162` | **DRIFT** — starts at 3040, not 3075 |
| `AiChatPage.tsx:175-186` — MessageSource | `AiChatPage.tsx:175-186` | **MATCH** ✓ |
| `AiChatPage.tsx:5403-5460` — source rendering | `AiChatPage.tsx:5410-5470` | **MINOR DRIFT** — +7 lines |
| `palettes.js:25` — shell color | `palettes.js:25` | **MATCH** ✓ |

### File Status Changes

| File | Scout Claim | Actual |
|------|------------|--------|
| `src/theme/components/Drawer.tsx` | "1-242" | 1-329 — **File grew by 87 lines** |
| `src/screens/AiChatPage.tsx` | "1-5824" | 1-5823 — **1 line shorter** |
| `src/app/AppShell.tsx` | "1-5458" | 1-5457 — **1 line shorter** |

### New Discoveries (Not in Scout)

| Finding | Detail |
|---------|--------|
| `Gesture.Pan()` edge swipe | `AppShell.tsx:2255-2260` — scout missed the `react-native-gesture-handler` import and edge swipe gesture. This is critical for A1 half-moon variant. |
| `react-native-svg` available | `BrandIcon.tsx:12` — SVG library present, enabling curved shapes for half-moon variant |
| `regenState.ts` shared locks | Scout noted "Can keep refs" but understated: `editMessage` at `AiChatPage.tsx:3177-3290` actively uses ALL regen refs. Removing regenerate requires careful verification that edit flow is independent. Verified: it is. |
| `webToolsEnabled` in AppShell, not AiChatPage | Scout described it as "inside the attach sheet" — actually the web tools toggle is in AppShell's model bar (`AppShell.tsx:5135-5165`), completely separate from `researchMode` in the attach sheet. These are TWO different concepts. |
| `researchMode` ≠ `webToolsEnabled` | `researchMode` is a one-shot "deep research" flag consumed per-send. `webToolsEnabled` is a persistent toggle for web tool availability. The scout conflated them. |
| BackHandler: zero explicit listeners | No `BackHandler.addEventListener` in AiChatPage. Drawer relies solely on Modal `onRequestClose`. Any new menu must replicate this. |
| No test coverage | Zero test files reference any LOT-A components. No regression tests to update. |

### Smentite (Claims Now Known False)

| Scout Claim | Correction |
|-------------|-----------|
| "Regenerate chip at ~5399-5407" | Regenerate chip is at `5342-5348`, More menu regenerate at `4257-4272` |
| "Edit chip at ~5273-5282" | Edit is only in the More menu at `4273-4282`, not as a standalone chip |
| "Drawer component 82-242" | Drawer is 39-329 (much larger) |
| "ChatNavBar at 4685-4731" | ChatNavBar is at 4517-4618 |
| "ComposerActionRow at 4621-4683" | ComposerActionRow is at 4579-4618 |
