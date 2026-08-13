# TTFT audit — Kalsa (ai-chat): where the minutes before the first token go

READ-ONLY audit of `C:\Users\gualt\Desktop\Kalsa\ai-chat` @ 82590ad (2026-08-13). Every claim carries `file:line` from the repo. Engine facts from the research campaign were used for calibration and NOT re-verified.

---

## TL;DR (the 4 causes, in order of impact)

1. **The engine is disposed on every background transition and never preloaded** (`AppShell.tsx:2030-2140` dispose on `AppState → background`; `AppShell.tsx:2144-2190` foreground does fit-check only, "Never auto-load"). The model loads lazily on **first send** (`AppShell.tsx:3534`). On a phone, most sends happen after a background cycle or app relaunch, so every such send pays: embedder-release wait + `initLlama` (GGUF mmap + mlock + KV alloc) + optional session restore + prefill. That is tens of seconds to minutes **before the first token, on every phone, including the 2B** — because it is mostly *model load*, not prefill.

2. **Full-conversation re-render with a sliding window (compaction OFF by default)** — `assembleEngineHistory` sends only the last 20 messages (`compactor.ts:421-432`, `LEGACY_MAX_HISTORY=20` at `compactor.ts:128`). The window *slides*: at message 21 the oldest message drops, the token stream diverges right after the system prompt, and llama.rn's prefix match (`rn-completion.cpp:429`) collapses to `n_common ≈ system prompt` → **full re-prefill of up to 20 × 4000-char messages**. With 2B prefill ≈ 20–40 t/s (campaign facts), a realistic 10–20k-token window costs **~4–8 min on S23, ~8–16 min on G99**. This is exactly the reported symptom, and it recurs every ~20 messages.

3. **Turn-to-turn KV reuse is silently fragile** (see Q3): tool turns, miniapp strips, think blocks, and memory-fact changes all make the re-rendered prompt diverge from the KV content, forcing tail (or full) re-prefill. Tool turns are a headline feature; the divergence is silent — nothing in the UI or telemetry surfaces it per turn.

4. **App relaunch is cold almost always**: the KV session save is gated on `kvReproducible` + disk headroom (`sessionPersistence.ts:107-112, 150-165`). Any session whose **last** turn used tools/miniapp/think is unrestorable (save skipped), and a foreground process death (the common Android kill path) also leaves the meta hash stale → `tryLoadEngineSession` deletes the artifacts and restores nothing (`sessionPersistence.ts:163-176`, `LlamaService.ts:1338-1356`). Relaunch → cold prefill of the whole window.

Good news: the app already has a serious KV-session design (save/restore, byte-stability tracking, hybrid state-checkpoint patch). The gaps are *policy* (dispose-on-background, lazy load, compaction default OFF) and *divergence classes* (tools/miniapp/think/facts), not missing infrastructure.

---

## Q1 — n_ctx / context params

**Values.** `initLlama` params built in `LlamaService.ts:717-737`:
- `n_ctx` = `resolveContextProfile(...)` result resolved once by the caller (`AppShell.tsx:2505-2511`, 2980): catalog `engineCtx` is authoritative, RAM may only upgrade hybrids on ≥7.5 GB devices to 16384 (`contextProfile.ts:112-139`, `HIGH_RAM_N_CTX = 16384`, `DEFAULT_N_CTX = 8192`).
  - qwen3.5-2b: `engineCtx: 16384` **always** (`ModelRegistry.ts:188` — "never downgrade").
  - qwen3.5-4b: `8192` → 16384 on high-RAM (`ModelRegistry.ts:118`).
  - qwen3.5-4b-q3: `8192` (`ModelRegistry.ts:151`).
