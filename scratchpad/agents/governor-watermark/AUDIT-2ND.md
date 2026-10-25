SHIP-WITH-FIXES

# Second independent review — governor watermark fix

The engine rewind/recommit path is correct on the supplied LFM2.5 hybrid model in the tested decode-to-prefill cases. I found no silent divergence in the listed text-completion paths. Follow-ups remain: the public C API comment contradicts the implementation, and optional binding endpoints can operate outside the governor's tracked decode path. The benchmark and native vocoder endpoints are not called by the current app tree, so they do not block its ordinary completion flow; they should be guarded before treating all binding entry points as governor-safe.

## Findings

### CONFIRMED — hybrid rewind fallback restores the intended prefix and recurrent state

A hybrid side whose recurrent rollback cannot reach p is fully cleared, and both watermarks are reset so the next phase handoff copies from zero. The prefill/decode commit copies the recurrent tensors and their metadata, in addition to the attention KV.

src/llama-governor.cpp:210

> llama_memory_seq_rm(mem, 0, -1, -1);

src/llama-governor.cpp:215

> prefill_state.watermark = 0;

src/llama-governor.cpp:216

> decode_state.watermark = 0;

src/llama-hybrid-commit.cpp:64

> if (!copy_tensor(src.r_l[i], dst.r_l[i], scratch, copied_bytes) ||

src/llama-hybrid-commit.cpp:65

> !copy_tensor(src.s_l[i], dst.s_l[i], scratch, copied_bytes)) {

src/llama-hybrid-commit.cpp:69

> dst.cells = src.cells;

The extra destination-end guard rejects a destination that still contains a suffix beyond the source. The LFM2.5 test’s fresh-context oracle passed at both p=12 and p=1800 with zero logit difference:

src/llama-governor.cpp:97

> if (sequence_end(dst_ctx, 0, dst_end) && dst_end > end) {

/tmp/kalsa-wm-test-governor-v0-hybrid.log:6

> governor_hybrid_rewind p=12 trim_ok=1 max_abs_diff=0.000e+00 commit_bytes=557056 commit_us=163

/tmp/kalsa-wm-test-governor-v0-hybrid-p1800.log:6

> governor_hybrid_rewind p=1800 trim_ok=1 max_abs_diff=0.000e+00 commit_bytes=29851648 commit_us=3337

The turns test also pins the raw-bypass failure by reason on this hybrid model; it does not pass merely because the bad turn returns nonzero.

tests/test-governor-v0-turns.cpp:553

> const char * expected = hybrid ? "llama_decode failed with rc=-1"

/tmp/kalsa-wm-test-governor-v0-turns-model.log:23

> governor_raw_trim_breaks_handoff=PASS (hybrid bypass pinned)

### REFUTED — the listed text-turn mutation paths bypassing trim

The normal text path performs the raw active-context removal, optional checkpoint restore, and fallback clear before the single trim call. The checkpoint helper’s own state restore and suffix removal also return to this block.

cpp/rn-completion.cpp:633

> bool cache_remove_success = llama_memory_seq_rm(kv, 0, n_past, -1);

cpp/rn-completion.cpp:643

> if (recoverStateCheckpoint(text_tokens, n_common, num_prompt_tokens, n_past)) {

cpp/rn-completion.cpp:665

> llama_memory_clear(kv, false);

cpp/rn-completion.cpp:677

> if (parent_ctx->governor && !parent_ctx->governor->trim_sequence(n_past)) {

cpp/rn-completion.cpp:389

> const size_t read = llama_state_seq_set_data_ext(

The public cache-clear entry point does not call trim, but the engine’s governor clear clears both memories and resets both side states and phase tracking; the next text load then trims from its settled n_past.

cpp/rn-llama.cpp:1273

> if (hasGovernor()) {

src/llama-governor-runtime.cpp:150

> llama_memory_clear(llama_get_memory(ctx_prefill), clear_data);

src/llama-governor-runtime.cpp:153

> llama_memory_clear(llama_get_memory(ctx_decode), clear_data);

src/llama-governor-runtime.cpp:155

> prefill_state = side_state{};

src/llama-governor-runtime.cpp:156

> decode_state = side_state{};

src/llama-governor-runtime.cpp:157

> last_ctx = nullptr;

src/llama-governor-runtime.cpp:158

> last_phase = phase::None;

The context-ceiling path does not slide or shift KV: it refuses the shift, truncates only the token vector, and returns before another decode. Session load is rejected before llama_state_load_file can mutate a governor context.

cpp/rn-completion.cpp:1255

> "KALSA_KVSHIFT refused embd=%zu n_ctx=%d n_past=%d n_keep=%d keep_prefix=1",

cpp/rn-completion.cpp:1259

> embd.resize((size_t) n_past);

cpp/rn-completion.cpp:1263

> return result;

cpp/jsi/JSISession.h:26

> if (ctx->hasGovernor()) {

cpp/jsi/JSISession.h:27

> throw std::runtime_error("Session load is not supported while governor mode is enabled");

#### REFUTED — thermal CPU prefill does not orphan the active side

For CPU-routed prefill, both the target context and side state are the decode context. After a successful decode the governor records that exact target as last_ctx; rn_governor::active_ctx follows it. A later route change occurs in a new phase and uses a handoff. No stale-side consumption was found by source tracing. The tests cover the CPU route and hybrid trim separately, not their combination.

src/llama-governor.cpp:260

> llama_context * target = cpu_prefill ? ctx_decode : (is_prefill ? ctx_prefill : ctx_decode);

src/llama-governor.cpp:261

> side_state * state = cpu_prefill ? &decode_state : (is_prefill ? &prefill_state : &decode_state);

src/llama-governor.cpp:304

> last_ctx = target;

src/llama-governor-runtime.cpp:221

> llama_context * llama_governor::context() const { return last_ctx; }

/tmp/kalsa-wm-test-governor-v0-turns-model.log:20

> governor_low_battery_prefill=PASS engine=CPU chunks=cpu:128+128+49 generated=1

A cancelled text prefill does not trim immediately after its final successful batch. It records the actual decoded frontier in n_past/embd and returns; every subsequent llamaCompletion calls loadPrompt, whose cache block invokes trim. active_ctx follows the last successfully routed side, so same-phase prefill resumes on the context that was actually mutated.

cpp/rn-completion.cpp:1725

> n_past += n_eval;

cpp/rn-completion.cpp:1823

> embd.resize(n_past);

src/llama-governor.cpp:304

> last_ctx = target;

cpp/jsi/RNLlamaJSI.cpp:1240

> ctx->completion->loadPrompt(mediaPaths);

The host tests do not cover cancellation followed by prefix reuse, a thermal CPU route combined with a rewind, clear followed by reuse, or a completion stopped at the context ceiling. They test CPU routing and hybrid rewind separately. The context-ceiling path currently refuses to shift, so a slide/rebase result is not tested.

### PLAUSIBLE — exported llamaBench bypasses the governor rewind contract

The JSI bridge permits llamaBench with a governor and does not check hasGovernor. bench captures one active memory, routes synthetic batches through the governor, and clears only that captured memory. It never calls trim_sequence or governor clear_cache. Its warm-up batch starts at position zero before the first per-run clear; after a live turn, the handoff can therefore reach llama_decode with a non-empty target and a position-zero batch, causing a sticky decode failure. If it runs from an empty governor, its later one-context clear still leaves the peer and governor watermarks untouched. I found no llamaBench call in the current app source, so this is an exposed binding edge rather than an observed app path.

cpp/jsi/RNLlamaJSI.cpp:1144

> json res = ctx->completion->bench(pp, tg, pl, nr);

cpp/rn-completion.cpp:2215

> auto * ctx = parent_ctx->active_ctx();

cpp/rn-completion.cpp:2266

> const int ret = parent_ctx->decode(batch_view);

cpp/rn-completion.cpp:2284

> llama_batch_add(&batch, get_token_rand(), i, {0}, i == warmup_tokens - 1);

cpp/rn-completion.cpp:2313

> llama_memory_clear(mem, false);

cpp/rn-completion.cpp:2386

> llama_memory_clear(mem, false);

Guard llamaBench against governor mode or make its reset operate through the governor. I did not run a native JSI benchmark call.

### PLAUSIBLE — native vocoder can mutate the prefill context outside governor accounting

llamaInitVocoder is callable while a governor exists: neither the JSI entry point nor initVocoder checks hasGovernor. In governor mode rn-llama stores the prefill context in parent_ctx->ctx, while active_ctx follows the governor's last_ctx. TTS branches in nextToken call llama_decode(parent_ctx->ctx, batch) directly, bypassing governor phase state and watermarks. That can leave the governor's last_phase/watermark behind the context actually mutated and poison a later handoff. I found no native-vocoder call in the current app tree; it uses platform speech for read-aloud.

cpp/jsi/RNLlamaJSI.cpp:2021

> bool result = ctx->initVocoder(opts.path, opts.n_batch, opts.use_gpu);

cpp/rn-llama.cpp:1157

> tts_wrapper = new llama_rn_context_tts(vocoder_model_path, batch_size, use_gpu);

cpp/rn-llama.cpp:153

> owner.ctx = owner.governor->prefill_ctx();

cpp/rn-completion.cpp:1650

> const int rc = llama_decode(parent_ctx->ctx, b);

Guard native vocoder initialization under governor mode or route every TTS backbone decode through the governor. This combination was not exercised by the host tests.

### CONFIRMED — public C API contract comment is stale

The public declaration says an untrimmable suffix makes trim_sequence return false and keep that side’s watermark. The implementation instead full-clears that side, zeros both watermarks, and returns true when that clear succeeds. The internal C++ comment correctly describes the implementation; the exported header does not.

src/llama-ext.h:412

> * false when a side's cells beyond p could not be removed; that side's

src/llama-governor.h:23

> // window), that side's sequence is cleared entirely and BOTH watermarks

src/llama-governor.cpp:217

> return true;

Update the public API comment to describe the full-clear success path and the actual false condition.

### CONFIRMED — each full recommit allocates bounded temporary host buffers

The hybrid recommit copies all recurrent R/S tensors through a local vector; the attention mirror also creates a local range vector and a scratch vector. These allocate on each recommit as needed, then go out of scope. There is no persistent scratch buffer or unbounded per-turn growth in this code; the destination tensors are existing context storage.

src/llama-hybrid-commit.cpp:59

> std::vector<uint8_t> scratch;

src/llama-hybrid-commit.cpp:48

> scratch.resize(size);

src/llama-kv-commit.cpp:130

> std::vector<uint8_t> scratch;

src/llama-kv-commit.cpp:216

> std::vector<range_t> ranges;

The binding configures the decode model on CPU and the prefill model for GPU layers. On the phone, this fallback therefore uploads the copied attention KV plus recurrent state into the existing OpenCL prefill context each rewound turn. The p=1800 host run recorded 29,851,648 logical copied bytes and 3,337 microseconds; it is not an S23/OpenCL timing. The device test skipped because this host has no GPU backend.

cpp/rn-llama.cpp:77

> prefill_params.n_gpu_layers = 99;

cpp/rn-llama.cpp:78

> decode_params.n_gpu_layers = 0;

/tmp/kalsa-wm-test-governor-v0-devices-model.log:1

> governor-devices: SKIP no GPU backend available (exit 77)

## Host test results

All env-only commands below set `KALSA_HYBRID_GGUF=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`, redirected output to the listed `/tmp` log, and printed the shown `EXIT` value. Binaries that require `--model` rejected the env-only invocation; I reran those with `-m` and the same model. The table reports both results so the initial argument errors are visible.

| Binary | Env-only exit | With `-m` model exit | Evidence |
|---|---:|---:|---|
| `test-governor-v0` | `EXIT=1` | `EXIT=0` | `/tmp/kalsa-wm-test-governor-v0.log`; `/tmp/kalsa-wm-test-governor-v0-model.log` |
| `test-governor-v0-commit` | `EXIT=1` | `EXIT=0` | `/tmp/kalsa-wm-test-governor-v0-commit.log`; `/tmp/kalsa-wm-test-governor-v0-commit-model.log` |
| `test-governor-v0-devices` | `EXIT=1` | `EXIT=77` (skip: no GPU backend) | `/tmp/kalsa-wm-test-governor-v0-devices.log`; `/tmp/kalsa-wm-test-governor-v0-devices-model.log:1` |
| `test-governor-v0-hybrid` | `EXIT=0` | — | `/tmp/kalsa-wm-test-governor-v0-hybrid.log:6` |
| `test-governor-v0-mtp-hybrid` | `EXIT=1` | `EXIT=77` (skip: model has no MTP layers) | `/tmp/kalsa-wm-test-governor-v0-mtp-hybrid.log`; `/tmp/kalsa-wm-test-governor-v0-mtp-hybrid-model.log` |
| `test-governor-v0-shared-cells` | `EXIT=1` | `EXIT=0` | `/tmp/kalsa-wm-test-governor-v0-shared-cells.log`; `/tmp/kalsa-wm-test-governor-v0-shared-cells-model.log` |
| `test-governor-v0-turns` | `EXIT=1` | `EXIT=0` | `/tmp/kalsa-wm-test-governor-v0-turns.log`; `/tmp/kalsa-wm-test-governor-v0-turns-model.log:20,23-25` |
| `test-governor-v02-router` | `EXIT=0` | — | `/tmp/kalsa-wm-test-governor-v02-router.log` |

The explicitly requested `test-governor-v0-turns -m /Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf` run returned `EXIT=0`. The additional 1,800-token rewind run of `test-governor-v0-hybrid` with the same model env returned `EXIT=0` and reported zero oracle logit difference (`/tmp/kalsa-wm-test-governor-v0-hybrid-p1800.log:6`). The device-specific OpenCL path therefore remains untested here; its device test skipped with exit 77. Env-only exit-1 results are argument-parse failures, not regression reds.
