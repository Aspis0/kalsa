# k4split — residency kernel (parent wiring)

Date: 2026-08-13
Scope: parent engine only. No ggml-opencl / FLASH_ATTN / GEMV kernel edits. No
`build-android.ps1` OpenCL default flip. No PLAN.md. No device work.

`N0_DESIGN_NOTES.md` and `audit_design.md` were not in the tree. Implementation
follows `results/k4split/recon_*.md` plus the mandate minimum wiring.

## Files touched

| path | what |
|---|---|
| `BigMoeOnEdge/core/include/bmoe/config.h` | `DenseWeightsMode::AnonGpu`, `MoeCpuExperts`, `n_gpu_layers` / `flash_attn` / `override_tensor` on `RunConfig` |
| `BigMoeOnEdge/core/include/bmoe/session.h` | same fields on `SessionConfig` |
| `BigMoeOnEdge/core/include/bmoe/metrics.h` | `RunInfo` placement keys |
| `BigMoeOnEdge/core/src/config.cpp` | reject empty `--override-tensor` entries |
| `BigMoeOnEdge/core/src/engine/runtime.cpp` | `session_config_from` copies the new fields |
| `BigMoeOnEdge/core/src/engine/session.cpp` | `n_gpu_layers` from config; B/Auto `tensor_buft_overrides`; FA off unless asked; RAM guard; placement log |
| `BigMoeOnEdge/core/src/moe/dense_weights.{h,cpp}` | skip non-host tensors; still `drop_mmap_copies`; AnonGpu |
| `BigMoeOnEdge/core/src/moe/expert_stream_source.cpp` | cache-auto deducts host-pending dense only |
| `BigMoeOnEdge/core/src/metrics/csv_metrics_sink.cpp` | preamble `n_gpu_layers` / `flash_attn` / `moe_cpu_experts` |
| `BigMoeOnEdge/cli/main.cpp` | `--ngl`, `--flash-attn`, `--moe-cpu-experts`, `--override-tensor`, `anon-gpu` |
| `BigMoeOnEdge/tests/config_test.cpp` | placement defaults + AnonGpu / override validation |
| `BigMoeOnEdge/docs/architecture.md` | open() no longer "experts on CPU" as a hard load fact |
| `BigMoeOnEdge/docs/telemetry.md` | new CSV keys |
| `BigMoeOnEdge/CHANGELOG.md` | `[Unreleased]` |

Not touched: `ggml-opencl` kernels, `FLASH_ATTN` sources, `kernel_gemv_*`,
`scripts/build-android.ps1`, llama.cpp fork (no `kalsa/split-trunk-gpu` branch
needed — parent wiring is enough for Mechanism B).

## Flags

```
--ngl / --n-gpu-layers / --gpu-layers / -ngl N
--flash-attn / --fa off|on          # default off
--moe-cpu-experts off|on|auto       # Auto only if --moe-stream and flag omitted
--override-tensor / -ot PAT[=BT]    # repeatable; bare regex = CPU
--dense-weights mmap|warm|anon|ahwb|anon-gpu
```

Existing campaign flags unchanged. Default `--ngl 0` keeps today's CPU path.

Campaign split arm (once an OpenCL `bmoe-cli` exists):

```
-ngl 99 --flash-attn off --moe-cpu-experts auto --dense-weights anon-gpu
```

plus the k6d065 streamer knobs. `--cache-mb 1000` still needs `--force-cache`.

## How Off / On / Auto differ (`MoeCpuExperts`)

| mode | `tensor_buft_overrides` for `LLM_FFN_EXPS_REGEX` | when |
|---|---|---|
| **Off** | none | Mechanism A only: OpenCL `supports_op` is false for Q2_K/Q3_K `MUL_MAT_ID`, so KEXP experts stay on CPU. A future Q4_K expert file or a `supports_op` relaxation can steal them and kill the hook. |
| **On** | always (Mechanism B) | even at `--ngl 0` (redundant; everything is already CPU) |
| **Auto** | when `n_gpu_layers != 0` | product default under `--moe-stream`. Pins routed `ffn_*_exps` (not `*_shexp`, not `ffn_gate_inp`) so the trunk + shared expert + router can live on GPU while `mul_mat_id` stays on CPU. |

