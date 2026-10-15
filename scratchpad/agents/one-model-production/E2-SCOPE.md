# E2-SCOPE — one-model governor: weight sharing, the two-model constraint, app reachability, delta

Read-only recon. Trees: `llama.rn-kalsa-onecopy` (binding + `vendor/llama.cpp/`),
`kalsa-moe-experiments`, `kalsa` (read only). No edits, no builds, no device work.

## Verdict (Q1)

**The weights are allocated ONCE per `llama_model` and shared by every leg. Each leg
allocates only its own compute buffer and its own KV cache — never a copy of the
weights.** A one-model governor therefore costs *one* weight set, not one per leg, and
an NPU leg that never touches the GPU adds no device-side weight copy at all. The catch
is that the sharing is *conditional*: it holds only when the leg's backend accepts the
model's weight buffer type (`ggml_backend_supports_buft`), which on this engine is the
dma-buf "shared-weights" import path — Hexagon only. Where it does not hold, the
scheduler copies the weight per split, and for a non-native (TILE32) layout weight it
does not copy at all: it fails the split. So "one weight set" is the one-copy contract,
not an unconditional property of the leg API. Separately — and this is the memory cost
the framing misses — **each leg owns a full independent KV cache**, so the one-model form
trades weight copies for N KV caches.

---

## Q1 — Weight allocation, traced

Weights are owned by the model, allocated once at load, never by a context.

`vendor/llama.cpp/src/llama-model.cpp:2089` — the real weight buffer:
```
buf = ggml_backend_alloc_ctx_tensors_from_buft(ctx, buft); // real buffer
```
`vendor/llama.cpp/src/llama-model.cpp:2112` — those buffers belong to the *model*:
```
pimpl->ctxs_bufs.emplace_back(std::move(ctx_ptr), std::move(bufs));
```
`vendor/llama.cpp/src/llama-model.cpp:2109` — flagged as weights so the scheduler can
route around them:
```
ggml_backend_buffer_set_usage(buf.get(), GGML_BACKEND_BUFFER_USAGE_WEIGHTS);
```

A leg context allocates compute only. `vendor/llama.cpp/src/llama-context.cpp:4189`:
```
auto * ctx = new llama_context(*model, params, leg_devices);
```
`vendor/llama.cpp/src/llama-context.cpp:702` — a per-context scheduler over per-context
backend instances (`llama-context.cpp:371` `ggml_backend_dev_init(dev, nullptr)`):
```
sched.reset(ggml_backend_sched_new(backend_ptrs.data(), backend_buft.data(), backend_ptrs.size(), max_nodes, cparams.pipeline_parallel, cparams.op_offload));
```

The decisive rule — an already-allocated weight tensor is used **in place** if some
backend in that leg's scheduler supports its buffer type. `ggml/src/ggml-backend.cpp:1054-1066`:
```
static int ggml_backend_sched_backend_from_buffer(ggml_backend_sched_t sched, const struct ggml_tensor * tensor, const struct ggml_tensor * op) {
    ggml_backend_buffer_t buffer = tensor->view_src ? tensor->view_src->buffer : tensor->buffer;
    if (buffer == NULL) {
        return -1;
    }
    // find highest prio backend that supports the buffer type and the op
    for (int i = 0; i < sched->n_backends; i++) {
        if (ggml_backend_supports_buft(sched->backends[i], buffer->buft) &&
            ggml_backend_supports_op(sched->backends[i], op)) {
            return i;
        }
    }
```
and the failure arm at `ggml/src/ggml-backend.cpp:1069`:
```
GGML_LOG_DEBUG("%s: warning: no backend supports op %s with a weight with buffer type %s used in tensor %s, the weight will need to be copied\n",
```
which becomes a real per-split copy at `ggml/src/ggml-backend.cpp:1565`:
```
if (tensor_id_copy(src_id, cur_backend_id, 0) == NULL) {
```

