# Hostile audit: `df538c50c` — device-gap probe honesty

**Subject:** `df538c50c` "hexagon: device-gap probe honesty - RAW_LOCAL keeps Q4_0 out of the
one-copy divert, RAWROW_PROBE parsed strictly and logged at init, pipeline reset on the flat
fallback, raw-row path counts at session teardown", base `ceb89bedc`, branch `spike/onecopy-hmx-raw`.
**Method:** static read of `git show df538c50c` and of the tree at `df538c50c`: the whole loader probe
path (`llama-model-loader.cpp`, `llama-model.cpp`, `llama-context.cpp`), the ggml scheduler
(`ggml-backend.cpp`), the hexagon buffer types / `set_tensor` / `supports_op` / precompute / session
lifecycle, and the DSP raw-row DMA + admission (`htp/matmul-ops.c`). **I built nothing, ran nothing,
changed nothing.** All tok/s numbers remain the device agent's.

**Bottom line:** three of the five gates from `AUDIT-ceb89bedc.md` are genuinely fixed
(`pipeline` reset, strict parse, `RAW_LOCAL` now really turns the divert off). **The fourth, the
teardown counters, does not measure what its label says and cannot serve as the VTCM-fallback gate
the previous audit asked for** (B2). **The fifth, `RAW_LOCAL`, is now a real code path but it cannot
isolate a "memory path" on this backend at all** (B1) — the two buffer types are the same
`RPCMEM_HEAP_ID_SYSTEM` allocation with the same flags, the same mapping mode and the same kernel.
The default path is untouched (good). No defect that corrupts or crashes the default path.

---

## Answers first

### Is `df538c50c` fit for the S23 ABBA session?

**YES for arms `GGML_HEXAGON_RAWROW_PROBE=1|2|4` and `GGML_HEXAGON_HOSTBUF_UNCACHED=1`, subject to
the five blocking items below. NO as a *memory-path* discriminator for `GGML_HEXAGON_RAW_LOCAL=1`**:
it is no longer a no-op (the divert is off, that is a real fix) but the quantity it was created to
isolate does not exist in this backend (B1), and it can still be a silent no-op at load time (B4).

Blocking items, in order:

1. **Do not use the teardown counters as evidence about matvecs.** They count *precompute calls*,
   not executed matvecs, and they stop growing after the first graph of each shape (B2).
   `kernel chosen N` ≈ a small constant independent of tokens decoded. The only trustworthy
   per-matvec gate remains the previous audit's: the profile tag **`hvx-rawrow`**
   (`htp-opnode.h:332`). Keep that as gate 1.
2. **Carry over the host/DSP skew gate (previous F5, unchanged).** This commit adds no wire field and
   no new enum, so the skew risk is identical: push the new `.so` with the new host lib, and treat a
   missing `hvx-rawrow` tag as a discarded arm.
3. **Every arm: `--load-mode none`.** Under mmap the loader replaces the `-HOST` buft with a plain CPU
   buft (`llama-model-loader.cpp:1289-1298`), the weight becomes a *foreign* buffer, and
   `ggml_hexagon_has_foreign_quantized_weight` refuses every op that touches it → the arm measures a
   CPU-only run. The loader's own `warn_onecopy_raw_under_mmap` fires for this env pair, but it is a
   warning, not a stop.
4. **Every arm: grep the new lines.** `grep -E "ignoring invalid GGML_HEXAGON_RAWROW_PROBE"` must be
   empty, and `grep "memory-path env:"` must be present with `RAWROW_PROBE=` equal to the intended
   value. An invalid value now degrades silently to **probe = 0**, i.e. the arm silently becomes
   arm 0; the only trace is one WARN line (d).
5. **`RAW_LOCAL=1` may be run, but not as the memory-path experiment.** If it is run at all, add the
   placement gate in B4 and report it as "device-buffer placement works end to end", nothing more.
   Do **not** combine it with `HOSTBUF_UNCACHED` (the flag is host-allocation-only, so that arm
   would move Q4_0 weights out of the only allocation it can affect).

Carried from the previous audit, unchanged by this commit and still true: arm 1 publishes stale VTCM
(garbage/NaN) — fixed `-n`, no KLD/perplexity; arms 1/2/4 are not additive; arm 0 is not the
`974a31e79` baseline (the default `l2fetch`); `pp512` must be invariant across arms.

