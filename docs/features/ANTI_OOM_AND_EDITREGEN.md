# Edit/Regenerate + Anti-OOM — design v8 (real handleSend integration)

Date: 2026-08-11 · Branch: feature/anti-oom-and-editregen (off perf/fluidity-and-deviceprofile)
Scope: edit/regenerate UX + anti-OOM policy. No embedder. No CalaQwen.

> v8 = minimo v8. **Regen = una `handleSend` call** con `historySlice` (che già esiste in `AiChatPage`). Niente `regenOwnerRef` né `regenerateFlow.ts`. Aggiungo 3 righe a `handleSend` (controllo `regenInFlightRef` busy). Tutta la macchina (abort, fit, save, persist, owner) è quella che esiste già.

---

## 1. Constraints

- No Java/Kotlin. No giant files. No embedder. Tier model-dependent. Regen = una `handleSend` call. Edit = due `setMessages` atomic + regen.

---

## 2. Tier model-dependent (CRITICAL 1)

`fitMemoryEstimate` (esiste in `memoryEstimate.ts`) → 4 stati. `modelGateVerdict` permette `unknown` (allowed + flag). Allineato: `unknown` → allow + flag.

**Fit policy reale** (conservativa):
- `fits` → allow.
- `tight` → allow SE `MemAvailable >= 1.5 × required` (sample uncached) PRIMA di init. Altrimenti → refuse `model.tightNow`.
- `does_not_fit` → refuse `model.tooLarge`.
- `unknown` → allow + flag `model.memoryUnknown`.

**`required`** (byte-level): `requiredBytes = (model.sizeBytes + (model.mmproj?.sizeBytes ?? 0)) × repack + computeEstimateMiB(...) + KV_estimate`. mmproj è un **modello con opzionale mmproj**, non una cosa separata.

**Wrapper in `deviceProfile.ts`** (riusa `fitMemoryEstimate`):
```ts
export function evaluateModelFit(
  model: { sizeBytes: number; engineCtx: number; kvBytesPerToken?: number | null; mmproj?: { sizeBytes: number } | null },
  availableBytes: number | null,
): { verdict: "fits" | "tight" | "does_not_fit" | "unknown"; reasonKey: "model.tightNow" | "model.tooLarge" | "model.cannotEvaluate" | "model.memoryUnknown" }
```

**mmproj accounting call site**: `AppShell.tsx` — `gateForModel` attualmente passa `modelSizeBytes` solo. Modifica: `modelSizeBytes + (model.mmproj?.sizeBytes ?? 0)` (mmproj incluso per vision). `ModelGateVerdict.messageSizeBytes` viene accumulato esplicitamente.

**Prima di init in `handleSend`**: `sampleUncached()` + `evaluateModelFit(...)` → refuse `does_not_fit` con `model.tooLarge`. `tight` → see 1.5× check prima di init. `unknown` → allow + flag banner.

---

## 3. Anti-OOM — mitigazione non protezione

`src/engine/monitor.ts` (~80 righe): `getAvailableMemoryBytesUncached()` + `startMemoryMonitor(opts)`.

**Convenzione**: ogni decisione (load, regen, edit) **rilegge uncached prima** della decisione.

**Policy AppShell**:
- On `AppState → background` → se `streaming` OR `sending` OR `regenInFlightRef.current`: ABORT (abort + await `streamInFlightRef`), attendi `handleSendStream` finally, save SOLO SE `kvReproducible`, `disposeEngine` SOLO DOPO save.
- On `AppState → foreground` → `evaluateModelFit` (uncached) per modello corrente:
  - `fits` o `tight` → lazy restore.
  - `does_not_fit` o `unknown` → resta unloaded, UI banner.
- **Mai auto-load**.

`useProcessHealth()` (~40 righe): tick 15s, mostra `availableMemoryBytes`, `fitTier`, `unloadedReason`.

---

## 4. ThermalMonitor minimale

`useThermalMonitor({ intervalMs = 30000 })` (~50 righe): advisory. `availableMemoryBytes` proxy + tenta `/sys/class/thermal/thermal_zone0/temp`. Nessun unload automatico.

---

## 5. Edit / Regenerate — RIUSA `handleSend` (CRITICAL 3, HIGH 4, 6 chiusi v8)

`handleSend(text, currentAttachments?)` esiste in `AiChatPage.tsx:1341`. Tutta la macchina (abort, fit, save, persist, owner) è già questo. Regen = una `handleSend` con `historySlice` (già passato internamente tramite `messagesRef.current`).

### Mutazione a `handleSend` (3 righe, file esistente)

