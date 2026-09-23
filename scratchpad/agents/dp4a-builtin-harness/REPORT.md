# dp4a builtin known-vector harness - build report

Status: **complete** for the coder brief - artefacts and commands on disk (sections 0-5).
No phone touched, no commit, no push, no tag.
Coder cell. **No phone was touched by this cell** - device ownership stays with the
run-scheduling agent. No commit, no push, no tag, no upstream.

Target question (from `scratchpad/agents/residual-after-q6k-route/REPORT.md` section 12 /
12.2): does `dot_acc_sat_4x8packed_ss_int` on the S23's Adreno 740 driver
(`E031.41.03.62`) compute the dot product its declaration promises, under the exact call
sequence our production q6_K dp4a kernel uses?

## 0. Sources read before writing code

- Spec: `scratchpad/agents/residual-after-q6k-route/REPORT.md` **section 12.2** (lines
  737-770), plus 12.1 (suspect table) and 12.3 (fix shape) for context.
- Production call sequence: `ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl`
  at commit `1068eb03d` (detached worktree `/Users/marco/Projects/kalsallama-wt-1068`).
  Note: the brief cites this file as `dp4a.cl:30-40`; there is no file named `dp4a.cl` in
  either tree - lines 30-40 of `gemm_noshuffle_q6_k_q8_1_dp4a.cl` are the `dot4_q8a`
  inline function, which is what the brief means:
  `r = 0; r = dot_acc_sat_4x8packed_ss_int(w0, a0, r); ... x4` with the accumulator last.
  The per-32-K-step caller is the `DOT_TOK` macro in the same file: `raw1 = dot4_q8a(w0..w3,
  a0..a3)`, `raw2 = dot4_q8a(w4..w7, a4..a7)` - two independent 4-call chains, each starting
  from `r = 0`, each scaled separately.
- Declaration (re-verified by this cell): NDK r29 clang 21
  `lib/clang/21/include/opencl-c.h:17278`:
  `int __ovld __cnfn dot_acc_sat_4x8packed_ss_int(uint, uint, int);` - accumulator last,
  inside the `#if defined(__opencl_c_integer_dot_product_input_4x8packed)` block at
  `:17271-17281`. Matches the production call.
- Activation quantizer (suspect 2 / optional K3): `kernels/quant_a_q8_1.cl:34`
  (`da[blk] = (half)d;`), full file read; the K3 kernel below is a verbatim copy.
- Build recipe: `scratchpad/agents/s23-native-gpu-bench/REPORT.md` sections 1.1/2.3 -
  NDK clang `--target=aarch64-linux-android28`, link `-lOpenCL` against
  `/Users/marco/kalsa-opencl-deps/android-prefix/{include,lib}` (Khronos ICD loader, real
  arm64 lib), `DT_NEEDED libOpenCL.so` binds the vendor `/vendor/lib64/libOpenCL.so`
  through the default namespace (no ICD vendor dir on the phone), no `LD_LIBRARY_PATH`
  needed for `libOpenCL.so` (`env -u LD_LIBRARY_PATH` verified working in that cell; our
  binary carries **no** `libomp.so` dependency, so no `LD_LIBRARY_PATH` at all), SELinux
  stays Enforcing with no denials, `/data/local/tmp` usable as `shell`.
  Host toolchain on disk: NDK r29 (`source.properties`: 29.0.14206865), clang 21.0.0 at
  `/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang`.
- Production build options replicated verbatim (`ggml-opencl.cpp:1556-1559`):
  `-cl-std=CL3.0 -cl-mad-enable -cl-unsafe-math-optimizations -cl-finite-math-only
  -cl-fast-relaxed-math`.

## 1. Design (as built)

Location of source/binary: **`/Users/marco/Projects/dp4a-builtin-harness/`** - a plain
scratch dir outside any git repository (verified: `/Users/marco/Projects` is not a work
tree). Nothing of the harness lives inside a repo's tracked tree; this REPORT.md is the
only file this cell writes under `kalsa-moe-experiments`, and nothing is committed.

Two files:

