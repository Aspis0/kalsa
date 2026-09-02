# v79 NPU defect desk — classes A and B (cell #46) — rev-2

Pin: `kalsallama` `kalsa/npu-judge-v79` @ `93e9592fa`. Device: none (code + #46 raw).
Evidence: `qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt` (ANSI stripped). Host `ggml-hexagon.cpp`; DSP `htp/matmul-ops.c` + `htp/hmx-mm-kernels-tiled.h`.

ggml MUL_MAT dims (`tests/test-backend-ops.cpp:4459-4511`): `a = (k, m)`, `b = (k, n)`, `out = (m, n)`. HMX uses the opposite names: `hmx_m = src1->ne[1] = test n`, `hmx_n = src0->ne[1] = test m`, `k = src0->ne[0]`.

---

## Class A — 36 `dsp-rsp: INTERNAL-ERROR` on quantized MUL_MAT

**Boundary (raw).** For `type_a ∈ {q4_0,q4_1,q8_0,mxfp4,iq4_nl}`, `m=16 k=256 bs=[1,1]`: `n=1..4` OK (e.g. q4_0 n=1..4 headers `ops_mm_ph1.txt:73,81,89,97` with `OK` at `:80,88,96` and n=4 OK at `:105` — the INTERNAL-ERROR on `:104` is the *next* test's stderr). `n=5` is the first FAIL (`:106` q4_0, `compare_graph_backend_judge: ggml_backend_graph_compute failed`). Same cut for q4_1 (`:179` n=4 vs `:188` n=5), q8_0 (`:279` vs `:288`). Contrast: f16 `m=16 n=9` is `OK` (`:56`) — not a repack type.

36 `dsp-rsp: INTERNAL-ERROR` (`:104` … `:1883`). **All 36 sit on shapes with test-m % 32 ≠ 0 and test-n > 4.** Accounting against the judge's `Failing tests:` list (`:2533-2570`, 37 entries = 36 INTERNAL-ERROR + 1 Class B NaN):

- `m=16 n∈{5,6,7,8,9}` × five quants = 25 (`:2534-2558`)
- `m=16 n=16` × four quants (q4_0/q4_1/q8_0/mxfp4; iq4_nl is **not** in the list) = 4 (`:2560-2563`)
- `m=1 n=64` × five quants = 5 (`:2565-2569`)
- `q4_0 m=1 n=2048 k=8192` (`:2564`; stderr `:1801`, header `:1804`, `FAIL` `:1805`)
- `q8_0 m=6 n=4096 k=5120` (`:2570`; stderr `:1883`, header `:1886`)

f16 `m=1 n=64` is `OK` (`:1808`).

**Alleged counterexample q4_0 m=576,n=512,k=576 is NOT an INTERNAL-ERROR.** Header `:1794`. Verdict is `OK` at `:1803`. The INTERNAL-ERROR at `:1801` and `graph_compute failed` at `:1802` belong to the *next* test (`q4_0 m=1 n=2048 k=8192`, header `:1804`, `FAIL` `:1805`) — same stderr-before-verdict interleaving as n=4 OK `:105` vs n=5 INTERNAL-ERROR `:104`. Shape is absent from `Failing tests:` (`:2533-2570`). 576 % 32 = 0, so it is an aligned HMX-legal control that **passes**. AUDIT.md F1 / ARBITRATION F1-upheld misattributed the next test's stderr to this header.

**Host dispatch.** Default `opt_mm_select = 3` (`ggml-hexagon.cpp:66`) enables HMX. Eligibility (`:2158-2202`):

- `ne01_padded % 32 == 0` (`:2171-2174`) — **padded** N. This is the broken gate.
- `ne00 % 32 == 0` (`:2182-2184`) — K. `k=256` ok.
- `m = src1->ne[1]` (test n) `> HTP_MM_HMX_MIN_NROWS` (`:2196-2199`). `HTP_MM_HMX_MIN_NROWS` is 4 (`htp/matmul-ops.h:20`).

Padding (`ggml-hexagon.cpp:2577-2579`): `ne01_padded = is_repack ? hex_round_up(ne01, 32) : ne01`. The five failing types **are** the repack set (`:164-168`). So for `m=16`, host sees `ne01_padded=32`, the `% 32` check is tautological, and test-n=5 (`src1->ne[1]=5 > 4`) selects HMX (`:2588-2591`). Ineligible HMX falls through to HVX at `:2595-2596`.

Do **not** read the HVX skip as "test-n ≤ 4 → HVX" or "test-m ≤ 4 → HVX". The host variable `m` is `src1->ne[1]` = **test-n**, not test-m. Explicit traces:

- `m=16 n=4 k=256`: host m = 4 ≤ 4 → HMX skipped → HVX → OK (`:97/:105`).
- `m=16 n=5 k=256`: host m = 5 > 4 → HMX; DSP n = test-m = 16, 16%32≠0 → fail (`:106`).
- `m=1 n=64 k=256`: host m = src1->ne[1] = **64 > 4 → HMX selected, not skipped**. DSP n = src0->ne[1] = test-m = 1, 1%32≠0 → fail (q4_0 header `:1819`, INTERNAL-ERROR `:1826`, `graph_compute failed` `:1827`). Same for q4_1 (`:1829` FAIL on the header), q8_0 (`:1840`), mxfp4 (`:1851`), iq4_nl (`:1874`).

`supports_op` (`:2812-2881`) refuses only `src0->ne[0] % 32` (`:2830-2831`) and `src0->ne[1] > 32768` (`:2835-2836`). It does **not** refuse `src0->ne[1] % 32`. Then it calls the same precompute, so these shapes are admitted and dispatched to HMX.

Weights **are** physically padded: `repack_q4_0_tiled` uses `ne1_padded = hex_round_up(ne1, 32)` and writes 32-row tiles, padding rows with `memset(..., 8, 32)` and scale 0 (`:463-499`). Same for q4_1/q8_0/mxfp4/iq4_nl.

**DSP status path.** Only two `return HTP_STATUS_INTERNAL_ERR` in the DSP tree: `htp/matmul-ops.c:3044` (HMX matmul `ret != 0`) and `:3229` (MUL_MAT_ID `memalign` fail — not this class). Host maps it: `status_to_str` `HTP_STATUS_INTERNAL_ERR → "INTERNAL-ERROR"` (`ggml-hexagon.cpp:97-98`); `flush_pending` logs `dspcall : dsp-rsp: %s` and `error_count++` (`:1559-1561`); `graph_compute` returns `GGML_STATUS_FAILED` if `error_count != 0` (`:3685`).

`hmx_mm_op_matmul` passes **logical** `n = src0->ne[1]` (`matmul-ops.c:2978-2979`), not the padded 32. First line of `hmx_mm_2d_f32` (`:2327`):

```
if (k % 32 != 0 || n % 32 != 0) { return -1; }
```

Same contract at `:2596` (`hmx_mm_f16_f32_batched`) and `:2841` (`hmx_mm_id`). For test `m=16 n=5 k=256`: `k=256` ok, `n=16` **fails**. Same for `m=1` (DSP n=1) and `m=6` (DSP n=6). `return -1` → `:3042-3044` `HTP_STATUS_INTERNAL_ERR`. Later gates, **not** the Class A trigger: alignment `:2328`; VTCM overflow `:2369-2372` (`if (vtcm_used > vtcm_budget) { ... return -1; }`); DMA height `(n_cols / 32) * n_k_tiles` (`:2488`). VTCM overflow would also be `-1`/`INTERNAL-ERROR` (not `HTP_STATUS_VTCM_TOO_SMALL`). For m=576 these later gates do not fire — the shape is `OK` at `:1803`.

This is the old “contratto host/DSP rotto su m%32” (`ops/memory-backup-2026-08-27/adreno-moe-two-defects.md:216-218`), now with error propagation closed (`214ae986e`). #43’s “n=4..8 never n=1..3” is off by one: n=4 is HVX (host m ≤ 4) and PASSES on #46.

**No-regression for the host fix.** Any currently-passing HMX shape already satisfies the DSP's `src0->ne[1] % 32 == 0` check (`matmul-ops.c:2327/2596/2841`). Tightening the host gate from `ne01_padded % 32` to logical `src0->ne[1] % 32` therefore cannot regress a passing shape: a passing HMX op never had unaligned logical N.

**F12 (real-model shapes).** #47 execute-op lines **do** record tensor dims (`k:m x k:n`). All HMX `MUL_MAT` `src0->ne[1]` in both ppl logs are %32-aligned (0 unaligned). Cite: ship `ppl_ship_htp.dev.txt:26872` `2048:6144 x 2048:1024` (6144%32=0, `hmx-tiled`); OLMoE `ppl_olmoe_htp.dev.txt:20398` `2048:2048 x 2048:1024` (2048%32=0, `hmx-tiled`). Unique HMX src0 ne1: ship {512,2048,6144,10752}; olmoe {64,1024,2048}. Host fix is inert on these models.

**Verdict A: (b)** fixable host/DSP tiling contract, not a capability hole and not firmware-opaque. HMX hardware does need `n % 32 == 0`, but the tiled buffer already has that padding; the DSP just does not use it. HVX already computes the same types when host m ≤ 4. Do **not** `supports_op`-refuse the op (that would drop working HVX). Fix (host side implemented in this rev; DSP sketch not implemented):

1. Host: eligibility on **logical** `src0->ne[1] % 32 == 0` (not just `ne01_padded`). Unaligned logical N → existing HVX fallback at `:2595-2596`. Cheapest, already proven at n=1..4.
2. DSP (intended design, not done): `n = hex_round_up(src0->ne[1], 32)` into `hmx_mm_2d_f32`, keep `dst_cols = dst->ne[0]` so `transfer_output` clips. Host VTCM is already sized off `ne01_padded`.

Removing only the `:2327` check is not enough: DMA strides are `dst=aligned_tile_size, src=tile_size, width=tile_size` (`matmul-ops.c:2355-2357`) and height is `(n_cols / 32) * n_k_tiles` (`:2488`) → 0 for `n_cols=16`.

---

## Class B — one NaN, q4_0 `m=2880 n=32 k=2880` — OPEN

**Raw.** `ops_mm_ph1.txt:642`: `[MUL_MAT] NaN at index 305 (HTP0=nan CPU=-12.339559) ... type_a=q4_0 ... m=2880,n=32,k=2880`. Verdict `FAIL` at `:649`. Same geometry q8_0 header `:650`, `OK` at `:657`. mxfp4 same shape header `:658`, `OK` at `:659`. Judge reports the **first** nonfinite; later indices were not dumped.

This shape is HMX-legal: test n=32 `> 4`, test m=2880 `% 32 == 0`, k=2880 `% 32 == 0`. Kernel **runs** (no INTERNAL-ERROR). Pipeline off: `htp_mm_hmx_pipeline(m)` is `m > 32` (`matmul-ops.h:269-270`); HMX m = 32.

**k blocking.** HMX tile is 32, not 256. `2880 / 32 = 90` exactly — **no 32-wide k-tail**. `n_dot_tiles = k / 32 = 90` (`matmul-ops.c:2515`). `core_dot_chunk_fp16` (`hmx-mm-kernels-tiled.h:631-676`): if `n_dot_tiles <= 32` (k≤1024) one `HMX_LOAD_MPY_DEEP_F16`; else long path `n_loops = 90/32 = 2`, `rem = 90%32 = 26`, **one** `mxclracc.hf` then three deep loads into the same `.hf` acc (`hmx-utils.h:207-220`). q8_0 uses this exact path and PASSES — geometry/long-k is not generally broken. The `256×11.25` note is a red herring (`QK_Q8_0_TILED` is 128, `htp-ops.h:41`; unused on this HMX path).

**q4_0 vs q8_0 vs mxfp4.** Both q4_0 and q8_0 dequant to fp16 32×32 tiles then the same HMX dot. q4_0: nibbles + `d*(q-8)` (`hmx-mm-kernels-tiled.h:37-133`); scales at tile+512 (`:49`), tile 576 / aligned 640 (`matmul-ops.h:23,30`). q8_0: i8 unpack + scale at +1024 (`hmx-mm-kernels-tiled.h:442-443`); tile 1088 / aligned 1152 (`matmul-ops.h:25,32`). **Identical 64-valid + 64-pad load structure:** q4_0 `hvx_vmem(+512)` reads 512-639 = 64 B valid (512-575) + 64 B pad (576-639); q8_0 `hvx_vmem(+1024)` reads 1024-1151 = 64 B valid (1024-1087) + 64 B pad (1088-1151). 1024+128=1152 > 1088. mxfp4 (PASSES) **clamps** unpacked scale (`:340-345`: `vmax` 0 / `vmin` 30) before the same shuffle; q4_0/q8_0 do not. Init is `uniform[-1,1]` (`test-backend-ops.cpp:66,1527-1530`) so a coherent fp16 sum of 2880 terms is ≤2880 ≪ 65504.

Index 305 = ggml `i0=305, i1=0` = HMX `(row=0, col=305)` = col-tile 9, local col 17. Not a tile start (that would be 288). Matches **one output column** (one weight row), not a skipped k-block (which would smear many columns).

**OPEN — two candidate theories, neither established.** Do not promote either to primary.

1. **fp16 accumulation** (`hmx-mm-kernels-tiled.h:655-671`): long path keeps `.hf` acc across 90 tiles. **Disfavored:** the report's own bound (coherent sum ≤2880 ≪ 65504) plus q8_0 passing the same path. Worst-case same-sign 90×8192 overflow is astronomically unlikely under uniform[-1,1]. Discriminator on device: `k=1024` (short path).
2. **scale-pad load**: 128 B `hvx_vmem` over 64 B valid + 64 B uninit pad. **Undermined:** q8_0 has the identical 64-valid+64-pad structure yet PASSES, so "q4_0 reads pad, q8_0 doesn't" is arithmetically false (AUDIT.md F8: "all within the 1088-byte tile" is wrong). Open HVX question — settle **on device, not by argument**: does `Q6_V_lo_W(Q6_W_vshuff_VVR(v_sc, v_sc, -2))` (`:49` q4_0, `:443` q8_0) consume only the low 64 B (valid scales)? If yes, pad never influences either quant and this theory dies. mxfp4 clamp (`:340-345`) is real regardless. Discriminators: pad-zero after DMA; repeat B1 N times (uninit-pad predicts flakiness).

Not: k-tail skip (k%32==0), VTCM overrun (would be `:2369-2372` → INTERNAL-ERROR, and q8_0 would die), whole-row NaN activation (first index would be 0).

**Fix sketch (do not implement until a theory is established on device).** (i) In `core_dot_chunk_fp16` long path: `STORE_AFTER_F16` + fp32 add per 32-tile superblock. (ii) After DMA, zero `[tile_size, aligned_tile_size)` or load scales as 64 B. (iii) Keep HMX; do not `supports_op`-refuse 2880.

---

## Upstream

Remotes on this clone: only `origin = github.com/Aspis0/kalsallama.git`. **No `ggml-org/llama.cpp` remote / `upstream/master` ref. Did not fetch.**

Local hexagon history at this pin already has the tiled HMX rework that introduced the contract (`8be759e6f` #24954 “32x32 tiled weight repack”; `c9872a257` #23368; latest `matmul-ops.c` touch `81ff7abe5` #25425). Kalsa-only hexagon delta is `214ae986e` (judge diagnostics + `error_count` → `GGML_STATUS_FAILED`) — propagation, not tiling. Cannot claim llama.cpp master is ahead of these two paths without a fetched upstream ref.

---

## Next QDC cell

Kit `93e9592fa`, QRD8750/v79, `-o MUL_MAT` shape filter, `PLAIN_HOST=1`. No prereg here.

Class A %32 mechanism is diagnosed at the desk (36/36 INTERNAL-ERROR have test-m % 32 ≠ 0). Still put one aligned HMX control on the device so the host fix cannot silently break a passing large shape. Class B is OPEN: the cell is empirical discrimination, not confirmation of a chosen theory.

- A1: `q4_0 m=16 n=4 k=256` (expect OK, HVX).
- A2: `q4_0 m=16 n=5 k=256` (today INTERNAL-ERROR; after host fix expect OK via HVX).
- A4: `q4_0 m=576 n=512 k=576` (today OK at `:1803`; after host fix must stay HMX and stay OK — aligned large-shape control, **not** an INTERNAL-ERROR case).
- B1: `q4_0 m=2880 n=32 k=2880` (today NaN @305). Repeat N times if probing uninit-pad flakiness.
- B2: `q4_0 m=2880 n=32 k=1024` (short HMX k; long-acc probe — not THE discriminator).
- B3: `q8_0 m=2880 n=32 k=2880` (quant control, today OK).

---

## Revision log

- **rev-2 (2026-09-02).** Audit FIX (F1,F2,F7,F13) + orchestrator ARBITRATION. Disagreements quoted in FIXNOTES.md.
  - **F1 (disagree with audit 35/36):** kept 36/36 on test-m % 32 ≠ 0. q4_0 m=576 n=512 k=576 is `OK` at `ops_mm_ph1.txt:1803` and absent from `Failing tests:` `:2533-2570`. INTERNAL-ERROR `:1801` is the next test (`m=1 n=2048`). n=16 is 4/5 quants (iq4_nl missing). Cited later DSP gates (`matmul-ops.c:2328`, `:2369-2372`, `:2488`) as existing but not triggered on m=576.
  - **F2:** added explicit `m=1 n=64` dispatch (host m=64>4 → HMX; DSP n=1, 1%32≠0). Replaced "n≤4 → HVX" with host-m = test-n wording.
  - **F7 + ARBITRATION:** Class B rewritten OPEN; neither fp16-acc nor scale-pad established. Did **not** promote scale-load (AUDIT F8 arithmetic 1024+128=1152>1088). HVX `V_lo`/`vshuff -2` left as on-device question. mxfp4 clamp `:340-345` kept as real.
  - **F11:** added one-sentence no-regression proof (passing HMX already satisfies DSP `:2327/2596/2841`).
  - **F12:** verified. Dims present on #47 execute-op lines; all HMX src0 ne1 %32==0. Cite one line per model.
  - **F13 (partial disagree):** added A4 as aligned HMX *control* (today OK), not as INTERNAL-ERROR diagnostic. Class A %32 does not need a cell to diagnose; A4 is no-regression.
  - Host Class A fix implemented in kalsallama (see FIXNOTES.md).
