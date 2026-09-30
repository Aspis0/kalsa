# Hostile code audit — 17446ac4 (governor prefill KV off HTP)

Date: 2026-09-30. Auditor: code-audit session. Binding worktree `~/Projects/llama.rn-kalsa-gov-platform`,
branch `feat/governor-platform-status`, commit `17446ac4`, base `b4a13d9a`. Engine `vendor/llama.cpp`
(vendor pin `a3cc6f96 chore(vendor): bump kalsallama f2b85aa27 -> d07d0181b`).

**Nothing was edited, built, committed or pushed.** `git status --porcelain` in the worktree is empty and
`git rev-parse HEAD` is still `17446ac4`. All mutation testing ran on a copy in `/tmp/audit-mut`
(own `jest.config.js` + symlinked `node_modules`); the repo tree was never the target.

## Verdict: FIX FIRST — 2 blocking items, both in the change's own text/tests, not in the mechanism

The one-line mechanism is correct and closes the abort class by construction (F1). Both blocking
items are cheap: one false sentence in a comment (B2) and one test that does not test what it claims
(B1).

---

## B1 — BLOCKING, CONFIRMED: `governorLaneKvPlacement` case 3 does not pin scoping

`src/__tests__/governorLaneKvPlacement.test.ts:33-38`

```js
  test("the KV pin is scoped to the resolved HTP device, not the whole lane", () => {
    // A lane that degraded to GPU keeps the OpenCL placement the GPU route
    // has always used, so the assignment must sit inside the use_device
    // block that only fires when HTP0 resolved.
    const branch = lane![0].match(
      /if \(device_plan\.use_device\) {[\S\s]*?prefill_params\.no_kv_offload = true;/,
    );
```

`[\S\s]*?` is **unbounded and lazy**: it spans any distance, including the block's closing brace,
the `#if defined(__ANDROID__)`, and the whole rest of the function. There is no brace-balance check.
The assertion is satisfied by "the `if` appears *somewhere* before the assignment", which is the
opposite of the stated invariant.

Mutation (assignment + its comment moved out of the `use_device` block, to just after
`#if defined(__ANDROID__)` — i.e. it now fires for every lane state on every platform):

```
117	        owner.governor_npu_device = device_plan.npu_device;
118	        owner.governor_npu_fallback = device_plan.npu_fallback;
119	        if (device_plan.use_device) {
120	            prefill_params.devices = { resolved.device, nullptr };
121	        }
122	#if defined(__ANDROID__)
123	        // UNSCOPED MUTATION: fires for every lane state, incl. GPU-degraded.
124	        prefill_params.no_kv_offload = true;
125	    } else {
```

```
M2 EXIT=0
PASS src/__tests__/governorLaneKvPlacement.test.ts
PASS src/__tests__/governorLaneRepack.test.ts
Tests:       7 passed, 7 total
```

**All 4 cases pass. EXIT=0.** The scoping pin is inert.

The unscoped form is a real regression, not a cosmetic one. `llama_governor_resolve_prefill_device()`
only ever returns `HTP0` or `nullptr` (`vendor/llama.cpp/src/llama-governor-device.cpp:7-17`), so
`use_device == false` inside the lane-on branch means *HTP failed and the lane degraded to GPU*. In
that state `cpp/rn-llama.cpp:119-130` never assigns `prefill_params.devices`, so it keeps
`owner.params.devices` = the JSI default list (`cpp/jsi/RNLlamaJSI.cpp:111-162`, `GPUOpenCL` on the
S23). An unscoped `no_kv_offload = true` there moves the whole 128k-context KV out of the OpenCL
device buffer into host memory — while `KALSA_GOVERNOR_PLAN` has already published
`"gpu_fit":"Fit"` (`raw/laneon-cold1-evidence.txt:2`), computed under the device-KV assumption.

Related control results (same scratch tree):

