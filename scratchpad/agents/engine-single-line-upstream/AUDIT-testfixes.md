# Hostile audit — the four post-merge test/docs commits

Target: `Aspis0/kalsallama` @ `4d89cc436` (main = `e3c43a9db` + 4 local commits).
Auditor read-only on `~/Projects/kalsallama`; all builds in a throwaway
`git worktree add /tmp/kalsa-audit-wt 4d89cc436`, deleted after. No delegation.
Metal host, Release, cmake `-DGGML_METAL=ON -DLLAMA_BUILD_TESTS=ON`.

Commits under audit: `da860fd26` (shared-cells mirror/refusal), `87cd9a383`
(devices 77-skip), `ad9baa336` (per-call shared-view warn), `4d89cc436` (F4 WHY).

## Verdicts

| commit | verdict | one line |
|---|---|---|
| `87cd9a383` | **FIX FIRST — replace** | The skip is unnecessary: two lines of params make the assertion run and pass on this host. The committed test can now only ever return 77, on host **and** phone. |
| `da860fd26` | **FIX FIRST** | Shape is right, but the mirror half is blind to a view that computes garbage (measured: greedy 108 vs 236789, and `shared_cells_decode_mirror=PASS`), the state block runs when the owner has no cells, the refusal contract can vanish silently, and the wiring keeps a dead `-m` plus a network download. |
| `ad9baa336` | **SHIP with a wording fix** | Behaviour is unchanged and the frequency is bounded (3 lines per leaf per save cycle, measured). The log sentence it prints is **false** for the non-aliasing shared view. No test can see it. |
| `4d89cc436` | **SHIP** | All three claims verified true against the code, and the code is already correct under sharing. Only nit: no `file:line`. |

---

# 1. `87cd9a383` — the skip hides exactly what the test exists to catch

## P1-A — CONFIRMED — the committed test can return nothing but 77, on every platform

`tests/test-governor-v0-devices.cpp:164`

```cpp
    auto governor_params = llama_governor_params{};
```

`llama_governor_params{}` gives `gpu_fit = Unknown`, `generation = Unknown`,
`bench_force_gpu_prefill = false` (`src/llama-ext.h:245-254`). Every non-CPU
branch of `prefill_engine()` is gated on `gpu_fit == Fit`
(`src/llama-governor-policy.cpp:258` `if (params_.bench_force_gpu_prefill && params_.gpu_fit == llama_governor_fit::Fit)`,
`:274` the V73/V75/V79 branch also requires `gpu_fit == Fit`; the NPU lane is off
by default). So `prefill_engine() == CPU`, the runtime latches
`prefill_route::CPU` (`src/llama-governor-runtime.cpp:104-106`), and

`src/llama-governor.cpp:286-288`

```cpp
    const bool cpu_route_handoff = prefill_route_ == prefill_route::CPU &&
        (is_prefill || last_phase == phase::Prefill);
    if (last_phase != phase::None && last_phase != next_phase && !cpu_route_handoff) {
```

suppresses **every** phase-handoff commit. The only other commit site is the
cpu-route catch-up at `:308-313`, which needs `p_end > d_end` — impossible when
prefill never touches `ctx_prefill`. `stats_.commit_count` therefore stays 0 and
the new branch fires.

Run (this host, Metal, `4d89cc436` as committed):

```
$ ./build/bin/test-governor-v0-devices -m ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
governor-devices: SKIP no KV commit ran, staged/naive selection untested (exit 77)
RC=77
```

The device is not the exception. `ggml_opencl` and `ggml_hexagon` both register as
`GGML_BACKEND_DEVICE_TYPE_GPU` (`ggml/src/ggml-opencl/ggml-opencl.cpp:14849`,
`ggml/src/ggml-hexagon/ggml-hexagon.cpp:7469`), so on the S23 the
"no GPU backend available" 77 at `:305` does **not** fire and `run()` executes —
with the same default params — and lands on the same new 77. The phone logs
recording `77` in
`scratchpad/agents/phone-line-audit/REPORT.md:217` came from
`governor-devices: SKIP no GPU backend available (exit 77)`
(`.../runs-standing-build/test-governor-v0-devices.model.log:1`) — a
**METAL=OFF/OPENCL=OFF host build**, not the device.

**Failure scenario.** Commit-count 0 is now a *pass* (77) everywhere. Any
regression that stops commits — a `cpu_route_handoff` guard extended, an
admission latch that picks CPU, a policy default flip, a commit that silently
`return`s early — turns the only registered staged/naive assertion into a
documented self-skip. Step A's F7 called this test "the only registered test
that would catch the governor silently losing its staged-commit path on the
phone". `87cd9a383` deletes that detection and calls it UNTESTED.

**Severity: this is not "a host-only skip". It is a permanent skip on the
device.**

## P1-B — CONFIRMED — the WHY comment's stated cause is refuted by measurement

`tests/test-governor-v0-devices.cpp:242-244`

```cpp
        // WHY skip instead of fail: staged V needs transposed, device-resident V
        // (llama-kv-commit.h), and the staged/naive counters only ever move when
        // a phase handoff commits KV. With commit_count==0 there was nothing to
```