### Does any arm still risk measuring something other than it claims?

| arm | risk | why |
|---|---|---|
| `RAWROW_PROBE=1` | **yes (known)** | dot skipped, output is whatever was in VTCM; also removes the dot's VTCM read traffic, so it over-states the compute cost. Unchanged. |
| `RAWROW_PROBE=2` | low | cleanest arm; still not single-variable (removes DMA-engine contention too). Unchanged. |
| `RAWROW_PROBE=4` | medium | measures *this* 16 KB-granular 2.5×-overlapping `l2fetch`, not prefetching. Unchanged. |
| `RAWROW_PROBE=<invalid>` | **new, fixed-but-worth-a-gate** | now rejected instead of becoming `-1`/all bits (good), but degrades to probe 0 with a single WARN. |
| `HOSTBUF_UNCACHED=1` | low | a real cache-attribute change, and it applies to the Q4_0 weights (the only host allocations in the recipe). The one thing to check: whether an uncached host allocation still needs `GGML_HEXAGON_HOSTBUF_FLUSH` for visibility on device — the flush path exists precisely for the non-default mapping class. |
| `RAW_LOCAL=1` | **high (new)** | same heap/flags/mapping/kernel on both sides (B1); can still silently land the weights in `-HOST` if the 512-row probe loses (B4); under mmap degenerates to CPU-only (gate 3). |

---

## Ranked findings

### B1 — `RAW_LOCAL` cannot isolate a memory path on this backend: the two buffer types are the same allocation. **CONFIRMED**

`ggml_hexagon.cpp:2081` (device buft) and `:2090` (host buft):

> `        ggml_hexagon_shared_buffer * sbuf = new ggml_hexagon_shared_buffer(sess, size, false);`
> `        const uint32_t flags = opt_hostbuf_uncached ? RPCMEM_FLAG_UNCACHED : RPCMEM_DEFAULT_FLAGS;`

Both call the same constructor (`ggml-hexagon.cpp:643-655`) with `pinned = false`, which calls
`ggml_hexagon_rpcmem_block` (`ggml-hexagon.cpp:557-560`):

> `        base = (uint8_t *) rpcmem_alloc2(RPCMEM_HEAP_ID_SYSTEM, flags, size);`

and both map with the same mode (`:586`, `flags = this->pinned ? FASTRPC_MAP_FD : FASTRPC_MAP_FD_DELAYED`
→ `FASTRPC_MAP_FD_DELAYED` for both). The **only** attribute difference anywhere in the tree is
`RPCMEM_FLAG_UNCACHED`, which is host-only and off in the base arm (`:2085`).

So `RAW_LOCAL=1` does what it says structurally — the divert is off, the device buft wins the loader
probe, `set_tensor` skips `REPACK`, `ggml_hexagon_is_raw_weight` returns true, the raw-row kernel
runs (`ggml-hexagon.cpp:2274`, `:1754`, `:1877`, `:2178`, `:4598`) — but the Q4_0 weights end up in
**a different `RPCMEM_HEAP_ID_SYSTEM` allocation with identical flags, identical fastrpc mapping and
an identical DMA path**, and the same `hvx-rawrow` kernel runs on them.

The mechanical part of the chain *is* buffer-kind agnostic, which I verified end to end: the DSP
resolves `src0` from `h.data` (an offset into `b.base`, `ggml-hexagon.cpp:2424-2431`) and the raw-row
DMA reads `(const uint8_t *) src0->data + ct * 32 * src0->nb[1]` (`htp/matmul-ops.c:346-350`) — no
host-buffer-only assumption, no address/stride assumption that a device buffer breaks. So there is no
*correctness* hole here. The hole is in the **experiment**.

**Failure scenario (not a crash — worse):** the coordinator runs the base arm and the `RAW_LOCAL` arm,
gets 15.5 vs 15.6 tok/s, and writes "DSP-local DDR does not help; the gap is compute". The arm cannot
support that conclusion in either direction: a 1 % delta is inside the run-to-run noise of a device
shared over Wi-Fi ADB, and the design has no mechanism that *could* produce a large one.

**The comment's justification is therefore wrong on three of its clauses** (see B9): there is no
"DSP-local copy", and there is one copy, not two.