What makes the in-place arm work here is a one-copy host mapping at load:
`llama-model.cpp:2074`
```
ggml_backend_buffer_t buf = ggml_backend_dev_buffer_from_host_ptr(dev, (char *) addr + first, last - first, max_size);
```
and the engine's own statement of intent, `llama-model.cpp:1197-1199`:
```
// The weights HOST buft of a device in shared-weights mode: the one-copy buffer the GPU leg imports
// through the generic dma-buf accessor of the same registry. Null when no device offers both, which
// is every device but Hexagon, and every device in two-copy mode.
```
`llama-model.cpp:1176` is the hard limit: *"a device without such an entry (every device
but Hexagon in shared mode) returns null."* Shared mode is auto-enabled when a device
offers a TILE32 layout, `llama-model.cpp:1721-1723`:
```
ml.shared_weights = buft_list_has_tile32(pimpl->cpu_buft_list);
for (const auto & [_, buft_list] : pimpl->gpu_buft_list) {
    ml.shared_weights = ml.shared_weights || buft_list_has_tile32(buft_list);
}
```

**Memory consequence for an NPU leg that never touches the GPU:** it re-uses the model's
existing weight buffers; the scheduler never allocates a second weight set for it, and it
never imports one onto the GPU. What it *does* add is a compute buffer (the sched's own,
`llama-context.cpp:702`) and a full KV cache — the leg builds its own memory at
`llama-context.cpp:434` (`memory.reset(model.create_memory(params_mem, cparams));`) backed
by `llama-kv-cache.cpp:404` (`buf = ggml_backend_alloc_ctx_tensors_from_buft(ctx.get(), buft); // real buffer`).
For a 3-leg governor that is 3 KV caches, which on a large `n_ctx` is typically the
dominant term — the weight saving is real but it is not the whole bill.

---

## Q2 — Why two, really?

**Not an engineering constraint. It is the conservative default, and it is now the
legacy path.** The one-model form is the primary implementation: `llama-governor-legs.cpp`
builds every leg over one `llama_model` (`llama-governor-legs.cpp:160`):
```
llama_context * ctx = llama_init_from_model_with_legs(model, spec.params, devices);
```
and the two-model form is the branch taken only when there are no legs
(`llama-governor-legs.cpp:241-246`):
```
llama_governor_engine llama_governor::engine_of_ctx(llama_context * ctx) const {
    if (legs.empty()) {
        return ctx == ctx_prefill ? llama_governor_engine::NPU : llama_governor_engine::CPU;
    }
    return leg_engine_of(ctx);
}
```

What is genuinely enforced:

- Two models are only demanded by the two-model constructor, `llama-governor.cpp:62-63`:
  `if (!model_prefill || !model_decode) { throw std::runtime_error("governor requires two models"); }`
- Independent KV is a real invariant in **both** forms, `llama-governor.cpp:65-66` and
  `llama-governor-legs.cpp:100-101` (`"governor legs must have independent KV caches"`).
- Leg membership: a leg device must be one the model was loaded with —
  `llama-context.cpp:4087-4089`: `"leg device %s is not one of the model's devices - a leg
  device must be one of the llama_model_params::devices the model was loaded with"`.
- Rope/YaRN agreement across legs, `llama-governor-legs.cpp:107-112`, because context init
  **writes into the shared model** — `llama-context.cpp:4192-4194`:
  `model->hparams.n_ctx_train = cparams.n_ctx_orig_yarn / cparams.rope_freq_scale;`
- CPU leg required: `llama-governor-legs.cpp:167-169`.
- Pairwise KV route compatibility: `llama-governor-legs.cpp:172-178`, `"governor legs have
  incompatible KV routes"`.
- The NPU leg must be backed by a GPU leg that admits the output weight, checked before
  any context exists: `llama-governor-legs.cpp:117-121`
  (`require_npu_leg_gpu_admits_output`).

Forced rotation is indeed one-model-only — `llama-governor.cpp:44` and `:60`, both
`"forced-leg rotation is a one-model proof hook"`. That is a *proof hook*, and it is the
only place the two-model form refuses; it does not make the one-model form test-only.

