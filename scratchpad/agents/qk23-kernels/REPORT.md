# q2_K / q3_K Adreno MoE — implementation report

**Design ref:** `scratchpad/agents/qk23-kernels/DESIGN.md` v3 (approved IMPLEMENT). This file is the running log. Do not edit the design.

**HEAD start:** `BigMoeOnEdge/third_party/llama.cpp` `c8f4fc05` (`kalsa/kernel-s3-repack`).
**Device:** S23 Adreno 740, serial `R3CW406P8CV` / TLS `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. `/data/local/tmp/s3oracle`. Plugged OK (correctness, no timing).
**Results:** `results/qk23_s23/` + MANIFEST.
**Law:** never export `GGML_OPENCL_HOST_REPACK` / `DUMP_Q`. `MSYS_NO_PATHCONV=1`. sha256 on device before every run. `-fa off` if FA could fire. No `supports_op` change until a later step. No GEMV/GEMM in S1.

---

## S1 — storage (convert + restore + host + roundtrip)

**Status:** S3 IN PROGRESS (compute kernels + dispatch). `supports_op` **untouched** — dispatch unreachable until S4. Unpack expressions copied VERBATIM from S2 oracle kernels.
**Scope:** convert/restore q2_K + q3_K trans4-moe; typed extras; q3 `get_alloc_size` +4 B/sb; subbuffer carve; pool/dtor; staging release; set/get_tensor; roundtrip harness. **Not:** `supports_op`, GEMV/GEMM, oracle kernel (S2).

**Mask ABI (from design §3.2, line one):**

| kernel | args |
|---|---|
| convert/restore q2 | `mask_03` |
| convert q3 | `mask_03`, `mask_0F`, `mask_01` |
| restore q3 | `mask_03`, `mask_0F`, `mask_01`, `mask_FF` |

No numeric mask literals in new `.cl`.

**Deviations from DESIGN.md:** none to the bijections / mask ABI / alloc math. **Addressing note (not a formula change):** `block_q3_K` is 110 B (`110 % 4 == 2`). Convert uses `global struct block_q3_K *` pointer arithmetic like in-tree `block_q6_K` (210 B, also `% 4 == 2`, `cvt.cl:1370`, already roundtrip-clean on A740). Max member align is `half` (2), so the compiler is not expected to pad to 112. The odd-block roundtrip (`ne00=1792`) is the discriminator; if it shows a 2-byte stride we switch to `uchar*` + `* 110` byte offsets before S1 device-green. Flagged here before coding, as required.

**q_img:** skipped in S1 (DESIGN first-pass). Extra structs have no image field.

### Changelog (S1)

- structs + convert/restore kernels in `cvt.cl` (q2/q3 trans4-moe; `half` type clash avoided via `hpart`).
- Host: extras, pool/dtor/reset, `get_alloc_size` q3 +4 B/sb, set/get_tensor moe-only, staging `clReleaseMemObject`.
- Roundtrip: Q2_K/Q3_K layouts, `as`+`weight`, `ne00=1792`, `const00`, `hmask16`.
- PC build clean. **No `supports_op` change. No GEMV/GEMM.**
- (this section) start.

### PC build (S1 STOP)

Tree: `build-android-opencl-s3oracle` (Ninja Release, Adreno kernels ON, embed ON). cmake re-ran; `cvt.cl.h` regenerated. ggml commit reported `c8f4fc05e-dirty`.

| artifact | sha256 | bytes |
|---|---|---:|
| `libggml-opencl.so` | `5dd5d682990250d7ccf7f3c2a67acb94caa6c3848256f55e668798231fc338c0` | 8200472 |
| `test-opencl-moe-roundtrip` | `f05b10bff4fb3e6df0e11d6fb1383477cf618517e1103e6d09fbada056bd3eb0` | 142024 |

Embedded `cvt.cl.h` contains `kernel_convert_block_q2_k_trans4_ns` and `kernel_restore_block_q3_k_trans4_ns`. Host compile: 2 pre-existing warnings (`use_adreno_bin_kernels` unused param; BF16 pragma message). **0 errors.**

**Not done (by design):** device push, roundtrip on S23, commit. Awaits hostile review of bijections vs DESIGN.md v3 formulas.

### Files touched (S1)

- `ggml/src/ggml-opencl/kernels/cvt.cl` — `block_q2_K`/`block_q3_K` + 4 kernels
- `ggml/src/ggml-opencl/ggml-opencl.cpp` — extras, pool, alloc, set/get_tensor, `clCreateKernel`
- `tests/test-opencl-moe-roundtrip.cpp` — layouts + cases
- `scratchpad/agents/qk23-kernels/REPORT.md` — this log

`supports_op` MUL_MAT_ID list unchanged (`:7403+` still Q4_1/Q5_0/Q5_1/Q4_K/Q5_K/Q6_K).

### Mask ABI as shipped

| kernel | args (order) |
|---|---|
| convert q2 | `mask_03` |
| restore q2 | `mask_03` |
| convert q3 | `mask_03`, `mask_0F`, `mask_01` |
| restore q3 | `mask_03`, `mask_0F`, `mask_01`, `mask_FF` |

No numeric mask literals in the new `.cl` (masks used as `uint m03 = (uint)mask_03` etc.).

### Convert/restore vs DESIGN v3 (self-check for reviewer)

- qs: `hpart=g>>3`, `j=(g&7)>>1`, `hi=(g&7)&1`, `shift=j<<1`, `byte_base=hpart*32+hi*16`, `q=((qs[byte_base+k]>>shift)&m03)`, `u |= q<<(2*k)`. 16 uint SoA stores `dst_q[base+p*ne01]`.
- Restore qs: 16 assemblies (`t=0..15`, 4 adjacent bytes gathered in private `uint w`), q2 `(__global uint*)b->qs)[t]=w`; q3 `convert_uchar((w>>(8*r))&mFF)` per byte.
- q3 qh: `qh_word[p]` low 16 = even `g`, high 16 = odd `g`; restore 8 assemblies then byte stores.
- q3 scales: per-`j` unpack to 16 uchar in 4 uint SoA; restore 3 private uint then 12 `convert_uchar` stores. No memset.
- `i01>=ne01` on all four kernels. Staging released on set and get. q3 parent `n_sb*4` in `get_alloc_size` only when `use_adreno_moe_kernels`.

### S1 review FIX-FIRST (applied)

Reviewer: bijections GOLD (symbolic + 10k-block mechanical). Four code findings.

1. **Partial set_tensor.** q4_K trans4-moe (`ggml-opencl.cpp` staging write `clEnqueueWriteBuffer(..., 0, ggml_nbytes, data)`) does **not** handle partial writes and does **not** assert. Same implicit full-tensor contract. New q2/q3 paths now `GGML_ASSERT(offset == 0 && size == ggml_nbytes(tensor))`. API `ggml_backend_tensor_set` (`ggml-backend.cpp:324`) allows partial; we do not implement it. Documented, not silently ignored.

2. **ne[3]==1.** Added to `use_adreno_moe_kernels` (shared gate — 4-D tensors fall back to generic AoS for **all** trans4-moe types, including q4_K). Also `GGML_ASSERT(ne[3]==1)` on q2/q3 set_tensor; `get_alloc_size` extra `n_sb*4` requires `ne[3]==1`. Launch still uses `ne[2]` only.

3. **parent_planes log.** `try.q3_k.parent_planes` was `log_alloc` (+bytes to running sum) without a `clCreateBuffer`. Now `log_alloc_note` (no sum inflation).

4. **clReleaseEvent** after `clWaitForEvents` on q2/q3 set_tensor convert and get_tensor restore.

**Adjudication (oracle):** device roundtrip after this rebuild validates storage-level (miscompile/align). **S1 is not layout-certified until S2 oracle.** Report must not claim bijection correctness from roundtrip alone.

### S1 device roundtrip

Unplugged TLS. Battery **87%** (not <30%). sha PC==device `226bd659…` (S1-fix .so). Log: `results/qk23_s23/roundtrip_s1.log`. `DONE rc=0`, every case `class=clean` mismatch=0 (q2/q3 + 8 legacy + 1792 odd q3 + const00 + hmask16 + weight). Path log `trans4-moe` on `"as"` q2/q3. **Not a layout certificate.**

### S2 — dequant oracle

Kernels `kernel_dequant_row_q{2,3}_k_trans4_ns` in `cvt.cl` (ORACLE=GEMV unpack, DESIGN §7.1b). Host: `GGML_OPENCL_QK23_ORACLE=1` after convert in set_tensor. Pairs E0–E4. CPU `dequantize_row_q2_K`/`q3_K`. hmask16 fill now sets d=fp16 1.0 (`0x3C00`) so the high bit is visible.

S2 .so sha `0abd77a1…` PC==device. Log: `results/qk23_s23/oracle_s2.log`. **All `nfail=0 max_abs=0`**, including q3 `ne=1792x64x4` **sb=1** and hmask16. Roundtrip still clean. `DONE rc=0`.

Battery still 87% at S2 push. Unplugged.

---

## S3 — four compute kernels + dispatch (STOP for review)

**Status:** PC build **clean**. `supports_op` **untouched** — Q2_K/Q3_K still absent from the Adreno `MUL_MAT_ID` list (`ggml-opencl.cpp` ~7663–7688: Q4_1/Q5_0/Q5_1/Q4_K/Q5_K/Q6_K only). Dispatch cases `return` after enqueue but **cannot fire** until S4 flips `supports_op`. No device run. No commit. **S4 waits for explicit owner green light after this review.**

**HEAD:** llama.cpp `dcc8eecec-dirty` on `kalsa/kernel-s3-repack` (S1+S2 commit + this S3 tree).

### Files

| file | role |
|---|---|
| `kernels/gemv_moe_q2_k_f32_ns.cl` | GEMV q2, subgroup 64, `N_SIMDGROUP` 4, no `_ila` |
| `kernels/gemm_moe_q2_k_f32_ns.cl` | GEMM q2, TILESIZE 16/64/32, `reorder_b`, `qcom_wave_pair_mode(1)` |
| `kernels/gemv_moe_q3_k_f32_ns.cl` | GEMV q3, signed `qhat` |
| `kernels/gemm_moe_q3_k_f32_ns.cl` | GEMM q3, signed `qhat` |
| `CMakeLists.txt` | four names after q6_K ns, not ILA |
| `ggml-opencl.cpp` | handles, `clCreateKernel` + embed `.cl.h`, extra0 casts, `MUL_MAT_ID` cases |

### Arg counts (host `GGML_ASSERT` == kernel signature)

DESIGN §3.2 GEMV order: `q, d, dm(q2), s, qh(q3), src1, src2, dst, offsetd, ne00, ne01, ne11, [masks…]`. GEMM clones q6_K then appends masks. Extra is **buffer** `extra->q`, not `q_img`.

| site | kernel | n | args |
|---|---|---:|---|
| GEMV q2 | `kernel_gemv_moe_q2_k_f32_ns` | 13 | `q,d,dm,s, src1,src2,dst, offsetd,ne00,ne01,ne11, mask_0F,mask_03` |
| GEMM q2 | `kernel_gemm_moe_q2_k_f32_ns` | 15 | `q,d,dm,s, src1,src2,emap,dst,tiles, ne00,ne01,ragged,skip, mask_0F,mask_03` |
| GEMV q3 | `kernel_gemv_moe_q3_k_f32_ns` | 14 | `q,d,s,qh, src1,src2,dst, offsetd,ne00,ne01,ne11, mask_03,mask_01,scale_zero` |
| GEMM q3 | `kernel_gemm_moe_q3_k_f32_ns` | 16 | `q,d,s,qh, src1,src2,emap,dst,tiles, ne00,ne01,ragged,skip, mask_03,mask_01,scale_zero` |

Host values: `mask_0F=0x0F`, `mask_03=0x03`, `mask_01=0x01`, `scale_zero=32.0f`. Always set. No `kernel_*_bin`. No `_ila`.

### Geometry (clone q6_K, not q4_K ILA)

- GEMV: `global = {((ne01+63)/64)*64, 4, ne20}`, `local = {64, 4, 1}`. `qcom_reqd_sub_group_size("half")`. `i01 >= ne01` return. Super-block stride `sb = sgid; sb < n_sb; sb += 4`. `d`/`dmin` hoisted in `__private` at top of `sb`. 4-subgroup local reduce like q6 `:126-140`.
- GEMM: `global[0]=64`, `global[1]=(ne01+63)/64`, `global[2]=max_post_router_tile`, `local={64,1,1}`. `reorder_b` then compute. Ragged skip `dotx8_reduce4` like q6. Write s1–s31 then barrier then s0.

### Unpack vs S2 oracle (verbatim)

Oracle: `cvt.cl` `kernel_dequant_row_q2_k_trans4_ns` / `q3`. Offsets: `expert_d = expert_id*n_sb*ne01`, `expert_q = expert_id*(ne00/16)*ne01`, `expert_qh = expert_id*(ne00/32)*ne01`, `s_row = (expert_id*ne01+i01)*(n_sb*16)`.

q2: `uint sc = (uint)src0_s[…]`; `dl = d * convert_float(sc & m0F)`; `ml = dmin * convert_float((sc >> 4) & m0F)`; `q = (bits >> (2*k)) & m03`; `y = dl * convert_float(q) - ml`.

q3: `dl = d * (convert_float(sc) - scale_zero)`; `p=g>>1`, `hi=g&1`, `lane=hi<<4`; `q_u = (bits>>(2*k))&m03`; `hm = (qh_w>>(lane+k))&m01`; `int qhat = (int)q_u; if (hm==0) qhat = (int)q_u - 4`; `y = dl * convert_float(qhat)`.

GEMV uses those extracts unrolled into `float4` + `dot` (q6 FMA pattern; no `float ak[16]` private array). GEMM `dequant16_q2` / `dequant16_q3` → `half16` then `dotx8_reduce4`.

M1 uint private. M2 shift-first. M3 all masks kernel args (no `0x0F`/`0x03`/`0x01` in the four `.cl`; `0xFFFFFFFF` tile-pad sentinel cloned from q6 is not a nibble mask). No `uchar sc`.

### Dispatch notes for the reviewer

- Cases sit after `Q6_K` `return`, before `MXFP4`.
- `ne12==1` → GEMV else GEMM.
- GEMM uses `extra0_q2_K->q` / `extra0_q3_K->q` buffers (DESIGN: no `q_img` in S1/S3).
- Fall-through if `!use_adreno_moe_kernels` matches other K-quants (default assert). Unreachable until S4 because `supports_op` is false.

### PC build (S3 STOP)

Tree: `build-android-opencl-s3oracle` (Ninja Release, Adreno ON, embed ON). cmake re-ran; four new `.cl.h` generated. ggml commit `dcc8eecec-dirty`.

| artifact | sha256 | bytes |
|---|---|---:|
| `libggml-opencl.so` | `ca504a0b4742f2775ab8aeaefc98fcc320a6c952f0c0793d0ab65a64dfe7a044` | 8361752 |

Host compile: 2 pre-existing warnings (`use_adreno_bin_kernels` unused param; BF16 pragma). **0 errors.** Embedded headers contain all four kernel names.

**Not done (by design):** `supports_op` flip, device `test-backend-ops` MUL_MAT_ID, oracle re-run, LFM llama-bench, commit. Reviewer must count args at 4 sites and diff inner loops vs oracle before S4.

### S3 review — STOP, family-wide pre-existing (no q2/q3 fix yet)

Reviewer: two MAJORs, padding-boundary / barrier. Instruction: **mirror q6_K/q4_K exactly**; if they also early-return, **STOP** (scope change). They do. **q2/q3 kernels not modified this pass.** sha unchanged `ca504a0b…`.

**GEMV (q6 `:41-42`, q4_K `:68-69`):** both do `if (i01 >= ne01) return;` **before** the work-group `barrier(CLK_LOCAL_MEM_FENCE)` (q6 `:131`, q4 `:156`). q2/q3 cloned that (`:31` / `:41`). There is no valid-lane / clamp / predicated-store pattern in the family to copy.

**GEMM (q4_K `:304`, q5_K `:312`, q6_K `:280`, q2 `:160`, q3 `:161`):** same `if ((gid0 + block_id_m * TILESIZE_M) >= ne01) return;` **after** the K-loop (so padding lanes **do** hit `sub_group_barrier` during K) and **before** the work-group `barrier(CLK_LOCAL_MEM_FENCE)` that publishes `out_idx` (q6 `:295`). Loads use unclamped `row_idx` — OOB on extra planes sized `n_sb * ne01`, not padded to 64.

**Why it can look green:** `use_adreno_moe_kernels` admits `ne01 % 32 == 0` (`ggml-opencl.cpp:7188`). Host GEMV pads `global[0]` to 64. `ne01=32` or `96` puts 32 padding lanes in a 64×4 (GEMV) / 64 (GEMM) work-group that skip the WG barrier. `ne01 % 64 == 0` (LFM 2048, many tests) never creates padding lanes, so the hang/OOB is invisible. Adreno may also be lenient on unbalanced barriers; that is not a spec-safe solution.

**Scope if we proceed:** not a q2/q3-only patch. Canonical barrier-safe pattern (`valid` predicate, clamp loads, all lanes through every barrier, predicated dst write) is a **family** change (q4_K/q5_K/q6_K GEMV+GEMM + q2/q3). Fixing only q2/q3 would **diverge** from the clone mandate. Awaiting owner: family-wide now vs q2/q3-only exception vs ship-as-cloned and live with the pre-existing risk on `%32 && !%64`.

### S3 delta — Option 2 (owner 21/08): q2/q3 only + family queued

**Decision:** fix q2/q3 **only**. q4_K/q5_K/q6_K are kalsakernel-v3 baseline (391/391); touching them mid-chapter invalidates the verified state. Family latent defect (early-return before WG barrier + GEMM OOB, dormant because every current shape is `%64==0`):

- (a) this report, table above
- (b) publication dossier notes: `PLAN.md` item 8 + audit bullet “5° latente, review-not-device”
- (c) PLAN coda **#13**: “barrier-safe pattern port to q4_K/q5_K/q6_K GEMV+GEMM (latent, ne01%32&&!%64) — separate verification session”

**Exception to mirror-q6 (documented in-kernel):**

```
// unlike the q4/q5/q6 clones, no early return: all lanes must reach the
// barriers (gate admits ne01%32, grid pads to 64)
```

| kernel | pattern |
|---|---|
| GEMV q2/q3 | `const bool valid = (i01 < ne01)`; loads use `i01_load = valid ? i01 : ne01-1`; all lanes hit reduceLM + `barrier(CLK_LOCAL_MEM_FENCE)`; `dst` write `valid && sgid==0` |
| GEMM q2/q3 | `valid = (row_idx < ne01)`; loads use `row_load`; `sub_group_barrier` in K + `out_idx` WG barrier + `CLK_GLOBAL_MEM_FENCE` reached by all lanes; stores predicated `if (valid)` (s1–s31 then s0). WG-uniform `block_id_n >= total_tiles[0] return` kept (entire work-group exits) |

q4/q5/q6 `.cl` **not modified**. `supports_op` **untouched**.

**Discriminator (test-backend-ops):** one `MUL_MAT_ID` case per type, `m=96` (`%32` gate, not `%64` → padding lanes), `n=1` (GEMV), `k=256`, `n_mats=4`, `n_used=2`. Type-scoped — **no** `m=96` for other types (would expose the family bug in our matrix before coda #13). GEMM poison (`n>1, m=96`) not in the one-case budget. Fires only after S4 `supports_op`.

### PC build (S3 delta STOP)

Four `.cl.h` regenerated. ggml-opencl link **0 errors** (2 pre-existing warnings).

| artifact | sha256 | bytes |
|---|---|---:|
| `libggml-opencl.so` | `3a6033ef374aed4d2ae495e53cc360e7478283fc1d01411cf05e4dbec6f6d3d8` | 8362808 |

Previous S3 sha `ca504a0b…`. **No S4. No device. No commit.** Same reviewer on this delta, then owner green light.

---

## S4 — supports_op flip + device battery — GREEN

**Flip:** `GGML_TYPE_Q2_K` and `Q3_K` added to the Adreno `MUL_MAT_ID` list next to Q4_K/Q5_K/Q6_K. Same `src1==F32 && use_adreno_moe_kernels && contiguous`. Dense `MUL_MAT` list **not** changed.

**PC:** `libggml-opencl.so` `ed60d804c490e5d3b2111b6e775a354f87ca3839cc72a089336568db1bf37fb0` (8362880 B). `test-backend-ops` `a1278b8e…`. PC==device.

**Device:** TLS, **unplugged**, battery 85%→83%, not &lt;30%. LFM already on `/data/local/tmp/` sha `b07c8087…` (MANIFEST history; **not** Mellum2 `b04281c2`). No re-push (1.8 G free).

| step | result |
|---|---|
| MUL_MAT_ID | **399/399** (391+8). q4_K 80 / q5_K 4 / q6_K 3 unchanged. q2_K 4, q3_K 4 including **m=96**. LOG_KERNELS gemv+gemm q2/q3. |
| MUL_MAT | **915/925**, 10 known q6_K flat fails only |
| roundtrip | all `class=clean` mismatch=0, `DONE rc=0` |
| oracle | all `nfail=0 max_abs=0` incl. odd sb=1 |
| LFM smoke | load OK, **n_cpu_moe=0**, -fa off -ngl 99, pp128 60.26 t/s, **tg64 15.09 t/s** (unplugged correctness, not N≥10). LOG_KERNELS: `kernel_{gemv,gemm}_moe_q{2,3}_k_f32_ns` |
| optional cli | "The capital of France is" → Paris (think-block). Coherent |

Evidence: `results/qk23_s23/{s4_mmid,s4_mm,s4_rt_oracle,s4_lfm,s4_cli}.{out,err}` + MANIFEST.

**Commit:** `f700bf30cd936f6799cf89c9acad27b7ee1872b1` on `kalsa/kernel-s3-repack`. **NO push.** MAX RECALL next (owner).

---

## Follow-up — C3 GEMM padding + MAX RECALL angle A MINORs

**C3 closed on device.** Two type-scoped cases `m=96 n=4 k=256` (GEMM, real padding lanes). `s4_gemm96.out`: **401/401**, both OK. LOG_KERNELS `kernel_gemm_moe_q{2,3}_k_f32_ns`. Still no m=96 on q4/q5/q6.

**MINOR-1 (const00 / hmask16 labels):** possibility **(a)** — they executed; the strings are absent from S1/S2/S4 logs. `ROUNDTRIP_FILL` is once at process start (`resolved=lcg` because env unset). Per-case lines had no fill field. Identity = `main()` order after the 1792 odd case (`s4_rt_oracle.out:31` const00 q2, `:33` const00 q3, `:35` hmask16 q3; same ordinals in `roundtrip_s1.log` `:64/:68/:70` and `oracle_s2.log` `:89/:99/:101`). Harness now prints `fill=`. Labeled re-run `s4_rt_fill.out`: `fill=const00` and `fill=hmask16` both `class=clean mismatch=0`; oracle `nfail_all=0`. Do not claim the old logs contain the tokens `const00`/`hmask16`.

**MINOR-2:** LFM JSONL `"build_commit": "c8f4fc05e"` is cmake configure-time embed in the noextra `llama-bench-impl` (`d2030f23…`). Authoritative pin: `libggml-opencl.so` `ed60d804…`.

### Claims (angle C rewordings)

- **C1.** Correctness claims are scoped to the **executed case matrix**: MUL_MAT_ID **401/401** (the shapes that ran, including m=96 n=1 GEMV and m=96 n=4 GEMM), MUL_MAT 915/925 with the 10 known q6_K flat fails, roundtrip/oracle on the harness list. Not a proof over every legal MoE shape the gate could admit.
- **C2.** The new kernels **enable KEXP experts on GPU** (LFM2.5 smoke, both types dispatching, zero fallback): `n_cpu_moe=0`, LOG_KERNELS `kernel_{gemv,gemm}_moe_q{2,3}_k_f32_ns`. Not an N≥10 speed cell, not a ship-default claim.
- **C3.** Padding-lane immunity for the **new** q2/q3 kernels is device-proven for GEMV **and** GEMM (m=96 n=1 and n=4, both types OK).
- **C4.** The q4_K/q5_K/q6_K early-return-before-WG-barrier + GEMM unclamped `row_idx` is **review-found, latent, not device-proven**. It is dormant on every `%64==0` shape in the current matrix. PLAN coda #13. Do not call it device-green or device-red.

Evidence: `results/qk23_s23/{s4_gemm96,s4_rt_fill}.{out,err}` + MANIFEST.

**Commits (NO push):** `2217d61a09babc8278e63f1cad14a0f965046cc5` (GEMM m=96 n=4) then `8f70ba394` (roundtrip `fill=`).

### Angle B FIX-BEFORE-BANK

1. `run_with_fill` saves/restores `GGML_OPENCL_ROUNDTRIP_FILL` (Q4_0 dense controls keep the env override).
2. Comments: sibling m=96 exclusion is a latent review-found barrier hazard; campaign jargon purged from extras/oracle/alloc/cvt.
3. extra0_q2_K/q3_K comment: Adreno MUL_MAT_ID dispatch exists (no stale TODO).

Cleanup commit `ec7235af687137bb85d8541b027e0c6a01583c1a`. Rebuild 0 errors. Roundtrip re-run (`s4_rt_cleanup.out`): `DONE rc=0`, `fill=const00`/`hmask16` clean, oracle `nfail_all=0`. `.so` `50dd126d1a467b74c08ee6171c3d6586d0a1563d468a92c2c0406a37e98c6ac5`.

**Tag:** `kalsakernel-v4` → `ec7235af6` (local only). **Bundle:** `backups/kalsakernel-v4.bundle` (prereq `22b69b6e9`, branch + v1–v4). Llama.cpp remotes still DISABLED.