- `probe.cl` - standalone OpenCL source, three test kernels + one quantizer kernel:
  - `probe_dot_builtin` (K1, the decider): each row = 8 packed weight uints + 8 packed
    activation uints = one production 32-K step. Runs the two `dot4_q8a` chains exactly
    as `DOT_TOK` does (`raw1` = words 0-3, `raw2` = words 4-7, `r = 0` at each chain
    start, four `dot_acc_sat_4x8packed_ss_int(w[k], a[k], r)` calls per chain, accumulator
    last), writes both int32 results.
  - `probe_chain_builtin` (K2): the same 8 builtin calls per row, `r` reset between the
    two chains exactly as production, with the int32 intermediate written after **every**
    call (8 outputs per row) - so a wrong-but-deterministic lowering shows *where* it
    first diverges.
  - `probe_dot_manual` (K3/fix body): the proposed fix from spec 12.3 - `as_char4(w)` /
    `as_char4(a)` unpack + plain int multiply-add, 16 products per chain, same two
    outputs per row. Independent code path (no builtin), so it self-checks K1.
  - `kernel_quant_a_q8_1` (optional, cheap - kept): verbatim copy of
    `quant_a_q8_1.cl`, driven with 4 blocks of 32 floats: amax = 1.0 (control),
    **0.005 (the cliff case: d = amax/127 = 3.94e-5, below the fp16 normal floor
    6.1e-5)**, 0.008 (just above the floor), 1e-4 (deep subnormal). Compares the device's
    stored `da` half bits against a host-side round-to-nearest-even float->half
    conversion, plus reports `CL_DEVICE_HALF_FP_CONFIG` (denorm / flush-to-zero bits).
- `dp4a_harness.c` - host program, no ggml, links only libOpenCL:
  - **Inputs: 512 rows = 256 adversarial + 256 realistic**, all generated
    deterministic (xorshift32, fixed seed):
    - 256 adversarial: 16 crafted rows (all bytes 0x80/-128, all 0x7F, 0x80 x 0x7F
      sign mixes, 0x55/0xAA, 0x01/0xFF, one-hot byte-lane sweeps at every byte position,
      production-extreme weights -32/31 x acts -127/127 aligned, a zero row) + 240
      random full-range rows (every byte uniform in [-128,127]).
    - 256 realistic: weight bytes drawn as q6_K codes (uniform 0..63 -> q-32, i.e.
      exactly the range `SIGN6|EXP4|EXP2` can emit), activation bytes drawn by running
      the host-side equivalent of `quant_a_q8_1` math (Gaussian block -> amax -> rint
      quantization) so the codes come from the q8_1 distribution, including rare
      |q| = 127.
  - **Tolerance 0 everywhere**: int32 host reference computed with plain C
    (`(int8_t)(word >> 8*j)` products summed, chain incremented the same way as
    production), compared bitwise against both kernels' outputs and against each other.
  - Per-byte max |chain sum| bound is 16 x 128 x 128 = 262144, so no int32 saturation is
    reachable and the host plain-int reference cannot differ from the `_sat_` semantics.
  - Three-way verdict per the brief (A / B / C), plus a MIXED escape hatch; for verdict B
    the harness reports the **pattern**: mismatch counts per row-set and per chain, a
    histogram of (builtin - host) deltas, the first divergent chain step from K2, the
    first 12 raw mismatches, and match counts of 9 candidate reconstructions of the bug
    (unsigned `uu` interpretation, byte order reversed within each word, first-call-only,
    last-call-only i.e. accumulator dropped, low-2-bytes-only, high-2-bytes-only,
    negated, doubled, halved) so the lowering defect can be named, not just counted.
  - Exit codes: 0 = verdict A, 10 = B, 11 = C, 12 = MIXED, 1 = kernel build fail,
    3 = OpenCL setup error, 2 = usage. The K3 quant probe prints its own per-block
    verdicts and never changes the exit code.

