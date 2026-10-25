# AUDIT step B — hostile audit of `e3c43a9db` (upstream b11304 merge into kalsallama main)

Auditor: hostile review session. Date 2026-09-30. **Critique only** — nothing in
`~/Projects/kalsallama` was edited, built, committed or fixed. All builds/tests ran in two
throwaway worktrees (`/tmp/aud-e3c43a9` = the merge commit, `/tmp/aud-ours` = our side
`5de9fa2fc`), both removed at the end. No delegation, no sub-agents. English only.

Basis verified on disk:

```
e3c43a9db7427d91c4646529fb54d2c708b201a7
  parent 1  5de9fa2fcdbfce5d326973f047f463245ba00c6d   (our single engine line)
  parent 2  81ff93ea1d48c0482508d30e75b814df99c25bf0   (upstream tag b11304)
  merge base 4bc272fd7 ; 260 commits ours, 301 upstream
git status -> only ?? CMakeUserPresets.json (pre-existing, untracked, absent from both parents)
git ls-files -u -> 0 ;  find *.rej/*.orig/*.bak -> nothing ;  iqp references tree-wide -> 0
```

---

## VERDICT: **SHIP with one blocking list item**

The merge is mechanically sound: 5 of the 8 conflicted files received upstream's patch
byte-for-byte, 3 are genuine hand-stitches, and all 3 are correct. The `mul_mat_id`
work-buffer question the brief asks about is **not** a bug — I proved it statically and then
empirically at 30 production-shaped cases. The one thing that genuinely breaks is
**out-of-repo**: `llama-bench -nr` is gone and 13 executable call sites in
`kalsa-moe-experiments` break on it. That is not a reason to hold the merge; it is a
follow-up ticket that must not be forgotten, because those scripts are the evidence base of
the phone campaign.

**Blocking (fix before the merge is used for anything that runs the lab bench harness):**

| # | finding | why blocking |
|---|---|---|
| B1 | `llama-bench -nr` / `--no-repack` / `--no-extra-bufts` removed; 13 executable callers | every one hard-fails (exit 1 + usage on stdout), and 3 PowerShell guards read a `no_repack` jsonl field that no longer exists |

**Not blocking but open (carry as a ticket):** I1 (shared-KV mirror invariant still has zero
passing tests after a merge that rewrote that exact code), I2 (MTP+hybrid path is 77
UNTESTED on both sides of the merge), I3 (`ggml-cpu.c` now depends on a transitive
`ggml-cpu.h` include), I4 (+n_threads·512 KB CPU work buffer on x86), I5 (report
inaccuracies).

---

# 1. The eight conflicted files

## 1.1 `ggml/src/ggml-cpu/ggml-cpu.c` — **PASS** (the brief's heap-overflow question: no)

The brief's worry: "is the work-buffer size for `mul_mat_id` with tiled + our fused scratch
correct for EVERY path?" I walked every path. Then I built a harness for the one path no
test in the repo covers. Result: **no overflow, and no silent fusion loss.**

### Plan side, merged (`ggml-cpu.c:3207-3237`)

```c
                case GGML_OP_MUL_MAT_ID:
                    {
                        cur = 0;
                        ...
                        // fused FFN scratch (used only when matcher fires; leftover is harmless)
                        // hidden_ff[k, n_ff] F32 + quantized hidden_ff[k, n_ff] + q_input already partly counted
                        cur += ids->ne[0] * src0->ne[1] * sizeof(float);           // hidden_ff
                        // q_hidden is covered by the *double* Q8_0 term from gate+up
                        // (2 * 1.0625 B/el >= Q8_K 1.1406); +256 is alignment, not Q8_K-row slack.
                        cur += ids->ne[0] * ggml_row_size(GGML_TYPE_Q8_0, src0->ne[1]) + 256;
                        cur += ggml_row_size(GGML_TYPE_Q8_K, src0->ne[0]) + 256;   // q_input slack if src0 is down-shaped
                        // Workspace for tiled (see tiled.h)
                        cur = GGML_PAD(cur, 64);
                        cur += ggml_tiled_wdata_size(n_tasks, node);
                    } break;
```

### Runtime side, merged (`ggml-cpu.c:1890-1909`)

```c
    char (*atomic_current_chunk)[CACHE_LINE_SIZE] = // [n_as]
        incr_ptr_aligned(&wdata_cur, CACHE_LINE_SIZE * n_as, CACHE_LINE_SIZE);

    // Tiled matmul (see tiled.h); per-thread work buffers, 0 bytes when disabled. The
    // reservation is unconditional, the per expert eligibility is decided at dispatch time
    char * tiled_scratch = incr_ptr_aligned(&wdata_cur, ggml_tiled_wdata_size(nth, dst), 64);

    GGML_ASSERT(params->wsize >= (size_t)((char *) wdata_cur - (char *) params->wdata));
```

Term-by-term the plan is a strict superset of the runtime reservation:

| term | plan | runtime | delta |
|---|---|---|---|
| converted src1 | `row_size(vdt,nelements)` + 8 | `row_size(vdt,nelements)` | +8 |
| matrix_row_counts | `n_as*8 + 8` | `n_as*8` (align 8) | +8 (+pad) |
| matrix_rows | `n_as*k*ne1*8 + 8` | same | +8 (+pad) |
| atomic_current_chunk | `64*n_as + 64` | `64*n_as` (align 64) | +64 |
| fused-FFN scratch | 3 terms | 0 | + |
| rounding | `GGML_PAD(cur,64)` | align-8/64 pads ≤ 21 B | PAD(64) ≥ pads |

The three per-region alignment pads sum to at most 21 bytes; the plan's four explicit
slack terms sum to 88 and the final `GGML_PAD(...,64)` rounds up. **Plan ≥ runtime for all
shapes, unconditionally.**

Three specific sub-questions, answered:

1. **`n_tasks` (plan) vs `nth` (runtime) in `ggml_tiled_wdata_size`.** Not a hazard.
   `ggml_get_n_tasks` (`ggml-cpu.c:3159`, table at `3148-3152`) returns `n_threads` for both
   `GGML_OP_MUL_MAT` and `GGML_OP_MUL_MAT_ID`, and `params->nth == cplan.n_threads ==
   n_threads`. Same value, and even if they differed the plan's copy is the larger
   direction only when `n_tasks >= nth`, which cannot happen here.
