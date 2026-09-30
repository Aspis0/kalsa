# Diagnosis + fix: S23 lane-on load abort (`cache_v_l2 (view)` SET_ROWS in HTP0)

Date: 2026-09-30. Author: ZCode session (no device, no adb). Binding worktree:
`~/Projects/llama.rn-kalsa-gov-platform`, branch `feat/governor-platform-status`,
base `b4a13d9a`, fix commit **`17446ac4`** (local only, not pushed).
All file:line references are at that base unless noted. Evidence:
`REPORT.md`, `raw/tombstones.txt`, `raw/crash-173044.txt`, `raw/laneon-cold1-evidence.txt` in this folder.

## 1. Why the V cache of layer 2 lands in an HTP0 buffer

The prefill context's KV cache is placed on the **layer device** whenever KV
offload is on — and the binding turned it on by default:

- Binding, lane on: `cpp/rn-llama.cpp:119-121` — `if (device_plan.use_device) { prefill_params.devices = { resolved.device, nullptr }; }`
  (HTP0), and `cpp/rn-llama.cpp:139` — `prefill_params.n_gpu_layers = 99`.
  `offload_kqv` is never touched; the common default is `no_kv_offload = false`
  (`vendor/llama.cpp/common/common.h:580`) → `cparams.offload_kqv = true`
  (`common/common.cpp`, `cparams.offload_kqv = !params.no_kv_offload`; consumed at
  `src/llama-context.cpp:120`).
- Governor ctor: `src/llama-governor.cpp:38` — `ctx_prefill = llama_init_from_model(model_prefill, params_prefill)`.
- Layer→device: `src/llama-model.cpp:1531-1534` + `1542-1545` — with devices `{HTP0}`
  and `n_gpu_layers=99`, **every** layer gets `dev_layer[il] = HTP0`.
- Memory: `src/llama-context.cpp:396` `model.create_memory(...)`; LFM2 is a hybrid arch
  (`src/llama-arch.cpp:1082`), so `src/llama-model.cpp:2593` → `2673-2691` builds
  `llama_memory_hybrid` with `offload = cparams.offload_kqv` (= true).
- The hybrid passes it to the attention cache (`src/llama-memory-hybrid.cpp:55-74`),
  and the KV cache picks the buffer type at **`src/llama-kv-cache.cpp:239-241`**:

  ```cpp
  if (offload) {
      auto * dev = model.dev_layer(il);          // = HTP0
      buft = ggml_backend_dev_buffer_type(dev);  // HTP0 device buffer type
  }
  ```

  `cache_v_l2` is created there (`llama-kv-cache.cpp:256-260`,
  `ggml_format_name(v, "cache_%sv_l%d", name_tag, il)`) and allocated in the HTP0
  buffer at `:308`. Layer 2 is the first attention layer of LFM2.5 (the conv layers
  are filtered out of the KV, `filter_attn = !hparams.is_recr(il)`).

## 2. Why HTP0 cannot run SET_ROWS on it

The V write in the graph is `ggml_set_rows(ctx, v, v_cur, v_idxs)` at
`src/llama-kv-cache.cpp:1456` — the **flash-attn branch** (`!v_trans`): the app loads
`cache_type_v: "q4_0"` (`~/Projects/kalsa/src/engine/LlamaService.ts:2252, 2471-2472`)
with `flash_attn_type: "auto"` (`:2470`), and the engine upgrades quantized V + AUTO to
FA **ENABLED** before the context is built (`src/llama-context.cpp:3755-3759`), so
`v_trans = false` (`src/llama-model.cpp:2677`, `attn_v_trans = !cparams.flash_attn`).
`ggml_set_rows` names its node after the destination: `result = ggml_view_tensor(ctx, a)`
(`ggml/src/ggml.c:4000-4017`) → "cache_v_l2 (view)" — exactly the abort tensor.

The refusal is in the Hexagon backend:

