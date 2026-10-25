# AUDIT — P1: governor lane without the CPU repack copy (`ef901304` / `1228836f`)

Read-only. Binding `~/Projects/llama.rn-kalsa` HEAD `ef90130431077e4adfef2e9cc6be14ff3b8f0f44`
(1 ahead of `origin/kalsarn-governor-engine`, 0 tags, status = 2 pre-existing untracked pnpm files).
App `~/Projects/kalsa-wt-bench-apk` HEAD `1228836fcb84e38a1cdd9f1ac1111461ae887264`
(1 ahead of `origin/main`, 0 tags, status = 0). Coder account: `governor-nofit/P1-CODE.md`;
plan: `governor-nofit/RECON.md` §2, §3, §5.

Commands (real exits):

```
binding: npx jest src/__tests__/governorLaneRepack.test.ts   → 0 (1 suite, 2 tests)
binding: npm run typecheck                                    → 0
app:     npx jest src/engine/governorInputs.test.ts --runInBand → 0 (12 tests)
app:     npx tsc --noEmit                                     → 0 (0-line log)
```

---

## 1. Correctness of `no_extra_bufts` on the decode params — CONFIRMED

The flag is a `common_params` field, and it reaches the **model** load through the params mapping:

```
vendor/llama.cpp/common/common.h:585   bool no_extra_bufts = false; // disable extra buffer types (used for weight repacking)
vendor/llama.cpp/common/common.cpp:1693 struct llama_model_params common_model_params_to_llama(common_params & params) {
vendor/llama.cpp/common/common.cpp:1710     mparams.use_extra_bufts = !params.no_extra_bufts;
vendor/llama.cpp/common/common.cpp:1297 auto mparams = common_model_params_to_llama(params);   // common_init_result ctor
vendor/llama.cpp/common/common.cpp:1334 llama_model * model = llama_model_load_from_file(params.model.path.c_str(), mparams);
vendor/llama.cpp/src/llama-model.cpp:1477 pimpl->cpu_buft_list = make_cpu_buft_list(devices, params.use_extra_bufts, params.no_host);
vendor/llama.cpp/src/llama-model.cpp:1095     if (use_extra_bufts) {   // ggml_backend_dev_get_extra_bufts (CPU_REPACK) added only here
```

`llama_model_default_params()` defaults `use_extra_bufts` to true (`llama-model.cpp:2866`), and the
mapping above overrides it. The binding sets the flag **before** the decode model load:

```
cpp/rn-llama.cpp:77  decode_params.n_gpu_layers = 0;
cpp/rn-llama.cpp:88  decode_params.no_extra_bufts = true;
cpp/rn-llama.cpp:107     owner.governor_prefill_init = common_init_from_params(prefill_params, true);
cpp/rn-llama.cpp:116     owner.governor_decode_init = common_init_from_params(decode_params, true);
```

So the decode model is loaded with `use_extra_bufts=false` → the CPU_REPACK buft is not in its
buft list → no repack copy. The same pattern is the fork's existing precedent
(`cpp/bmoe_stream.cpp:196 params.no_extra_bufts = true;`) and the app's expert-streaming path
(`LlamaService.ts:2428 params.no_extra_bufts = true;`). CONFIRMED.

**Prefill is untouched and has no repack in the measured lane.** The assignment is on the local
`decode_params` copy only; `prefill_params` keeps `owner.params`. The engine's own load log shows
why prefill allocates none — its only CPU-resident tensor is not repackable:

```
qdc-governor-s5/raw/sa803609/8-Elite_B_t1_load.txt:1324  tensor 'token_embd.weight' (q6_K) (and 0 others) cannot be used with preferred buffer type CPU_REPACK, using CPU instead
...:1492  load_tensors:   CPU_Mapped model buffer size =   205.08 MiB     (prefill)
...:1493  load_tensors:       OpenCL model buffer size =  1512.28 MiB     (prefill)
...:2317  tensor 'token_embd.weight' (q6_K) (and 99 others) cannot be used with preferred buffer type CPU_REPACK, using CPU instead
...:2320  load_tensors:   CPU_Mapped model buffer size =  1503.20 MiB     (decode)
...:2321  load_tensors:   CPU_REPACK model buffer size =  1511.20 MiB     (decode — the term removed)
```

