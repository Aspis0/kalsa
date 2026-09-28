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