- **M1** — delete the assignment line: `M1 EXIT=1`, `Tests: 2 failed, 5 passed, 7 total`. The pin
  does catch removal. It is one-sided: it catches "too early", not "too late".
- **M5** — assignment placed *before* the `if` block: `M5 EXIT=1`, both suites red. Confirms the
  one-sidedness: the regex only constrains ordering, never containment.

Fix: brace-balance the window (e.g. match the block body with a pattern that cannot cross `}`), or
assert on the extracted `use_device` block slice rather than on a flat regex over the function.

## B2 — BLOCKING, CONFIRMED: the comment's stated invariant is false

`cpp/rn-llama.cpp:126-128`

```cpp
            // The lane's validated shape keeps the prefill attention/KV in
            // host memory the CPU decode context also reads (HTP prefill
            // spike, offload_kqv=false).
```

"the CPU decode context also reads" is false, and the engine says so in the strongest terms.
`vendor/llama.cpp/src/llama-governor.cpp:34-36`:

```cpp
    if (params_prefill.ctx_other || params_decode.ctx_other) {
        throw std::runtime_error("governor contexts must have independent KV caches");
    }
```

The two contexts **cannot** share a cache. `llama_kv_route_query` therefore takes the copy branch —
`src/llama-kv-commit.cpp:305-312`: `aliases()` requires `same_host_tensor`, i.e.
`dst->buffer == src->buffer && dst->data == src->data` (`src/llama-kv-commit.cpp:26-32`) — two
distinct allocations, so `route == llama_kv_route::MirrorAndCopy`. Every commit byte goes host-side
(`src/llama-kv-commit.cpp:104-114`):

```cpp
        scratch.resize(size);
        ggml_backend_tensor_get(src, scratch.data(), src_offset, size);
        ...
        ggml_backend_tensor_set(dst, scratch.data(), dst_offset, size);
```

and the recurrent state likewise (`src/llama-hybrid-commit.cpp:47-50`). The decode context never
reads the prefill memory; it reads a copy of it.

The *direction* of the comment is right and the real reason is worth keeping — a CPU-buffered source
turns the commit from a DMA out of the DSP into a `memcpy` — but as written it states a sharing
contract that does not exist. Whoever reads this next will believe the decode side's KV placement is
a constraint on the prefill side's. It is not: `llama_kv_commit_access::compatible`
(`src/llama-kv-commit.cpp:12-25`) compares sizes, `cache_type_k/v`, `n_seq_max`, `n_stream`,
`n_pad`, `n_swa`, `swa_type`, `v_trans` and layer shapes — **not** buffer types, backends, or
strides. `compatible_states` (`src/llama-hybrid-commit.cpp:10-35`) compares `ne[]`, `type` and
`nbytes` only. So the fix is commit-contract-neutral, which is the invariant that actually deserves a
comment.

---

## F1 — CONFIRMED (the good news): the abort class is closed, and `no_kv_offload` does cover the recurrent state

Exhaustive inventory of pre-allocated tensors in the prefill graph, with the op that writes each:

| pre-allocated tensor | buffer before | write op | HTP accepts it? |
|---|---|---|---|
| `cache_k_lN` (q8_0) | HTP0 | `ggml_set_rows` | yes (`ggml-hexagon.cpp:5314` lists `Q8_0`) |
| `cache_v_lN` (q4_0) | HTP0 | `ggml_set_rows` (`llama-kv-cache.cpp:1456`) | **no** — the observed abort |
| `cache_r_lN` / `cache_s_lN` (F32) | HTP0 | `ggml_cpy` (`models/lfm2.cpp:216-219`) | yes (`ggml-hexagon.cpp:6571`: `if (sametype) return true;`) |
| model weights, `output` | HTP0 | — read-only leaves | n/a |
| `inp_*` graph inputs | sched-allocated | — | n/a |

The V cache was the **only** refusal, and `ggml_backend_sched_split_graph` aborts on the first one
(`ggml/src/ggml-backend.cpp:938-941`, confirmed verbatim in the tombstone at
`raw/tombstones.txt:713` and `:1436`). There is no "next tensor" of the same class.

