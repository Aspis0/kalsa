# Hostile audit: `ceb89bedc` — raw-row matvec audit fixes + device-gap probes

**Subject:** `ceb89bedc` "hexagon: raw-row matvec audit fixes (F16/strided activations, K<256, VTCM
sizing, quantize once) and device-gap probes", on top of `974a31e79` (prev audit:
`AUDIT-RAWROW-974a31e79.md`).
**Method:** static read of `git show ceb89bedc` in full, plus the surrounding code as it stands at
`ceb89bedc` (host precompute/admission, DSP matvec macro, layout builder, copy helpers, DMA helpers,
loader probe path, sim harnesses). **I built nothing, ran nothing, changed nothing.** The reported
`run-raw-mv.sh EXIT=0` and the 15.51/22.41 tok/s numbers are the coordinator's / device agent's.

**Bottom line:** the four P1/P2 audit fixes are real and correct — the host/DSP admission contract
now matches exactly, and the rewritten activation arrangement is mathematically sound (I tried to
break it and could not; proof in Angle 1). I found **no defect that corrupts or crashes the default
path**. What I did find is that **three of the five probe arms do not measure what their names
claim**, one of them (`RAW_LOCAL`) is a provable no-op in the one-copy recipe, and the new *default*
activation `l2fetch` is a behaviour change relative to the 15.51 tok/s baseline the ABBA will be
compared against.

---

## Answers first

### (a) Is `ceb89bedc` safe to run on the S23 for the ABBA probe session?

**YES for arms `GGML_HEXAGON_RAWROW_PROBE=1|2|4` and `GGML_HEXAGON_HOSTBUF_UNCACHED=1`, subject to
five gates. NO — drop `GGML_HEXAGON_RAW_LOCAL=1`: it cannot change anything in this recipe (F1), and
if it ever did it would move Q4_0 embedding reads to the CPU (F1b).**

Blocking items, in order:

1. **Push the new DSP `.so` together with the new host lib, and gate on the new profile tag.** A
   host/DSP version skew is a *hard op failure*, not a fallback: an old `.so` receiving
   `kernel_type = HTP_MM_KERNEL_HVX_RAW_ROW` returns `HTP_STATUS_NO_SUPPORT`, the host latches
   `last_error`, and every later `get_tensor_async` `GGML_ABORT`s (F5). Minimum check per arm: the
   profile must print the kernel tag **`hvx-rawrow`** (`htp-opnode.h:332`, new in this commit). If it
   prints `hvx-tiled` or `hvx-flat`, the arm is measuring something else (F2).
2. **Log the probe value.** `opt_rawrow_probe` and `opt_raw_local` are parsed with `atoi` and are
   **never printed anywhere** (F7). `GGML_HEXAGON_RAWROW_PROBE=1,2` silently becomes `1`.
   `GGML_HEXAGON_RAWROW_PROBE=-1` becomes *all three bits*. Either add a `GGML_LOG_INFO` (I am not
   allowed to patch) or record the literal env string in the run log and grep the profile tag per arm.
3. **Arm 1 (`SKIP_DOT`) only with a fixed token count and no correctness claim.** The output tensor
   receives *stale VTCM*, which can be Inf/NaN, not merely "garbage" (F6). Use `-n 128` as in the
   existing recipe; never run KLD/perplexity in that arm.
4. **Do not combine `RAW_LOCAL` with `HOSTBUF_UNCACHED`** — the uncached flag only applies to HOST
   allocations (`RPCMEM_FLAG_UNCACHED`), so the two arms would differ in two variables at once (F1c).
5. **Expect the arm-0 (probe-off) number to differ from 15.51.** The activation `l2fetch` is **on by
   default** in this commit and did not exist in `974a31e79` (F3). Arm 0 of the new session is a new
   configuration; the 15.51 baseline is not its control. `PROBE=4` is the arm that recovers the
   old behaviour.

No blocking correctness item for the *default* path. If the coordinator only wants one thing fixed
before the session, it is item 1 (tag gate) — it is what turns "the number moved" into "the number
means something".

### (b) Which probe arm do I expect to explain most of the 15.5 vs 22.4 tok/s gap, and why?

**`GGML_HEXAGON_RAWROW_PROBE=2` (REUSE_SLOTS: no weight DMA after the first `n_prefetch` groups, dot
unchanged, same VTCM slots).** Reasoning, all from the code:

1. **The two arms move the same number of weight bytes.** A 32×32 Q4_0 tile is 576 B and 32 raw
   Q4_0 blocks of one row are 32 × 18 = 576 B — the tiled layout is a pure permutation with the same
   size. Per token both arms read the whole Q4_0 weight set once. So the 2.2× gap **cannot be a
   volume effect**; it is a *rate* effect (where those bytes come from and how they are fetched) or a
   *kernel* effect.
2. **The raw dot is not obviously 2.2× the tiled dot per element.** Per 7-block window (224
   elements) it issues 1 unaligned load, 2 mask/shift, 2 `vrmpyacc`, 1 `vdelta`, 1 half×half, 1
   qf32 mul and 1 qf32 add — i.e. one *scale pair* per 7 blocks instead of the tiled dot's one
   `vmpy` + scale per 32×32 tile. That is the same order of work per element, not 2.2×. The
   activation arrangement is also inside the same 54.7 ms/token and is 84 group quantizations
   (cheap, `quantize_128_f32_q8_0` on 128 floats each).
3. **There is a concrete fetch-side asymmetry in the DMA, and it lands exactly on the big matvecs.**
   The raw push uses the tensor's own row stride:
   `dma_make_ptr(dst, ... + ct * 32 * src0->nb[1]), row_size, src0->nb[1], row_size, ...` with
   `row_size = n_k * 18` (`matmul-ops.c:347-349`). For K = 10752 (n_k = 336) that stride is
   6048 B ≡ **32 (mod 128)** — not 128-byte aligned, for any n_k that is not a multiple of 64. The
   tiled push's stride is `n_k * 576`, which is *always* a multiple of 128. The three ffn matvecs are
   38.6 of the 54.7 ms/token, and they are exactly the ones with the unaligned stride.