2. **Does the fused-FFN scratch collide with the tiled scratch?** No. The fused FFN
   (`ggml_compute_forward_moe_swiglu_id_fused`, `ggml-cpu.c:3489-3496`) writes from
   `params->wdata[0 .. need)` where `need = 64 + row_size(vdt_gate,n_embd) + 64 +
   k*n_ff*4 + 64 + k*row_size(vdt_down,n_ff) + 64 + 64 + 64` (guard at `3903-3912`). The
   tiled scratch is at the *tail* of the buffer. For the only shapes where both are eligible
   (x86, Q5_K/Q6_K, no repack extra) the tiled term alone is `64 + nth·512 KB`, so `need` is
   always met and the two regions cannot intersect. There is also a runtime guard:
   `if (params->wsize < need) return 0;` — worst case is a silent *decline* of the
   optimization, never an overflow.
3. **The path where the plan's MUL_MAT_ID formula is bypassed entirely.** `ggml-cpu.c:3165`:
   `if (!ggml_cpu_extra_work_size(n_threads, node, &cur)) { ... }`. When src0 lives in the
   CPU-REPACK extra buffer, the repack trait's own `work_size()` is used instead
   (`traits.cpp:37-48`) — so neither the fused-FFN terms nor the tiled reservation are
   added. That is correct, and consistent on both sides: `ggml_tiled_supported()` returns
   false when `src0->extra != NULL` (`tiled/tiled.cpp`, "repack-buffer weights hold a
   repacked layout"), and both fused matchers refuse a tiled extra
   (`ggml-cpu.c:96`, `3735-3737`).

### Empirical proof of the fused path (this had ZERO coverage)

`test-backend-ops` only builds single-op graphs, so the 5-node MoE SwiGLU FFN core that
`ggml_cpu_try_fuse_moe_ffn()` matches is **never executed by any test in the repo** — not
before the merge, not after. I wrote a scratch harness in the throwaway worktree
(`tests/test-audit-moe-ffn-ws.cpp`, never committed) that builds the exact production node
sequence from `llama-graph.cpp:2180-2340` (`mul_mat_id(up)`, `mul_mat_id(gate)`,
`swiglu_split`, `mul_mat_id(down)`, `mul`, plus the k-view/(k−1)-add reduce tail) and A/Bs
`GGML_MOE_FUSED_FFN=1` against `=0`:

```
30 cases:  q4_K / q5_K / q6_K
           n_expert 8, 32, 128, 160, 256
           n_embd 512 … 4096,  n_ff 256 … 3584,  k = 1, 4, 8,  reduce on/off
GGML_MOE_FUSED_FFN_PROFILE=1 -> "bmoe-repack-trace: FUSED_FFN k=1 n_ff=256 n_embd=512 …
                                gate_buft=CPU extra=0 path=vec_dot"   (fused path really fires)

k = 1 (every production decode shape): 24 / 24 BIT-IDENTICAL fused vs stock
k > 1 (n_expert_used > 1, one token):  6 / 6 max rel. diff 1.2e-7 … 1.5e-7  (reduce order only)
no GGML_ASSERT fired; no wsize shortfall; graph_compute returned SUCCESS everywhere
```

**Verdict: CONFIRMED SAFE.** The fused-FFN accounting is correct for every production shape,
and the ~1e-7 delta at k>1 is float32 reduce-order, not a sizing artefact.

`test-backend-ops -o MUL_MAT_ID -b CPU`, as the brief asked, with large expert counts:

```
GGML_MOE_FUSED_GEMV=0  ->  967/967 tests passed, 3/3 backends passed, 0 FAIL
GGML_MOE_FUSED_GEMV=1  ->  967/967 tests passed, 3/3 backends passed, 0 FAIL
GGML_CPU_TILED_MM=0    ->  MUL_MAT,MUL_MAT_ID 2307/2307   (A/B is a no-op on ARM, as designed)
GGML_CPU_TILED_MM=1    ->  MUL_MAT,MUL_MAT_ID 2307/2307
```

Coverage behind those numbers: `n_mats` ∈ {1,2,3,4,5,8,16,28,32,64,128,512,1024},
`n_used` ∈ {1,2,4,6,8,10,16}, 28 src0 types including all five k-quants. The fused-GEMV
path really is under test: the ref buffer is a plain `CPU` buffer (`extra=0` in the
`bmoe-repack-trace` line), so `ggml_cpu_mul_mat_id_should_fuse()` returns true for
`ids->ne[1]==1` and the virtual-tall-GEMV kernel is what produces the 967 passes.

### What is actually wrong in this file (not the sizing)

**I3 — `ggml-cpu.c` lost `#include "ggml-cpu.h"` and now compiles only by accident.**
*PLAUSIBLE, latent, not a current break.*

The merge patch is upstream's plus exactly one extra deletion:

```
ours..merge changed-line delta vs base..upstream changed-line delta:
  only in merge patch:  -#include "ggml-cpu.h"
```

`ggml-cpu.h` was **never in the base and never in upstream** — our side *added* it
(`5de9fa2fc:ggml-cpu.c:6`) and the resolution dropped it. It happens to be harmless *today*
only because the type it provides arrives transitively:

```
ggml/include/ggml-cpu.h:148:  typedef void (*ggml_cpu_expert_ready_hook_t)(const struct ggml_tensor * src0, int expert, void * user_data);
ggml/src/ggml-cpu/vec.h:8:     #include "ggml-cpu.h"
ggml/src/ggml-cpu/ggml-cpu.c:13: #include "vec.h"
```

Failure scenario: any upstream commit that stops `vec.h` from including `ggml-cpu.h`, or
stops `ggml-cpu.c` from including `vec.h`, breaks the build with
`unknown type name 'ggml_cpu_expert_ready_hook_t'` at `ggml-cpu.c:61` — a confusing error
in a file that "does not use the header". Fix: restore the direct include. The step-B
report's justification — "`ggml-cpu.h` include NOT re-added (upstream removed it)" — is
**factually wrong** and should be corrected in the record so the next merge does not repeat
the decision.

**I4 — a new per-context CPU work buffer of `64 + n_threads × 512 KB` on x86.**
*CONFIRMED, informational.* `ggml_tiled_wdata_size` = `64 + n_tasks * 512 KB`
(`tiled/tiled.cpp:658`, `TILED_WS_SLOT` at `tiled-kernel.h:25`) and is now added to the plan
for every eligible MUL_MAT / MUL_MAT_ID node. On a 16-thread desktop CPU context that is
**+8 MB of compute buffer that did not exist before**; on the Lenovo 185H (22 threads) it is
+11 MB; on the Surface (8 threads) +4 MB. It is 0 on ARM (`ggml_tiled_supported()` is
`return false` off x86-AVX) and 0 with `GGML_CPU_TILED_MM=0`. Material only for the
Surface-class RAM budget in the desktop MUST-VERIFY list.

### Everything else in the file: intact

- expert-ready hook (`5236140e5`): called on the fused-GEMV path (`1781-1783`), inside the
  fused FFN for all three of gate/up/down (`3513-3516`), and — correctly — **before**
  upstream's per-expert `tiled` dispatch (`1987` hook, `1992` tiled), so the streaming
  engine still blocks before a tiled read.
- dispatch order `fused-GEMV → per-expert {hook → tiled → stock}` (`1972`, `1987-1992`).
- fused matchers' guards intact: `use_ref`, env, `extra_is_tiled`, `ids->ne[1] != 1`,
  k-quant only, `n_k_tiles`/weights geometry, `span_has_external_use`, `wsize` guard.
- `iqp` fully gone, zero references tree-wide; the include set carries
  `repack-q23k.h` **and** `tiled/tiled.h` (`ggml-cpu.c:17-18`).

## 1.2 `ggml/src/ggml-cpu/repack.cpp` — **PASS**

Our 876-line q23k family plus upstream's 412-line Q1_0 pair. The hand-written instance
region keeps the **file-static** trait scheme (required by `ggml_cpu_repack_extra_is_tiled`'s
pointer-equality `k_tiled` set) and hoists upstream's function-local statics to file scope
to match. I verified the *set*, not the prose — every trait the dispatch can return is in
`k_tiled`, and nothing in `k_tiled` is dead:

```
RETURNED by ggml_repack_get_optimal_repack_type : 25 traits
DECLARED file-static                              : 24 traits (+5 under __riscv_zvfh)
k_tiled                                          : 25 traits
RETURNED but NOT in k_tiled  -> []      (this is the silent-garbage list; empty)
DECLARED but NOT in k_tiled  -> []
k_tiled but never returned   -> []      (no dead entries either)
```

Dispatch-body diff vs upstream is exactly our two branches and nothing else — upstream's
Q4_0 / Q4_K / Q2_K / Q5_K / Q6_K / IQ4_NL / MXFP4 / Q8_0 / Q1_0 / RISC-V arms are all
intact, our `Q2_K → q2_K_8x4` and new `Q3_K → q3_k_8x4` NEON+dotprod arms are inserted in
front of the RISC-V arm (unreachable on RISC-V, since NEON is not defined there). No
duplicated branch, no lost arm.

*Hostile check, refuted:* hoisting 24 `tensor_traits` objects from function-local `static`
(lazy construction) to file scope (static-init-time construction) is a classic
static-init-order trap. It is safe here — `tensor_traits` has no data members and an
implicitly-defined trivial constructor (`repack.cpp:4922-4924`), so they are
constant-initialized vtables with no dependency on any other translation unit's init.
**REFUTED.**

*Unrelated observation:* the q23k 8x4 `work_size`/`compute_forward` pair is exactly
self-consistent — `work_size` returns `row_size(PARAM_TYPE, ggml_nelements(op->src[1]))`
and `forward_mul_mat_id_q23k` asserts `params->wsize >= row_q8 * nrows_b`, which is the
same product, and it needs no mapping table or atomic counter. Verified.

## 1.3 `src/llama-context.cpp` — **PASS**

`balloc->init(batch_inp, vocab, output_all)` (upstream `fc343a84b` batch_ext signature) and
our pressure block coexist, in the right order:

```c
    // report memory utilization BEFORE this batch is processed: once a batch
    // no longer fits, proactive compaction is already too late
    if (memory_pressure_cb) { ... memory_pressure_cb(used_frac, memory_pressure_user_data); ... }
    ...
1785:    if (!balloc->init(batch_inp, vocab, output_all)) {
```

`ctx_other` generalisation is correct and does not shadow the new EAGLE3/DFLASH arm:

```c
144:    if (model.arch == LLM_ARCH_GEMMA4_ASSISTANT) { if (params.ctx_other == nullptr) throw ...; }
152:    if (params.ctx_other != nullptr) { cparams.ctx_other = params.ctx_other; }
160:    if (model.arch == LLM_ARCH_EAGLE3 || model.arch == LLM_ARCH_DFLASH) { ... cparams.ctx_other = params.ctx_other; }
```

*Hostile check, refuted — the thing I expected to break:* upstream added a **second
overload** `int decode(const llama_batch_ext &)` plus a compat
`int decode(const llama_batch &)`. If the compat one had a real body, our pressure hook
would have been orphaned for every `llama_decode()` caller. It does not — the compat
overload just forwards:

```c
int llama_context::decode(const llama_batch & batch_inp) {
    llama_batch_compat compat(this, batch_inp);
    return decode(*compat.batch_ext);
}
```

So there is exactly one decode path and the hook is still on it. **REFUTED.**

`perf_reset` (`3466-3476`) keeps our `synchronize()` + `t_compute_start_us`/
`n_queued_tokens` zeroing, and the merged `synchronize()` still has the identical contract
(`t_eval_us += … ; n_queued_tokens = 0; t_compute_start_us = 0;`), so the comment is still
true. `test-perf-reset` → **EXIT=0**, `perf_reset_async_prompt=PASS`, `perf_reset_old_behavior=PASS`.
The `has_mtp_weights()` init guard and `llama_memory_set_pressure_callback` are present.

## 1.4 `src/llama-model.cpp` — **PASS**

```c
1809:    // per-tensor activation precision policy
1810:    prec_policy.load(ml, *this);
1811:
1812:    ml.init_mappings(params.mmap_prefetch >= 0, use_mlock ? &pimpl->mlock_mmaps : nullptr);
```

Both sides' intents are kept, in upstream's order, and ours wins the one contested argument.
`mmap_prefetch` keeps its documented tri-state contract
(`include/llama.h:355-357`: `0 = auto (prefault on), 1 = forced, -1 = disabled`); the merged
predicate `>= 0` maps 0 and 1 to prefault and only negatives to off, which matches the
document. `prec_policy` runs *before* `init_mappings`, so a W4A4 type change is accounted
for in the mapping — same as upstream.

Upstream's `llama_prefetch_rows` (`185103dcf`) is orthogonal: it is gated on
`ml.lazy.has(per_layer_tok_embd)` for Gemma 4 only, and the app never passes `-lzm`, so it is
not reached on the pinned models. *Refuted as a merge hazard; keep on the desktop verify list.*

`create_memory` sharing: the `mem_share_iswa` / `mem_share_kv` `dynamic_cast` pair, the
WARN-not-throw degradation, and the two `mem_other` rejections (recurrent, hybrid-SWA) are
all intact. *Note (pre-existing, not merge-caused):* upstream added
`llama_kv_cache_dsa`, `llama_kv_cache_dsa_iswa` and `llama_memory_hybrid_idx`; none of them
is a subclass of `llama_kv_cache` and none is plumbed through `mem_other`, so a drafter
against a DSA/GLM-5.3 target degrades to the `not sharing cells: the other context's memory
is of another class` WARN instead of sharing. Identical behaviour on both sides of the
merge. Log it as a feature gap, not a regression.

## 1.5 `src/llama-memory-hybrid.cpp` — **PASS**, with one latent trap worth naming

Resolution shape is exactly what the spec asked for: the fork's guard first, then upstream's
try/catch.

```c
void llama_memory_hybrid::state_read(llama_io_read_i & io, llama_seq_id seq_id, llama_state_seq_flags flags) {
    if (shared) {
        throw std::runtime_error("state IO is not supported on a shared hybrid memory");
    }
    const bool read_attn = (flags & LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY) == 0;
    if (read_attn) { mem_attn->state_read(io, seq_id, flags); }
    try {
        mem_recr->state_read(io, seq_id, flags);
    } catch (...) {
        // the attention part is already restored - undo it
        if (read_attn) { mem_attn->state_clear(seq_id); }
        throw;
    }
}
```

`shared_fence` is **byte-identical** to step A (diff of the function body is empty). All 12
fence sites (`init_batch`, `init_update`, `clear`, `seq_rm`, `seq_cp`, `seq_keep`, `seq_add`,
`seq_div`, plus `get_can_shift`) survived. `get_used_frac()` → `mem_attn->get_used_frac()`
and the `mem_other` ctor parameter are intact.

**The latent trap (PLAUSIBLE, currently unreachable — I looked hard for the live path).**
Upstream's `08618ff8e` added `llama_kv_cache::state_clear()` — a *new cell-mutating method
on a class the fork has turned into a mirror*. I enumerated every `llama_kv_cache` method in
the merged tree and checked which ones carry the `other` guard:

```
GUARDED  clear, seq_rm, seq_cp, seq_keep, seq_add, seq_div, seq_pos_min, seq_pos_max,
         init_update, apply_ubatch, state_write, state_read_sinfo
NO-GUARD get_used_frac, init_batch, init_full, prepare, find_slot, get_can_shift,
         state_read, state_write_meta, state_write_data, state_read_meta,
         state_read_data, state_clear, state_clear        <-- both overloads
```

`state_clear` is the **only mutating** method in the no-guard list, and it does
`seq_rm(seq_id,-1,-1)` plus `llama_clear_tensor_data()` over every layer's K and V. If a
shared view ever reached it, it would zero the *owner's* cells. It is unreachable today for
three independent reasons, all verified:

1. the only caller that can see a shared view is the `catch` above, and the `shared` guard
   throws before the try block;
2. `llama_kv_cache_dsa::state_read` (`llama-kv-cache-dsa.cpp:176`) passes `nullptr` for
   `other` when it builds `kv_mla`/`kv_lid` (`llama-kv-cache-dsa.cpp:33-37`), so those are
   never views;
3. `llama_memory_hybrid_idx::state_drop` (`llama-memory-hybrid-idx.cpp:318`) is a brand-new
   upstream class with no sharing concept at all.

So: **not a live bug, but the 13th mirrored method and nobody added the guard.** The next
`state_*` addition upstream will not be caught by anything. Add the `if (other) return;` to
both `state_clear` overloads while the mirror contract is still half-landed.

## 1.6 `tools/llama-bench/llama-bench.cpp` — **B1, the one blocking item**

Upstream taken wholesale, per the owner decision. `-nr` is gone:

```c
367:    std::vector<bool>                repack;          // was: no_repack
410:    /* repack               */ { llama_model_default_params().use_extra_bufts },
488:    printf("  --repack <0|1>                                    (default: %s)\n", ...);
911:    } else if (arg == "--repack") { ... }   // was: arg == "-nr" || "--no-repack" || "--no-extra-bufts"
1254:   mparams.use_extra_bufts = repack;      // polarity inverted: was !no_repack
```

**Proven, not inferred.** Built `llama-bench` in the scratch worktree and ran it:

```
$ ./build-aud/bin/llama-bench -nr -m ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf \
      -p 0 -n 2 -r 1 -ngl 0 -t 4 -o jsonl
error: invalid parameter for argument: -nr
EXIT=1
<stdout is the usage text, not JSON>

$ ./build-aud/bin/llama-bench --repack 0 -m ... -o jsonl
rows 1
{'repack': False, 'n_prompt': 0, 'n_gen': 2}        # field renamed AND inverted
```

Blast radius, precisely scoped. `llama-cli` / `llama-server` / `llama-completion` are
**unaffected** — they get the flag from `common/arg.cpp`, which is untouched:

```c
common/arg.cpp:2418    add_opt(common_arg(
common/arg.cpp:2419        {"--repack"},
common/arg.cpp:2420        {"-nr", "--no-repack"},
common/arg.cpp:2422        string_format("whether to enable weight repacking (default: %s)", params.no_extra_bufts ? "disabled" : "enabled"),
common/arg.cpp:2424        params.no_extra_bufts = !value;
```

So every `llama-cli --no-repack` caller keeps working (`results/gpu_sustained*/run_marathon.sh`,
`reports/moe-gpu-sustained.md`). Only **`llama-bench` invocations** break. Full list:

**Executable `llama-bench -nr` callers (13 files, 19 call sites) — all break, exit 1:**

| file | lines |
|---|---|
| `~/Projects/kalsa-moe-experiments/results/xiaomi750_validation/raw/b/one_cell.sh` | 23 |
| `~/Projects/kalsa-moe-experiments/results/xiaomi750_validation/raw/d/one_cell_d2.sh` | 23 |
| `~/Projects/kalsa-moe-experiments/results/ngl_sweep_s23/device/kalsa_q44/driver.sh` | 232, 253, 304 |
| `~/Projects/kalsa-moe-experiments/results/ngl_sweep_s23/device_snap_ngl0/kalsa_q44/driver.sh` | 232, 253, 304 |
| `~/Projects/kalsa-moe-experiments/results/ngl_sweep_s23/device/kalsa_q44/continue_driver.sh` | 233, 254, 323 |
| `~/Projects/kalsa-moe-experiments/results/olmoe_gpu_moe_s23/armC/one_cell_armc.sh` | 27 |
| `~/Projects/kalsa-moe-experiments/results/vulkan_vs_opencl_s23/one_cell_cl.sh` | 12 |
| `~/Projects/kalsa-moe-experiments/results/vulkan_vs_opencl_s23/one_cell_vk.sh` | 14 |
| `~/Projects/kalsa-moe-experiments/results/kexp_speed_s23/n5/one_cell_n5.sh` | 27 |
| `~/Projects/kalsa-moe-experiments/results/mellum2_cpu_baseline_s23/one_cell_m2cpu.sh` | 26 |

**PowerShell guards that read the now-nonexistent `no_repack` jsonl field — also break
(a `throw`/`Abort-*` fires before the first measurement):**

| file | line |
|---|---|
| `~/Projects/kalsa-moe-experiments/results/olmoe_gpu_moe_s23/armC/run_armc.ps1` | 788 |
| `~/Projects/kalsa-moe-experiments/results/kexp_speed_s23/n5/run_n5.ps1` | 825 |
| `~/Projects/kalsa-moe-experiments/results/mellum2_cpu_baseline_s23/run_m2cpu.ps1` | 189, 194 |

**Nothing in `~/Projects/kalsa/scripts` and nothing in `~/lab` calls `llama-bench -nr`.**
`~/Projects/kalsa/scripts/device-decode-lineup.sh:78` is the only `llama-bench` caller there
and it passes none of the three spellings.

**Not code (documentation, should be corrected before they mislead the next session):**
`results/barrier_verify_s23/MANIFEST.md:142` states "`--no-extra-bufts` is accepted as a
legacy alias in the parser" — it is not any more;
`results/kexp_speed_s23/PREREG_KEXP_N5.md:13` and `:26` make `-nr` **mandatory on all three
ship arms** and is the *product* no-repack configuration, i.e. the whole prereg's
"productized, device-smoked equivalent" sentence is now unreproducible;
`results/gpu_sustained*/run_marathon.sh:52` (`--no-repack`) and
`reports/moe-gpu-sustained.md:26` are **llama-cli** and remain valid.

Failure scenario for each: the harness writes the *usage text* into the file its own JSON
parser then reads, so the run either dies on a parse error or — worse for a `.ps1` guard —
`$parsed.no_repack` is `$null`, the `-nr mandatory` assertion fires, and the whole
palindromic A/B/C block is abandoned mid-session with a partially-written `raw/` tree.

Fix (one line per file, out-of-repo, so it is a ticket not a merge blocker): `-nr` →
`--repack 0`, and `no_repack` → `!repack` in the three guards. The archived
`results/barrier_verify_s23/bench_nr.out` / `bench_alias.out` are historical evidence and
should be left alone.

## 1.7 `tests/CMakeLists.txt` — **PASS**

Upstream's patch applied byte-for-byte (changed-line sets identical). Our 40 governor/repack
references all present (`test-repack-q23k-m0..m5`, `-load`, `test-s3-repack-bench`,
`test-opencl-moe-roundtrip`, 14 `test-governor-*`, `test-perf-reset`), inserted between the
`if (APPLE)` block and upstream's now-`AND GGML_CPU` guard, with every
`target_include_directories(... ${PROJECT_SOURCE_DIR}/src)` and every
`FIXTURES_REQUIRED test-download-model` intact. Upstream's new
`llama_build_and_test(test-tiled-mulmat.cpp)` and the
`test-recurrent-state-rollback` `--models "${MODEL_DIR}"` rewrite came through. No duplicate
or orphaned target; all 14 governor targets + 8 repack targets + `test-tiled-mulmat` +
`test-perf-reset` configure **and build**.

## 1.8 `tests/test-backend-ops.cpp` — **PASS**

Upstream's usage rewrite plus our two doc lines, and both of our features still work:

```
12928:  printf("    -t <n> compute threads for ggml_backend_set_n_threads (default: hardware_concurrency)\n");
13004:  } else if (strcmp(argv[i], "-t") == 0) { g_n_threads = atoi(argv[++i]); ... }
13064:  const int nth = effective_n_threads(); ggml_backend_set_n_threads_fn(backend.get(), nth);
```

`-t` does not collide with anything upstream added (`-o`, `-b`, `-p`, `--output`,
`--list-ops`, `--show-coverage`, `--test-file`, `-j`, `test/perf/grad/support`). All our
hooks present: `GGML_TEST_PLAIN_HOST`, `GGML_TEST_EXTRA_MM`, `EXTRA_MM_FIRST`,
`g_ref_buf_mutex` (7 sites), `scan_quant_fp16_scales`, `half_is_nan/inf`,
`quant_fp16_scale_count`, `tensor_is_plain_cpu`, `type_is_mxfp4`. Our `[ref-buf]` banner
fires on every run. NPU-judge lineage (`28b9a1351`…`bc6729409`) auto-merged intact.

One behaviour note, not a bug: our `-t` defaults to `hardware_concurrency()` and now calls
`ggml_backend_set_n_threads` on **every** backend where upstream previously left it alone.
On a many-core lab host that changes the default thread count of the harness. Documented in
the usage line; no action needed unless a perf number is compared across a `-t` change.

---

# 2. CLEAN-merged files where upstream changed behaviour our code depends on

33 files were touched by both sides. I checked all 33 mechanically — the merge result
carries upstream's changed-line set exactly for 30 of them. The 3 exceptions:

| file | delta | verdict |
|---|---|---|
| `ggml/src/ggml-backend.cpp` | upstream-only 5 lines, merge-only 0 | **benign** — both sides made the *same* change. Upstream's `if (!ggml_gallocr_reserve_n(...)) { GGML_LOG_ERROR(...); return false; }` is already in our base (commit `0c4d75fa5` + its `4d46cb61c`/`722c07078`/`34fca920f` follow-ups), so the merge text is identical. **No loss.** |
| `ggml/src/ggml-opencl/ggml-opencl.cpp` | 2 vs 2 | **benign** — pure re-indentation of `img_desc.image_width = (size_t)K * N_pad;` (upstream) and `const bool is_mixed = q->type == …` (ours). Both merged to upstream's indentation. All 3 occurrences of `image_width` match upstream byte-for-byte. |
| `ggml/src/ggml-cpu/ggml-cpu.c` | 0 vs 1 | see I3 above (the dropped `ggml-cpu.h` include). |

`ggml/src/ggml-cpu/arch-fallback.h` and `repack.h` — where both sides added `#define`s /
declarations to the *same* blocks, the classic hand-merge trap — verified as exact set
unions: `#define` count base 66 → ours 70 / upstream 70 / **merge 74**; `MISSING from merge: []`,
`EXTRA in merge: []`; same for every `ggml_gemv_*` / `ggml_gemm_*` declaration in `repack.h`.
Nothing of the q23k 8x4 family and nothing of upstream's Q1_0 pair was lost on either the
x86, the NEON or the RISC-V arm.

## 2.1 KV cache / memory-hybrid / recurrent — `08618ff8e`

*Refuted as a live bug:* upstream replaced the restore-failure cleanup

```c
-            if (seq_id == -1) { clear(true); } else { seq_rm(seq_id, -1, -1); }
+            state_clear(seq_id, strm, sinfo);
```

with a `state_clear` that additionally zeroes K/V. The fork's `other` guard is the **first**
statement of `state_read_sinfo`, before the row-mapping build, so a shared view returns
before the new call is reachable. Verified by reading the merged
`llama_kv_cache::state_read_sinfo`. See the latent-trap note in §1.5 for the guard inventory.

## 2.2 `llama-graph` attention placement — no fork dependency

`src/llama-graph.cpp` is **not** in our side's changed set (`git diff --name-only
4bc272fd7 5de9fa2fc`), so upstream's attention-placement changes touch no fork code. Our
MoE-FFN node ordering that `ggml_cpu_try_fuse_moe_ffn` matches against
(`llama-graph.cpp:2211-2333`: `up` before `gate`, `swiglu_split`, then `down`, `mul`, then
views/adds) is intact in the merge and is what my harness reproduced. **REFUTED.**

## 2.3 ggml-backend sched `b5cf8ce02` "require input tensors to be GGML_OP_NONE" — **REFUTED**

Upstream added

```c
    for (const auto & [tensor, nodes] : users) {
        GGML_ASSERT(tensor->op == GGML_OP_NONE);
```

I checked the assumption rather than trusting the spec note. `ggml_set_input` /
`GGML_TENSOR_FLAG_INPUT` sites in the tree: `llama-graph.cpp`, `llama-kv-cache.cpp`,
`llama-context.cpp`, `llama-memory-*` — all upstream. The fork-only files that build graphs
(`llama-governor.cpp`, `llama-kv-commit.cpp`, `llama-kv-staged.cpp`,
`llama-hybrid-commit.cpp`, `bmoe/expert_stream_source.cpp`) contain **no** `ggml_set_input`
and no `GGML_TENSOR_FLAG_INPUT`; the only ggml-graph API any of them uses is
`ggml_graph_overhead_custom(4,false)` in `llama-kv-staged.cpp:56` (a node-count budget, not
a flag). **Our governor and kv-commit graphs cannot trip the assert.**

## 2.4 Hexagon host `0c3626ec0` buffer/DMA overhaul — **REFUTED, our gates still correct**

Our two Hexagon changes replayed cleanly into the rewritten buffer/DMA code:

```c
4253+  // Host gate must match the DSP %32 contract on logical N (src0->ne[1]), not just padded N.
4256:  if (ne01_padded % 32 != 0 || src0->ne[1] % 32 != 0) { return false; }
```

I read the DSP side of the *merged* tree rather than assuming the contract survived the
overhaul: `htp/matmul-ops.c:2691`, `:3296`, `:3571` all still carry
`if (k % 32 != 0 || n % 32 != 0) { return -1; }`, and `:2975` carries the weaker
`if (k % 32 != 0) { return HTP_STATUS_NO_SUPPORT; }`. Our host gate matches `n % 32` and is
strictly conservative against the weaker arm. No under-check.

The `HTP_ZERO_TILE_PAD` diagnostic (ours, `#ifdef`-guarded, default off) in
`htp/matmul-ops.c` survived in all 6 insertion points, and upstream's
`dma_make_ptr` → `dma_make_data` migration did not collide with it (it touches argument
construction, we touch the popped buffer contents).

`sess->flush_sync()` before reading `last_error`
(`ggml-hexagon.cpp:6888-6894`) is still correct after the overhaul: `last_error` is written
at `:3558-3559` (sub-session fold-up), `:3590`/`:3592` (RSP status) and reset **only** in the
ctor at `:4050`. Behaviour change worth stating: because it is never cleared per graph, a
single DSP error now makes *every* later `graph_compute` on that session return
`GGML_STATUS_FAILED` instead of the error surfacing later at `synchronize()` (which
`GGML_ABORT`s at `:6905-6907`). That is a better failure mode and it is what
`28b9a1351` asked for, but it does mean one transient DSP fault latches the backend. Note
it; not a merge defect.

## 2.5 OpenCL — our Adreno fixes vs upstream's changes — **PASS**

`ggml-opencl.cpp` received upstream's patch with only the two re-indent lines differing.
Every KALSA block is intact and at the right place: `UNKNOWN_COMPILER` (no guessed E17
offsets), `ggml_opencl_log_alloc` / `ggml_opencl_log_weight_storage_path` /
`ggml_opencl_log_kernel_once`, `throw_set_tensor_upload_error` replacing all 20-odd
`GGML_ASSERT(… "temp upload buffer alloc failed")` / `CL_CHECK(err)` aborts on the weight
path, the `kernel_build_failed` degrade-instead-of-abort, the 4 q2_K/q3_K MoE trans4 kernels,
`GGML_OPENCL_GEMV_AUDIT`, `GGML_OPENCL_DUMP_Q`, the tightened `0.00390625f * ad` tolerance
with the `1e-3` floor removed, and the `#ifdef` guards the binary-kernel carve-out.
`ggml-opencl/CMakeLists.txt` is a clean replay. No duplication, no loss.

*Caveat I cannot close here:* the whole OpenCL half of this fork is **compile+link only** in
this audit. `GGML_OPENCL=OFF` on this Mac, no Adreno, no device work by instruction. The
step-B report's Android `llama-cli` / `libggml-hexagon.so` / `libggml-htp-v73.so` build
EXIT=0 is the only evidence and I did not re-run it. Device behaviour of the Adreno MoE
kernels after an upstream OpenCL delta is **unverified**.

## 2.6 Speculative / NextN row order `4453b535f` — **REFUTED for this merge, live landmine for the next**

`git merge-base --is-ancestor 4453b535f 81ff93ea1` → **false**. The NextN row-reorder commit
is 7 commits past the tag (it is why `upstream/master` was excluded). The MTP row-mapping
risk in the desktop spec is therefore *deferred*, not fixed. Nothing to do now, but the
next merge of `upstream/master` will hit it: it reorders **unmasked** NextN rows through
`embd_batch_idxs` and adds hard asserts (`ubatch.data->batch_idxs.size() == ubatch.n_tokens`,
`embd_batch_idxs.size() == n_tokens_prev`, `row_floats == model.hparams.n_embd`), and our
`common/speculative.cpp` reads NextN rows by batch index. Expect either a silent
acceptance-rate drop or an abort, and note that MTP acceptance cannot be measured on a Mac.

---

# 3. Test evidence (all in the throwaway worktrees, now deleted)

## 3.1 Governor battery — `KALSA_HYBRID_GGUF=~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`

| test | merge `e3c43a9db` | our side `5de9fa2fc` (rebuilt) |
|---|---|---|
| test-governor-v0 | 0 | — |
| test-governor-v0-commit | 0 | — |
| test-governor-v0-devices | **1** | **1** |
| test-governor-v0-hybrid | 0 | — |
| test-governor-v0-mtp-hybrid | **77 = SKIP = UNTESTED** | — |
| test-governor-v0-shared-cells | **1** | **1** |
| test-governor-v0-turns | 0 | — |
| test-governor-v02-router | 0 | — |
| test-governor-bench-route | 0 | — |
| test-governor-bench-route-evidence | 0 | — |
| test-governor-bench-route-latch | 0 | — |
| test-governor-bench-route-setter | 0 | — |
| test-governor-platform-thermal | 0 | — |
| test-governor-v0-route-switch | 0 | — |

I rebuilt the two reds at our side `5de9fa2fc` from scratch and reproduced the **identical
terminal lines**, so both are confirmed pre-existing, not merge-caused:

```
devices:      "governor-devices: automatic staged/naive selection missing"
shared-cells: "shared_fence: memory update is not allowed from shared hybrid memory …"
              "shared_fence: decode is not allowed from shared hybrid memory …"
              "shared-cells: non-owner decode failed on live cells"
```

Other suites, all green in the merge worktree:

```
test-repack-q23k-m0 … -m5, -load   7 × EXIT=0
test-tiled-mulmat                 EXIT=0   (no-op on ARM by design)
test-perf-reset -m <gguf>         EXIT=0   perf_reset_async_prompt=PASS  perf_reset_old_behavior=PASS
test-backend-ops -o MUL_MAT_ID    967/967  (fused-GEMV 0 and 1, tiled 0 and 1)
```

## 3.2 The two holes the battery does not cover — **I1, I2**

**I1 — `test-governor-v0-shared-cells` is the only test of the shared-KV mirror invariant,
and it is red.** The failure is structural, not environmental: the fork's rewritten test
asserts mirror semantics ("view decode goes through", cell ops no-op into success) while
`src/llama-memory-hybrid.cpp:88` `shared_fence` still refuses decode and memory update on
*any* shared hybrid. The test's premise and the code cannot both be true.
*CONFIRMED, inherited, still open.* It matters more after this merge than before: the merge
rewrote `llama-memory-hybrid.cpp` (`state_read` guard + upstream try/catch),
`llama-kv-cache.cpp` (upstream `state_clear`) and `llama-model.cpp` (`mem_other`) — i.e. the
exact three files whose contract this test is supposed to pin. **Shipping the merge leaves
the shared-memory contract with zero passing tests.** The owner decision from step A (finish
the mirror work, or restore the fence-era expectations) is still unmade and is now more
expensive to defer.

**I2 — `test-governor-v0-mtp-hybrid` is 77/UNTESTED on both sides.**
`mtp_hybrid=SKIPPED model has no MTP layers, pass a Qwen3.5-class GGUF with -m`.
LFM2.5-2.6B is `general.architecture = lfm2` — a conv+attention hybrid with **no MoE and no
MTP layers**, so it cannot exercise the MTP-on-shared-hybrid path. Combined with I1, the
most merge-exposed code in this merge (hybrid `mem_other` sharing + `state_read`/`state_clear`
+ the MTP init guard + the pressure callback on the shared path) has **no executed coverage
anywhere on this line**, before or after the merge. Closing it needs one Qwen3-class MTP GGUF
in RAM on the Mac; nothing else.

---

# 4. Findings list, with verdicts

| id | verdict | file:line | finding |
|---|---|---|---|
| **B1** | **CONFIRMED** | `tools/llama-bench/llama-bench.cpp:911` (merged `:911`), `common/arg.cpp:2418-2425` | `-nr`/`--no-repack`/`--no-extra-bufts` removed from `llama-bench`; 19 executable call sites + 4 PowerShell guards in `kalsa-moe-experiments` hard-fail. `llama-cli` unaffected (arg.cpp). |
| I1 | **CONFIRMED** | `src/llama-memory-hybrid.cpp:88` vs `tests/test-governor-v0-shared-cells.cpp` | Shared-KV mirror invariant has no passing test after a merge that rewrote all three files of its contract. |
| I2 | **CONFIRMED** | `tests/CMakeLists.txt:341-343` | MTP-on-hybrid path is `SKIP_RETURN_CODE 77`; the only available fixture has no MTP layers. Zero coverage of the most merge-exposed code. |
| I3 | **PLAUSIBLE** (latent) | `ggml/src/ggml-cpu/ggml-cpu.c:61` | Merge dropped our direct `#include "ggml-cpu.h"`; `ggml_cpu_expert_ready_hook_t` now arrives only via `vec.h`. One upstream include reshuffle away from a confusing build break. |
| I4 | **CONFIRMED** (informational) | `ggml/src/ggml-cpu/ggml-cpu.c:3236`, `tiled/tiled.cpp:658` | New `64 + n_threads × 512 KB` CPU work buffer per context on x86 (+8 MB at 16 threads). 0 on ARM, 0 with `GGML_CPU_TILED_MM=0`. |
| I5 | **CONFIRMED** (report defect) | step-B `REPORT.md` | "upstream removed `#include "ggml-cpu.h"`" is false — our side added it. Correct the record. |
| I6 | **PLAUSIBLE** (latent) | `ggml/src/ggml-cpu/repack.cpp` (`state_clear` is not here) → `src/llama-kv-cache.cpp` | Upstream's new `llama_kv_cache::state_clear()` is the only cell-mutating method without the fork's `other` guard. Unreachable today; the 13th mirrored method with no guard. |
| I7 | **CONFIRMED** (feature gap, not a regression) | `src/llama-model.cpp:2701-2724` | `llama_kv_cache_dsa`, `_dsa_iswa` and `llama_memory_hybrid_idx` are not reachable through `mem_other`; a drafter against a DSA/GLM-5.3 target degrades to the WARN. Identical on both sides. |
| I8 | **CONFIRMED** (behaviour note) | `ggml/src/ggml-hexagon/ggml-hexagon.cpp:6888-6894`, `:4050` | `last_error` is never cleared per graph, so one DSP error now latches `GGML_STATUS_FAILED` for the session. Better than the old abort-at-synchronize, but latching. |
| I9 | **CONFIRMED** (coverage) | fused MoE FFN | `test-backend-ops` cannot reach the 5-node FFN pattern; before this audit it had **zero** runtime coverage anywhere. Now measured at 30 shapes (24/24 bit-identical at k=1). Consider promoting the harness to a real test. |
| — | **REFUTED** | `ggml/src/ggml-cpu/ggml-cpu.c:3207-3237` vs `:1890-1909` | "wrong `mul_mat_id` wsize with tiled + fused scratch = heap overflow". Plan is a strict superset on every path; three independent guards back it. |
| — | **REFUTED** | `repack.cpp:5699-5712` | `k_tiled` missing a reachable trait → silent garbage. `RETURNED \ k_tiled = ∅`; `k_tiled \ RETURNED = ∅`. |
| — | **REFUTED** | `repack.cpp:5470-5492` | File-static hoisting of 24 `tensor_traits` = static-init-order trap. Trivial ctor, no data members, constant-initialised. |
| — | **REFUTED** | `src/llama-context.cpp:4391-4394` | Upstream's new `decode(llama_batch)` overload orphans the pressure callback. It forwards to `decode(llama_batch_ext)`. One path. |
| — | **REFUTED** | `src/llama-context.cpp:1785` | Pressure block placed after / incompatible with upstream's `balloc->init(batch_inp, vocab, output_all)`. Order and signature both correct. |
| — | **REFUTED** | `src/llama-kv-cache.cpp` (`state_read_sinfo`) | Upstream's `state_clear` reached on a shared view via the 08618ff8e cleanup. `if (other) return;` is the first statement. |
| — | **REFUTED** | `src/llama-context.cpp:585-610` (`b5cf8ce02`) | `GGML_ASSERT(tensor->op == GGML_OP_NONE)` trips on a governor / kv-commit graph. No fork-only file sets `GGML_TENSOR_FLAG_INPUT`. |
| — | **REFUTED** | `ggml/src/ggml-hexagon/htp/matmul-ops.c:2691,3296,3571` | Upstream's DMA overhaul changed the DSP-side `%32` HMX contract our host gate mirrors. Contract unchanged. |
| — | **REFUTED** | `src/llama-model.cpp:1810-1812` | `init_mappings(params.mmap_prefetch >= 0, …)` vs upstream's `init_mappings(true, …)` + `prec_policy.load`. Both intents kept, upstream's order, documented tri-state preserved. |
| — | **REFUTED** | `ggml/src/ggml-backend.cpp` | Merge lost 5 upstream lines. Both sides made the identical `sched_reserve` failure-handling change; merge text is byte-identical to both. |
| — | **REFUTED** | `4453b535f` / MTP NextN row order | The reorder is 7 commits past the tag; not an ancestor of `81ff93ea1`. Deferred to the next merge. |
| — | **REFUTED** | `src/llama-graph.cpp` | Upstream's attention placement breaks a fork graph builder. Not in our side's changed set. |
| — | **REFUTED** | `tests/CMakeLists.txt`, `ggml-opencl.cpp`, `arch-fallback.h`, `repack.h` | Duplicated or dropped blocks. All exact set unions / clean replays. |
| — | **CONFIRMED** (pre-existing, not merge-caused) | `test-governor-v0-devices`, `test-governor-v0-shared-cells` | Both reds reproduce identically at `5de9fa2fc`. |
| — | **CONFIRMED** (pre-existing) | `src/bmoe/platform_io.cpp:398`, Android `libllama.so` | `AHardwareBuffer_allocate` undefined without `-landroid`; shared-lib Android link still broken on both sides. Blocks any shared-`libllama` Android delivery chain, not this merge. |
| — | **CONFIRMED** (pre-existing) | `ggml/src/ggml-hexagon/CMakeLists.txt:22` | Plain-cmake Android configure dies without `-DPREBUILT_LIB_DIR=android_aarch64`; only the untracked `CMakeUserPresets.json` supplies it. A fresh clone cannot build the Hexagon backend. |
| — | **NOT VERIFIED** | OpenCL / Adreno, HTP, Hexagon runtime | `GGML_OPENCL=OFF` here, no device work by instruction. Compile+link only. |

---

# 5. Recommended actions, in order

1. **Fix B1 out-of-repo** (19 call sites + 4 guards, `~/Projects/kalsa-moe-experiments`).
   Not a reason to hold the merge; a reason not to run the lab bench harness against it
   before the ticket is closed.
2. **Make the I1 owner decision now**, not after the next merge. The mirror contract has no
   passing test and this merge touched all three of its files.
3. **Get one Qwen3-class MTP GGUF onto the Mac** and run `test-governor-v0-mtp-hybrid` to
   convert 77/UNTESTED into a verdict before the `upstream/master` merge, which will hit the
   `4453b535f` NextN row reorder.
4. Restore `#include "ggml-cpu.h"` in `ggml-cpu.c` (I3) and correct the REPORT's claim (I5).
5. Add `if (other) { return; }` to both `llama_kv_cache::state_clear` overloads (I6) while the
   mirror contract is still the active design.
6. Promote the fused-MoE-FFN harness from §1.1 into a real `llama_build_and_test` target — the
   fused FFN is a production decode path with no coverage (I9).
7. On the next `upstream/master` merge: budget for `+n_threads·512 KB` per context on x86
   (I4) and read the MTP NextN asserts before the first device run.

## 5.1 Note added after cleanup: `main` moved during this audit

The brief pins this audit to `e3c43a9db`, and every finding above is stated against that
commit. While the scratch worktrees were being removed, `main` advanced by four commits —
**by Marco, not by this session** (`git reflog` shows four `commit` entries on top of the
merge's `commit (amend)`):

```
da860fd26  tests : shared-cells picks mirror vs refusal from the fixture's memory type
                (KALSA_PLAIN_GGUF added; exit 77 when a fixture is unset)
87cd9a383  tests : governor-v0-devices skips (77) when no KV commit ran, staged/naive
                assertion intact for runs where commits execute
ad9baa336  kv-cache : shared-view state write/read warn on every skip and name the
                sequence (F5, no behaviour change)
4d89cc436  governor : WHY trim_sequence trusts pos_max over seq_rm's return (F4, comment only)
```

`e3c43a9db` is still an ancestor of `HEAD`. `da860fd26` + `87cd9a383` are test-only and are
aimed squarely at the two reds this audit reports as **I1** and **I2** (they add a
`KALSA_PLAN_GGUF`-style plain fixture and convert both to `77` when the fixture cannot
exercise the assertion). I did **not** audit those four commits — they are outside the brief's
scope. Two consequences for whoever reads this:

- If I1/I2 are considered closed by `da860fd26`/`87cd9a383`, that is only true in the weaker
  sense "the test now skips instead of failing". The underlying contract is still unproven:
  `shared_fence` at `src/llama-memory-hybrid.cpp:88` still refuses decode and memory update
  on any shared hybrid, and the MTP-on-hybrid path still needs a real MTP fixture. A 77 is
  not a pass.
- B1 (the `-nr` breakage) is **not** addressed by any of those four commits; it is
  out-of-repo and still open.

**Scratch worktrees `/tmp/aud-e3c43a9` and `/tmp/aud-ours` were removed after the run. This
session edited nothing in `~/Projects/kalsallama`; `git status` still shows only the
pre-existing untracked `CMakeUserPresets.json`.**
