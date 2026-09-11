# DRAWER-POOL-AUDIT — 2026-09-11

**Scope:** Uncommitted diff across `DrawerContent.tsx`, `sessionPool.ts`, `sessionPool.test.ts`.
**Author:** MiMo (hostile review). Writer: grok-4.6.

---

## Diff summary

| File | Change |
|------|--------|
| `src/theme/components/DrawerContent.tsx:185` | +1 line: `testID={\`drawer-conversation-${item.id}\`}` on `<Pressable>` |
| `src/engine/sessionPool.ts:44-46` | +4 lines: new `modelIdOfStem()` helper |
| `src/engine/sessionPool.ts:55-71` | ~15 lines changed: `pickEvictionStems` gains foreign-model-first sort tier |
| `src/engine/sessionPool.test.ts:56-88` | +33 lines: 2 new test cases for foreign eviction priority |

---

## Findings

### F1 — parseSessionStem mismatch (sanitized model ids vs keepStem)

**Hunt:** Does `modelIdOfStem(stem)` → `parseSessionStem(\`${stem}.kvs\`)` ever produce a different modelId than what was used to construct the stem?

- `modelIdOfStem` (`sessionPool.ts:44-46`) appends `.kvs` and calls `parseSessionStem`, which splits on `__` (lastIndexOf) and requires at least two `__` separators.
- `PoolFile.stem` values come from `stemFromPooledName` (`sessionPool.ts:194-203`) which strips `.kvs` / `.kvs.tmp` / `.kvs.bak` / `.kvs.meta` suffixes from directory listings.
- All modern stems are `sessionStem()` output: `sanitize(modelId) + "__" + sanitize(conv) + "__" + sanitize(env)`.
- `parseSessionStem(\`${stem}.kvs\`)` round-trips correctly because `__`-splitting is unambiguous for stems with ≥2 separators. `sanitizeSessionSegment` is injective (`[A-Za-z0-9-]` pass through; everything else becomes `_` + 4-hex), so `a__b` and `a_b` can't collide.

**Verdict: REFUTED.** No mismatch. The append-`.kvs` trick is correct for all stems produced by `sessionStem()`.

---

### F2 — Legacy stems with `keepModel` null silently skip foreign preference

**Hunt:** What happens when `keepStem` is a legacy stem (no `__` separator)?

- `modelIdOfStem(keepStem)` → `parseSessionStem(\`${keepStem}.kvs\`)` → `null` (no `__` separator → returns null at `sessionKey.ts:125`).
- `keepModel = null`.
- `isForeign` (`sessionPool.ts:59-63`): `if (keepModel == null) return false;` → **always false for all stems.**
- Result: `aForeign !== bForeign` is always false → sort falls through to `a.lastUsedAt - b.lastUsedAt`. Pure LRU. No foreign-model priority.

This is the correct degradation: a legacy stem has no model identity, so there's no way to determine foreign-ness. But it is **silent** — no log, no metric, no comment on the `null` return path.

**Verdict: CONFIRMED.** Silent skip is correct but undocumented in production. The JSDoc on `pickEvictionStems` doesn't mention this edge case. Recommend a code comment at `sessionPool.ts:59`.

---

### F3 — Sort stability

**Hunt:** Does the multi-tier comparator break stability or produce non-deterministic eviction?

- `Array.prototype.sort` is stable per ES2019+ (V8/Hermes/JSC all comply).
- Secondary tiebreaker: `a.lastUsedAt - b.lastUsedAt || a.stem.localeCompare(b.stem)`.
- Tertiary `localeCompare` ensures two files with identical `lastUsedAt` always sort the same way.

**Verdict: REFUTED.** Sort is stable and deterministic.

---

### F4 — TestIDs with special chars in `item.id`

**Hunt:** Could `item.id` contain characters that break React Native testID or Detox query selectors?

- Conversation IDs are `nextConversationId()` (`ConversationsStore.ts:84-86`): `` `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` `` — character set `[a-z0-9-]`. Safe.
- **But:** `DrawerConversationItem.id` is typed as `string` with no runtime validation. Any consumer could pass `id: "foo.bar/baz"`.
- `testID` becomes `drawer-conversation-foo.bar/baz`. Detox `by.id()` uses exact match so it won't break, but accessibility frameworks (e.g., Appium, XCUITest) that parse IDs by dot/slash could misinterpret.
- No test for the testID value exists in the diff.

**Verdict: PLAUSIBLE.** Theoretical risk. Current callers are safe (`conv-{ts}-{rand}`), but the type is unconstrained. Consider a `sanitizeTestIDSegment` or documenting the ID contract on `DrawerConversationItem.id`.

---

### F5 — Security of testID leaking ids

**Hunt:** Does `testID={\`drawer-conversation-${item.id}\`}` expose PII or sensitive data?

- Conversation IDs are opaque (`conv-{epoch}-{rand}`), not user content.
- `item.title` is user-authored but only used in `accessibilityLabel`, not `testID`.
- In release builds, React Native strips testIDs unless `__DEV__` or Detox is active.

**Verdict: REFUTED.** No PII leak.

---

### F6 — Dead code

**Hunt:** Is `modelIdOfStem` or `isForeign` unused outside `pickEvictionStems`?

- `modelIdOfStem` — called at `sessionPool.ts:58` and `sessionPool.ts:61`. No other callers.
- `isForeign` — closure inside `pickEvictionStems`, called at `sessionPool.ts:68-69`. No other callers.
- Neither is exported. Both are live, used exactly where expected.

**Verdict: REFUTED.** No dead code.

---

### F7 (bonus) — `pickEvictionStems` filter uses `!==` not `startsWith`

```typescript
.filter((f) => f.stem !== keepStem)
```

This is correct: `keepStem` is the exact stem string (e.g. `lfm2.5-2.6b__c-keep__env`), not a prefix. Using `startsWith` here would be wrong and could over-filter. **Not a bug.**

---

## Test coverage audit

| Test | Lines | Verdict |
|------|-------|---------|
| `pickEvictionStems` — under budget | 56-62 | ✅ Correct |
| `pickEvictionStems` — LRU + keep exclusion | 64-77 | ✅ Correct |
| `pickEvictionStems` — early stop | 79-84 | ✅ Correct |
| `pickEvictionStems` — foreign before same-model LRU | 87-102 | ✅ Correct; validates both eviction order and keep-preservation |
| `pickEvictionStems` — same-model LRU after foreign gone | 104-121 | ✅ Correct; validates three-tier priority |
| `staleStemsForConversation` — env hash filter | 123-131 | ✅ Correct (unchanged) |

**6/6 pass. EXIT 0 confirmed.**

Missing coverage (not blocking):
- No test for `keepModel = null` path (legacy stem as keepStem).
- No test for empty `files` array.
- No test for negative `bytes` values (the `Math.max(0, f.bytes)` guard is untested).

---

## Verdict

### **SHIP**

No correctness bugs. The foreign-model-first eviction logic is sound, tests are thorough for the happy path, and the `DrawerContent.tsx` testID is a low-risk addition with safe character semantics under current callers.

**Optional follow-ups (non-blocking):**
1. Add a code comment at `sessionPool.ts:59` documenting the `keepModel == null` → pure-LRU fallback.
2. Add a test case for `keepModel = null` to lock down the legacy path.
3. Consider tightening `DrawerConversationItem.id` to a branded type or adding a comment that it must be `[a-zA-Z0-9-]+` safe for testID use.
