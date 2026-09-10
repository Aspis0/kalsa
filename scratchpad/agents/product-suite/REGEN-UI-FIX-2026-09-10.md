# Regen UI fix — report

Date: 2026-09-10
Repo: `/Users/marco/Projects/kalsa` @ `origin/main` (`1edf5c662715a357c7aa74d16b9b2ab787688f6e`)
Scope: expose the missing **Regenerate** entry point. Infrastructure (truncate + resend, locks, i18n) already exists — this change only adds UI wiring.

Status: **done, audit fix applied, verified**. Not committed, not pushed. Devices untouched. `PLAN.md` / `docs/ALIVE.md` untouched.

Hostile MiMo audit verdict: SHIP-WITH-FIXES, one must-fix → applied (see "Audit must-fix" below).

---

## Feature

Long-pressing an assistant bubble now offers **Regenerate**. Tapping it finds the nearest preceding user message and calls the existing `editMessage(userId, userText, { edited: false })`, which performs the same truncate-then-resend path already used by the Edit flow, without marking the unchanged user bubble as edited. No second truncate/send path was introduced.

---

## Audit must-fix (applied)

**Finding (confirmed):** Regenerate called `editMessage(target.id, target.text)`, and `editMessage` always did `handleSendTracked(..., { edited: true })` (~L3162). The re-appended user bubble therefore rendered the "Modifica" badge (`{m.edited ? ...}` at ~L5185) even though the text was unchanged → misleading.

**Fix (minimal, no new flag, no new badge):**

1. `editMessage` gained an optional third argument `opts?: { edited?: boolean }`; the default is `true`, so the existing **Modifica → Salva** path (`editMessage(id, draft)` at L4306) is byte-for-byte unchanged.
2. The Regenerate row passes `{ edited: false }`.
3. Single truncate/send path preserved — `editMessage` is still the only implementation; no duplication.

```ts
// src/screens/AiChatPage.tsx
type HandleSendOpts = { edited?: boolean };

const editMessage = useCallback(
  async (
    targetMsgId: string,
    newText: string,
    opts?: { edited?: boolean },
  ): Promise<{ ok: true } | { ok: false; reasonKey: string }> => {
    const editedFlag = editedFlagForResend(opts);
    ...
    const sendResult = await handleSendTracked(trimmed, target.attachments, {
      edited: editedFlag,
    });
```

The `Message.edited` doc comment ("True when the user edited this message text (edit-then-regen flow)") is now accurate: only a real text edit sets it.

---

## What already existed (quoted, relied on)

`src/screens/AiChatPage.tsx` — `editMessage` (~L3082) owns the truncate + resend + lock lifecycle (pre-fix form; the third argument and the final `edited` flag were extended by the audit fix above):

```ts
const editMessage = useCallback(
  async (targetMsgId: string, newText: string) => {
    if (regenInFlightRef.current || sendingRef.current || sendClaimRef.current) {
      return { ok: false, reasonKey: "chat.regenBusy" };
    }
    ...
    regenInFlightRef.current = true;
    regenAbortRef.current = new AbortController();
    ...
    const base = messagesRef.current.slice(0, idx).map((m) => m);
    setMessages(...);
    regenHandleSendPassRef.current = true;
    ...
    const sendResult = await handleSendTracked(trimmed, target.attachments, {
      edited: true,
    });
    ...
    } finally {
      if (regenGenerationRef.current === myGeneration) {
        regenInFlightRef.current = false;
        regenHandleSendPassRef.current = false;
        regenAbortRef.current = null;
      }
    }
  },
  [handleSendTracked],
);
```

Action sheet (~L4198) — Edit was the only gated row; the assistant branch had no Regenerate:

```tsx
{messageMenu.role === "user" && !sending ? (
  <AttachSheetRow ... label={t("chat.edit")} testID="message-action-edit" ... />
) : null}
```

`src/engine/regenState.ts` — shared locks, all owned by the generation counter:

```ts
export const regenInFlightRef: { current: boolean } = { current: false };
export const regenHandleSendPassRef: { current: boolean } = { current: false };
export const regenAbortRef: { current: AbortController | null } = { current: null };
export const regenGenerationRef: { current: number } = { current: 0 };
```

`src/i18n/en.ts` / `it.ts` — `chat.regenBusy` and `chat.regenFailed` already existed; only the label string was missing.

---

## Changes

### 1. New pure helper module — `src/screens/regenTarget.ts` (new, 43 lines)