**`no_kv_offload` does cover `r`/`s`.** The hybrid passes one `offload` to both halves —
`src/llama-memory-hybrid.cpp:55-86`: `offload` → `llama_kv_cache` (line 61) **and** →
`llama_memory_recurrent` (line 79) — and the recurrent picks its buffer from the same flag
(`src/llama-memory-recurrent.cpp:85-92`):

```cpp
        ggml_backend_buffer_type_t buft = ggml_backend_cpu_buffer_type();

        if (offload) {
            auto * dev = model.dev_layer(i);
            buft = ggml_backend_dev_buffer_type(dev);
```

After the fix, no pre-allocated HTP0 tensor is written by any op. The class is closed **by
construction**, not by luck of the current op mix.

Two independent guards make this robust rather than incidental — worth recording because they are
the reason a future op addition cannot silently reopen it:

1. `HTP` cannot claim a CPU-buffer tensor. `ggml_backend_hexagon_device_supports_buft`
   (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:6818-6825`) accepts only
   `&dev_ctx->host_buffer_type` and `&dev_ctx->buffer_type`. `host_buffer_type` is a **distinct**
   type named `"HTP0-HOST"` (`ggml-hexagon.cpp:2109`) and `opt_hostbuf` defaults to `false`
   (`ggml-hexagon.cpp:93`), so `ggml_backend_dev_host_buffer_type` returns `NULL`
   (`ggml-hexagon.cpp:6548-6553`). It is never `ggml_backend_cpu_buffer_type()`.
2. HTP never grabs host ops via `op_offload` either: `/* .offload_op = */ NULL`
   (`ggml-hexagon.cpp:6839`).

So after the fix, `ggml_backend_sched_backend_from_buffer` finds only the CPU backend for every
cache/RS destination, and pass 3 ("backend with the most supported inputs",
`ggml-backend.cpp:1218-1239`) lands attention and the conv-state write on the CPU.

**Cost the commit does not mention:** the same `offload` flag governs the recurrent memory, so the
fix also moves **22 conv-state `ggml_cpy` writes per ubatch off HTP onto the CPU** (22 recurrent
layers; see F2 for the layer census). Those were HTP-eligible before (`sametype → true`). There is no
separate knob — `llama-memory-hybrid.cpp:61,79` pass the same `bool` — so a 1-line binding fix
cannot avoid it. That is a defensible trade, but it is a trade, and the commit message presents the
change as free.

## F2 — CONFIRMED: op placement, and the perf evidence does not describe the shipped graph

Model: `lfm2.block_count = 30`, `n_ubatch` per the app is **256**
(`~/Projects/kalsa/src/engine/deviceTuning.ts:244` `const DEFAULT_UBATCH = 256;`, and
`deviceTuning.ts:731`) — **not** the spike's 512 (`raw/kld_htp.log:357` `n_ubatch = 512`).
Census, derived from `raw/kld_htp.log` op counts divided by 9 graph executions (self-consistent:
`144 SET_ROWS / 2 / 9 = 8` attention layers; `198 SSM_CONV / 9 = 22` conv layers; `693 RMS_NORM / 9
= 77 = 22*2 + 8*4 + 1`; `8 + 22 = 30` = `block_count`):

**30 layers = 22 shortconv (recurrent) + 8 attention.**

After the fix, per layer:

- *conv layer* — `in_proj` MUL_MAT, `mul`, `transpose`, `concat`, `ssm_conv`, `out_proj` MUL_MAT stay
  on HTP; the conv-state `ggml_cpy` and the `conv_rs` read go to the CPU (F1). Minimum **2 backend
  switches**, and ~4 MiB of `bx` (256 tok × 2048 × F32) crosses HTP→CPU per layer per ubatch.
- *attention layer* — q/k/v MUL_MATs and ROPE-ish work on HTP; `set_rows` K, `set_rows` V and
  `flash_attn_ext` on the CPU. HTP refuses FA on a q4_0 V (`ggml-hexagon.cpp:4149-4151` admits only
  F16/Q8_0 for `src1`/`src2`). Minimum **2 switches**, and q (256×32×64×F32 = 2 MiB) crosses
  HTP→CPU with the FA output crossing back.

**Estimate: ~60 backend splits per prefill ubatch** (2 per layer × 30), ~90 MiB of per-ubatch
HTP↔CPU traffic, ~60 FastRPC round trips. The engine agrees this is the intent, not an accident —
`src/llama-graph.cpp:2718-2721`:

```cpp
        if (!cparams.offload_kqv) {
            // all nodes between the KV store and the attention output are run on the CPU
            ggml_backend_sched_set_tensor_backend(sched, cur, backend_cpu);
        }
```

Two things follow that the commit message gets wrong:

1. **"MUL_MATs run on HTP" is true only by accident of the app's config.** In the non-FA path that
   pinned region contains `kqv = ggml_mul_mat(v, kq)` (`llama-graph.cpp:2704`) — a MUL_MAT that
   `offload_kqv == false` deliberately forces to the CPU. It is only the app's forced-FA graph that
   has no MUL_MAT in the attention block, because one `FLASH_ATTN_EXT` replaced them.
2. **The cited validation measured a different graph.** The commit leans on
   "the spike-validated lane shape (governor-htp-prefill-spike, `offload_kqv=false`)". That spike's
   KV shape matches (`raw/handoff_htp.log`: `llama_kv_cache: CPU KV buffer size = 32.00 MiB` — host
   memory), but its attention was **`flash_attn = disabled` with f16 K/V**
   (`raw/handoff_htp.log`: `llama_context: flash_attn = disabled`). The app ships
   `flash_attn_type: "auto"` with `cacheTypeV = "q4_0"`
   (`~/Projects/kalsa/src/engine/contextProfile.ts:204-205`, `const cacheTypeV = input.kvCache?.v ?? "q4_0";`,
   and the note at `contextProfile.ts:157` "hybrids use k q8_0 / v q4_0. No blanket hybrid→q8
   override."), which the engine upgrades to FA-enabled before the context is built
   (`llama-context.cpp:3755-3759`, inside `llama_init_from_model`, before the ctor at
   `llama-context.cpp:3816` — ordering verified), so `v_trans = false`
   (`llama-model.cpp:2677`) and the attention is a single CPU `FLASH_ATTN_EXT` over a q4_0 V cache.

So the 3485 ms vs 11873 ms figure in the commit's justification comes from a run that contained
**zero `FLASH_ATTN_EXT` nodes**, at `n_ubatch` 512 instead of 256, with a transposed f16 V instead of
a q4_0 V. `raw/handoff_htp.log` has no `execute-op` lines at all, so **no spike log traces the op
split of the shape this commit actually creates** — the only per-op HTP trace in the spike
(`raw/kld_htp.log`) is the *unfixed* shape (`offload_kqv` default true; its 144 `SET_ROWS` / 72
`FLASH_ATTN_EXT` on HTP0 are exactly the ops this fix moves to the CPU).

Whether the ~60-split shape still beats the OpenCL prefill is genuinely open. A likely-regression
framing is fair: the prefill goes from ~1 split to ~60, the traffic per ubatch is halved in
granularity by `n_ubatch` 256, and the CPU now runs all of the attention instead of the DSP. It
could still win, since OpenCL measured 11873 ms. This must be settled on device, and the milestone-1
arm should log `GGML_SCHED_DEBUG` split assignments plus `GGML_HEXAGON_VERBOSE=1` so the placement
is evidence rather than inference.

## F3 — CONFIRMED: the fix does not break the prefill→decode commit contract

Checked, because the brief asks whether the route assumes both caches are on the same kind of
buffer. It does not. `llama_kv_route_query` (`llama-kv-commit.cpp:290-313`) gates on
`compatible()` + `llama_hybrid_memory_compatible()`; both are shape/type-only (F1/B2 quotes). No
buffer type, no backend, no `nb[]` stride comparison. Layout cannot drift because both contexts are
built from copies of the same `owner.params` (`cpp/rn-llama.cpp:106-107`) and both get the same FA
upgrade. The decode side is unaffected by the change: `decode_params.n_gpu_layers = 0`
(`cpp/rn-llama.cpp:149`) → `act_gpu_layers = 0` → every `dev_layer` is the CPU device
(`llama-model.cpp:1527-1530`) → `buft = ggml_backend_dev_buffer_type(cpu_dev)`, i.e. the CPU buffer
type either way. Net effect of the fix on the commit path: strictly cheaper (host→host `memcpy`
instead of `ggml_backend_tensor_get` DMA-ing out of the DSP). `staged` mode is not engaged
regardless: `can_stage_v` requires `cache.v_trans` (`llama-kv-commit.cpp:54-56`) and `v_trans` is
false.

## F4 — REFUTED: the diagnosis's lane-OFF / AsyncStorage-staleness explanation

The lane-off REFUTATION itself **holds** — I re-verified every leg:

- `cpp/rn-llama.cpp:83-94` `lane_off_devices` filters the `HTP` registry
  (`ggml_backend_reg_by_name("HTP")`), and the empty-list sweep takes only
  `GGML_BACKEND_DEVICE_TYPE_GPU` — which HTP reports (`ggml-hexagon.cpp:6523-6526`) — and then runs
  the same filter.
- `devices_excluding_registry` is sound: `cpp/rn-governor-params.cpp:198-201`
  `if (dev != nullptr && dev->reg != excluded)`.
- `ensureBackendInitialized()` is `std::call_once(llama_backend_init)`
  (`cpp/jsi/RNLlamaJSI.cpp:248-252`) and runs at `cpp/jsi/RNLlamaJSI.cpp:660`, inside the same JSI
  load task, before `load_governor_models`.
- The JSI default list independently drops `HTP*` by name prefix
  (`cpp/jsi/RNLlamaJSI.cpp:99-109`), applied in the collect loop at
  `cpp/jsi/RNLlamaJSI.cpp:116-120`.
- Decode cannot place KV on HTP in any lane state (`cpp/rn-llama.cpp:149` + `llama-model.cpp:1527-1530`).

But the *proposed mechanism* for the 16:51:03 crash is refuted twice:

1. **By the runner script.** `raw/turn.sh:23-26`:
   ```bash
   adb -s $S shell am force-stop com.kalsa.app; sleep 2
   sql_write "$(q kalsa.bench.route $BR)" kalsa.bench.route $BR || exit 3
   sql_write "$(q kalsa.bench.npu_lane $LANE)" kalsa.bench.npu_lane $LANE || exit 3
   ```
   The app is force-stopped **before** the direct SQLite write, and relaunched afterwards
   (`raw/turn.sh:43`). A force-stopped process has no in-process AsyncStorage cache, and RN
   AsyncStorage 2.2.0's `AsyncStorageModule` has no value cache either. The proposed staleness window
   does not exist in this flow.
2. **By the diagnosis's own evidence file.** `raw/tombstones.txt:713` (16:51:03) and `:1436`
   (17:03:44) carry the **identical** abort:
   `ggml-backend.cpp:941: pre-allocated tensor (cache_v_l2 (view)) in a buffer (HTP0) that cannot run the operation (SET_ROWS)`.
   That string is only reachable with HTP0 in the prefill device list, which only
   `cpp/rn-llama.cpp:119-120` sets. So 16:51:03 was a **lane-on** load, full stop. No staleness story
   is needed, and `npu_lane_enabled` was never logged, so there is nothing to explain.

The conclusion "the crashing load was lane-on" is right; the hedge around it and the mechanism offered
for it are both wrong, and the recommended `npu_lane_enabled` log line remains worth adding.

## F5 — CONFIRMED: all quoted engine lines in the diagnosis check out

I re-read each one. Verbatim matches, no drift: `llama-kv-cache.cpp:237-241` (CPU default at 237,
`if (offload)` at 239-241), `:256-260` (`cache_%sk/v_l%d`), `:308` (the real
`ggml_backend_alloc_ctx_tensors_from_buft`), `:1456` (`return ggml_set_rows(ctx, v, v_cur, v_idxs);`
in the `!v_trans` branch), `llama-model.cpp:1531-1534`/`:1542-1545`, `:2593`/`:2673-2691`,
`:2677` (`attn_v_trans = !cparams.flash_attn`), `llama-arch.cpp:1082` (LFM2 is hybrid),
`llama-context.cpp:120`/`:396`/`:3755-3759`, `llama-governor.cpp:38`,
`common/common.h:580` (`bool no_kv_offload = false; // disable KV offloading`),
`common/common.cpp:1767` (`cparams.offload_kqv = !params.no_kv_offload;`),
`ggml-hexagon.cpp:5297` + `:5314-5316` + `:6523-6526` + `:6818-6825` + `:4149-4152`,
`ggml-backend.cpp:888-908` + `:938-941`, `ggml.c` naming the node after the destination.

One **mis-citation** (diagnosis §4, not the commit): it justifies the conv state with
`llama-model.cpp:2588`. That line is inside the `llm_arch_is_recurrent` branch
(`llama-model.cpp:2579-2592`), which LFM2 never takes — it is hybrid (`llama-arch.cpp:1082`) and
goes through `llama-model.cpp:2673-2691`. The load-bearing lines are `llama-memory-hybrid.cpp:79`
→ `llama-memory-recurrent.cpp:87-92` (quoted in F1). The conclusion is right; the pointer is not.

## F6 — CONFIRMED: the "pre-existing failure" claim in the commit message is TRUE

Credit where due — I checked it adversarially and it holds. At `b4a13d9a` (base `cpp/rn-llama.cpp`
+ base test), with the original 2400-char window:

```
FAIL src/__tests__/governorLaneRepack.test.ts
Tests:       1 failed, 4 skipped, 2 passed, 7 total
```

and the window distance at `b4a13d9a` was 4146 chars > 2400, so the match was `null`. The commit
did not invent a failure to justify touching an unrelated pin.

## F7 — CONFIRMED: the widened window still pins its assertion, but the margin is thin

`src/__tests__/governorLaneRepack.test.ts:19`

```js
      /bool load_governor_models\([\S\s]{0,6000}?common_init_from_params\(prefill_params/,
```

Mutation — replace `if (!load_options.decode_repack) {` with `if (false) {`:

```
M4 EXIT=1
Tests:       1 failed, 4 skipped, 2 passed, 7 total
```

The assertion still bites. And because the quantifier is **lazy** (`{0,6000}?`), it terminates at the
*first* `common_init_from_params(prefill_params`, so it cannot run past that into another function's
text — widening did not weaken the pin's reach, contrary to the worry in the brief.

The real problem is margin. Measured on the post-fix source:

```
distance bool load_governor_models( -> common_init_from_params(prefill_params = 4773 chars (window 6000, old 2400)
headroom left: 1227 chars
```

~14 more lines of comment or code anywhere between the function signature and the prefill init turn
this pin red again, with the same opaque `expect(lane).not.toBeNull()` failure and no pointer to
which invariant moved. This commit's own 9-line comment ate 627 of the old margin's worth. It is a
maintainability finding, not a correctness one — but it has now failed once and will fail again.

## F8 — CONFIRMED: test run results (the runs the brief asked for)

Targeted, in the repo, unmodified:

```
$ npx jest src/__tests__/governorLaneKvPlacement.test.ts src/__tests__/governorLaneRepack.test.ts > /tmp/audit-jest-targeted.log 2>&1; echo EXIT=$?
EXIT=0
PASS src/__tests__/governorLaneKvPlacement.test.ts
PASS src/__tests__/governorLaneRepack.test.ts
Test Suites: 2 passed, 2 total
Tests:       7 passed, 7 total
```

The commit's "17 suites / 67 tests, exit 0" full-run claim was not re-run (out of scope for a
targeted filter); nothing in this audit contradicts it.

