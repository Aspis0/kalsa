# THINK-COPY-RECON-2026-09-10

Two questions from tonight's Jelly traces. Read-only, no edits.

---

## 1. Thinking budget — can short/fast turns lock 1024?

### Owner rule (10/09)

> LFM short 512 / extended 1024; default extended iff decode EMA ≥ 5 tok/s.
> Jelly measured 3.4 → 512; S23 10–11 → 1024.

### Tonight's trace

```
KALSA_THINKING {"budget":1024,"decodeTokPerSec":5.736…}  (turn 11/12)
```

On Jelly, the EMA crossed 5.0 → `resolveThinkingParams` chose extended (1024).

### Code path

**`thinkingBudgets.ts:15`** — the threshold:
```ts
export const EXTENDED_THINKING_MIN_DECODE_TOK_PER_SEC = 5;
```

**`thinkingBudgets.ts:88–95`** — the decision (mode `"default"`):
```ts
const extended =
  speed?.decodeTokPerSec !== null &&
  speed?.decodeTokPerSec !== undefined &&
  speed.decodeTokPerSec >= EXTENDED_THINKING_MIN_DECODE_TOK_PER_SEC;
const budget = extended
  ? positiveBudget(model?.thinking?.extended, 512)
  : positiveBudget(model?.thinking?.short, 256);
```

**`LlamaService.ts:3021–3022`** — how the speed value reaches the decision:
```ts
const decodeTokPerSec = activeModel
  ? getDecodeTokPerSec(activeModel.id)    // ← EMA lookup
  : null;
const { fields: thinkingFields, nPredict } = resolveThinkingParams(
  thinkingMode, activeModel, { decodeTokPerSec },
);
```

### EMA update — who feeds it?

**`decodeSpeed.ts:6–7`** — hard floor:
```ts
const EMA_ALPHA = 0.3;
const MIN_ACCEPTED_PREDICTED_TOKENS = 16;
```

**`decodeSpeed.ts:18–31`** — the sampler:
```ts
export function recordDecodeSample(modelId, predictedN, predictedMs) {
  if (!isUsableSample(predictedN, predictedMs)) return;
  const tokPerSec = (predictedN / predictedMs) * 1000;
  const previous = tokPerSecByModel.get(modelId);
  tokPerSecByModel.set(modelId,
    previous === undefined
      ? tokPerSec
      : EMA_ALPHA * tokPerSec + (1 - EMA_ALPHA) * previous,
  );
}
```

**`LlamaService.ts:973–975`** — the call site:
```ts
if (!r.interrupted) {
  recordDecodeSample(model.id, r.tokensPredicted, r.predictedMs);
}
```

`tokensPredicted` = `result.tokens_predicted` (thinking + response tokens). `predictedMs` = `timings.predicted_ms` (decode wall-clock). Only criterion: ≥16 predicted tokens and not interrupted.

### Verdict: defect, not intended

**The threshold value `5` matches the owner rule** (`thinkingBudgets.ts:15` = `EXTENDED_THINKING_MIN_DECODE_TOK_PER_SEC = 5`, exactly the 10/09 decision). The issue is **what feeds the EMA, not the threshold itself**.

The EMA accepts every non-interrupted turn with ≥16 predicted tokens (`decodeSpeed.ts:11,26`). There is no filter for:
- **Turn length** — a 1-token "ciao" with 1024 thinking tokens counts (predictedN = ~1025 >> 16).
- **Content type** — CoT-only output counts equally with substantive answers.
- **Recency weighting against turn type** — a fast 2-second decode of 12 thinking tokens + "ciao" at 625 tok/s pumps the EMA with `EMA_ALPHA = 0.3`.

A short completed turn ("ciao") or a short decode burst **can** push the EMA over 5.0 and lock 1024 for subsequent turns. The 0.3 alpha means one fast sample shifts the EMA by ~30% toward the new value; a few consecutive short/fast turns can permanently lift the EMA above threshold on a device that genuinely decodes at 3.4 tok/s on substantive turns.

