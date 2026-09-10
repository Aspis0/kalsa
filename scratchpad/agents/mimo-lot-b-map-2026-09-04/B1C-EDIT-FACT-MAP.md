# B1C — Edit a saved memory fact

## 1. Current list row UI + delete flow

**File:** `src/screens/SettingsScreen.tsx` — Memory facts list (lines ~1395–1430)

Each fact renders as:
```
<View flexDirection="row" alignItems="center" gap={spacing.sm}>
  <Text flex={1} numberOfLines={3}>{fact.text}</Text>
  <Pressable onPress={() => handleDeleteMemoryFact(fact)}>
    <Trash2 size={16} />
  </Pressable>
</View>
```

- `handleDeleteMemoryFact` (line ~1370): opens `Alert.alert(t("memory.deleteFact"), fact.text, [cancel, destructive confirm])` → calls `MemoryStore.removeFact(fact.id)` + `reloadMemory()`.
- Row has no edit affordance. No `Pencil`/`Edit2` icon imported yet from `lucide-react-native`.

---

## 2. MemoryStore APIs — what exists, what to add

**File:** `src/memory/MemoryStore.ts`

| API | Exists? | Notes |
|---|---|---|
| `addFact(text)` | ✅ | Normalizes, dedupes by `normalizeKey()`, throws `MemoryCapacityError` at `MAX_FACTS` (40) |
| `removeFact(id)` | ✅ | Filters by id, bumps epoch |
| `removeFactByText(text)` | ✅ | Filters by `normalizeKey()` match, bumps epoch |
| `clearFacts()` | ✅ | Empties store, bumps epoch |
| `listFacts()` | ✅ | Returns migrated/deduped sorted list |
| **`updateFact(id, newText)`** | ❌ **missing** | **Must add** |

### `updateFact` spec

```ts
export async function updateFact(id: string, newText: string): Promise<void>
```

Behavior:
1. `withMutex` — serialized like all other mutations.
2. `normalizeText(newText)` → reject if empty (return early, no-op).
3. Read `facts` via `readFactsRaw()`.
4. Find fact by `id`; if missing → return early (no-op).
5. Compute `newKey = normalizeKey(newText)`.
6. **Dedupe collision:** if *another* fact already has `normalizeKey === newKey`, silently drop the update (or merge — recommend no-op to avoid surprise data loss; user can delete+re-add).
7. Mutate `fact.text = normalized` in place.
8. `writeFacts(facts)` — `writeFacts` already runs `dedupeAndCap()` internally, which handles epoch-only caps but does **not** bump epoch.
9. **Epoch:** do **not** bump epoch — the fact count and identity haven't changed, only text content. Epoch is a generation counter for extraction job invalidation (emptying/toggling); a text edit is a content-only mutation. Extraction jobs that captured the old text will naturally overwrite on the next extract cycle.

> **Epoch decision:** No bump. Rationale: epoch guards extraction-job stale writes (`applyExtractResults` checks `epoch !== expectedEpoch`). An edit doesn't empty the store or disable memory — the extraction job's add/remove list may still be valid. The only downside is a stale extraction could re-add the old text next turn, but `normalizeKey()` dedupe in `applyExtractResults` prevents that if the new text has the same normalized key.

---

## 3. Epoch / mutex implications

| Operation | Bumps epoch? | Mutex? |
|---|---|---|
| `addFact` | ❌ | ✅ |
| `removeFact` | ✅ | ✅ |
| `removeFactByText` | ✅ | ✅ |
| `clearFacts` | ✅ | ✅ |
| `setEnabled(false)` | ✅ | ✅ |
| **`updateFact`** (new) | **❌** | **✅** |

Update is a content-only write. The mutex serializes it against concurrent extract jobs, which is sufficient. No epoch bump needed.

---

## 4. i18n keys to add

**Files:** `src/i18n/en.ts`, `src/i18n/it.ts` (must mirror)

Existing keys that work as-is: `memory.deleteFact` (reuse label pattern), `common.cancel`, `common.save`, `memory.saveError`, `memory.addDone`.

New keys needed:

```ts
// en.ts — memory section
editFact: "Edit fact",          // row edit button label + Alert title
editPlaceholder: "Edit fact text",  // TextInput placeholder in inline edit
editDone: "Fact updated",       // success notice
editDuplicate: "Another fact already says this.",  // dedupe collision notice
```

No new `common.*` keys needed. `common.save` and `common.cancel` already exist.

---

## 5. Recommended UX — lightest RN pattern

