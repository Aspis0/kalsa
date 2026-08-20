# Max-Recall Hostile Review — Angle 1: CROSS-FILE TRACER + REMOVED-BEHAVIOR
## Cumulative campaign diff `22b69b6e9..eaec5d884` (branch `kalsa/kernel-s3-repack`)

Repo: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge\third_party\llama.cpp`
Scope: 26 commits, +4419/−248, 15 files. Two *intended* compute changes:
byte-wise convert producer (9dc1ec0cb) + shift/mask restore (eaec5d884).

This audit hunts what per-commit reviews could not see: cross-commit and
cross-file interactions. Read-only on code.

---

## 0. Campaign env parsing-discipline table (foundation for #1 & #4)

| Env | Parsing discipline | Default (unset) | Side effect when ON | Reachable when unset? |
|---|---|---|---|---|
| `GGML_OPENCL_ORACLE` | value-parsed (`env_value_enabled`: `1`→on; `0`/`""`/`false`→off; any other non-empty→**on**) | off | compiles 2 extra programs + 4 clCreateKernel; runs oracle q4_0 probe in set_tensor | NO (build gated `if(oracle_enabled())` L4118; probe early-returns on null kernels L7928) |
| `GGML_OPENCL_GEMV_AUDIT` | value-parsed (same helper) | off | AoS stash (set_tensor), dst-snap register, dst readback, post-enqueue bind log | NO (every hook early-returns `if(!enabled())`) |
| `GGML_OPENCL_GEMV_AUDIT_STASH_MB` | int-clamped (`sscanf %d`, 0..4096, def 512) | 512 | cap on stash bytes | only read inside enabled hooks |
| `GGML_OPENCL_GEMV_AUDIT_MAX_DETAIL` | int-clamped (0..64, def 4) | 4 | detail emit count | only read inside audit_q4_0 (which is gated) |
| `GGML_OPENCL_GEMV_AUDIT_DUMP` | int-clamped (0..64, def 12) | 12 | dump element count | only inside audit_q4_0 |
| `GGML_OPENCL_HOST_REPACK` | **presence-only** (`getenv()?1:0`) — INCONSISTENT with value-parsed siblings | off (unset) | bypasses convert kernel; host writes SoA q/d | NO — `else` arm runs the production convert kernel |
| `GGML_OPENCL_DUMP_Q` | **presence-only** — INCONSISTENT | off | reads back extra->q, compares vs host ref | NO |
| `GGML_OPENCL_CVT_VARIANT` | value-parsed string (`""`/`bytewise`→default; `bitselect`→`-D...BITSELECT`; else WARN+default) | `bytewise` | adds build define | NO — default arm adds nothing |
| `GGML_OPENCL_CVT_OPTS` | value-parsed string (raw, appended) | unchanged `compile_opts` | overrides cvt program build opts | NO — `cvt_compile_opts=compile_opts` when unset |
| `GGML_OPENCL_MOE_OPTS` | value-parsed string (raw) | unchanged | (MoE program build opts) | NO |
| `GGML_OPENCL_LOG_WEIGHT_PATH` | value-parsed (`env_value_enabled`) | off | emits `OPENCL_WEIGHT_PATH{...}` per set_tensor branch | NO — early-returns |

**Known trap (presence vs value) acknowledged in source comment L1195:**
HOST_REPACK and DUMP_Q are presence-only while ORACLE/GEMV_AUDIT are
value-parsed. Consequence: `GGML_OPENCL_HOST_REPACK=0` does **NOT** disable
host repack — it ENABLES it (non-empty string). A user who sets `=0` thinking
they are disabling it gets host repack. Symmetrically `GGML_OPENCL_DUMP_Q=0`
enables the q readback. This is a foot-gun, not a default-path bug (default is
unset), but it is an inconsistency that bites an operator who tries to
"explicitly turn it off".

---

## 1. DEFAULT-PATH PURITY (the crux)

**Question:** with ALL campaign envvars unset, is every production code path
byte-identical in EFFECT to merge-base, except (byte-wise convert) +
(shift/mask restore)?

### 1A. The convert/restore dispatch (set_tensor) — CLEAN
`ggml_backend_opencl_buffer_set_tensor` q4_0 trans4 path (L8390–8515),
in execution order, every instrument is gated:
1. `ggml_opencl_log_weight_storage_path(...,"trans4-moe")` — gated by
   `LOG_WEIGHT_PATH` (value-parsed, early-return). No-op when unset. ✓
2. GEMV_AUDIT AoS stash — `if(gemv_audit_enabled() && data)` L8418. Skipped
   when unset. ✓
3. **HOST_REPACK** — `if(getenv("GGML_OPENCL_HOST_REPACK"))` L8446. **The
   `else` arm is the production convert kernel.** Unset → `else` → convert
   kernel runs. ✓ Default lands on the kernel.
4. **DUMP_Q** — `if(getenv("GGML_OPENCL_DUMP_Q"))` L8498. Skipped when unset. ✓
5. `ggml_opencl_oracle_q4_0(...)` L8570 — early-returns on
   `!oracle_enabled()` AND on null kernels (kernels never created when off).
   ✓

Default-path compute = log(no-op)→stash(skip)→**convert kernel (byte-wise)**
→dump_q(skip)→oracle(skip). The convert kernel is intended change #1. ✓

### 1B. The restore path (get_tensor) — CLEAN
`ggml_opencl_gemv_check_dst_readback` L10957 is called after the production
`clEnqueueReadBuffer`. First line `if(!gemv_audit_enabled()||mem==nullptr||...)
return;` L1384. When unset: one getenv, no extra readback, no allocation.
The production read is untouched. ✓

### 1C. The per-enqueue hook — CLEAN (and deliberately getenv-free)
`ggml_opencl_gemv_log_post_enqueue` L6136 is called on every kernel enqueue
(L983, hot path). Body orders the guard `if(gemv_audit_dst_snaps.empty()||
kernel==nullptr) return;` **before** `if(!gemv_audit_enabled()) return;`.
Snaps are only ever filled by gated hooks, so when audit is off the vector is
permanently empty → O(1) empty-check return, **no getenv on the hot path**.
This is explicit in the comment L6137. ✓ Good design.

### 1D. The compute path (mul_mat_id) — one per-call getenv (LOW)
`ggml_opencl_gemv_audit_q4_0` L20511 is called at L21433 (inside the q4_0
MoE GEMV dispatch, i.e. per-MoE-layer-per-token). It calls
`ggml_opencl_gemv_audit_enabled()` (→ `getenv`) as its very first statement
and returns when off. So: **one getenv per MoE GEMV launch on the default
path.** Unlike the per-enqueue hook, this one does NOT cache the flag and
does NOT have an empty-container pre-check (there is no container to check
here). `getenv` is a libc env-traversal (~10²–10³ ns). For a 30B MoE (~64
layers × routed experts) this is ~hundreds of getenvs/token — negligible
against the ms-scale GEMV, but it IS a per-hot-loop getenv that the per-
enqueue hook went out of its way to avoid.

**Verdict 1D — PLAUSIBLE (low severity):** `ggml_opencl_gemv_audit_q4_0`
performs an un-cached `getenv` on the per-token MoE GEMV path. Not a
correctness bug; a minor, fixable perf asymmetry vs the carefully getenv-free
per-enqueue hook. *File: ggml-opencl.cpp:20524 (`if(!enabled())`), called from
L21433.*

### 1E. Unconditional new log emission (MINOR / cosmetic)
`GGML_LOG_INFO("ggml_opencl: program_cvt variant=%s\n", cvt_variant)` L1666
is **unconditional** — it prints `variant=bytewise` on every backend init
even with all envs unset. Merge-base emitted no such line. This is a
non-compute behavioral divergence. Strictly the default path is not
"byte-identical" in *output*, only in *compute effect*. Trivial.

### 1F. A THIRD touched production code path the task framing did not enumerate
The MoE *consumer* dequant in `gemv_moe_q4_0_f32_ns.cl` and
`gemm_moe_q4_0_f32_ns.cl` was rewritten from mask-then-shift
`(v & 0xF000) >> 12` to shift-then-mask `(v >> 12) & 0x000F` (with added
explicit `(int)` casts in the gemv variant). This is a change to **production
kernel source**, not env-gated.

Result-neutrality check (ushort = unsigned 16-bit):
- old: `(ushort & 0xF000) >> 12` → logical shift (unsigned operand) → 0..15.
- new: `(ushort >> 12) & 0x000F` → logical shift → 0..15; `& 0xF` is no-op.
**Identical on a correct compiler.** The added `(int)` casts match the
existing integer-promotion semantics. So this is result-neutral on correct
hardware and only diverges on the Adreno miscompilation it works around. It is
fairly grouped under "the convert fix campaign" (same root cause: Adreno
miscompiles nibble ops). Treating it as part of intended change #1 is defensible.
**But it IS a third production code path touched**, so a reviewer who reads
the task's "two intended changes" literally would under-count.

---

## 2. CROSS-FILE TRACER

### 2A. Kernel-name strings ↔ host clCreateKernel — CLEAN
`git diff` of cvt.cl shows **zero** added/removed `kernel void` declarations
(only bodies changed; `global`↔`__global` qualifier swap on one convert
signature is an OpenCL alias). Every clCreateKernel name in
`load_cl_kernels` (L1668–1730) matches a kernel in cvt.cl. The two new
`inline` helpers `trans4_pack_lo`/`trans4_pack_hi` (cvt.cl L43–58) are not
kernels and need no registration. ✓

### 2B. Oracle kernels — registered, CMake-listed
`oracle_consumer_q4_0_gemv.cl`/`_gemm.cl` export kernels
`oracle_q4_0_gemv_buffer`, `oracle_q4_0_gemv_image`,
`oracle_q4_0_gemm_buffer`, `oracle_q4_0_gemm_image`. Host creates all four
inside the `if(oracle_enabled())` block (L4144–4155) and `clReleaseProgram`s
the transient programs. CMakeLists L115–118 adds both `.cl` files to
`GGML_OPENCL_KERNELS` (so they embed when `GGML_OPENCL_EMBED_KERNELS`). ✓
The oracle wrapper is concatenated AFTER the production `gemv_moe_q4_0_f32_ns`
source so `q4_0_to_fp32_packed8` is text-identical to the real consumer —
correct isolation design.

### 2C. Tests — CMake registration correct
`tests/CMakeLists.txt` adds `test-s3-repack-bench.cpp` and
`test-opencl-moe-roundtrip.cpp` via `llama_build` (not `llama_build_and_test`)
— explicitly "not a ctest" per comments. They will not run in `ctest` and
cannot break CI. ✓ Intentional.

### 2D. The asymmetric consumer fix — see §3 (this is the cross-file hit)

---

## 3. REMOVED BEHAVIOR (the strong finding)

### 3A. Producer output layout is UNCHANGED — no orphaned consumer
The byte-wise convert replaced `ushort8 pre_block = ((global ushort8*)(&b->qs[0]))[0]`
+ register-staged `uint4 q_block` + strided `dst_q[offset+w*ne01]=q_block.{x,y,z,w}`
with byte-wise `b->qs[2*(4*w+j)]` reads + byte-wise `lo[j]=…`/`hi[j]=…` stores.
I verified byte-for-byte that the new producer writes the **same** bytes to
the **same** uint offsets as the contract comment states
(`dst_q[i02*nb*ne01*4 + i00*ne01*4 + i01 + w*ne01]`, low nibbles→words 0–1,
high nibbles→words 2–3). The change is purely *how* the bytes are assembled
(avoiding the miscompiled register staging), not *what* is written.
Therefore **no other kernel or host helper that consumed the old layout is
orphaned**: the gemv/gemm MoE consumers still do `ushort2`/`ushort4` vector
loads from the same strided offsets, and the restore is the exact inverse.
The HOST_REPACK host-side repack uses identical bytewise arithmetic and writes
the same offsets. ✓

### 3B. Restore is the exact inverse of the producer — CLEAN
q4_0 restore (cvt.cl @@-366): producer writes
`byte[i]=(qs[2i]&0x0F)|((qs[2i+1]&0x0F)<<4)`, `byte[i+8]=((qs[2i]&0xF0)>>4)|(qs[2i+1]&0xF0)`.
Restore recovers `qs[2i]=(byte[i]&0x0F)|((byte[i+8]&0x0F)<<4)` and
`qs[2i+1]=((byte[i]&0xF0)>>4)|(byte[i+8]&0xF0)`. Substituting the producer's
byte[i] into the restore: `qs[2i] = (lo_nib(qs[2i])) | (lo_nib(qs[2i+1])<<4 | ... )`.
Hold: `byte[i+8]&0x0F = (hi_nib(qs[2i])>>0)` and `byte[i]&0x0F = lo_nib(qs[2i])`,
so `qs[2i] = lo_nib(qs[2i]) | (hi_nib(qs[2i])<<4) = qs[2i]`. ✓ Round-trips
identically. Same algebra holds for q4_1/q5_0/q5_1/mxfp4 (the restore bodies
are structurally identical shift/mask). ✓

### 3C. ASYMMETRIC CONSUMER FIX — the byte-wise producer was fixed for 5 types, the shift-then-mask consumer dequant was fixed for q4_0 ONLY  →  CONFIRMED asymmetry / PLAUSIBLE on-device breakage

The campaign PROVED (`gemv_moe_q4_0_f32_ns.cl` comment, 2026-08-19) that
`(ushort & 0xF000) >> 12` is miscompiled on Adreno 740 (driver 0676.73,
compiler E031.41.03.62): the masked value is treated as signed and shifted
arithmetically, so a set top bit smears ones into the neighbouring nibble,
and a following `& 0x0F` is dropped as dead by known-bits. Corruption occurred
in exactly the cases where the source byte ≥ 0x80, 16/16.

The fix (shift-first-then-mask) was applied to:
- `gemv_moe_q4_0_f32_ns.cl` (`q4_0_to_fp32_packed8`) ✓
- `gemm_moe_q4_0_f32_ns.cl` (`dequantize_q4_0` macro) ✓

The **identical proven-buggy expression** `(x & 0xF000) >> 12` (and the
`0x00F0)>>4`, `0x0F00)>>8` siblings) **REMAINS UNFIXED** in:
- `gemv_moe_q4_1_f32_ns.cl:14` (`(q4x8.s0 & 0xF000) >> 12`)
- `gemm_moe_q4_1_f32_ns.cl:16,20,24,28` (`(q4.sN & 0xF000) >> 12`)
- `gemv_moe_q5_0_f32_ns.cl:14` (`(qs5x8.s0 & 0xF000) >> 12`)
- `gemm_moe_q5_0_f32_ns.cl:16,20,24,28`
- `gemm_moe_q5_1_f32_ns.cl:16+`
- `gemm_moe_q4_k_f32_ns.cl:32+` (q4_K GEMM)

Meanwhile the **producer** side (cvt.cl) WAS byte-wise-fixed for all five
nibble types (q4_0, q4_1, q5_0, q5_1, mxfp4) and their restores. So the
producer/consumer fix is **complete only for q4_0**.

**Why this is the cross-file hit per-commit reviews missed:** each commit
that touched a cvt.cl type looked locally correct; the consumer-dequant commit
(9dc1ec0cb / the gemv+gemm q4_0 hunk) looked locally correct. Only the
*cumulative* view reveals that the producer was widened to 5 types while the
consumer workaround stayed at 1. The S23 device verification was q4_0-only
(the model's MoE type), so it could not surface q4_1/q5_0/q5_1/q4_K
breakage.

**Verdict 3C — CONFIRMED (asymmetry) + PLAUSIBLE (on-device breakage):**
The shift-then-mask Adreno workaround is absent from q4_1/q5_0/q5_1/q4_K MoE
consumers despite (a) the producer being byte-wise-fixed for those same
types and (b) the campaign's own proof that the retained expression
miscompiles on the target device. *Failing scenario:* any q4_1, q5_0, q5_1,
or q4_K MoE GEMV/GEMM on Adreno 740 where a source nibble byte ≥ 0x80 — the
consumer would smear the top bit exactly as q4_0 did before the fix. The
producer writes a correct layout that the consumer then misreads.
On-device breakage is *plausible*, not confirmed, because no device test
exercises these types in this lineage (the daily-log q5_0 0/3 failure from
the parallel GEMV-n=1 thread is consistent with, but not proof of, this
specific cause). *File: ggml/src/ggml-opencl/kernels/{gemv,gemm}_moe_q4_1_f32_ns.cl,
gemv_moe_q5_0_f32_ns.cl, gemm_moe_q5_0_f32_ns.cl, gemm_moe_q5_1_f32_ns.cl,
gemm_moe_q4_k_f32_ns.cl.*

### 3D. The "65,536 bytes off-contract yet e2e self-consistent" puzzle
The round-trip harness (`test-opencl-moe-roundtrip.cpp`) does set_tensor
(producer → SoA `extra->q`) then get_tensor (restore → AoS) and counts byte
mismatches with a per-type block-layout signature sweep. The producer
COMMENT claims "Output layout contract (unchanged, byte for byte)" and the
algebra (§3B) confirms the producer+restore round-trip is exact. So a
"65,536 off-contract" reading cannot come from the producer writing a
different *layout* — it writes the contract. The most consistent
interpretation, given e2e is self-consistent, is that the divergence is in
the *consumer's* reading frame vs the documented byte contract for a
specific 64 KiB-class buffer (e.g. a full 65536-byte q slab where the
strided `+w*ne01` indexing makes the consumer's contiguous `ushort2`/`ushort4`
vector load cross a stride boundary the contract describes in uint terms).
This is self-consistent end-to-end precisely because producer, restore, and
consumer all agree on the *actual* bytes — only the prose contract is
imprecise. **No code action recommended** beyond tightening the contract
comment; it is the documented open puzzle, not a regression introduced here.

---

## 4. INSTRUMENT CROSS-CONTAMINATION

### 4A. HOST_REPACK × CVT_VARIANT — CONFIRMED benign log inconsistency
With `GGML_OPENCL_CVT_VARIANT=bitselect` AND `GGML_OPENCL_HOST_REPACK=1`:
the build emits `-DGGML_OPENCL_CVT_BITSELECT=1` (so `trans4_pack_lo/hi`
select the `bitselect` arm) and logs `program_cvt variant=bitselect` — but
HOST_REPACK **bypasses the convert kernel entirely** (L8446 `if` arm writes
`extra->q`/`extra->d` via host `clEnqueueWriteBuffer` with fixed bytewise
arithmetic, then `clReleaseMemObject(data_device)`). So the bitselect kernel
body is compiled yet never executed for that tensor, and the actual q written
is bytewise host arithmetic regardless of CVT_VARIANT. The log line
`variant=bitselect` is therefore **misleading** for any tensor that took the
HOST_REPACK arm. No data corruption (host repack writes the correct layout
either way, consumer reads it correctly), but an operator correlating
`variant=bitselect` with observed bytes would be deceived. *File:
ggml-opencl.cpp:1646–1666 (CVT_VARIANT) vs 8446–8496 (HOST_REPACK arm).*

### 4B. HOST_REPACK × DUMP_Q — CLEAN (same buffer, ordered)
HOST_REPACK writes `extra->q` (host) and releases `data_device`; DUMP_Q
(L8498, a *separate* `if` after the HOST_REPACK/else block) reads `extra->q`
back and compares to a host reference. Both reference `extra->q` (a subbuffer
of `extra_orig->data_device`, created L8393), NOT `data_device` (the staging
buffer). Releasing `data_device` does not touch `extra->q`. With both on,
DUMP_Q compares host-repack-q vs host-ref-q (both bytewise host arithmetic)
→ a valid self-check of the host repack itself. With HOST_REPACK off, DUMP_Q
compares kernel-q vs host-ref-q → the intended producer cross-check. No
shared mutable state, no clobber. ✓

### 4C. DUMP_Q × GEMV_AUDIT AoS stash — CLEAN
Both consume `data` (the host source bytes) read-only; DUMP_Q reads `extra->q`
back, the stash copies `data` into `extra->aos_host`. No aliasing. ✓

### 4D. ORACLE × HOST_REPACK — CONFIRMED warned, not corrupting
`ggml_opencl_oracle_q4_0` L7955 reads `hostrepack=getenv("HOST_REPACK")?1:0`
and emits `ORACLE_WARNING: GGML_OPENCL_HOST_REPACK is unset; this probe reads
the GPU convert's buffer and a red/green verdict does NOT isolate the
consumer.` when unset. So the oracle *knows* HOST_REPACK changes the
provenance of `extra->q` and warns. When HOST_REPACK is on, the oracle reads
host-repacked q (downstream-suspect-isolated); when off, GPU-converted q
(convert-suspect-isolated). This is exactly the split the instrument is for.
No corruption — the oracle runs the *same* consumer idiom on whichever q
exists. ✓ (Well-handled; the warning is the correct behaviour.)

### 4E. Presence-only vs value-parsed foot-gun — see §0 table
`HOST_REPACK=0` and `DUMP_Q=0` ENABLE (presence-only), while
`ORACLE=0`/`GEMV_AUDIT=0` DISABLE (value-parsed). An operator mixing these
will get inverted semantics for the presence-only pair. Default (unset) is
safe; the trap fires only on explicit `=0`.

---

## 5. CONCURRENCY / LIFETIME

### 5A. dst_snap stores a non-retained cl_mem — PLAUSIBLE instrument-path lifetime bug
`ggml_opencl_gemv_register_dst_snap` L1340 does `s.mem = mem` (the dst
tensor's `extrad->data_device`) **without `clRetainMemObject`**. The snap is
pushed into the process-global `g_gemv_audit_dst_snaps` (cap 64) and consumed
later in `ggml_opencl_gemv_check_dst_readback` (get_tensor) which does
`clEnqueueReadBuffer(queue, s.mem, …)`. If the dst buffer is freed/reset
before the snap is consumed, `s.mem` dangles. Two sub-risks:
1. A later `clEnqueueReadBuffer` on the dangling handle → `CL_INVALID_MEM_OBJECT`.
   The readback handles this gracefully (`if(err!=CL_SUCCESS){log;s.consumed=true;continue;}`)
   so no crash, just a logged `skipped=read_err` and the snap retired.
2. **cl_mem handle reuse:** OpenCL drivers may recycle handle values after
   release. A stale unconsumed snap whose `s.mem` value is reused by a *new*
   buffer would match `s.mem==mem` in a future get_tensor and trigger a
   spurious readback + verdict on the wrong tensor's bytes. The
   `ggml_opencl_gemv_range_overlap` guard narrows but does not eliminate this
   (a reused handle with an overlapping offset range would fire).
Both are **only reachable when `GGML_OPENCL_GEMV_AUDIT` is on** (register is
gated). Production (unset) never registers a snap. *File: ggml-opencl.cpp:1340
(`s.mem=mem`, no retain), 10957 (readback consumer).*

### 5B. Stash byte-counters are properly decremented — REFUTED leak
Both host-snapshot stashes decrement the process-wide
`g_gemv_audit_stash_used` on extra reset:
- `ggml_tensor_extra_cl::reset()` L6118 handles `audit_host_accounted` (I32/F32 stash).
- `ggml_tensor_extra_cl_q4_0::reset()` L6296 handles `aos_accounted` (q4_0 AoS stash),
  and `std::vector<uint8_t>().swap(aos_host)` drops capacity (so a 113 MB
  weight does not pin RSS).
The 2026-08-12 design comment ("reset() must decrement and drop capacity") is
honoured for both. No long-run leak even with audit on. ✓

### 5C. Oracle program objects — CLEAN
`prog_gemv`/`prog_gemm` are `clReleaseProgram`'d immediately after
`clCreateKernel` (L4148, 4157). The kernels themselves are released by the
existing kernel teardown. ✓

### 5D. HOST_REPACK arm releases data_device consistently — CLEAN
Both the HOST_REPACK arm (L8494) and the production `else` arm (L8475)
`clReleaseMemObject(data_device)`. No double-release (the arms are mutually
exclusive). ✓

---

## SUMMARY

**Default-path purity:** HOLDS. With all envs unset, production compute =
byte-wise convert kernel + shift/mask restore (+ the result-neutral q4_0
consumer dequant rewrite). Every instrument is gated; the per-enqueue hot hook
is deliberately getenv-free. Three non-critical blemishes: (1D) one un-cached
`getenv` per MoE GEMV in `audit_q4_0`; (1E) one unconditional init log line;
(1F) the q4_0 consumer rewrite is a third touched production path (result-
neutral on correct compilers).

**Cross-file tracer:** Kernel names ↔ host registration intact; oracle kernels
registered + CMake-listed; tests intentionally non-ctest. No dangling kernel
references. ✓

**Removed behavior (the hit):** The byte-wise producer's output layout is
unchanged, so no orphaned consumer — EXCEPT the consumer dequant workaround
is **asymmetric**: shift-then-mask was applied to q4_0 only, while the
identical proven-buggy mask-then-shift remains in q4_1/q5_0/q5_1/q4_K MoE
consumers whose producers WERE byte-wise-fixed. **CONFIRMED asymmetry,
PLAUSIBLE on-device breakage** for any non-q4_0 nibble MoE type on Adreno 740.

**Instrument cross-contamination:** HOST_REPACK×CVT_VARIANT produces a
misleading `variant=bitselect` log (benign, CONFIRMED). Presence-only vs
value-parsed foot-gun for HOST_REPACK/DUMP_Q `=0`. No data-corrupting
instrument interactions found. ✓

**Concurrency/lifetime:** dst_snap holds a non-retained cl_mem (PLAUSIBLE,
graceful-on-error, audit-only). Both stash counters properly decremented on
reset — no leak. Oracle/program objects released. ✓

### Overall risk call
**MEDIUM**, driven almost entirely by finding **3C** (asymmetric consumer
fix). For the *verified* deployment (q4_0 MoE on S23) the lineage is safe and
the default path is clean. The risk is latent: ship this lineage to a model
using q4_1/q5_0/q5_1/q4_K MoE weights on the same Adreno device and the
campaign's own proven miscompilation re-appears in the consumer while the
producer correctly writes the layout — a silent, type-dependent regression
that the q4_0 device test cannot catch. Secondary, low-severity items (1D/1E,
5A) do not gate release. **Recommended action before any non-q4_0 MoE model
is run on Adreno:** port the shift-then-mask + explicit-`(int)` cast form to
`gemv/gemm_moe_q4_1`, `gemv/gemm_moe_q5_0`, `gemm_moe_q5_1`, and
`gemm_moe_q4_k` dequant macros (mechanical, one expression family), then add a
q4_1/q5_0 round-trip + n=1 GEMV device case to close the asymmetry.
