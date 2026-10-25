# Hostile audit: option 3 / Amendment H

Scope: `git diff ee3dfde49..2459a9d1d` on `feat/governor-onecopy-q6raw`, exactly the three requested commits. Read the commit messages and Amendment H, including the H4 correction. No files other than this report were written. No build, test, simulator, or device run was performed.

## Ranked findings

### 1. P1 — Qwen3.5's raw Q6_K head is admitted to the scalar converter — CONFIRMED

The host gate accepts Q6_K at any `opt_mm_select` when K is a Q6_K multiple and the activation row count is at most 32. The offload candidate is then explicitly enabled for that raw Q6_K matmul:

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2449` `} else if (src->type == GGML_TYPE_Q6_K) {`
>
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2450` `if (src->ne[0] % QK_K || act->ne[1] > 32) {`
>
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:8137` `const bool mm_flat = opt_mm_select == 1 || ggml_hexagon_has_raw_q6_K_mm(op);`
>
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:8138` `return htp_admit_offload(admission, op, mm_flat, htp_admit_src1_is_weight(op)) &&`

The admitted job converts every quant element with nested scalar loops. There is no HVX vector path or Qwen-specific limit in this implementation:

> `ggml/src/ggml-hexagon/htp/q6_K-raw-tile.h:37` `const int n_in_group = (int) (n_rows < 32 ? n_rows : 32);`
>
> `ggml/src/ggml-hexagon/htp/q6_K-raw-tile.h:43` `for (int lk = 0; lk < 32; lk++) {`
>
> `ggml/src/ggml-hexagon/htp/q6_K-raw-tile.h:44` `const uint8_t q6 = q6_K_get_quant(b, kt_local * 32 + lk);`
>
> `ggml/src/ggml-hexagon/htp/q6_K-raw-tile.h:47` `lo_pl[(g >> 1) * 128 + pos] |= (uint8_t) ((q6 & 0xF) << ((g & 1) * 4));`
>
> `ggml/src/ggml-hexagon/htp/q6_K-raw-tile.h:48` `hi_pl[(g >> 2) * 128 + pos] |= (uint8_t) ((q6 >> 4) << ((g & 3) * 2));`

The design explicitly says this is not an acceptable Qwen fallback:

> `FABLE-DESIGN.md:676` `there the scalar conversion is not acceptable and the HVX version is the plan, not the fallback.`

Failure scenario: in shared mode, Qwen3.5-4B has a raw `token_embd` head of K=2560 and 248320 output rows. K passes the new gate; a decode activation with at most 32 rows passes the other limit; the offload clause admits it at the default `opt_mm_select` too. Since 248320 is 7760 groups of 32 and K has 80 32-wide tiles, the converter executes 7760 x 80 x 32 x 32 = **635,699,200 scalar quant-element iterations per invocation**, while scattering the 521 MB head. This is precisely the model/shape the design said must wait for the HVX converter. The source-level admission is certain; the exact latency is unmeasured.

### 2. P1 — The unaligned 2-D DMA assumption remains an unverified correctness risk — PLAUSIBLE

The Q6_K path submits raw rows with 1680-byte LFM2 rows or 2100-byte Qwen rows, using the tensor row stride as source stride and the raw row size as destination stride:

> `ggml/src/ggml-hexagon/htp/matmul-ops.c:269` `// one block_q6_K spans 8 k-tiles: a raw row is (n_k / 8) * 210 B, e.g. 1680 B at K 2048`
>
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:270` `const size_t row_size = (n_k / 8) * sizeof(block_q6_K);`
>
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:271` `dma_queue_push(q, dma_make_data(dst, (const uint8_t *) src0->data + ct * 32 * src0->nb[1]), row_size, src0->nb[1], row_size,`
>
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:272` `hvx_mm_raw_group_rows(src0, ct));`

On the v73 16-bit descriptor path, these row sizes and strides fit the direct 2-D fast path. That path writes the descriptor fields as supplied; it contains no alignment check or fixup:

> `ggml/src/ggml-hexagon/htp/dma-queue.h:380` `// Fast path: everything fits in 16 bits`
>
> `ggml/src/ggml-hexagon/htp/dma-queue.h:382` `nrows      <= DMA_MAX_NROWS &&`
>
> `ggml/src/ggml-hexagon/htp/dma-queue.h:383` `row_size   <= DMA_MAX_SIZE_16B &&`
>
> `ggml/src/ggml-hexagon/htp/dma-queue.h:384` `src_stride <= DMA_MAX_STRIDE_16B &&`
>
> `ggml/src/ggml-hexagon/htp/dma-queue.h:385` `dst_stride <= DMA_MAX_STRIDE_16B, 1)) {`
>
> `ggml/src/ggml-hexagon/htp/dma-queue.h:386` `return dma_ring_push_single_2d(q->ring0, ddata, dst_stride, src_stride, row_size, nrows);`
>
> `ggml/src/ggml-hexagon/htp/dma-queue.h:243` `desc->src_stride     = src_stride;`
>
> `ggml/src/ggml-hexagon/htp/dma-queue.h:244` `desc->dst_stride     = dst_stride;`
>
> `ggml/src/ggml-hexagon/htp/dma-queue.h:247` `desc->row_size       = row_size;`

The relevant strides are not 128-byte multiples: 1680 % 128 = 16 and 2100 % 128 = 52. The host test only converts already resident rows and compares tile bytes; it cannot establish DMA row-address semantics:

