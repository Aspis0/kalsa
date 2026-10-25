# P1-CODE — governor lane without the CPU repack copy (local commits, not shipped)

Phone measurement decides shipping; these are the two local commits.

## Commits (no push, no tag, no new branch)

| repo | ref | sha | message |
|---|---|---|---|
| `llama.rn-kalsa` | branch `kalsarn-governor-engine`, from HEAD `e437b1af3de7af563526f5777dbf25d86f9b3215` | **`ef90130431077e4adfef2e9cc6be14ff3b8f0f44`** | `fix(governor): drop the decode model's CPU repack copy in the lane` (body names repo/branch/HEAD; repo commitlint requires conventional format) |
| app `kalsa` | detached, from HEAD `ca2dcc0b4907ce443148c9d772098775b3b6dbf5` | **`1228836fcb84e38a1cdd9f1ac1111461ae887264`** | `governor : price the lane without the CPU repack copy (kalsa @ detached ca2dcc0b4)` (body names repo/branch(=detached)/HEAD) |

`git branch --show-current` printed before each commit: `kalsarn-governor-engine` / `` (empty=detached).

## 1. Binding — the change and the trace (which params make the anon copy)

- `cpp/rn-llama.cpp:74-83` (new): after `decode_params.n_gpu_layers = 0`, added
  `decode_params.no_extra_bufts = true;` (+8-line why-comment). Commit `ef9013043`, +9 lines.
- **Trace answer: the anon copy comes from the DECODE params, and only there.**
  `no_extra_bufts` → `use_extra_bufts = !no_extra_bufts` (`vendor/llama.cpp/common/common.cpp:1710`)
  → `make_cpu_buft_list` adds the CPU extra bufts only when `use_extra_bufts`
  (`src/llama-model.cpp:1063,1095,1477`) → the extra buft is the repack buffer. The decode model
  (`n_gpu_layers=0`) places all repackable tensors on CPU → its `CPU_REPACK ≈ 1511 MiB` beside the
  prefill model's `OpenCL model buffer = 1512 MiB` (RECON §2.3 measured log). The prefill model
  (`n_gpu_layers=99`) puts its tensors on OpenCL and its CPU residuals (205 MiB `CPU_Mapped`) carry
  no repack traits — the same log shows **no `CPU_REPACK` line for prefill**. So prefill is left
  untouched; the non-governor path is untouched (assignment count in the file = 1, pinned).
  Fork precedent for the same flag: `cpp/bmoe_stream.cpp:196`.
- **Test:** new `src/__tests__/governorLaneRepack.test.ts` (binding jest harness, source pin:
  decode forced, prefill never, exactly one `.no_extra_bufts =` assignment in rn-llama.cpp).
  Targeted `npx jest src/__tests__/governorLaneRepack.test.ts` → EXIT 0 (2/2); sabotage (delete the
  line) → EXIT 1 (2 failed), restored (`cmp` OK). Full `npm test` → EXIT 0 (13 suites/45 tests);
  `npm run typecheck` → EXIT 0. Pre-commit hooks (eslint, types, commitlint) passed on the
  successful commit; the first attempt was rejected by `unicorn/better-regex` (`[\s\S]`→`[\S\s]`,
  fixed) and the second by commitlint (reworded to conventional + repo/branch/HEAD body).

## 2. App — the fit estimate stops counting the term the binding makes false

- `src/engine/governorInputs.ts:92-103` gpuFit: `repack: memory.repack` → **`repack: false`** with
  a 3-line why-comment (lane decode loads `no_extra_bufts=true`, so no repack copy exists in this
  lane; pricing one demanded ~W the lane never allocates). The `MemorySnapshot.repack` field
  (`:52`) and its only input `repack: !load.noExtraBufts` (`LlamaService.ts:2322`, inside the
  `buildGovernorParams` snapshot) deleted — dead once unread. **`gpuReserve` untouched**
  (verified: no +/- line touches `800 +` / `1.05`); recalibration stays with the phone run.
  `LlamaService.ts:2289` (`resolveEngineTuning` request) **kept** — ctx sizing is shared with the
  CPU path where repack still exists (see unverified list).
