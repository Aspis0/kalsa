# Governor KV session contract

Line numbers pinned to: Aspis0/kalsa @ c7e3f9c
                        Aspis0/llama.rn @ 485519fe (branch v0129-on-gate)
                        kalsallama pin: 237461a98f0f8a34175c94c67a9ff382c5996c8b

The app paths below are from `Aspis0/kalsa`; the native paths are from
`Aspis0/llama.rn`. This document is re-pinned whenever either tree moves, or
the citations stop being checkable.

This document defines the state that must be persisted before governor session save and restore can be enabled. It is a contract for the native fork and its JS caller, not a TypeScript-only change. The app path is whole-context `saveSession`/`loadSession`: the save call is `ctx.saveSession(...)` (`src/engine/LlamaService.ts:3243-3249`) and the load call is `context.loadSession(...)` (`src/engine/LlamaService.ts:3587-3591`). The `rn-slot.cpp` calls are the parallel-slot path, not this contract (`cpp/rn-slot.cpp:877-884`, `cpp/rn-slot.cpp:1033-1039`).

## The current perimeter

The four JavaScript guards are real. Save exits on the first line with `logGovernorSessionSaveSkip()` and `return false` (`src/engine/LlamaService.ts:3109-3112`); the native snapshot helper likewise logs `logGovernorSessionSaveSkip()` and returns false (`src/engine/LlamaService.ts:5471-5474`). Restore logs `{ reason: "governor-mode" }` and returns false (`src/engine/LlamaService.ts:5526-5529`), while init replaces the restore with `console.warn("Governor session restore is disabled until paired KV state exists")` (`src/engine/LlamaService.ts:2638-2639`).

Those guards mirror a second, native perimeter. `JSISession::loadSession` says `throw std::runtime_error("Session load is not supported while governor mode is enabled")` before calling `llama_state_load_file(ctx->active_ctx(), ...)` (`cpp/jsi/JSISession.h:44-61`). `saveSession` has the same governor refusal (`cpp/jsi/JSISession.h:169-174`) and otherwise calls `llama_state_save_file(ctx->active_ctx(), ...)` (`cpp/jsi/JSISession.h:182-214`). The native whole-context API also documents that serialized memory and token positions must agree (`cpp/jsi/JSISession.h:182-201`).

Therefore removing only the JavaScript guards does not expose a silent restore bug: the native call throws. The silent wrong-output chain below is the reason the native refusal must not be removed without a paired-state design (`cpp/jsi/JSISession.h:48-61`, `cpp/jsi/JSISession.h:173-174`).

## What governor state is

Governor initialization loads two model instances and constructs one governor over them (`cpp/rn-llama.cpp:93-117`). The exposed owner model and context initially point at the prefill side (`cpp/rn-llama.cpp:134-135`), while the governor owns `ctx_prefill`, `ctx_decode`, and `last_ctx` (`cpp/llama-governor.h:70-72`).

The sides are not kept identical. A side watermark is the “exclusive next position not committed to the other side” (`cpp/llama-governor.h:50-52`). The governor commits only when the phase changes, and suppresses that commit for `cpu_route_handoff` (`cpp/llama-governor.cpp:202-208`). A commit copies `[src.watermark, end)` and then sets both watermarks to `end` (`cpp/llama-governor.cpp:91-122`). A decode batch runs on `ctx_decode` after the prefill-to-decode commit, and `last_ctx` is set to the batch target (`cpp/llama-governor.cpp:190-207`, `cpp/llama-governor.cpp:213-228`). Consequently, at rest after a completed turn, decode contains the complete latest sequence while prefill can stop at the previous watermark. The caches hold different contents; the watermark is the synchronization contract, not an equality bit.

Both whole-context operations resolve through `active_ctx()` (`cpp/jsi/JSISession.h:60-61`, `cpp/jsi/JSISession.h:193-214`). The binding delegates that to the governor's active context (`cpp/rn-llama.cpp:572-574`), and the governor returns `last_ctx` with a fallback to `ctx_prefill` (`cpp/rn-governor.cpp:32-38`, `cpp/llama-governor-runtime.cpp:228-230`).

### Restore asymmetry: CONFIRMED, but latent

The save side of the proposed chain is confirmed. After a normal prefill-to-decode handoff, the decode target is `ctx_decode`, the phase becomes Decode, and `last_ctx` becomes that target (`cpp/llama-governor.cpp:190-207`, `cpp/llama-governor.cpp:221-228`). A save made at that boundary would serialize the complete decode-side sequence if it explicitly selected that side.