---

## Q3 — The app side, today

`npu_lane_enabled` is **not** hardcoded false. The 2026-09 note is stale. `governorInputs.ts:207`
is blank; `:208` is `function laneFit(`. The field is computed. `src/engine/governorInputs.ts:362-365`:
```
const laneEnabled =
  lanePref === "auto" ? autoOk
  : lanePref === "on" ? androidOk && visionOk && fitOk
  : false; // "off"
```
with `autoOk` at `governorInputs.ts:361`:
```
const autoOk = androidOk && visionOk && arch !== null && arch >= 73 && kindOk && fitOk;
```
and the default pref is `auto` (`governorInputs.ts:30-32`, `return pref ?? "auto";`). So for a
**dense** model on an S23-class phone the lane is on today; `src/engine/governorInputs.test.ts:470-476`
asserts exactly that.

The blocker is `governorInputs.ts:359`:
```
const kindOk = modelKind(modelEntry) !== "MoE";
```
and `governorInputs.ts:403`, a literal:
```
htp_experts_readable: false,
```
with the reason at `governorInputs.ts:401-402`: *"No app-side signal says whether MoE
expert weights are HTP-readable — MoE never passes `kindOk` below, and the engine requires
the pair."* `htp_trunk_readable` is `laneEnabled` (`:400`); `npu_fit` is `npuLane.fit`
(`:396`), priced with `NPU_PREFILL_EXTRA_MIB = 219` (`governorInputs.ts:38`, used at `:341`).

The app never sends leg specs — no `legs`/`leg_specs` anywhere in `src/`; the only hits are
the word "leg" in comments. The binding builds them itself from a hardware table,
`cpp/rn-llama.cpp:444`:
```
const bool onecopy_requested = leg_set.one_copy && governor_params.npu_lane_enabled;
```

**Plainly: no.** For every **MoE** model the NPU prefill lane is unreachable from the app
today — `kindOk` is false, so `laneEnabled` is false, so `npu_lane_enabled` is false, so
`onecopy_requested` is false and the one-model three-leg load never runs. The only route
past it is the bench-only pref `"on"` (`governorInputs.ts:364`), which bypasses `kindOk`.
Since this whole effort is about MoE, the lane is reachable for exactly the wrong class
of model. The device table also only has two rows, `cpp/rn-legs-table.cpp:80` (SM8550) and
`:89` (SM8650) — Jelly Star (Helio G99) matches no row, so `one_copy` stays false there
regardless.

---

## Q4 — The delta, ranked

Hardest first.

1. **Expert readability signal (app, missing).** Nothing in the app can report whether MoE
   expert weights are HTP-readable. `governorInputs.ts:403` is a literal `false` and `:359`
   is the hard MoE veto. Without a real signal, flipping `kindOk` would claim the lane for
   models whose experts the HTP refuses.
2. **Expert-readability enforcement (engine).** The engine "requires the pair" per
   `governorInputs.ts:401-402`, but I found the admission check for the *output* weight
   only (`llama-governor-legs.cpp:117-121`). I did not find an equivalent per-expert check.
3. **Leg allow-list growth (binding).** `cpp/rn-legs-table.cpp:75-92` holds two rows; every
   other phone silently gets `one_copy = false`.
4. **Everything else is already wired.** The public one-model entry point exists
   (`src/llama-ext.h:692`, `llama_governor_init_one_model_with_params`), the leg struct is
   public (`llama-ext.h:678`), the binding calls it (`cpp/rn-governor.cpp:67`), and the
   three-leg load is implemented (`cpp/rn-llama.cpp:497`).

Traps:

- **TILE32 + no importer = hard failure, not a fallback.** `ggml-backend.cpp:1554-1562`:
  a weight whose layout is not `GGML_WEIGHT_LAYOUT_NATIVE` with no supporting backend in
  this scheduler sets `sched->split_failed = true` and logs `"cannot be copied"`. HTP
  weights are TILE32 (`llama-model.cpp:1101-1103`), so an HTP leg without the dma-buf
  importer cannot run at all. This is the sharpest edge for MoE.
