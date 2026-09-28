# onecopy-hmx-numerics — two-stage raw Q4_0 HMX path (experiment 2 of onecopy-hmx-estimate)

Owner-approved build of the numerics experiment proposed in
`../onecopy-hmx-estimate/REPORT.md` §A.3 (two-stage variant): behind `GGML_HEXAGON_RAW_HMX=1`, the HMX
pipeline consumes raw `-HOST` Q4_0 weights by converting each weight chunk's raw rows into the same tiles
the repacked buffer holds, then running the **unchanged** tile→fp16 dequant and MMA. Speed is explicitly
NOT claimed here (the scalar converter caps it; the fused reader is the follow-up). Purpose: prove the
math HMX sees is byte-identical to the repacked path, on device.

## Engine

- Worktree `/Users/marco/Projects/kalsallama-onecopy-hmx`, branch **`spike/onecopy-hmx-raw`**, commit
  **`9d5eaf681`** (base `c939a135d`, the head of `spike/hexagon-onecopy-rawq4`). **Not pushed.**
- Changes (`9d5eaf681`, 4 files, +149/−21):
  - `ggml-hexagon.cpp`: `opt_raw_hmx` static + `GGML_HEXAGON_RAW_HMX` parse; `ggml_hexagon_raw_weights_supported`
    admits raw Q4_0 MUL_MAT at any `mm_select` when the env is set; `offload_op` offloads a raw Q4_0 host
    weight when the env is set (nothing else changes).
  - `htp/matmul-ops.c`: `op_matmul` lets `HTP_MM_KERNEL_HMX_2D` through beside the flat kernel for raw
    Q4_0 (whole-block, `ne00 == ne10` guards unchanged); `hmx_mm_2d_f32` takes `raw_q4_0`, forces the
    pipelined layout, DMAs each chunk's raw rows packed into weight slot 0
    (`hmx_mm_push_raw_q4_0_chunk`), converts them into slot 1 (`q4_0_raw_chunk_to_tiles`), pushes the next
    raw chunk right after the conversion consumed the slot (the DMA overlaps dequant+MMA), and runs the
    unchanged `dequantize_tiled_weight_chunk_to_fp16_tiles` + MMA from slot 1. VTCM: raw is 0.9× the
    aligned tile bytes, tiles 1.0×, so the host's double-tile estimate still covers the raw layout.
  - `htp/q4_0-raw-tile.h`: `q4_0_raw_chunk_to_tiles`, the group-major chunk wrapper (tile
    t = group·n_k + k_tile, 640-byte stride = the tiled DMA landing zone), shared by DSP and host test.
  - `MUL_MAT_ID`, the fused NX kernels and non-Q4_0 raw weights stay refused exactly as before. Env
    unset → behavior identical to `c939a135d`.

## Host test (Mac)