The restore side is also confirmed as a property of the current native shape. `last_ctx` starts as null (`cpp/llama-governor.h:70-72`), and `clear_cache` resets both memories, both side states, `last_ctx`, `last_phase`, and the route (`cpp/llama-governor-runtime.cpp:155-166`). Before the first post-restore decode, `active_ctx()` therefore falls back to `ctx_prefill`; an unmodified `JSISession::loadSession` would load the blob there without restoring governor watermarks or phase state (`cpp/jsi/JSISession.h:57-81`, `cpp/llama-governor-runtime.cpp:228-230`).

The CPU-route continuation is confirmed as well. Admission can choose CPU for the turn (`cpp/llama-governor-runtime.cpp:40-63`), the target then becomes `ctx_decode` (`cpp/llama-governor.cpp:190-192`), and the handoff commit is suppressed (`cpp/llama-governor.cpp:202-207`). If a naive native lift loaded only prefill, left both watermarks at zero, and then took this route, decode would see an empty cache while completion believed `n_past` was nonzero. That is the silent wrong-output failure mode, but not a live defect while `JSISession` still throws (`cpp/jsi/JSISession.h:48-61`).

## The contract

“Paired KV state” means one logical session whose saved memory, governor side
metadata, and existing session identity describe a state from which the next
permitted route can continue without guessing which cache is live. The pair
must be created and restored in native code; JavaScript cannot reconstruct the
private watermarks or phase fields (`cpp/llama-governor.h:50-52`,
`cpp/llama-governor.h:70-85`).

Of the three storage shapes—(i) save one context and re-derive the other, (ii)
save both blobs plus watermarks, or (iii) save nothing and replay—the contract
selects design (i): save decode and re-derive prefill on the first GPU-routed
phase change. Decode is authoritative after a completed turn
(`cpp/llama-governor.cpp:190-207`, `cpp/llama-governor.cpp:213-228`). Design
(ii) doubles state bytes; design (iii) is the fail-closed fallback when
pairing, identity, or compatibility cannot be proved. Replay is valid because
the sibling contract makes the rendered token sequence the reusable-prefix
identity (`README-qwen-think-replay.md:17-20`, `README-qwen-think-replay.md:66-69`),
but it does not avoid cold prefill.

The save invariant is keyed on `kind`: the chat kind requires
`last_phase == Decode`, and a save in another phase is refused with the
proposed reason name `governor_session_requires_decode_phase`; the static-prefix
kind is the documented exception. Its artifact rules appear below.

The saved `.kvs` is a whole-context decode-side blob. Its envelope must carry
`kind`, format/version, source side, saved `last_phase`, both saved watermarks,
and the complete attention and recurrent compatibility tuples. On load,
native validates that the saved phase is Decode, loads into `ctx_decode`, sets
both runtime watermarks to zero—so the handoff's `end < src.watermark` check is
`N < 0` and cannot reject a nonempty loaded frontier—sets `last_ctx = ctx_decode` and
`last_phase = Decode`, and performs no eager commit. On the next GPU prefill,
the existing handoff computes `end = N`, copies `[0, N)`, and publishes both
watermarks; on the next CPU prefill, the target is already `ctx_decode` and
the handoff is suppressed (`cpp/llama-governor.cpp:70-81`,
`cpp/llama-governor.cpp:92-105`, `cpp/llama-governor.cpp:104-121`,
`cpp/llama-governor.cpp:190-207`). The
half-open range is the cache-cell predicate `[p0,p1)`
(`cpp/llama-kv-cells.h:412-417`). This deferred design keeps the operation on
the existing governor path and avoids an unverifiable load-time copy.

The current governor header has no session API or setters for this private
state (`cpp/llama-governor.h:15-31`, `cpp/llama-governor.h:70-85`). The
provisional native surface is `save_session`, `load_session`, and an atomic
`restore_session_state(...)` carrying the decode blob, both watermarks, phase,
and source side; `JSISession` must call that surface instead of using
`active_ctx()` as an implicit destination. These are new requirements, not
existing entry points (`cpp/jsi/JSISession.h:44-61`,
`cpp/jsi/JSISession.h:169-214`).