- KV type: **quantized, not f16** — `cache_type_k: q8_0`, `cache_type_v: q4_0` (2B/4B, `ModelRegistry.ts:120,190`), q4_0/q4_0 for Q3 (`ModelRegistry.ts:153`). `kv_unified: true` for hybrids (`LlamaService.ts:734`).
- RAM clamp: `resolveEngineTuning` may shrink n_ctx when MemAvailable is known and insufficient, floor 2048 (`deviceTuning.ts:217, 470-577`); `effectiveNCtx` reported back (`LlamaService.ts:686-688`).
- **No user-facing n_ctx setting**: `explicitNCtx` exists (`contextProfile.ts:117-130`) but is never passed by the app (bench/tests only).
- KV buffer sizes at init: 2B ≈ 4.88 KiB/token × 16384 ≈ **78 MiB** (`ModelRegistry.ts:193-195`); 4B hybrid ≈ 16 KiB/token × 16384 ≈ **256 MiB** (`contextProfile.ts:3-7`). Reserved once at `initLlama`; not a per-turn cost.

**Verdict Q1:** n_ctx is capped and KV is quantized; the "262K default" trap is not present. Not the cause.

## Q2 — per-message prompt construction

**Path (user hits send):**
`AiChatPage.handleSend` (`AiChatPage.tsx:1615`) → `onSendStream` = `AppShell.handleSendStream` (`AppShell.tsx:3380`) → **`ensureEngineForModel` first** (`AppShell.tsx:3534`) → history assembly `assembleEngineHistory(validatedHistory, ...)` (`AppShell.tsx:3745-3767`, `compactor.ts:421`) → `streamAssistantTurn(engineMessages, ...)` (`AppShell.tsx:3830`) → **`engine.completion({ messages: currentMessages, ... })`** (`LlamaService.ts:1814-1863`).

- **Yes: the FULL conversation (system prompt + history + current user message) is re-rendered and re-sent on every message.** System prompt rebuilt every turn (`LlamaService.ts:1603`, `buildSystemPrompt` at `LlamaService.ts:251-268`); history rebuilt every turn from persisted messages.
- **No explicit `n_past` / prompt-caching / session params are passed from JS.** KV reuse relies entirely on llama.rn's native prefix match: `loadPrompt` → `find_common_prefix_length(embd, text_tokens)` → `n_past = n_common` (`node_modules/llama.rn/cpp/rn-completion.cpp:429, 455`). The KV persists across `completion()` calls on the same context; chat turns intentionally never call `clearCache` (`LlamaService.ts:2185-2190`).
- **Within a tool turn**, each round re-calls `completion()` with the appended tool messages (`LlamaService.ts:1932-1990`) — the tool blocks were just decoded, so rounds 2+ are warm by the same prefix match.

So warm-turn reuse IS the design and works **if and only if the re-rendered prompt is byte-identical** to what is in the KV.

## Q3 — template stability: every dynamic element in the prompt prefix

Static parts (verified stable): system prompt is fully static per locale + `hasTools` (tools wired every turn, `sessionPersistence.ts:131-141`; strings at `i18n/en.ts:881-935`); thinking is off by default with stable fields (`thinkingBudgets.ts:40-60`); compaction operative block rides on the **last user message** (format B, `LlamaService.ts:1440-1457`) — KV-safe by design (`docs/RESEARCH_CONTEXT_LOSS.md:104`); per-message 4000-char truncation is deterministic (`compactor.ts:421-432`).

Dynamic elements that break the prefix (ranked):