**Removing repack cannot break decode by layout.** The repack buft is an optimisation; the plain
CPU buft is always in the list and the loader already falls back per tensor (the
`cannot be used with preferred buffer type CPU_REPACK, using CPU instead` lines above, 100 tensors
on the decode model alone). Repack-internal types are created in memory, never stored in GGUFs, so
no model file requires the extra buft to load. Only LFM2.5 2.6B is measured; other quants in the
lane are unproven (see F6). The native compile and a device load are still unverified (the whole
point of the measurement).

## 2. App/binding consistency — CONFIRMED hazard, the one that matters

The app now prices the lane as repack-free **unconditionally**:

```
governorInputs.ts:97-100  // The lane's decode model loads with no_extra_bufts=true (binding:
                          // rn-llama.cpp load_governor_models), so no CPU repack copy exists here;
                          // pricing one demanded ~W of memory the lane never allocates.
                          repack: false,
```

while the app still pins the **old** binding, which does not contain the fix:

```
package.json:49   "llama.rn": "github:Aspis0/kalsa.rn#e437b1af3de7af563526f5777dbf25d86f9b3215"
package-lock resolved: git+ssh://git@github.com/Aspis0/kalsa.rn.git#e437b1af3de7af563526f5777dbf25d86f9b3215
node_modules/llama.rn/vendor/VERSIONS: LLAMA_CPP_COMMIT=319b539377605f6c572e234b28678b74bd78deb5
```

`ef901304` is local and unpushed (binding is 1 ahead of origin). Nothing at runtime ties the
estimate to the binding — `grep BUILD_COMMIT src` (non-test) is empty, and the fit path never reads
`engineBuildId`. With the pinned binding the gate under-prices by `4358.70 − 2998.06 = 1360.64 MiB`
and would admit a phone that then allocates the measured `CPU_REPACK = 1511.20 MiB` → lmkd kill
during load. **The pin chain does not mechanically prevent the mismatch**; only the delivery
process does. Required before any measurement or push: the app must run against binding
`ef901304` (install the local binding), and the app pin/push must land with the binding push and
pin bump. The app comment above should name that binding requirement, not just the function.

**Only in the lane, non-governor unchanged — CONFIRMED.** The assignment is inside
`load_governor_models` on a copy, so the normal load path (`owner.params.no_extra_bufts` from the
app policy, `LlamaService.ts:2396`) is untouched; the binding source pin's second assertion locks
`exactly one .no_extra_bufts = assignment in rn-llama.cpp`.

## 3. Comments as claims — one supported, one inference

- "decode pays the ~1.4x CPU decode cost the S23 repack A/B measured" — **supported**:
  `s23-repack-timing/REPORT.md:184` "**Decode**: repack ON is **1.41× faster** (9.88 → 13.9 tok/s)"
  and `:147` `LFM-R … decode=13.99 t/s` vs `:142` `LFM-N … decode= 9.88 t/s`. The measurement is
  the CPU-only path, not inside the lane — the direction is right, the magnitude in-lane is unmeasured.
- "GPU prefill covers the 2.6x" — the 2.6× is the CPU-only repack prefill gain
  (`REPORT.md:23` "costs 2.6× prefill and 1.4× decode"); in the lane prefill is on the GPU, so the
  CPU prefill benefit is irrelevant rather than "covered". This is an inference stated as fact;
  the coder's own account admits it ("RECON's inference from a CPU-only A/B"). PLAUSIBLE as a claim,
  not measured.

## 4. Tests

- **Binding test is a source pin, and says so.** Header: "Source pin: … The behaviour (one copy
  instead of two on a device) is decided by a phone measurement, not by this pin." It asserts the
  decode flag inside the lane window, the absence of `prefill_params.no_extra_bufts`, and exactly one
  assignment in the file. It cannot verify the field exists or that a load allocates no repack; the
  C++ semantic test is impossible in the fast harness (declared). Targeted run: 2/2, exit 0.
