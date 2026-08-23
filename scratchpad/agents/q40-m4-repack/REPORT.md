# Q40 M4 — Q2_K_8x4 / Q3_K_8x4 3-D MUL_MAT_ID

Status: M3 audit test-only fix applied. M4 done. Host PASS (generic kernels). Jelly Star PASS (NEON+dotprod graph dispatch). Branch pushed. M5 not started.

Fork worktree: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\worktree-repack-q23k`
Branch: `kalsa/repack-q23k` at `0b9658364` (base `1882bf8cd`)
Remote: `origin` = `https://github.com/Aspis0/kalsallama.git`

M0: `scratchpad/agents/q40-m0-repack/REPORT.md`
M1: `scratchpad/agents/q40-m1-repack/REPORT.md`
M2: `scratchpad/agents/q40-m2-repack/REPORT.md`
M3: `scratchpad/agents/q40-m3-repack/REPORT.md`

## M3 audit fix (test-only)

`test_native_fallthrough_aborts` now calls `ggml_backend_cpu_set_n_threads(backend, 1)` before compute. The callback+longjmp interception is cross-thread UB at nth>1 (m3 `m2.out` had 3 straggler abort prints). Production extra-compute abort is unchanged.

Because 3-D F32 `MUL_MAT_ID` is now legal, the declined case is **F16 RHS** `MUL_MAT_ID`. Jelly after the pin: **one** abort line, no stragglers, `RC=0`.

```
== declined op on q23k extra must abort (not native garbage) ==
  ok helper: nullptr extra is not q23k
  ok abort on declined F16-RHS MUL_MAT_ID: .../traits.cpp:26: q23k_8x4 extra declined op=MUL_MAT_ID; refusing native fallthrough on tiled layout

RESULT: PASS
RC=0
```

## M4 what landed

3-D policy from the decisions table:

- Kernels stay 2-D GEMV.
- `expert_ptr = base + expert_id * src0->nb[2]` (packed slice stride set at init, never native `8 * row_bytes`; Q3 912 vs 880).
- v1: each selected id in stable `(token, slot)` order; one GEMV per selected RHS row. No expert regrouping, no GEMM batching of coincidental same-expert rows.
- q8_K quantized **once** per RHS row (`from_float` over `n_used_b * n_tokens`), reused for every expert that indexes that row, including broadcast `n_used_b=1`, `n_used>1` (`slot = e % n_used_b`).

`supports_op` for q23k `MUL_MAT_ID`: 3-D (`ggml_n_dims==3`, `ne[3]==1`), F32 host-dense RHS, I32 ids. F16 / 4-D / non-host stay false and the extra fence still aborts if compute is forced.

## Files

| File | Change |
|---|---|
| `ggml/src/ggml-cpu/repack.cpp` | `forward_mul_mat_id_q23k`, `work_size` for MUL_MAT_ID, `compute_forward` 3-D path, `supports_op` accept. |
| `tests/test-repack-q23k-m2.cpp` | n_threads=1 + F16 fence. |
| `tests/test-repack-q23k-m4.cpp` | ID grid, broadcast, graph, threads, supports_op negatives. |
| `tests/CMakeLists.txt` | Registers M4. |

## Commits

```
d34ae8c82 ggml: Q2_K/Q3_K 8x4 3-D MUL_MAT_ID via packed nb[2]
0b9658364 tests: M4 MUL_MAT_ID harness and n_threads=1 fence
```

Pushed `0992b7a2d..0b9658364` to `origin/kalsa/repack-q23k`.

## Build

Host: `moe-experiments/build-repack-q23k-pc`

Android (same recipe as M2/M3):

| | |
|---|---|
| NDK | 27.1.12297006, arm64-v8a, android-29 |
| `GGML_CPU_ARM_ARCH` | `armv8.2-a+dotprod+fp16` (i8mm **off**) |
| m2 sha256 | `E342ED5F1F5D8D0EAA350F7AE4495C510F6D1879D6F4EDA0E9059B61FD6DDAD8` (8821528) |
| m4 sha256 | `122E655094EE38429210D743C0B9C007286D1839C2AE99027E7E172A14FE1C18` (8859152) |

Device `sha256sum` matched both. Dir `/data/local/tmp/kalsarepack`, `LD_LIBRARY_PATH=.`, `KEYCODE_WAKEUP`. S23/Xiaomi not touched.

## Host

M2 `RESULT: PASS` (fence skip, no neon).
M4 `RESULT: PASS` — 72/72 kernel ID cases (2 types × experts {2,3,5} × tokens {1,2,7,16} × {random,repeated,unused}) plus broadcast Q2/Q3. Graph skip.