The envelope must remain paired with the existing session meta. That meta
already requires format version, model file identity, engine build, context
size, one K/V type pair, and history hash (`src/engine/sessionPersistence.ts:29-45`,
`src/engine/sessionPersistence.ts:910-931`). The writer also
records prompt-environment hash, speculative settings, engine knob,
conversation id, optional message count, baked tails, and assemble boundary
(`src/engine/LlamaService.ts:3293-3323`). Governor side, watermarks, and phase
are not among those fields and must be added to a versioned governor envelope
or extension; route is deliberately omitted and re-evaluated at first prefill
(`cpp/llama-governor.cpp:178-180`). Existing metadata alone cannot prove a pair.

**Privacy rule:** what a user asks never leaves — not the UI, not the logs, not
metrics; the envelope carries bytes and hashes, never a conversation id or a
stem. The existing meta does contain `conversationId`, while logs record only
a stem hash (`src/engine/LlamaService.ts:3315`, `src/engine/LlamaService.ts:3443`,
`src/engine/LlamaService.ts:3475`); the governor envelope must preserve that
boundary.

The attention KV-shape tuple must include `get_size`, `cache_type_k/v`,
`n_seq_max`, `n_stream`, `n_pad`, `n_swa`, `swa_type`, `v_trans`, layer count,
and per-layer layout (`cpp/llama-kv-commit.cpp:12-23`). Hybrid memory also
requires `size`, `n_rs_seq`, `rs_idx`, `r_l`, `s_l`, and each recurrent tensor's
shape, type, and byte size (`cpp/llama-hybrid-commit.cpp:17-33`). If recurrent
geometry differs, the envelope can pass while the later commit rejects and
latches the governor (`cpp/llama-hybrid-commit.cpp:25-40`, `cpp/llama-governor.cpp:207-208`, `cpp/llama-governor.cpp:162-165`). The blob writes `n_stream` and throws on mismatch (`cpp/llama-kv-cache.cpp:2132`, `cpp/llama-kv-cache.cpp:2218-2226`).

The current meta's single `cacheTypeK`/`cacheTypeV` pair is the decode-side pair
by contract. Cloned `owner.params` forces the two cache types equal today
(`cpp/rn-llama.cpp:70-75`, `cpp/rn-llama.cpp:93-117`), but does not cover
`v_trans`: construction derives it as `!cparams.flash_attn`, whose AUTO
resolution is per-context and can disable on device mismatch. The envelope
therefore pins `v_trans` and requires equality without asserting a runtime
outcome (`cpp/llama-model.cpp:2581-2587`, `cpp/llama-context.cpp:230-231`, `cpp/llama-context.cpp:520-558`). A missing or mismatched tuple fails closed: native returns false or throws, and the app deletes the artifact and cold-starts (`cpp/llama-context.cpp:4195-4203`, `cpp/jsi/JSISession.h:57-63`, `src/engine/LlamaService.ts:3527-3630`).

Latently, the blob serializes PLE `p_l` state while commit compatibility and copy omit it (`cpp/llama-memory-recurrent.cpp:926-935`, `cpp/llama-memory-recurrent.cpp:1135-1145`, `cpp/llama-hybrid-commit.cpp:17-33`, `cpp/llama-hybrid-commit.cpp:57-75`); it is inactive for shipping LFM2 because `ple_conv_state()` returns zero unless `ple_n_heads` and `ple_conv_kernel` are nonzero (`cpp/llama-hparams.cpp:268-275`).

For the shipping non-SWA hybrid model, the whole-context blob carries recurrent state. The GGUF sliding-window key sets `hparams.swa_type` (`cpp/models/lfm2.cpp:26-27`); when nonzero, construction selects sibling `llama_memory_hybrid_iswa`, not `llama_memory_hybrid` (`cpp/llama-model.cpp:2536-2541`, `cpp/llama-model.cpp:2580-2587`). The attention-cache accessor recognizes only ordinary KV and ordinary hybrid memory (`cpp/llama-kv-commit.cpp:268-271`), so an LFM2 GGUF with `attention.sliding_window > 0` cannot run under governor: route query Rejects and construction throws (`cpp/llama-kv-commit.cpp:290-296`, `cpp/llama-governor.cpp:48-53`). On the non-SWA path, state I/O includes attention unless `LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY` but always includes recurrent memory (`cpp/llama-memory-hybrid.cpp:244-262`, `cpp/llama.h:914-921`); whole-context I/O uses flags zero (`cpp/llama-context.cpp:3290-3332`, `cpp/llama-memory.h:125-130`) and serializes R/S state (`cpp/llama-memory-recurrent.cpp:897-939`, `cpp/llama-memory-recurrent.cpp:1088-1115`). The design therefore covers shipping LFM2 only on the non-SWA, whole-context/default-flags, non-shared path; partial-only artifacts are inadmissible.

