# q35 — classify 36 residual MUL_MAT FAILs after PLAIN_HOST

PC-only. Inputs: `results/htp_judge/xiaomi_v75_sentence/sentence_{A,B}.{out,err}`, baseline `xiaomi_v75_baseline/`, source `upstream-hexagon` @ `judge-exp1-plain-host` / `3f545be`.

PLAIN_HOST=1 (`sentence_B.out:333`): **34/70 pass, 36 FAIL**. All 36 are finite `ERR`, not NaN. `cpu-src0 nan_scales=0` (`sentence_B.err:273`). Same 36 already failed in baseline (hidden by CPU=NaN).

## 1. METRIC — ERR is NMSE, and 56–2572 is gross wrongness

**Established.**

`test_case::err` is `nmse` (`tests/test-backend-ops.cpp:1476-1477, 270-284`):

```
nmse(a,b) = mse(a,b) / mse(a,0)
          = Σ(a_i−b_i)² / Σ a_i²
```

Callback: `a = tensor_to_float(t1)` = **HTP**, `b = t2` = **CPU** (`eval` callback ~1732-1799). Denominator is HTP energy.

`test_mul_mat::max_nmse_err()` returns **`5e-4`** (`:4817-4818`). Log: `ERR = … > 0.000500000`.

| observed ERR | vs 5e-4 | meaning |
|---|---|---|
| 56–150 (34/36 cases) | **5.0e4 – 3.0e5 ×** threshold | RMS(HTP−CPU) ≫ RMS(HTP) |
| 1677 (`q8_0 m=6 n=4096 k=5120`) | **3.4e6 ×** | same |
| 2572 (`q4_0 m=1 n=2048 k=8192`) | **5.1e6 ×** | same |

Uncorrelated same-scale tensors give NMSE ~ O(1). These values are **not** precision/fast-math drift. They are “HTP output is not the matmul result”.

## 2. BOUNDARY — n≥5 is HMX dispatch; the 36 are HMX + `src0.ne[1] % 32 ≠ 0`

Naming: harness `n` = `src1->ne[1]` (activation rows). Harness `m` = `src0->ne[1]` (weight rows).

**Dispatch (established):**

`htp/matmul-ops.h:20`: `#define HTP_MM_HMX_MIN_NROWS 4`

`ggml-hexagon.cpp:2232-2236` (`ggml_hexagon_matmul_is_hmx_eligible`):

```
const int m = is_matmul_id ? ne12 : ne11;  // ne11 = src1->ne[1] = harness n
if (m <= HTP_MM_HMX_MIN_NROWS) return false;
```

So **n≤4 → not HMX**; **n>4 → HMX eligible** (plus K%32==0, weight type, not batched-quant). Default `opt_mm_select = 3` (`ggml-hexagon.cpp:73`, env `GGML_HEXAGON_MM_SELECT`) then `precompute_hmx_mm_params` sets `kernel_type = HTP_MM_KERNEL_HMX_2D` (`:2306-2309`). Log printer maps that to **`hmx-tiled`** (`htp-opnode.h:345-346`). HVX quant is `HTP_MM_KERNEL_HVX_QUANT_ROW` → **`hvx-tiled`**.

**Logs match 1:1:**

| harness n | path (`sentence_B.err`) | result |
|---|---|---|
| 1..4 (`256:16 x 256:n`) | `hvx-tiled` | OK |
| ≥5 same suite | `hmx-tiled` | FAIL + INTERNAL-ERROR |

Example: n=4 `err:220` `hvx-tiled` OK; n=5 `err:277` `hmx-tiled` then `err:284` `dsp-rsp: INTERNAL-ERROR`.

**The HMX kernel then rejects unaligned M:**

`htp/matmul-ops.c:2625` in `hmx_mm_2d_f32`:

```
if (k % 32 != 0 || n % 32 != 0) { return -1; }
```

Here `n` is **`src0->ne[1]`** = harness **`m`** (`hmx_mm_op_matmul` `:3332-3388` passes `m_total=src1->ne[1]`, `n=src0->ne[1]`).

Host eligibility **pads** M: `ne01_padded = hex_round_up(ne01, 32)` (`ggml-hexagon.cpp:2528-2529`, `hex_round_up` in `htp/hex-common.h:50-52`), then checks `ne01_padded % 32 == 0` (`:2207-2209`) — **always true for repack**. Kernel uses the **unpadded** `src0->ne[1]`. Contract mismatch.

Host on DSP error (`ggml-hexagon.cpp:1591-1594`):

```
if (rsp.status != HTP_STATUS_OK) {
    GGML_LOG_ERROR("... dsp-rsp: %s\n", status_to_str(rsp.status));
    // TODO: handle errors
}
```