`--override-tensor` is extra, applied after the Auto/On pin. Use it for
debug (`token_embd.weight=CPU`) without changing the expert policy.

## `anon-gpu`

After a successful GPU offload, dense tensors whose `tensor->buffer` is not
host are **not** given an anon twin and are **not** rebound. Their leftover
mmap pages (llama.cpp keeps the expert-window mapping) are still
`MADV_DONTNEED`. Host-remaining dense (`token_embd`, any `-ot …=CPU`) still
gets the Anonymous fill.

`--ngl 0`: no GPU buffers exist, so AnonGpu is Anonymous and logs that.

`anon` / `ahwb` also skip non-host tensors (safety: never rebind a GPU
tensor). `anon-gpu` is the self-documenting campaign name.

## RAM guard

On `n_gpu_layers != 0`:

1. Fail if `llama_supports_gpu_offload()` is false (do not pretend the split loaded).
2. Estimate steady-state DRAM from GGUF sizes: GPU dense + host-remaining
   dense (if anon-like) + leftover mmap (mmap/warm only) + cache + scaled
   KV/RS/compute + **300 MiB slack**.
3. Refuse `open()` if `MemAvailable` is known and below that. No silent
   `--ngl 0` fallback (that would lie about an A/B).

Unknown `MemAvailable` (0) logs and proceeds.

## Audit fix (2026-08-13, `audit_impl.md` was missing)

Re-read e926a54 + the live tree. The listed residency holes:

| item | verdict | fix |
|---|---|---|
| dangling `tensor_buft_overrides` | **CONFIRMED** | Pattern strings lived in a function-local `vector<string>`; `.c_str()` was handed to llama.cpp, which walks them with `std::regex` during load. Moved to `Session::Impl` as `std::list<std::string>` (same stable-pointer rule as llama.cpp `parse_tensor_buffer_overrides`). |
| `n_gpu_layers` still hardcoded | already `= cfg.n_gpu_layers` | Comment only: llama default is `-1` (all layers); we must never leave it. |
| default `ngl != 0` | already `0` on `RunConfig` / `SessionConfig` / CLI | no code change |
| flash-attn on | already off (`DISABLED` unless `--flash-attn on`) | no code change |
| anon-gpu freeing experts | **CONFIRMED** hole | Capture-miss / name-mismatch could put `ffn_*_exps` in the dense list. AnonGpu would then rebind them or `MADV_DONTNEED` their live mmap. Dense list now skips `is_routed_expert_name`; `DenseWeights` refuses to copy or drop those names; `drop_mmap_copies` also refuses a range whose `tensor->data` still points into it. Cache-auto does not deduct leaked expert bytes. |

Compile after the fix (existing `moe-experiments/build-pc`, `-j4` after `vcvars64`): `session.cpp`, `dense_weights.cpp`, `expert_stream_source.cpp` rebuilt; `bmoe_config_test` all passed, including `placement defaults are ngl=0 / fa=off / experts=off`. BigMoeOnEdge commit `342df14`. No fork branch, no push, no device work.

## Compile check (PC, 2026-08-13)

Existing `build-pc` (BigMoeOnEdge host, MSVC). `-j4` after `vcvars64`.

- `session.cpp`, `dense_weights.cpp`, `expert_stream_source.cpp`, `cli/main.cpp`,
  `config_test.cpp` compiled.
- `bmoe_config_test`: **all checks passed**, including the new placement cases.
- `cli/bmoe-cli.exe` was locked by pid 8780 (not killed). Objects linked to
  `build-pc/cli/bmoe-cli-k4split.exe`; `--help` lists `--ngl`, `--flash-attn`,
  `--moe-cpu-experts`, `--override-tensor`, `anon-gpu`.

## What still is not this milestone

- OpenCL-on Android `bmoe-cli` (campaign scripts stay `GGML_OPENCL=OFF`).
- N1 device load / MemFree curve.
- Correctness A/B and speed arms.
