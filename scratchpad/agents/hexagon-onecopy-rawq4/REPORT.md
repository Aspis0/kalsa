# Hexagon one-copy: HTP reads raw GGUF Q4_0 (layout fix)

Engine worktree `/Users/marco/Projects/kalsallama-onecopy`, branch
`spike/hexagon-onecopy-rawq4` from `0a5c78231` (the `hexagon-offload-op` diagnostics
commit). Engine commit: `9a2fb2376`. No device was touched: no adb command was run.

## What was wrong (from the source, restated)

A `-HOST` weight keeps raw GGUF bytes (the HOST setter `memcpy`s,
`ggml-hexagon.cpp:2017`) and no `GGML_HEXAGON_TENSOR_REPACK` flag, so its
descriptor carries the original shape/strides (`ggml-hexagon.cpp:2321-2324`,
`else` branch) and `HTP_TENSOR_REPACK` is not set (`:2331-2333`). The DSP ignored
that flag: with the flat kernel type it always picked
`hvx_mm_2d_repacked_q4_0_flat` / `hvx_mv_2d_repacked_q4_0_flat`
(pre-patch `htp/matmul-ops.c:1528,1539`), which DMA 576-byte tiles from
`src0->data` (`TILE_SIZE` 576, pre-patch `:374-376`) and read them with
`flat_vec_dot_q4_0_32x{1,2}` (`htp/hvx-mm-kernels-flat.h:259,322`, tile stride
640 in VTCM `:283`, weight scales at `vptr[4]` `:304`). Raw 18-byte blocks read as tiles
are garbage, which matches the arm-c KLD (1.75e8, 0% top-1) in
`../hexagon-offload-op/REPORT.md`.

Tile format (the contract the fix must reproduce), from `repack_q4_0_tiled`
(`ggml-hexagon.cpp:817-870`): per 32 rows x 32 columns, byte `[cp*32 + row]` =
`q[row][2cp] | q[row][2cp+1] << 4` (`:858`), then 32 fp16 scales at `+512`
(`:862-866`); padding rows are quant 8 / scale 0 (`:852`, `:865`).

Prior art: none to reuse. Upstream ggml-hexagon repacked Q4_0 from its very first
commit (`63d2fc46e`: `repack_q4_0_q4x4x2`, `ggml-hexagon.cpp:652,1303`;
`vec_dot_q4x4x2_q8x4x2`, `htp/matmul-ops.c:310`); `git log -S block_q4_0` on
`htp/` shows no raw-block kernel since.

## The fix (engine)

Reuse, not a new framework: the DSP converts each 32-row group of raw rows to the
tile format in VTCM just before the unchanged flat dot kernels consume it. Shared
host weights are never rewritten.

- `htp/q4_0-raw-tile.h` (44 lines, new): `q4_0_raw_rows_to_tiles`, plain C,
  byte-for-byte the host repack's format. Scalar; also compiled on the Mac by the
  test below.
- `htp/matmul-ops.c:336-341` `hvx_mm_push_raw_q4_0`: 2-D DMA of the group's
  valid rows (`nb01` source stride, packed destination). `:343-347`
  `hvx_mm_raw_q4_0_to_tiles`: calls the converter into a VTCM tile buffer.
- The two flat job macros gained a compile-time `RAW_Q4_0` argument
  (`MATMUL_2D_TILES_IMPL` `:365`, `MATVEC_2D_TILES_IMPL` `:483`); the old macro
  names are wrappers passing 0, so the 12 existing instantiations are unchanged
  code. With `RAW_Q4_0`, the DMA ring uses `n_prefetch - 1` slots and the last slot
  holds the converted tiles (`:400-402`, `:521-523`). Raw rows fit a slot:
  32 x 18 x `n_k` <= 640 x `n_k` bytes; VTCM sizing is unchanged
  (`htp/matmul-ops.h:609-615` sizes `n_prefetch` tile rows per thread).
- New jobs `hvx_mm_2d_raw_q4_0_flat` (`:715`) and `hvx_mv_2d_raw_q4_0_flat`
  (`:819`), selected when `src0` lacks `HTP_TENSOR_REPACK` (`:1477,1596,1607`).
  `MUL_MAT_ADD` shares this dispatch (`htp/main.c:786-788`).
- Guards so raw weights never reach a tile-reading kernel again:
  DSP `htp_mm_has_raw_weight` (`:351`) makes `op_matmul` refuse raw weights
  unless Q4_0 + flat + no HMX (`:3682`), and `op_matmul_id`, `op_matmul_id_nx`,
  `op_matmul_nx` refuse them (`:4046,4166,4260`) with `HTP_STATUS_NO_SUPPORT`,
  which the host turns into an abort (`ggml-hexagon.cpp:6021`), not silent
  corruption. Host `ggml_hexagon_is_raw_weight` (`ggml-hexagon.cpp:2163`) makes
  `supports_op` decline raw weights for `MUL_MAT` unless Q4_0 and
  `GGML_HEXAGON_MM_SELECT=1` (`:5049`), always for `MUL_MAT_ID` (`:5073`), and
  keeps raw weights out of NX fusion (`:5847,5879`). Declined ops fall back to the
  CPU. No new env var.

Cost not measured. The conversion is a scalar byte shuffle per 32x32 tile on the
DSP, paid once per 32-row group per matmul and amortised over the ubatch rows;
expect prefill to be slower than the repacked flat path until it is vectorised.
Gate/up NX fusion is lost for raw weights (two separate matmuls).

## Host test (what was and was not tested)

`tests/test-hexagon-q4_0-raw-tile.c` (not in CTest) compiles the DSP header
itself on the Mac against a host `libggml-base` built in the worktree
(`build-host/`). Random `block_q4_0` rows, `n_k` in {1, 3, 64, 256},
valid rows in {32, 13, 1}:

- converter output vs a verbatim copy of the host `repack_q4_0_tiled` loops:
  **byte-identical in all 12 cases**;
- every weight decoded from the tiles the way the flat kernel indexes them vs
  ggml's CPU `dequantize_row_q4_0`: **max abs error 0** in all 12 cases.

Build `cc ... -Wall -Wextra` exit 0, no warnings; run exit 0, `ALL PASS`
(`raw/host_test.log`).