```ts
// AiChatPage.tsx:1341
const handleSend = useCallback(async (text: string, currentAttachments?: LocalAttachment[]) => {
  const trimmed = text.trim();
  if (
    !trimmed ||
    sendingRef.current ||
    translationInFlightRef.current ||
    voiceBusyRef.current ||
    regenInFlightRef.current ||     // <-- AGGIUNTO (regen in corso)
    !!pdfToRender ||
    !historyLoaded
  ) { return; }
  // ... unchanged ...
});
```

### Edit `Message` type + sanitizer + validator

```ts
// Message type
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  streaming?: boolean;
  edited?: boolean;     // <-- AGGIUNTO
  // ... existing fields
}
```

`sanitizeHistoryMessages` (`AiChatPage.tsx:450+`): inclusione esplicita `if (m.edited) out.edited = true;` per preservare il flaggedit. `validateHistoryMessages` (`AppShell.tsx:505+`): inclusione `edited` nell'output record.

### Flow `regenerate(targetMsgId)` (in `AiChatPage.tsx`)

```ts
const regenInFlightRef = useRef(false);
const regenAbortRef = useRef<AbortController | null>(null);

const regenerate = async (targetMsgId: string) => {
  if (regenInFlightRef.current) { /* refuse + t("chat.regenBusy") */ return; }
  regenInFlightRef.current = true;
  const snapshot = messagesRef.current.slice();
  const targetIndex = messagesRef.current.findIndex(m => m.id === targetMsgId);
  if (targetIndex < 0) { regenInFlightRef.current = false; return; }
  // 1. truncate to target (atomic)
  setMessages(prev => prev.filter((_, i) => i <= targetIndex));
  // 2. find ORIGINAL user text BEFORE the target (the user message that produced the target assistant)
  const originalUserText = findOriginalUserText(messagesRef.current.slice(0, targetIndex + 1));
  if (!originalUserText) { /* rollback, refuse */ regenInFlightRef.current = false; return; }
  // 3. handleSend handles abort, fit, save, persist
  regenAbortRef.current = new AbortController();
  try {
    await handleSend(originalUserText);
    // Stale guard: if another send resetted sendRunIdRef, drop
  } catch (err) {
    setMessages(snapshot);
    setStreaming(false);
  } finally {
    regenInFlightRef.current = false;
  }
};
```

### Flow `edit(targetMsgId, newText)` (atomic single-pass)

```ts
const edit = async (targetMsgId: string, newText: string) => {
  if (regenInFlightRef.current) { /* refuse */ return; }
  regenInFlightRef.current = true;
  const snapshot = messagesRef.current.slice();
  try {
    if (streamInFlightRef.current) abortController.abort();
    await new Promise(res => setTimeout(res, 0)); // microtask break
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === targetMsgId);
      if (idx < 0) return prev;
      return [
        ...prev.slice(0, idx + 1).map(m => m.id === targetMsgId ? { ...m, text: newText, edited: true } : m),
      ];
    });
    const originalUserText = findOriginalUserText(messagesRef.current.slice(0, idx + 1));
    if (originalUserText) await handleSend(originalUserText);
  } catch (err) {
    setMessages(snapshot);
    setStreaming(false);
  } finally {
    regenInFlightRef.current = false;
  }
};
```

`findOriginalUserText(slice)`: traverse the slice backwards, find the last user message BEFORE the target. Return its text.

### Model switch + navigation
- `selectModelById` (AppShell): check `regenInFlightRef.current` → refuse con `t("chat.regenBusy")`. Cancel `regenInFlightRef` su switch completed.
- Navigation: `AiChatPage` mounted (Settings overlay) → regen continua.

### UI
- Message menu (assistant, fg, non-streaming): "Rigenera".
- Inline edit (user): "Modifica" → `TextInput` con Save/Cancel. `aria-label` su entrambi.
- `model.memoryUnknown` banner quando fit restituisce `unknown`.

---

## 6. File list

| | file | righe delta |
|---|---|---:|
| nuovo | `src/engine/monitor.ts` | ~80 |
| nuovo | `src/hooks/useThermalMonitor.ts` | ~50 |
| nuovo | `src/hooks/useProcessHealth.ts` | ~40 |
| nuovo | `scripts/device/anti_oom_harness.mjs` | ~150 |
| nuovo | `scripts/mutation/regen_harness.mjs` | ~120 |
| edit | `src/engine/deviceProfile.ts` | ~30 |
| edit | `src/app/AppShell.tsx` | ~30 (gateForModel mmproj + AppState regen + startMemoryMonitor) |
| edit | `src/screens/AiChatPage.tsx` | ~200 (regenInFlightRef, regenAbortRef, regenerate, edit, edited flag, message menu) |
| edit | `src/screens/SettingsScreen.tsx` | ~50 |
| edit | `src/i18n/{en,it}.ts` | ~13 ciascuno |