- **KV is per leg, and it is not shared.** Three legs = three KV caches, each sized by its
  own `n_ctx`. Budget for it explicitly; the weight saving does not pay for it.
- **Shared-model mutation on init.** `llama-context.cpp:4194` writes
  `model->hparams.n_ctx_train` on *every* leg init. Guarded by
  `llama-governor-legs.cpp:107-112`, but the guard is a caller-side precondition on params,
  not an engine-side lock.
- **A leg is homogeneous.** `llama-context.cpp:585-587` assigns **all** layers to
  `leg_devices[0]`:
  ```
  ggml_backend_dev_t device_layer = leg_devices.empty() ? model.dev_layer(node.il) :
                                    leg_devices[0]      ? leg_devices[0] :
                                    ggml_backend_get_device(backend_cpu);
  ```
  There is no per-layer split inside a leg.
- **Buffer lifetime.** Weights live on the model (`llama-model.cpp:2112`); the governor's
  destructor frees only contexts (`llama-governor.cpp:110-116`), and the model handle is
  *borrowed* for the governor lifetime (`llama-ext.h:685`). Freeing the model first leaves
  every leg dangling.
- **Device-global Hexagon admission.** `llama-governor-legs.cpp:205-206` sets it once per
  NPU leg because "the NPU leg is this governor's sole HTP context" — a second HTP context
  anywhere in the process would contend with that assumption.

---

## Where the coordinator is wrong

1. **"The one-model form exists but is test-only."** Backwards. `llama-governor-legs.cpp` is
   the primary implementation and the binding already calls the public API
   (`cpp/rn-governor.cpp:67`). The *two-model* form is the legacy path, reachable only when
   `legs.empty()` (`llama-governor-legs.cpp:242`). "Forced-leg rotation is a one-model proof
   hook" tells you the one-model form is the one with features, not the one without them.
2. **"Two models are needed because a tensor lives in exactly one backend buffer."** The
   premise is true and the conclusion is wrong. The engine resolves exactly that with a
   dma-buf import of the *same* allocation (`llama-model.cpp:1197-1199`), so one model
   already has its weights usable by HTP and OpenCL at once. Two models exist because
   **two-copy is the default**, not because per-phase placement forbids it.
3. **The memory framing undercounts.** "One weight set" is right; "one weight set, period"
   is not. Each leg adds a KV cache (`llama-governor-legs.cpp:100`) and a compute buffer.
4. **The Q3 note is stale in a way that matters.** `npu_lane_enabled` is computed and
   already `true` for dense S23-class loads. The real gate is `kindOk` at
   `governorInputs.ts:359` — MoE, i.e. our own target class — not a hardcoded `false`.

## What I could not verify

- **Whether the expert weights actually are HTP-readable.** No signal exists app-side and I
  found no engine-side per-expert admission check; only the output-weight check at
  `llama-governor-legs.cpp:117-121`. This is the load-bearing unknown for the whole plan.
- **Runtime `ggml_backend_supports_buft` behaviour for the OpenCL↔Hexagon pair.** I read
  the rule (`ggml-backend.cpp:1062`) and the dma-buf intent (`llama-model.cpp:1197-1210`),
  but not the Adreno/OpenCL importer that must satisfy it, and I ran nothing on a device.
- **Jelly Star / Helio G99 one-copy status.** Inferred from `rn-legs-table.cpp:75-92`
  having no matching row; I did not run `rn_read_hw_facts()` on that phone.
- **`kalsallama-upstream-b11514` vs. the vendored tree.** I read the vendored
  `vendor/llama.cpp/` only (the tree the app builds). I did not diff the two engines.
- **Whether `npu_lane_enabled` is threaded unchanged through the TS→JSI boundary.** I read
  `buildGovernorParams` and the binding's `governor_params.npu_lane_enabled` reader, not the
  JSI marshalling between them.