```cpp
// ggml/src/ggml-hexagon/ggml-hexagon.cpp:5297, refusal at :5314-5316
static bool ggml_hexagon_supported_set_rows(...) {
    ...
    if (dst->type != GGML_TYPE_F32 && dst->type != GGML_TYPE_F16 && dst->type != GGML_TYPE_Q8_0) {
        return false;   // q4_0 V cache refused here
    }
```

The scheduler then has no placement: `ggml/src/ggml-backend.cpp:888-908`
(`backend_from_buffer`) finds no backend that both supports the HTP0 buffer type and
the op — HTP supports its own buft (`ggml-hexagon.cpp:6818-6825`) but refuses the op,
the CPU backend supports the op but not the buft — and the destination is
pre-allocated, which cannot be moved:

```cpp
// ggml/src/ggml-backend.cpp:938-941
if (tensor->buffer || (tensor->view_src && tensor->view_src->buffer)) {
    GGML_ABORT("pre-allocated tensor (%s) in a buffer (%s) that cannot run the operation (%s)", ...);
}
```

Reached via `llama_context::sched_reserve` → `resolve_fused_ops` (auto-FA probe) →
`graph_reserve` during the governor prefill-context construction — the 3 s delay after
`KALSA_GOVERNOR_PLAN` is the model load itself; the abort fires on the first reserve.

## 3. The lane-OFF case: **REFUTED** as a native path; the crash was almost certainly a lane-on load

Binding b4a13d9a's lane-off path cannot admit HTP0:

- `cpp/rn-llama.cpp:83-94` (`lane_off_devices`): explicit lists are filtered with
  `devices_excluding_registry(source, ggml_backend_reg_by_name("HTP"))`; the empty-list
  sweep takes only `GGML_BACKEND_DEVICE_TYPE_GPU` devices — which includes HTP (it
  reports GPU type, `ggml-hexagon.cpp:6523-6526`) — and then the same registry filter runs.
- The filter is sound: the Hexagon registry name is "HTP" (`ggml-hexagon.cpp:6903`) and
  its devices carry `.reg = reg` (`ggml-hexagon.cpp:6868`), so
  `devices_excluding_registry` (`cpp/rn-governor-params.cpp:194-204`) removes them.
- Registration timing is not a race: `ensureBackendInitialized()` =
  `llama_backend_init()` once, synchronously at the top of the same JSI load task
  (`cpp/jsi/RNLlamaJSI.cpp:248-252, 660`), and the registry constructor registers HTP
  under `GGML_USE_HEXAGON` (`ggml/src/ggml-backend-reg.cpp:152-154`) — before
  `load_governor_models` ever runs. If `htpdrv_init()` failed, the reg would be null
  but no HTP *device* would exist either — nothing to exclude.
- The JSI default device list independently drops any device named `HTP*`
  (`cpp/jsi/RNLlamaJSI.cpp:99-109`, applied at `:118`), and the app never passes an
  explicit `devices` array (no `devices:` in `~/Projects/kalsa/src`).
- The decode context cannot place KV on HTP in any lane state: `n_gpu_layers = 0`
  (`cpp/rn-llama.cpp:140`) → `act_gpu_layers = 0` → every `dev_layer` is the CPU device
  (`src/llama-model.cpp:1523-1530`).

What could make the 16:51:03 crash "lane off"? Only the lane *value*: `npu_lane_enabled`
is read fresh from AsyncStorage per load (`LlamaService.ts:2284` →
`governorInputs.ts:261-264, 281` → `cpp/rn-governor-params.cpp:150`), but no log line
records it (the plan JSON has `npu_device`, which is null only for a genuinely lane-off
load — no plan line was captured for that load). The runner flips `kalsa.bench.npu_lane`
by writing the AsyncStorage SQLite DB directly; a running app can serve a stale value
from RN's in-process AsyncStorage cache. Verdict: **PLAUSIBLE** that the crashing load
was actually lane-on; **REFUTED** that b4a13d9a native code can place HTP0 with the
lane off. The crash signature itself requires HTP0 in the prefill device list, and only
the `npu_lane_enabled` branch sets that.

## 4. The fix