A prefill-side blob is allowed only for a separately tagged static-prefix
artifact. The prewarm issues `n_predict: 0` with the static prefix
(`src/engine/LlamaService.ts:1278-1291`) and then attempts
`saveStaticPrefixSnapshot` (`src/engine/LlamaService.ts:1380-1399`). **The
prewarm path can save with `last_ctx == ctx_prefill`; this is a separately
tagged static-prefix artifact, never a chat session** (`cpp/llama-governor.cpp:191`,
`cpp/llama-governor.cpp:226-227`). Its
identity type has `prefixHash`, while the reserved conversation id is supplied
in its expected meta (`src/engine/staticPrefixSnapshot.ts:44-56`,
`src/engine/staticPrefixSnapshot.ts:66-71`,
`src/engine/staticPrefixSnapshot.ts:78-95`). The native refusal currently
stops this prewarm save under governor (`cpp/jsi/JSISession.h:169-174`).

## Validity at load

Load is valid only when the existing identity checks pass and the governor
envelope is complete. The existing reader rejects missing or wrong required
identity fields (`src/engine/sessionPersistence.ts:910-952`),
and the app rejects a non-reproducible history prefix before calling
`loadSession` (`src/engine/LlamaService.ts:3556-3589`). The native load-side
frontier check is at `:75-100`, and the save-side consistency check is at
`:190-207` (`cpp/jsi/JSISession.h:75-100`, `cpp/jsi/JSISession.h:190-207`).
The saved source being Decode and the history render being byte-for-byte
reproducible are new contract requirements; neither is implemented by that
file.

Empty history is fail-closed: the native save check treats `n_tokens=0,
pos_max=-1` as consistent (`-1+1==0`), the governor commit is a clean no-op,
and `sessionLoadHasTokens` rejects zero tokens, causing the app to delete the
artifact (`cpp/jsi/JSISession.h:190-207`, `cpp/llama-governor.cpp:70-121`,
`src/engine/sessionPersistence.ts:83-86`, `src/engine/LlamaService.ts:3591-3597`).

The two-context compatibility question is mandatory, not an optimization.
The load gate must repeat `llama_kv_route_query(ctx_prefill, ctx_decode)` with
the same contexts and destination/source order used by the first
decode-to-prefill handoff (`cpp/llama-governor.cpp:85-88`,
`cpp/llama-governor.cpp:204-208`). The constructor's reverse query already
throws on `Reject` (`cpp/llama-governor.cpp:48-53`). The route predicate is symmetric: its
compatibility, alias, and shared-cell tests compare both operands symmetrically
(`cpp/llama-kv-commit.cpp:12-23`, `cpp/llama-kv-commit.cpp:33-60`), so a
redundant reverse query is not required. `Direct` is impossible for this pair:
the governor requires independent KV caches, while the Direct implementation
copies nothing (`cpp/llama-governor.cpp:31-53`,
`cpp/llama-kv-commit.cpp:363-366`). Treat Direct as a hard error; only
MirrorAndCopy is admissible, and `Reject` means replay or cold prefill
(`cpp/llama-ext.h:163-183`). Hybrid compatibility additionally compares the
recurrent shapes and tensor layouts (`cpp/llama-hybrid-commit.cpp:25-40`).
Commit mode is directional in the real sense: Staged versus Naive is selected
from `can_stage_v(src_ctx)`, the source side (`cpp/llama-governor.cpp:91-104`).

The contract proposes the residual-risk name `kv_commit_unverifiable_copy`.
This is inherited by the session design, not introduced by deferral: steady-
state handoffs already have the same undetectable partial-copy limitation, and
no design in this fork removes it (`cpp/llama-kv-commit.cpp:340-343`). The
restore handoff covers the whole prefix `[0, N)` rather than only the
steady-state `[src.watermark, end)` range, so it exposes the same risk over a
larger surface per event (`cpp/llama-governor.cpp:96-105`). The contract does
not treat a returned `true` as proof of a complete copy or make it part of the
warm gate.

Save and load must be serialized with completion and governor operations. The
JavaScript save already holds the lifecycle lock around the engine job
(`src/engine/LlamaService.ts:3118-3123`), and the governor
declares its decode-thread methods non-overlapping
(`cpp/llama-governor.h:15-18`). The native paired operation must
preserve that same exclusion while it loads and publishes the
restored side metadata.