## Raw Jelly M4

Full: `results/repack_q23k/m4_jelly/m4.out`. `repack: repack tensor with q*_K_8x4` on stderr mixed via `2>&1`. Graph path asserts `w->nb[2] == packed_stride`.

```
M4 MUL_MAT_ID starting
M4 host neon=1 dotprod=1
== MUL_MAT_ID kernel vs expert-by-expert 2-D oracle ==
  ... 72/72 ok pattern q2_K/q3_K nas={2,3,5} tok={1,2,7,16} used=2 {random,repeated,unused} ...
== activation reuse (n_used_b=1, n_used=2) ==
  ok bcast q2_K 512x16 nas=5 tok=7 used=2 used_b=1
  ok bcast q3_K 512x16 nas=5 tok=7 used=2 used_b=1
== ggml graph MUL_MAT_ID (neon+dotprod) ==
  ... 72/72 ok graph q2_K/q3_K nas={2,3,5} tok={1,2,7,16} {random,repeated,unused} ...
== graph broadcast n_used_b=1 ==
  ok graph-bcast q2_K
  ok graph-bcast q3_K
== thread identity MUL_MAT_ID ==
  ok q2_K threads 1/2/4/8 bit-identical
  ok q3_K threads 1/2/4/8 bit-identical
== supports_op negatives ==
  ok supports_op false for F16 RHS
  ok supports_op true for F32 3-D MUL_MAT_ID

RESULT: PASS
RC=0
```

## Pass-criteria table

| Criterion | Result | Notes |
|---|---|---|
| Fence n_threads=1 | PASS | Single abort line on Jelly. |
| Fence still-declined case | PASS | F16-RHS MUL_MAT_ID. F32 3-D is now accepted. |
| Experts 2/3/5, tokens 1/2/7/16 | PASS | Kernel + graph. |
| ids random / repeated / unused | PASS | Unused = all ids 0, other experts never read. |
| Per-expert patterned weights vs 2-D oracle | PASS | M1 encoder (expert id in `d`/q/scale). |
| No cross-expert interleave | PASS | Slice `base + id * nb[2]`; Q3 stride 912 not 880. Graph asserts `nb[2]`. |
| q8_K once per RHS row, reuse | PASS | Broadcast `n_used_b=1` kernel + graph. |
| `supports_op` false for remaining negatives | PASS | F16 RHS false; F32 3-D true on neon. |
| Threads 1/2/4/8 both types | PASS | Graph MUL_MAT_ID 256×16, 3 experts, 7 tokens. |
| Android sha both sides | PASS | `results/repack_q23k/m4_jelly/`. |

v1 does **not** regroup tokens that share an expert into a GEMM. Decode (one RHS row per selected id) is GEMV. Ordinary 2-D `MUL_MAT` still covers GEMM (M3).

## M4 audit-fixes (DeepSeek PASS-with-fixes)

### FIX 1 — batched 2-D MUL_MAT (silent-wrong class)

`supports_op` for 2-D MUL_MAT on q23k accepted any F32 host RHS. `forward_mul_mat_q23k` only quantizes `src1->ne[1]` rows and writes batch 0, so a legal `ggml_mul_mat` with 3-D src1 `[k,M,B]` was silently wrong for batches ≥ 1.

Fix: require `src1->ne[2]==1 && src1->ne[3]==1` and dense `nb[0]/nb[1]` in `supports_op`. `compute_forward` returns false on batched src1 so the extra fence `GGML_ABORT`s if compute is forced (`n_threads=1`).

Jelly:

```
== batched 3-D src1 on 2-D q23k MUL_MAT must decline ==
  ok supports_op false for 2-D q23k x batched src1
  ok abort on batched src1 MUL_MAT: ... extra declined op=MUL_MAT; refusing native fallthrough on tiled layout
```

### FIX 2 — id-mode hygiene + e=2 slice content

- `ID_REPEATED` = constant expert `n_as-1` (non-zero when `n_as>1`).
- `ID_UNUSED` = sparse `(e+t)%(n_as-1)`, never selects `n_as-1`, not all-zero.
- Modes must differ from each other; test asserts this.
- `run_id_case` for `n_as>=3` `memcmp`s packed 3-D slice `e=2` against a 2-D pack of expert 2 (payload bytes, not just size).

Jelly + host: `ok id modes distinct (repeated=n_as-1, unused sparse)` and full M4 grid still PASS.

Follow-up: M5.