## F9 — CONFIRMED: process gap — the fix is not in any app build yet

`~/Projects/kalsa/package.json:52`

```json
    "llama.rn": "github:Aspis0/kalsa.rn#b4a13d9a73bcd501524feec74101891ad71649c1",
```

The app pins the **base**. The device run that has to prove this needs the pin bumped in
`package.json` *and* `package-lock.json` (the pin is a sha in both), with
`scripts/assert-engine-provenance.sh` to pass. Worth stating in the milestone-1 arm's runbook, or
the "fix verified on device" step will be run against a build that does not contain the fix.

## F10 — PLAUSIBLE, low: "spike-validated" overstates the spike

The commit message calls it "the spike-validated lane shape". The spike's own report records three
verdicts and **two are failures**:

- `governor-htp-prefill-spike/REPORT.md` §Costruzione e handoff: `max_abs_diff CPU = 5.133e-1`
  against a `max_abs_diff <= 1e-3` requirement, "**Entrambe le esecuzioni terminano con EXIT=1 per
  `CPU ORACLE MISMATCH`**".
- §Follow-up: handoff governor lungo: "**Esito complessivo: FAIL**, perché il KLD HTP è più alto"
  (mean KLD 0.000966242 vs OpenCL 0.000951171).
- §Follow-up: variance across three prompts: EQUIVALENT, and the 3485/11873 ms table lives in the
  *second* (FAIL) section.