- **Test:** extended `src/engine/governorInputs.test.ts` in its existing gpu_fit topic (file was
  already two topics: lane-fit + thermo — pre-existing, declared, not refactored): new case
  `"the lane fits at its repack-free requirement, not the repack-priced one"` — S23 profile
  (SM8550→V73), LFM2.5 2.6B, ctx 8192, knife-edge `2999 MiB → Fit` / `2997 MiB → NoFit`. The
  estimate's default-`repack=true` means any re-wiring of the term flips Fit→NoFit → red.
- Targeted `npx jest src/engine/governorInputs.test.ts --runInBand` → EXIT 0 (12/12); sabotage
  (`repack: false` → `true`) → EXIT 1 (`1 failed, 11 passed`, the new test), restored (`cmp` OK).
  Final `npx tsc --noEmit` → EXIT 0 (0-byte log). Full `npx jest --maxWorkers=3` → EXIT 0
  (**115 suites / 1437 tests**). `git status --porcelain | wc -l` after commit → 0.

## New required-MiB figure (app, LFM2.5 2.6B, S23, ctx 8192)

`gpuReserve 800 + 1.05×1520.06 = 2396.06` + 2×compute 249 + 2×KV 52 (repack term removed, both
constants kept) = **2998.06 MiB (2.93 GiB)** — was 4358.70 MiB with the repack term. Pinned by the
2999/2997 knife-edge test; independently recomputed by script (`requiredMiB=2998.06`). Matches
RECON §1.3's `norepack=1` row exactly, because the removed term is the same one that key zeroed.

## Commands with exit codes (all `> /tmp/…log 2>&1; echo "EXIT=$?"` form)

| command | exit |
|---|---|
| binding `npx jest src/__tests__/governorLaneRepack.test.ts` (first run, window bug) | 1 |
| same after window fix | 0 (2/2) |
| binding sabotage (line removed) | 1 (2 failed) — restored, `cmp` OK |
| binding `npm test` (after final lint edit) | 0 (13/45) |
| binding `npm run typecheck` | 0 |
| binding commit attempt 1 (lint: `unicorn/better-regex`) | 1 |
| binding commit attempt 2 (commitlint) | 1 |
| binding commit attempt 3 | **0** → `ef9013043` |
| app `npx tsc --noEmit` (run 1 + final) | 0, 0 |
| app `npx jest src/engine/governorInputs.test.ts --runInBand` | 0 (12/12) |
| app sabotage (`repack: true`) | 1 (`1 failed, 11 passed`) — restored, `cmp` OK |
| app `npx jest --maxWorkers=3` (full, once at end) | **0** (115/1437) |
| app commit | **0** → `1228836f` |
| app `git status --porcelain \| wc -l` after commit | 0 |

## Could not verify / declared

- **Device behaviour (the whole point of P1):** no phone run — the engine log must show NO
  `CPU_REPACK` line for the governor decode model and a ~1511 MiB smaller anon footprint, and the
  S23 must survive the load at ≥2998.06 MiB available. Untested until measured; not shipped.
- **Binding C++ semantic test:** the harness's fast target (`governor_params_test`) links only
  `rn-governor-params.cpp`; `load_governor_models` needs a model + full-library link, so the pin is
  a jest source pin, not a C++ behaviour test.
- **Decode-throughput cost** (~1.4× CPU decode without repack, from `s23-repack-timing`) unmeasured
  inside the lane; "GPU prefill covers the 2.6×" is RECON's inference from a CPU-only A/B.
- **`resolveEngineTuning` repack price (LlamaService.ts:2289) kept**: ctx sizing is shared with the
  non-governor CPU path (repack still real there); for governor loads it can only over-clamp ctx
  (conservative direction). Follow-up if the phone run shows ctx smaller than expected.
- Binding worktree keeps two **pre-existing untracked** files (`pnpm-lock.yaml`,
  `pnpm-workspace.yaml`) — not mine, untouched, so that tree is otherwise clean.
- The lane on `Unknown` generations still refuses before memory arithmetic (unchanged, out of scope).
