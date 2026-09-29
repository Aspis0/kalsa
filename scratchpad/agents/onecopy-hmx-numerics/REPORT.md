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

### 2026-09-28 rerun 2 (S23, plugged: correctness only) - placement-matched, FARF on

Device run by luna 1e8ee666; lines re-read by the coordinator from `/tmp/onecopy-hmx-dbg/` (raw logs
not in the lab: the P0 adsprpc logcat alone is 841 MB).

- Build `build-onecopy-hmx-v73-dbg` (GLM 0c452cc5): same commit `9d5eaf681`, only
  `-DGGML_HEXAGON_HTP_DEBUG=ON` (`FARF_HIGH=1` in all 29 skel compile commands). `llama-perplexity`
  `b0679554...efcc`, `libggml-htp-v73.so` `a5b9e7d5...af66`; device hashes match.
- FARF: `llama-perplexity.farf` = `0x1F` in the first ADSP_LIBRARY_PATH dir; lines captured with
  `logcat -s adsprpc` (they never reach the perplexity log - why rerun 1 counted 0).
- Placement: P0 `-ot '(blk\.[0-9]+\.(attn_norm|ffn_norm|attn_q_norm|attn_k_norm|shortconv\.conv)|token_embd_norm)\.weight=HTP0:0,token_embd\.weight=HTP0:0,.*=HTP0:0-HOST'`
  (P5 pattern + tied output weight on the normal buffer). `opset.sh` tables: **identical** (diff exit 0).

| arm | EXIT | HTP MUL_MAT | `hmx-mm-2d:` (logcat) | Mean KLD | Max KLD | Same top p | PPL(Q)/PPL(base) |
|---|---|---|---|---|---|---|---|
| P0-hmx raw one-copy | 0 | 1320 (1316 from `-HOST`) | 65076, wtype 2 | 0.000946 ± 0.000052 | 0.011872 | 97.843 % | 1.004622 |
| Q0-hmx normal buffer | 0 | 1320 | 1397, wtype 2 | 0.000892 ± 0.000052 | 0.011580 | 97.843 % | 0.995948 |

No `dsp-error` / `NO-SUPPORT` / `ABORT` in either arm.

Verdict: **PASS on execution and placement** (raw weights ran through the HMX kernel with matched
opsets). **Numerics close, not identical**: the design predicted P0 == Q0 exactly (byte-identical tiles);
measured KLD differs by 0.000054 (about one SD) and PPL drifts in opposite directions. Same-top-p is
equal. Unexplained; hypothesis (unverified): P0 issues ~47x more HMX calls (chunked raw push), so the
accumulation order/precision across chunks differs from Q0's. To be explained before or inside the
fused raw-to-fp16 reader work.

## 2026-09-29 - fused raw->fp16 HMX reader: correctness and first timing (S23 v73)

Engine `spike/onecopy-hmx-raw` (not pushed): `ee137ee24` fused reader (GLM), audit space-bunny
`3ee8aa3b` found the scale never read and a wrong rotate (the "simulator validation" in the report
was a failing scratch probe, admitted by the coder); fixed in `8a6840991`, committed simulator
harness `3d14787b9` + cleanup `a18a233ec`/`7d1f41918` (re-audit `27656745`: SHIP). Coordinator ran
`tests/hexagon-sim/run-raw-reader.sh` twice: EXIT=0, ALL PASS (n_k 64/336, rows 32/96, shifts 0/2,
wrap-crossing spans, canary). Device artifacts: `llama-perplexity` `1b4992bb...`, v73 skel `df578d80...`.

**Correctness (luna `df94cf71`, lines re-read by the coordinator):**

| arm | EXIT | Mean KLD | PPL(Q) | Same top p |
|---|---|---|---|---|
| P0 fused raw, run 1 / run 2 | 0 / 0 | 0.000946 / 0.000946 | 32.486482 / 32.486482 | 97.843 % |
| Q0 two-copy, run 1 / run 2 | 0 / 0 | 0.000892 / 0.000892 | 32.205994 / 32.205994 | 97.843 % |
| P0 env off (flat raw) | 0 | 0.001701 | 31.723906 | 97.451 % |