Not tested: nothing in `htp/` executed. The DMA push of raw rows (unaligned VTCM
destination rows, fast 2-D path on v73), the slot bookkeeping, the HVX dot on the
converted tiles, the guards, and all performance are unproven until the S23 run.
Because the converted tiles are byte-identical to what the normal buffer holds,
and arm a (flat HTP on repacked weights) was numerically sound, a correct DMA +
conversion should give arm-a-like KLD. The cache-coherence hypothesis is not
addressed by this change; the flush/uncached diagnostics from `0a5c78231` are
still in the build.

## Android build

Same toolchain image and preset as `build-s23-step0-v73` (preset
`arm64-android-snapdragon-release` from `docs/backend/snapdragon/CMakeUserPresets.json`,
`BUILD_SHARED_LIBS=OFF`); a cache diff against `build-s23-step0-v73` shows only
the toolchain-file cache type and the container hostname differ. That directory
was not touched.

```sh
docker run --rm --volume /Users/marco/Projects/kalsallama-onecopy:/workspace --workdir /workspace --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'cmake --preset arm64-android-snapdragon-release -B /workspace/build-onecopy-v73 -DBUILD_SHARED_LIBS=OFF' > raw/configure.log 2>&1; echo EXIT=$?
docker run --rm --volume /Users/marco/Projects/kalsallama-onecopy:/workspace --workdir /workspace --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'cmake --build /workspace/build-onecopy-v73 --target llama-perplexity htp-v73 -j6' > raw/build_android3.log 2>&1; echo EXIT=$?
```

Configure `EXIT=0` (`raw/configure.log`). The first two build attempts failed
without a compiler message in tool steps unrelated to this change: the OpenCL
`embed_kernel.py` step (`raw/build_android.log:88`) and `qaic` for the v73 skel
(`raw/build_android2.log:396`); `qaic` run by hand in the same image exited 0,
so both look like x86-emulation flakes. The third, identical incremental build
exited `0` (`raw/build_android3.log`), no warnings from the changed files.

| Artifact | Type | SHA-256 |
|---|---|---|
| `build-onecopy-v73/bin/llama-perplexity` | AArch64 PIE, static ggml | `6d29c123f09143b27e416655bfec96337bf3a414587eea2e0c9c5ad04e4a124b` |
| `build-onecopy-v73/ggml/src/ggml-hexagon/libggml-htp-v73.so` | Hexagon DSP6 shared object | `d34a511a7e1b01f73ca2601bf4cb6cea000c1c6494c83ad7df28b3bbfb611b68` |

`hexagon-nm` on the skel lists `hvx_mm_2d_raw_q4_0_flat` and
`hvx_mv_2d_raw_q4_0_flat` next to the repacked jobs. The fix lives in the DSP
skel, so **the skel must be pushed too**; the kit skel in
`/data/local/tmp/govhtp/lib` does not contain it.

## S23 commands (for the coordinator; not run)

Run only when the coordinator hands over the S23, with the same per-run
preflight/postflight gates as `../hexagon-offload-op/REPORT.md` (Awake, screen on,
thermal status < 3, battery < 43 C, unplugged, `traced` 0, force-stop
`com.kalsa.app`). New files go to a separate `onecopy/` dir so the kit stays intact;
`ADSP_LIBRARY_PATH` lists the new skel dir first. `GGML_HEXAGON_HOSTBUF_REPACK`,
`_FLUSH` and `_UNCACHED` stay unset.

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'mkdir -p /data/local/tmp/govhtp/onecopy/bin /data/local/tmp/govhtp/onecopy/dsp'
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-onecopy/build-onecopy-v73/bin/llama-perplexity /data/local/tmp/govhtp/onecopy/bin/
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-onecopy/build-onecopy-v73/ggml/src/ggml-hexagon/libggml-htp-v73.so /data/local/tmp/govhtp/onecopy/dsp/
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'sha256sum /data/local/tmp/govhtp/onecopy/bin/llama-perplexity /data/local/tmp/govhtp/onecopy/dsp/libggml-htp-v73.so'
```

1. One-copy, raw Q4_0 on HTP (the test):

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_HOSTBUF=1 && ./onecopy/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -ot '.*=HTP0:0-HOST' -lm none --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence > /data/local/tmp/govhtp/onecopy/rawq4-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy/rawq4-kld.log; grep -c \"execute-op MUL_MAT.*HTP0:0-HOST x\" /data/local/tmp/govhtp/onecopy/rawq4-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy/rawq4-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy/rawq4-kld.log"
```

