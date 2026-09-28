# onecopy-hmx-estimate — analysis and paper estimate

Question: can the one-copy NPU path (raw GGUF Q4_0 in the shared `-HOST` rpcmem buffer) regain the HMX
prefill speed it forfeits today (37.3 vs 1782 tok/s on the 8 Elite), and why is CPU decode over rpcmem
35 % slower? Analysis only: no device, no adb, no engine writes. Engine tree read:
`/Users/marco/Projects/kalsallama-onecopy`, branch `spike/hexagon-onecopy-rawq4`, commit `c939a135d`.
Inputs: `../qdc-8elite-onecopy-cost/REPORT.md` (measured 8 Elite numbers), `../hexagon-onecopy-rawq4/REPORT.md`
(raw-path design and S23 evidence), `../hexagon-offload-op/REPORT.md` (allocation flags, S23 rpcmem
decode, probe). Every number cites its source; anything I computed is **(derived)**, anything guessed is
**(estimate)**. Model: LFM2.5-2.6B-QAD-Q4_0 (SHA `a247afd6…`), 31 layers (qdc report "offloaded 31/31").

## A. HMX on raw weights

### A.1 What HMX actually consumes (from source)

HMX never touches quantized bytes. For every quantized `MUL_MAT` the two-copy HMX path runs a three-stage
in-VTCM pipeline (`hmx_mm_2d_f32`, `htp/matmul-ops.c:2544-2723`):

1. **DMA** DDR → VTCM of *repacked 576 B tiles* (32 rows × 32 cols: 512 quant B + 32 fp16 scales,
   `htp/matmul-ops.h:23`), landed in 640 B-aligned rows (`:35`), double-buffered
   (`matmul-ops.c:2678-2686`, push of chunk `A_{i+2}` at `:2712-2716`).
2. **HVX dequantize** tiles → *tile-major fp16*, 1024 fp16 per 32×32 tile
   (`dequantize_tiled_weight_chunk_to_fp16_tiles`, `matmul-ops.c:2262-2289`; the Q4_0 task reads
   `tile_src + 512` for scales and 4×128 B quant vectors, `htp/hmx-mm-kernels-tiled.h:37-60`), threaded
   over all HVX threads.
3. **HMX MMA** on the fp16 tiles only (`hmx_matmul_job_init` with VTCM pointers, `matmul-ops.c:2719-2723`;
   the batched entry takes `(const __fp16 *) src0->data`, `:3633`).

So "HMX tile format" = **tile-major fp16 in VTCM**, derived on the fly from the 576 B repacked tile. The
raw-weight converter the one-copy path added (`q4_0_raw_rows_to_tiles`, `htp/q4_0-raw-tile.h:13-42`)
already produces exactly that intermediate 576 B tile, byte-identical to the host repack
(onecopy-rawq4 REPORT:22-25).

### A.2 Where raw weights are refused on HMX

Two layers, both deliberate:

- **Host**: `ggml_hexagon_raw_weights_supported` (`ggml-hexagon.cpp:2176-2188`) admits a raw Q4_0 src0
  for `MUL_MAT` only when `opt_mm_select == 1` (flat). The default ladder is `3 = HMX → Tiled → Flat → CPU`
  (`ggml-hexagon.cpp:102`), so with defaults a raw weight is declined host-side and the matmul goes to the
  CPU. Raw weights are also kept out of NX fusion (`:5857`) and every repack-expecting fusion (`:5889`).
- **DSP**: `op_matmul` returns `HTP_STATUS_NO_SUPPORT` when `htp_mm_has_raw_weight && (… || kparams->n_hmx || …)`
  (`htp/matmul-ops.c:3690`); the fused variants refuse raw outright (`:4046,4166,4260`).

### A.3 Can the VTCM conversion target HMX? Yes — two ways