- **App test is behaviour.** It calls `buildGovernorParams` with the real registry model
  (`sizeBytes: 1_593_894_944`, `kvBytesPerToken: 6656`) and asserts `2999 MiB → Fit`,
  `2997 MiB → NoFit`. Required `2998.06 MiB` recomputed independently:
  `REPACK_FRACTION = (1333−249)/1211 = 0.89513`, `0.89513×1520.06 = 1360.64`;
  `nonEvictable(no repack) = 249+52 = 301`; `gpuReserve = 800 + 1.05×1520.06 = 2396.06`;
  `required = 301+2396.06+249+52 = 2998.06`. With the repack term back it is `4358.70`, so the 2999
  assertion flips → **the test goes red if the term returns** (the coder's `repack: true` sabotage
  confirms: 1 failed). It pins the requirement only within `(2997, 2999]`, a ±1 MiB slack — fine for
  a gate whose constants are ±10s of MiB. Targeted run: 12/12, exit 0; app tsc 0.

## 5. Clean-code checklist

| item | verdict | evidence |
|---|---|---|
| no God file | PASS | `governorInputs.ts` 218 lines, test 322 (pre-existing two topics, declared); binding test 29 lines; `rn-llama.cpp` 1301 lines pre-existing, +9. |
| minimal imports | PASS | binding test adds only `fs`/`path`; app test adds none; the app change removes a field. |
| no types nobody constructs | PASS | `MemorySnapshot.repack` deleted (`:52` old) with its only producer (`LlamaService.ts` old `:2322`); `estimateMemory`'s `repack` input is still constructed at `LlamaService.ts:2289` for the shared tuning path, so not dead. |
| WHY-only comments, true invariants | PARTIAL | WHY-oriented, but the "covers the 2.6x" clause is an inference (F6) and the app comment omits the binding-version condition (F4). |
| commit message names repo/branch/HEAD | PASS | binding `repo: llama.rn-kalsa` / `branch: kalsarn-governor-engine` / `HEAD before this commit: e437b1af…`; app `repo: kalsa (kalsa-wt-bench-apk worktree)` / `branch: detached, no branch` / `HEAD before this commit: ca2dcc0b…`. Binding uses conventional format (repo commitlint). |
| no push | PASS | binding 1 ahead of `origin/kalsarn-governor-engine`, app 1 ahead of `origin/main`; `git tag --points-at HEAD` = 0 in both. |

## Findings

| # | verdict | sev | finding |
|---|---|---|---|
| F1 | CONFIRMED | — | The decode model loads with `use_extra_bufts=false` through `common_model_params_to_llama` → `llama_model_load_from_file` → `make_cpu_buft_list`; no CPU_REPACK copy. Prefill is untouched and the measured log shows none for it (q6_K token_embd). |
| F2 | CONFIRMED | — | Removing repack cannot break loading: the entry is an optimisation and the plain CPU buft is the per-tensor fallback (log shows 100 tensors already using it on decode). |
| F3 | CONFIRMED | **HIGH (process)** | `governorInputs.ts:100 repack: false` is unconditional while the app still installs binding `e437b1af`, which lacks the fix; nothing checks the engine version. The gate can under-price by 1360.64 MiB and admit a load that then allocates the +1511.20 MiB repack. The pin chain does not prevent it; the measurement must use `ef901304` and the pin bump must land with the binding push. |
| F4 | CONFIRMED | LOW | The binding test is source-text only (declared); it cannot catch a missing C++ field or a real allocation. Native compile/device load remain CI/phone work. |
| F5 | CONFIRMED | LOW | "GPU prefill covers the 2.6x" is an inference, not a measurement; the ~1.4× decode cost is measured but only CPU-only (`s23-repack-timing/REPORT.md:184`). |
| F6 | PLAUSIBLE | LOW | The app asserts a lane-wide no-repack invariant while the binding forces only the decode model; prefill's absence of repack is empirical for LFM2.5 (q6_K residual) and re-checkable only per model/quant. |
| F7 | CONFIRMED | LOW | `LlamaService.ts:2289 repack: !load.noExtraBufts` still prices repack for the governor load's ctx tuning (declared, conservative direction). |

**Verdict: SHIP-AFTER-MEASUREMENT**, with two hard conditions before any merge: (1) the phone
measurement must run the app against binding `ef901304` (not the pinned `e437b1af`) — otherwise the
result is invalid in the unsafe direction; (2) if it passes, the binding push + app pin bump land
together (binding first) and the app comment names the binding requirement. The trace and the tests
are otherwise sound; F4–F7 are recorded follow-ups only.