## Invalidation

A thermal change or a different prefill route does not invalidate the on-disk
logical session. Route selection is allowed to change per turn, and a CPU
handoff is an explicit governor route, not a history change
(`cpp/llama-governor-runtime.cpp:45-63`, `cpp/llama-governor.cpp:190-207`). The
route is not a restore input: the first chunked prefill resets
`prefill_route_` to `Undecided` before admission chooses again
(`cpp/llama-governor.cpp:178-180`, `cpp/llama-governor-runtime.cpp:40-63`).
Current thermal state and the current direction must pass the route oracle.

A governor-to-plain-CPU fallback invalidates the live paired in-memory state,
because native cleanup drops the governor objects and the app retries with
CPU-only parameters (`cpp/rn-llama.cpp:78-84`, `cpp/rn-llama.cpp:714-717`,
`src/engine/governorRuntime.ts:60-75`). It need not delete a
complete on-disk governor artifact: that artifact can be reused if governor
mode returns and its identity and route checks pass. A CPU session must use a
mode-distinct artifact or an explicit native conversion; it must not silently
interpret a governor envelope as ordinary single-context state.

`clear_cache` invalidates the live pair: it clears both memories and resets
both side states, phase, last context, and route
(`cpp/llama-governor-runtime.cpp:155-166`). It does not touch the
file system, so it does not by itself invalidate an already completed disk
artifact. After a clear, the live “disk is current” claim must be false until
the paired artifact is loaded or a new valid save completes
(`src/engine/LlamaService.ts:3015-3023`, `src/engine/LlamaService.ts:3025-3055`).

Model-file, engine-build, context-size, cache-type, prompt-environment,
conversation, history, or render identity changes invalidate the artifact;
the existing mismatch path deletes it and cold-starts
(`src/engine/LlamaService.ts:3527-3630`). A failed route query, missing
envelope field, or inconsistent token frontier rejects the artifact and falls
back to replay or cold-prefill. A handoff `Reject` after a clean load-time
query is a contract violation, with proposed name
`governor_session_route_gate_violation`, not a recovery case; the other
handoff false returns (invalid frontier/watermark or KV-copy failure) enter
`fail` and latch the governor, and the app's response remains an open contract
question (`cpp/llama-governor.cpp:85-108`,
`cpp/llama-governor.cpp:162-165`, `cpp/llama-governor.cpp:207-208`).

## Cost

The selected design writes one whole-context blob plus a small governor
envelope, not two blobs. The exact governor chat size is not measured here.
**The ~12.6 MB for 1832 tokens is the static prefix, NOT a governor chat
measurement.** It is not evidence for governor chat size
(`src/engine/staticPrefixSnapshot.ts:4-9`). The settling
measurement is the final `.kvs` byte count for representative attention and
hybrid histories, together with the envelope size.

The first GPU handoff copies the restored prefix through the attention range,
while a hybrid commit then copies the full
recurrent tensors for every recurrent layer and copies `cells`, `head`,
`used`, `rs_idx`, `n`, and `rs_z` regardless of the attention range
(`cpp/llama-hybrid-commit.cpp:57-86`). This is a real floor for
LFM2-like models, independent of how many new positions the watermark range
covers. It is paid at each non-suppressed phase handoff; `cpu_route_handoff`
can suppress it (`cpp/llama-governor.cpp:202-207`). No time or byte number for
that floor is asserted here. Measure `commit_us`, `commit_bytes`, and the
recurrent tensor shapes, and compare with the route cost query
(`cpp/llama-governor.cpp:103-117`, `cpp/llama-ext.h:180-183`).

An accepted restore avoids re-prefilling the saved history, which is the cold
prefill work the current init comment says the session path is intended to
remove (`src/engine/LlamaService.ts:2632-2634`). The avoided
time is not measured by this source audit. Settle it on-device with matched
history and model identities by recording cold `prompt_ms`/evaluated tokens,
restore load time, any GPU-handoff commit time, and the first resumed-turn
prefill (`src/engine/LlamaService.ts:1297-1307`).

The contract is therefore: no governor session is accepted as warm merely
because a `.kvs` exists. It is warm only after native loading into the declared
decode side, two-context compatibility, restored side metadata, and the
existing history/config identity gates agree; the deferred GPU handoff remains
subject to `kv_commit_unverifiable_copy`
(`src/engine/LlamaService.ts:3527-3604`, `cpp/llama-kv-commit.cpp:340-343`).
