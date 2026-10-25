# AUDIT-P1-glm — second, hostile review of P1 (governor lane without CPU repack)

Read-only. Reviewed: binding `ef9013043` (parent `e437b1af`) and app `1228836f`
(parent `ca2dcc0b`) against the vendored engine at pin `319b5393` (verified:
`git diff --stat 1577495b9 319b5393` = only `ggml-opencl.cpp` +26 and the q4_K `.cl`,
so every CPU-side line below is byte-identical at both pins). Raw evidence re-read
directly, not through RECON's quoting. Paths: `V/` = `~/Projects/llama.rn-kalsa/vendor/llama.cpp`,
`QDC/` = `raw/sa803609/8-Elite_B_t1_load.txt` under `scratchpad/agents/qdc-governor-s5/`.

## F1. Engine trace: `no_extra_bufts` removes exactly the CPU repack buft (on Android) — CONFIRMED

- `V/common/common.cpp:1710` `mparams.use_extra_bufts = !params.no_extra_bufts;` — the only
  copy from `common_params` into model params (`common.h:585` declares the field).
- `V/src/llama-model.cpp:1477` `cpu_buft_list = make_cpu_buft_list(devices, params.use_extra_bufts, ...)`;
  extra bufts appended only `if (use_extra_bufts)` (`:1095`); nothing else in model load
  reads the flag (`grep no_extra_bufts|use_extra_bufts` over `V/common V/src V/tools` →
  `common.cpp:1710`, `arg.cpp:2421-2423`, `llama-model.cpp:1063,1095,1477,2866`, and
  `llama.cpp:455` which is the unrelated `llama_model_init_from_user` API, never our path).
- The CPU registry's extra bufts are AMX (x86-only), RISCV spacemit, KleidiAI, repack
  (`V/ggml/src/ggml-cpu/ggml-cpu.cpp:42-72`). KleidiAI is `option(... OFF)`
  (`V/ggml/CMakeLists.txt:153`) and the binding enables none of them (no hit in
  `cpp/ android/ ios/`) → on Android the flag removes **only** `CPU_REPACK`.
- KV/compute buffers are scheduler-allocated per context, not via this list: the decode
  ctx's `CPU KV 104.00` / `CPU compute 129.00` lines (QDC `:2756,:2808`) are unaffected.

## F2. Decode kernels and numerics CAN change — CONFIRMED (code), PLAUSIBLE (effect), unmeasured

Without the repack buft, every decode-model MUL_MAT falls to the default CPU buft
(`select_weight_buft` first-match, `V/src/llama-model-loader.cpp:1060-1070`; list order:
extra bufts then CPU, `llama-model.cpp:1095-1119`) and runs the generic CPU vec_dot
path instead of the repack traits kernels (`q4_0_4x8_q8_0`/`q4_0_4x4_q8_0` on this
class of aarch64, `V/ggml/src/ggml-cpu/repack.cpp:5101-5127`; repack intercepts only
MUL_MAT/MUL_MAT_ID, `repack.cpp:5407-5416`). Different kernels, different accumulation
grouping → bitwise-different logits are expected in principle. **No on-disk measurement
of the output difference exists**: `s23-repack-timing` recorded t/s, Rss, faults, turn
completions only (`REPORT.md:112-118, 142-149` — no quality column). Neither the binding
comment nor P1-CODE claims unchanged numerics, but neither declares the change either.

## F3. Prefill CPU residuals: no repack, no underestimate for this model/pin — CONFIRMED; the coder's stated reason is REFUTED as worded; a latent model-dependent gap remains PLAUSIBLE