Reconciliation note (spec 12.2 says both "8 packed weight-words + 8 packed
activation-words" and "16 products/row"): a row here is 8+8 words = one production
32-K step = 32 products, split into the two 16-product `dot4_q8a` chains the real kernel
computes (`raw1`, `raw2`). K1 reports both chains; K2's "8 calls per row with an
intermediate after each step" is 4 + 4 with the `r = 0` reset between, i.e. threaded
exactly as production.

## 2. Build (host side - done, artefacts on disk)

All in `/Users/marco/Projects/dp4a-builtin-harness/` (scratch dir, outside any git
repository). NDK r29 clang 21.0.0, android arm64, no ggml, no OpenMP.

### 2.1 Offline syntax gate for `probe.cl` (same gate the spec cell used)

```
/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang \
  -x cl -cl-std=CL3.0 -Xclang -finclude-default-header -target spirv64 \
  -fsyntax-only probe.cl
# rc=0 (1 warning: offline clang does not know the cl_khr_integer_dot_product pragma
# and ignores it - the same #ifdef guard production dp4a.cl uses; the NDK's
# opencl-c.h:17278 declaration of dot_acc_sat_4x8packed_ss_int is found, all four
# kernels parse)
```

### 2.2 Cross-compile

```
/opt/homebrew/share/android-ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang \
  -O2 -o dp4a_harness dp4a_harness.c \
  -I/Users/marco/kalsa-opencl-deps/android-prefix/include \
  -L/Users/marco/kalsa-opencl-deps/android-prefix/lib \
  -lOpenCL -lm --target=aarch64-linux-android28 -Wno-deprecated-declarations
# clang rc=0; sole warning = cl_version.h "CL_TARGET_OPENCL_VERSION not defined,
# defaulting to 310" (header pragma message, benign). Log: build.log in the same dir.
```

`-lm` is needed (bionic `logf`/`cosf` for the realistic-input Gaussian); `-lOpenCL`
is the Khronos ICD loader from `android-prefix` - same link line the s23-native-gpu-bench
cell proved works on the phone.

### 2.3 Artefacts

| file | sha256 | size |
|---|---|---|
| `dp4a_harness` (ELF64 PIE, AArch64, interpreter `/system/bin/linker64`) | `9912893ce4af34d155a6d299b816758d8acf7bdba5b67e3b53d861819e36edbd` | 21840 bytes |
| `probe.cl` (pushed alongside; the kernel source of record) | `be83e8e203d0efc7d8664e26fe71b8c98819f8c987b11ae3ffb6982a151d575a` | 4696 bytes |
| `dp4a_harness.c` (host source) | `cf234eb94366a9d3e84ab8ce0a757232a4686027b50df84f0d7494b009d37286` | 24008 bytes |

`llvm-readelf -d dp4a_harness`:

``
  NEEDED  Shared library: [libOpenCL.so]
  NEEDED  Shared library: [libm.so]
  NEEDED  Shared library: [libdl.so]
  NEEDED  Shared library: [libc.so]
``

Consequences for the run (from the s23 cell's verified facts): **no `LD_LIBRARY_PATH`
at all** - there is no `libomp.so` dependency (we do not build with OpenMP), and
`DT_NEEDED libOpenCL.so` resolves from bionic's default namespace, where `/vendor/lib64`
is a search path, so it binds the Qualcomm `/vendor/lib64/libOpenCL.so` directly (no ICD
vendor dir exists on the phone). SELinux stays Enforcing; that cell saw no `avc: denied`
for exactly this pattern of run under `/data/local/tmp`.

### 2.4 Host-side self-test of the harness's own math (so verdict C cannot be a
careless-host-bug)

`selftest.c` (not shipped) includes the host source and checks, on this Mac, with exit 0:

- `f32_to_half_rne` against Python `struct.pack('>e', ...)`-produced bits for all four
  probe scales: `1/127 -> 0x2008`, `0.005/127 -> 0x0295` (661, subnormal - the exact
  cliff value), `0.008/127 -> 0x0421` (just above the fp16 normal floor),
  `1e-4/127 -> 0x000d` (deep subnormal), plus 1.0/0.5 controls: all match.
- crafted-row host chain values by hand: row0 `16 * 16384`, row1 `16*127*127`,
  row2 `-16*127*128`, row7 `16*32*127`, row8 `16*31*127`, one-hot lane rows `16384`
  each, zero row `0`, prefix-sum structure of the K2 chain intermediates: all match.
- input contracts: realistic weight bytes all in [-32,31] (the q6_K/`SIGN6` range),
  realistic activation bytes all in [-127,127] (the `quant_a` range), every chain sum
  within +-262144 (no int32 saturation reachable, so plain-int host == `_sat_` semantics).

Result: `SELFTEST_OK fails=0`, exit 0. Output quoted here because the binary is
host-only and not part of the deliverable.

## 3. Push and run command lines (for the device-owning agent)

Artefacts referenced: `/Users/marco/Projects/dp4a-builtin-harness/{dp4a_harness,probe.cl}`.
Device directory is fresh (the s23 cell's `/data/local/tmp/s23gpu` was deleted in that
cell; nothing else under `/data/local/tmp` is touched).

```
mkdir -p /data/local/tmp/dp4a-harness                     # via: adb shell
adb push /Users/marco/Projects/dp4a-builtin-harness/dp4a_harness /data/local/tmp/dp4a-harness/
adb push /Users/marco/Projects/dp4a-builtin-harness/probe.cl      /data/local/tmp/dp4a-harness/
adb shell chmod 755 /data/local/tmp/dp4a-harness/dp4a_harness
adb shell "cd /data/local/tmp/dp4a-harness && ./dp4a_harness probe.cl"; echo "exit=$?"
```

No `LD_LIBRARY_PATH`, no `TMPDIR`, no cache dir, no model file. Expected wall time: a
few seconds (three 512-row kernels + one 4-block kernel). Exit codes to record:

| exit | meaning |
|---|---|
| 0 | verdict A - builtin == manual == host |
| 10 | verdict B - builtin != manual == host (driver miscompile) |
| 11 | verdict C - harness wrong |
| 12 | MIXED - inspect detail |
| 1 | `clBuildProgram` failed (build log printed verbatim) |
| 2 | usage | 
| 3 | OpenCL setup error (platform/device/context/buffer/enqueue/readback) |

Suggested capture (runner's choice): append `2>&1 | tee /data/local/tmp/dp4a-harness/run.out`
and `adb pull` it; the program is unbuffered (`setvbuf _IONBF`), so a partial log still
shows the last completed step.

## 4. What each verdict means (the point of the harness, one paragraph)

**Verdict A (builtin == manual == host, exit 0, all 512 rows bitwise equal at tolerance 0):**
the E031.41 driver computes `dot_acc_sat_4x8packed_ss_int` exactly as declared, so suspect 1
in `residual-after-q6k-route` 12.1 is dead and the 57x divergence must be sought elsewhere -
attention moves to suspect 2 (the fp16 `da` scale, whose K4 subnormal-flush result in the same
run then names or clears the cliff) and to the quantizer-grid/scale paths only the full kernel
exercises, while the one-file `as_char4` fix from 12.3 becomes unnecessary; **verdict B
(builtin != manual == host, exit 10):** the driver miscompiles the builtin under our exact
call sequence - the fix in 12.3 (replace the four calls in `dot4_q8a` with the `as_char4`
unpack body, which this run's manual kernel proves correct on the same inputs) is validated,
and the printed pattern names the defect: the first divergent chain step says whether the
accumulator threading breaks, the delta histogram says constant-factor vs value-dependent,
the per-set/per-chain split says input-class dependence, and the reconstruction table
(unsigned `uu` lowering, byte order reversed, accumulator dropped, low/high-2-bytes-only,
negated/doubled/halved) tells which wrong lowering the compiler emitted, so the win of up to
7.8% prefill throughput (plus the f32-route avoidance) goes back on the table with a known,
source-provable kernel body; **verdict C (builtin == manual != host, exit 11):** the driver is
innocent and the harness itself is at fault - either the manual kernel or the host int32
reference disagrees with two independently-written agreeing computations, nothing may be
concluded about Adreno, and the host-side self-test plus the reported rows are the starting
point for debugging this harness before spending any further device time.

## 5. Status and boundaries

- **Done on disk:** harness sources, offline syntax gate (rc=0), android-arm64 binary
  (sha256 + size above), host self-test (pass), push/run commands, this report.
- **Not done (by design):** the device run - the phone was **not** touched by this cell;
  owner schedules it. No engine tree was modified (only read from the existing detached
  worktree `/Users/marco/Projects/kalsallama-wt-1068` at `1068eb03d`). No commit, no push,
  no tag, no upstream anywhere; the harness lives in a plain scratch dir, not in any repo.
- **Residual risks:** (1) the offline syntax gate cannot prove the device compiler accepts
  the file - only `clBuildProgram` on the phone does, and a build failure exits 1 with the
  verbatim log, never a false verdict; (2) K4's `exp_sa` assumes device float ops on
  `d * sum` are bit-identical to host IEEE ops (true for a plain multiply, but if block 0
  *control* prints MISMATCH, read `da` only before judging the cliff); (3) verdict C's
  remaining escape hatch is a bug shared by the manual kernel and the host reference -
  they are independent code paths (driver builtin vs plain C) but both use the same byte
  order convention (byte j = bits 8j), which is also production's packing convention, so
  a shared byte-order mistake would masquerade as verdict B, not C; the one-hot lane-sweep
  rows 9-12 exist precisely to expose any such lane-order error from the pattern side.
