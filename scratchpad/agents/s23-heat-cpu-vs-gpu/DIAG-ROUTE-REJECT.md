# DIAG — `route Reject during phase handoff` (turn 2, APK a19f5acd, engine 60a5b9db5, binding f9aee4ec)

All quotes from the engine worktree HEAD `60a5b9db5` and the binding `f9aee4ec`; the logcat is
`raw/logcat-session.txt`.

## 1. Emitter and exact condition — hypothesis CONFIRMED (the failing guard is the destination-ahead one)

    llama-governor.cpp:275-284
        if (last_phase != phase::None && last_phase != next_phase && !cpu_route_handoff) {
            const bool ok = is_prefill
                ? commit_side(ctx_decode, ctx_prefill, decode_state, prefill_state, "decode-to-prefill")
                : commit_side(ctx_prefill, ctx_decode, prefill_state, decode_state, "prefill-to-decode");
            if (!ok) {
                return failed ? -1 : fail("route Reject during phase handoff");
            }
        }

`fail(...)` at `:283` fires because `commit_side` returned false without latching a specific reason.
The inner failure is the guard at `:97-104`:

    llama-governor.cpp:96-104
        llama_pos dst_end = 0;
        if (sequence_end(dst_ctx, 0, dst_end) && dst_end > end) {
            LLAMA_LOG_ERROR("%s: %s destination holds cells beyond the source end (%d > %d)\n", ...);
            return false;
        }

and the logcat carries exactly that line:

    340503  I ReactNativeJS: KALSA_NATIVE error commit_side: decode-to-prefill destination holds cells beyond the source end (1812 > 130)