The third section does supersede the second for KLD, and the same-device reference was itself off by
0.46, so the oracle is the weak part. But quoting "the spike-validated lane shape" and the 3485 vs
11873 ms pair without the FAIL sections is selective. Not blocking; it belongs in the commit message
or the arm's write-up.

---

## Clean-code checklist (angle 6)

- **Comment states a false invariant** — B2. Blocking.
- **Comment is 9 lines for a 1-line change** and mixes three unrelated claims (the SET_ROWS type
  refusal, the scheduler's pre-allocation constraint, the design provenance). The first two are
  load-bearing and worth keeping; the third ("the CPU decode context also reads") is the false one.
  Trim to the trap, move provenance to the commit body.
- **No preventive API added.** The change is a single field assignment on the existing
  `common_params` copy; nothing is wrapped, no new knob, no abstraction. This is the right size.
  Clean.
- **Dead code: none.** No unused variable, no dead branch, no leftover. The unrelated
  `governorLaneRepack` window widening is the only out-of-scope edit, and F6 shows it was fixing a
  real red suite — acceptable, and honestly disclosed in the commit message.

## What the device run must check (in priority order)

1. The load completes — the abort class is closed by construction (F1), but placement is inference,
   not measurement.
2. `GGML_SCHED_DEBUG=2` on the first prefill: capture the `## SPLIT #n: <backend>` table and the
   per-node assignment. Confirm the ~60 splits (F2) and confirm every `cache_*` write lands on CPU.
3. `GGML_HEXAGON_VERBOSE=1`: confirm `MUL_MAT` execute-ops still land on HTP0 at a rate comparable to
   `raw/kld_htp.log`, and that `FLASH_ATTN_EXT` does **not** (it will be on CPU).
4. Prefill wall time vs the OpenCL arm at `n_ubatch` **256** (not 512), with a 1000+ token prompt.
5. Add the `npu_lane_enabled` (or `lanePref`) field to `KALSA_GOVERNOR_PLAN` (F4) so lane state is
   self-evidencing and this class of question never needs re-deriving from tombstones.
