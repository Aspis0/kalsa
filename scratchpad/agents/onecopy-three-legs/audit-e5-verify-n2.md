# Hostile audit — repo `kalsallama-gov-loadstep`, detached HEAD `29707db07`

Commit under audit: `29707db07878031b7252d8df5fa98f369b9757fa` — "ggml-opencl: lab-only
in-vivo verify of the TILE32 v4 GEMV" (parent `fbf33176c`). Working tree clean; the commit is
HEAD. Nothing was edited, built for Android, committed, or executed outside the read-only
commands listed at the end.

Instrument under audit: with the build option `GGML_OPENCL_TILE32_LAB` and the run-time
`GGML_OPENCL_TILE32_VERIFY=N`, the first N v4 GEMV calls are compared against a CPU reference
built from the host tile bytes and the activation read back from `src1`, and each call logs
`PASS`/`FAIL`. Purpose: accept or refute hypothesis H-A ("the per-call activation image and
dst sub-buffer over pool offsets make the v4 GEMV read or write the wrong place").

Verdict up front: **no P0.** The measurement is not fake — the reference is built from the
same physical rpcmem bytes the OpenCL import maps, the activation is read from the exact
offset that cut the sub-buffer, and a sub-buffer whose real origin differs from the requested
one does produce a FAIL rather than a PASS. What is broken is narrower and more dangerous for
the hypothesis test: **the caller's offsets are taken as ground truth** (F1), the one piece of
evidence that names the H-A mechanism is logged but never adjudicated (F2), the tolerance was
calibrated with a test vector that cannot exercise the kernel's cancellation path (F3), the
shared "pass rule" now means two different things in its two callers (F4), and the instrument
is not inert in a measured run (F5).

Ranked summary:

| # | Finding | Verdict | Severity |
|---|---------|---------|----------|
| F1 | `src1_off`/`dst_off` are taken as ground truth on both sides; a "wrong pool offset" H-A passes | CONFIRMED | P1 |
| F2 | `xsub_off`/`dsub_off`/`img_px` are printed but never compared to the requested offsets / K/4 | CONFIRMED | P2 |
| F3 | Tolerance calibrated on a non-negative unit vector; v4's raw-accumulator cancellation untested | PLAUSIBLE | P2 |
| F4 | Same `check_pass` gets device RMS in the self-check and reference RMS in the verify | CONFIRMED | P2 |
| F5 | Not read-only-in-effect: clFinish + 3 blocking reads + O(K·M) CPU ref on the measured decode path | CONFIRMED | P2 |
| F6 | `strtol` overflow unchecked → `VERIFY=999…` silently verifies every call forever | CONFIRMED | P3 |
| F7 | A failed read prints `status=ERROR`, never `FAIL` | CONFIRMED | P3 |
| F8 | Read-backs race with any other thread writing the pool parent | PLAUSIBLE | P3 |
| F9 | Reference validity rests on CPU/GPU coherence of the imported block (holds only for the uncached rpcmem) | PLAUSIBLE | P3 |
| F10 | "First N calls" with no tensor/step selector and no mode banner | CONFIRMED | P3 |
| F11 | Dead metadata, duplicated read-back/loop code, header not in the source list | CONFIRMED | P3 |
| F12 | Commit message says "not built for Android"; the tree holds a 12:44 aarch64 object of the new TU | CONFIRMED | P3 |
| T1 | `test-tile32-check.cpp` never tests `check_reference` nor the call-counting logic; was built and run | CONFIRMED | P3 |

---

## 1. Does it measure what it claims?

### 1a. `v->host_tiles` — live mapping, not a staging copy, not freed, not null. REFUTED (as a defect)

`ggml/src/ggml-opencl/ggml-opencl-tile32.cpp:211` — `v.host_tiles = wbytes;`, where `wbytes` is
`w->data` (`ggml-opencl-tile32.cpp:171` — `const uint8_t * wbytes = (const uint8_t *) w->data;`).
No allocation, no copy, no snapshot: the pointer is the tensor's own bytes in the Hexagon
rpcmem block, and the OpenCL side imports that same block as host ptr —
`ggml-opencl-tile32.cpp:142` `const cl_mem_flags flags = CL_MEM_READ_ONLY | CL_MEM_USE_HOST_PTR |
(cl_mem_flags) (1 << 29)` and `:146` `qcom_ext_host_ptr hp = { 0x411D, policies[p], imp.fd, imp.base };`.
The TILE32 buft packs in place into that pointer —
`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2250` `ggml_q4_0_tile32_pack((uint8_t *) tensor->data, ...)`
— and `ggml_backend_hexagon_buffer_get_base` returns `sbuf->base()` (`ggml-hexagon.cpp:838-841`),
i.e. `w->data == base + toff` with `toff` the same number the views use
(`ggml-opencl-tile32.cpp:173`). Layout and origin also line up with the kernel: the reference's
tile 0 is at `host_tiles`, the kernel's tile 0 is at image byte `poff*16` of a region whose base
is `toff & ~(align-1)`, and the reference reads the scale at `tile+512+2*row` while the kernel
reads `ws` pixel `2*poff + tile*72 + 64 + (h16>>2)` — same byte, as the pack layout in
`ggml/src/ggml-q4_0-tile32.h:186-193` defines it.

Two qualifications, neither a defect of this commit:
- The reference is only as good as the CPU's view of the imported block. The one-copy
  configuration allocates the TILE32 block with `RPCMEM_FLAG_UNCACHED`
  (`ggml-hexagon.cpp:2398` — `const uint32_t flags = opt_hostbuf_uncached ? RPCMEM_FLAG_UNCACHED
  : RPCMEM_DEFAULT_FLAGS;`), so the CPU read is coherent; with the cached default the CPU view
  can be stale relative to the GPU, and a correct kernel would then FAIL. This is a precondition
  of the instrument, stated nowhere. → **F9, PLAUSIBLE, P3.**
- `host_tiles` dangles if the rpcmem block is freed while the import map still holds it (the
  same hazard `import_locked` probes for with its "import for buffer %p is stale" warning,
  `ggml-opencl-tile32.cpp:104`). Inherited by the self-check too. → **PLAUSIBLE, P3.**

### 1b. The activation the verify reads vs the bytes the kernel consumes through the image — same bytes; divergence is detected, not hidden. REFUTED as a false-negative source

The sub-buffer is cut at the number the verify later reads from the parent:
`ggml-opencl-tile32-matvec.cpp:123` `const cl_buffer_region xregion = { (size_t) src1_off,
(size_t) K * sizeof(float) };`, and the image is built over that sub-buffer with
`ggml-opencl-tile32-matvec.cpp:134` `d.image_width = K / 4;` / `d.buffer = xsub;`.
The verify reads `ggml-opencl-tile32-verify.cpp:81` `read_floats(env, io->act, io->act_off,
x.data(), K)` — the whole buffer at the same byte offset, `K` floats. For an
`IMAGE1D_BUFFER` the first pixel is the first element of the buffer object it was created over,
so pixel `p` = sub-buffer byte `4p` = parent byte `act_off + 4p`; and the kernel's indices stay
in range: with `nkt = K/32` (`mul_mv_q4_0_f32_tiled_v4.cl:64`), lane `l` reads
`read_imagef(ximg, kt * 8 + (cp >> 1))` (`:82`) with `cp = l/2 <= 15`, i.e. pixel
`8*kt + (cp>>1) <= K/4 - 1` — exactly the image width. Divergence cases and their direction:

- driver ignores/moves the sub-buffer origin → the kernel reads different bytes, the reference
  does not → `dev != ref` → **FAIL**. Conservative, correct.
- driver shifts the image base inside the sub-buffer → same, **FAIL**.
- wrong image width / wrong K → same, **FAIL**.
- **the caller's own offset number is wrong → both sides use it → PASS.** This is the real hole;
  see F1.

### 1c. F1 — the offsets are taken as ground truth. CONFIRMED, P1

`ggml-opencl-tile32-matvec.cpp:168` — `const ggml_opencl_tile32_gemv_io io = { src1_buf,
src1_off, xsub, ximg, dst_buf, dst_off, dsub };` — and `ggml-opencl-tile32-verify.cpp:81/83`
read the parent at exactly `act_off`/`dst_off`, the same numbers that cut the sub-buffers
(`matvec.cpp:123-124`). Those numbers are `extra1->offset + src1->view_offs` and
`extrad->offset + dst->view_offs` (`ggml/src/ggml-opencl/ggml-opencl.cpp:25765-25766`):

    ggml_cl_mul_mat_tile32(&env, src0, src1, dst,
                           extra1->data_device, extra1->offset + src1->view_offs,
                           extrad->data_device, extrad->offset + dst->view_offs);

If H-A is "the leg is handed the wrong pool offset" — a wrong `extra->offset`, an unaccounted
`view_offs`, a stale pool record — then the kernel computes on the wrong bytes *and* the
reference does the same, on the same wrong bytes, from the same wrong address. The verdict is
`PASS` while the logits are wrong. The instrument can only ever say "the kernel is arithmetically
right about the bytes at the address the leg was given".

Counter-argument, which is why this is P1 and not P0: the offset expression is shared with the
HOST leg (`ggml-opencl.cpp:25829` region, `cl_ulong offset1 = extra1->offset + src1->view_offs;`)
and with the plain OpenCL kernels, so a wrong `extra->offset` would break paths that reportedly
work, which lowers the likelihood that this is the one-copy bug. The finding stands regardless:
a `PASS` here cannot be reported as "the per-call objects are fine", only as "the leg's own
addressing is self-consistent and the kernel matches the reference on those bytes".

### 1d. F2 — the H-A-relevant numbers are logged but never adjudicated. CONFIRMED, P2

`ggml-opencl-tile32-verify.cpp:84-86`:

    sub_offset(io->act_sub, &xsub_off) &&
    sub_offset(io->dst_sub, &dsub_off) &&
    image_width(io->act_img, &img_px);

and `:103-107` prints `act_off=xsub_off img_px=… dst_off=… dsub_off=…`. Nothing compares
`xsub_off` with `io->act_off`, `dsub_off` with `io->dst_off`, or `img_px` with `K / 4`. The
comment on the helper claims more than the code uses — `verify.cpp:40` `// Where a sub-buffer
starts in its parent: the offset the kernel really got, not the one asked for.` The three
queries exist to answer precisely the H-A question ("did the per-call object land where the
offset asked?"), the numbers are in the line, and a human can diff them — but the verdict word
does not carry it, and a FAIL never says which of the three objects moved or by how much. A
single `xsub_off != io->act_off || dsub_off != io->dst_off || img_px != (size_t)(K/4)` folded
into `status` would have made the instrument self-explaining. Also note the (uncited, therefore
unverified) claim in that comment about driver behavior: `CL_MEM_OFFSET` is specified as the
offset of the sub-buffer within the buffer passed to `clCreateSubBuffer`, which is what the leg
wants only because the sub-buffers are cut directly from the io buffers — and since the value is
never used, nothing depends on it.

### 1e. F3 — the tolerance was calibrated with a vector that cannot exercise the kernel's cancellation. PLAUSIBLE, P2

The only calibration evidence in the tree is `ggml-opencl-tile32-gate.cpp:134`
`// mapping of the same bytes. |diff| <= 1e-5 of output RMS (spike measured 6-9e-7).` — measured
by the load-time self-check, whose activation is `unit_vector(K, x)` (`gate.cpp:140`,
`:69-81`), and `unit_vector` produces non-negative values: `gate.cpp:74` `x[i] = (float)
((s >> 11) * (1.0 / 9007199254740992.0));` — all in [0, 1).

The two sides round differently by construction. The kernel accumulates *raw* nibbles and
subtracts the offset once per K-tile: `mul_mv_q4_0_f32_tiled_v4.cl:97-101` `const float corr =
8.0f * (xy.x + xy.y);` / `t0 = mad(d0 - corr, read_imagef(ws, sp + 0), t0);`. The CPU reference
applies the offset per element inside `dot_row`: `ggml/src/ggml-q4_0-tile32.h:190`
`sum += (float) ((b & 0x0F) - 8) * x[2 * cp];`. With an all-positive x, the kernel's raw
accumulator `d` sees no sign cancellation from x, so the 6-9e-7 measured at load does not cover
the regime the verify will run in: with a *signed* decoder activation, `d` and `corr` are each
several times larger than their difference, the subtraction's single rounding is relatively
larger, and the gap to a reference whose intermediates never grow that way can plausibly exceed
`1e-5 * rms`. It is one measurement away from being settled (signed pseudo-random x on the
device, or run the instrument once and read `max|diff|`/`rms` off the log), and the instrument
prints exactly those two numbers, so a FAIL with `max|diff|` a few times `1e-5 * rms` should be
read as "tolerance, not kernel" until that measurement exists. Also relevant: the v4 program is
built with the engine's general options (`-cl-fast-relaxed-math -cl-mad-enable`, see the
Amendment I comment at `ggml-opencl-tile32-matvec.cpp:42-48`), which permits reassociation in
exactly this epilogue.

### 1f. F4 — the shared pass rule receives two different RMS values. CONFIRMED, P2

`ggml/src/ggml-opencl/ggml-opencl-tile32-check.h:27-31` documents one rule —
`// |diff| <= 1e-5 of the output RMS.` / `return rms > 0.0 ? maxd <= 1e-5 * rms : maxd == 0.0;` —
and both callers pass it the same-named argument built from different arrays:

- self-check: `gate.cpp:178` `sq += (double) dev[m] * (double) dev[m];` → **device** RMS (kept,
  unchanged, as the commit claims).
- verify: `verify.cpp:93-97` `sq += (double) ref[m] * (double) ref[m];` → **reference** RMS.

The verify's choice is the stricter one when the device output is garbage, so it does not weaken
detection; but the commit message's "the pass rule move to ggml-opencl-tile32-check.h … with
unchanged arithmetic" is only true for the self-check. The two log lines' `max|diff|`/`rms`
ratios are no longer comparable, and the header comment is now wrong for one of its two callers.
The device RMS is never computed in the verify, so `sub_vs_parent_max` cannot be expressed
relatively either.

### 1g. Batched calls and other shapes. REFUTED (they do not reach the site)

`ggml-opencl.cpp:10112-10114` — `x->type == GGML_TYPE_F32 && x->ne[1] == 1 && x->ne[2] == 1 &&
x->ne[3] == 1 && x->nb[0] == sizeof(float)` — is the admission for the TILE32 leg, and the
compute path re-asserts the same shape (`matvec.cpp:85-88`), so `ne11 > 1` never reaches the
verify and the verify's "one activation column, M result floats" model is safe. `M` need not be
a multiple of 32 (the kernel guards every store with `if (rt * 32 + 16 * j + i < M)`, and the
reference loops `m < M`); the dst region is exactly `M * sizeof(float)`
(`matvec.cpp:124`); `K % 32 == 0` is asserted (`matvec.cpp:81`) hence `K % 4 == 0`, so
`image_width = K/4` is exact. The `GGML_ASSERT(src1->ne[1] == 1 …)` would abort rather than
mis-measure if a scheduler override ever pinned a batched op — pre-existing, not this commit.

---

## 2. Bugs: null derefs, out-of-bounds, units, integer types, format specifiers

No P0. Checked and clean:

- **No null deref.** `host_tiles` cannot be null where the verify uses it:
  `ggml-opencl-tile32.cpp:171-175` returns early when `!wbytes`, and `:211` assigns
  unconditionally after that. `io->act/act_sub/act_img/dst/dst_sub` are all non-null by
  construction (`matvec.cpp:125-140`; the abort paths on failure precede the verify). `w->name`
  is used with `%s` as the self-check already does.
- **No out-of-bounds.** The verify's reads are exactly the regions the code above made
  equivalent: parent `[act_off, act_off + 4K)` is the sub-buffer's whole region
  (`matvec.cpp:123`); `clEnqueueReadBuffer(dst_sub, 0, M*4)` is exactly `dregion.size`
  (`matvec.cpp:124`). There is no index arithmetic in the verify other than
  `max_abs_diff(..., n)` with `n = M`, and `M == w->ne[1]` is the same `M` the kernel got
  (`matvec.cpp:145` `cl_int ki = (cl_int) K, mi = (cl_int) M;`).
- **Units.** `act_off`/`dst_off` are bytes in the buffer passed as `src1_buf`/`dst_buf`
  (documented in `ggml-opencl-tile32.h`: "src1_off / dst_off are extra->offset + view_offs in the
  OpenCL buffers"), and both the region construction and the read-backs use them as bytes. The
  sub-buffer read uses offset `0` with the sub-buffer itself, which is the same memory as
  `dst + dst_off`. Consistent.
- **Integer types.** `read_floats(..., size_t n)` with `K`/`M` (int64 → size_t) and
  `n * sizeof(float)` — fine. `sub_offset`/`image_width` take `size_t*`, which is the type of
  `CL_MEM_OFFSET` and `CL_IMAGE_WIDTH`. `max_abs_diff(const float*, const float*, int64_t)` with
  `M` — fine. `rms = sqrt(sq / (double) M)` cannot divide by zero: `M > 0` is asserted
  (`matvec.cpp:81`).
- **Format specifiers**, each checked against its argument: `%ld` ← `long call` (`verify.cpp:75`
  `const long call = ++g_calls;`), `%lld` ← `(long long) M`, `%zu` ← `size_t xsub_off/img_px/`
  `dsub_off` (`:78`), `%llu` ← `(unsigned long long) io->act_off/dst_off` (`:105-107`). The
  Android build compiles with `-Wformat -Werror=format-security` (see
  `build-ls-and/compile_commands.json`, the verify entry) — a mismatch would have failed the
  build that produced the object in that directory.

One real integer defect:

**F6** — `ggml-opencl-tile32-check.h:39-41`:

    char * end = nullptr;
    const long n = strtol(s, &end, 10);
    return *end == '\0' && n > 0 ? n : 0;

`errno`/`ERANGE` is never consulted, so a value that overflows `long` returns `LONG_MAX`, which
is `> 0` and has `*end == '\0'` — accepted. `GGML_OPENCL_TILE32_VERIFY=99999999999999999999`
therefore silently verifies **every** GEMV call for the life of the process (clFinish + 3
blocking read-backs + an O(K·M) CPU reference per call) instead of being rejected with the
warning at `verify.cpp:29-31`, which only fires when `n == 0`. On a 32-bit Android ABI the same
applies at ~2^31. **CONFIRMED, P3** (lab-only, but the failure mode is "verify forever", not
"verify off", and it is silent).

Related, same function, smaller: `verify.cpp:29` `if (s && *s && n == 0)` skips the warning for
an empty value, so `GGML_OPENCL_TILE32_VERIFY=` (set but empty) is silently off, and a *valid*
positive value produces no "verify enabled for N calls" banner anywhere. A misspelled env name is
therefore indistinguishable from "off". **P3.**

---

## 3. Concurrency and locking

- **Lock contract satisfied.** The call site holds the leg mutex:
  `matvec.cpp:75` `std::lock_guard<std::mutex> lock(ggml_opencl_tile32_mutex());`, and the `if`
  at `matvec.cpp:166-171` is inside it. Both new functions take the same mutex, so the
  `_locked` suffix is honest and the file-static `g_budget`/`g_calls`
  (`verify.cpp:23-24`) are only touched under it. No other thread can reach them: the only
  callers are in this function (grep: `ggml_opencl_tile32_verify_next_locked` and
  `..._gemv_locked` appear only in `internal.h` and `matvec.cpp`).
- **Ordering vs the releases is correct.** The verify runs between the enqueue
  (`matvec.cpp:162`) and `clReleaseMemObject(ximg); clReleaseMemObject(dsub);
  clReleaseMemObject(xsub);` (`matvec.cpp:172-174`) — the objects are alive for the whole check,
  and the read-backs are blocking (`verify.cpp:36` `CL_TRUE`), so the releases cannot race with
  the reads.
- **clFinish covers the kernel.** One queue, in order: `ggml-opencl.cpp:7452-7456`
  `cl_command_queue_properties command_queue_props = 0; … backend_ctx->queue =
  clCreateCommandQueue(context, device, command_queue_props, &err);` (the out-of-order variant is
  commented out at `:7448`). The kernel is enqueued on `env->queue` (`matvec.cpp:162`) and
  `verify.cpp:80` finishes the same queue. No second queue exists in the backend.
- **Holding the mutex across clFinish + the CPU reference** blocks other threads' leg calls
  (and `ggml_backend_opencl_release_imports`, which takes the same mutex and finishes the queue)
  for the duration of an O(K·M) CPU loop. No deadlock: nothing inside the leg re-enters the
  mutex, and the driver path taken here registers no callbacks.
- **F8 (PLAUSIBLE, P3).** `clFinish` guarantees only that work enqueued *before* it has
  completed; the leg mutex is not held by other threads' OpenCL ops. In any harness that computes
  two graphs at once on this backend (multi-slot server), a pool slot that `io->act` or
  `io->dst` points into can be overwritten between `verify.cpp:80` and the read-backs at
  `:81-83`, turning a correct kernel into a spurious FAIL. The campaign's single-sequence bench
  is not exposed. There is no event/barrier that would prevent it.

---

## 4. Removed behavior: the self-check refactor

Old (from `git show 29707db07`, `ggml-opencl-tile32-gate.cpp` before):

    const int64_t K = w->ne[0], M = w->ne[1], nkt = K / GGML_Q4_0_TILE32_K;
    std::vector<float> x(K), ref(M), dev(M);
    unit_vector(K, x);

    const uint8_t * tiles = v->host_tiles;
    for (int64_t m = 0; m < M; m++) {
        float sum = 0.0f;
        for (int64_t kt = 0; kt < nkt; kt++) {
            sum += ggml_q4_0_tile32_dot_row(tiles + ((m / GGML_Q4_0_TILE32_ROWS) * nkt + kt) * GGML_Q4_0_TILE32_SIZE,
                                            x.data() + kt * GGML_Q4_0_TILE32_K, m % GGML_Q4_0_TILE32_ROWS);
        }
        ref[m] = sum;
    }

    …
            const double rms = sqrt(sq / (double) M);
            // an all-zero weight makes both sides all zero, where a relative bound is
            // undefined: accept that pair and keep the relative bound for the rest
            ok = rms > 0.0 ? maxd <= 1e-5 * rms : maxd == 0.0;

New (`gate.cpp:138-141` and `:184-185`):

    const int64_t K = w->ne[0], M = w->ne[1];
    std::vector<float> x(K), ref(M), dev(M);
    unit_vector(K, x);
    ggml_opencl_tile32_check_reference(v->host_tiles, x.data(), K, M, ref.data());
    …
            const double rms = sqrt(sq / (double) M);
            ok = ggml_opencl_tile32_check_pass(maxd, rms);

with `check.h:14-25`:

    static inline void ggml_opencl_tile32_check_reference(const uint8_t * tiles, const float * x,
                                                          int64_t K, int64_t M, float * y) {
        const int64_t nkt = K / GGML_Q4_0_TILE32_K;
        for (int64_t m = 0; m < M; m++) {
            float sum = 0.0f;
            for (int64_t kt = 0; kt < nkt; kt++) {
                sum += ggml_q4_0_tile32_dot_row(tiles + ((m / GGML_Q4_0_TILE32_ROWS) * nkt + kt) * GGML_Q4_0_TILE32_SIZE,
                                                x + kt * GGML_Q4_0_TILE32_K, m % GGML_Q4_0_TILE32_ROWS);
            }
            y[m] = sum;
        }
    }

**Verdict: CONFIRMED unchanged** for the self-check. Same expressions, same argument order, same
`float sum = 0.0f` accumulator, same accumulation order, same temporary types (`x.data()` and
`x` are the same pointer). The only differences are mechanical: `nkt` is now a local of the
helper, `tiles` is `v->host_tiles` passed by argument instead of a local alias, and the
all-zero-case comment moved to `check.h:27-28`. The pass rule keeps `<=` and keeps the
all-zero branch (`check.h:30`), and — critically — the self-check still feeds it the **device**
RMS (`gate.cpp:178`), so no self-check verdict can move. What changed is only the verify's RMS
source (F4), which is a new caller, not a changed self-check.

---

## 5. Build fences

- Source gate: `ggml/src/ggml-opencl/CMakeLists.txt:6-10`

      # Lab-only run-time verify of the v4 GEMV: the shipped build does not compile it.
      set(TILE32_LAB_SOURCES)
      if (GGML_OPENCL_TILE32_LAB)
          set(TILE32_LAB_SOURCES ggml-opencl-tile32-verify.cpp)
      endif ()

  and `:22` `${TILE32_LAB_SOURCES}` inside the source list. `set(TILE32_LAB_SOURCES)` to the
  empty string does not leave a stray empty source element in the LAB=OFF configure (CMake
  treats it as an empty list; and the LAB=OFF configure in this tree succeeded, see below).
- Call-site gate: `matvec.cpp:166` `#ifdef GGML_OPENCL_TILE32_LAB` … `:171` `#endif`.
- Declaration gate: `internal.h:122` `#ifdef GGML_OPENCL_TILE32_LAB` … `:143` `#endif`.
- Option default: `ggml/CMakeLists.txt:269` `option(GGML_OPENCL_TILE32_LAB "ggml: LAB ONLY -
  compile in the GGML_OPENCL_TILE32_UNMEASURED env waiver of the TILE32 device gate" OFF)`.
- Nothing else in the repo references the flag: a full-repo grep (`GGML_OPENCL_TILE32_LAB`,
  excluding `.git` and the three build dirs) returns only the five files above plus
  `facts.cpp`, `facts.h`, `tests/test-tile32-opencl-gate.cpp` and `tests/CMakeLists.txt:525-526`
  (the pre-existing waiver test). A shipped build therefore compiles neither the TU nor a
  reference to either symbol. **Verdict: fence intact, CONFIRMED.**
- **F12 (CONFIRMED, P3) — the fence's *enabled* direction is proven by a real build, the disabled
  direction is not.** `build-ls-and/ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/ggml-opencl-tile32-verify.cpp.o`
  exists (98,144 bytes, mtime 2026-10-08 12:44:19), and
  `build-ls-and/compile_commands.json` shows the TU compiled for
  `--target=aarch64-none-linux-android34 … -DGGML_OPENCL_TILE32_LAB … -Wall -Wextra -Wpedantic
  -Wformat -Werror=format-security -ffp-model=fast -O3` — so the new file *does* compile with the
  project's flags under LAB=ON. That build post-dates the commit (12:40:29), which makes the
  commit message's "not built for Android" stale. For the other direction there is **no**
  LAB=OFF OpenCL build in the tree: `build-host` is the only non-LAB build and it has the OpenCL
  backend off entirely (3 `ggml-opencl` TUs, all test-side: `facts.cpp`, `host.cpp` ×2), so the
  claim "the shipped build does not compile the verify file" rests on CMake logic and `#ifdef`s
  alone, not on evidence. `build-ls-rel` is stale (configured 09:46, LAB=ON, predates the file).
- Coupling worth knowing (P3): the same option is the unmeasured-device waiver that the one-copy
  campaign must enable on the Xiaomi 14, so the *measured* binary necessarily contains the
  verify TU and one extra branch per GEMV (`matvec.cpp:167`), with the `getenv` paid once. The
  measured binary is not the shipped binary; the cost is negligible, but the two are not
  identical.
- `ggml-opencl-tile32-check.h` is not listed in the backend's source list (only
  `ggml-opencl-tile32-internal.h` is), even though it is now a real dependency of
  `gate.cpp`/`verify.cpp`/`tests`. Header-only and `static inline`, so nothing breaks; IDE and
  re-configure nicety only. **P3.**

---

## 6. Tests

`tests/test-tile32-check.cpp` (35 lines) covers the budget parse (7 cases) and the pass-rule
boundary (5 cases). Evidence it was built and run: `build-host/CMakeLists.txt:531`
`llama_build_and_test(test-tile32-check.cpp)`, `build-host/tests/CTestTestfile.cmake:197-198`
registers it, `build-host/Testing/Temporary/CTestCostData.txt:96`
`test-tile32-check 1 0.0131482` records a run, and re-running the built binary locally gives
exit 0 with `ALL PASS` on all 12 checks (the binary at
`build-host/bin/test-tile32-check`, 12:36:59, is newer than the source at 12:36:22).

**T1 — meaningful but thin. CONFIRMED, P3.**
- It pins the two things that would otherwise rot silently: the exact `<=` boundary
  (`test-tile32-check.cpp:28-29`) and the degenerate `rms == 0` branch (`:30-31`). Good.
- It never calls `ggml_opencl_tile32_check_reference` — the tile-indexing and accumulation core
  (`check.h:14-25`), the one piece whose correctness the whole instrument rests on. Its only
  other exercise is the on-device self-check, i.e. the same code path being trusted.
- It never tests the *counting* semantics the env var promises ("the first N calls"): the
  `g_budget = -1` sentinel, the decrement, and the "then false" transition live in
  `verify.cpp:61-70`, in the lab-only TU, with no host test. An off-by-one there (verifying N-1 or
  N+1 calls) is invisible to this test and to the log unless N is chosen carefully.
- Env save/restore: **not applicable — the test mutates no env.** There is no `setenv`,
  `unsetenv` or `putenv` in it; it calls the pure parse function with literals. The flip side is
  that a mismatch between the name read at run time (`verify.cpp:27`
  `getenv("GGML_OPENCL_TILE32_VERIFY")`) and the documented/expected name would not be caught by
  anything.

---

## 7. Simplification, dead code, file size

**F11 — CONFIRMED, P3.**

- Three of the seven `ggml_opencl_tile32_gemv_io` fields serve only the log: `act_sub` and
  `act_img` (used only in `verify.cpp:84-86` to fill `xsub_off`/`img_px`) and `dst_sub`'s offset
  query, whose value `dsub_off` is never compared to `dst_off` (F2). `img_px`, `xsub_off` and
  `dsub_off` are write-only after the reads (`verify.cpp:78` → `:104-107`).
- `sub` and `par` are two blocking reads of the *same* bytes whenever `dsub_off == dst_off`; the
  second exists only to compute `sub_vs_parent_max` (`verify.cpp:100`). One synchronous
  round-trip per verified call buys a diagnostic that F2 would have made redundant.
- The refactor stopped short of the arithmetic that both callers share: the read-back, the
  max/RMS loop and the log line are still duplicated between `gate.cpp:174-187` and
  `verify.cpp:81-101`. Only the reference and the pass predicate moved to the header.
- The verify could have been ~40 lines shorter with no loss: drop the three log-only queries, or
  use them (F2). As written, `verify.cpp` is 108 lines / 4.5 KB, `check.h` 42 lines, the whole
  commit 230 added lines for one verdict line per call. Size is not itself a problem; the ratio
  of *decorative* to *decisive* code is.

---

## What a trustworthy PASS/FAIL still needs (no patch here, per the brief)

1. Turn the three offset/width queries into part of the verdict, and print the deltas
   (`xsub_off - act_off`, `dsub_off - dst_off`, `img_px - K/4`) — that is the H-A signal, not
   decoration.
2. Print both RMS values (reference and device) so a FAIL can be classified as "gross address
   error" (O(rms)) versus "tolerance/rounding" (a few × 1e-5·rms), and calibrate the tolerance
   once with a **signed** activation (F3).
3. Give the operator a selector (tensor name and/or decode step) instead of "first N calls", and
   a banner line when verification is on (F10, F6's silent-∞ case).
4. Make a failed read-back print something a FAIL-grep will catch (F7).
5. Independently anchor the activation: today any wrong-but-consistent `src1_off` passes (F1);
   only evidence from outside the leg (e.g. comparing the same op's activation against the
   two-copy leg's) can rule that out.

---

## Commands run (all read-only or targeted)

    git log -1 --format='%H %s'                       # 29707db07 (detached), tree clean
    git show --stat 29707db07 ; git show 29707db07    # full diff
    read: ggml-opencl-tile32-{verify.cpp,matvec.cpp,gate.cpp,internal.h,check.h,.cpp}
          ggml-opencl.cpp (call site, supports_op, queue creation, env_fill)
          kernels/mul_mv_q4_0_f32_tiled_v4.cl ; ggml-q4_0-tile32.h
          ggml-hexagon.cpp (dmabuf accessor, TILE32 pack/alloc)
    grep -rn GGML_OPENCL_TILE32_LAB (excl. .git, build*)   # 5 files only
    python3 json read of build-{host,ls-and,ls-rel}/compile_commands.json
    grep tile32 build-host/Testing/Temporary/CTestCostData.txt
    ./build-host/bin/test-tile32-check > /tmp/ttc.log 2>&1; echo $?      # exit 0, ALL PASS
    (no Android build, no edits, no commits, no agents)