- **Two-stage (correctness first)**: keep the existing pieces. The DMA push becomes the raw-row 2-D push
  the flat path already uses (`hvx_mm_push_raw_q4_0`, `matmul-ops.c:344-348`); the popped slot is
  converted by the existing scalar `q4_0_raw_rows_to_tiles` into the slot region; the *unchanged*
  `dequantize_tiled_weight_chunk_to_fp16_tiles` then reads from there. Sizing works: raw rows for nc
  columns are nc × k × 0.5625 B = 0.9× the tiled DMA payload (576 B real vs 640 B aligned per tile,
  **derived**), so the existing `vtcm_weight_raw` regions hold them.
- **Fused (the real fix)**: extend the Q4_0 dequant task to read raw 18 B blocks directly (packed-group
  VTCM layout as above) and write fp16 tiles, eliminating the 576 B intermediate entirely. Same output,
  one stage, same pipeline slot. This is the shape to ship: the pipelined loop serialises
  pop → dequant → submit, so *adding* a serial conversion stage eats the slack that hides the dequant;
  fusing does not.

### A.4 Paper estimate of the conversion cost per prefill

Weight bytes (Q4_0 = 18 B / 32 el = 0.5625 B/el; shapes from DESIGN.md §2.3 / qdc logs; **derived**;
1 MiB = 2^20 B):

| tensor (per layer) | shape | MiB |
|---|---|---:|
| ffn_gate + ffn_up | 2 × 10752×2048 | 23.63 |
| ffn_down | 2048×10752 | 11.81 |
| conv in_proj | 6144×2048 | 6.75 |
| conv out_proj, attn_q, attn_o | 3 × 2048×2048 | 6.75 |
| attn_k, attn_v | 2 × 512×2048 | 1.13 |
| **total × 31 layers** | | **≈ 1552 MiB** |

(The logged two-copy `HTP0` buffer is 1525.87 MiB, qdc REPORT:71 — same ballpark, the difference is
non-Q4_0 tensors and padding.)

- **HMX compute envelope**: 512 tokens at 1782 tok/s = 287 ms per prefill pass (qdc REPORT:38). The model
  is 2.435 G MAC/token (DESIGN.md §2.3) → 1.25 T MAC per pass ≈ 8.7 TMAC/s sustained including all
  overheads (**derived**).
- **DMA demand**: per pass the HMX path streams all k=2048 weights once (≈ 1186 MiB) and `ffn_down`
  re-streams per m-chunk: the solver (`htp_mm_hmx_solve_2d_params`, `htp/matmul-ops.h:722-776`, cost
  weights `:49-50`) picks m_chunk as large as VTCM allows; my arithmetic for k=10752/n=2048 against the
  8 MiB budget gives m_chunk ≈ 96–128 → 4–6 weight passes (**estimate**, solver walk on paper). Total
  streamed ≈ 2.6–3.4 GiB per 287 ms pass → **9–12 GB/s DDR read already sustained by the DMA ring in
  the measured a-hmx run** (**derived**). Raw rows are 0.9× those bytes (**derived**) — DMA is not the
  binding constraint and actually improves slightly.
- **Dequant rate already proven**: the tile→fp16 stage moves the same 2.6–3.4 GiB of weight bytes (576 B
  in → 2048 B fp16 out) inside the 287 ms while feeding HMX — i.e. the shipped pipeline already sustains
  ~9–12 GB/s of weight-element conversion (**derived**). That is the bar a raw reader must meet to stay
  hidden; it is the *same stage, same budget*, only the input layout changes.
- **The scalar converter is 20–80× too slow** (**derived**): the measured flat-path penalty is
  512/37.3 − 512/57.8 = 4.87 s per pass over ≈ 1186 MiB converted (ffn_down runs on the CPU in both flat
  arms, qdc REPORT:39-40) → ≈ 240 MB/s effective on the 8 Elite; the S23 shows 1024/17.49 − 1024/20.78
  = 9.27 s over the same weights → ≈ 125 MB/s (offload-op REPORT:241-244). This is why one-copy flat is
  0.645× two-copy flat. A vectorised reader is mandatory for HMX; "vectorising the flat converter cannot
  close a 48× gap" (qdc REPORT:88) is about the dot kernel, not this stage.