**Short-turn samples should be excluded** or at minimum weighted down. The `MIN_ACCEPTED_PREDICTED_TOKENS = 16` floor (`decodeSpeed.ts:11`) is far too low to filter short completions — a thinking turn easily produces 100+ predicted tokens even when the visible answer is one word.

### Specific concern for Jelly

The owner rule was calibrated on sustained decode speed (3.4 measured on Jelly). The EMA is now polluted by non-sustained samples. On S23/Xiaomi the EMA is always ≥5 anyway (10–11 tok/s), so the misfire is harmless there. On Jelly, where the threshold is the dividing line, the pollution directly controls whether the model gets 1024 vs 512 thinking tokens — a quality and latency consequence.

---

## 2. Message action sheet Copy — inverted gate

### The line

**`AiChatPage.tsx:4164`**:
```tsx
{!messageMenu.text.trim() ? (
  <AttachSheetRow
    icon={<BrandIcon name="copy" size={22} />}
    label={copiedFlash ? t("common.copied") : t("common.copy")}
    testID="message-action-copy"
    onPress={() => {
      void copyTextToClipboard(messageMenu.text);
      ...
    }}
    colors={colors}
  />
) : null}
```

Copy appears in the action sheet **only when `text.trim()` is falsy** (empty).

### Gate the sheet itself

**`AiChatPage.tsx:3244–3252`** — `openMessageMenu`:
```ts
if (
  streaming ||
  sendingRef.current ||
  translationInFlightRef.current ||
  regenInFlightRef.current ||
  (!text.trim() && !hasAttachments)
) {
  return;
}
```

The sheet **will not open** for empty text without attachments. It opens only when:
1. `text.trim()` is non-empty, OR
2. `hasAttachments` is true.

### Inline chips

**`AiChatPage.tsx:5157–5170`** — user messages:
```tsx
{!m.streaming && (hasText || hasAttachments) ? (
  <View ...>
    {hasText ? (
      <MessageActionChip ... label={t("common.copy")} ... />
    ) : null}
    <MessageActionChip ... label={t("chat.more")} ... />
  </View>
) : null}
```

Inline Copy chip shows when `hasText` = `!!m.text.trim()` — i.e., **non-empty text**.

**`AiChatPage.tsx:5342`** — assistant messages:
```tsx
<MessageActionChip
  icon={<BrandIcon name="copy" size={18} />}
  label={t("common.copy")}
  onPress={() => onCopyText(m.text)}
  ...
/>
```

Always present on assistant messages (text always non-empty).

### Verdict: defect (inverted gate)

The sheet opens only for non-empty text, but the Copy button inside renders only for empty text. **The Copy option in the action sheet is unreachable for its intended use case.**

Three possible explanations:

1. **Inverted condition** — `!messageMenu.text.trim()` should be `!!messageMenu.text.trim()`. This is the most likely reading: the sheet provides Copy + Translate + Read aloud + Edit for non-empty messages, and Copy should be among them.

2. **Leftover from attachment-only sheet** — when the long-press sheet was introduced, it may have handled attachment-only messages (empty text, non-empty attachments), where Copy was irrelevant. The condition was never updated when text support was added.

3. **Intentional backup for attachment-only messages** — a message with attachments but no text would open the sheet (passes the `!text.trim() && !hasAttachments` gate because `hasAttachments` is true), and the Copy button would appear to copy the empty text. This is harmless but useless.

The condition is **not intentional in the useful sense**: it provides Copy where text is empty (nothing to copy) and omits it where text is present (the one case Copy matters). **Intended behavior** is almost certainly that the Copy row renders when `messageMenu.text.trim()` is truthy, matching the inline chip logic at `AiChatPage.tsx:5167`.

### Consequence

On a long-press of any non-empty user or assistant message, the action sheet shows Translate, Read aloud, and Edit — but **not Copy**. The user must rely on the inline chip (which disappears during streaming). On assistant messages the inline chip is always present, but on user messages it is hidden during streaming. So the Copy-in-sheet gap matters most for user messages mid-stream.