Runs are bit-deterministic; opsets P0 == Q0 (empty diff). The fused reader gives EXACTLY the
two-stage path's numbers (rerun 2 above), so the reader is not the cause of the P0/Q0 gap. New lead:
in P0 many activations live in the `HTP0:0-HOST` buffer (execute-op lines with HOST sources: ADD 464,
RMS_NORM 472, ROPE 128, FLASH_ATTN_EXT 64, GET_ROWS 184, SET_ROWS 128, besides MUL_MAT 1316); in Q0
none. Next discriminator: per-tensor exact hashes (debug callback from `c939a135d`) P0 vs Q0, first
diverging tensor.

**Timing, unplugged (luna `9c8ff7f7`, llama-bench -ub 512 -r 3, fusion off; rows re-read):**

| arm | pp512 tok/s | tg128 tok/s | model memory |
|---|---|---|---|
| Q0 two-copy HMX | 873.86 ± 8.35 / 849.78 ± 21.61 | 19.66 / 20.09 | 1525.87 MiB HTP0 |
| P0 one-copy fused raw HMX | 125.25 ± 0.15 / 122.94 ± 0.47 | **1.22** (run 1 aborted: `dspqueue_write failed: 0x00000001`, exit 134) | 219.75 MiB HTP0 + 1306.12 MiB HOST |
| PF one-copy flat (old) | pp128 31.18 | - | same as P0 |

Verdict: the fused reader is 4x the flat path but still **~7x slower than two-copy** in prefill
(estimate was 900-1600 on the 8 Elite: not met on S23). Decode through the raw HMX path is unusable
(1.22 tok/s) and crashed once. Open: where the prefill time goes (reader vs raw DMA vs pipeline
overlap); why decode collapses and the dspqueue_write failure.

## 2026-09-29 - c8d215de2 diagnostics on the S23 (luna `2dc99ad0`, unplugged; lines re-read)

Engine `c8d215de2`: small-m raw Q4_0 matmuls are no longer advertised to the HTP (audit
`e24651f9`: before, the DSP refused them with NO_SUPPORT and decode FAILED; `1e1752910`'s DMA
prologue change is correct but gains ~0, the raw DMA was already overlapped).

- **Correctness:** Q0 KLD 0.000892 (unchanged); P0 0.000943 (was 0.000946 - the few small-m
  ffn matmuls now run on the CPU: P0 has 29 not 30 HTP ops per ffn family).
- **P0/Q0 gap source found:** the FIRST differing tensor hash (llama-eval-callback, 75-token prompt)
  is stream index 0, `model.embed_tokens = GET_ROWS(token_embd.weight)`: P0 reads a scheduler copy
  `CPU#token_embd.weight#0` of the q6_K embedding that the P0 `-ot` put on the HTP0:0 buffer; Q0
  reads it straight from the CPU buffer. So the gap comes from the embedding placement chosen to
  match opsets, NOT from the raw reader. Open: the HTP0:0 -> CPU copy of a q6_K tensor returning
  different bytes means the HTP buffer's read-back of q6_K is not lossless (possible engine defect
  worth its own check).
- **Decode, llama-bench tg128:** Q0 19.66 +- 0.80; P0 **1.47** +- 0.14; P0 env off 1.15. In the P0
  `-v` decode log zero HTP MUL_MATs read an `HTP0:0-HOST` source: decode runs on the CPU and is
  still ~13x slower than two-copy - suspect the CPU cannot read the -HOST buffer in place (if the
  buffer type is not host, the scheduler copies weights every token). Unverified.
- **DSP stage profile, pp512 (GGML_HEXAGON_PROFILE=3), Q4_0 matmuls total ms:**
  Q0 DMA 301.3 / HVX reader 128.0 / HMX 265.6; P0 DMA 3248.0 / reader 3204.1 / HMX 256.0.
  Worst family ffn_down (k 10752): P0 reader 1891 ms vs Q0 77 ms. HMX compute is equal; the reader
  is ~25x on device (3.75x in the simulator) and the raw DMA ~10.8x. The one-copy prefill is
  bound by the reader + raw DMA, not by HMX.