2. Control, two-copy flat HTP on the normal (repacked) buffer with the new build,
to show the macro change did not regress the repacked path (arm a):

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 && ./onecopy/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence > /data/local/tmp/govhtp/onecopy/twocopy-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy/twocopy-kld.log; grep -c \"execute-op MUL_MAT.*HTP0:0-HOST x\" /data/local/tmp/govhtp/onecopy/twocopy-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy/twocopy-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy/twocopy-kld.log"
```

Pass criterion for run 1: `EXIT=0`; HTP `MUL_MAT` count > 0 **and** the
`HTP0:0-HOST x` count > 0 (the raw path actually ran on HTP); no `dsp-error` /
`NO-SUPPORT` line; KLD against the CPU base comparable to the normal-buffer HTP
run: mean KLD <= 0.005 (arm a: 0.002788), same-top-token >= 95% (arm a: 96.471%),
finite PPL near 33.4 (arm a: 33.3748; base 32.3370). Since the converted tiles are
byte-identical to the repacked ones, run 1 should land close to run 2. Run 2 must
reproduce arm a within the same bounds. If run 1 still fails while run 2 passes,
the layout fix is not sufficient and the queued flush/uncached runs decide the
coherence hypothesis. If run 1 aborts with `NO-SUPPORT`, a guard fired: read which
op in the log.

## GPU (Adreno OpenCL) — size of the 3-backend version

Not shareable today. Its `set_tensor` rewrites Q4_0 at load into SoA: a
convert kernel (`_noshuffle` for Adreno kernels) splits the tensor's own `cl_mem`
into scale and quant sub-buffers (`ggml-opencl.cpp:11133,11175,11388-11392`), and
large weights also get a `q_img` image (`:11360-11369`). It has no host path:
`.is_host = NULL` (`:14500`), `get_host_buffer_type = NULL` (`:14617`),
`buffer_from_host_ptr` returns `nullptr` (`:14581-14587`), `supports_buft` accepts
only OpenCL bufts (`:14594-14598`). A 3-backend copy needs an AoS raw-Q4_0 GPU
kernel on an imported rpcmem/dma-buf buffer plus a host buft, and gives up the
SoA/image layout the fast Adreno kernels use: bigger than this HTP fix.

## S23 device correctness — raw Q4_0 one-copy fix — 2026-09-28

The Android artifacts from engine commit `9a2fb2376` were SHA-256 checked
against the build report before transfer. `llama-perplexity` matched
`6d29c123f09143b27e416655bfec96337bf3a414587eea2e0c9c5ad04e4a124b`; the new
`libggml-htp-v73.so` matched
`d34a511a7e1b01f73ca2601bf4cb6cea000c1c6494c83ad7df28b3bbfb611b68`. Device
hashes matched too. Files were pushed only into `/data/local/tmp/govhtp/onecopy/`;
the new DSP directory was first in `ADSP_LIBRARY_PATH`, ahead of the kit path.

Both KLD arms used the registered two-chunk fixture, `-c 512`, and the same CPU
logits base. `-lv 5` made the debug `execute-op` records visible; counts use the
full device name `HTP0:0`. The app was force-stopped for each run. The phone was
plugged in for correctness only; no timing or heat comparison was made.

| Run | Exit | HTP MUL_MAT | MUL_MAT reading `HTP0:0-HOST` | Mean KLD | Max KLD | Same top p | Mean PPL(Q) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1: raw Q4_0 one-copy | 0 | 1080 | 1080 | 0.004706 ± 0.000397 | 0.116930 | 96.667 ± 0.796% | 33.971933 ± 5.161928 |
| 2: normal-buffer control | 0 | 811 | 0 | 0.002788 ± 0.000170 | 0.032330 | 96.471 ± 0.818% | 33.374816 ± 5.055062 |
| Earlier normal-buffer arm a | 0 | 182 in separate dispatch proof | 0 | 0.002788 | 0.032330 | 96.471% | 33.3748 |

**Verdict: PASS.** Run 1 meets the report criterion verbatim: `EXIT=0`,
`MUL_MAT > 0` and host-source `MUL_MAT > 0`, no `dsp-error`/`NO-SUPPORT`, mean
KLD ≤0.005, same-top ≥95%, and finite PPL near 33.4. Its mean PPL is 33.971933,
about 1.8% above 33.4 and within its reported ±5.16 chunk spread. Run 2 reproduces
the earlier normal-buffer arm a: KLD, top-p agreement, and PPL match the recorded
values. The raw-Q4 host-buffer fix is therefore correct on this S23 run.

Both logs contain a `failed to get URI ... Falling back to single session URI`
warning before the HTP session is created; HTP execution then proceeds. There are
no DSP error, `NO-SUPPORT`, crash, or abort markers. Every pre/post gate remained
Awake with the screen on, AC connected, battery above 30%, below 43 C, thermal
status below 3, and traced 0. Raw logs, gates, hashes, and command receipts are
under `raw/device-correctness-2026-09-28/`. A/B/C remain pending until unplugged.

## KLD gap analysis and review hardening — 2026-09-28

Engine commit `fe2daf5d6` (on `9a2fb2376`). No device and no adb in this step.
Evidence files: `raw/hardening-2026-09-28/` (op-set tables in
`op-set-comparison.txt`, derived from the two device logs in
`raw/device-correctness-2026-09-28/`).

### Why run 1 is at 0.0047 and run 2 at 0.0028

**It is not a numeric difference in the raw path. The difference is where the
non-HTP work runs.**

1. **1080 vs 811 is a logging artifact, not extra HTP matmuls.** Run 2 fused
   gate+up and q+k+v (`fused MUL_MAT_NX`: 266 two-way and 72 three-way fusions).
   Each fused op logs one `execute-op MUL_MAT` line, named after its first weight.
   Run 1 does not fuse (raw weights are kept out of NX fusion,
   `ggml-hexagon.cpp:5856`). On the real 128-token batches, run 2 has
   720 lines + 236 fused `ffn_up` + 128 fused `attn_k`/`attn_v` = 1084 matmuls:
   the same 1080 Q4_0 matmuls as run 1, plus 4 Q6_K lm_head
   (`token_embd.weight`, tied output). Run 2's other 91 lines are the 2-token
   warmup graph, which is not scored.
2. **The raw path is numerically identical per op.** The tiles are
   byte-identical to the repacked buffer (host test). The dot kernel and the
   activation quantizer are the same code for both paths. The partial-group
   padding path never runs: every raw weight has `ne01 % 32 == 0` (shapes
   2048x{2048,512,6144,10752}). A wrong DMA or conversion would corrupt whole
   32-row groups (arm c: KLD 1.75e8), not shift KLD by 0.002.
3. **What does differ is off-HTP placement.** On real batches (`op-set-comparison.txt`):
   - Run 2 also runs on HTP: `SSM_CONV` (176), the final norm/add (4 each), and
     the Q6_K lm_head (4). Run 1 runs them on the CPU (the lm_head because raw Q6_K
     is declined).
   - **`ffn_down` (30 layers, the largest matmul) runs on the CPU in both runs,
     because HTP declines it (`supports-op ... ffn_down ... no`), but with a
     different kernel.** Run 2's loader put it in `CPU_REPACK`
     (354.38 MiB, `load_tensors`), the same repacked kernel as the CPU base. The
     base was `-ngl 0` with default repack
     (`../hexagon-offload-op/raw/phase-b/cause-commands.txt:5`). Run 1 forces it into
     `HTP0:0-HOST` (1525.87 MiB, the only weight buffer), so the CPU runs the
     generic Q4_0 kernel on raw blocks. That is inherent to one-copy: the CPU
     repack *is* a second copy.
4. **Size of that effect, measured on the Mac** (same `ship.gguf` SHA `a247afd6…`,
   same fixture SHA `bca6ac9f…`, `-c 512 -b 512 -ub 128 --chunks 2`, CPU only,
   engine `fe2daf5d6` host build). The repacked base (`CPU_REPACK` 1511.20 MiB)
   vs the same run with `--no-repack` gives mean KLD **0.001574 ± 0.000105**,
   max 0.030952, same top 97.451%, with no HTP involved. That is the same order as
   the 0.0019 gap. It also matches the earlier S23 arm b (all matmuls CPU-generic
   on `-HOST`, KLD 0.001316). I could not isolate `ffn_down` alone on the Mac:
   `-ot ffn_down=CPU` re-selects the CPU extra buffers
   (`src/llama-model-loader.cpp:1233-1235`), and `CPU_REPACK` cannot be named in
   `-ot` (`common/arg.cpp:255-265`). So the exact split between the `ffn_down`
   kernel swap and the other placement changes is not measured.

**Verdict:** the op set / placement explains the gap, chiefly the CPU kernel
for `ffn_down` (generic on raw blocks vs the base's repacked kernel). Would the
normal buffer show the same KLD with the same op set? Expected yes, but not run.
The decisive S23 control is run 2 plus `--no-repack` (the normal-buffer HTP run
with `ffn_down` on the CPU generic kernel). Prediction: mean KLD ≈ 0.004–0.005.
A result near 0.0028 would refute this explanation and reopen the raw path.
Note that `--no-repack` is the app's current S23 CPU configuration
(`../hexagon-offload-op/REPORT.md:142`), so the one-copy number is not a
regression against what ships.

### Review hardening (space-bunny)

- **Decline raw weights for every op**, in one place:
  `ggml_hexagon_raw_weights_supported` (`ggml-hexagon.cpp:2176`), called at the
  top of `supports_op` (`:6716`). Any source that is a raw weight is declined unless
  the op is `MUL_MAT`, the source is src0, the type is Q4_0 and `MM_SELECT=1`. The
  two per-matmul checks were removed. `ggml_hexagon_is_raw_weight` (`:2163`) now
  also requires a `WEIGHTS`-usage buffer (set for every model buffer,
  `src/llama-model.cpp:1822-1826`), so a quantized KV cache is not misclassified,
  and it resolves views to `view_src`.
- **Underflow:** `hvx_mm_raw_group_rows` (`htp/matmul-ops.c:340`) asserts
  `ct * 32 < ne[1]`. It holds by construction (`ct < ceil(src0_end_row / 32)`,
  `src0_end_row <= ne01`), and the assert is a debug aid only: the HTP Release
  skel builds with `NDEBUG` (`htp/CMakeLists.txt:50`).
- **k bound vs slot / no recomputation:** push (`:345`) and convert (`:351`) both
  take the group's rows from the one helper, and `n_k` from the macro's slot basis
  `n_k_tiles_a = ne10 / 32`. The conversion therefore writes exactly the slot's tile
  count by construction. The raw DMA is `n_rows * n_k * 18 <= n_k * 640` bytes.
  `op_matmul` now refuses raw weights unless `ne00 == ne10` (`:3693`), a runtime
  check that holds in Release. The row count is shared rather than carried through
  the DMA ring: the ring only returns `dst`, and one helper removes the drift the
  review worried about.
- **Test build comment** now gives the rpath command (no DYLD/LD_LIBRARY_PATH).

Host test rerun with that exact command: build exit 0, no warnings; run exit 0
(with `DYLD_LIBRARY_PATH` unset), 12/12 PASS (`raw/hardening-2026-09-28/host_test.log`).

### Android build `build-onecopy-v73b` (new dir)

Same preset and options as `build-onecopy-v73`. Configure `EXIT=0`. Build attempt 1
`EXIT=1`: the same silent `qaic` failure as before
(`build_android.log:6`). Attempt 2 `EXIT=0` (`build_android2.log`). The build
emitted 38 warnings, none in the changed files. `hexagon-nm` shows both raw jobs in
the skel.

| Artifact | SHA-256 |
|---|---|
| `build-onecopy-v73b/bin/llama-perplexity` | `9aaaf4c8e99dd1b306b1518bfa63de92fda640a15add4a00e1e269a244aaf4d6` |
| `build-onecopy-v73b/ggml/src/ggml-hexagon/libggml-htp-v73.so` | `dcdbceb5523e0f27ed6da88c10ab83442bdfa47c64767efb656560513c4b73c6` |

At the time this build note was written, the hardened build and `--no-repack`
control had not run on the S23; both were subsequently run in the dated section
below.

## S23 hardened-build correctness and `--no-repack` discriminator — 2026-09-28

Engine commit `fe2daf5d6` artifacts were verified locally against the hashes in
the build report, then pushed only to `/data/local/tmp/govhtp/onecopy-v73b/`.
The device hashes matched. `ADSP_LIBRARY_PATH` placed `onecopy-v73b/dsp` before
the untouched kit `lib` directory. The three arms used the same fixture and CPU
base with `-lv 5`; all dispatch counts use full device name `HTP0:0`. No timing
or heat comparison was run.

| Run | Configuration | Exit | HTP MUL_MAT | HTP0:0-HOST MUL_MAT | Mean KLD | Max KLD | Same top p | Mean PPL(Q) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | Raw one-copy | 0 | 1080 | 1080 | 0.004706 ± 0.000397 | 0.116930 | 96.667 ± 0.796% | 33.971933 ± 5.161928 |
| 2 | Normal-buffer control | 0 | 811 | 0 | 0.002788 ± 0.000170 | 0.032330 | 96.471 ± 0.818% | 33.374816 ± 5.055062 |
| 3 | Run 2 + `--no-repack` | 0 | 811 | 0 | 0.002788 ± 0.000170 | 0.032330 | 96.471 ± 0.818% | 33.374816 ± 5.055062 |

Run 1 again passes the stated correctness gate. The hardened decline-everywhere
build still executes 1080 `MUL_MAT` operations from `HTP0:0-HOST`, with no
`NO-SUPPORT`, `dsp-error`, abort, or crash marker. Run 2 reproduces the previous
normal-buffer result. Its 811 execute lines include fused operations as described
above.

**Discriminator verdict: the `--no-repack` prediction is refuted, reopening raw-path
attribution.** Run 3 is
exactly at the normal-buffer result (mean KLD 0.002788), not the predicted
0.004–0.005. Its load log confirms that `--no-repack` put the CPU weights in the
normal CPU buffer (559.45 MiB; no `CPU_REPACK` allocation), while Run 2 used
`CPU_REPACK` (354.38 MiB). Thus the generic CPU `ffn_down` kernel alone does not
explain the Run 1 vs Run 2 KLD gap. Run 1 still passes the registered numerical
thresholds; its remaining difference from Run 3 requires raw-path/op-placement
attribution.

All arms passed pre/post Awake, screen-on, thermal, battery, traced, and
force-stop gates; the phone was plugged in for correctness only. All three logs
show a URI-fallback warning before successful HTP session creation, and no DSP
failure marker. Full logs, load-placement evidence, hashes, gates, and commands
are under `raw/device-correctness-2026-09-28-fe2daf5d6/`. A/B/C remain pending until the
phone is unplugged.

## Re-audit fixes (space-bunny, SHIP for device) — 2026-09-28

Engine commit `6fd40579d` (on `fe2daf5d6`). The device run of
`build-onecopy-v73b` (`fe2daf5d6`) is independent: that dir was not touched.
No device and no adb in this step. Evidence: `raw/reaudit-fixes-2026-09-28/`.

1. **Row bound survives Release.** `hvx_mm_raw_group_rows`
   (`htp/matmul-ops.c:340`) now branches:
   `ct * 32 >= ne1 ? 0 : MIN(32, ne1 - ct * 32)`. The assert is gone.
2. **`ne00 % 32 != 0` is refused, not truncated.** The DSP `op_matmul` returns
   `NO_SUPPORT` for raw Q4_0 with `ne00 % QK4_0` (`htp/matmul-ops.c:3692`). The
   host `ggml_hexagon_raw_weights_supported` declines it (`ggml-hexagon.cpp:2182`).
   ggml itself cannot build such a Q4_0 row, so both are pure guards.
3. **The census is reproducible.** `sh raw/reaudit-fixes-2026-09-28/census.sh`,
   run from this dir, reads the committed device logs
   (`raw/device-correctness-2026-09-28/{rawq4,twocopy}-kld.log.gz`). Output:
   `census.txt`, exit 0, identical on a second run. It counts
   `execute-op MUL_MAT|` lines, splits them by src1 batch (>= 32 = real batch,
   else warmup), counts `fused MUL_MAT_NX (N=…` events, and counts real-batch lines
   naming `ffn_gate`, `attn_q` and `token_embd`. Results:
   - run 1: 1080 lines, all real-batch, no fusion.
   - run 2: 811 lines = 720 real-batch + 91 warmup. Fusion events: 338 `N=2` and
     72 `N=3`. A q+k+v fusion logs N=2 and then N=3, so there are 266 gate+up
     fusions (= 236 real-batch `ffn_gate` lines + 30 warmup) and 72 q+k+v fusions
     (= 64 real-batch `attn_q` lines + 8 warmup).
   - Real-batch matmuls in run 2: 720 + 236 (`ffn_up`) + 2 × 64 (`attn_k`,
     `attn_v`) = **1084** = 1080 Q4_0 + 4 `token_embd` (lm_head, Q6_K). This equals
     run 1's 1080 Q4_0 matmuls.
4. **MUL_MAT_ADD is already admitted; no code change.** The host fusion
   `try_fuse_mul_mat_add` (`ggml-hexagon.cpp:2667`) has no raw check. Its params
   come from the same `ggml_hexagon_precompute_matmul_params_impl` as `MUL_MAT`
   (`:4689`), so it gets the flat kernel under `MM_SELECT=1`. The DSP routes it
   through the shared `op_matmul` dispatch (`htp/main.c:786-788`), and the raw jobs
   handle `src2`. It only fuses when `n_hmx > 0` or `src1_nrows == 1`
   (`ggml-hexagon.cpp:2696`), and neither happens in the S23 config (flat-only,
   threshold 32). So it is admitted but has never run with raw weights on the device.

Host test rerun (rpath command): build exit 0, no warnings; run exit 0 with
`DYLD_LIBRARY_PATH` unset, 12/12 PASS (`host_test.log`).

**Android build `build-onecopy-v73c` (new dir).** Same preset, configure `EXIT=0`.
Attempts 1-3 at `-j6` exited `1`, each on a silent failure of an OpenCL
`embed_kernel.py` codegen step (`oracle_consumer_q4_0_gemv.cl.h`,
`gemv_noshuffle_q4_k_f32_32b_trans.cl.h`, `softmax_f32.cl.h`;
`build_attempts.txt`). Attempt 4 at `-j2` exited `0` (`build_android4.log`). The flake looks tied to
parallel codegen under x86 emulation. No warnings come from the changed files.
`hexagon-nm` lists both raw jobs.

| Artifact | SHA-256 |
|---|---|
| `build-onecopy-v73c/bin/llama-perplexity` | `edd59af95c57ba1e9e036a8d6433ad5c292d6b86976837c2cfa76be2b5f22297` |
| `build-onecopy-v73c/ggml/src/ggml-hexagon/libggml-htp-v73.so` | `61c8d6f592786302b257d0d5676d992efcb21bde68aad2cde22447c3fedca640` |

Unproven on device: `6fd40579d` / `v73c`. Also still open: the run-2
`--no-repack` control from the gap analysis.


## Discriminating raw-path numerics vs placement — 2026-09-28

Engine commit `c939a135d` (on `6fd40579d`). NPU code is unchanged, so the `v73d`
skel is byte-identical to `v73c`. No device and no adb in this step. Evidence and
scripts: `raw/discriminators-2026-09-28/`.

**Correction to the previous section.** The run-2 `--no-repack` control
(lab `ff53c5f`, rewritten) gave KLD 0.002788, identical to run 2. So the
`ffn_down` CPU kernel does not explain the gap; my "ffn_down" attribution was
wrong. The Mac `--no-repack` figure (0.001574) does not transfer to the S23 CPU
kernels.

**The old `HOSTBUF_FLUSH` / `HOSTBUF_REPACK` arms were no-ops.** With `-lm none`,
the loader `read()`s directly into host buffers and never calls `set_tensor`
(`src/llama-model-loader.cpp:1668-1670`). The `-HOST` setter hooks
(`ggml-hexagon.cpp:1994-2026`) therefore never ran. That is why the REPACK arm's
marker is absent and its KLD equals the raw arm's
(`../hexagon-offload-op/raw/hostbuf-correctness-20260928/results.txt:11,13`).
`HOSTBUF_UNCACHED` acts at allocation and was a real arm. So a raw-vs-repacked
A/B cannot use the REPACK hook. The design below uses `-ot` instead.

### What differs between run 1 and run 2 (real batches)

`opset.sh` (below) run on the two device logs gives `opset-run1.txt` and
`opset-run2.txt`. Only run 2 has, on HTP: `SSM_CONV` (176), 4 more `ADD l_out`,
4 more `RMS_NORM`, and the lm_head `MUL_MAT result_output` (4). Run 2 also fuses
gate+up and q+k+v (410 NX events) and RMS_NORM+MUL (685 events). Run 1 fuses
nothing. Run 1 runs the norm-weight `MUL`s, `SSM_CONV`, the final norm and the
lm_head on the CPU, because their weights sit in `-HOST` and only `MUL_MAT`
opts in to offload. The Q4_0 matmul set is the same in both.

### Build `build-onecopy-v73d`

Same preset. Configure `EXIT=0`. Attempt 1 (`-j2`) `EXIT=1` on the OpenCL
`embed_kernel.py` codegen flake (`gemv_noshuffle_q4_k_f32.cl.h`); attempt 2
`EXIT=0` (`build_attempts.txt`). No warnings from changed files.

| Artifact | SHA-256 |
|---|---|
| `bin/llama-perplexity` | `b350d98f0c49836cb89363656514a030dd4ed98b7cb91f6bbceaad810ff0210c` |
| `bin/llama-eval-callback` | `6f7c13ca26259a90000c8f72de72c4cfa387f721f26380298f7c54fefa69b083` |
| `ggml/src/ggml-hexagon/libggml-htp-v73.so` | `61c8d6f592786302b257d0d5676d992efcb21bde68aad2cde22447c3fedca640` |

The only engine change: the debug callback now prints `hash = <FNV-1a of the
element bits>` after each tensor (`common/debug.cpp`), because six values at
`%.4f` plus a float sum cannot show bit identity. Host check: on the Mac CPU,
the ship model with the prompt below dumps 1014 tensors over 68 prompt tokens
(>= 32, so its matmuls go to HTP on the device). Two runs gave identical hashes.

### Design: one variable per arm

All arms use `GGML_HEXAGON_OPFUSION=0` (existing switch, `ggml-hexagon.cpp:115,3073`),
which removes both fusions, and `--no-warmup`. Fixture, CPU base, chunks and
gates are as before.

- **P0 (raw):** run 1 unchanged: all weights in `-HOST`, raw Q4_0 path.
- **P1 (repacked, same placement):** P0, but the 136 HTP-consumed Q4_0 matmul
  weights (`attn_q/k/v/output`, `ffn_gate/up`, `shortconv.in/out_proj`; the regex
  was checked against the model's tensor names) go to the normal `HTP0:0` buffer,
  which repacks on load. Everything the CPU reads (`ffn_down`, `token_embd`,
  norms, conv) stays in `-HOST` as in P0. The only difference is how HTP reads the
  same matmul weights: raw plus convert, or pre-repacked tiles.
- **Q0 (run 2, fusion off):** normal buffer, no `-ot`.
- **D0 / D0b / D1:** `llama-eval-callback` dumps with the P0 / P0 / P1 settings
  on one 68-token prompt. The callback splits the graph per node
  (`ggml-backend.cpp:1815-1835`, synchronized before each read), so no fusion
  either way.

Push (new dir, the kit and `onecopy/` untouched):

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'mkdir -p /data/local/tmp/govhtp/onecopy-d/bin /data/local/tmp/govhtp/onecopy-d/dsp'
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-onecopy/build-onecopy-v73d/bin/llama-perplexity /data/local/tmp/govhtp/onecopy-d/bin/
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-onecopy/build-onecopy-v73d/bin/llama-eval-callback /data/local/tmp/govhtp/onecopy-d/bin/
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-onecopy/build-onecopy-v73d/ggml/src/ggml-hexagon/libggml-htp-v73.so /data/local/tmp/govhtp/onecopy-d/dsp/
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'sha256sum /data/local/tmp/govhtp/onecopy-d/bin/llama-perplexity /data/local/tmp/govhtp/onecopy-d/bin/llama-eval-callback /data/local/tmp/govhtp/onecopy-d/dsp/libggml-htp-v73.so'
```

Decisive arms:

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-d/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 && /data/local/tmp/govhtp/onecopy-d/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -lm none --no-warmup --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence -ot '.*=HTP0:0-HOST' > /data/local/tmp/govhtp/onecopy-d/p0-raw-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy-d/p0-raw-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy-d/p0-raw-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy-d/p0-raw-kld.log"
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-d/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 && /data/local/tmp/govhtp/onecopy-d/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -lm none --no-warmup --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence -ot 'blk\.[0-9]+\.(attn_(q|k|v|output)|ffn_(gate|up)|shortconv\.(in|out)_proj)\.weight=HTP0:0,.*=HTP0:0-HOST' > /data/local/tmp/govhtp/onecopy-d/p1-repacked-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy-d/p1-repacked-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy-d/p1-repacked-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy-d/p1-repacked-kld.log"
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-d/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 && /data/local/tmp/govhtp/onecopy-d/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -lm none --no-warmup --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence  > /data/local/tmp/govhtp/onecopy-d/q0-normal-nofusion-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy-d/q0-normal-nofusion-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy-d/q0-normal-nofusion-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy-d/q0-normal-nofusion-kld.log"
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-d/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 && /data/local/tmp/govhtp/onecopy-d/bin/llama-eval-callback -m /data/local/tmp/heat3way/ship.gguf -p 'The history of the printing press begins in the fifteenth century, when Johannes Gutenberg combined movable metal type, oil-based ink and a wooden screw press into a practical system that could produce books far faster and more cheaply than scribes copying manuscripts by hand, and within fifty years presses operated in hundreds of European cities.' -n 1 -ngl 99 -dev HTP0:0 -lm none -ot '.*=HTP0:0-HOST' > /data/local/tmp/govhtp/onecopy-d/d0-raw.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"hash = \" /data/local/tmp/govhtp/onecopy-d/d0-raw.log"
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-d/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 && /data/local/tmp/govhtp/onecopy-d/bin/llama-eval-callback -m /data/local/tmp/heat3way/ship.gguf -p 'The history of the printing press begins in the fifteenth century, when Johannes Gutenberg combined movable metal type, oil-based ink and a wooden screw press into a practical system that could produce books far faster and more cheaply than scribes copying manuscripts by hand, and within fifty years presses operated in hundreds of European cities.' -n 1 -ngl 99 -dev HTP0:0 -lm none -ot '.*=HTP0:0-HOST' > /data/local/tmp/govhtp/onecopy-d/d0b-raw.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"hash = \" /data/local/tmp/govhtp/onecopy-d/d0b-raw.log"
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-d/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 && /data/local/tmp/govhtp/onecopy-d/bin/llama-eval-callback -m /data/local/tmp/heat3way/ship.gguf -p 'The history of the printing press begins in the fifteenth century, when Johannes Gutenberg combined movable metal type, oil-based ink and a wooden screw press into a practical system that could produce books far faster and more cheaply than scribes copying manuscripts by hand, and within fifty years presses operated in hundreds of European cities.' -n 1 -ngl 99 -dev HTP0:0 -lm none -ot 'blk\.[0-9]+\.(attn_(q|k|v|output)|ffn_(gate|up)|shortconv\.(in|out)_proj)\.weight=HTP0:0,.*=HTP0:0-HOST' > /data/local/tmp/govhtp/onecopy-d/d1-repacked.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"hash = \" /data/local/tmp/govhtp/onecopy-d/d1-repacked.log"
```

Local analysis after pulling the logs (scripts in `raw/discriminators-2026-09-28/`,
tested on the existing logs and on two host dumps):

```sh
sh raw/discriminators-2026-09-28/compare-dumps.sh d0-raw.log d0b-raw.log      # determinism of the raw path
sh raw/discriminators-2026-09-28/compare-dumps.sh d0-raw.log d1-repacked.log  # raw vs repacked, bit level
sh raw/discriminators-2026-09-28/opset.sh p0-raw-kld.log > p0.ops; sh raw/discriminators-2026-09-28/opset.sh p1-repacked-kld.log > p1.ops; diff p0.ops p1.ops
sh raw/discriminators-2026-09-28/opset.sh d0-raw.log 68 > d0.ops; sh raw/discriminators-2026-09-28/opset.sh d1-repacked.log 68 > d1.ops; diff d0.ops d1.ops
```

Validity gates: every arm `EXIT=0`, no `dsp-error`/`NO-SUPPORT`, HTP `MUL_MAT` > 0.
P0/P1 and D0/D1 op tables must be identical (`diff` empty); otherwise placement
moved and that pair does not isolate the path. P1's matmul lines must read
`HTP0:0 x HTP0:0-HOST`, P0's `HTP0:0-HOST x HTP0:0-HOST`.

**Expected outcomes**

| Hypothesis | P0 vs P1 | D0 vs D1 | D0 vs D0b | Q0 |
|---|---|---|---|---|
| (b) raw HTP path numerically differs | P0 > P1 | first difference at a `MUL_MAT` (first HTP matmul, `conv.in_proj-0`) with identical inputs | identical | ~0.0028 |
| (b') raw path nondeterministic (e.g. a DMA or VTCM race) | differ, and P0 ≠ run 1's 0.004706 | differ | **differ** | — |
| (a) placement (ops run 1 moves to CPU) | **equal** to all printed digits, both ≈ 0.004706 | IDENTICAL | identical | ~0.0028 |
| fusion (RMS_NORM+MUL / NX on HTP in run 2) | equal, ≈ 0.004706 | IDENTICAL | identical | ≈ 0.0047 |

My prior, not evidence: (a) or fusion. The tiles are byte-identical and the dot
and quantizer code is shared (host test). But the conversion is scalar stores into
VTCM followed by HVX loads, and nothing in this build proves that ordering on
device. D0 vs D0b and D0 vs D1 test exactly that.

**Follow-ups only if (a) holds (P0 = P1 and Q0 ≈ 0.0028).** Start from P1 and
move one group back to where run 2 has it, one arm each. The arm whose KLD drops
toward 0.0028 owns the gap.

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-d/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 && /data/local/tmp/govhtp/onecopy-d/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -lm none --no-warmup --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence -ot '(blk\.[0-9]+\.(attn_norm|ffn_norm|attn_q_norm|attn_k_norm)|token_embd_norm)\.weight=HTP0:0,blk\.[0-9]+\.(attn_(q|k|v|output)|ffn_(gate|up)|shortconv\.(in|out)_proj)\.weight=HTP0:0,.*=HTP0:0-HOST' > /data/local/tmp/govhtp/onecopy-d/p2-norms-htp-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy-d/p2-norms-htp-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy-d/p2-norms-htp-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy-d/p2-norms-htp-kld.log"
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-d/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 && /data/local/tmp/govhtp/onecopy-d/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -lm none --no-warmup --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence -ot 'blk\.[0-9]+\.shortconv\.conv\.weight=HTP0:0,blk\.[0-9]+\.(attn_(q|k|v|output)|ffn_(gate|up)|shortconv\.(in|out)_proj)\.weight=HTP0:0,.*=HTP0:0-HOST' > /data/local/tmp/govhtp/onecopy-d/p3-conv-htp-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy-d/p3-conv-htp-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy-d/p3-conv-htp-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy-d/p3-conv-htp-kld.log"
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-d/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_HOSTBUF=1 && /data/local/tmp/govhtp/onecopy-d/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -lm none --no-warmup --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence -ot 'token_embd\.weight=CPU,blk\.[0-9]+\.(attn_(q|k|v|output)|ffn_(gate|up)|shortconv\.(in|out)_proj)\.weight=HTP0:0,.*=HTP0:0-HOST' > /data/local/tmp/govhtp/onecopy-d/p4-lmhead-htp-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy-d/p4-lmhead-htp-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy-d/p4-lmhead-htp-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy-d/p4-lmhead-htp-kld.log"
```

- P2: the norm weights (`attn_norm`, `ffn_norm`, `attn_q_norm`, `attn_k_norm`,
  `token_embd_norm`; 77 tensors) go to the normal buffer, so the norm `MUL`s and
  the final norm run on HTP.
- P3: `shortconv.conv.weight` (22) goes to the normal buffer, so `SSM_CONV` runs
  on HTP.
- P4: `token_embd` goes to a CPU buffer (Q6_K is not CPU-repackable), so the
  lm_head offloads to HTP at batch 128 as in run 2. `GET_ROWS` stays on CPU.
- Check with `opset.sh` that each arm moved only its intended ops.

Committed: the two scripts. `*.txt` and `*.log` are ignored under `scratchpad/agents/`, so the tables and build records are inlined here instead of force-added.

`opset.sh` on the device logs (real batches):

```text
== run 1 (rawq4-kld.log.gz)
 232 ADD l_out
 236 ADD node_#
  64 FLASH_ATTN_EXT node_#
   8 GET_ROWS node_#
 352 MUL node_#
  64 MUL_MAT Kcur
  64 MUL_MAT Qcur
  64 MUL_MAT Vcur
 236 MUL_MAT ffn_gate
 236 MUL_MAT ffn_up
 176 MUL_MAT model.layers.{}.conv.in_proj
 176 MUL_MAT model.layers.{}.conv.out_proj
  64 MUL_MAT model.layers.{}.self_attn.out_proj
 604 RMS_NORM norm
 128 ROPE node_#
  64 SET_ROWS cache_k_l# (view)
  64 SET_ROWS cache_v_l# (view)
 236 SWIGLU ffn_swiglu
== run 2 (twocopy-kld.log.gz)
 236 ADD l_out
 236 ADD node_#
  64 FLASH_ATTN_EXT node_#
   8 GET_ROWS node_#
 352 MUL node_#
  64 MUL_MAT Qcur
 236 MUL_MAT ffn_gate
 176 MUL_MAT model.layers.{}.conv.in_proj
 176 MUL_MAT model.layers.{}.conv.out_proj
  64 MUL_MAT model.layers.{}.self_attn.out_proj
   4 MUL_MAT result_output
 608 RMS_NORM norm
 128 ROPE node_#
  64 SET_ROWS cache_k_l# (view)
  64 SET_ROWS cache_v_l# (view)
 176 SSM_CONV model.layers.{}.conv.conv
 236 SWIGLU ffn_swiglu
```

`build_attempts.txt`:

```text
attempt 1 (-j2) BUILD_EXIT=1
attempt 2 (-j2) BUILD_EXIT=0
DONE
```

Local logs (sha256):
- `build_android1.log` `eed36b4c94c7d2a39c1e3731aefc97bb685b482825f24a0c55ddad9f937349f4`
- `build_android2.log` `9498a8d4b207ff4ed1899fb082f25c19649ab5d8a6c872e0a5f5e41a722afdac`
- `configure.log` `4470af9c41cddc01ac39114429550c02d86967b1f1993a8ad8fc9e3afa7dc2da`

## 2026-09-28 — v73d one-copy placement discriminators (correctness only)

Ran on the S23 while plugged in; no timing or heat measurements were taken. The
three build artifact hashes matched the requested values locally and on device:
`llama-perplexity` `b350d98f0c49836cb89363656514a030dd4ed98b7cb91f6bbceaad810ff0210c`,
`llama-eval-callback` `6f7c13ca26259a90000c8f72de72c4cfa387f721f26380298f7c54fefa69b083`,
and `libggml-htp-v73.so` `61c8d6f592786302b257d0d5676d992efcb21bde68aad2cde22447c3fedca640`.
Model, fixture, and CPU-base hashes also matched the recorded values. Binaries
and the new DSP library went into `/data/local/tmp/govhtp/onecopy-d/`; the DSP
path was first in `ADSP_LIBRARY_PATH`, followed by the untouched kit directory.
Push commands each exited 0.

The six requested arms P0/P1/Q0/D0/D0b/D1 all exited 0. The first P0/P1
perplexity attempts also exited 0 and produced KLD output, but their op lines
were hidden by the common logger threshold despite `GGML_HEXAGON_VERBOSE=1`.
They were repeated with `-lv 5`; this changes visibility only. All reported
results below use the instrumented reruns, with `GGML_HEXAGON_OPFUSION=0`,
`--no-warmup` for perplexity, the same fixture/base, `-c 512 -b 512 -ub 128`,
and HTP0:0. Callback commands used the report's same 68-token prompt and
placement overrides with `-lv 5`.

| Arm | KLD mean ± SD | KLD max | Same top p | HTP MUL_MAT lines | Exit |
|---|---:|---:|---:|---:|---:|
| P0 raw all-HOST | 0.004706 ± 0.000397 | 0.116930 | 96.667% | 1080 | 0 |
| P1 selected matmul weights repacked | 0.004706 ± 0.000397 | 0.116930 | 96.667% | 1080 | 0 |
| Q0 normal-buffer, fusion off | 0.002788 ± 0.000170 | 0.032330 | 96.471% | 1084 | 0 |
| P2 P1 + norm weights on HTP | 0.004198 ± 0.000345 | 0.122586 | 96.078% | 1080 | 0 |
| P3 P1 + `shortconv.conv.weight` on HTP | 0.003016 ± 0.000213 | 0.047790 | 96.078% | 1080 | 0 |
| P4 P1 + `token_embd.weight=CPU` | 0.004706 ± 0.000397 | 0.116930 | 96.667% | 1080 | 0 |

**Cause:** The KLD signature is a placement effect, not a measured raw-Q4
coherence/layout penalty: P0 and P1 match at all printed KLD precision, while
Q0 is lower. Moving only the norms (P2) lowers mean KLD by 0.000508; moving
`shortconv.conv.weight` (P3) lowers it by 0.001690; moving token embeddings
(P4) changes nothing. `opset.sh` confirms P2 adds the expected HTP norm ops and
P3 adds the expected 176 `SSM_CONV` ops; P4's prefill op table matches P1.
The `shortconv.conv.weight`/`SSM_CONV` placement accounts for most of the
observed gap; norms account for a smaller part. P2+P3 together were not run.

`opset.sh` tables were identical for P0/P1 at ubatch 128 and D0/D1 at prompt
ubatch 68. D0 and D0b each dumped 1014 tensors and `compare-dumps.sh` found all
hashes identical. D0 vs D1 differed first at tensor 1007 (`ffn_gate-29`), then
`ffn_up-29` and downstream. The ubatch-1 op table shows why this dump pair is
not a raw-kernel comparison: D1 dispatches one `ffn_gate` and one `ffn_up`
`MUL_MAT` plus `SWIGLU` to HTP, while D0 leaves those decode ops on CPU. The
full dump mismatch is therefore confounded by decode placement. Raw Q4 path
coherence/layout is not decided by this batch; no nondeterminism was observed.

For every arm the captured pre/post wakefulness was `Awake`, and tracing stayed
0. Battery remained at 100% and AC-powered. Thermal status was 0 at preflight;
per-arm status stayed below 3 (P4 ended at 1); final status returned to 0. The
initial battery temperature was 28.3 °C and the final reading was 35.6 °C, both
below the 43 °C gate. `com.kalsa.app` was force-stopped before each binary run.
No `dsp-error`, `NO-SUPPORT`, or `ABORT` appeared. The screen was left on.

The exact device logs, per-run gate output, push hashes, and analysis outputs
are in `raw/discriminators-2026-09-28-v73d/`; verbose DSP logs are gzip-compressed
there. Local copies of `.log` and `.txt` are ignored by the lab rules, so only
the non-ignored compressed logs and evidence files are committed; no force-add
was used.