**Swallowed.** Compute continues; `get-tensor out` still runs (`err:284-287`).

**36 `INTERNAL-ERROR` lines in `sentence_B.err` = 36 FAILs.** Zero `INTERNAL-ERROR` after the HMX ops that pass (`2880:32` `err:2789`, `576:512` `err:5482`).

All 36 FAILs have `m ∈ {1,6,16}` (`m % 32 ≠ 0`). All HMX **passes** in the 70-set have `m % 32 == 0`:

- `m=2880 n=32 k=2880` q4_0/q8_0/mxfp4 (`sentence_B.out:52-54`) `hmx-tiled`
- `m=576 n=512 k=576` q4_0 (`out:325`) `hmx-tiled`

iq4_nl has no n=16 case because `IQ4_NL` is not in `base_types[]` (`test-backend-ops.cpp:8593-8602`); n=16 extras come from `base_types` loop (`:9539`).

No permutations/broadcast in the 36: every FAIL is `bs=[1,1], nr=[1,1], per=[0,1,2,3], k_v=0, o=1, src_overlap=0`. Quantized MUL_MAT with `src1->ne[2]!=1` is **not supported** (`ggml-hexagon.cpp:2810-2811`) — those tests are skipped, not this set.

## 3. HTP vs REFERENCE — HTP did not compute; leftover dst vs good CPU

**Established: HTP side is wrong (no kernel result). CPU reference is not implicated.**

- PLAIN_HOST=1: `cpu-src0 nan_scales=0` (`err:273`). Same CPU backend that **passes** n=1..4 on identical `m=16 k=256` construction (`test_mul_mat::build_graph` `:4889-4910`: contiguous `a=(k,m)`, `b=(k,n)`, no view, no permute).
- HMX with `m%32==0` **passes** the same `ggml_mul_mat` + PLAIN_HOST path at n=32 and n=512. CPU for large n is fine.
- n=5 FAIL: DSP `INTERNAL-ERROR` **before** any HMX store (`hmx_mm_2d_f32` returns −1 at the first check). `out` is not the matmul.
- `test_mul_mat` uses default `initialize_tensors` which `init_tensor_uniform`s **every** tensor including `out` (`:1502-1504`). After a swallowed INTERNAL-ERROR, HTP `out` is still that U[−1,1] fill. NMSE compares leftover fill to CPU matmul → O(50–10³), not 1e-7.

Hypothesis (not needed to classify): leftover energy ~⅓ (U[−1,1]), CPU energy grows with K → larger NMSE on the two big-K cases. Not proven from dumps (no per-element print on the ERR path).

## 4. OUTLIERS — same class, not HMX saturation

**Established same class:** both outliers are `hmx-tiled` + `INTERNAL-ERROR` (`err:5539+5546` for n=2048; `err:5923+5930` for n=4096). Kernel never ran. Cannot be accumulator saturation / HMX overflow.

`q4_0 m=1 n=2048 k=8192` (`:9625`) and `q8_0 m=6 n=4096 k=5120` (`:9630`) are just larger leftover-vs-CPU NMSE. `m=1 n=64 k=256` (same m=1 family) is ERR=96, also INTERNAL-ERROR (`err:5603+5610`).

## 5. UPSTREAM — no post-3f545be master fix; known unaligned-M HMX class exists off-master

Fetched `origin/master` 2026-08-23: still only `70adb1b4` (`common: json.h: fix clang lto`) after `3f545be`. **Nothing on master** touching hexagon MUL_MAT / HMX / test-backend-ops allocation.

Related, **not in this pin / not on current master**:

| item | relevance |
|---|---|
| `56c4d3e` “hexagon: split unaligned-M HMX matmul into HMX+HVX phases” (2026-03-18) | **same bug**: HMX on 32-aligned M head, HVX tail; “when M≤32 and not 32-aligned, fall back entirely to HVX”. `merge-base --is-ancestor` vs `3f545be` and `origin/master`: **not present**. |
| Issue #24365 (HMX rework #23368 garbage tokens on v81) | HMX quant matmul class; generation, not test-backend-ops n=5. Closed. |
| Issue #24201 (ubatch≥32 garbled logits) | token-axis 32; n≤3 tests passing. Different threshold (32 vs 5). |

PR #21018’s pasted `iq4_nl` n=5..9 OK is **not** this tree (those cases INTERNAL-ERROR here).

## 6. NEXT EXPERIMENT — force HVX for one n=8 case

Cheapest discriminator (**~1 min on-device**, no rebuild): skip HMX so n=8 uses the HVX path that already passes n=4.