`canRegen(role, sending)` is the pure form of the sheet gate (`assistant && !sending`).
`findRegenTarget(messages, assistantId)` scans backwards from the assistant bubble and returns the nearest preceding `{ id, text }`, or `null`.
`editedFlagForResend(opts)` resolves the badge flag — `opts?.edited ?? true` — so the Edit default and the Regenerate override are both pinned by a test without mounting the screen.

Kept out of `AiChatPage` so it is testable in the node Jest env (no component mounting, no added weight to the 5.8k-line screen).

### 2. Row wiring + `editMessage` opts — `src/screens/AiChatPage.tsx`

- Import `RefreshCw` from `lucide-react-native`; import `{ canRegen, editedFlagForResend, findRegenTarget }` from `./regenTarget`.
- `editMessage` takes `opts?: { edited?: boolean }` and forwards `edited: editedFlagForResend(opts)` to `handleSendTracked`.
- New assistant-only row, `testID="message-action-regen"`, gated `canRegen(messageMenu.role, sending)`:

```tsx
{canRegen(messageMenu.role, sending) ? (
  <AttachSheetRow
    icon={<RefreshCw size={18} color={colors.ink} />}
    label={t("chat.regen")}
    testID="message-action-regen"
    onPress={() => {
      const target = findRegenTarget(messagesRef.current, messageMenu.id);
      setMessageMenu(null);
      if (!target) {
        showVoiceNote(t("chat.regenFailed"));
        return;
      }
      void editMessage(target.id, target.text, { edited: false }).then((res) => {
        if (!mountedRef.current) return;
        if (!res.ok) showVoiceNote(t(res.reasonKey as any));
      });
    }}
    colors={colors}
  />
) : null}
```

- No lock acquire duplicated: `editMessage` remains the single owner of `regenInFlightRef` / `regenAbortRef` / `regenGenerationRef`.
- Missing preceding user → `chat.regenFailed`, no-op.
- The edit `TextInput` was **not** given a testID (not needed; no focused UI test).

### 3. i18n label

- `src/i18n/en.ts`: `regen: "Regenerate",`
- `src/i18n/it.ts`: `regen: "Rigenera",`

`chat.regenBusy` / `chat.regenFailed` reused as-is (surfaced via `showVoiceNote(t(res.reasonKey))`).

---

## Tests

`src/screens/regenTarget.test.ts` (new) — 10 tests, node Jest, no React mounting:

- gating: assistant + idle → row; assistant + sending → hidden; user → hidden;
- resolution: nearest preceding user id+text; skips back over prior assistant turns;
- missing preceding user → `null`; unknown assistant id → `null`;
- badge flag: no opts → `true` (**Edit → Salva unchanged**); `{ edited: true }` → `true`; `{ edited: false }` → `false` (**Regenerate**).

The `editMessage` call is a direct delegation of the helper's `{ id, text }` plus the resolved edited flag; the helper tests pin both the preceding-user resolution and the default-vs-false badge behaviour.

### Verification (real exit codes)

```
$ npx tsc --noEmit > /tmp/kalsa-tsc2.log 2>&1; echo $?
0

$ npx jest src/screens/regenTarget.test.ts > /tmp/kalsa-jest2.log 2>&1; echo $?
0
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

No full test-suite run.

---

## Changed paths

| Path | State |
| --- | --- |
| `src/screens/regenTarget.ts` | new (43 lines) |
| `src/screens/regenTarget.test.ts` | new (68 lines) |
| `src/screens/AiChatPage.tsx` | modified (+32 / −6) |
| `src/i18n/en.ts` | modified (+1) |
| `src/i18n/it.ts` | modified (+1) |

No other tracked file touched. Not committed, not pushed.

---

## git status (final, this repo)

```
 M src/i18n/en.ts
 M src/i18n/it.ts
 M src/screens/AiChatPage.tsx
?? archived/docs/AUDIT_HARNESS_GLM.md
?? archived/docs/AUDIT_HARNESS_GLM_REAUDIT.md
?? archived/docs/remeasure-2026-08-25/
?? archived/docs/repo-audit-2026-08-28/
?? device-decode-lineup-out/
?? n3.txt
?? out/
?? results/ciswire-campaign/
?? src/screens/regenTarget.test.ts
?? src/screens/regenTarget.ts
```

(The untracked `archived/`, `device-decode-lineup-out/`, `n3.txt`, `out/`, `results/` entries pre-existed this task and are unrelated.)