4. ⇒ Prediction: **arm 2 recovers most of the gap** (15.5 → somewhere near 22 if the fetch path is
   the whole story, or at least well past 15.5 with a residual if the dot costs something too).
   The falsifier is arm 1: if `PROBE=1` (dot removed, DMA kept) lands near 22 instead of near 15.5,
   then the *dot* is the cost and my prediction is wrong.
5. **`RAW_LOCAL` would have been the cleanest test of exactly this hypothesis and it cannot run**
   (F1). Arm 2 is therefore the only working discriminator between "fetch path" and "kernel".

Caveat that belongs in the write-up: none of these three arms is a single-variable ablation. Arm 1
also removes the dot's VTCM read traffic (so the DMAs get faster — arm 1 *over*-states the dot cost);
arm 2 also removes the DMA engine's contention with the dot (arm 2 *over*-states the fetch cost).
The deltas do not add up to the gap and must not be presented as if they did.

---

## Ranked findings

### F1 — `GGML_HEXAGON_RAW_LOCAL=1` cannot move a one-copy Q4_0 matmul weight into the device buffer: the arm is a no-op. **CONFIRMED**

`opt_raw_local`'s *only* effect in the entire tree is to drop the REPACK flag:

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:1749:        if (ggml_hexagon_is_repack_type(tensor->type) && !(opt_raw_local && tensor->type == GGML_TYPE_Q4_0)) {`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:1872:        if (ggml_hexagon_is_repack_type(tensor->type) && !(opt_raw_local && tensor->type == GGML_TYPE_Q4_0)) {`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:105:static bool   opt_raw_local  = false; // GGML_HEXAGON_RAW_LOCAL: keep Q4_0 weights raw in the DEVICE buffer too (diagnosis: the raw-row kernel on a DSP-local copy)`

But in the one-copy recipe the Q4_0 matmul weights never get a *device* buffer in the first place.
The loader probes candidate buffer types with the weight's own op, and the hexagon device refuses
the probe for exactly these tensors:

> `src/llama-model-loader.cpp:1054-1056:    w->buffer = ggml_backend_buft_alloc_buffer(buft, 0);`
> `                                                        bool op_supported = ggml_backend_dev_supports_op(dev, op_tensor);`
> `src/llama-model-loader.cpp:1211-1218:        } else {`
> `                                                op = info.op;`

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2265-2273:static bool ggml_hexagon_raw_onecopy_diverts_weight(const struct ggml_tensor * op) {`
> `    if (!opt_hostbuf || !opt_raw_hmx || op->op != GGML_OP_MUL_MAT) {`
> `        return false;`
> `    }`
> `    const struct ggml_tensor * w = op->src[0] ? (op->src[0]->view_src ? op->src[0]->view_src : op->src[0]) : nullptr;`
> `    return w && w->buffer && !w->extra && ggml_backend_buffer_is_hexagon(w->buffer) &&`
> `        !ggml_backend_buffer_is_hexagon_host(w->buffer) &&`
> `        w->type == GGML_TYPE_Q4_0 && w->ne[0] % QK4_0 == 0;`
> `}`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:6823:    if (!ggml_hexagon_raw_weights_supported(op) || ggml_hexagon_raw_onecopy_diverts_weight(op)) {`

That predicate does **not** consult `opt_raw_local`. With `HOSTBUF=1 RAW_HMX=1` (the probe recipe) it
is true for every Q4_0 matmul weight during the device-buffer probe (`w->buffer` = the freshly
allocated device buffer, `w->extra == nullptr`, op == MUL_MAT from `info.op`), so
`supports_op` returns false, `select_weight_buft` skips `HTP0:0`, and the weight lands in the host
buffer — with or without `RAW_LOCAL=1`.

**Failure scenario (not a crash — worse):** the coordinator runs `RAW_HMX=1 HOSTBUF=1 RAW_LOCAL=1`,
gets 15.5 tok/s, and concludes "DSP-local DDR does not help, the gap is compute". The arm measured
the baseline configuration. Two ABBA arms and a wrong conclusion.

**F1b (REFUTED for the S23 model, PLAUSIBLE in general).** If `RAW_LOCAL` *were* effective, every
Q4_0 tensor in a WEIGHTS buffer would go raw, and any op that is not `MUL_MAT` on `src[0]` is
refused outright —

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2240-2243:    for (int i = 0; i < GGML_MAX_SRC; i++) {`
> `        const struct ggml_tensor * src = op->src[i];`
> `        if (!src || !ggml_hexagon_is_raw_weight(src)) {`
> `            continue;`
> `        }`
> `        const bool hmx_sized = op->src[1] && (int64_t) op->src[1]->ne[1] > HTP_MM_HMX_MIN_NROWS;`
> `        if (op->op != GGML_OP_MUL_MAT || i != 0 || src->type != GGML_TYPE_Q4_0 || src->ne[0] % QK4_0 ||`

so a Q4_0 `token_embd` would be stored raw and its `GET_ROWS` would fall back to the CPU, which for a
150 MB tensor means a full read-back per token (or an OOM). **Not triggered by the S23 model**: the
tied embedding is Q6_K (`q6_K 2048x128000` in the report), and `RAW_LOCAL` only touches Q4_0.

**F1c.** `GGML_HEXAGON_HOSTBUF_UNCACHED` is pre-existing and applies only to the HOST allocation
(`ggml-hexagon.cpp:2080: const uint32_t flags = opt_hostbuf_uncached ? RPCMEM_FLAG_UNCACHED : RPCMEM_DEFAULT_FLAGS;`).
Combined with `RAW_LOCAL` in one arm, the two knobs would touch different buffers and the arm would
differ from the baseline in two variables.

### F2 — The probe silently no-ops if the VTCM budget forces the flat fallback, and `pipeline` keeps the probe bits on that path. **CONFIRMED**

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4589-4591:                    const bool raw_row = src1_nrows == 1 && ne10 >= HTP_MM_RAW_MV_MIN_K && ggml_hexagon_is_raw_weight(src0);`
> `                    kparams->kernel_type = raw_row ? HTP_MM_KERNEL_HVX_RAW_ROW : HTP_MM_KERNEL_HVX_QUANT_BLOCK;`
> `                    kparams->pipeline    = raw_row ? opt_rawrow_probe : 0;`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4628-4631:            // Flat HVX fallback`
> `            {`
> `                kparams->src1_row_size = (wtype == GGML_TYPE_Q4_1 || wtype == GGML_TYPE_Q4_K) ? htp_mm_q8_1_tiled_row_size(ne10) : htp_mm_q8_0_tiled_row_size(ne10);`
> `                kparams->kernel_type = HTP_MM_KERNEL_HVX_QUANT_ROW_FLAT;`

`kparams->pipeline` is set **before** the VTCM budget test and is **not reset** on the flat
fallback. Two consequences:

* Today it is harmless: the flat matvec is `RAW_Q4_0 == 1`, so the macro's
  `probe = RAW_Q4_0 == 2 ? (uint32_t) kparams->pipeline : 0` reads 0, and the flat quantizer never
  looks at `pipeline`. So it is a landmine, not a live bug (low severity).
* **The probe becoming a silent no-op is live and matters for the session.** If
  `L.total_bytes > vtcm_budget` the host quietly switches that matvec to `QUANT_ROW_FLAT`, which *is*
  admitted for raw weights, so the op still offloads — with no probe. All four arms would then
  measure the flat kernel and report "no difference". The defence already exists in this commit (the
  `hvx-rawrow` tag, `htp-opnode.h:332`), so **gate every arm on it**. At K = 10752, n_k = 336,
  n_threads = 4, the RAW_ROW layout is ≈ 6.95 MB (F4), so `n_prefetch` lands at 8 on an 8 MB VTCM;
  at a larger K it degrades further and a fallback becomes plausible.

### F3 — The new default `l2fetch` is 16 KB-granular with a 16 KB stride: it over-fetches ~2.5×, reaches past the tensor, and is a behaviour change against the 15.51 baseline. **CONFIRMED**

> `ggml/src/ggml-hexagon/htp/matmul-ops.c:793-799:    if (!(kparams->pipeline & HTP_MM_RAW_ROW_PROBE_NO_L2FETCH)) {`
> `        // the task's whole slice of the activations, in one request (the quantizer would wait on each group in turn)`
> `        const uint32_t ne0 = mmctx->act->ne[0];`
> `        const uint32_t first = mmctx->quant_ib_first[ith] * HTP_MM_RAW_MV_WINDOW_BLOCKS * 32;`
> `        const uint32_t last  = MIN(mmctx->quant_ib_last[ith] * HTP_MM_RAW_MV_WINDOW_BLOCKS * 32, ne0);`
> `        hex_l2fetch_block((const float *) mmctx->act->data + first, (last - first) * sizeof(float));`
> `    }`

> `ggml/src/ggml-hexagon/htp/hex-utils.h:33-36:static inline void hex_l2fetch_block(const void * addr, size_t size) {`
> `    if (size == 0) return;`
> `    const uint32_t width = 16384; // 16KB rows`
> `    const uint32_t height = (size + width - 1) / width;`
> `    hex_l2fetch(addr, width, width, height);`

So a "slice" of 10 752 B becomes a **16 384 B** request starting at the slice's first byte:

* **Overlap, not exact slices.** At K = 10752 the four tasks request
  `[0,16K) [10.7K,26.7K) [21.5K,37.5K) [32.3K,48.4K)` — 2.5× the activation bytes requested, mostly
  hitting in L2, so the cost is l2fetch request/latency work and L2 pressure, not 2.5× DRAM.
* **Past the end.** The last task's request ends 5632 B beyond the 43 008 B activation tensor.
  `Q6_l2fetch` is a non-faulting prefetch, so this is not a crash — and the codebase already relies
  on that (`hex_l2fetch_block(ctx, ctx->footprint)`), so I rate it low severity. But it is a claim
  in a comment that is not true, and the over-fetch is *proportional on small matvecs*: a K = 256
  matvec (shortconv) is one window, one quant task, 4 KB of activations — and the code asks for 16 KB
  of whatever follows it in the buffer, on every layer of every token, evicting weight lines the dot
  is about to read.
* **The declared invariant is also inexact in the other direction:** the arrangement's last group can
  read up to 127 floats past `last` (`b_hi` is not a multiple of 4, so the last group's tail sticks
  out of the fetched range). Harmless (the load misses and fetches normally) but the comment says
  "the task's whole slice".
* **Interpretation of arm 4.** `PROBE=4` therefore measures *"16 KB-granular, 2.5×-overlapping
  l2fetch"* vs *"no l2fetch"*, not *"prefetch my slice"* vs *"no prefetch"*. If arm 4 is **faster**
  than arm 0, the conclusion is that *this implementation* of the prefetch is a pessimisation (L2
  pollution), not that prefetching is useless.
* **Arm 0 is not the 974a31e79 baseline.** The arrangement had no `l2fetch` before this commit.

### F4 — The RAW_ROW layout reserves the *repacked tile* slot size (640 B per 32-block k-tile) for slots that carry 18 B per block: 35.6× over-reserved, and it caps `n_prefetch` at 8. **CONFIRMED** (waste, not a defect)

> `ggml/src/ggml-hexagon/htp/matmul-ops.h:635-641:            case HTP_MM_KERNEL_HVX_RAW_ROW: {`
> `                // a group's raw rows (18 bytes per block) sit in the slot its tiles would take; the activations`
> `                // are the arranged windows, and the per-thread scratch holds one 128-float group to quantize`
> `                const uint32_t n_k = ne10 / 32;`
> `                const size_t slot_size = htp_mm_round_up(n_prefetch * n_k * htp_mm_get_weight_aligned_tile_size(wtype), 256);`
> `                src0_sz = slot_size * n_threads;`
> `                src1_sz = htp_mm_round_up(htp_mm_raw_mv_act_bytes(n_k), 256);`

`htp_mm_get_weight_aligned_tile_size(HTP_TYPE_Q4_0)` is `HTP_MM_WEIGHT_ALIGNED_TILE_SIZE_Q4_0 = 640`
(`matmul-ops.h:46`) — the *tile* size. The raw row a slot actually carries is
`n_k * 18` (`matmul-ops.c:347: const size_t row_size = n_k * sizeof(block_q4_0);`). At n_k = 336,
n_prefetch = 8, n_threads = 4 the RAW_ROW kernel reserves **6.88 MB of src0 VTCM to carry 194 KB of
weights**; the whole layout is ≈ 6.95 MB of the S23's 8 MB VTCM. A right-sized slot
(`round_up(n_prefetch * n_k * 18, 256)`) would make the total ≈ 0.26 MB and let the host's prefetch
search (`max_prefetch = 16` for a one-row matvec, `ggml-hexagon.cpp:4602`) reach 16.

* **REFUTED as a cause of the tok/s gap:** the two-copy (QUANT_BLOCK) layout reserves the same
  640-based slots (`matmul-ops.h:573-579`), so the prefetch cap is not a one-copy-vs-two-copy
  differential. It is absolute VTCM waste, and a prefetch-depth lever for a follow-up.
* **The sim enshrines it instead of testing it** — the new layout check asserts *equality* with the
  QUANT_BLOCK layout, so a 3× or 35× over-reservation passes:
  > `tests/hexagon-sim/raw-mv-edge-sim.c:        const int bad = raw.src1_bytes != need || raw.src0_bytes != block.src0_bytes ||`
* No overflow: the cumulative `VTCM_LAYOUT_ALLOC` (`htp-vtcm.h:13: (off) += (sz);`, no rounding) is
  safe here because src0_sz and src1_sz are 256-multiples and dst_sz is a 128-multiple, which keeps
  the 128-byte alignment that `hvx_vmem`, `hvx_copy_f32_au`'s `assert((unsigned long) dst % 128 == 0)`
  and `raw_mv_load_window`'s `HVX_Vector *` cast require. Verified.

### F5 — Host/DSP version skew is a hard failure, not a fallback. **CONFIRMED**

> `ggml/src/ggml-hexagon/htp/matmul-ops.c:3833-3837:        const bool kernel_ok = htp_mm_raw_kernel_admitted(kparams->kernel_type, a->ne[1] * a->ne[2] * a->ne[3], a->ne[0]);`
> `        if (w->type != HTP_TYPE_Q4_0 || !kernel_ok || !htp_mm_raw_act_admitted(a->type == HTP_TYPE_F32, a->nb[0]) ||`
> `            w->ne[0] % QK4_0 || w->ne[0] != a->ne[0]) {`
> `            return HTP_STATUS_NO_SUPPORT;`
> `        }`

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:3409-3415:        if (rsp.status > HTP_STATUS_OK) {`
> `            GGML_LOG_ERROR("ggml-hex: %s dspcall : dsp-rsp %s\n", this->c_name.c_str(), status_to_str(rsp.status));`
> `            this->last_error = rsp.status;`

`HTP_MM_KERNEL_HVX_RAW_ROW` is a **new enum value** appended to the host/DSP message. A `.so` from
`974a31e79` receiving it falls into its own `default:` and then `htp_mm_raw_kernel_admitted(8, …) ==
false` → `HTP_STATUS_NO_SUPPORT` → `last_error` latched → every subsequent
`ggml_backend_hexagon_get_tensor_async` hits `GGML_ABORT` (`ggml-hexagon.cpp:6122-6126`) and
`graph_compute` returns `GGML_STATUS_FAILED` (`6026-6028`). The enum append is the right wire choice
(an old reader cannot misinterpret it), but the failure mode is a hard abort, not a slow path.

**Scenario:** the host lib is updated but the pushed `.so` is stale (or vice versa) → the run aborts
after the first decode matvec with `dsp-rsp NO-SUPPORT`. The `hvx-rawrow` tag is the cheapest
positive proof that the new `.so` is live.

### F6 — Arm 1 (`SKIP_DOT`) writes stale VTCM into the output, which can be Inf/NaN, not "garbage". **CONFIRMED**

> `ggml/src/ggml-hexagon/htp/matmul-ops.h:108:#define HTP_MM_RAW_ROW_PROBE_SKIP_DOT    1  // DMA + activation arrangement only: the dot is skipped, the result is garbage`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:589-591:        if (!(probe & HTP_MM_RAW_ROW_PROBE_SKIP_DOT)) {`
> `            DOT_2X1(ne10, dst_ptr, w_tile, src1_col, valid_rows, NULL);`
> `        }`

The trailing output copy is unconditional:

> `ggml/src/ggml-hexagon/htp/matmul-ops.c:...:            hvx_copy_f32_ua((uint8_t *) &dst_col[src0_start_row], (uint8_t *) tmp, copy_cnt);`

`tmp` is never written in this arm, so the logits become whatever the previous op left in that VTCM
slice — a finite number in the simulator (zeros), an arbitrary bit pattern on device. A NaN in the
logits changes sampling (argmax over NaN) and can make the repetition/penalty bookkeeping degenerate.
**No crash risk** (the destination is a correctly sized tensor). Mitigation: fixed `-n`, no KLD or
perplexity in that arm, and treat the tok/s as the only output. The comment's "the result is
garbage" is directionally right but understates it; "the output is whatever was in VTCM" would be
the accurate invariant.

### F7 — Env parsing: `atoi`, no validation, **no log line anywhere**. **CONFIRMED**

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:7468-7469:    opt_raw_local      = str_raw_local ? atoi(str_raw_local) != 0 : false;`
> `    opt_rawrow_probe   = str_rawrow_probe ? atoi(str_rawrow_probe) : 0;`

* Read **once**, in `ggml_hexagon_init` — correct, no per-op `getenv`.
* `atoi` accepts `"1,2"` → 1, `"2 "` → 2, `"-1"` → −1 → `kparams->pipeline = -1` → the DSP's
  `(uint32_t) kparams->pipeline` = `0xFFFFFFFF` → **all three probe bits at once**. Values beyond
  `INT_MAX` are `atoi` overflow = UB. The immediately neighbouring option uses the careful form:
  `ggml-hexagon.cpp:7470-7473: if (str_min_batch) { char * end = nullptr; errno = 0; ...`.
* **No `GGML_LOG_*` for either variable** (contrast `ggml-hexagon.cpp:2081: HEX_VERBOSE("ggml-hex:
  HOST RPCMEM allocation flags=%u uncached=%u\n", flags, opt_hostbuf_uncached);`). For an ABBA
  experiment whose whole output is a set of tok/s numbers, *an arm that silently runs the wrong bit
  pattern is indistinguishable from an arm that shows no effect*. This is the single most likely way
  this session produces a wrong conclusion.
* No masking either: `opt_rawrow_probe` is stored verbatim. A future kernel that uses `pipeline` as
  a count would see 3.

### F8 — Production derives the window count from a byte size; every test derives it from `raw_mv_n_windows`. **CONFIRMED (structural, no current defect)**

> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1673:            const uint32_t n_win = (uint32_t) (htp_mm_raw_mv_act_bytes(ne10 / 32) / HTP_MM_RAW_MV_ACT_WINDOW_BYTES);`

against `tests/hexagon-sim/raw-mv-sim.c:127:    const int k = n_k * 32, n_win = (int) raw_mv_n_windows(n_k);`
and the same in `raw-mv-edge-sim.c`. They agree today because the helper is exactly
`ceil(n_k/7) * 512`. But the production expression is a *derived* count: if the byte helper ever
gained alignment padding (e.g. rounding to 256 for DMA), the integer division would silently shrink
`n_win`, the arrangement would cover fewer windows than `q4_0_raw_mv_32x1` reads, and the dot would
consume **stale VTCM windows** — wrong results, no assert, no test failure. `raw_mv_n_windows(n_k)`
is one line away and is what the geometry header exists for.

### F9 — `b_hi == 0` unsigned underflow in the group loop; the header's preconditions omit `w_last > w_first`. **PLAUSIBLE (unreachable today)**

> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:...:    const uint32_t b_hi = MIN(w_last * RAW_MV_WINDOW_BLOCKS, n_k);`
> `    ...`
> `    for (uint32_t g = b_lo / 4; g <= (b_hi - 1) / 4; g++) {`

With `w_last == 0` (or `n_k == 0`) `b_hi == 0` and `(0u - 1) / 4 == 0x3FFFFFFF` → an ~1-billion-iteration
loop on the DSP. Today the partition is provably non-empty
(`floor(n_win*(i+1)/m) - floor(n_win*i/m) ≥ floor(n_win/m) ≥ 1` with `n_quant_tasks = MIN(n_win, n_threads)
≤ n_win`), and `n_k ≥ 8` is enforced by admission, so this is unreachable. The function's comment
lists `ne0 % 32 == 0, ne0 >= HTP_MM_RAW_MV_MIN_K` but not `w_last > w_first` — a free parameter with
an unstated precondition that is a hang rather than an error.

### F10 — Comment / invariant rot. **CONFIRMED** (five places, all cheap)

1. `int32_t  pipeline;           // 1 = pipelined execution, 0 = standard` (`matmul-ops.h:88`) — now
   also carries a 3-bit probe protocol for RAW_ROW. The only thing keeping the two apart is the
   comment at `matmul-ops.h:106-107` ("HVX kernels have no other use for that field"), which nothing
   enforces.
2. `ggml-hexagon.cpp:2216-2219` still says the precompute "picks the tiled (or … the flat) HVX
   matvec; the DSP reads the raw rows directly in the tiled case". RAW_ROW is now its own kernel type
   and its own profile tag.
3. `matmul-ops.h:636-637` — "a group's raw rows (18 bytes per block) sit in the slot its tiles would
   take" reads as if the slot were row-sized; the reservation is 640 B per k-tile (F4).
4. `matmul-ops.c:795` — "the task's whole slice … in one request" (F3).
5. `q4_0-raw-mv-act.h:45-49` — "each 128-float group is quantized once per call" is **false** at a
   task boundary: a group straddling `b_lo` is quantized by both tasks (the sim's own bound is
   `groups ≤ quants ≤ groups + n_tasks - 1`, and `check_quantize_once` asserts exactly that). The
   correct invariant is "once per call, plus at most one duplicate per task boundary". The
   commit-message figure "84 instead of 120 at K 10752 over 4 tasks" is the *favourable* case only —
   at n_k = 336, `7 * 12 = 84` is a multiple of 4, so **no** group straddles; at n_k = 9 it does
   (4 quantizations for 3 groups). Accurate as stated, but it should not be read as the general case.
6. `run-raw-mv.sh` control 8 writes `tests/hexagon-sim/.prefix/` **into the source tree** (removed by
   an `EXIT` trap, so it survives an interrupt as untracked git noise).

Also worth stating *positively*: the geometry comment
(`q4_0-raw-mv-geometry.h:40-42`, "The last window is pulled back … it overlaps the one before it; the
blocks it shares are counted once (their activations are zero here)") is still **accurate** for the
new arrangement — I checked, and the sharded placement and the old per-window placement put the same
block at the same (window, offset) for every window, so the "shared" weight blocks carry zero
activations in the last window exactly as documented. The *load-bearing* invariant, which neither
comment states and which the new code is the first to be able to break, is: **for every window `w`
and offset `j`, the activation data at `(w, j)` must be the same 32 elements as the weight nibbles
the kernel reads at byte phase `18j + 2` of that window's raw vector.** Add it.

### F11 — `supported_mul_mat` now refuses F16 activations for *every* quantized weight. **CONFIRMED (correct, but a silent narrowing)**

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:5135-5137:            if (src1->type != GGML_TYPE_F32) {`
> `                return false;  // the DSP quantizers read the activations as float, F16 would be read as garbage`
> `            }`

This is the right fix for the previous audit's P1-1 and it is now unreachable-but-load-bearing only
for the F16/F32 `src0` branches (the earlier `src1->type != GGML_TYPE_F32 && != GGML_TYPE_F16` at
5115 remains needed for them). Consequences worth knowing: the F16-activation hole is fixed for the
HVX tiled/flat/block/row kernels *and* the HMX path in one place, and any graph that feeds a
quantized matmul with F16 activations now silently runs it on the CPU with **no log line**. For the
S23 decode graph the activations are F32, so the measured configuration is unaffected.

### F12 — The restored `K < 256` QUANT_BLOCK raw path: restored correctly, device-unproven for this model, not a defect. **REFUTED as a defect**

> `ggml/src/ggml-hexagon/htp/matmul-ops.h:94-97:static inline bool htp_mm_raw_kernel_admitted(int32_t kernel_type, uint64_t n_act_rows, uint64_t k) {`
> `    return kernel_type == HTP_MM_KERNEL_HMX_2D || kernel_type == HTP_MM_KERNEL_HVX_QUANT_ROW_FLAT ||`
> `           (kernel_type == HTP_MM_KERNEL_HVX_QUANT_BLOCK && n_act_rows == 1) ||`
> `           (kernel_type == HTP_MM_KERNEL_HVX_RAW_ROW && n_act_rows == 1 && k >= HTP_MM_RAW_MV_MIN_K);`
> `}`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1690:                matmul_job_func = hvx_mv_2d_raw_q4_0_tiled;   // rows shorter than HTP_MM_RAW_MV_MIN_K: convert each group to tiles`

`hvx_mv_2d_raw_q4_0_tiled` is the `RAW_Q4_0 == 1` instantiation renamed out of the way; all five
references were updated and no dangling `hvx_mv_2d_raw_q4_0`-as-tiled reference remains. The tile
scratch it writes (`n_k * 640` at slot offset `(n_prefetch-1) * n_k * 576`) fits only because the
QUANT_BLOCK layout reserves 640-based slots — that is exactly what the comment at `matmul-ops.c:336-339`
promises, and it holds. It is a revert to the `c5a218321` behaviour that already ran on the S23. The
only caveat: this model has no raw Q4_0 weight with K < 256, so the restored branch is *unexercised on
device*; if it ever fires, its correctness rests on `c5a218321`, not on this commit.

### F13 — The probe cannot leak into prefill. **CONFIRMED (positive)**

`RAW_ROW` requires `src1_nrows == 1` in the precompute (`ggml-hexagon.cpp:4589`) and
`n_act_rows == 1` in the admission predicate, so a `-ub 512` prefill gets `QUANT_ROW` and
`pipeline = 0`. The ABBA's `pp512` column must therefore be invariant across all four arms — that is
a free, strong internal control: **if `pp512` moves in any probe arm, the arm is misconfigured.**

---

## Angle-by-angle dispositions

### 1. Line-by-line correctness (dequant/dot, scales, nibble order, −8, K tails, off-by-one, thread partitioning)

* **Dot math, scales, nibble order, the −8 correction: untouched by this commit** and as audited in
  `974a31e79`. `q4_0-raw-mv-hvx.h` has no diff. The per-lane bound (≤ 8 products × 128, accumulated
  in qf32) is unchanged.
* **The rewritten activation arrangement is correct — I tried to break it and could not.** Proof of
  the invariant that matters. For block `blk` the new code picks
  `w = blk / 7`, offset `blk - raw_mv_window_start(w, n_k)`. For any `w` with
  `7(w+1) ≤ n_k` (every non-final window) `raw_mv_window_start = 7w`, so offset `= blk - 7w = j` and
  the weight at offset `j` is block `7w + j` — the same block. For the final window
  `w = n_win-1`, `start = n_k - 7`; the blocks that reach it are exactly
  `blk ≥ 7(n_win-1)`, at offsets `blk - n_k + 7 ∈ [7-r, 7)` with `n_k = 7m + r`, and the weight at
  offset `j` is `n_k - 7 + j = blk` — the same block. **Union over windows: every block exactly once,
  each at the byte phase its weight is read from.** The zeroed offsets in the final window carry
  weight blocks that the previous window counts, so they contribute 0. `n_k = 9` (K = 288, the
  awkward case) checks out by hand: window 0 → blocks 0-6, window 1 → block 7 at offset 6.
  This also confirms the *old* per-window arrangement placed data identically, so the commit's
  "quantize once" change is a pure de-duplication with no numerical consequence.
* **The simulator's scalar models already encode the same sharding** (`raw-mv-sim.c:68,72,92`:
  `if (start + j < 7 * w) { continue; }` / `if (j >= 7 || ti < 2 || start + j < 7 * w) { continue; }`),
  so the sim and production agree and the new `raw-mv-edge-sim.c` is not testing a model that
  production stopped matching. Good.
* **K < 256:** host and DSP both admit `QUANT_BLOCK` for one row at any K, `RAW_ROW` only at
  K ≥ 256 (`= 8 × 32`). K not a multiple of 32 is refused on both sides
  (`src->ne[0] % QK4_0` / `w->ne[0] % QK4_0`). The `HTP_MM_RAW_MV_MIN_K` invariant that keeps
  `raw_mv_load_last` from reading before a row's start is now structural
  (`#define HTP_MM_RAW_MV_MIN_K ((HTP_MM_RAW_MV_WINDOW_BLOCKS + 1) * 32)`), i.e. better than the static
  assert it replaces.
* **F16 / strided activations: fixed, and the fix is symmetric.** One function
  (`htp_mm_raw_act_admitted`) is called with the same values on both sides — host
  `ggml-hexagon.cpp:2245`, DSP `matmul-ops.c:3834` — and the DSP sees the *original* `h.type` and
  `h.nb[0]` from the tensor descriptor (`ggml-hexagon.cpp:2411, 2431`), so the two really do see the
  same thing. The `hvx_copy_f32_au` reasoning is also right: the helper asserts only on the
  *destination*, and it issues one unaligned load per 128 B with no partial-vector tail, so for
  `active` a multiple of 32 floats it reads exactly `[src, src + active*4)`.
* **Row/column off-by-one, tail rows, thread partitioning:** `ct_start = src0_start_row / 32`,
  `ct_end = (src0_end_row + 31) / 32`, `valid_rows = MIN(32, MAX(0, ne0 - ct*32))`, the 4-row pass
  duplicating `MIN(r0+i, valid_rows-1)` and the `if (r0 + i < valid_rows)` store guard — all
  unchanged and correct; the new `raw-mv-edge-sim.c` `check_output_tail` (1/5/17/31/32 rows,
  canaries on both sides) plus control 5 close the test gap the previous audit named.
* **The quant-task write partition is provably disjoint** (this was the most likely place for a
  race): a task zeroes and writes only windows `[w_first, w_last)`, and the blocks it places are
  `[7·w_first, min(7·w_last, n_k))`, whose windows are exactly `blk/7 ∈ [w_first, w_last)`. No two
  tasks touch the same window, so the new two-pass structure (zero → place → `raw_mv_act_corr`) has
  no intra-op race, and the quant barrier (initialised to `n_quant_tasks`, entered by every matvec
  thread through `hvx_mm_run_quant_task`) covers the readers.
* **Quantize-once when activations change between calls:** the arrangement is rebuilt from
  `act->data` on every op invocation and covers *all* windows, so no stale window can survive a
  changed activation vector. No persistence, no invalidation needed.

### 2. Memory

* **VTCM overflow: none found.** See F4 for the 35.6× over-reservation (waste, not overflow) and for
  the alignment proof (256-multiples for src0/src1 keep `off_src1` and every window 128-aligned, as
  `hvx_vmem`, `hvx_copy_f32_au` and `raw_mv_load_window` require).
* **DMA descriptor sizes/alignment:** unchanged from `93ade4886`, which ran on the S23. One real
  asymmetry worth putting in the write-up: the raw descriptor's **row stride is `18·n_k`, which is
  not a multiple of 128 for any `n_k ∉ 64Z`** (K = 10752 → 6048 B ≡ 32 mod 128), while the tiled
  descriptor's stride is `576·n_k` and always is. The three ffn matvecs (38.6 of 54.7 ms/token) are
  exactly the misaligned ones. This is the mechanical half of my answer to (b).
* **l2fetch ranges:** see F3 — 16 KB granularity, over-fetch, and it can read up to 16 KB past the
  tensor. Non-faulting by construction of `Q6_l2fetch`, and the codebase already relies on that.
* **Cache maintenance:** nothing added or removed. The `l2fetch` does not change the coherence class
  (same DDR source, same snooping), so the host-write/DSP-read contract of the activation buffer is
  unchanged — but note the *default* now includes a prefetch that the 15.51 baseline did not.
  `HOSTBUF_UNCACHED` (pre-existing) is orthogonal: HOST allocations only.
* **Buffer lifetime:** unchanged. The arrangement lives in VTCM for the duration of one op; the
  quant barrier orders writers against readers; `octx->src1_spad.src = NULL` etc. untouched.

### 3. Host/DSP contract

* **The admission predicate matches exactly.** One inline function, two callers per side, identical
  arguments, no duplicated constants. The kernel-type choice, the K threshold, the act-type/stride
  test and the `ne[0] == ne[0]` test agree on both sides. The one asymmetry I found — the host's
  F32 refusal is *broader* (it also blocks F16 activations for repacked weights, `F11`) — only makes
  the host stricter, never looser, so it cannot produce a wrong-kernel dispatch.
* **Message/struct layout: unchanged and single-sourced.** `struct htp_mm_kernel_params` has no diff
  in this commit and both sides include the same `htp/matmul-ops.h`; the new enum value is *appended*,
  and the geometry constants moved host-ward (`HTP_MM_RAW_MV_WINDOW_BLOCKS`,
  `HTP_MM_RAW_MV_ACT_WINDOW_BYTES`, `HTP_MM_RAW_MV_MIN_K`, `htp_mm_raw_mv_act_bytes`) so the VTCM
  layout the host sizes and the VTCM layout the DSP builds cannot drift — the single biggest
  structural improvement in this commit, and it is why the `HTP_MM_KERNEL_HVX_RAW_ROW` split was
  necessary rather than optional.
* **The one contract smell** is the overloaded `kparams->pipeline` (F7/F10.1): a field whose
  declared meaning is "1 = pipelined, 0 = standard" now carries a bit protocol, and the only
  protection is a comment. A separate `probe` field (the struct has room and the wire is
  versioned by commit anyway) would remove the class of bug.
* **Failure mode of a skew** is a hard abort, not a slow path (F5).

### 4. Probe isolation

| arm | what it actually changes | isolates? |
|---|---|---|
| `=1` SKIP_DOT | dot skipped; trailing output copy still runs and publishes stale VTCM | **no** — also removes the dot's VTCM read traffic, so the DMAs speed up; over-states the compute cost. Garbage output (F6). |
| `=2` REUSE_SLOTS | no weight DMA after the first `n_src0_slots` groups; dot unchanged on the same VTCM slots | **yes, mostly** — the cleanest arm. Verified in-bounds (`(ct-ct_start) % n_src0_slots < n_src0_slots`, stride `tile_row_transfer_size_aligned` against a slot region sized `n_prefetch · n_k · 640 ≥ n_prefetch · n_k · 576`) and the DMA queue stays balanced (no push after the prologue, pop only for the first `n_src0_slots` iterations; the `ct_end - ct_start ≤ n_src0_slots` case never enters the reuse branch). Still not single-variable: it also removes DMA-engine contention (F-list, (b) caveat). |
| `=4` NO_L2FETCH | removes a 16 KB-granular, 2.5×-overlapping prefetch | **partly** — it measures *this* prefetch, not prefetching (F3). |
| `RAW_LOCAL` | nothing, in this recipe | **no** (F1). |
| `HOSTBUF_UNCACHED` | host allocation mapping only | **yes**, but only for host-buffer tensors; do not combine with `RAW_LOCAL` (F1c). |

* **Leakage into the default path when the env is unset: none.** Both variables default to 0/false,
  `kparams` is `memset` to 0 at the top of the precompute (`ggml-hexagon.cpp:4727`), and the DSP
  reads `pipeline` only where a RAW_ROW kernel is running. The *one* default-path change is the
  `l2fetch` (F3) — disclosed in the commit message, but it must not be forgotten when comparing arm 0
  to 15.51.
* **Read once: yes** (`ggml_hexagon_init`). **Parsed safely: no** (`atoi`, no mask, no log) — F7.
* **Silent numerics change while reporting a speed:** yes, arm 1 only, and it is documented as
  "the result is garbage". Nothing else in the set changes the numbers the kernel computes — arm 2
  and arm 4 compute exactly the same values as arm 0 (arm 2 on the *wrong* weights, which is the
  point, but through a well-defined mechanism).

### 5. Removed behaviour (what `974a31e79` did that `ceb89bedc` dropped)

* **Nothing lost, three things replaced:**
  * `raw_mv_act_bytes` / `raw_mv_act_window` / the local `RAW_MV_ACT_WINDOW_BYTES` / the geometry
    static assert were removed and *every* caller moved to the header-owned
    `htp_mm_raw_mv_act_bytes` / `HTP_MM_RAW_MV_ACT_WINDOW_BYTES` / the `HTP_MM_RAW_MV_MIN_K`
    definition. Grep confirms zero dangling references.
  * The F32 test inside `ggml_hexagon_raw_decode_op` was removed and replaced by the strictly
    stronger `htp_mm_raw_act_admitted` at the raw-weight admission, which also covers the strided
    case the old predicate ignored. Its other two uses (`raw_weights_supported`, `offload_op`) do not
    need the F32 test: `offload_op` still ends in `supports_op`, which refuses F16 activations.
  * `MATVEC_2D_TILES_IMPL(hvx_mv_2d_raw_q4_0, …)` changed meaning from `RAW_Q4_0 == 1` to `== 2`;
    the `== 1` body was renamed to `hvx_mv_2d_raw_q4_0_tiled` and all five call sites updated.
  * **Gained back:** the raw `QUANT_BLOCK` matvec for K < 256 that `93ade4886` removed (F12).
* **The shared tiled quantizer, the repacked/flat wrappers, `RAW_DECODE=0`, the HMX raw reader, the
  two-copy behaviour: untouched.** The previous audit's "two-copy behaviour change: REFUTED" still
  holds; nothing in the repacked path is modified.

### 6. Races, concurrency, error paths

* **No new race.** The only shared mutable state in the new arrangement is the VTCM activation
  region, partitioned by window range and proven disjoint; the `corr` second pass touches only the
  task's own windows; `atomic_init(&mmctx->quant_barrier, n_quant_tasks)` happens before
  `worker_pool_run_func`; every matvec thread calls `hvx_mm_run_quant_task`, so non-arranging threads
  wait. The `l2fetch` is issued only by the arranging threads (`ith < n_quant_tasks`).
* **Error paths:** nothing in this path allocates on the DSP (VTCM is a pre-reserved block) and
  `mmctx->act` / `act->data` are set in `hvx_mm_matmul` before the pool starts, so no NULL is
  reachable. The DMA queue is popped unconditionally in the non-reuse path; a failed transfer
  surfaces as garbage, not a status (pre-existing).
* **The one new failure mode is the version skew** (F5) — a hard `GGML_ABORT`, not a degradation.

### 7. Clean-code checklist

* One responsibility per file: yes. No file beyond ~350 new lines: yes (largest new file
  `raw-mv-edge-sim.c` = 181; `q4_0-raw-mv-act.h` = 100 total).
* No preventive public APIs: yes — `htp_mm_raw_act_admitted` (3 production call sites + the sim),
  `htp_mm_raw_mv_act_bytes` (16 references), the three probe macros (2/2/1 uses). No type nobody
  constructs: `HTP_MM_KERNEL_HVX_RAW_ROW` is constructed by the host precompute and dispatched by
  the DSP switch.
* Comments only WHY/traps: mostly yes, five exceptions (F10). Two declared invariants are **not
  true**: "each 128-float group is quantized once per call" (false at a task boundary) and "the
  task's whole slice … in one request" (F3/F10.5). One field comment is stale (`pipeline`).
* Two smaller smells: `htp_mm_raw_act_admitted(bool is_f32, uint64_t nb0)` takes a parameter that is
  already half the predicate — passing the type would keep the type mapping in one place; and
  `pipeline` as a probe carrier (F7).
* The test suite grew honestly: negative controls 5-8 map one-to-one onto the four new checks
  (output tail, aligned-source copy, stride check, pre-fix arrangement), control 8 reads the old
  headers out of git so it cannot rot, and the runner now requires `PARTS+1` sentinel lines so a
  silently missing partition cannot pass. The one weakness I found is control 7
  (`sed -i 's/nb0 == sizeof(float)/1/'`): it is detected by the *predicate* test only — it does not
  demonstrate that a strided activation would produce wrong numbers through the arrangement, which
  is the failure the previous audit described.

### Dead code (last)

* **None introduced.** `raw_mv_scale_fanout` (generated by `solve-raw-mv-fanout.py`, used by the
  kernel and the sim), `raw_mv_act_corr` (2 refs), `HTP_MM_RAW_MV_ACT_WINDOW_BYTES`, `RAW_MV_LANES`,
  `raw_mv_n_windows`, `raw_mv_window_start` — all live. The old `raw_mv_act_bytes` and
  `raw_mv_act_window` are gone with zero references.
* Borderline: `_Static_assert(RAW_MV_ACT_WINDOW_BYTES == 4 * VLEN, "a window's activations are 4
  vectors")` can only fire if `VLEN` changes (the macro is `512` on the line above). Harmless; a
  comment would do the same work.

---

## Suggested gates for the S23 session (in order)

1. Per arm: profile must show kernel tag **`hvx-rawrow`**; if it shows `hvx-flat`/`hvx-tiled`, the
   probe did not run (F2) — discard the arm.
2. Per arm: `pp512` must be unchanged across all four arms (F13). Any movement = misconfiguration.
3. Record the literal `GGML_HEXAGON_RAWROW_PROBE=…` string per arm and grep the run log for it; there
   is no in-binary confirmation (F7).
4. Arm 1 with fixed `-n`, no KLD/perplexity, no output inspection (F6).
5. Drop `RAW_LOCAL` from the plan; if the memory-path hypothesis must be tested on device, the only
   lever left in this tree is arm 2 plus (in a follow-up) a right-sized `src0` slot (F4) to raise
   `n_prefetch` from 8 to 16.
6. Report arm 0 as "one copy + activation l2fetch", not as "974a31e79" (F3).
7. State in the report that arms 1 and 2 are not additive and each over-attributes its own axis
   (F-list, (b) caveat), so the three numbers bracket the gap, they do not decompose it.