```
# Xiaomi, existing judge binary + PLAIN_HOST=1
export GGML_TEST_PLAIN_HOST=1
export GGML_HEXAGON_MM_SELECT=2    # 2 = Tiled HVX, no HMX (ggml-hexagon.cpp:73,4444)
# or: export GGML_HEXAGON_NHMX=0
./test-backend-ops-judge test -b HTP0 -o MUL_MAT \
  -p 'type_a=q4_0,type_b=f32,m=16,n=8,k=256,bs=\[1,1\]'
```

| result | conclusion |
|---|---|
| **OK** + log `hvx-tiled`, no INTERNAL-ERROR | residual class is HMX dispatch/contract only; HVX is fine for n>4. Workaround: MM_SELECT=2 or eligibility `src0->ne[1]%32==0` (unpadded). |
| still FAIL | something else (re-open). Unlikely given 36/36 INTERNAL-ERROR. |

Dumping tensors is **not** needed first: DSP already said INTERNAL-ERROR and host ignored it. A dump would only show leftover `out` vs CPU.

Do not start with an HMX kernel rewrite. The kernel refused to run.

## Verdict (for Luna)

| claim | status |
|---|---|
| ERR = NMSE(HTP, CPU) / energy(HTP); 56–2572 is 1e5–1e6× the 5e-4 cap | **established** (`:270-284`, `:4817`) |
| n≥5 because `ne11 > HTP_MM_HMX_MIN_NROWS` (4) selects `HTP_MM_KERNEL_HMX_2D` | **established** (source + `hvx-tiled` vs `hmx-tiled` logs) |
| 36 FAILs = 36 `dsp-rsp: INTERNAL-ERROR`; HMX kernel `n%32` is harness **m** | **established** (`matmul-ops.c:2625`, `err` 36 hits) |
| Host pads M for eligibility, kernel uses unpadded M; error swallowed (`TODO`) | **established** |
| CPU/PLAIN_HOST reference is the bad side for n≥5 | **refuted** (n≤4 same CPU passes; aligned-M HMX passes; DSP error) |
| n=2048/4096 overflow/saturation | **refuted** (same INTERNAL-ERROR, kernel never ran) |
| Post-3f545be master fix | **none** |
| Next: `GGML_HEXAGON_MM_SELECT=2` on one n=8 | proposed |

## Hostile audit (Luna) — BANK-with-corrections

Core diagnosis CONFIRMED; corrections applied to the record:

1. Checkout is `dbf3f009` (two test-only commits after `3f545be`; Hexagon sources
   unchanged). Pin-valid line refs: nmse `tests/test-backend-ops.cpp:270-284`,
   `test_mul_mat::max_nmse_err:4487-4489` (not 4817), default init `1196-1199`.
2. Dispatch is conditional, not solely n>4: HMX also requires HMX enabled,
   `MM_SELECT >= 3`, valid type/layout/K, successful param precompute
   (`ggml-hexagon.cpp:2232-2238`, `2537-2546`).
3. Host does NOT resize the tensor: it computes `ne01_padded = round_up(src0->
   ne[1],32)` for eligibility/planning only (`2527-2529`); DSP receives the
   original `src0->ne[1]`.
4. All 36 sentence-B failures reconcile EXACTLY: 25x (m=16, n=5..9, 5 types),
   4x (m=16, n=16), 6x (m=1, n=64 5 types + m=1 n=2048), 1x (m=6, n=4096).
   Every one is hmx-tiled with m%32!=0 and exactly one INTERNAL-ERROR line;
   `sentence_B.err` has exactly 36 such lines.
5. Kernel check exact: `matmul-ops.c:2625` `if (k % 32 != 0 || n % 32 != 0)`
   with local n = src0->ne[1] (`3332-3335`, call site `3385-3387`); DSP converts
   to `HTP_STATUS_INTERNAL_ERR` (`3397-3401`). Host swallow: `ggml-hexagon.cpp:
   1591-1594`. Untouched-output story strongly consistent (exact bytes not dumped).
6. Both knobs exist at this pin: `MM_SELECT=2` disables the HMX tier (`2538`)
   keeping HVX tiled (`2680`); `NHMX=0` disables HMX (`4393-4444`, `3504-3505`).
   Proposed experiment valid.
7. "Production robustness bug" is sound as a status-propagation defect, but
   production inference hitting these artificial m=1/6/16 shapes is NOT
   established.

**Audited citable:** In this pin, repacked quantized MUL_MAT cases with
activation rows `src1->ne[1] > 4` enter HMX; host eligibility uses padded
`src0->ne[1]`, while DSP `hmx_mm_2d_f32` rejects the original unaligned
`src0->ne[1]`, returns INTERNAL-ERROR, and the host logs but ignores it —
the compared output is the untouched random fill.
