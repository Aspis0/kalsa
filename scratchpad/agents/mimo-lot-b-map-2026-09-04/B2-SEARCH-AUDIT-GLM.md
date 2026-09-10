# B2 Chat Search — Hostile Self-Audit (GLM, 2026-09-04)

**Scope**: uncommitted working-tree diff on `feat/moe-stream` (HEAD `f9d4c75`) for the B2 lot.
Files: `src/app/AppShell.tsx`, `src/conversations/ConversationsStore.ts` (+ new `.test.ts`), `src/theme/components/highlightMatches.tsx` (new), `src/theme/components/DrawerContent.tsx`.

**Method**: read the actual `git diff` (all three modified files are unstaged; test + highlightMatches are untracked), re-derived every pure function in Node, ran `npx jest src/conversations/ConversationsStore.test.ts --runInBand` (3/3 pass) and `npx tsc --noEmit` (exit 0) myself. ESLint is not configured in this repo (`npx eslint` → legacy-config error) so there is no lint gate.

**Report location**: co-located with the map and impl report in `mimo-lot-b-map-2026-09-04/` (chosen over `audit-lot-a-2026-09-02/`, which belongs to the other lot).

---

## Verdict summary

| # | Claim / suspicion | Verdict | Class |
|---|---|---|---|
| 1 | Highlight tokens use the **un**debounced query while the list filter uses the debounced query | **CONFIRMED** | BUG |
| 2 | Stale timer applies old query after clear | **REFUTED** | — |
| 3 | `filterConversations` uses wrong state / stale memo deps | **REFUTED** | — |
| 4 | Unmount timer leak | **REFUTED** | — |
| 5 | `clipChars` negative/NaN max is inconsistent; NaN-tail silently defeats the cap | **CONFIRMED** (latent, unreachable today) | NIT |
| 6 | "Unicode-safe" claim overstated — splits ZWJ emoji + combining marks | **CONFIRMED** | NIT |
| 7 | Tail-bias moves the G4 blind spot instead of removing it; undocumented | **CONFIRMED** | NIT |
| 8 | searchBlob no longer lowercased / no longer joins all messages before clip | **REFUTED** | — |
| 9 | Title/preview callers broken by `fromEnd` | **REFUTED** | — |
| 10 | `highlightMatches` infinite loop (empty/zero-width token) | **REFUTED** | — |
| 11 | Overlapping tokens silently not highlighted (filter/highlight semantics diverge) | **CONFIRMED** | NIT |
| 12 | React key instability | **REFUTED** | — |
| 13 | Original-text case not preserved | **REFUTED** | — |
| 14 | Turkish-İ lowercase expansion drifts highlight onto wrong char | **CONFIRMED** (ultra-edge) | NIT |
| 15 | `emptySearch` banner transiently stale during debounce window | **CONFIRMED** (transient) | NIT |
| 16 | Search-clear asymmetry: row-press close paths never clear search | **CONFIRMED** (pre-existing, unfixed, undocumented) | NIT |
| 17 | Tests: `filterConversations` untested though map G7 named it | **CONFIRMED** | NIT |
| 18 | `highlightMatches` new module, zero tests | **CONFIRMED** | NIT |
| 19 | Test hygiene: env mutation | N/A (no env touched) | — |
| 20 | HTML injection / secrets in logs | **REFUTED** | — |
| 21 | Dead code `chatSearch` vs `chatSearchQuery` | **REFUTED** (both live) | — |
| 22 | i18n regressions | **REFUTED** | — |
| 23 | Color-only highlight (a11y use-of-color) | **CONFIRMED** | NIT |
| 24 | Duplicated `clipChars` in NotesStore now diverges from exported one | **CONFIRMED** | NIT |

**BLOCKERs: none.** BUGs: 1. Everything else is NIT-grade — all listed below.

---

## Findings

### F1 — BUG: highlight tokens are taken from the undebounced input; the list is filtered by the debounced query

