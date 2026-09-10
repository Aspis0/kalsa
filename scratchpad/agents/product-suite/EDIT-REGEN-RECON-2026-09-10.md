# EDIT / REGENERATE Recon — code trace on `1edf5c6`

> Read-only. Repo `origin/main` `1edf5c662715a357c7aa74d16b9b2ab787688f6e`.
> All file:line quotes are from this checkout. Terse. No full test suites.

---

## 1. Message action sheet — user vs assistant menus

**File:** `src/screens/AiChatPage.tsx`

The action sheet is a Modal starting at **line 4128**. It renders a fixed set of rows:

| Row | Gate | Line |
|---|---|---|
| Copy | `!messageMenu.text.trim()` (empty-text only) | 4158 |
| Save to Notes | `onSaveToNotes` prop present | 4181 |
| Translate | always | 4191 |
| **Edit** | `messageMenu.role === "user" && !sending` | **4198** |
| Cancel | always | 4210 |

**Key quote (the Edit gate):**
```tsx
{messageMenu.role === "user" && !sending ? (
  <AttachSheetRow
    icon={<SquarePen size={18} color={colors.ink} />}
    label={t("chat.edit")}          // en:"Edit" / it:"Modifica"
    testID="message-action-edit"
    onPress={() => {
      setEditingMessage({ id: messageMenu.id, draft: messageMenu.text });
      setMessageMenu(null);
    }}
    colors={colors}
  />
) : null}
```
`AiChatPage.tsx:4198–4208`

**Regenera/Regenerate is absent from this sheet for both user and assistant roles.** No row, no gate, no hidden conditional. The assistant menu shows only: Copy, Save to Notes, Translate, Cancel.

---

## 2. Edit flow — open editor, Salva, what it mutates

### 2a. Opening the editor

Tap "Modifica" → sets state `editingMessage = { id, draft }` (line 4204). The edit Modal renders at **line 4228** with:

- `TextInput` bound to `editingMessage.draft` (line 4258)
- Annulla → `setEditingMessage(null)` (line 4272)
- Salva → calls `editMessage(id, draft)` (line 4280)

**Salva quote:**
```tsx
onPress={() => {
  const id = editingMessage.id;
  const draft = editingMessage.draft;
  void editMessage(id, draft).then((res) => {
    if (!mountedRef.current) return;
    if (!res.ok) {
      showVoiceNote(t(res.reasonKey as any));
      return;
    }
    setEditingMessage(null);
  });
}}
```
`AiChatPage.tsx:4280–4290`

### 2b. `editMessage` — the core logic

**Location:** `AiChatPage.tsx:3082–3208`

The function does the following in order:

1. **Guard:** refuses if `regenInFlightRef`, `sendingRef`, or `sendClaimRef` is held (line 3093).
2. **Capture snapshot:** `const snapshot = messagesRef.current.slice()` (line 3111).
3. **Truncate history:** keeps messages *before* the edited message, drops the edited message and everything after:
   ```tsx
   const base = messagesRef.current.slice(0, idx).map((m) => m);
   setMessages((prev) => { ... return base; });
   messagesRef.current = base;
   ```
   `AiChatPage.tsx:3143–3154`
4. **Re-send:** calls `handleSendTracked(trimmed, target.attachments, { edited: true })` (line 3159–3161). This re-appends the (edited) user bubble + generates a new assistant response.
5. **Rollback on failure:** if `sendResult.ok` is false, restores from `snapshot` (lines 3165–3180).
6. **On success:** the new messages array (base + edited user + new assistant) is the live state.

### 2c. What `handleSend` does with `edited: true`

`handleSend` (line 2041) appends user + assistant bubbles at **line 2205–2225**:
```tsx
{
  id: userMsgId,
  role: "user",
  text: trimmed,
  createdAt: now,
  attachments: snapshotAttachments.length > 0 ? snapshotAttachments : undefined,
  ...(opts?.edited ? { edited: true } : {}),
},
```
`AiChatPage.tsx:2215–2221`

The `edited: true` flag is a **UI badge only** — restored from persisted data at line 678–679:
```tsx
if (record.edited === true) {
  message.edited = true;
}
```

### 2d. Persistence after turn-end

In the `finally` block of `handleSend` (line 2641+):

1. **`persistActiveMessages`** (line 2650) → `persistMessagesNow` (line 605) → `AsyncStorage.setItem(storageKey, JSON.stringify(clean))` — writes the full messages array to AsyncStorage.
2. **`saveEngineSession`** (line 2683) — saves native KV session with:
   ```tsx
   const payload = JSON.stringify(persistable);
   saveEngineSession(mid, historyHash(payload), persistable.length);
   ```
   `AiChatPage.tsx:2687–2688`
