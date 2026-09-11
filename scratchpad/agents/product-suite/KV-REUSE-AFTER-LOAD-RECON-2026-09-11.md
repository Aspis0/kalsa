# KV reuse after session load — recon 2026-09-11

**Verdict:** the 37s wait after restore is a **full prefill** (beb13d90 caso 2), not the new-turn cost. Two fixes in this worktree (no APK, no kalsallama push):

1. **JS:** assistant history for llama.rn now sets `reasoning_content` (inner think) + `content` (visible). Jinja re-emits the think span instead of stuffing raw `<think>` into `content`.
2. **Our llama.rn patch:** on hybrid `seq_rm` fail, restore nearest checkpoint with `n_tokens <= n_common`. **Do not `llama_memory_clear`.** MTP shared-mem clear stays.

`prompt_n` stays on `KALSA_TELEMETRY`. No PLAN/ALIVE.

---

## Upstream (steal into OUR patch only)

Parent search 2026-09-11. Same hybrid/recurrent symptom (Qwen3.5/3.6, LFM2, Mamba): seq_rm fails → full reprocess.

| id | what |
|---|---|
| ggml-org/llama.cpp **#20225**, **#21831** | OPEN |
| discussion **#19264** | LFM2 54s reprocess |
| **#20428** | closed, bad baseline |
| **#20955** | checkpoint restore on seq_rm fail — steal this *idea* |
| **#23121** | CLOSED because **#22673** MTP per-token snapshots (commit `255582687`) allegedly made partial seq_rm work on hybrid |
| **#25592** / **#24055** | restore checkpoint only at exact pos; seq_rm still fails **by design** |

Think-block Jinja mismatch is **ours** (`beb13d90` `reports/moe-kv-reuse-diagnosis.md`), not an upstream issue.

---

## JS message shape

`streamAssistantTurn` (`LlamaService.ts:3116-3123`):

```3116:3123:src/engine/LlamaService.ts
    let historyMessages: RNLlamaOAICompatibleMessage[] = messages.map((message, index) => {
      if (index === userIndex) return buildUserMessage(message);
      if (message.role === "assistant") {
        return { role: "assistant", ...llamaHistoryAssistantFields(message) };
      }
      return {
        role: message.role,
        content: promptContentForHistoryMessage(message),
      };
    });
```

Split (`modelEmittedText.ts:38-67`): leading `<think>…</think>` → `reasoning_content` = **inner body** (no tags), `content` = visible reply. Truncated think stays in `content`. Visible already starting with `<think>` is not double-wrapped.

Tests: `modelEmittedText.test.ts` (`llamaHistoryAssistantFields`). 24 Jest passed with telemetry tests.

---

## llama.rn patch hunk

`recoverStateCheckpoint` now picks longest snapshot with `n_tokens <= n_common` (`max_reuse`), not `min(n_common, total-1)`:

```318:333:node_modules/llama.rn/cpp/rn-completion.cpp
    // Longest snapshot with n_tokens <= n_common (max_reuse). min(n_common,
    // total-1) rejected a restore checkpoint of length n_common when
    // n_common == total (exact match; one token reserved to eval).
    const int ckpt_idx = findStateCheckpoint(target, max_reuse);
    ...
    llama_memory_seq_rm(kv, 0, k, -1);
    if (total_tokens > 0 && (size_t) k >= total_tokens) {
        k = (llama_pos) total_tokens - 1;
    }
    n_past_out = k;
```

seq_rm-fail path: **no full clear**. MTP `mtp_draft_mem_shared` still clears above.

```572:590:node_modules/llama.rn/cpp/rn-completion.cpp
        if (!cache_remove_success) {
            // Steal vs ggml-org/llama.cpp #20955 / #25592: seq_rm fails by
            // design on hybrid. Restore nearest checkpoint with n_tokens <=
            // n_common. Do NOT llama_memory_clear — that wipe is the 37s bug
            ...
                LOG_WARNING("KALSA_KVDIAG ... keep_prefix=1", ...);
                // Keep n_past. Do not wipe.
```

Post-`loadSession`: checkpoint at full `embd.size()` **and** message boundaries (`JSISession.h:129-137`) so a think-diverge `n_common` can still pick `n_tokens <= n_common`.

Patch file: `patches/llama.rn+0.12.8.patch` (~3895 lines, 25 diffs — wrapper only, not the cpp overlay). Regenerated from stock 0.12.8 diffs of those two files spliced into the existing patch.

---

## Telemetry

S23 1807aad: `tokensCached:1999 tokensEvaluated:1890 tokensPredicted:108 promptMs:37724`. `1999≈1890+108`. Cached vs evaluated is **not** reuse. `prompt_n` (`n_p_eval`) is. Formatter emits `prompt_n` (`turnTelemetry.ts`).

Native already logs `KALSA_KVPREFIX` (`rn-completion.cpp:465-474`, tag `RNLlama`). Next device shot: grep that + `keep_prefix=1` + JS `prompt_n`.
