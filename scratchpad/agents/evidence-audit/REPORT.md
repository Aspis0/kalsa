# FORENSIC EVIDENCE AUDIT — roundtrip / restore / poisoned-judge conclusion
Agent: independent evidence auditor (fresh eyes). Date: 2026-08-19 (~16:00 session).
Scope: READ-ONLY on all artifacts; only write is this report.
Method: every load-bearing claim checked against on-disk files (logs, sources, build dirs, git objects, recorded shas). Nothing executed, no device access.

---

## Verdict summary

| # | Claim | Verdict |
|---|-------|---------|
| C1 | Round-trip set→get corrupts q4_0 MoE odd-qs bytes, signature `got=(want&0x0F)|0xF0`, A=94208/294912, B=61440/294912, q6_K & dense clean | **CONFIRMED** (3 caveats, incl. one unexplained internal discrepancy: A≠B storage implies the GPU convert is still not byte-identical to host repack on device) |
| C2 | Restore kernel `kernel_restore_block_q4_0_trans4_ns` (cvt.cl:352-392) has the as_ushort8+uchar* private-register alias; comment warns; dispatched in get_tensor for MoE q4_0; poisoning route get_tensor→CPU judge exists end-to-end | **CONFIRMED** |
| C3 | Judge-swap runJS1/JS2/ctrl actually ran pristine-ggml-cpu; expected to fail anyway (poisoning precedes judge) | **CONFIRMED with caveats** (source-level revert verified on disk in a dedicated worktree; judge-build OpenCL .so not byte-identical to oracle's) |
| C4 | In-situ audits runs 5-10: 12/12 green each, run pairs agree; stashes from HOST set data; stock dequantize; DST_READBACK 3 distinct reads; env gates correct | **CONFIRMED** (one PLAN prose error: "zero POST_ENQUEUE" is contradicted by the logs, n_post_enq=1..11; substantive checks unaffected) |
| C5 | Oracle run3/4: 74×4 pattern=ok, gemm_bin_loaded=0, all_ok=1, same-run 74/74 FAIL, means 0.456/0.450 | **CONFIRMED** (means recomputed 0.4561 / 0.4499) |
| C6 | e2e FAIL in the SAME logs as the green audits; 12/12, ERR sub-ceiling | **CONFIRMED** (band is actually 0.307-0.733, mean 0.461 across 96 values — "0.31-0.70" is a tight rounding) |

**Bottom line:** The two-day narrative survives contact with the artifacts. The GPU compute path is clean (oracle + in-situ audits), the restore/kernels and the get_tensor→judge copy route are all present exactly as claimed, and the roundtrip reproduces the specific odd-qs-byte corruption on clean host-produced storage (run B), which isolates the corruption to the read/restore side. No fabricated-by-bug numbers found; the classification code measures rather than asserts the signature.

---

## C1 — ROUND-TRIP TEST (most load-bearing) — CONFIRMED, 3 caveats

### Harness source (on disk, untracked)
`BigMoeOnEdge/third_party/llama.cpp/tests/test-opencl-moe-roundtrip.cpp` + `tests/CMakeLists.txt` adds `llama_build(test-opencl-moe-roundtrip.cpp)`.

- `fill_pattern()` = `(i*131+17)&0xFF`, deterministic, **independent of the GPU**. I re-derived blk0 WANT from the formula: bytes = 11 94 17 9a 1d a0 23 a6 29 ac 2f b2 35 b8 3b be 41 c4 — matches the log **exactly** in both runs. The compare is byte-vs-byte against this original host `want` array, after `set_tensor`→`get_tensor` on the same tensor with a `synchronize()` between.
- The harness probes three cases: `"as"` q4_0 (256,512,4), `"as"` q6_K (256,512,4), `"weight"` q4_0 (256,512,1) — i.e., MoE-named q4_0, MoE-named q6_K, dense-named q4_0.

### Number/arithmetic verification (recomputed from the logs)
- q4_0 `as`: nbytes = 16384 blocks × 18 B = 294,912 ✓ (log prints 294912).
- Run A mismatch = 94,208; Run B mismatch = 61,440.
- `off_mis` histogram: only odd offsets 3,5,…,17 are non-zero; A = 11,776 each; B = 7,680 each. Check: 11,776×8 = 94,208 ✓; 7,680×8 = 61,440 ✓. (The 10,240-total display cap in `xor_top` is a print cap (8 entries), not a counting bug — the per-offset histogram and rule totals are complete.)
- Rule check is MEASURED, not asserted: `hi_nibble_to_F=94208, hi_to_F_lo_preserved=94208, other=0` (A); 61,440 / 61,440 / 0 (B). So 100% of mismatches fit `got=(want&0x0F)|0xF0`. Spot-checked blk0: 9a→fa, ac→fc, b8→f8, be→fe ✓.
- q6_K `as`: 430,080 = 2048 blocks × 210 B (block_q6_K = ql[128]+qh[64]+scales[16]+d[2] = 210, `sizeof` asserted in ggml-common.h:368) ✓. 0/430080 both runs.
- dense `weight`: 73,728 = 4096 × 18 ✓. 0/73728 both runs.
- `first=3` in both runs; blk0 is corrupted in both. 7680/16384 = 46.875% ≈ "46.9%" as claimed.
- Historical cross-check "46%" (PLAN.md:1234, byte-wise convert "46% dei word alti", ERR 0.184-0.193): the magnitudes match (46.9% vs 46%), but they are different quantities (fraction of odd-qs storage blocks corrupted by restore vs fraction of convert output high-words mismatching oracle). Treated as a magnitude coincidence/consistency flavoring, not a rigorous equality. The source of the "46%" figure is on disk (PLAN.md:1234, and PLAN.md:1235 cites "46.1%" for the x0>=0x80 shift-arithmetic trigger).

### Name-gate reached the MoE path — evidence in the logs
- Run B log contains `ggml_opencl: KALSA host repack for q4_0 MoE tensor 256x512x4` (stderr banner, at end of the process) — i.e., the host-repack branch of the MoE set_tensor path fired for the q4_0 `as` tensor. Run A has no such banner (HOST_REPACK unset → convert kernel path).
- The corruption signature itself is only explainable by the restore path: `qs_got==packed=0` in BOTH runs rules out "returned the raw packed SoA storage"; `qs_got==unpack(pack(want))=0` rules out a faithful restore; only the restore output with odd-q bytes altered fits. So the MoE restore path was reached in get_tensor, inferred from the output (there is no explicit "restore dispatched" line in the roundtrip log).

### The produced binary that ran
Let me be exact about the exe/library chain (see Cross-cutting): the run log's `adbd` push line records **exe sha 306af176…** and **opencl 25044c5a…**; current disk files equal these. This matches everything else.

### Caveat C1-1 — SHA256.txt `exe` line is wrong/stale
`results/oracle_consumer_s23/roundtrip/SHA256.txt` lists `exe 538ae4ed3a…` — this matches **neither** the adbd push sha (306af176…) **nor** the current disk file (306af176…). The `opencl` (25044c5a…) and `cpu` (fd9cb4b1…) lines match disk exactly. The load-bearing component of the experiment (the restore kernel) lives in libggml-opencl.so, whose sha is consistent across SHA256.txt / adbd push / disk, so this does not touch the kernel-side claim; but the recorded exe hash does not correspond to the artifact that ran. HAUL: treat the roundtrip SHA256.txt `exe` line as erroneous.

### Caveat C1-2 — UNEXPLAINED: run A vs run B must imply GPU-convert storage ≠ host-repack storage on device
Same X, same harness, same restore kernel, same dispatch geometry in A and B. If the SoA storage produced by the GPU convert (A) were byte-identical to the host-repack storage (B), the data-dependent restore would corrupt the same blocks → identical mismatch counts. They differ: 94,208 vs 61,440 (Δ = 32,768 = exactly 4096 blocks × 8 odd bytes). **Conclusion forced by the logs: the on-device GPU convert output is NOT byte-identical to the host-repack output for a subset of blocks.** This is not mentioned anywhere in the reports. Possibilities: (i) the current convert is still subtly non-byte-exact on device (contradicts a naive "convert proven byte-exact" reading), or (ii) the restore miscompile is not purely a deterministic function of storage (unusual given the clean signature). It does **not** threaten the core inference — run B uses host-arithmetic (code audited correct in `ggml-opencl.cpp:8401-8457`) storage, so the 61,440-byte corruption in B was introduced on the read/restore side regardless — but it is a real, unexamined discrepancy in the artifacts.

### Caveat C1-3 — no raw storage readback recorded
The roundtrip does set→get only; there is no `clEnqueueReadBuffer` of `extra->q` itself in the artifacts (env `DUMP_Q` hook exists in the source but was not enabled for this run). So "storage was clean in run B" rests on host-code audit + the count logic, not on a direct on-device dump. The mechanism attribution (Adreno compiler miscompile of `as_ushort8` + `uchar*` private-register aliasing) is consistent with the upstream comment in cvt.cl and with the characteristic signature, but is not independently reproduced (an Adreno-only compiler defect has no PC-side reproduction in these artifacts).

---

## C2 — CULPRIT SOURCE — CONFIRMED

- `ggml/src/ggml-opencl/kernels/cvt.cl:352-392` = `kernel_restore_block_q4_0_trans4_ns`; body reads `uint4 q_block`, then `ushort8 post_block = as_ushort8(q_block); uchar * post_block_ptr = (uchar *)(&post_block);` (lines 382-383) — the as_ushort8 + private-register uchar* aliasing idiom is literally present. ✓
- `cvt.cl:330-333` (exact lines 330-333) contains the comment: "…no staging buffer, no aliasing, no printf); **assembling uint words in registers first is miscompiled.**" ✓ — the identity of the idiom the convert was patched to avoid.
- Restore dispatch in get_tensor: `ggml-opencl.cpp:9914` (within claimed 9912-9940): for q4_0 SoA + `use_adreno_moe_kernels(tensor)` it selects `kernel_restore_block_q4_0_trans4_ns`, enqueues, then `clEnqueueReadBuffer` to `data`. Immediately above (:9887-9893) the code comment explicitly says "in test-backend-ops, the GPU graph is copied to the CPU backend, which requires reading back quantized weight tensors." ✓
- Name gate: `use_adreno_moe_kernels` (`ggml-opencl.cpp:6960-6964`) = name contains "ffn"+"exps" OR "as", and ne01%32==0. For the harness "as" (ne01=512): gate OPEN. For "weight" (ne01=512): gate CLOSED → AoS direct readback branch (!!9897-9907) → dense bypasses trans4_ns. ✓
- q6_K restore (`cvt.cl:2168-2192`) uses plain scalar global loops over ql/qh/scales/d — no register aliasing — and it covers the full 210-byte block (verified: block_q6_K has no separate qs field). Different idiom ⇒ clean roundtrip. ✓
- Poisoning route end-to-end (source-verified):
  - `tests/test-backend-ops.cpp:1503` → `ggml_backend_compare_graph_backend`
  - `ggml-backend.cpp:2156-2157` → `ggml_backend_graph_copy(backend2, graph)`
  - `ggml-backend.cpp:2041-2056` (`graph_copy_init_tensor`) → `ggml_backend_tensor_copy(src, dst)`
  - `ggml-backend.cpp:487` (`ggml_backend_tensor_copy`) → when src is on OpenCL (non-host) and dst on the CPU backend (host): `ggml_backend_tensor_get(src, dst->data, …)` → **OpenCL get_tensor → restore kernel → poisoned bytes land directly in the CPU judge's buffer.** Route EXISTS.
- Restore kernel is upstream code (added by `f3e8d149c` "opencl: add q4_0 MoE GEMM for Adreno (#22731)"), not campaign-written — consistent with "production upstream carries the latent defect".
- Working tree has __no__ modifications to cvt.cl, ggml-opencl.cpp, ggml-backend.cpp (branch HEAD 1582f2d83; the files match their committed state). ✓

---

## C3 — JUDGE-SWAP RUNS — CONFIRMED with caveats

### The "pristine ggml-cpu" premise is verifiable on disk
- `BigMoeOnEdge/third_party/llama.cpp-judge-swap/` is a dedicated worktree at `bcdbc9ed6` (detached) with a working-tree modification to `ggml/src/ggml-cpu/ggml-cpu.c`.
- `git diff 22b69b6e9 -- ggml/src/ggml-cpu/ggml-cpu.c` in that worktree = **0 lines** (working copy == upstream merge-base exactly).
- `git diff bcdbc9ed6 -- ggml/src/ggml-cpu/ggml-cpu.c` = 937 lines (differs from the campaign branch).
- So the judge-swap build source is EXACTLY "campaign OpenCL + pristine merge-base ggml-cpu". ✓
- `ggml-quants.c/.h` in the main tree vs 22b69b6e9 = empty diff (untouched) ✓, matching claims.

### Runs
- runJS1/runJS2: on-device shas recorded (exe `6f61a390…`, opencl `85a327acc…`, cpu `5ec15344…`); both runs 12/12 MUL_MAT_ID q4_0 FAIL; ERR ranges 0.3075-0.6106 (JS1), numbers regenerated between runs (JS2 log differs in values, not in verdict). ✓
- runJS_ctrl: q8_0 75/75 OK; q6_K 3/3 OK **including the exact shape `n_mats=4,n_used=2,b=0,m=512,n=1,k=256` that FAILS for q4_0**; dense MUL_MAT q4_0 46/46 OK. The "burning compare" (same shape, quant-only discriminator) is on the record. ✓
- Consistency with C1/C2: judge-swap failing is the EXPECTED outcome under the new hypothesis (the copy→get_tensor poisoning happens before either judge evaluates), so it carries no discriminating power — the report states this honestly. It does NOT contradict C1/C2; it is consistent with them.

### Caveats
- The judge build's libggml-opencl.so (`85a327acc…`, 7,963,136 B) is **not byte-identical** to the oracle/campaign libggml-opencl.so (`25044c5a…`, 7,963,024 B). The agent's own `SHA256_PC.txt` records `DIFF_VS_ORACLE` for opencl and annotates "(s3judge rebuild of bcdbc9ed6 OpenCL src; campaign 25044c5a lineage sources identical)". Both .so files embed the same kernel symbols with identical occurrence counts (checked for 5 kernel names), so a same-source-different-build-dir (path strings) difference is plausible — but byte-identity is asserted, not demonstrated.
- The exact binaries that ran (cpu `5ec15344…`) are no longer in `build-android-opencl-s3judge/bin` (dir was rebuilt at 15:45 → cpu `dc18871f…`, exe `6f61a390…` unchanged, opencl `85a327acc…` unchanged). The on-device SHA256 files are the authoritative "what ran" record.

---

## C4 — IN-SITU AUDITS (runs 5-10) — CONFIRMED, one PLAN prose error

### GEMV_AUDIT run5/run6
- Each log has exactly 12 `GEMV_AUDIT{…}` lines; all `n_bad=0`, `n_oob=0`, `pattern=ok`, `max_abs` 1.6-2.6e-6, `ratio_frac_near=1.0000`; `GEMV_AUDIT_BOUND` and `GEMV_AUDIT_NOTE` emitted once each; zero `skipped=` lines. Env banners: `HOST_REPACK_SET=[1]`, `GEMV_AUDIT_SET=[1]` ✓ (matches `_run.sh`).
- e2e 12/12 FAIL interleaved in the same log: run5 mean 0.4852 (claimed ~0.48 ✓), run6 0.4884; bands 0.36-0.70.

### Circularity hunt (the important one) — SOUND
- AoS weight stash is captured in `set_tensor` from the **HOST-side `data` pointer** (`ggml-opencl.cpp:8385-8394`, `memcpy(extra->aos_host.data(), data, nbytes)`), i.e. the original X the test generated — NOT a GPU readback. ✓
- Reference is computed from the stash with **stock `dequantize_row_q4_0`** (`ggml-opencl.cpp:20655`) on `block_q4_0 *` from `aos_host`, dotted in double against GPU-readback src1 (20577-20581) and GPU-readback ids (20583-20587); dst `got` is a GPU readback (20579-20582). Because storage in HOST_REPACK mode = host repack(X), a poisoned storage would have shown up as n_bad>0 in dst; n_bad=0 exonerates kernel+glue+storage.
- `ggml-quants.c` is untouched vs merge-base (git diff empty) so `dequantize_row_q4_0` is genuinely stock. ✓

### GLUE_AUDIT run7/run8
- 12 lines each; every line `dst_vs_semantic_n_bad=0, dst_vs_args_n_bad=0, n_divergent=0, ids_gpu_vs_stash_n_bad=0, src1_gpu_vs_stash_n_bad=0, n_expert_div=0, n_col_div=0, n_dst_off_div=0`. Classification identical across the pair (numbers differ: regenerated data). e2e 12/12 FAIL same logs. ✓
- PLAN's "ERR 0.41-0.66" for run7/8 is inexact: run7 actual 0.3718-0.6598, run8 actual 0.3070-0.4983. Minor prose drift.

### DST_READBACK run9/run10 — three DISTINCT reads confirmed in code
- snap: registered at dispatch from a GPU readback of dst (`ggml-opencl.cpp:20579-20587` → `ggml_opencl_gemv_register_dst_snap(… got.data() …)`, ck computed at :1358).
- raw: a fresh blocking `clEnqueueReadBuffer` of the same range at readback time (:1403-1412).
- returned: checksum over the bytes get_tensor actually delivers (:1422-1437).
- All three checksums are EQUAL in all 12 cases in both runs; `get_off==snap_off`; `OVERLAP_MAP{n_overlaps=0, n_snaps=12, n_live=0, n_post_bind=0}`. ✓ Code even documents the reachable-outcome matrix (:1362-1369).

### PROSE ERROR in PLAN (session ~15:20): "zero POST_ENQUEUE"
- The log counter `n_post_enq` increments 1→11 across the 12 cases (11 enqueues observed after the first snapshot; final `OVERLAP_MAP n_post_enq=11`). What is zero is `n_overlap_pairs` and `n_post_bind`, and zero `POST_ENQUEUE{…}` event lines were emitted. "zero POST_ENQUEUE" as written in PLAN.md is contradicted by the logs; the substantive anti-clobber conclusion (no enqueue overlapped a live snapshot; checksums snap==raw==returned) is unaffected. Flag as prose-vs-log, not a measurement error.
- Also note (design, disclosed in code): for offset-equality the (raw=1, returned=0) outcome is structurally unreachable — the hook is a clobber detector, not a byte-fidelity proof of the weight restore.

---

## C5 — ORACLE RUNS 3/4 — CONFIRMED
- run3: `ENV ORACLE=[1] HOST_REPACK=[1] cpuset=/`; `ORACLE_PATHINFO{gemm_bin_loaded=0}`; every `ORACLE{…}` line `pattern=ok`, float/raw/raw_d mismatch = 0; final `ORACLE_SUMMARY{tensors=74, lines_bad=0/296, … all_ok=1}`; ORACLE summaries byte-identical between run3 and run4 (diff empty).
- Same logs: 74/74 MUL_MAT_ID FAIL, ERR mean run3 = 0.4561 (claimed 0.456), run4 = 0.4499 (claimed 0.450). 2880×2880×32 arithmetic checks out (n=265,420,800; raw=33,177,600 = blocks×4; d=8,294,400 = blocks).
- run1/run2 compile-fail session confirmed: log shows `cl err=-11`, "parameter name omitted" at the GEMV wrapper (the `local` reserved word); on-device opencl `3f3df26a…` matches the a97f7bd0c lineage.

---

## C6 — e2e FAIL CONTEXT — CONFIRMED
- Every run log interleaves the green audit lines with the 12/12 `FAIL` / `ERR` lines from the SAME invocation (`_run.sh` = one `adb` call each); no mixing of logs across sessions. The "no mixing" claim holds.
- Aggregate over the 8 twelve-case runs (run5,6,7,8,9,10,JS1,NR): n=96, ERR 0.3070-0.7334, mean 0.4610. All FAIL, all sub-ceiling. The phrase "band 0.31-0.70" is a tight rounding: run8 dips to 0.3070, run10 peaks at 0.7334. Substance (all FAIL, mid-band) intact.
- Bonus convergence (not in the original claims list, on disk): runNR (merge-base ggml-cpu + `GGML_CPU_REPACK=OFF` judge) still FAILS q4_0 0/12 (0.31-0.56) while q6_K stays 3/3 — consistent with the get_tensor-poisoning hypothesis and not with a CPU-repack mechanism. runB1 (Session B f1/f2 dump, 15:30) exists as the designed-but-not-yet-decisive follow-up.

---

## CROSS-CUTTING — sha integrity / no hallucinated numbers
- Load-bearing lib libggml-opencl.so `25044c5a…` is identical across disk (s3oracle/bin), on-device SHA256 files (run9/run10, roundtrip), and adbd push lines. ✓
- roundtrip SHA256.txt `opencl`/`cpu` lines match disk; `exe` line is wrong/stale (see C1-1). ✗
- runs 5-8 (GEMV_AUDIT + GLUE_AUDIT) have **no sha record on disk** in the results dir (claimed "sha on-device acb41c32…/2ab3624c…" lives only in PLAN prose); runs 9-10 and the JS/roundtrip dirs carry SHA256 files (verified on-device opencl 25044c5a for run9/10). Provenance gap for runs 5-8 specifically.
- Build dirs s3oracle/s3judge were reused after the runs (exe now `e5f2ecd4…`, run-time was `81bfb4d9…`; judge cpu now `dc18871f…`, run-time `5ec15344…`). Recorded on-device SHA256.txt files are internally consistent and remain the authoritative "what ran" record.
- Every headline number I traced exists literally in an artifact: 94208/294912, 61440/294912, 430080, 73728, 11776/7680 per odd offset, 46.875%, 296, 74, 0.4561/0.4499, 12× green + 12× FAIL per run, 0.307-0.733 band, 3/3 and 75/75 and 46/46 controls, gemm_bin_loaded=0. No claim cites a number found in no artifact (the only wobbles are prose: run7/8 "0.41-0.66", "zero POST_ENQUEUE", "0.31-0.70" tightness, and the C1-1 exe-sha line).

---

## The single strongest remaining way the whole conclusion could still be wrong

**The last causal leg — "the CPU judge receives exactly the poisoned bytes via get_tensor, and that poisoning is what produces ERR 0.31-0.73" — is inferred, not directly observed inside the failing comparison.**

Everything else is nailed down: the kernel computes correctly, the restore sits on the get_tensor path with the exact aliasing idiom, the roundtrip shows the specific odd-qs-byte corruption appearing on the read side with clean host-produced storage (run B), and the copy route get_tensor→CPU judge exists in source. But no artifact dumps, inside the failing `compare_graph_backend` evaluation, both compared buffers (f1=OpenCL dst, f2=CPU dst) **and the weight bytes the CPU judge consumed** and shows (i) those bytes carry the 0xF0 odd-qs signature AND (ii) re-evaluating the CPU reference with them reproduces the exact ERR. The purpose-built session for this (runB1 / commit 1582f2d83 "tests: dump f1/f2 on backend-compare ERR") exists but its decisive output is not on record. If, for example, the CPU-side weight copy actually dodges the restore (shallow/unsplit view path) or the poison arrives through a different component (e.g. the i32 `ids` direct copy, or a view-offseting difference in `tensor_copy`), the causal chain "restore-miscompile → exact ERR band" would be partial, even though the roundtrip signature and the route are real.

Secondary open risk the reports never raise: **"production is unaffected" (never get_tensors weights) is asserted from code reading, not demonstrated** on the actual inference engine (kalsa-engine/BMoE is a separate codebase not auditable here); a production code path that reads MoE weights back (quantization-on-load, checkpointing, multi-GPU transfer, expert streaming) would break claim (3) of the conclusion.

Tertiary (fresh-finding, acts as a stress test more than a refutation): the C1-2 A≠B mismatch-count discrepancy shows the on-device GPU convert is still not byte-identical to host repack — an unexamined second discrepancy that deserves explanation, but run B already isolates the restore independently of it.