### B2 — the teardown counters are not a per-matvec count and they stop growing after the first graph of each shape. **CONFIRMED**

`ggml-hexagon.cpp:453-456`:

> `    // raw-row matvec path decisions of ggml_hexagon_precompute_hvx_mm_params (admission checks and`
> `    // execution precomputes alike), printed once by release()`
> `    mutable uint64_t n_rawrow_chosen        = 0;`
> `    mutable uint64_t n_rawrow_vtcm_fallback = 0;`

The parenthetical is honest about *what is counted*, and `ggml-hexagon.cpp:4061-4062` is not:

> `    GGML_LOG_INFO("ggml-hex: %s raw-row matvec paths: kernel chosen %llu, VTCM-budget fallback to flat %llu\n",`

Both counters are bumped inside `ggml_hexagon_precompute_hvx_mm_params` (`:4636-4638`, `:4649-4651`),
which has **two** very different callers, and neither is the steady-state per-token path:

* **Admission callers.** `supported_mul_mat` (`:5190`) and `supported_mul_mat_id` (`:5235`) call the
  precompute, and those are reached from `ggml_backend_dev_supports_op` / `offload_op`, which the
  scheduler calls **only from `ggml_backend_sched_split_graph`**
  (`ggml-backend.cpp:897, 972, 979, 1065, 1228, 1249` — the function spans 1072-1595).
  `llama_context::process_ubatch` calls `ggml_backend_sched_alloc_graph` only when the graph is
  rebuilt (`llama-context.cpp:1359-1361` reuse → `n_reused++`, `:1388` alloc on the non-reuse path),
  and `llama_context::graph_reserve` adds a burst of extra `split_graph` calls at init
  (`llama-context.cpp:2496-2507`, called for several reserve shapes from `:638-681, 849`).
* **Execution caller.** `ggml_backend_hexagon_graph_compute` (`:6086-6090`) — but only on a node-cache
  miss (`ggml-hexagon.cpp:6056`):
  > `    bool cache_hit = (graph->uid != 0 && sess->cached_uid == graph->uid);`
  and the split graphs' uid is stamped once per `split_graph` (`ggml-backend.cpp:1591-1594`), so a
  reused decode graph carries the **same** uid every token. From the second token on, the precompute
  loop is skipped entirely.

**Failure scenario:** a 128-token run prints `kernel chosen 728, VTCM-budget fallback to flat 0`. Two
readings are natural and both are wrong or unjustified: (i) "728 raw-row matvecs ran" — no, ~728 is
roughly *two builds of one token's matvec list*; (ii) "nothing fell back to flat" — **not
established**, because the counter stopped observing after the first graph. The previous audit's F2
gate ("did any matvec silently fall back to `QUANT_ROW_FLAT` and neuter the probe?") is exactly what
this line was supposed to answer, and it cannot answer it. Worse, its magnitude is *config-dependent*:
the node cache is a **single entry** (`cached_uid` / `cached_nodes`, `:462-463`), so a layout with two
hexagon splits per token thrashes it and the counter grows ~per token instead of being frozen. The
same arm can print two numbers an order of magnitude apart.

Secondary inflation, minor: a fused `MUL_MAT+ADD` pair is counted twice — once in the precompute loop
for the `MUL_MAT` node and once again inside `try_fuse_mul_mat_add`
(`ggml-hexagon.cpp:2795` → `precompute_fused_matmul_add_params` → the same
`precompute_hvx_mm_params`). Not triggered by a bias-free Qwen-class graph, but the count is a
precompute count, not an op count, so it is not a stable unit. **PLAUSIBLE.**

### B3 — non-atomic counters bumped from a `const` path. **PLAUSIBLE (low, consistent with the file)**

`mutable uint64_t` + `sess->n_rawrow_chosen++` with `const struct ggml_hexagon_session * sess`
(`ggml-hexagon.cpp:4535`, `:4637`). `ggml_hexagon_precompute_matmul_params_impl` takes a const session
(`:4740`), hence `mutable`. Two `llama_context`s on the same hexagon device decoding from two threads
would lose or tear counts. The session already carries non-atomic mutable state (`fence_seq` `:450`,
`cached_uid` `:462`, `mutable needs_repack` `:467`), so concurrent contexts are already unsupported;
this is the first counter a human will read as a measurement, so it deserves to be atomic. Single
context: no race.