Totale: ~766 righe delta; ~440 nuovi. 11 file.

---

## 7. i18n keys

| key | EN | IT |
|---|---|---|
| `chat.regenerate` | "Regenerate" | "Rigenera" |
| `chat.edit` | "Edit" | "Modifica" |
| `chat.cancelRegenerate` | "Cancel regenerate" | "Annulla rigenera" |
| `chat.regenCostHint` | "Reload — may take several seconds" | "Ricarica la risposta — può richiedere diversi secondi" |
| `chat.regenBusy` | "Already regenerating" | "Rigenera già in corso" |
| `model.tooLarge` | "Not enough memory for this model" | "Memoria insufficiente per questo modello" |
| `model.cannotEvaluate` | "Cannot determine memory, free space and try" | "Impossibile determinare la memoria, libera spazio e riprova" |
| `model.tightNow` | "Memory low — regenerate not supported, free" | "Memoria ridotta — la rigenerazione non è supportata, libera" |
| `model.memoryUnknown` | "Memory could not be determined — policy used unknown" | "Memoria non determinata — policy usata unknown" |
| `chat.unloaded` | "Unloaded due to memory pressure" | "Scaricato per pressione di memoria" |
| `chat.lazyReload` | "Tap to reload" | "Tocca per ricaricare" |
| `chat.thermalHot` | "Device warm" | "Telefono caldo" |
| `chat.regenFailed` | "Regenerate failed" | "Rigenera fallita" |

---

## 8. Telemetria schema

- `model.fit` { verdict, availableMb, modelMbNonEvictable }
- `model.unload` { reason }
- `model.load` { durationMs, fitVerdict, availableMb }
- `regen.fail` { reason: "abort" | "fit" }
- `regen.duration` { durationMs, availableMb }
- `pressure.transition` { fromMb, toMb, tier }

Sink: `console.info`.

---

## 9. Verifica

- `npm run typecheck` exit 0.
- `node scripts/device/anti_oom_harness.mjs`: 4GB/2B per `fits|tight|does_not_fit|unknown`; mmproj accounting; bg+save+unload sequencing; fg+lazy restore.
- `node scripts/mutation/regen_harness.mjs`: regen = `handleSend(originalUserText)` atomic; edit array-index splice; due regen racing → uno rifiuta (`regenInFlightRef`); aborted regen restore snapshot; persistent `.kvs` rollback NON attempted (documented).
- Reviewer ostile sul diff PRIMA del commit finale.

---

## 10. Confini

In scope: edit/regenerate UI + logica, anti-OOM polling + AppState hooks, tier model-dependent (mmproj incluso), ThermalMonitor advisory, telemetry schema.

Out of scope: embedder ibrido, CalaQwen premium, MoE-flash bandwidth tier policy.

---

## 11. API contract (v8, allineato a codice reale)

```ts
// monitor.ts
export function getAvailableMemoryBytesUncached(): Promise<number | null>;
export type AppStateHandler = (state: "active" | "background") => void;
export function startMemoryMonitor(opts: { intervalMs?: number; onAppState: AppStateHandler; onPressure: (b: number | null) => void; stop: () => void }): { stop: () => void };

// deviceProfile.ts
export function evaluateModelFit(
  model: { sizeBytes: number; engineCtx: number; kvBytesPerToken?: number | null; mmproj?: { sizeBytes: number } | null },
  availableBytes: number | null,
): { verdict: "fits" | "tight" | "does_not_fit" | "unknown"; reasonKey: "model.tightNow" | "model.tooLarge" | "model.cannotEvaluate" | "model.memoryUnknown" };

// AiChatPage.tsx (existing handleSend with 1-line added)
const handleSend = useCallback(async (text: string, currentAttachments?: LocalAttachment[]) => {
  // ... existing body, with regenInFlightRef.current added to busy condition ...
});
const regenInFlightRef = useRef(false);
const regenAbortRef = useRef<AbortController | null>(null);
const regenerate = (targetMsgId: string) => Promise<{ ok: true } | { ok: false; reasonKey: string }>;
const edit = (targetMsgId: string, newText: string) => Promise<{ ok: true } | { ok: false; reasonKey: string }>;
```

---

## 12. Insight MEMORY

MoE vs dense on-device (2026-08-11): 4B dense → RAM; Marco 17B-A0.9B → flash 190 MiB/tok. v1 copre solo densi; v2 (CalaQwen) richiede `model.flashBudget`.

---

## 13. STOP al piano

v8 è integrato al codice reale: regen = `handleSend(originalUserText)`, edit = splice + regen. Anti-OOM monitor + tier policy + edited flag + mmproj accounting tutti edge-defined. Ready per reviewer ostile finale.