Design source of truth: the HTP prefill spike
(`scratchpad/agents/governor-htp-prefill-spike/REPORT.md:7`): the validated lane shape is
**weights on HTP0, prefill attention/KV in host memory via `offload_kqv=false`**, decode
on CPU — it ran end-to-end on this S23 (no crash, prefill 3485 ms vs OpenCL 11873 ms on
turn 1, KLD/agreement equivalent across three prompts, commit bytes exact).

Smallest correct fix, binding-only (no engine change needed): in `load_governor_models`,
inside the block that fires only when HTP0 actually resolved:

```cpp
if (device_plan.use_device) {
    prefill_params.devices = { resolved.device, nullptr };
    prefill_params.no_kv_offload = true;   // new (cpp/rn-llama.cpp:122-131 at 17446ac4)
}
```

- KV buffers fall back to the CPU buffer type (`llama-kv-cache.cpp:237`), the q4_0
  SET_ROWS runs on CPU, and the conv state follows (same flag in
  `llama-model.cpp:2588`). The CPU decode context reads the same host memory — the
  stated design. Both contexts keep identical cache types and `v_trans` (quantized V
  forces FA on both, `llama-context.cpp:3755-3759`), so the KV route/commit contract is
  untouched.
- A lane that degrades to GPU (`use_device == false`) keeps today's OpenCL placement;
  lane-off is byte-identical to before.
- Alternatives rejected: implementing q4_0 SET_ROWS/FA on HTP is engine work with new
  DSP kernels (would have stopped the task per the engine-first rule); forcing the
  prefill V cache to f16/q8_0 changes memory fit and numerics and risks the KV route
  type-match check. `no_kv_offload` is exactly the knob the spike validated.
- HTP FA supports only F16/Q8_0 K/V (`ggml-hexagon.cpp:4149-4152`), so with the app's
  q4_0 V the flash-attn nodes of the prefill graph will route to the CPU backend
  (proven working by today's CPU decode context, same cache types) while the MUL_MATs
  run on HTP. Whether that split still beats OpenCL is precisely what the milestone-1
  NPU arm must measure on device.

## Commit

`17446ac4` on `feat/governor-platform-status` (base `b4a13d9a`), **not pushed**.

- `cpp/rn-llama.cpp` +9 — the `no_kv_offload` assignment with the why-comment.
- `src/__tests__/governorLaneKvPlacement.test.ts` +50 — new source pin (4 cases): the
  lane sets `prefill_params.no_kv_offload = true;`, inside the `use_device` block only,
  and the lane-off branch stays free of it.
- `src/__tests__/governorLaneRepack.test.ts` +2/-1 — **pre-existing failure found**:
  its `load_governor_models` regex window (2400 chars) no longer matched the function
  (4146 chars at b4a13d9a — verified against `git show HEAD`), so that suite was red
  before this change. Widened to 6000, assertions unchanged.

Test runs (host only; `npx jest`, binding uses npm — no pnpm anywhere):

- Targeted (`governorLaneKvPlacement governorLaneRepack`): exit 0, 7/7.
- Full: `npx jest > /tmp/jest-final.log 2>&1; echo EXIT=$?` → **EXIT=0**,
  17 suites / 67 tests / 5 snapshots, all pass.

## What only a device run can prove

1. The lane-on load completes: the fix removes the abort by construction (KV no longer
   in HTP0 buffers), but the host cannot execute the HTP graph — prefill correctness,
   HTP `execute-op` evidence, and the FA-on-CPU/`MUL_MAT`-on-HTP split performance are
   device facts.
2. Whether the host-KV shape still wins vs OpenCL prefill on the S23 (the spike used
   default F16 KV; the app ships q8_0 K / q4_0 V, so attention lands on CPU) — this is
   the milestone-1 NPU arm's measurement, unplugged per the energy rules.
3. The 16:51:03 lane-off crash cannot be root-caused further without a lane-value log
   line; recommend logging `npu_lane_enabled` (or `lanePref`) in `KALSA_GOVERNOR_PLAN`
   so a rerun is self-evidencing.