### B4 — the device-buffer probe never evaluates the raw-row configuration, so `RAW_LOCAL` can still silently do nothing. **CONFIRMED**

During the loader probe the weight has a *temporary* buffer with usage `ANY` and **no `extra`**
(`llama-model-loader.cpp:1052-1056`):

> `    // create a temporary dummy buffer for the weight so that supports_op can check the buffer type`
> `    GGML_ASSERT(w->buffer == nullptr);`
> `    w->buffer = ggml_backend_buft_alloc_buffer(buft, 0);`

`ggml_hexagon_is_raw_weight` requires `base->extra` **and** `GGML_BACKEND_BUFFER_USAGE_WEIGHTS`
(`ggml-hexagon.cpp:2178-2186`), so it is false at probe time; and the probe's activation is 512 rows
(`llama-model-loader.cpp:949-951`):

> `                ggml_tensor * b = ggml_new_tensor_4d(ctx, GGML_TYPE_F32, w->ne[0], 512, w->ne[2], w->ne[3]);`

so `raw_row` (which needs `src1_nrows == 1`, `:4598`) is never evaluated either. With the divert off,
`supports_op` therefore answers the probe from the **tiled / HMX 512-row** configuration and its VTCM
fit. Probe order for a layer weight is `[HTP0:0, HTP0:0 (ACCEL list), HTP0:0-HOST, CPU]`
(`llama-model.cpp:1061-1119` + `1477-1480`). If the 512-row probe does not fit the VTCM budget
(`supported_mul_mat`, `ggml-hexagon.cpp:5183-5186`), the weight falls through to `-HOST` and
`RAW_LOCAL=1` reproduces the base arm exactly — the previous audit's F1 failure, now conditional
instead of certain.

**Mitigation that exists and must be used (this is the cheap placement gate):** with
`GGML_HEXAGON_VERBOSE=1` and `-v`, `ggml_hexagon_dump_op_supp` (`:167-173`, gated on `opt_verbose`,
emitted at `ggml-hexagon.cpp:6844` on the divert and `ggml-backend.cpp:1065` per node) prints
`fmt.buffs`, which is `ggml_backend_buffer_name()` → the buft name → `HTP0:0-HOST` vs `HTP0:0`
(`htp-opnode.h:253-256`, `ggml-backend.cpp:112-114`, `ggml-hexagon.cpp:2150-2154`).
**Gate:** in the `RAW_LOCAL` arm, `grep "supports-op MUL_MAT" … | grep HTP0:0-HOST` must be **empty**
for `blk.<n>.attn_q.weight`-class tensors; in the base arm it must be **non-empty**. Without this,
nothing in the binary or the log states where the Q4_0 weights live.

### B5 — `init_tensor` sets `REPACK` without the `RAW_LOCAL` opt-out: the invariant is enforced in 2 of 3 places. **PLAUSIBLE (unreachable for model weights today)**

`ggml-hexagon.cpp:1753-1756` and `:1876-1879`:

> `        if (ggml_hexagon_is_repack_type(tensor->type) && !(opt_raw_local && tensor->type == GGML_TYPE_Q4_0)) {`
> `            extra->flags |= GGML_HEXAGON_TENSOR_REPACK;`
> `        }`

but `ggml-hexagon.cpp:751-755`:

> `    if (ggml_hexagon_is_repack_type(tensor->type)) {`
> `        if (sess->needs_repack.count(tensor)) {`
> `            extra->flags |= GGML_HEXAGON_TENSOR_REPACK;`

`set_tensor` only ever *adds* the flag, never clears it, so a Q4_0 tensor that enters through
`needs_repack` (`:5160`, `:5226`) is tiled even with `RAW_LOCAL=1`. `needs_repack` is filled from
`supported_mul_mat`/`supported_mul_mat_id` when `!src0->buffer`, which during load is false (the probe
gives the tensor a temp buffer), so model weights do not hit it — but a *computed* buffer's quantized
tensor would, and then `RAW_LOCAL`'s promise ("Q4_0 stays raw") silently does not hold. One line at
`:751` closes it. Same shape of hole as the rest of the flag: the invariant lives in a comment.

### B6 — `RAW_LOCAL=1` is **not** inert when `HOSTBUF=0` or `RAW_HMX=0`, and the commit's comment does not say so. **CONFIRMED**