**CONFIRMED.** Two different queries drive one UI during the 180 ms window:

- `DrawerContent.tsx:42` — `const searchTokens = tokensFromQuery(searchValue ?? "") ?? [];` where `searchValue` is AppShell's **immediate** `chatSearch` (`AppShell.tsx:5314` — `searchValue={chatSearch}`).
- `AppShell.tsx:2259` — `filterConversations(conversations.items, chatSearchQuery)` — the **debounced** state.

Consequences while typing (up to 180 ms after each keystroke):

1. Visible rows are results of the *old* query but are highlighted with *new*-query tokens — the highlight and the filter disagree. Self-corrects at rest, but is wrong during every typing burst.
2. Every keystroke re-renders AppShell (`chatSearch` state at `AppShell.tsx:849`) → DrawerContent → `highlightMatches` re-runs over every visible row's title *and* preview (`DrawerContent.tsx:175,179`). The debounce only shields `filterConversations`; the per-keystroke highlight work was added *by this change* and is undebounced. G1's "every keystroke triggers work over all rows" is therefore only half-fixed.

Fix is trivial: pass the debounced `chatSearchQuery` down as the highlight source (e.g., a second prop), or debounce `searchTokens` with the list.

Related, same root cause — **CONFIRMED, NIT (F1b)**: `DrawerContent.tsx:41` — `const emptySearch = Boolean(searchValue?.trim()) && (conversationItems?.length ?? 0) === 0;` mixes immediate `searchValue` with the debounced list. If the previous query matched nothing, the "No matching chats" banner shows for the new query before the debounce computes it (and can lag disappearing). Pre-change there was no window at all; the transient flicker is new.

### F2 — REFUTED: stale timer applying old query after clear

The clear path cancels the pending timer synchronously before anything else can fire:

```ts
// AppShell.tsx:852-863
const handleChatSearchChange = useCallback((query: string) => {
  setChatSearch(query);
  if (chatSearchTimerRef.current !== null) clearTimeout(chatSearchTimerRef.current);  // :854
  if (!query) {
    setChatSearchQuery("");          // :856 — clear-on-empty is synchronous
    chatSearchTimerRef.current = null;
    return;
  }
  chatSearchTimerRef.current = setTimeout(() => { ... setChatSearchQuery(query); }, 180);
}, []);
```

- Clear-on-empty: synchronous (`:856`), timer nulled (`:857`). ✅
- Unmount cleanup exists: `AppShell.tsx:864-869` — `useEffect(() => () => { if (chatSearchTimerRef.current !== null) clearTimeout(...); }, [])`. ✅
- Each keystroke re-clears the prior timer (`:854`), so no double-fire and no stale closure can win. ✅
- Row-press drawer close (which bypasses `clearChatSearch`, see F7) leaves a pending timer, but it applies the same query the visible list already shows — consistent, not stale. ✅

**REFUTED.** No race.

### F3 — REFUTED: filterConversations wrong state / stale memo

`AppShell.tsx:2259` uses `chatSearchQuery`, and the memo deps were correctly swapped:

```ts
// AppShell.tsx:2266-2273
[
  chatSearchQuery,      // was chatSearch
  confirmDeleteConversation,
  conversations.activeId,
  conversations.items,
  handleSwitchConversation,
  t,
],
```

Both states init `""` and are always reset together on clear (`:853` + `:856`). No wrong state, no stale memo.

### F4 — CONFIRMED (latent): `clipChars` has no guard; negative/NaN max behaves inconsistently, NaN-tail silently defeats the cap

`ConversationsStore.ts:86-91`:

```ts
export function clipChars(text: string, max: number, fromEnd = false): string {
  const chars = Array.from(text);
  if (chars.length <= max) return chars.join("");
  return (fromEnd ? chars.slice(chars.length - max) : chars.slice(0, max)).join("");
}
```

Verified by execution:

| call | result | verdict |
|---|---|---|
| `clipChars("", 5)` / `("", 5, true)` | `""` / `""` | fine |
| `clipChars("abc", 0)` / `("abc", 0, true)` | `""` / `""` | fine |
| `clipChars("abc", -1)` | **`"ab"`** | head path with negative max returns a near-full string — inverted semantics |
| `clipChars("abc", -1, true)` | `""` | inconsistent with head path |
| `clipChars("abc", NaN)` | `""` | — |
| `clipChars("abc", NaN, true)` | **`"abc"`** | `slice(len - NaN)` → `slice(0)` → **whole string; the 8KB cap would be silently defeated** |

**Latent only**: every call site passes positive constants (`TITLE_MAX=48` `:98`, `PREVIEW_MAX=80` `:111`, `SEARCH_BLOB_CAP` `:129`). Not a BUG today; NIT — one `Number.isFinite(max) && max > 0` guard (or `Math.max(0, ...)`) removes the whole class.

### F5 — CONFIRMED: "Unicode-safe" is code-point-safe only; ZWJ emoji and combining marks split

Impl report claims "Unicode-safe searchBlob clipping"; the map claims "Unicode-safe truncation using `Array.from()`". Verified counter-examples:

- `clipChars("a👨‍👩‍👧‍👦b", 3, true)` → `"‍👦b"` — ZWJ family emoji split mid-sequence (dangling ZWJ + partial glyph).
- `clipChars("e\u0301x", 1)` → `"e"` — combining accent dropped.