The second clause is right. The first clause is **wrong as the explanation for
the zero counters**: staged V *is* available on this host. The test's own
`context_params()` sets `flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED`, so
`v_trans = !cparams.flash_attn = true`, and the prefill context's V lives on the
Metal buffer, so `can_stage_v = cache.v_trans && has_non_host_v(cache)`
(`src/llama-kv-commit.cpp:54-56`) is **true**. Forcing the route (P1-C) yields
`staged=2`. The real cause is the CPU prefill route, and the comment names the
wrong one — which is exactly the reasoning error that made the skip look
unavoidable.

## P1-C — CONFIRMED — the route can be forced; the assertion then runs and PASSES here

Yes. The file already has the hook, but only as a **policy unit test**:
`tests/test-governor-v0-devices.cpp:119` `bool test_bench_force_gpu_prefill()`
constructs a bare `llama_governor_policy` and never touches a governor, so it
proves the policy can return GPU while the governor under test still runs
everything on CPU. Two lines in `run()` close the gap. Both variants verified in
the scratch worktree.

**Variant A (ctor, recommended)** — `tests/test-governor-v0-devices.cpp:164`:

```cpp
    auto governor_params = llama_governor_params{};
    governor_params.gpu_fit = llama_governor_fit::Fit;
    governor_params.bench_force_gpu_prefill = true;
```

```
$ ./build/bin/test-governor-v0-devices -m ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
governor_v0_devices_stats prefill_reused=9 decode_reused=18 prefill_splits=2 decode_splits=1 \
  commits=3 naive=1 staged=2 k_transfers=48 v_naive_transfers=8192 v_staged_transfers=8208 \
  bytes=1720320 us=21026
governor_v0_devices=PASS turns=3 generated=6
RC=0
```