The commit's own summary says the flag only "turns the diversion off". It does not: the flag is also
the `set_tensor` opt-out at `:1754`/`:1877`. With `RAW_HMX=0` (or `RAW_HMX=1` + `RAW_DECODE=0`),
`ggml_hexagon_raw_weights_supported` refuses every raw-weight matmul
(`ggml-hexagon.cpp:2251`, and `ggml_hexagon_raw_decode_op` at `:2224`), so a Q4_0 tensor stored raw
in the *device* buffer has **no DSP op at all**: every matmul that touches it silently falls to the
CPU, reading DDR through the host mapping of an rpcmem allocation. No error, no log line, a
catastrophic tok/s, and the flag is documented as a diagnosis knob for the one-copy recipe.

**Failure scenario:** a stray `GGML_HEXAGON_RAW_LOCAL=1` left in the shell profile poisons an unrelated
`RAW_HMX=0` baseline run. The commit fixes a different arm's bug and creates this one; the guard at
`:2274` protects only the divert.

### B7 — the DSP `RAW_ROW` case does not check `is_raw`, unlike every neighbouring raw case. **PLAUSIBLE (pre-existing; not introduced here)**

`htp/matmul-ops.c:1671-1683`:

> `        case HTP_MM_KERNEL_HVX_RAW_ROW: {`
> `            // the activations are arranged per window of the raw rows instead of quantized into tiles`
> `            const uint32_t n_win = (uint32_t) (htp_mm_raw_mv_act_bytes(ne10 / 32) / HTP_MM_RAW_ROW_ACT_WINDOW_BYTES);`

compare `:1647`, `:1658` and `:1688`:

> `                    case HTP_TYPE_Q4_0:   matmul_job_func = is_raw ? hvx_mm_2d_raw_q4_0_flat : hvx_mm_2d_repacked_q4_0_flat; break;`
> `                matmul_job_func = hvx_mv_2d_raw_q4_0_tiled;   // rows shorter than HTP_MM_RAW_MV_MIN_K: convert each group to tiles`

`is_raw` is derived from `HTP_TENSOR_REPACK`, which the host sets from the same `extra` the host's
`raw_row` test reads (`ggml-hexagon.cpp:2425-2432` vs `:4598`), so host and DSP agree today. But
unlike the other raw kernels, a `RAW_ROW` dispatched on a *repacked* tensor reads tiled bytes as raw
rows and returns **OK** — silent garbage with no `NO_SUPPORT`, which is precisely the class of
failure the skew gate is supposed to catch. One `if (!is_raw) return HTP_STATUS_NO_SUPPORT;` would
make the wire self-defending.

### B8 — comment rot: the new paragraph at `:2270-2272` states three things the code does not do. **CONFIRMED**

Verbatim (`ggml-hexagon.cpp:2266-2272`):

> `// cannot run keep the repacked placement they have today. GGML_HEXAGON_RAW_LOCAL=1 turns the`
> `// diversion off instead: the device buffer wins the loader probe, set_tensor stores the Q4_0 rows`
> `// raw (no GGML_HEXAGON_TENSOR_REPACK), and ggml_hexagon_is_raw_weight plus the shared raw admission`
> `// take the raw-row kernel on that DSP-local copy - two copies, raw layout, raw kernel.`

Word by word:

| clause | verdict |
|---|---|
| "turns the diversion off instead" | **true** (`:2274`) |
| "the device buffer wins the loader probe" | **conditional / overstated** — the probe is decided by a 512-row tiled/HMX configuration it never runs (B4) |
| "set_tensor stores the Q4_0 rows raw (no `GGML_HEXAGON_TENSOR_REPACK`)" | **true at `:1754`/`:1877`, false at `:751`** (B5) |
| "`ggml_hexagon_is_raw_weight` plus the shared raw admission take the raw-row kernel" | **true** (`:2178`, `:2242`, `:4598`) |
| "on that DSP-local copy" | **false** — same heap, same flags, same mapping (B1) |
| "two copies" | **false** — with `--load-mode none` there is exactly **one** copy (the device buffer); with mmap there is one CPU copy and the DSP never sees it |

Also, the comment block it extends still opens (`:2258-2259`) with "The raw one-copy mode
(… + …) keeps the Q4_0 matmul weights in the -HOST buffer", which is now conditional — the paragraph
contradicts its own header. And `:105` still says "keep Q4_0 weights raw in the DEVICE buffer **too**",
where "too" is only true with `HOSTBUF=1` (B6).