| # | Element | Where | Effect on KV reuse |
|---|---------|-------|--------------------|
| D1 | **Sliding window (compaction OFF, default)** | `compactor.ts:128, 421-432` | At the 21st message, oldest drops → tokens diverge right after system prompt → **full re-prefill of the window** every 20 messages |
| D2 | **Memory facts in system prompt** (memory ON, opt-in default OFF) | `LlamaService.ts:258-268`; extract after every turn: `AppShell.tsx:3460-3500`, `LlamaService.ts:2207-2260` | New fact appended → system prompt changes at its end → divergence at that token → **all history after the system prompt re-prefills**; worse, `extractMemory` calls **`engine.clearCache()`** (`LlamaService.ts:2222-2226`) → next turn is 100% cold |
| D3 | **Tool turns (web_search/fetch/document_chat)** | `LlamaService.ts:1932`, `kvReproducibility.ts:38-53` | `tool_calls`+`tool` messages live only in KV, never persisted → next turn's re-render omits them → `n_common` stops at the tool-call position → tail re-prefill; also marks `kv_not_reproducible` → session save skipped |
| D4 | **Miniapp JSON strip** | `AiChatPage.tsx:2253` (`markKvNonReproducible("miniapp_stripped")`) | KV holds the JSON, history doesn't → divergence at that assistant message |
| D5 | **Think blocks** (only when bench thinking budgets on) | `thinkStream.ts` (cleaner), `LlamaService.ts:1639-1642` | KV holds raw `<think>` tokens; persisted text is stripped → divergence at that message |
| D6 | **Edit / regenerate** | `AiChatPage.tsx:2547-2622` | Re-render with changed text → divergence (unavoidable, expected) |
| D7 | **Locale change / model switch mid-session** | `sessionPersistence.ts:131-141` (promptEnvHash), `AppShell.tsx:2701-2724` | Correct cold start, but model switch also uses the **stale boot hash** (`AppShell.tsx:2044, 2566`) — `resetBootHistoryHash` is called only in the background path (`AppShell.tsx:2107`) |

No timestamps, battery, or other ephemeral values are injected into the prompt (checked `buildSystemPrompt`, `applyOperativeBlockFormat`, `buildOperativeBlock`, i18n strings). That class of bug is absent.

**Silent-failure note:** none of D1–D5 is visible per turn — no log line in production telemetry names "reuse broke at token X" (the KALSA_KVDIAG/KVDIAG0 diagnostics exist only in the native patch for the restore path, `patches/llama.rn+0.12.8.patch`).

## Q4 — app restart / session restore

**Save** (`saveEngineSession`, `LlamaService.ts:1115-1240`): end-of-turn fire-and-forget (`AiChatPage.tsx:2259-2277`) and on background (`AppShell.tsx:2085-2090`); gates: context present, not disposing, KV holds chat, `kvReproducible` (`sessionPersistence.ts:150-165`); disk headroom = `nCtx × 64 KiB × 1.5` (`sessionPersistence.ts:107-112`, `hasEnoughDiskForSession:220-228`); atomic tmp→rename with `.bak`; meta written last (historyHash, promptEnvHash, nCtx, KV types, spec, engineKnob).