3. **`historyHash`** (`src/engine/sessionPersistence.ts:166`) is a djb2 hash of the full JSON-serialized messages array. Any change to the messages array produces a different hash.

### 2e. Summary of what the save mutates

| What | Mutated? | How |
|---|---|---|
| In-memory messages array | **Yes** | Truncated to `base` (messages before edited), then `handleSend` appends edited user + new assistant |
| AsyncStorage (messages) | **Yes** | `persistActiveMessages` writes the new array under `messagesKey(conversationId)` |
| Engine KV session | **Yes** | `saveEngineSession` saves with new `historyHash` and `historyMessageCount` |
| historyHash | **Yes** | Derived from JSON of new messages array — different from previous |
| Later turns | **Truncated** | The edit drops the original user message and ALL subsequent messages; only the new turn replaces them |
| Cache invalidation | **Implicit** | New `historyHash` means next restore will re-prefill from the new prefix; old KV is overwritten |
| `edited` badge | **Yes** | UI flag on the user bubble; persisted and restored |

---

## 3. Whether save truncates / invalidates / re-sends

**Yes, all three:**

1. **Truncates later turns:** `editMessage` explicitly slices `messagesRef.current.slice(0, idx)` — everything from the edited message onward is dropped before re-sending (line 3143).
2. **Invalidates cache:** `historyHash` changes because the messages array changed. The next `saveEngineSession` writes a new `.kvs` with the new hash. `sessionHistoryPrefixAccepts` (line 188) checks prefix hash — old sessions with different messages will not match.
3. **Re-sends:** `editMessage` calls `handleSendTracked` with `{ edited: true }`, which triggers a full generation cycle (prefill + decode) for the new assistant response.
4. **Only rewrites the user bubble (partially true):** the user bubble IS rewritten (with `edited: true` flag), but the old assistant response is also dropped and a new one is generated. It's not *only* the user bubble — it's a full re-send of the conversation from that point.

---

## 4. Regenera — implemented, dead UI, or truly absent

### Verdict: **Truly absent from the UI — product gap.**

Evidence:

1. **No UI entry point:** The action sheet (lines 4128–4225) has no "Regenera" row for either user or assistant messages. No button, no long-press action, no toolbar item anywhere in `AiChatPage.tsx`.

2. **i18n keys exist but are unused in UI:** `src/i18n/en.ts:512` defines `regenBusy: "Already regenerating"` and `src/i18n/en.ts:527` defines `regenFailed: "Regenerate failed"`. Italian equivalents exist at `src/i18n/it.ts:510,526`. These are referenced only by error-path `reasonKey` strings in the code (e.g., `return { ok: false, reasonKey: "chat.regenBusy" }`), never rendered as button labels.

3. **Infrastructure exists:** `src/engine/regenState.ts` exports `regenInFlightRef`, `regenAbortRef`, `regenGenerationRef`, `regenHandleSendPassRef` — a complete lock/abort/generation system. The `editMessage` function uses these locks. But no "regenerate" action triggers `regenInFlightRef = true` outside of `editMessage`.

4. **PLAN §3 and §7 list "modifica e rigenerazione"** as required scenarios. §13 (M1 protocol) requires "16 cicli per telefono: due ripetizioni di stop, modifica, rigenerazione, cambio chat…". The edit scenario is partially implementable (code exists, save unverified on device). **Regenerate is a missing feature, not a code defect.**

5. **The only "regenerate" reference in the UI** is a comment in `AppShell.tsx:4032`: `// Refuse model switch while edit/regenerate owns the turn.` — this is defensive code for a feature that has no UI trigger.

---

## 5. Known harness hole: adb input text vs React TextInput

### The hole

`adb input text` injects Android InputConnection events. React Native TextInput on Android does not consume these events into its controlled state — the native EditText receives the text but the React `value`/`onChangeText` binding does not fire. The TextInput appears blank or unchanged in the React state.

**Jelly session memory §9, §11 documents this:** "adb input text does not update the React TextInput state" and "no text change was typed (harness limit)".

### Existing in-app paths to change text without typing

| Path | What it sets | Can it reach the edit modal? |
|---|---|---|
| `kalsa://share?text=...` deep link | Composer draft via `mergeSharePrefill` (`src/app/shareIntent.ts:17`) | **No** — only sets the main composer `draft` state, not `editingMessage.draft` |
| `testID="message-action-edit"` | Opens the edit modal | **Yes** — but the TextInput inside has no testID |
| `TextInput` in edit modal | `editingMessage.draft` via `onChangeText` | **No programmatic path** — no testID, no deep link, no share intent targets it |