So: turn 2's GPU prefill (`prefill_route_ == GPU` → `cpu_route_handoff` false) ran the
decode-to-prefill commit; `src = ctx_decode` ended at **130** (turn 1's CPU prompt 92 + reply),
`dst = ctx_prefill` still held the prewarm prefix at **1812** → destination ahead → reject. Your
hypothesis is right in substance: turn 1’s CPU route wrote only into `ctx_decode`
(`llama-governor.cpp:261-262 cpu_prefill ? ctx_decode : …`) and the CPU-route handoff skip
(`:273-274 cpu_route_handoff = prefill_route_ == CPU && (is_prefill || last_phase == Prefill)`)
**skipped the cross-context commit**, so the two KVs diverged; the GPU turn's catch-up copy was
refused because the destination was *already ahead*, not behind. Corroborating log lines:

    340498  09-25 01:12:40.869  loadPrompt:504 loadPrompt: prompt_n=1985 n_ctx=8192 embd=1942
    340499  09-25 01:12:40.869  KALSA_KVPREFIX embd=1942 text_tokens=1985 n_common=1942
    340500  09-25 01:12:40.869  captureStateCheckpoint:258 KALSA_KVRESUME skip_ckpt n=1942 pos_max=129
    340502  09-25 01:12:40.869  nextToken:1736 failed to eval, n_eval: 43, n_past: 1942

The `skip_ckpt n=1942 pos_max=129` is the same split viewed from the binding: the app’s logical
prefix is 1942 (= 1812 prewarm + 130 CPU turn) while the active context holds 130. Turn 1's own load already
mixes the two accounts (`330868 loadPrompt:504 prompt_n=1904` with `330869 KALSA_KVPREFIX
embd=1812`): the reuse count belonged to the prefill context, while the CPU-route turn's KV landed
on `ctx_decode` — the later checkpoint probe reads its `pos_max` at 129. The two contexts hold
different ranges, and the app's accounting spans both. It is **not**
the static `llama_kv_route_query` reject (that one logs `decode-to-prefill route rejected`) nor the
watermark check (`watermark is invalid`) — neither appears in the logcat.

## 2. Reachable without the bench hook — YES, product bug

The hook only made it deterministic. The transition condition is mechanical: a chat whose
prefill context is ahead of the decode context, followed by a GPU turn. Without the hook:

- `prefill_engine()` returns CPU for LOWBAT (`llama-governor-policy.cpp:166-170`), for a NoFit lane,
  for `generation` outside the measured list, and for Invalid/CRITICAL (which abort instead);
- the prewarm/session prefix lives on `ctx_prefill` (the load-time GPU route), while every LOWBAT
  turn accumulates on `ctx_decode` with the cross-context commit skipped (`cpu_route_handoff`);
- when the battery rises above 25 % or the phone is plugged, the next turn requests GPU → same
  `1812 > 130`-shaped reject → `fail` → sticky failed governor.

User-visible outcome (from the log + UI dump): the engine fails the turn; the binding raises
`Governor decode failed: route Reject during phase handoff` (the transcript row in
`logcat-session.txt:327109` et al.), the binding logs
`KALSA_GOVERNOR_FALLBACK {stage:"route_reject", reason:"route Reject during phase handoff", …}`
(`:340501`), and the app intercepts via `shouldRuntimeGovernorFallback`
(`governorRuntime.ts:87-90`) and logs `KALSA_GOVERNOR_RUNTIME_FALLBACK` (`:340507`) — i.e. **the
runtime fallback is a full model reload with the governor off**, then the turn is retried.
Cost: reload + a cold re-prefill + loss of the governor for the rest of the model’s life
(see §3-4).

## 3. Attempt 2 — full reload, conversation preserved, KV cold

    LlamaService.ts:2900-2931  runtimeGovernorState = "fallback-reload";
                               await initEngine(args.modelPath, args.modelId,
                                   { ...args.options, sessionRestore: undefined });
    LlamaService.ts:2309-2314  if (runtimeGovernorState === "fallback-reload") {
                                   runtimeGovernorState = "fallback-consumed";
                               } ... governorRuntimeOff = runtimeGovernorState === "fallback-consumed"

So attempt 2 is a **full reload of the same model with governor mode off** (once per model;
`fallbackUsedForModel: runtimeGovernorState !== "fresh"`), and `sessionRestore: undefined` means the
retry cannot reuse a `.kvs` — it re-prefills cold from the JS history. The conversation itself is
preserved (the app’s message history/replay; `KALSA_SESSION {"op":"init"}`, prewarm skipped
`kv_holds_chat`); the KV is not.

## 4. The logcat sequence around turn 2 (threadtime, UTC)

| time | line |
|---|---|
| 01:12:40.816 | `KALSA_PREWARM {"op":"skip","reason":"kv_holds_chat"}` |
| 01:12:40.826 | `KALSA_WINDOW {"turnId":"2","kvHeld":true,"nPast":1942,…,textEst:147}` |
| 01:12:40.858 | `KALSA_NATIVE info set_embeddings: value = 0` |
| 01:12:40.869 | `loadPrompt:504 prompt_n=1985 n_ctx=8192 embd=1942`; `KALSA_KVPREFIX embd=1942 text_tokens=1985 n_common=1942`; `KALSA_KVRESUME skip_ckpt n=1942 pos_max=129` |
| 01:12:40.869 | `KALSA_GOVERNOR_FALLBACK {stage:"route_reject", models_loaded:2, reason:"route Reject during phase handoff", gpu_fit:2, profile_valid:1}` |
| 01:12:40.869 | `nextToken:1736 failed to eval, n_eval: 43, n_past: 1942, n_threads: 5`; `commit_side: decode-to-prefill destination holds cells beyond the source end (1812 > 130)`; `fail: route Reject during phase handoff` |
| 01:12:40.879 | `KALSA_GOVERNOR_RUNTIME_FALLBACK {"reason":"route Reject during phase handoff","turnId":"2","attempt":2}` |
| 01:12:40.882 | `~llama_context` destruction of both governor contexts (OpenCL/CPU buffer teardown) |
| 01:12:41.189 | `KALSA_SESSION {"op":"init","no_extra_bufts":0}` → the reload begins |
| 01:12:41.196 | `RNLlama loadModel:797 Using n_parallel: 1` → model metadata load |
| 01:12:42.447 | `KALSA_THINKING {"turnId":"2","budget":512,…}` → retry attempt 2 starts (~1.6 s after the fallback) |
| 01:13:11.914 | `KALSA_TELEMETRY {"turnId":"2","attempt":2,…,"tokensCached":2031,"tokensEvaluated":1985,"tokensPredicted":45,"promptMs":26889.059,…}` |
| 01:13:11.915 | `KALSA_GOVERNOR {"engine_prefill":"CPU","engine_decode":"CPU",…,"thermal_state":"Unknown","forced":false}` (governor off) |

Reload wall: fallback 01:12:40.879 → retry turn 01:12:42.447 ≈ **1.57 s to the turn start**; the
retry then paid a **26.89 s cold prefill for 1985 tokens** (CPU-class ≈74 tok/s) before generating
45 tokens — versus the GPU route the hook had requested.

## 5. Smallest correct fix options (no code)

1. **Trim-then-copy on a decode-to-prefill commit** (`llama-governor.cpp:96-104`): when
   `dst_end > end`, first trim the destination to `end` through the governor’s sanctioned
   `trim_sequence` (the guard’s own comment: “A raw KV rewind bypassed the governor (use
   llama_governor_trim_sequence)”), then copy `[src.watermark, end)`. Must handle the hybrid
   recurrent side (mirror the source wholesale, or reset the destination’s recurrent tail).
   Trade-off: correct for every CPU→GPU transition; cost = destination reset + one prefix copy
   (1812 tokens here). This is the smallest engine-side fix.
2. **Keep both contexts in sync on the CPU route** (mirror at the end of each CPU turn; drop or
   relax the `cpu_route_handoff` skip). Trade-off: pays a cross-context copy per CPU turn — the cost
   the skip exists to avoid — but every later transition is safe, including GPU→CPU.
3. **Latch the route per conversation/session** (no engine change inside a chat; a route change
   requires a reload). Trade-off: kills per-turn thermal/LOWBAT routing (the owner’s CPU rule would
   need a reload), and the bench cannot switch arms without a reload.
4. **Hook-level constraint** (bench-only): document/enforce that `/bench route` changes require a
   fresh session with `llama_governor_clear_cache` (which clears **both** contexts and the route,
   `llama-governor-runtime.cpp:206-217`) or a reload before the next arm. Cheap, product-irrelevant.

## 6. Does a fresh chat per arm avoid it?

Not by itself. A fresh chat only helps if it actually clears both KVs (`clear_cache` clears
`ctx_prefill` **and** `ctx_decode` and resets `prefill_route_`, `:206-217`). If the app reuses a
cached prewarm/system prompt, `kvHeld:true` and `nPast` = the prewarm prefix length (~1812 here),
**not 0** — the log shows the prewarm being skipped precisely because the KV already held the chat
(`KALSA_PREWARM {"op":"skip","reason":"kv_holds_chat"}`). The safe bench rule is: set the route
**before** the prewarm/load of that arm and keep it fixed for the whole arm (or clear the cache
after setting it), and never change the route between two turns whose two contexts hold divergent
state. Fresh chat + unchanged route per arm is sufficient; fresh chat alone is not.

## Turn-1 context — VERDICT: **TRUNCATED** (the 1812-token prefix was never attended)

Settled from the logcat and the source; the two accounts agree.

**Logcat (turn 1, 01:11:03–01:11:14):**

    `KALSA_WINDOW {"turnId":"1","kvHeld":false,"nPast":null,…}`           (330821 — the app held no session KV)
    loadPrompt:504 loadPrompt: prompt_n=1904 n_ctx=8192 embd=1812        (330868)
    KALSA_KVPREFIX embd=1812 text_tokens=1904 n_common=1812              (330869 — match against the prewarm's KV)
    KALSA_TELEMETRY {"turnId":"1",…,"tokensCached":1942,"tokensEvaluated":1904,…,"promptMs":8854.674,…,"prompt_n":92}   (331169)
    KALSA_GOVERNOR {"turnId":"1",…,"prefill_ms":8854.674,"prefill_chunks":"cpu:92","engine_prefill":"CPU",…}            (331172)

`prompt_n:92` and `prefill_chunks:"cpu:92"` are the engine's truth: **one 92-token prefill chunk
on the CPU route, 8.85 s** (≈10.4 tok/s, CPU-class). `tokensEvaluated:1904` is the binding's
prompt-scope count, not the decode count. The fingerprint at turn 2 proves where those 92 tokens
landed: `KALSA_KVRESUME skip_ckpt n=1942 pos_max=129` (340500) and the handoff
`destination holds cells beyond the source end (1812 > 130)` (340503) — `ctx_decode` held
**positions 0..129** = the 92 prompt tokens + 37 reply.

**Source, step by step:**

1. The prewarm (load-time plan = GPU) ran its 1812-token prefix on `ctx_prefill`; the binding's
   `embd` member is that token list.
2. Turn 1's `loadPrompt` matched it: `rn-completion.cpp:533 find_common_prefix_length(embd, text_tokens)`
   → `n_common=1812`, and `:622 n_past = (llama_pos) n_common;` → the completion will skip the
   first 1812 tokens and evaluate the last 92.
3. The trim paths are no-ops against the empty decode context: `:636
   llama_memory_seq_rm(kv, 0, n_past, -1)` on the active (`ctx_prefill`) memory, and the governor's
   `trim_sequence(n_past)` (binding `:680`) cannot conjure cells that `ctx_decode` never had.
4. The CPU route sends the turn to `ctx_decode` (`llama-governor.cpp:261-262
   cpu_prefill ? ctx_decode : …`), and the cross-context catch-up is **skipped** by the CPU-route
   handoff rule (`:273-274 cpu_route_handoff = prefill_route_ == CPU && (is_prefill || last_phase == Prefill)`) —
   `ctx_prefill`'s 1812-token prefix is never committed to `ctx_decode`.
5. The eval batch carries only the newest 92 tokens and **no positions**:
   `rn-completion.cpp:1713 parent_ctx->decode(llama_batch_get_one(&embd[n_past], n_eval));`
   and `llama-batch.cpp:931-942` returns `/*pos =*/ nullptr` — so `llama_decode` lays those 92
   tokens out from `ctx_decode`'s own frontier, which is empty → positions **0..91**, and the 37
   reply tokens follow at 92..128. The next turn's probe reads `pos_max=129`.

So turn 1's answer was computed **without the 1812-token system prompt/history** and with the 92
tail tokens **mis-positioned at 0..91** (wrong RoPE); the model attended only to those 92 tokens and
its own reply. The `KALSA_GOVERNOR` route facts looked healthy (`cpu:92`, `forced:true`), so nothing
signalled it. The prewarm+KVPREFIX accounting (`1942 = 1812 + 130`) is true of the two contexts
*added together*, false of either one — the binding's single-context assumption.

**Product reachability — YES, same root, two symptoms.** A LOWBAT turn (<25 % unplugged) taken right
after a GPU prewarm behaves exactly like turn 1: the prewarm prefix sits on `ctx_prefill`, the CPU
turn runs on `ctx_decode` (skip at `:273-274`), the reused `n_past` is the prefill context's prefix,
and the new tokens decode from position 0 with no prefix → a silently context-truncated answer (no
error, no governor fallback). The *next* GPU turn then hits the `1812 > end` handoff reject of §1-2
and triggers the runtime fallback reload. Both come from the same broken invariant: the CPU route
assumes `ctx_decode` already holds the conversation, which is only true for chats that began and
ran on the CPU route. The `/bench route` hook only makes the switch happen on demand.