- `V/src/llama-model.cpp:1539-1541`: the input layer is **always** CPU ("there is very
  little benefit to offloading the input layer, so always keep it on the CPU") — that is
  the prefill model's 205.08 MiB `CPU_Mapped` (QDC `:1492`). Its `token_embd.weight` is
  **q6_K**, and the loader PREFERS repack for it and is refused:
  QDC `:1324` `tensor 'token_embd.weight' (q6_K) (and 0 others) cannot be used with
  preferred buffer type CPU_REPACK, using CPU instead`. Refusal mechanism: token_embd's
  op is GET_ROWS (`V/src/llama-arch.cpp:721`), and repack's `supports_op` handles only
  MUL_MAT/MUL_MAT_ID (`repack.cpp:5412-5414`).
- **P1-CODE.md:24-25 / the binding comment ("its CPU residuals carry no repack traits")
  is wrong as stated**: q6_K DOES have repack traits (`q6_K_8x8_q8_K`/`q6_K_8x4`,
  `repack.cpp:5195+`); the residuals dodge repack because of their **op**, not their
  type. The conclusion (no prefill `CPU_REPACK` line) is CONFIRMED: grep of QDC log →
  3 `CPU_REPACK` mentions, the only buffer line being the decode model's 1511.20
  (`:2321`). Fix the comment when next touched.
- The output head is LAYER_OUTPUT + MUL_MAT (`llama-arch.cpp:726`) and q6_K is
  repackable — it escapes only because at `n_gpu_layers=99` it takes the GPU list first
  (`dev_output = get_layer_buft_list(n_layer_all)`, `llama-model.cpp:1547-1548`;
  `i_gpu_start=0`, `:1528-1530`; GPU list = device bufts **followed by the full CPU list
  incl. repack**, `:1478-1482`). If a future model/pin makes OpenCL refuse the output
  mul_mat, that tensor falls back into `CPU_REPACK` and **2998.06 underprices by the
  head's size**. Latent, not current.

## F4. Memory arithmetic — CONFIRMED 2998.06; conservative vs the engine log; three things deliberately or dangerously unpriced

Re-derived from the app at `1228836f`: `memoryEstimate` with `mmap:true, repack:false`
sets `repackMiB=0, anonWeightsMiB=0` (`memoryEstimate.ts:159-163` @1228836f) →
`nonEvictable = compute 249 + kv 52.00 = 301`; `gpuReserve = 800 + 1.05×1520.057 =
2396.06` (`governorInputs.ts:108-109`); `required = 301 + 2396.06 + 249 + 52 =
**2998.06 MiB**` (`governorInputs.ts:111-115`). Reproduces exactly; knife-edge test
2999/2997 is consistent. No leftover consumer of the deleted snapshot field
(`git grep repack 1228836f -- src/engine/` → comments, the tuning estimate, registry only).

Cross-check vs QDC log (KV halved to ctx 8192): with repack gone, device+anon ≈
1512.28 (OpenCL, `:1493`) + 129 + 12.04 + 0.34 (prefill ctx) + 52 + 52 (KV) + 129
(decode compute) + ~1 (outputs) = **1888 MiB**, + driver prealloc ~377-754
(`q44-ngl-sweep-mem/REPORT.md:49,94`) = 2265-2642 vs gate 2998.06 → headroom 356-733
MiB. Nothing double-counted: the reserve prices the OpenCL copy once (1512.28 ≈
0.995×W), compute 498 priced vs 270 actual, both contexts' KV priced.

Unpriced / by-design exclusions, in rising order of concern:
1. **mlock**: the app requests `use_mlock: true` (`LlamaService.ts:2392` @1228836f) and
   the lane logs `failed to mlock 223281152-byte buffer ... Out of memory` (QDC `:1494`)
   — on both the 11 and 15 GiB boards, i.e. RLIMIT, not pressure. Benign today; on any
   device where it succeeds, ~213 MiB of unevictable pages appear that no term prices.
2. **Decode weights become a ~1.5 GiB page-cache working set** (with repack off they are
   read from the mmap every token). Excluded as evictable by design; the cost is major
   faults under pressure — the A/B's repack-OFF arm already showed 289-566 faults/turn
   at ~3.5 GiB available (`s23-repack-timing/REPORT.md:116-117`). Watch, don't price.
3. **The load transient** (OpenCL temp upload staging, `ggml_cl_create_temp_upload_buffer`;
   q44 saw a created-sum of 13,432 MiB in transient staging at ngl 99,
   `q44/REPORT.md:47,54`) is covered by no term and was never measured for the lane
   (RECON §4.3). This, not steady state, is the likeliest lmkd kill point on an 8 GB
   phone that just passed a 2998.06 gate by 1 MiB.

## F5. The "~1.4x decode cost … measured" comment — CONFIRMED backed, with two caveats

`s23-repack-timing/REPORT.md:112-113`: decode 9.88 [7.09-10.3] t/s (repack OFF) vs
13.9 [13.4-14.0] (ON) = 1.41× median-to-median; the report itself blesses "1.4× decode"
(`:23`). Same device (S23), app-level telemetry, repack-OFF arm config = the lane's
decode config. Caveats: (a) median-to-median over a wide OFF spread [7.09-10.3]; (b) the
two arms loaded **different GGUFs** — 1,585,659,904 vs 1,576,226,816 bytes (`:123`),
neither the registry's 1,593,894,944 — a 0.6% confound, immaterial but undeclared; (c)
the in-lane cost (OpenCL pool resident beside it) is unmeasured — P1-CODE declares this.

## F6. Scope: the lane drops repack on EVERY device, with no switch — CONFIRMED, declared only implicitly

`decode_params.no_extra_bufts = true` is unconditional in `load_governor_models`
(`ef901304` diff, `cpp/rn-llama.cpp:80-88` region). Every 12/16 GB board that previously
ran the repack-on lane (all `qdc-governor-s5` measurements) now pays ~1.4× CPU decode;
the app's `loadPolicy.repack` and `kalsa.bench.norepack` cannot restore it in the lane
(they still drive prefill via `owner.params` and the non-governor path,
`LlamaService.ts:2396` @1228836f). RECON P1 suggested "or make it a policy input"; the
coder chose unconditional. Product decision silently baked in — say it out loud.

## F7. Tests — CONFIRMED as declared, with the declared weakness

The binding pin is source-text regex, not behaviour (`governorLaneRepack.test.ts`: decode
forced, prefill never, exactly one `.no_extra_bufts =` assignment); the engine side is
code-read here (F1) but **no C++ compile or run happened after the commit** — the field
provably exists at the vendored pin (`V/common/common.h:585`), so compilation will not
break silently. App side: typecheck + 1437 tests pass per P1-CODE; the estimate default
(`repack = input?.repack !== false`, `memoryEstimate.ts:149` @1228836f) means any
re-wiring flips the knife-edge test — the pin has teeth.

## Verdict: SHIP-AFTER-MEASUREMENT

The code is what it claims to be, the trace holds end to end, the arithmetic reproduces
and is conservative against the engine's own log, and the 1.4× is backed on disk.
Nothing is FIX-FIRST in code; two texts need correcting when next touched (F3's
"no repack traits" reason; F6's missing "applies everywhere" declaration). The phone
measurement that gates shipping must capture, at minimum:
1. engine log: NO `CPU_REPACK` line for the decode model, `RssAnon` ~1.5 GiB lower;
2. load survives at `availableMb` near 2998 — with the load transient and any lmkd
   engagement recorded (F4.3), not just steady state;
3. in-lane decode t/s (the 1.4× is an out-of-lane transfer);
4. one quality sentinel for the kernel-path change (F2) — e.g. KLD or fixed-prompt
   parity vs the repack-on lane — since no measurement of it exists anywhere.