**Quote — the edit TextInput has no testID:**
```tsx
<TextInput
  value={editingMessage.draft}
  onChangeText={(v) =>
    setEditingMessage((prev) => (prev ? { ...prev, draft: v } : prev))
  }
  multiline
  autoFocus
  accessibilityLabel={t("chat.edit")}
  ...
/>
```
`AiChatPage.tsx:4258–4270` — no `testID` prop.

**Conclusion:** There is **no existing in-app path** to programmatically change the edited text without physical keyboard input. The `kalsa://share` scheme only affects the composer, not the edit modal. A testID on the edit TextInput would allow `uiautomator` to set text, but it does not exist today.

---

## 6. Classification

| Item | Classification |
|---|---|
| Edit save on device | **Missing device evidence** — code trace shows the flow is complete (truncate → re-send → persist → save KV), but no device proof exists that the save actually works end-to-end. The JELLY session proved reachability (EditText prefilled, Annulla/Salva visible) but could not exercise save because of the adb→TextInput hole. |
| Regenerate in UI | **Missing feature** — code infrastructure exists (regenState.ts, i18n strings) but no UI entry point connects to it. This is a product gap that blocks PLAN §13 M1 acceptance criteria. |
| adb→TextInput hole | **Known harness limitation** — not a code defect. Fixable by adding a testID to the edit TextInput + using `uiautomator` to set text. |

---

## 7. One-shot Jelly procedure to prove edit save (no code change)

This requires **physical keyboard input** (Bluetooth keyboard paired to Jelly) or **uiautomator with testID** (requires code change). Since the task says "no code change", the physical-keyboard path:

1. Pair a Bluetooth keyboard to the Jelly Star.
2. Open Kalsa, open an existing conversation with at least 2 user messages.
3. Long-press the second user message → tap "Altro" → tap "Modifica".
4. The EditText opens prefilled. Use the keyboard to delete the text and type a new message (e.g., "EDITED: modified text").
5. Tap "Salva".
6. **Observe:** the user bubble should update with the new text and an "edited" badge; a new assistant response should generate.
7. **Check logcat:** `KALSA_SESSION {"op":"save",...}` should appear with a new `historyHash` and `messageCount`.
8. **Check persistence:** force-stop the app, reopen the conversation. The edited user text and new assistant response should persist.

This procedure proves save without a code change. The only prerequisite is a physical keyboard — `adb input text` will not work.

---

## 8. Smallest fix if code change is acceptable

### For edit save verification (harness):

Add `testID="edit-text-input"` to the edit TextInput at `AiChatPage.tsx:4258`. Then use `uiautomator` to set text:
```
adb shell uiautomator dump /dev/tty | grep "edit-text-input"
adb shell input text "..."  # still won't work
# But: adb shell am broadcast -a com.github.uiautomator.ACTION_SET_TEXT --es text "..." 
# or: use adb shell input method to set text via IME
```

Actually, the simplest fix: **add `testID="edit-text-input"` to the TextInput** (`AiChatPage.tsx:4258`) so that a future `uiautomator`-based harness can target it. But even with testID, `adb input text` still won't drive React TextInput — the fix for the harness hole would be a **test-only `onLayout` or `useImperativeHandle`** that allows programmatic text injection.

### For Regenerate (feature):

Smallest implementation:
1. Add a "Regenera" row to the assistant message menu in the action sheet (`AiChatPage.tsx:4198`, after the Translate row, gated by `messageMenu.role === "assistant" && !sending`).
2. On tap: take the last user message text, truncate history to before the last assistant message, and call `handleSendTracked` with the last user text — same pattern as `editMessage` but without changing the text.
3. Add i18n key `chat.regen` with en:"Regenerate" / it:"Regenera".
4. Wire to existing `regenState.ts` locks.

**Files to change:** `src/screens/AiChatPage.tsx` (action sheet + new `regenerateMessage` function), `src/i18n/en.ts`, `src/i18n/it.ts`.

---

## 9. Exit codes and command log

```bash
$ cd /Users/marco/Projects/kalsa && git log --oneline -1
1edf5c6 chore(embed): add deterministic progress telemetry
$ cd /Users/marco/Projects/kalsa && git rev-parse origin/main
1edf5c662715a357c7aa74d16b9b2ab787688f6e
$ echo $?
0
```