> `tests/test-hexagon-q6_K-raw-tile.c:60` `// stride 896 here; the DSP passes the same value (HTP_MM_WEIGHT_ALIGNED_TILE_SIZE_Q6_K)`
>
> `tests/test-hexagon-q6_K-raw-tile.c:61` `q6_K_raw_rows_to_tiles(got, TILE_SIZE, rows, n_k, n_rows);`
>
> `tests/test-hexagon-q6_K-raw-tile.c:62` `repack_q6_K_tiled_slice(want, rows, K, n_rows, TILE_SIZE);`
>
> `tests/test-hexagon-q6_K-raw-tile.c:63` `const int bytes_equal = memcmp(got, want, TILE_SIZE * n_k) == 0;`

The specification itself requires the S23 one-row probe before timing:

> `FABLE-DESIGN.md:667` `DMA: raw Q6_K rows are 1680 B (LFM2) / 2100 B (Qwen), NOT 128-aligned, unlike Q4_0's 1152 B; the 2-D DMA`
>
> `FABLE-DESIGN.md:668` `stride must be checked on the S23 with a one-row probe before any timing (the 09/30 audit's stride hypothesis).`

Failure scenario: if this DMA engine requires aligned row starts/strides for the chosen 2-D descriptor, the HTP can fault or copy incorrect bytes into the raw slot and produce wrong logits. The source code does not prove that hardware restriction exists, so this is a risk, not a confirmed DMA bug. The S23 probe is still a hard acceptance gate.

## Other requested angles checked

- **Host packer extraction:** the old `q6_K_get_quant` and inner packing loop at `ee3dfde49:ggml/src/ggml-hexagon/ggml-hexagon.cpp:1283-1353` match `htp/q6_K-tiled-pack.h:16-30,49-74` line-for-line in behavior. The wrapper still iterates `(i3,i2)` slices and calls the extracted helper. Low/high planes, `kt_local * 2 + sub`, fp16 rounding, and zero padding are consistent between the production packer and raw converter (`q6_K-tiled-pack.h:64-73`, `q6_K-raw-tile.h:35-52`).
- **`n_k % 8`:** the converter documents the superblock invariant (`q6_K-raw-tile.h:10-13`); both host admission and DSP `op_matmul` require `ne0 % QK_K == 0` (`ggml-hexagon.cpp:2449-2451`, `matmul-ops.c:3940-3947`). For valid Q6_K tensors, `n_k = ne0/32` is therefore a multiple of eight.
- **Slot fit and prefetch:** for up to 32 rows, raw Q6_K bytes are `32 * (n_k/8) * 210 = 840*n_k`; converted tiles occupy `896*n_k`. Thus raw data fits the same slot for every valid K, including LFM2 (53760 <= 57344) and Qwen (67200 <= 71680). The last prefetch slot remains the converted-tile buffer, and each raw job reserves it as before (`matmul-ops.c:369-381,389-392`). Partial final groups are capped by `hvx_mm_raw_group_rows` and the converter zeroes each tile before writing valid rows (`matmul-ops.c:252-255`, `q6_K-raw-tile.h:35-38`).
- **Q4_0 and non-raw paths:** `hvx_mm_push_slot` and `hvx_mm_slot_to_tiles` dispatch the Q4 raw case to the same existing helpers and leave the non-raw path on the original tile DMA (`matmul-ops.c:287-310`). The new `RAW_TILES` value is zero and is used by every repacked instantiation (`matmul-ops.c:283-285,331-333`). The op guard continues to reject raw HMX, batched raw forms, dimension mismatch, and unsupported raw types (`matmul-ops.c:3936-3948`). No behavior change found for those paths.
- **HMX and TILE32:** HMX eligibility declines only when `ggml_hexagon_is_raw_weight(src0)` is true (`ggml-hexagon.cpp:4845-4849`). TILE32 Q4_0 explicitly sets `GGML_HEXAGON_TENSOR_REPACK` (`ggml-hexagon.cpp:2199-2203`), so the new predicate does not remove HMX eligibility from shared-mode TILE32 matmuls. Ordinary repacked/two-copy weights also carry that flag (`ggml-hexagon.cpp:1852-1856`). No non-raw regression found.
- **Offload scope / non-HOST Q6_K:** the new candidate is limited to `MUL_MAT` with raw Q6_K in src0 (`ggml-hexagon.cpp:2462-2465`); `offload_op` then calls `supports_op`, whose full raw gate runs before dispatch (`ggml-hexagon.cpp:8137-8139,7915-7918`). This does not admit unrelated ops or bypass shape checks. A repacked non-HOST Q6_K weight is not raw and remains on the ordinary repacked job. No unintended two-copy change found.
- **Test:** it does compare the converter against the production `repack_q6_K_tiled_slice`, then independently compares decoded tile values with `dequantize_row_q6_K` (`tests/test-hexagon-q6_K-raw-tile.c:60-80`). Its `{32,13,1}` row cases exercise full and partial single groups, including odd counts; K cases are valid multiples of 256 (`:88-97`). The source has no environment mutation. The hand-build recipe is self-contained relative to the repository root (`:3-8`). It does not prove DMA or HTP job wiring, as noted in finding 2.
- **Removed `opt_mm_select == 1` behavior:** Q4 raw remains gated by `opt_mm_select == 1` (`ggml-hexagon.cpp:2445-2447`); raw Q6_K is the only new per-op exception, and the HMX refusal is itself raw-weight-only (`:2449-2451,4845-4849`). No lost non-raw or global HMX behavior found.
- **H4 correction:** I used the corrected H4 statement; this diff does not establish that Qwen's GDN is CPU-only. No H4-related finding.
- **Dead code / simplification:** no additional behavior-affecting dead code found. The shared `q6_K_get_quant` helper is used by both production packer and DSP converter.

## Verdict

**Do not accept the Qwen path as shipped: it violates the explicit scalar-conversion fence; keep the unaligned DMA path unproven until the required S23 probe passes.**