**Inline edit-in-place** (no Modal, no Alert with TextInput — those are RN anti-patterns for text input).

### Interaction model

1. **Tap edit icon** (Pencil from lucide-react-native, 16px, same hit-slop as Trash2) → row switches to edit mode.
2. **Edit mode:** `Text` replaced by `TextInput` pre-filled with `fact.text`, `maxLength={200}`. Two small icon-buttons appear: ✓ (save) and ✕ (cancel), replacing the edit+trash icons.
3. **Save:** calls `MemoryStore.updateFact(fact.id, text)`. On success → exit edit mode, show `memory.editDone` notice briefly. On dedupe collision → stay in edit mode, show `memory.editDuplicate` notice. On empty text → cancel edit (no-op).
4. **Cancel:** reverts to display mode, no write.
5. **Keyboard:** `onSubmitEditing` → save. `returnKeyType="done"`.

### State additions (SettingsScreen)

```ts
const [editingFactId, setEditingFactId] = useState<string | null>(null);
const [editingText, setEditingText] = useState("");
```

No ref guard needed (save is synchronous within mutex, no double-tap risk like add).

### Row JSX pattern

```tsx
{editingFactId === fact.id ? (
  // Edit mode: TextInput + save/cancel
  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
    <TextInput
      value={editingText}
      onChangeText={setEditingText}
      maxLength={200}
      autoFocus
      onSubmitEditing={() => handleSaveFact(fact)}
      returnKeyType="done"
      style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
               paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, color: colors.ink,
               fontSize: typography.bodySm.fontSize }}
    />
    <Pressable onPress={() => handleSaveFact(fact)} hitSlop={8}>
      <Check size={16} color={colors.good} />
    </Pressable>
    <Pressable onPress={() => setEditingFactId(null)} hitSlop={8}>
      <X size={16} color={colors.muted} />
    </Pressable>
  </View>
) : (
  // Display mode: text + edit + delete
  <>
    <Text flex={1} numberOfLines={3}>{fact.text}</Text>
    <Pressable onPress={() => { setEditingFactId(fact.id); setEditingText(fact.text); }} hitSlop={8}>
      <Pencil size={16} color={colors.muted} />
    </Pressable>
    <Pressable onPress={() => handleDeleteMemoryFact(fact)} hitSlop={8}>
      <Trash2 size={16} color={colors.bad ?? colors.muted} />
    </Pressable>
  </>
)}
```

`Check`, `X`, `Pencil` from `lucide-react-native` — add to existing import.

---

## 6. Tests to add for `updateFact`

**File:** `src/memory/MemoryStore.test.ts` (append to existing file)

| Test | Assert |
|---|---|
| `updateFact` changes text, keeps id and createdAt | `listFacts()` shows new text, same id, same createdAt |
| `updateFact` with empty string is a no-op | Text unchanged, store size unchanged |
| `updateFact` with nonexistent id is a no-op | Store unchanged |
| `updateFact` dedupe: new text matches existing fact's normalized key | Update is silently skipped, original fact unchanged |
| `updateFact` normalizes whitespace | `"  hello   world  "` → `"hello world"` |
| `updateFact` caps at MAX_TEXT_LEN (200) | Long text is truncated to 200 chars |
| `updateFact` does NOT bump epoch | `getEpoch()` before === `getEpoch()` after |
| `updateFact` on a store at MAX_FACTS does not change count | Capacity unchanged (text-only mutation) |

---

## 7. Summary

| Aspect | Status |
|---|---|
| MemoryStore `updateFact` | **Gap** — must add (~20 lines) |
| Epoch implications | **Resolved** — no bump needed (content-only) |
| Mutex | **Resolved** — `withMutex` wrapper, same as all mutations |
| i18n keys | **Gap** — 4 new keys in `en.ts` + `it.ts` |
| UX pattern | **Inline edit-in-place** — lightest pattern, matches Settings style |
| lucide icons | **Gap** — add `Pencil`, `Check`, `X` to import |
| Tests | **Gap** — 8 test cases for `updateFact` |
| Export / drawer / categories / chat badge | Out of scope ✅ |

**Minimal patch file list:**

1. `src/memory/MemoryStore.ts` — add `updateFact(id, newText)` export
2. `src/memory/MemoryStore.test.ts` — add 8 tests
3. `src/screens/SettingsScreen.tsx` — add `editingFactId`/`editingText` state, `handleSaveFact` callback, edit icon row logic, lucide import
4. `src/i18n/en.ts` — add 4 keys under `memory.*`
5. `src/i18n/it.ts` — mirror 4 keys under `memory.*`