**Variant B (the app's own route setter)** — `gpu_fit = Fit` in the ctor plus,
after `llama_governor_set_thermo_profile`, `llama_governor_set_prefill_override(governor.get(), 2)`
(`src/llama-ext.h:484`, the call behind the binding's `setPrefillOverride("gpu")`):
identical stats, `commits=3 naive=1 staged=2`, `RC=0`.

The counters are deterministic, not incidental: turn 1's fixture is a single
token, which `decode_impl` classifies as decode (`is_prefill = batch.n_tokens > 1`,
`src/llama-governor.cpp:262`), so only turns 0 and 2 hand off — one
Prefill→Decode (staged, source = GPU prefill context) and one Decode→Prefill
(naive, source = CPU decode context). Both selection outcomes are exercised.

**Cost: 4.046 s vs 4.010 s** (`time`, model load dominates). The skip buys
nothing and a working assertion is free.

## P1-D — CONFIRMED — the negative control: the guard fires on the regression

With the forced route and the 77 replaced by a hard precondition
(`tests/test-governor-v0-devices.cpp:241-252` region):

```cpp
        if (stats.commit_count == 0) {
            std::fprintf(stderr, "governor-devices: no KV commit ran (prefill_engine=%d) - staged/naive selection untested\n",
                         (int) stats.prefill_engine);
            return 1;
        }
```

re-running with the route forced back to CPU (the simulated regression):

```
$ ./build/bin/test-governor-v0-devices -m ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
governor-devices: no KV commit ran (prefill_engine=0) - staged/naive selection untested
RC=1
```

`stats.prefill_engine` is already in `llama_governor_stats`
(`src/llama-ext.h:371`), so the route itself is assertable and the failure names
its cause instead of hiding it.

## P1-E — PLAUSIBLE — the counters are asserted *after* a 3-turn battery is thrown away

The 77 is returned after the full oracle loop, position checks and all
(`:196-236`). A run that did real cross-backend work (and could report a token
mismatch) is discarded as UNTESTED on the strength of one counter. Unreachable
once P1-C lands, but it is the shape of the mistake: the test cannot tell "the
feature is absent here" from "the feature is broken".

## P1-F — minor — the function signature churn

`run()` went `bool` → `int` and every `return false;` became `return 1;`
(13 sites). Correct and mechanical, but it makes `git blame` on the assertion
noisy and any future `return false` a compile error — keep it, just note the
replacement is `1` and not `EXIT_FAILURE` anywhere (fine, same value).

## P1 verdict

**REPLACE, do not keep.** Concrete replacement:

1. `tests/test-governor-v0-devices.cpp:164` — add
   `governor_params.gpu_fit = llama_governor_fit::Fit;` and
   `governor_params.bench_force_gpu_prefill = true;` with a WHY comment that
   names the *route* as the cause (P1-B), not staged-V.
2. Delete the `commit_count == 0 → 77` branch (`:248-251`).
3. Add a hard precondition before the counter assert:
   `if (stats.prefill_engine != llama_governor_engine::GPU || stats.commit_count == 0) → return 1`
   with the measured counts in the message.
4. Keep the `no GPU backend available` 77 at `:305` — that one is a genuine
   environment skip, and it is the only 77 the test should be able to return.
5. Retitle the "UNTESTED" wording: with the route forced, a zero counter is a
   failure on every platform, so the CMake `SKIP_RETURN_CODE 77`
   (`tests/CMakeLists.txt:374`) stays but becomes reachable only via the
   no-GPU path.

---

# 2. `da860fd26` — right shape, wrong coverage

## P2-A — CONFIRMED — `KALSA_PLAIN_GGUF` is not a plain KV fixture; it is an iSWA fixture

`src/models/gemma3.cpp:4-11`

```cpp
    const bool found_swa = ml.get_key(LLM_KV_ATTENTION_SLIDING_WINDOW, hparams.n_swa, false);
    if (found_swa && hparams.n_swa > 0) {
        hparams.swa_type = LLAMA_SWA_TYPE_STANDARD;
```

so `llama_model.cpp:2859` takes the `llama_kv_cache_iswa` branch, not
`llama_kv_cache`. The test says so itself at run time:

```
$ KALSA_HYBRID_GGUF=.../LFM2.5-2.6B-QAD-Q4_0.gguf \
  KALSA_PLAIN_GGUF=~/kalsa-models/test/gemma-3-270m-it-Q8_0.gguf \
  ./build/bin/test-governor-v0-shared-cells
shared_cells_memory=llama_memory_hybrid      <- hybrid fixture
shared_cells_memory=llama_kv_cache_iswa      <- the "PLAIN" fixture
```

Consequences: (a) the `memory_kind::plain` branch
(`tests/test-governor-v0-shared-cells.cpp:124-127`) is **dead** with the
documented default; (b) the env var name and the commit message
("KALSA_PLAIN_GGUF added") tell the coordinator a plain `llama_kv_cache` mirror
is covered when it is not. The branch itself is fine — I forced it with a dense
non-SWA fixture (`stories15M-q4_0.gguf`, both env vars) and it passes:

```
shared_cells_memory=llama_kv_cache
shared_cells_decode_mirror=PASS ... shared_cells_negative_guards=PASS   RC=0
```

so the fix is documentation plus a fixture: either rename the variable
(`KALSA_MIRROR_GGUF`) or point it at a dense model, and print the class in the
skip message so the operator can see which half ran.

## P2-B — CONFIRMED — the mirror half is blind to a view that computes garbage

`tests/test-governor-v0-shared-cells.cpp:203-215`

```cpp
    if (!decode_one(ctx_b, tokens.back(), static_cast<llama_pos>(expected))) {
        std::fprintf(stderr, "shared-cells: non-owner decode failed on live cells\n");
        return false;
    }
    for (const auto & pair : pairs) {
        const auto after = pair.owner->find_slot(probe, false);
        if (after.empty() || after.head() != expected || pair.owner->seq_pos_max(0) != expected_pos) {
```

`rc == 0` plus "the owner's bookkeeping did not move" is all that is asserted.
Nothing checks that the view *read the owner's K/V*. It does not, for a
non-aliasing shared view: the ctor allocates the view its own tensors
(`src/llama-kv-cache.cpp:266-274`, `ggml_new_tensor_3d` per layer) and only the
`share` callback path aliases the source (`layers.push_back(layer_share)`,
`:222-224`) — and `share` is set **only** for `LLM_ARCH_GEMMA4_ASSISTANT`
(`src/llama-model.cpp:2882-2895`); every other iSWA arch takes `mem_share_iswa`
(`:2901-2915`), which shares the *cell store* only. The view's
`apply_ubatch` early-returns (`src/llama-kv-cache.cpp:1169`), so nothing ever
writes those tensors.

Measured in the scratch worktree (probe added, then reverted): after the owner
re-prefills, both sides decode the same token at the same position on the shared
cells.

```
AUDIT: owner_vs_view logits_max_abs_diff=22.085844 nan=0 greedy_owner=108 greedy_view=236789 match=0 ok_a=1 ok_b=1
AUDIT: owner_layers=18 aliased_tensors=0 shared_cell_store=1
```

18 layers, **0 of 36 K/V tensors aliased**, cell store shared. The view's decode
returns 0 and produces a different greedy token — and the test prints
`shared_cells_decode_mirror=PASS`.

**Failure scenario.** The headline line of the mirror half is not evidence that a
drafter works. A future change that makes the view *stop* reading the owner's
K/V (e.g. a `share` wiring regression, or someone "fixing" `apply_ubatch` to
write cells from the view) is invisible, and so is the reverse: the test would go
on calling a zero-reading view a working mirror. The Gemma-4 assistant path
(which does alias) cannot be reached here at all — the arch is a property of the
loaded model, so no single-model fixture selects it.

**Fix (one assertion, no new fixture):** make the mirror half state what it
actually depends on. Either assert the view's logits match the owner's on
identical shared state (`logits_max_abs_diff` ≈ 0 and equal greedy token) and
*fail* today for the non-aliasing case, or — if the current non-aliasing
behaviour is accepted as-is — assert the negative explicitly and print it:
`shared_cells_view_reads_owner_kv=NO` plus `aliased_tensors/n_layers`, so the
day someone wires the aliasing, the number moves and the test says so. A PASS
line whose meaning depends on an unasserted aliasing property should not be
called a mirror.

## P2-C — CONFIRMED — the state-IO block is unfalsifiable as written

`tests/test-governor-v0-shared-cells.cpp:283-295`

```cpp
    // the shared view carries no KV state of its own: the round trip succeeds
    // (the shared attn part contributes nothing) and never touches the owner
    // cells
    {
        const size_t n_state = llama_state_seq_get_size_ext(ctx_b, 0, LLAMA_STATE_SEQ_FLAGS_NONE);
        std::vector<uint8_t> state(n_state);
        if (llama_state_seq_get_data_ext(ctx_b, state.data(), state.size(), 0, LLAMA_STATE_SEQ_FLAGS_NONE) != state.size() ||
            llama_state_seq_set_data_ext(ctx_b, state.data(), state.size(), 0, LLAMA_STATE_SEQ_FLAGS_NONE) != state.size() ||
            llama_memory_seq_pos_max(mem_a, 0) != -1) {
```

The guard clause is `llama_memory_seq_pos_max(mem_a, 0) != -1` — but the owner
was already fully removed 10 lines earlier (`:277-280`
`if (!llama_memory_seq_rm(mem_a, 0, -1, -1) || llama_memory_seq_pos_max(mem_a, 0) != -1)`).
Instrumented:

```
AUDIT: owner_pos_max_before_state=-1 n_state_view=8 n_state_owner=24
```

`pos_max` is already `-1` when the round trip starts, so the third disjunct
cannot fire: a shared-view `state_write` that wiped every shared cell would still
print `shared_cells_state_mirror=PASS`. This is the F5 contract, and it is the
one assertion in the file that cannot fail. Move the block **before** the
`seq_rm` block and additionally assert the size relationship
(`n_state_view < n_state_owner`, measured 8 vs 24) so "the view contributes
nothing the source does not" is checked rather than assumed.

## P2-D — CONFIRMED — the refusal half can vanish while ctest reports Passed

`tests/test-governor-v0-shared-cells.cpp:390-416` reads the two paths from the
environment and never checks that they are the intended classes;
`collect_shared_caches` (`:107-128`) dispatches on the *loaded* memory, so the
env var names are advisory only. Nothing asserts
`kind == memory_kind::hybrid` for `KALSA_HYBRID_GGUF`.

Demonstrated: two dense fixtures in both variables.

```
$ KALSA_HYBRID_GGUF=stories15M-q4_0.gguf KALSA_PLAIN_GGUF=stories15M-q4_0.gguf \
  ./build/bin/test-governor-v0-shared-cells
shared_cells_memory=llama_kv_cache
shared_cells_memory=llama_kv_cache
... (no *_fence=PASS line anywhere)   RC=0
```

**Failure scenario.** The phone's actual contract — `llama_memory_hybrid::
shared_fence` refuses every shared-view op — is untested, the run is green, and
the coordinator reads `0`. Fix: after `run()` reports its kind, assert the
expected class per variable and fail (not skip) on a mismatch.

## P2-E — CONFIRMED — the refusal half keeps everything the fence-era test asserted

Compared line by line against `git show d07d0181b:tests/test-governor-v0-shared-cells.cpp`:

| fence-era assertion (d07d0181b) | new location | kept |
|---|---|---|
| `cache_b->seq_pos_max(0) != expected_pos` (view head) | `:151` in `head_continuity` (loops `pairs`; for hybrid `pairs[0]` is the same leaf `llama_kv_context_attn_cache(ctx_b)`) | yes |
| `slot_a.head() != expected \|\| slot_b.head() != expected` | `:148` `head_continuity` | yes |
| `llama_memory_clear(mem_b)` must not change the owner | `:174-178` | yes |
| non-owner decode must fail | `:180-183` | yes |
| owner decode after the refusal must succeed and advance | `:185-189` | yes |
| non-owner `seq_rm` must fail | `:191-194` | yes |
| `bad_type` / `bad_size` negative guards | `:365-373` | yes |
| `shared_cells_size` / `next_slot` output | `:358-362` | yes (+ a new `shared_cells_memory=` line) |

Nothing was dropped, and the hybrid branch additionally folds the recurrent side
into the owner check (`llama_memory_seq_pos_max(mem_a, 0)` is the hybrid's
folds-attn-with-recr max), so a view decode that wiped the recurrent tail would
also be caught. Good.

## P2-F — CONFIRMED — `dynamic_cast` types are right; the classification order is safe

`tests/test-governor-v0-shared-cells.cpp:110-127`. The three classes are
siblings under `llama_memory_i` — `llama_memory_hybrid : public llama_memory_i`
(`src/llama-memory-hybrid.h:19`), `llama_kv_cache_iswa : public llama_memory_i`
(`src/llama-kv-cache-iswa.h:15`), `llama_kv_cache : public llama_memory_i` — so
the three casts are mutually exclusive, and the hybrid test must come first
because `llama_kv_cache_iswa` is **not** a `llama_kv_cache` (it *contains* two of
them; `get_base()`/`get_swa()` are the accessors used, `src/llama-kv-cache-iswa.h:92-93`).
`llama_memory_hybrid_iswa` and `llama_memory_hybrid_idx` are separate classes
(`src/llama-memory-hybrid-iswa.h:19`, not derived from `llama_memory_hybrid`) and
are correctly *not* matched; both reject `ctx_other` at load time
(`src/llama-model.cpp:2758` `throw std::runtime_error("ctx_other is not supported for hybrid-SWA memory yet")`,
`:2709` for the others), so a hybrid-iswa fixture fails early with a loader
message rather than a misleading `memory_kind::unsupported`. RTTI is on
(`src/llama-kv-commit.cpp:288-289` already `dynamic_cast`s `llama_memory_hybrid`
across the same library boundary). No defect.

Minor: for `llama_kv_cache_msa` / `llama_kv_cache_dsa` the loader does **not**
share (no `mem_other` parameter exists in those files — verified, zero hits), it
merely warns `"not sharing cells: the other context's memory is of another class"`
(`src/llama-model.cpp:2854-2859`) and builds an unshared context. The test then
reports `"fixture memory is not a shareable KV cache"`, which is true but points
at the wrong cause. Cosmetic.

## P2-G — CONFIRMED — the CMake wiring: `SKIP_RETURN_CODE` is right, the rest is not

`tests/CMakeLists.txt:331-335`

```cmake
# Fixtures come from KALSA_HYBRID_GGUF / KALSA_PLAIN_GGUF; exits 77 (SKIP) when one is unset.
llama_build_and_test(test-governor-v0-shared-cells.cpp LABEL "model" ARGS -m "${MODEL_DEST}")
set_tests_properties(test-governor-v0-shared-cells PROPERTIES
    FIXTURES_REQUIRED test-download-model SKIP_RETURN_CODE 77)
```

* `SKIP_RETURN_CODE 77` — correct property name and value; `main()` returns
  `skipped ? 77 : 0` only when nothing failed. ✔
* `ARGS -m "${MODEL_DEST}"` is **dead**: `int main()` at `:390` takes no
  arguments and ignores `argv` entirely (the fence-era version had
  `int main(int argc, char ** argv)` + `common_params_parse`). An operator
  passing `-m /path/to/hybrid.gguf` gets a silent no-op, and the operator's log
  says they tested that model. This is the same trap
  `scratchpad/agents/release-prep/REPORT.md:103` records for the other targets
  ("BARE ... rc=1 : error: --model is required").
* `FIXTURES_REQUIRED test-download-model` makes an env-fixture test depend on a
  **network download it does not use** (`tests/CMakeLists.txt:259-265` fetches
  `tinyllamas/stories15M-q4_0.gguf`). Demonstrated in the scratch build by making
  the destination unwritable:

```
1/2 Test #38: test-download-model ..............   Failed
2/2 Test #56: test-governor-v0-shared-cells ....   Not Run
```

* The established precedent for an env-var fixture in this very file is
  `tests/CMakeLists.txt:377-379` (`test-governor-v0-hybrid`): no `ARGS`, no
  `FIXTURES_REQUIRED`. Follow it.

## P2-H — CONFIRMED — default-battery coverage regressed, and the commit does not say so

The standing matrix has `test-governor-v0-shared-cells` green from a `-m`
fixture (`scratchpad/agents/phone-line-audit/REPORT.md:222`,
`| test-governor-v0-shared-cells | -m fixture | 0 | 0 |`). After `da860fd26`, a
default `ctest` run:

```
$ env -u KALSA_HYBRID_GGUF -u KALSA_PLAIN_GGUF ./build/bin/test-governor-v0-shared-cells -m <fixture>
shared-cells: SKIP KALSA_HYBRID_GGUF is unset (exit 77)
shared-cells: SKIP KALSA_PLAIN_GGUF is unset (exit 77)
rc=77
```

The fence-era coverage of the phone's own model family is now opt-in via an env
var that no CMake target, script or documented battery sets. Either export the
fixtures in the harness or have the test fall back to `${MODEL_DEST}` — but the
commit message must state that the default went `0 → 77`.

## P2 verdict

**FIX FIRST** (shape is right, five defects). Minimum set:

1. Assert the per-fixture expected memory kind (kills P2-D).
2. Move the state-IO block before the owner's `seq_rm` and assert
   `n_state_view < n_state_owner` (kills P2-C).
3. Make the mirror half state the aliasing property it depends on — assert
   owner/view logits agreement, or assert-and-print
   `aliased_tensors/n_layers` (kills P2-B).
4. Drop `ARGS -m` and `FIXTURES_REQUIRED test-download-model`; keep
   `SKIP_RETURN_CODE 77` (kills P2-G).
5. Rename/retarget `KALSA_PLAIN_GGUF` and say in the commit body that default
   coverage moved `0 → 77` (kills P2-A, P2-H).

---

# 3. `ad9baa336` — behaviour unchanged, frequency bounded, wording false

## P3-A — CONFIRMED — no behaviour change

`src/llama-kv-cache.cpp:2140-2145` and `:2224-2229`. The diff removes a
`static bool warned` guard and replaces one `LLAMA_LOG_WARN` with another. The
`return;` after it is untouched, no data path changes, and the only side effect
dropped is a benign race on a function-local static (the old one was shared
across all instances, so it warned once per *process* for the first shared view
— the F5 "long-lived app degrades silently" complaint). Accurate commit
message.

## P3-B — CONFIRMED (by measurement) — no log flood; 3 lines per leaf per save cycle

Frequency is bounded by the save cadence, not by tokens: nothing on the decode
path calls state IO. `llama_memory_i::state_write` is one virtual with
`seq_id = -1` default (`src/llama-memory.h:129`), reached from
`llama_context::state_write_data` (`:3400` and `:3434`), which is called by
`state_get_size` (a *dummy* IO pass, `:3150`), `state_get_data`, and
`state_save_file` (`:3307`). The binding's save is one
`llama_state_save_file` per save
(`node_modules/llama.rn/cpp/jsi/JSISession.h:192`) and one
`state_read_sinfo` per load. Measured on the iSWA fixture by widening the test's
log filter to `>= WARN` (one save + restore cycle, 2 leaves):

```
state_write: kv cache 0xa84d10900 is a shared view - skipping state write for seq_id=0; ...
state_write: kv cache 0xa851b4480 is a shared view - skipping state write for seq_id=0; ...
state_write: kv cache 0xa84d10900 is a shared view - skipping state write for seq_id=0; ...
state_write: kv cache 0xa851b4480 is a shared view - skipping state write for seq_id=0; ...
state_read_sinfo: kv cache 0xa84d10900 is a shared view - skipping state read for seq_id=0; ...
state_read_sinfo: kv cache 0xa851b4480 is a shared view - skipping state read for seq_id=0; ...
```

6 lines = 2 leaves × (2 writes + 1 read). So **3 lines per shared leaf per
save cycle, ~0 per turn**. `src/engine/LlamaService.ts:5925`
(`snapshotNativeSession`) is the app's only save path, and it is skipped outright
in governor mode (`JSISession.h:149` throws; `LlamaService.ts:5898-5901` logs
`{"op":"save","ok":false,"reason":"governor-mode"}`). Verdict on the flood
question: **not a flood**. The refuted part of the worry is the per-token case —
no such caller exists.

## P3-C — CONFIRMED — the printed claim is false for a non-aliasing shared view

`src/llama-kv-cache.cpp:2141-2143`

```cpp
        LLAMA_LOG_WARN("%s: kv cache %p is a shared view - skipping state write for seq_id=%d; "
                       "its cells and layers are covered by the source cache's state IO\n",
                       __func__, (void *) this, (int) seq_id);
```

"its cells **and layers** are covered by the source cache's state IO" is
refuted by P2-B's measurement: `aliased_tensors=0` — the view owns 18 layers'
worth of K/V tensors that the source's state IO never writes, and which nothing
ever writes either (`apply_ubatch` returns at `:1169`). The inherited comment
above it (`:2137-2139`, "a shared view's K/V live in the source cache's
tensors") is wrong for the same reason; it is only true when the `share`
callback aliased them (Gemma-4 assistant). This is a user-facing diagnostic
whose whole value is being believed by whoever triages "the restored drafter KV
is empty" — it must be true.

Accurate wording: *"this view owns no KV state: it never writes K/V (cell
placement is the source's job) and the shared cells are covered by the source
cache's state IO."* Drop "layers", or qualify "its layers are the source's
tensors when they are aliased (`share`), and unwritten otherwise".

## P3-D — CONFIRMED — no prompt/token leak; one pointer leak; `seq_id=-1` is unreadable

The format arguments are `__func__`, `this` and `seq_id` — no prompt text, no
token ids, no sizes. So the content-leak question is clean. Two nits:
* `%p` now prints a heap address **on every call** (before: once per process).
  In logcat that is a per-save ASLR disclosure — low value, no cost to drop.
* Whole-context saves pass the internal wildcard, so the line reads
  `skipping state write for seq_id=-1` (from `state_write_data` at `:3400` →
  `state_write(io)` with the `seq_id = -1` default). A human reading that sees a
  negative sequence id and reasonably suspects a bug. Print `seq_id=%d` only
  when `seq_id >= 0`, else "all sequences".

## P3-E — CONFIRMED — the fix is invisible to the whole test battery

Every governor test installs a sink that drops WARN:
`tests/test-governor-v0-shared-cells.cpp:31-35` and
`tests/test-governor-v0-devices.cpp:40-42`

```cpp
void log_errors(enum ggml_log_level level, const char * text, void *) {
    if (level >= GGML_LOG_LEVEL_ERROR) { std::fputs(text, stderr); }
}
```

`test-governor-v0-hybrid` and `test-governor-v0-mtp-hybrid` create shared views
(`:54`, `:67`) but never do state IO on them, and `test-governor-v0-turns` uses
state IO only on governor contexts (never shared). So `test-governor-v0-shared-cells`
is the only test that reaches this code, and it swallows the message. F5's
diagnostic has **zero** test coverage. Cheap fix: assert the round-trip byte
counts (P2-C's `n_state_view < n_state_owner`) so the behaviour is pinned even
though the text is not observable.

## P3-F — scope note, not a defect

Of the 13 `if (other)` early returns in `src/llama-kv-cache.cpp`, 2 warn
(`:2140`, `:2224`); the rest are deliberate no-ops (`:497 seq_cp`, `:589
seq_keep`, `:619 seq_add`, `:669 seq_div`, `:887 shift`, `:1169 apply_ubatch`).
Warning on those would be noise, and state IO is the one that changes the size
contract — so the selection is defensible. Worth one line in the commit body so
the next reader does not read "every skip" as "every skip".

## P3 verdict

**SHIP after a wording fix.** Edit the two `LLAMA_LOG_WARN` strings (P3-C), drop
`%p` (P3-D), fix the stale `:2137-2139` comment, and note in the commit body
that no test observes it (P3-E). No behaviour change, no flood, nothing to fix
in the control flow.

---

# 4. `4d89cc436` — every claim checks out

`src/llama-governor.cpp:194-199`

```cpp
        // WHY pos_max decides here and not seq_rm's return value: for a shared
        // KV view seq_rm answers true without removing anything (the shared
        // early return in llama-kv-cache.cpp), so a "true" there never means
        // "trimmed". The trap is unreachable today: the governor ctor refuses
        // ctx_other, so a governor context is never a shared view.
        llama_memory_seq_rm(mem, 0, p, -1);
        const llama_pos pos_max = llama_memory_seq_pos_max(mem, 0);
```

## P4-A — CONFIRMED — claim 1 (`seq_rm` answers true and removes nothing)

`src/llama-kv-cache.cpp:423-430`

```cpp
bool llama_kv_cache::seq_rm(llama_seq_id seq_id, llama_pos p0, llama_pos p1) {
    // TODO: refactor [TAG_KV_CACHE_SHARE_CELLS]
    // the cells are the source cache's object, so its seq_rm already removed
    // them from this view; running the removal here again would scan the same
    // cells a second time to free nothing
    if (other) {
        return true;
    }
```

True for `llama_kv_cache` and, by composition, for iSWA
(`src/llama-kv-cache-iswa.cpp:122-129` ANDs both leaves' returns). The hybrid
class answers **false** instead (`src/llama-memory-hybrid.cpp:182-185`
`if (shared_fence("sequence removal")) { return false; }`), and the next comment
down (`:200-203`) already documents that case. The comment scopes itself to
"a shared KV view" and names `llama-kv-cache.cpp` — accurate as written.

## P4-B — CONFIRMED — claim 2 (pos_max decides, the return is discarded)

Same snippet: the `llama_memory_seq_rm` result is not bound, and the branch is
taken on `pos_max != -1 && pos_max >= p` (`:200-204`). True.

## P4-C — CONFIRMED — claim 3 (unreachable: the ctor refuses `ctx_other`)

`src/llama-governor.cpp:34-36`

```cpp
    if (params_prefill.ctx_other || params_decode.ctx_other) {
        throw std::runtime_error("governor contexts must have independent KV caches");
```

All three constructors funnel here (the 4-arg one delegates at `:12-14`; the
params-only one at `:16-23` creates no contexts), and `llama_governor` never
re-points a context after construction (no setter/attach in
`src/llama-governor*.{cpp,h}`). Two independent reasons, worth noting for the
F1 write-up: the Gemma-4 assistant *requires* `ctx_other`
(`src/llama-context.cpp:147-149` throws without it), so the assistant context can
never be a governor context in either direction. The trap is doubly unreachable.

## P4-D — CONFIRMED (bonus) — the code is already correct, not just documented

Had the trap been reachable, `pos_max` catches it and the function *fails loudly*
rather than trimming wrongly: `untrimmable[i] → exact = false` (`:203-205`), then
the wholesale branch calls `seq_rm(mem, 0, -1, -1)` (`:212`), which a shared view
also answers `true` to without removing, so `seq_pos_max != -1` and
`trim_sequence` returns `false` (`:213-215`) → the governor latches
`route Reject during phase handoff` (`src/llama-governor.cpp:294`). That is
exactly the contract `llama_governor_trim_sequence` documents at
`src/llama-ext.h:453-465` ("Returns false if ... a required full clear could not
remove the sequence"). The comment describes a defence that is already
implemented, not a debt.

## P4-E — nit

Every other WHY in this file cites `file:line` (e.g. `llama-hybrid-commit.cpp`,
`86f602f8a`); this one cites only the file. `:427` costs nothing and will rot
otherwise.

## P4 verdict

**SHIP.** No change required beyond the optional line number.

---

# 5. Governor battery (Metal host, Release, `4d89cc436`)

Fixture `build/tinyllamas/stories15M-q4_0.gguf` unless noted;
`KALSA_HYBRID_GGUF=~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`,
`KALSA_PLAIN_GGUF=~/kalsa-models/test/gemma-3-270m-it-Q8_0.gguf`.

```
test-governor-v0                   rc=0
test-governor-v0-commit            rc=0
test-governor-v0-devices           rc=77   <- 87cd9a383's new skip; 0 with the route forced
test-governor-v0-hybrid            rc=0
test-governor-v0-shared-cells      rc=0    (77 with the two env vars unset)
test-governor-v0-turns             rc=0
test-governor-v02-router           rc=0
test-governor-platform-thermal     rc=0
test-governor-bench-route          rc=0
test-governor-bench-route-evidence rc=0
test-governor-bench-route-setter   rc=0
test-governor-bench-route-latch    rc=0
test-governor-v0-route-switch      rc=0
test-governor-v0-mtp-hybrid        rc=77   ("model has no MTP layers" - unrelated, needs a Qwen3.5-class GGUF)
```

The shared-cells run in full:

```
shared_cells_memory=llama_memory_hybrid
shared_cells_size=256
shared_cells_next_slot=6
shared_cells_clear_fence=PASS
shared_cells_decode_fence=PASS
shared_cells_seq_rm_fence=PASS
shared_cells_negative_guards=PASS
shared_cells_memory=llama_kv_cache_iswa
shared_cells_size=256
shared_cells_next_slot=6
shared_cells_decode_mirror=PASS
shared_cells_clear_mirror=PASS
shared_cells_owner_invariants=PASS
shared_cells_seq_noops=PASS
shared_cells_seq_rm_mirror=PASS
shared_cells_state_mirror=PASS
shared_cells_negative_guards=PASS
```

No crashes, no leaks of the mirror/refusal contract in the *green* case — which
is the problem: both halves are green for reasons that do not include the things
they are named after (P2-B, P2-C, P2-D).

---

# 6. Findings index

| # | commit | verdict | file:line | severity |
|---|---|---|---|---|
| P1-A | `87cd9a383` | CONFIRMED | `tests/test-governor-v0-devices.cpp:164`, `:248` | **blocker** |
| P1-B | `87cd9a383` | CONFIRMED | `tests/test-governor-v0-devices.cpp:242` | major (wrong cause in the WHY) |
| P1-C | `87cd9a383` | CONFIRMED | `src/llama-kv-commit.cpp:54`; measured `staged=2` | the fix |
| P1-D | `87cd9a383` | CONFIRMED | `src/llama-ext.h:371` | the fix |
| P1-E | `87cd9a383` | PLAUSIBLE | `tests/test-governor-v0-devices.cpp:196-252` | minor |
| P1-F | `87cd9a383` | minor | `tests/test-governor-v0-devices.cpp:160` | nit |
| P2-A | `da860fd26` | CONFIRMED | `src/models/gemma3.cpp:6`; `tests/...shared-cells.cpp:124` | major (coverage claim) |
| P2-B | `da860fd26` | CONFIRMED | `tests/...shared-cells.cpp:203`; `src/llama-kv-cache.cpp:266`, `:1169` | **major** |
| P2-C | `da860fd26` | CONFIRMED | `tests/...shared-cells.cpp:287-291` | major |
| P2-D | `da860fd26` | CONFIRMED | `tests/...shared-cells.cpp:390-416` | **major** |
| P2-E | `da860fd26` | CONFIRMED | vs `d07d0181b:tests/...` | nothing lost |
| P2-F | `da860fd26` | CONFIRMED | `tests/...shared-cells.cpp:110-127` | no defect |
| P2-G | `da860fd26` | CONFIRMED | `tests/CMakeLists.txt:332-334` | major |
| P2-H | `da860fd26` | CONFIRMED | `tests/...shared-cells.cpp:390` | major |
| P3-A | `ad9baa336` | CONFIRMED | `src/llama-kv-cache.cpp:2140`, `:2224` | no change |
| P3-B | `ad9baa336` | CONFIRMED | measured 6 lines / 2 leaves / cycle | flood REFUTED |
| P3-C | `ad9baa336` | CONFIRMED | `src/llama-kv-cache.cpp:2141`; `aliased_tensors=0` | major (false text) |
| P3-D | `ad9baa336` | CONFIRMED | `src/llama-kv-cache.cpp:2141` | minor |
| P3-E | `ad9baa336` | CONFIRMED | `tests/...shared-cells.cpp:31` | major (no coverage) |
| P3-F | `ad9baa336` | note | `src/llama-kv-cache.cpp:497-1169` | scope |
| P4-A | `4d89cc436` | CONFIRMED | `src/llama-kv-cache.cpp:427` | true |
| P4-B | `4d89cc436` | CONFIRMED | `src/llama-governor.cpp:197-200` | true |
| P4-C | `4d89cc436` | CONFIRMED | `src/llama-governor.cpp:34`; `src/llama-context.cpp:147` | true, doubly |
| P4-D | `4d89cc436` | CONFIRMED | `src/llama-governor.cpp:212-215`; `src/llama-ext.h:453` | correct already |
| P4-E | `4d89cc436` | nit | `src/llama-governor.cpp:196` | nit |

Nothing in `~/Projects/kalsallama` was edited, staged, committed or built; the
scratch worktree `/tmp/kalsa-audit-wt` was removed
(`git worktree list` no longer lists it; the repo shows only the pre-existing
untracked `CMakeUserPresets.json`).