`tests/test-hexagon-q4_0-raw-tile.c` extended with chunk cases (`{64,32} {64,96} {64,480} {336,96} {3,64}`,
i.e. the model's k=2048 and k=10752 shapes): the chunk conversion is byte-identical to the per-group
repack reference placed at the tiled-DMA layout, and every weight decodes to exactly
`dequantize_row_q4_0` (the indexing the dequant task uses, tile t = group·n_k + k_tile).

- Build `cc -std=c11 -O1 -Wall -Wextra …` exit 0, no warnings; run exit 0, **17/17 PASS**
  (`build-host/test-q4-raw-tile`).
- **Not runnable on the Mac**: everything else — the DMA pushes, the pipelined loop, the HMX submission,
  and the host `supports_op`/`offload_op` decisions (the Hexagon backend is not built on the host).
  Those are what the device A/B below proves.

## Android build (build-onecopy-hmx-v73)

Same preset (`arm64-android-snapdragon-release`, `BUILD_SHARED_LIBS=OFF`) and container
(`ghcr.io/snapdragon-toolchain/arm64-android:v0.7`) as the rawq4 builds. Configure `EXIT=0`.

- Build attempt 1 (`-j6`): `EXIT=1`, the documented OpenCL `embed_kernel.py` codegen flake.
- Attempt 2 (`-j2`): `EXIT=1` — the documented **qaic** flake for the v73 skel, but this time persistent
  (exit 137 = SIGKILL under Rosetta, ×7, for both v73 and v79; a 3 GB python allocation in the same VM
  succeeds, so not a memory cap). v79's qaic had already succeeded inside attempt 2, so `htp-v79` linked.
- Workaround for v73 (documented for reproducibility): `htp_iface.idl` is untouched by this change, so
  the v73d inner external-project dir was transplanted from
  `/Users/marco/Projects/kalsallama-onecopy/build-onecopy-v73d` (same commit, qaic outputs recorded in
  its `.ninja_log`), the inner build was driven with the worktree mounted at `/workspace` and the build
  dir mounted at the original `/workspace/build-onecopy-v73d` path (so the recorded qaic command line —
  which embeds the build path — matched), after bumping the recorded output mtimes in `.ninja_log`.
  Result: qaic skipped, only my changed files recompiled, `libggml-htp-v73.so` linked, inner `EXIT=0`.
  A `ninja` no-work check confirms the v79 skel is current for these sources.
- `llama-perplexity` linked with exit 0 (attempt 4).

| Artifact | Type | SHA-256 |
|---|---|---|
| `build-onecopy-hmx-v73/bin/llama-perplexity` | AArch64 Android PIE | `9d5c2609def957f0bd03641a474596ca5fafe903e6e5c41427b38d04f5127b50` |
| `build-onecopy-hmx-v73/ggml/src/ggml-hexagon/libggml-htp-v73.so` | Hexagon DSP6 | `f56217c0652a3d2e46211e78d42bf076e7d6127e304fe70c0d2c99df8448067f` |
| `build-onecopy-hmx-v73/ggml/src/ggml-hexagon/libggml-htp-v79.so` | Hexagon DSP6 | `e254ed23f64f905e592ed6dbde288098c4c32a7d6f321cd79e2aed7b10e6588e` |

## S23 numerics A/B (for the coordinator's device agent; plugged is fine, no timing claims)

Push (new dir; the kit and `onecopy/`, `onecopy-d/` stay untouched; skel and binary must be paired — the
DSP expects the new admission, an old skel with the new host aborts with `NO-SUPPORT`):

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'mkdir -p /data/local/tmp/govhtp/onecopy-hmx/bin /data/local/tmp/govhtp/onecopy-hmx/dsp'
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-v73/bin/llama-perplexity /data/local/tmp/govhtp/onecopy-hmx/bin/
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-v73/ggml/src/ggml-hexagon/libggml-htp-v73.so /data/local/tmp/govhtp/onecopy-hmx/dsp/
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'sha256sum /data/local/tmp/govhtp/onecopy-hmx/bin/llama-perplexity /data/local/tmp/govhtp/onecopy-hmx/dsp/libggml-htp-v73.so'
```

Arm 1 — **P0-hmx** (raw one-copy `-HOST`, HMX on, `RAW_HMX=1`; no `MM_SELECT` forcing, fusion off and no
warmup so the op tables are comparable; same fixture/CPU base as the P-series):

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-hmx/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_HOSTBUF=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_VERBOSE=1 && /data/local/tmp/govhtp/onecopy-hmx/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -lm none --no-warmup --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence -ot '.*=HTP0:0-HOST' -lv 5 > /data/local/tmp/govhtp/onecopy-hmx/p0-hmx-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0:0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy-hmx/p0-hmx-kld.log; grep -c \"execute-op MUL_MAT.*HTP0:0-HOST x\" /data/local/tmp/govhtp/onecopy-hmx/p0-hmx-kld.log; grep -c \"hmx-mm-2d:\" /data/local/tmp/govhtp/onecopy-hmx/p0-hmx-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy-hmx/p0-hmx-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy-hmx/p0-hmx-kld.log"
```

Arm 2 — **Q0-hmx** (two-copy normal buffer on the HMX ladder = today's shipped prefill kernel, same
binary, fusion off; also the first HMX-path KLD we will have):

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=\"/data/local/tmp/govhtp/onecopy-hmx/dsp;/data/local/tmp/govhtp/lib\" GGML_HEXAGON_DEVICES=HTP0:0 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_VERBOSE=1 && /data/local/tmp/govhtp/onecopy-hmx/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -lm none --no-warmup --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence -lv 5 > /data/local/tmp/govhtp/onecopy-hmx/q0-hmx-kld.log 2>&1; rc=\$?; echo EXIT=\$rc; grep -c \"HTP0:0 execute-op MUL_MAT\" /data/local/tmp/govhtp/onecopy-hmx/q0-hmx-kld.log; grep -c \"hmx-mm-2d:\" /data/local/tmp/govhtp/onecopy-hmx/q0-hmx-kld.log; grep -m3 \"dsp-error\\|NO-SUPPORT\\|ABORT\" /data/local/tmp/govhtp/onecopy-hmx/q0-hmx-kld.log; grep -E \"Mean PPL\\(Q\\)|Mean +KLD|Maximum KLD|Same top p\" /data/local/tmp/govhtp/onecopy-hmx/q0-hmx-kld.log"
```

Optional arm — env-off control (P0-hmx with `GGML_HEXAGON_RAW_HMX` unset and
`GGML_HEXAGON_MM_SELECT=1`): must reproduce the known flat raw result (mean KLD 0.004706 on this model,
`../hexagon-onecopy-rawq4/REPORT.md`), proving the default path is untouched by this commit.

**Pass criteria (P0-hmx vs Q0-hmx):**

1. Both `EXIT=0`, no `dsp-error` / `NO-SUPPORT` / `ABORT` lines.
2. P0-hmx: HTP0:0 `MUL_MAT` > 0 **and** `HTP0:0-HOST x` source count > 0 (raw weights actually ran on
   HTP) **and** `hmx-mm-2d:` FARF lines > 0 (the HMX kernel ran — `htp/matmul-ops.c` logs
   `hmx-mm-2d: m %d k %d n %d wtype %d …` per matmul).
3. KLD: P0-hmx equal to Q0-hmx within noise (the P0=P1 exactness logic: the converted tiles are
   byte-identical to the repacked buffer's, so with placement matched the math must match). Placement
   matched = identical `opset.sh` tables except the buffer names, run with the script from
   `../hexagon-onecopy-rawq4/raw/discriminators-2026-09-28/opset.sh` on the two logs (P-series method).
   Expect the pair to sit near the earlier fusion-off arms (Q0 0.002788 / P0 0.004706 band) — what
   matters is **P0-hmx − Q0-hmx ≈ 0**, not the absolute value.
4. Q0-hmx additionally gives the first HMX-path KLD number (unknown until now; the qdc 8 Elite report
   never measured a-hmx KLD).

## Caveats

- No timing claim: plugged, and the scalar converter makes the raw arm slow by construction (the fused
  HVX raw→fp16 reader is experiment 3 in the estimate report).
- With the env set, `try_fuse_mul_mat_add` may fuse a raw MUL_MAT+ADD through the HMX path (it requires
  `n_hmx > 0`); the P-series graphs contain no such op, so it is admitted but unexercised — same status
  the flat path's audit left it in.
- The v73 skel workaround above means the `onecopy-hmx/dsp` .so was linked from a transplanted external
  project dir; the binary/skel pair is still built from exactly `9d5eaf681` (only my changed files
  recompiled; `htp_iface.idl` identical, verified by diff).
- v79: the same sources compiled and linked `libggml-htp-v79.so` normally (its qaic succeeded before the
  flake began); usable for an 8 Elite arm later via `GGML_HEXAGON_ARCH=v79` on that device's harness.

### 2026-09-28 — S23 HMX one-copy correctness run

Correctness-only, plugged. Engine `9d5eaf681`. Local artifact SHA-256 matched the requested values;
push and device SHA checks returned `EXIT=0`:

| Artifact | SHA-256 |
|---|---|
| `llama-perplexity` | `9d5c2609def957f0bd03641a474596ca5fafe903e6e5c41427b38d04f5127b50` |
| `libggml-htp-v73.so` | `f56217c0652a3d2e46211e78d42bf076e7d6127e304fe70c0d2c99df8448067f` |

The new binary/skel pair was placed only in `/data/local/tmp/govhtp/onecopy-hmx/`; kit and earlier
onecopy directories were untouched. Device `strings` confirmed generic HMX code and the existing
flat raw-Q4 symbols, but did not expose `hmx-mm-2d:` or the inlined `q4_0_raw_chunk_to_tiles` helper.
The build's `matmul-ops.c.obj` bitcode contains `q4_0_raw_chunk_to_tiles`; the linked/device skel
hash matches the requested build. Runtime P0 logs also identify every relevant matmul's kernel type
as `hmx-tiled` with `HTP0:0-HOST` weights. The more specific DSP FARF line requested below was absent.

Pre/post gates for both runs: Awake, AC powered, level 100%, thermal status 0, traced 0, app stopped;
stay-on setting remained 15. P0 battery temperature was 32.3→33.9 °C; Q0 was 33.7→33.6 °C.
No DSP errors, `NO-SUPPORT`, aborts, or hangs. P0 `EXIT=0`; Q0 `EXIT=0`. One first attempt at
recording Q0's post-gate had a shell test typo (`[: missing ]`, exit 2); the gate was immediately
rerun correctly and passed (`q0.after.checked.txt`).

| Arm | HTP MUL_MAT | HOST source MUL_MAT | `hmx-tiled` | `hmx-mm-2d:` | Mean KLD ± SD | Max KLD | Same-top | Mean PPL(Q) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| P0-hmx raw `-HOST` | 1316 | 1316 | 1316 | 0 | 0.000928 ± 0.000053 | 0.010814 | 97.451 ± 0.699% | 32.216773 ± 4.842615 |
| Q0-hmx normal buffer | 1320 | 0 | 1320 | 0 | 0.000892 ± 0.000052 | 0.011580 | 97.843 ± 0.644% | 32.205994 ± 4.841256 |

The KLD mean difference is `+0.000036`, within the reported per-arm spread. However, `opset.sh`
returns nonidentical tables (P0 19 rows, Q0 26; diff exit 1). Q0 includes HTP `MUL` for ffn output,
operator norm and q/k layernorm, `SSM_CONV`, and four `result_output` matmuls which P0 does not;
P0 also has 4 fewer `MUL_MAT` operations. Thus these KLD values are not a placement-matched
numerics comparison.

**Verdict: NOT PASS / inconclusive.** HTP host-weight matmuls and the `hmx-tiled` kernel selection
are visible; both runs complete and produce finite, close KLD/PPL. The specified pass requires
`hmx-mm-2d:` FARF lines (>0) and matching opset tables; observed counts are zero and the tables
differ. Do not treat the KLD proximity as proof of raw-HMX equivalence. The optional env-off control
was skipped. Raw command logs, op tables, device strings and gates are retained locally under
`raw/s23-20260928-hmx/` (raw dumps are ignored by the lab repository).