**Verdict A**: hideable, with the fused reader. The conversion rides the stage that already runs at the
required rate; the risks are (a) the raw input pattern (32 strided 18 B rows per tile vs one contiguous
576 B tile — HVX loads need 128 B alignment, solved by landing packed groups via the 2-D DMA the flat
path uses, then a `vshuff`-style nibble transpose) and (b) losing NX fusion (gate/up, q/k/v; raw is
refused, `ggml-hexagon.cpp:5857`). Fusion saves activation re-reads (~2 MB vs ~50 MB of weight traffic
per layer, **derived**) → small, single-digit % (**estimate**). Expected one-copy HMX prefill:
**≈ 0.5–0.9 × a-hmx ≈ 900–1600 tok/s** (**estimate**), the low end if the raw reader only reaches half
the current stage rate (it then becomes the cap: 1186 MiB at ~5 GB/s ≈ 550 ms → ~930 tok/s, **derived**),
the high end if it matches it. Every point of that band beats the CPU arm (216 tok/s, qdc REPORT:42).

### A.5 Amortisation across the ubatch — already how it works

- Flat (today's one-copy): the weight-group loop (`ct`, `matmul-ops.c:431`) is *outside* the token loop
  (`ir1`, `:440-471`); each thread converts its groups once per matmul call, i.e. once per ubatch, and
  all tokens of the ubatch reuse them. Confirmed in source.
- HMX: the m-loop (`matmul-ops.c:2653`) re-streams and re-dequantizes all weights per m-chunk; with the
  solver's chunking the big k=2048 matmuls convert once (or twice) per 512-token ubatch and `ffn_down`
  4–6× (same as today's two-copy HMX — not a one-copy regression). At decode (m=1) every weight is
  converted once per token; that is the known S0/S10 question, unchanged by this analysis.

## B. The −35 % CPU decode on rpcmem

### B.1 How `-HOST` is allocated and mapped (source)

- `rpcmem_alloc2(RPCMEM_HEAP_ID_SYSTEM, RPCMEM_DEFAULT_FLAGS, size)` (`ggml-hexagon.cpp:547-552`); heap
  25 = non-contiguous system memory, flags = `ION_FLAG_CACHED` (SDK `rpcmem.h:47-53,71-90`). The `-HOST`
  variant can force `RPCMEM_FLAG_UNCACHED` (`ggml-hexagon.cpp:2075`), off by default.
- The class adds a 4 KiB-aligned size plus a 4 KiB guard page (`:638-643`).
- Mapping to the DSP is `fastrpc_mmap(domain, fd, va, …, FASTRPC_MAP_FD_DELAYED)` for non-pinned buffers
  (`:579-588`); the fd-based API takes a dma-buf, not arbitrary process memory (SDK `remote.h:1572`,
  flags `:1008-1035`).
- Nothing on the host side chooses the *CPU* mapping attribute or page size: the CPU va comes from
  rpcmem's mmap of the ion/dma-buf fd, which the ion system heap backs with order-0 **4 KiB pages**.
  A normal CPU buffer (the 34.6 tok/s arm) is malloc'd anonymous memory, THP-eligible (2 MiB pages).

### B.2 The measured shape of the problem

| device | arm | tok/s | implied weight-read rate |
|---|---|---:|---:|
| 8 Elite | d-cpu-nr (normal CPU buffer) | 34.6 | 48.6 GB/s |
| 8 Elite | d-host (rpcmem `-HOST`) | 22.6 | 31.7 GB/s |
| S23 | CPU `--no-repack` | 14.07 | 19.6 GB/s |
| S23 | one-copy rpcmem | 9.47 | 13.2 GB/s |

(tok/s from qdc REPORT:59-63 and offload-op REPORT:233; rates **derived** assuming every Q4_0 matmul
weight ≈ 1.36 GiB is read once per decode token, batch 1, same generic kernel in both arms.) The ratio
is stable across two SoCs (0.65 / 0.67) and across kernels — a memory-system property, not a kernel one.

### B.3 Most likely cause (ranked)

1. **Page size / TLB**: 1.36 GiB swept sequentially per token at 4 KiB granularity = ~356 K pages per
   sweep vs ~700 with 2 MiB THP. A ~35 % read-rate loss at ~30–50 GB/s demand is the right order for
   page-walk/TLB pressure on a cacheable mapping (**estimate; the probe decides**). The 1.5× loss an
   uncached mapping would give is far larger, and the flags say cached — so *effective* cacheability is
   unlikely to be the cause, but it is not directly observable in `/proc/self/smaps`.
2. **Page locality**: ion system-heap order-0 pages vs buddy-allocated THP — worse DRAM row locality
   (weaker; indistinguishable from 1 by smaps, partially by GB/s).
3. Heap/flag misuse: ruled out as *requested* (heap 25 + cached, verified above and in offload-op
   REPORT:218-233). The contiguous heap is dead on arrival: < 8 MiB total and deprecated after v73
   (SDK `rpcmem.h:77-83`), so "different heap" is not a fix path.

### B.4 What `hexagon-rpcmem-bench` will discriminate (never run)

The binary (built for the S23, SHA `7a6fe525…`, offload-op REPORT:448-449) compares a 256 MiB
`posix_memalign` buffer vs a 256 MiB rpcmem allocation over 7 sequential-read passes and prints: median
GB/s for both, the rpcmem fd, `/proc/self/smaps` page-size/THP fields for both mappings, and whether
`MADV_HUGEPAGE` was accepted on the malloc. It therefore decides:

- **Is there a read-bandwidth gap at all, and its size** (expect ≈0.65× if it explains decode);
- **KernelPageSize/MMUPageSize 4 K vs 2 M per mapping** — confirms/denies the THP explanation directly;
- **AnonHugePages** on the malloc side — whether the normal buffer is actually THP-backed on this kernel;
- **MADV_HUGEPAGE acceptance** — whether THP can be forced at all;
- It does **not** decide: effective cacheability (smaps cannot show it), write behaviour, or DSP-side
  effects.

Command (as recorded in offload-op REPORT:473; S23 serial per AGENTS.md):

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'cd /data/local/tmp/govhtp && LD_LIBRARY_PATH=/vendor/lib64:/data/local/tmp/govhtp/lib ./bin/hexagon-rpcmem-bench 268435456 7 > /data/local/tmp/govhtp/rpcmem-bandwidth.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/rpcmem-bandwidth.log'
```

For the 8 Elite the same invocation runs after pushing an arm64-v8a build (the existing artifact is
S23-built; the QDC device is reached through its own session harness, qdc REPORT:6-8).

### B.5 Cheapest fix candidates, each with its test

1. **`madvise(MADV_HUGEPAGE)` on the rpcmem mapping** after allocation (engine: one call in
   `ggml_hexagon_shared_buffer::alloc`). Expected to be refused for dma-buf (**estimate**) — but it is a
   two-line probe variant, and if accepted and GB/s recovers, it is the whole fix. Test: probe variant +
   d-host llama-bench tg128.
2. **dma_heap-backed buffer instead of rpcmem** (`/dev/dma_heap/system` fd passed to the same
   `fastrpc_mmap`): same fd-based API (`remote.h:1572`), still 4 K pages — only worth trying if the probe
   shows the gap is *not* page size but something ion-specific (e.g. attribute). Test: probe variant.
   Note "normal malloc + register with fastrpc" is **not** available: `fastrpc_mmap` is fd-based and
   cannot wrap existing anonymous THP pages (SDK `remote.h:1572`; also the reason the OpenCL backend has
   no host path, onecopy-rawq4 REPORT:167-172).
3. **`RPCMEM_FLAG_UNCACHED`** exists as `GGML_HEXAGON_HOSTBUF_UNCACHED` (`ggml-hexagon.cpp:2075`) — for
   *reads* it should only get slower; useful only as a discriminator that the cached path really is cached.
4. **Structural dodge (product-level)**: if the gap is inherent to dma-buf, stop sweeping rpcmem at
   decode — either the NPU decode lane (S0/S10 timing of the raw matvec, DESIGN.md §1.4/§6) or the
   two-context fallback. One-copy's value then rests on A, not on CPU decode.

## C. Verdict table

| path | prefill tok/s (512) | decode tok/s (tg128) | status | cheapest confirming experiment |
|---|---:|---:|---|---|
| two-copy HMX (today, a-hmx) | **1782** (measured) | 38.3 (repack CPU, measured) | ships | — |
| one-copy flat HVX (today, b) | **37.3** (measured) | **22.6** (measured) | not shippable on HMX SoCs | — |
| one-copy, two-stage raw→tile→fp16 HMX (§A.3) | ~200–600 (**estimate**: scalar converter caps it, §A.4) | 22.6 | correctness stepping stone only | KLD arms P0/Q0 after lifting the two refusals behind an env |
| one-copy, **fused** raw→fp16 HMX reader (§A.3) | **900–1600 (estimate)** | 22.6 | the fix worth building | patch the dequant task + raw-stride DMA push; `llama-bench pp512` on the QRD8750; KLD P0 vs Q0 |
| + NX fusion re-enabled for raw weights | +~5 % (estimate, §A.4) | — | second order | count fusion events in the same log |
| decode: madvise/dma_heap variant (§B.5) | — | 22.6 → ≤34.6 if pages are the cause (**estimate**) | pending probe | probe first, then the two-line engine variant |
| decode: NPU lane (S10) | — | unknown until the raw matvec is timed | structural | S0 timing arm (DESIGN.md §6) |

## Experiments (cheapest-first, no adb run here)

1. `hexagon-rpcmem-bench` on the S23 (command in §B.4) — decides the decode mechanism; ~1 min.
2. Paper-verified two-stage HMX raw path behind an env (`GGML_HEXAGON_RAW_HMX=1` style): lift
   `ggml-hexagon.cpp:2176-2188`'s `mm_select==1` condition and `matmul-ops.c:3690`'s `n_hmx` clause for
   Q4_0; reuse `hvx_mm_push_raw_q4_0` + `q4_0_raw_rows_to_tiles` + the unchanged dequant. Numerics via
   P0 vs Q0 KLD on the S23/v79; timing expected poor but it proves correctness of the chain.
3. Fused raw→fp16 dequant task (HVX, packed-group input) + `llama-bench -p 512 -ub 512` on the QRD8750
   vs a-hmx — the number that decides one-copy's fate on HMX SoCs.
4. `madvise`/dma_heap probe variants (§B.5.1/2) if experiment 1 points at pages/attribute.

## Caveats

- No HMX peak-throughput number exists in the lab; all HMX-side rates here are derived from the measured
  1782 tok/s envelope, and the v79 VTCM budget is assumed 8 MiB like v73 (**estimate**).
- m_chunk/n_chunk values are my walk of the solver on paper (§A.4), not logged values; the amortisation
  conclusion (once per matmul per m-chunk) holds for any chunking.
- The fusion-loss bound (single-digit %) is an order-of-magnitude argument from traffic ratios, not a
  measurement; the 8 Elite KLD of a-hmx was never measured either (qdc REPORT:30).
- The S23 v73 "no HMX" statement (qdc REPORT:3) conflicts with `hmx 1` in the S23 `npu-proof.log`
  (DESIGN.md §7.3); nothing here depends on S23 HMX.