**Restore** (`tryLoadEngineSession`, `LlamaService.ts:1252-1360`, called from `initEngine` at `LlamaService.ts:842-853` with `sessionRestore` from `AppShell.tsx:2566-2572`): `initLlama` → meta comparison (`sessionMetaMismatchField`, `sessionPersistence.ts:154-176`) → `context.loadSession(...)` → **hybrid state-checkpoint adoption** (Kalsa patch #2, `patches/llama.rn+0.12.8.patch` JSISession.h; without it Qwen3.5 restore silently re-prefills, `rn-completion.cpp:474-497`).

**Gaps found:**
- **Foreground process death** (the normal Android kill): last turn(s) unsaved → meta hash ≠ boot hash → restore refused **and artifacts deleted** (`sessionPersistence.ts:163-176`) → cold relaunch.
- **Sessions ending on a tool/miniapp/think turn are unrestorable** (save skipped by design) — common with web search.
- **Disk gate is steep**: 16k ctx requires **≥1.5 GiB free** (`nCtx×64KiB×1.5`); phones under that always skip save (`reason: "disk"`, `LlamaService.ts:1150-1153`) → restore never works → every relaunch cold.
- Restore (when it happens) runs **inside the first-send critical path** (`initEngine` → `tryLoadEngineSession`), adding `.kvs` read (78–256 MiB) to message-1 TTFT.

## Q5 — load path UX

- **When:** lazy only — first send (`AppShell.tsx:3534`) or model-chip tap (`AppShell.tsx:4008-4020`). **Never at app start** (boot check is download-presence only, `AppShell.tsx:2290-2310`).
- **Background:** abort stream → await lifecycle → save → **`disposeEngine`** (`AppShell.tsx:2030-2140`). **Foreground:** fit-check only, no auto-load, banner if `does_not_fit`/`unknown` (`AppShell.tsx:2144-2190`; policy doc `docs/ANTI_OOM_AND_EDITREGEN.md` §3).
- **First send serializes:** embedder release wait (≤ `EMBEDDER_RELEASE_TIMEOUT_MS = 15 s`, `EmbeddingService.ts:210`) → RAM/disk probes → `initLlama` (mmap + mlock + KV alloc 78–256 MiB + multimodal init if vision) → session restore → prefill → tokens.
- **What the user sees:** the assistant bubble appears immediately with `statusLabel: "Writing"` (`AiChatPage.tsx:1873`, `i18n/en.ts:415`); the model chip shows "Loading…" (`i18n/en.ts:97`). **No progress, no elapsed time, no load-vs-prefill distinction** — `onStatus` fires only inside `streamAssistantTurn` (`LlamaService.ts:1701-1704`), i.e., after init + restore complete. From the user's view, "Writing…" covers init + restore + prefill + decode.

## Q6 — Quick wins (ranked by expected TTFT impact)

### (a) Config-only changes
1. **Compaction ON by default** (`COMPACTION_ENABLED_KEY`, `compactor.ts:114`, read at `AppShell.tsx:3562-3567`). The append-only boundary design already exists precisely to avoid D1 (`docs/RESEARCH_CONTEXT_LOSS.md:104`). Removes the periodic full re-prefill at the 20-message window edge. **Estimate: −30…−90% TTFT on the turns that currently hit the window edge (turn ≥21 of any session); zero risk.**
2. **Eager engine init at app start** (when model downloaded), instead of first send. Moves `initLlama` + optional restore off the critical path. **Estimate: −60…−120 s on message 1 per app launch on mid phones.**
3. **Do not dispose on background; evict only on real memory pressure** (or make eviction opt-in). This is the single biggest "every phone" win — every background→send cycle currently pays full init + restore + (often) cold prefill. The monitor already samples MemAvailable every 15 s (`monitor.ts:23-90`); use pressure, not AppState, as the eviction trigger. **Estimate: removes tens of seconds to minutes from every post-background message.**

### (b) Small code changes
4. **Move memory facts to the user-prefix tail** (same format-B trick as the digest, `LlamaService.ts:1440-1457`): facts would ride on the current user message instead of the system prompt, so new facts re-encode only the tail. Also **skip `clearCache` in `extractMemory`** by running it on a separate context (the app already maintains an embedder context concept, `llamaContextGate.ts:86-124`) or by restoring the pre-extract checkpoint afterwards. **Estimate: with memory ON, −90% on turns following extraction; also fixes the current every-turn full-cold when memory is enabled.**
5. **Restore eagerly at boot** (paired with #2): if meta matches, `loadSession` at startup so message 1 after relaunch is warm. **Estimate: −1…−10 min on message 1 after relaunch when the session is restorable.**
6. **Fix the disk gate**: 1.5 GiB free requirement for a 16k session (`sessionPersistence.ts:107-112`) silently disables restore on low-storage phones; scale the requirement to *used tokens* (KV bytes per token × tokens in history) instead of full n_ctx. **Estimate: restores warm relaunch on the phones where it currently never triggers.**
7. **Persist tool blocks** (assistant `tool_calls` + `tool` messages) into history so re-renders match KV; then D3 stops re-prefilling the tail and sessions ending on tool turns stay restorable. Medium-small; must keep the privacy shape (tool *queries* are already scrubbed; only the tool-call structure + results need persistence, and results are already stored for sources display).
8. **Surface load progress in the chat bubble**: "Loading model… (12 s)" → "Prefilling… (45%)" using `modelState`/`onStatus`. Pure UX + diagnostics; also the honest label distinguishes init from prefill in field reports.
9. **Refresh the boot hash on model switch** (`AppShell.tsx:2701-2724`): currently a mid-session switch restores nothing because the boot hash is stale (D7).

### (c) Engine-side (research repo, not the app)
10. **Streaming prefill progress callback** from llama.rn (tokens evaluated / total) so the app can render real prefill progress and users stop perceiving a hang.
11. **Verify hybrid restore after process death on-device** with the KALSA_KVDIAG logs (`patches/llama.rn+0.12.8.patch`): the state-checkpoint adoption fix exists; measure that restore after a real kill (not background-dispose) actually yields n_past > 0.
12. **Measure per-turn tokenization/JSI marshalling cost** of re-sending the full messages array (likely ≪1 s — skip unless it shows up in profiles).

---

## Evidence index (file:line)
- Lazy load on first send: `AppShell.tsx:3534`; chip tap `AppShell.tsx:4008-4020`; boot = download check only `AppShell.tsx:2290-2310`.
- Background → dispose: `AppShell.tsx:2030-2140` (dispose at 2123-2132); foreground no auto-load: `AppShell.tsx:2144-2190`; policy `docs/ANTI_OOM_AND_EDITREGEN.md` §3.
- n_ctx resolution: `AppShell.tsx:2505-2511`, `contextProfile.ts:112-139`; catalog values `ModelRegistry.ts:118,151,188`.
- initLlama params: `LlamaService.ts:717-737`; KV types `LlamaService.ts:732-734`; RAM clamp `deviceTuning.ts:470-577`.
- Full re-render per message: `AppShell.tsx:3745-3767` → `compactor.ts:421-432` → `LlamaService.ts:1603,1814-1863`.
- Sliding window: `compactor.ts:128-131, 421-432`; compaction key `compactor.ts:114`, read per turn `AppShell.tsx:3562-3567`.
- llama.rn prefix reuse: `node_modules/llama.rn/cpp/rn-completion.cpp:429,455,469-497`; no clearCache on chat turns `LlamaService.ts:2185-2190`.
- Memory facts in system prompt: `LlamaService.ts:251-268`; extract + clearCache `LlamaService.ts:2207-2260`; arm after every turn `AppShell.tsx:3460-3500`; opt-in default OFF `src/memory/MemoryStore.ts:424-428`.
- Tool-turn divergence + save gate: `LlamaService.ts:1932`, `kvReproducibility.ts:38-53`, `sessionPersistence.ts:150-165`.
- Miniapp strip: `AiChatPage.tsx:2253`; think strip `LlamaService.ts:1639-1642`, `thinkStream.ts`.
- Save: `LlamaService.ts:1115-1240`; call sites `AiChatPage.tsx:2259-2277`, `AppShell.tsx:2085-2090`; disk gate `sessionPersistence.ts:107-112,220-228`.
- Restore: `LlamaService.ts:842-853, 1252-1360`; mismatch → delete artifacts `sessionPersistence.ts:163-176`; boot hash semantics `sessionPersistence.ts:70-118`; reset only on background `AppShell.tsx:2107`.
- Hybrid restore patch: `patches/llama.rn+0.12.8.patch` (JSISession.h); fallback full-clear `rn-completion.cpp:474-497`.
- UI during wait: `AiChatPage.tsx:1873`, `i18n/en.ts:97,415`; onStatus after init `LlamaService.ts:1701-1704`.
- KV buffer sizes: `ModelRegistry.ts:193-195`, `contextProfile.ts:3-7`.

DONE