Carried over, still true and now the *only* way to check a kernel: the `pipeline` field comment
(`htp/matmul-ops.h:113`) is stale — `int32_t pipeline; // 1 = pipelined execution, 0 = standard` — and
now carries a 3-bit probe protocol.

### B9 — `RAWROW_PROBE` parse: correct and strictly better; two residual sharp edges. **CONFIRMED (fixed) / PLAUSIBLE (residual)**

`ggml-hexagon.cpp:7489-7498`:

> `    opt_rawrow_probe   = 0;`
> `    if (str_rawrow_probe) {`
> `        char * end = nullptr;`
> `        errno = 0;`
> `        const long probe = strtol(str_rawrow_probe, &end, 10);`
> `        const long probe_bits = HTP_MM_RAW_ROW_PROBE_SKIP_DOT | HTP_MM_RAW_ROW_PROBE_REUSE_SLOTS | HTP_MM_RAW_ROW_PROBE_NO_L2FETCH;`
> `        if (errno != ERANGE && end != str_rawrow_probe && *end == '\0' && (probe & ~probe_bits) == 0) {`
> `            opt_rawrow_probe = (int) probe;`
> `        } else {`
> `            GGML_LOG_WARN("ggml-hex: ignoring invalid GGML_HEXAGON_RAWROW_PROBE '%s' (expected 0 or the OR of probe bits 1, 2, 4)\n", str_rawrow_probe);`

Correctly kills every case the previous audit listed: `-1` (all bits, via `& ~7`), `1,2`, `0x1`,
`1 `, `INT_MAX`, ERANGE. `probe <= 7` so the `(int)` narrowing is safe, `errno` is reset, `end` is
checked for both "no digits" and "trailing junk", and `probe == 0` from the literal `"0"` is accepted
silently. Matched against the neighbour it copies (`GGML_OP_OFFLOAD_MIN_BATCH`, `:7500-7509`) and the
pattern is the right one.

Residual 1 (**PLAUSIBLE**): an invalid value degrades to **probe 0**, i.e. the arm silently becomes the
*baseline* arm. The WARN is visible at the default log level (`GGML_LOG_LEVEL_WARN` > the INFO default;
`common/log.cpp:109` drops only DEBUG), but the failure mode is "the interesting arm became arm 0",
which is the previous audit's F7 hazard in a new shape. Make the grep a hard per-arm gate (blocking
item 4).

Residual 2 (**cosmetic**): `if (str_rawrow_probe)` is a pointer test, so `RAWROW_PROBE=` (empty) warns
while an unset variable is silent. Fine — arguably better — but the two are indistinguishable in the
commit's own terms ("read once, validated"): one warns about an empty value, the other does not.

### B10 — init log: placement and frequency are right; content is incomplete. **CONFIRMED (placement) / PLAUSIBLE (content)**

`ggml-hexagon.cpp:7512-7513`, immediately after the parse block and before "Parse device
configuration". Frequency is **once per process**: `ggml_hexagon_init` is called from
`ggml_backend_hexagon_reg()` under a `static bool initialized` latch
(`ggml-hexagon.cpp:7734-7753`), and there is no other reader of these env vars in the tree. It is
printed **after** the values are parsed, so it reports parsed values, not literals. Level `INFO` is
visible by default in `llama-cli`/`llama-bench` (`common/log.cpp:109` filters only DEBUG). This closes
the previous audit's blocking item 2 for `RAWROW_PROBE` and `RAW_LOCAL`.

Gap (**PLAUSIBLE**): the line omits every other knob that decides the same kernels —
`MM_SELECT`, `RAW_DECODE`, `NHVX`, `NHMX`, `VMEM`, `DEVICES` — and carries no device/session name. An
ABBA arm whose script leaks `MM_SELECT=2` or `RAW_DECODE=0` from a previous experiment produces an
identical-looking log. The name "memory-path env" is honest about the scope, but then it is not the
line an operator will read as "the configuration of this run".

---

## Angle dispositions

### (a) Does `RAW_LOCAL=1` really give raw layout + raw-row kernel on device-buffer weights, end to end?

**Structurally yes; experimentally no.** Traced in full:

| step | file:line | result |
|---|---|---|
| loader probe order for a layer weight | `llama-model.cpp:1061-1119`, `1477-1480` | `[HTP0:0, HTP0:0, HTP0:0-HOST, CPU]` |
| divert off | `ggml-hexagon.cpp:2274` | yes — `opt_raw_local` short-circuits before the buffer checks |
| probe verdict | `:6843`, `:5190` | decided on a 512-row *tiled/HMX* config; raw admission never tested (B4) |
| `set_tensor` no `REPACK` for Q4_0 | `:1754`, `:1877` | yes — except `:751` (B5) |
| `is_raw_weight` | `:2178-2186` | true (needs `extra` + WEIGHTS usage; both set, `llama-model.cpp:1825`) |
| shared raw admission | `:2242-2255` | identical set of admitted ops as the host-buffer arm — `is_raw_weight` does not look at *which* hexagon buffer, so `RAW_LOCAL` is a clean placement change for op admission |
| precompute picks `RAW_ROW` | `:4596-4604` | yes for 1-row, K ≥ `HTP_MM_RAW_MV_MIN_K`, `n_threads > 1`, `mm_select ≥ 2` |
| DSP can read it | `htp/matmul-ops.c:346-350`, `:1671-1683`; address/offset from `ggml-hexagon.cpp:2424-2432` | **yes** — `src0->data` comes from `h.data` = offset into `b.base`, the DMA is identical for both buffer types, `nb[1]` is the raw row stride in both cases. No host-buffer-only address/stride/DMA assumption found. |

So the chain is sound and there is no hidden DMA hazard. What fails is the *experiment*: both ends of
the comparison are the same DDR heap with the same attributes (B1), so the arm's expected effect size
is zero by construction.

**Does `RAW_LOCAL` change anything when `HOSTBUF=0` or `RAW_HMX=0`?** Yes, and it should not: B6.
The default path (`RAW_LOCAL` unset) is genuinely untouched — the only default-visible additions are
the two `GGML_LOG_INFO` lines and two inert counter increments.

### (b) The hoisted `raw_row` predicate: no case differs. **REFUTED (no behaviour change)**

Before: `raw_row` was computed inside `if (try_tiled) { if (src1_nrows < (int) sess->n_threads) {` →
value was `try_tiled && src1_nrows == 1 && src1_nrows < n_threads && ne10 >= MIN_K && is_raw`.
After (`ggml-hexagon.cpp:4598-4599`):

> `            const bool raw_row = try_tiled && src1_nrows == 1 && src1_nrows < (int) sess->n_threads &&`
> `                ne10 >= HTP_MM_RAW_MV_MIN_K && ggml_hexagon_is_raw_weight(src0);`

Identical, and `&&` short-circuits left-to-right so `ggml_hexagon_is_raw_weight(src0)` is still
called in exactly the same set of cases (no extra cost, no side-effect change for non-raw callers).
`try_tiled` was already required; the `nrows` check was already the enclosing `if`. Non-raw callers
(`is_matmul_id`, F16/F32, `!k_align`, `mm_select == 1`) all get `raw_row == false` exactly as before,
and therefore cannot reach the new counter increments. **No regression, no fix needed.**

### (c) Counters: concurrency, unit, and inflation

* Unit: **precompute calls**, not executed matvecs. Frozen after the first graph per shape (B2).
* Admission calls inflate them: yes, and they dominate — `split_graph` runs per reserve shape at init
  (`llama-context.cpp:638-681, 849`) and per distinct runtime shape, while the per-token execution
  precompute is skipped by the node cache (B2).
* The teardown line therefore misleads in the specific direction the session cares about: a 0 in the
  fallback column is not evidence.
* Concurrency: no race within one context (single thread); a torn/lost count with two contexts on one
  device (B3). Low, consistent with the file.
* `release()` really is once per session object: the constructor's `catch` calls `release()` and
  rethrows, and a throwing constructor does **not** run the destructor (`ggml-hexagon.cpp:4137-4141`,
  `4143-4144`). `mdev_group` children each print their own line (`:4132-4135` clears them after the
  parent logs). Correct.

### (d) `strtol` parse and init-log placement

Covered in B9 and B10. Parse: correct, strictly better than `atoi`, one residual hazard (invalid → 0).
Init log: once per process, after the read, visible by default; content incomplete.