Display-affecting for title/preview (which are head-clipped, unchanged) and harmless for searchBlob matching (`includes` doesn't care about broken glyphs). Code-point-safe ≠ grapheme-safe. NIT; if it matters, `Intl.Segmenter` grapheme iteration.

### F6 — CONFIRMED: tail-bias *moves* the G4 blind spot rather than fixing it; trade-off undocumented

`ConversationsStore.ts:128`:

```ts
// Clip the joined text from the tail so recent messages stay searchable in long chats.
return clipChars(parts.join("\n").toLowerCase(), SEARCH_BLOB_CAP, true);
```

Still lowercased before clip ✅ (`:129` — `.toLowerCase()` inside the clip call), still joins **all** messages before clip ✅ (`:129`). But for any chat > 8,000 chars, the *first* user message — usually the best "what was this chat about" key — is now permanently unsearchable, which the new test cements (`ConversationsStore.test.ts:34-38`: `expect(blob).not.toContain("early-only-marker")`). The map offered cap-bump *or* sliding window; the impl took tail-bias only and the report does not acknowledge the new blind spot. Product trade-off — NIT (document it or bump the cap).

### F7 — CONFIRMED (perf): O(total-history) materialization on every persist event

`ConversationsStore.ts:129` builds `parts.join("\n").toLowerCase()` (full string) then `Array.from` (full code-point array) even though only the last 8,000 chars survive. For a 200 KB history that's ~200k array slots per call. **Mitigating fact I verified**: call sites are discrete events, not per-stream-chunk (`AiChatPage.tsx` — 1032, 1074, 1101, 1280, 1732, 2696, 2754, 2893, 2936). So bounded per message, growing linearly with history. NIT — accumulate from the tail until cap instead of join-then-slice.

### F8 — highlightMatches: what breaks and what doesn't

Logic re-derived and simulated (`highlightMatches.tsx`):

- **REFUTED — infinite loop**: `cursor = matchIndex + matchLength` (`:36`); whenever `matchIndex >= 0`, `matchLength = token.length >= 1` because `usableTokens = tokens.filter(Boolean)` (`:6`) removes empty tokens and `toLowerCase` never maps a non-empty string to empty. Verified: no loop with empty token, ZWSP token, İ-expansion, duplicates.
- **REFUTED — empty token**: filtered at `:6`.
- **REFUTED — case loss**: all slices come from the original `text` (`:25,29,33`). `highlight("HeLLo World", ["world","hello"])` → `HeLLo` + `World` preserved.
- **REFUTED — key instability**: `plain-${key++}` / `match-${key++}` (`:25,29,32`) is deterministic per (text, tokens) pair; rows re-render wholesale on query change. Fine.
- **CONFIRMED — NIT (F8a), overlap under-reporting**: `["abc","bcd"]` on `"abcd"` → filter matches the row (both tokens present in fields) but highlight emits only `abc` (`:36` jumps cursor past the match; `indexOf(token, cursor)` can never look back). The visible highlight under-reports what the filter matched. Cosmetic.
- **CONFIRMED — ultra-NIT (F8b), Turkish İ drift**: token `"\u0307"` (combining dot) against text `"İa"`: `lowerText` is `"i\u0307a"` (3 chars), match at index 1, `matchLength=1` → the highlight lands on the **original `"a"`**, not the combining mark. Lowercase-expansion (İ → `i`+U+0307) shifts `matchLength` between index spaces. Cosmetic; also note `query "istan"` never highlights "İstanbul" — but the *filter* misses it identically, so filter/highlight stay consistent (not a bug).
- **NIT (F8c)**: `:17` re-lowercases each token although `tokensFromQuery` already lowercased them (`filterByTokens.ts:7`). Redundant work per row per render.
- **NIT (F8d)**: `:6` `tokens.filter(Boolean)` is dead defense — `tokensFromQuery` can never emit empty strings (`split(/\s+/).filter(Boolean)` on a trimmed non-empty `q`).
- **NIT (F8e)**: zero tests for a brand-new logic module (earliest-longest tie-break, overlap-dropping, case preservation — all currently unverified by CI).
- Ultra-NIT (F8e2): the earliest-longest selection loop (`:16-23`) is correct by simulation (ties broken to longest, later tokens can override to longer at same index) — reported as verified-correct, no change needed.

### F9 — CONFIRMED (pre-existing, unfixed): search-clear asymmetry

Row-press close paths never clear the search; backdrop/back/personas do:

- Clear: `AppShell.tsx:5305-5308` (`onClose` → `clearChatSearch()`), `:5322-5325` (`onPersonaPress` → `clearChatSearch()`).
- No clear: `handleSwitchConversation` `:2104-2106` (`setDrawerOpen(false)` ×2), `handleNewConversation` `:2141-2143, :2168, :2187, :2192` — all `setDrawerOpen(false)` without `clearChatSearch()`.

Reopening the drawer after tapping a search result shows the stale query + filtered list; reopening after backdrop-tap shows a fresh list. Pre-existing (old code cleared only on backdrop too), but this lot claimed the search lifecycle and didn't reconcile it. NIT.

### F10 — Tests (test hygiene angle)

`ConversationsStore.test.ts` (41 lines, 3 tests — I ran them, pass):

- **CONFIRMED — NIT (F10a)**: `filterConversations` has **zero** tests, though map G7 explicitly listed it and the impl report claims "pure-function Jest coverage". `tokensFromQuery` is also only covered indirectly.
- **N/A — env mutation**: the test file touches no `process.env` / globals; nothing to save/restore.
- **REFUTED — fromEnd false path uncovered**: `ConversationsStore.test.ts:24` — `expect(clipChars("😀abc", 2)).toBe("😀a")` exercises the default (head) path; `:25` covers `true`. Both directions covered.
- **NIT (F10b)**: `clipChars` edge inputs untested — empty string, max=0, negative, NaN, max>len, combining marks (the exact divergences proven in F4/F5).
- **NIT (F10c)**: `searchBlobFromMessages` edge inputs untested — null, empty array, non-string `text` items (all handled in code `:117-127`, just unverified).
- **NIT (F10d)**: debounce is inline in AppShell (`:852-869`), untestable as written — no fake-timer test of the clear/stale paths exists. Extracting it would make F2-verifiable by CI.
- Tail test is length-coupled (joined length exactly 8037 = 17+1+8000+1+18, clip drops exactly the `early-only-marker\n` prefix) — deterministic, fine, but brittle to any constant change. Ultra-NIT.

### F11 — Security: REFUTED on both counts

- No HTML anywhere: `highlightMatches` returns `ReactNode[]` of `<Text>` children consumed by RN `<Text>` (`DrawerContent.tsx:175,179`). No `dangerouslySetInnerHTML`, no HTML string building. Injection-safe.
- No `console.*` in any changed file or changed hunk (grepped). No secrets logged.

### F12 — Dead code: REFUTED

`chatSearch` (immediate, drives TextInput `:5314`) and `chatSearchQuery` (debounced, drives filter `:2259`) are both live; `clearChatSearch` used twice (`:5308, :5325`); timer ref used. `setChatSearch` has exactly one caller (`handleChatSearchChange`). No leftovers from the old `setChatSearch("")` inline handlers.

### F13 — i18n / a11y: mostly REFUTED, one NIT

- **REFUTED i18n**: no new user-facing strings in this lot. `drawer.searchChats`/`noMatches` present in both locales (`en.ts:41-42`, `it.ts:40-41`).
- **REFUTED a11y-label regression**: `DrawerContent.tsx:161` — `accessibilityLabel={item.title}` — AppShell pre-maps empty titles to `t("drawer.untitled")` (`AppShell.tsx:2261`), so the label is never empty. Unchanged by this diff.
- **CONFIRMED — NIT (F13a)**: highlight is color-only (`DrawerContent.tsx:175,179` → accent color via `highlightMatches.tsx:32`) — WCAG 1.4.1 use-of-color; no background/underline affordance; accent-on-muted contrast unverified. Low-vision users may not perceive matches.
- Ultra-NIT: tokens can highlight *inside the localized fallback* "Untitled"/"Senza titolo" even though the haystack that matched was `searchBlob` — cosmetic quirk, harmless.

### F14 — CONFIRMED: duplicated `clipChars`

The impl exported `clipChars` from ConversationsStore (`:86`) yet `src/notes/NotesStore.ts:60` keeps its own private `function clipChars(text: string, max: number): string` (no `fromEnd`). The two implementations can now drift (one already has). Consolidation was free and skipped. NIT.

### F15 — Misc nits

- **NIT**: magic `180` (`AppShell.tsx:863`) — no named constant, no comment; map suggested 150; no tuning rationale recorded.
- **NIT**: `searchTokens` recomputed on every DrawerContent render (`DrawerContent.tsx:42`) — could be `useMemo`'d; micro.
- **NIT**: Android gets no clear affordance — `clearButtonMode="while-editing"` is iOS-only (`DrawerContent.tsx:107`); pre-existing, unchanged.
- **NIT**: `filterByTokens` returning `[]` for "all tokens dropped" means a query of only `<3`-char tokens *with* a longer token present yields match-none by design (`filterByTokens.ts:28-30`) — consistent with highlight (same `tokensFromQuery`), documented in the docstring. Not a defect; recorded so nobody "fixes" it later.

---

## ALL NITs (complete list)

1. (F1b) `emptySearch` banner transiently stale during the 180 ms window (`DrawerContent.tsx:41`).
2. (F4) `clipChars`: negative max on head path returns near-full string; NaN tail returns whole string, defeating the cap (`ConversationsStore.ts:86-91`). Latent.
3. (F5) Grapheme-unsafe clipping splits ZWJ emoji / combining marks; "Unicode-safe" overstated in map + impl report.
4. (F6) Tail-bias moves the G4 blind spot to the first user message; undocumented trade-off; no cap bump / sliding window.
5. (F7) O(total) join + `Array.from` per persist event (`ConversationsStore.ts:129`).
6. (F8a) Overlapping tokens silently not highlighted; highlight under-reports vs filter semantics (`highlightMatches.tsx:18,36`).
7. (F8b) Lowercase-expansion (İ) drifts highlight onto the wrong char (ultra-edge).
8. (F8c) Double lowercasing of tokens (`highlightMatches.tsx:17` after `filterByTokens.ts:7`).
9. (F8d) Dead defensive `tokens.filter(Boolean)` (`highlightMatches.tsx:6`).
10. (F8e) Zero tests for `highlightMatches`.
11. (F9) Search-clear asymmetry: row-press closes never clear (`AppShell.tsx:2104-2106, 2141-2143, 2192` vs `5305-5308, 5322-5325`). Pre-existing.
12. (F10a) `filterConversations` untested despite being named in G7; `tokensFromQuery` only indirect.
13. (F10b) `clipChars` edge inputs (empty/0/negative/NaN/>len) untested.
14. (F10c) `searchBlobFromMessages` null/empty/non-string inputs untested.
15. (F10d) Debounce logic inline in AppShell, untestable without extraction.
16. (F10e) Tail test couples to exact constants (8037 joined length). Brittle-but-deterministic.
17. (F13a) Color-only highlight, no non-color affordance, contrast unverified.
18. (F14) Duplicated `clipChars` in `NotesStore.ts:60`, diverging from the newly exported one.
19. (F15a) Magic `180` no constant/comment (`AppShell.tsx:863`).
20. (F15b) `searchTokens` not memoized (`DrawerContent.tsx:42`).
21. (F15c) Android has no clear-search affordance (`clearButtonMode` iOS-only) — pre-existing.
22. (F13b) Tokens can highlight inside the localized "Untitled" fallback string (harmless).

REFUTED (for the record): stale-timer-after-clear; wrong-state/stale-memo `filterConversations`; unmount leak; infinite loop; empty-token loop; key instability; case loss; HTML injection; secrets in logs; dead code; i18n regressions; broken title/preview clipping; un-lowercased searchBlob.

BLOCKER: **none**. BUG: **F1** (debounce-scope mismatch between highlight tokens and filter query). Everything else NIT.

---

## Ordered fix list

1. **F1 (BUG, ~2 lines)**: make highlighting use the debounced query. Pass `chatSearchQuery` into `DrawerContent` (new prop, e.g. `highlightQuery`) and build `searchTokens` from it; keep `searchValue` only for the input value. This removes the highlight/filter mismatch *and* the per-keystroke per-row highlight cost.
2. **F1b**: after (1), `emptySearch` at `DrawerContent.tsx:41` becomes consistent with the list automatically; verify no banner flicker remains.
3. **F4**: guard `clipChars` — `if (!Number.isFinite(max) || max <= 0) return "";` (head path currently returns `"ab"` for max=-1; NaN-tail returns the whole string).
4. **F10a/c/e**: add tests — `filterConversations` (AND semantics, short-token drop rule, recency order), `tokensFromQuery` direct, `clipChars` edge matrix (empty/0/negative/NaN/>len), `searchBlobFromMessages` null/empty/non-string, and a `highlightMatches` suite (overlap, tie-break, case, empty token).
5. **F9**: decide the clearing policy and make it uniform — either `clearChatSearch()` in `handleSwitchConversation`/`handleNewConversation`, or stop clearing on backdrop; document the choice in the impl report.
6. **F6**: either document the tail-bias trade-off (first user message unsearchable in >8KB chats) in B2-IMPL-REPORT.md, or bump `SEARCH_BLOB_CAP` per the map's recommendation.
7. **F14**: delete `NotesStore.ts:60` duplicate `clipChars` and import from ConversationsStore (notes keep head-clip semantics via call sites).
8. **F7**: if long-chat persist ever shows on profile, switch `searchBlobFromMessages` to backward accumulation until cap (no full join).
9. **F5**: if emoji/accents appear in titles, iterate grapheme clusters (`Intl.Segmenter`) in `clipChars`; otherwise fix the "Unicode-safe" wording in map/report to "code-point-safe".
10. **F15a/F15b/F8c/F8d**: cosmetic — extract `SEARCH_DEBOUNCE_MS = 180`, memoize `searchTokens`, drop double-lowercase and dead `filter(Boolean)`. Batch in one cleanup commit.