### (e) Removed behaviour

**Nothing lost.** Enumerated:

* `atoi` → validated `strtol`: `-1` (which used to become all three bits via `(uint32_t)` on the DSP,
  previous F7) and `1,2` are now rejected. Behaviour change only in the safe direction.
* Predicate hoisting: provably equivalent (angle b).
* `kparams->pipeline = 0` on the flat fallback (`:4648`): a no-op whenever `opt_rawrow_probe == 0`
  (pipeline could only have been non-zero via `raw_row ? opt_rawrow_probe : 0`), and with a probe set
  it removes bits the flat kernel provably ignores anyway (`htp/matmul-ops.c:517` — `probe` is `0`
  unless `RAW_Q4_0 == 2`). It also cannot clobber an HMX pipeline flag: `kparams->pipeline` in
  `precompute_hmx_mm_params` is assigned at `:4510`, *after* every `return false` (`:4505`). Correct and
  minimal; the inline comment (`:4648`) is accurate.
* Nothing else touched — the commit is one file, `+39/-5`, no test or DSP change.

### (f) Clean-code checklist

* One responsibility per change: yes, four independent one-to-three-line fixes.
* No preventive API: no new function, no new exported symbol, no new field on the wire. `mutable
  uint64_t` × 2 is the minimum that satisfies the request, and it follows the file's existing
  `mutable needs_repack` (`:467`).
* Comments only WHY/traps: mostly yes; the exceptions are B8 (three false clauses) and the stale
  `pipeline` field comment (`htp/matmul-ops.h:113`, carried).
* Every stated invariant true: no. B8 × 3, B5, and the counters' comment (`:453-454`) is true but the
  *log label* it feeds (`:4061`) is not.
* `%llu` with `(unsigned long long)` casts on `uint64_t`: correct.
* **Test coverage: none.** `git show --stat df538c50c` is one host file; `tests/hexagon-sim/` is
  untouched. The sims exercise the DSP kernels, not `ggml_hexagon_precompute_hvx_mm_params`, the
  parser or the counters, so none of the four changes has an executable check. The previous commit
  added four negative controls for its own changes; this one adds none. Not blocking (the code is
  simple) but every gate above is manual as a result.

### Dead code (last)

**None introduced.** `opt_rawrow_probe` is written at `:7489-7498` and read once at `:4604`;
`n_rawrow_chosen` / `n_rawrow_vtcm_fallback` are written at `:4637`/`:4650` and read once at `:4062`;
`probe_bits`, `end`, `errno` are all used; `opt_raw_local` gains one reader at `:2274`. `env`/`end` do
not shadow anything. No `static` function is left unreferenced, no `#define` left unused.

---

## Gates for the S23 session, in order

1. Per arm: the profile must show kernel tag **`hvx-rawrow`** (`htp-opnode.h:332`). Absent → the probe
   did not run or a budget miss moved that matvec to flat → discard the arm. This is the only
   trustworthy per-matvec evidence; the teardown counters are not (B2).
2. Per arm: `--load-mode none`, and the run log must **not** contain
   `GGML_HEXAGON_HOSTBUF + GGML_HEXAGON_RAW_HMX with mmap` (`llama-model-loader.cpp:1130`).
3. Per arm: `memory-path env:` must be present and `RAWROW_PROBE=` must equal the intended value;
   `ignoring invalid GGML_HEXAGON_RAWROW_PROBE` must be absent. Record the literal env string anyway.
4. Per arm: `pp512` unchanged across arms. Any movement = misconfiguration.
5. `RAW_LOCAL` arm only: `-v GGML_HEXAGON_VERBOSE=1`, and `grep "supports-op MUL_MAT" | grep
   HTP0:0-HOST` must be **empty** for the Q4_0 matmul weights (B4). Report the arm as placement
   evidence, never as a speed comparison, and never with `HOSTBUF_UNCACHED`.
6. Arm 1: fixed `-n`, no KLD/perplexity, no output inspection.
7. Report arm 0 as "one copy + activation `l2fetch`", not as `974a31e79`; state that arms 1/2/4 are
   not additive; state explicitly that `RAW_LOCAL` cannot separate memory path from kernel in this
   backend (B1) so the split of the 15.5 vs 22.4 gap rests entirely on arms 2 and 4.