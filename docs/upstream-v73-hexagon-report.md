# llama.cpp Hexagon backend: three independent v73 DSP-skel crash mechanisms

## Summary

On a Samsung Galaxy S23 / Snapdragon 8 Gen 2 using the Hexagon v73 skel, the artifacts show three distinct failure mechanisms: a cDSP user-PD NULL dereference in `op_binary` that surfaces on the host as `dspqueue_read` `0x2e`; a separate cDSP `qurt_exit()` path in `htp_iface_stop` that remains after all binary operations are removed from HTP; and a write-side `dspqueue_write` `0x1` abort in `flush_batch` for a trunk-only perplexity workload. The Xiaomi 14 / Snapdragon 8 Gen 3 v75 comparison runs the same OLMoE model and host revision, including the same 407-op MoE packet, to completion. These observations establish a v73/v75 liveness difference for the tested packets; they do not establish numerical correctness on v75. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md) [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md) [q53 `REPORT.md`](../scratchpad/agents/q53-v73-npu-correctness/REPORT.md) [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)

## Environment and pins

| Item | v73 crash device | v75 comparison device | Evidence |
|---|---|---|---|
| Device / SoC | Samsung Galaxy S23, `SM_S911U` / `dm1q`; Snapdragon 8 Gen 2, Hexagon v73 | Xiaomi 14 (`houji`), `23127PN0CG` / `pineapple`; `SM8650`, Snapdragon 8 Gen 3, Hexagon v75 | [q46 `SESSION_LOG.md`](../scratchpad/agents/q46-lfm-bprime-smoke/SESSION_LOG.md), [q16 `REPORT.md`](../scratchpad/agents/q16-xiaomi/REPORT.md), [ALIVE.md](ALIVE.md) |
| HTP hardware report | `threads 4, hvx 4, hmx 1, vtcm 8 MB` | The q50 comparison records the same reported HTP counts on v75 | [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md) |
| Android / skin | Android 16 is present in the S23 crash fingerprint (`samsung/dm1qsqw/dm1q:16/...`); the One UI version was not recorded in the supplied crash artifacts | Android / Xiaomi skin version was not recorded in the supplied v75 comparison artifacts | [q50 `logcat_repro.txt`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_repro.txt), [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md) |
| llama.cpp / ggml revision | Upstream commit `3f545beccee69d9975f466ec7e45fd9aacd8ba90` (`3f545be`) | Same host revision | [q53 `RUN_LOG.md`](../scratchpad/agents/q53-v73-npu-correctness/RUN_LOG.md), [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md) |
| Android host build | arm64-v8a, android-31, Release; `-march=armv8.7a+fp16+dotprod+i8mm -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE`; Release `-O3 -DNDEBUG`; `GGML_HEXAGON=ON`, `GGML_OPENMP=OFF`, `GGML_LLAMAFILE=OFF`, `GGML_OPENCL=OFF` unless explicitly available, `LLAMA_OPENSSL=OFF`, `PREBUILT_LIB_DIR=android_aarch64`; NDK 27.1 | Same host-side recipe for the compared binaries | [q53 `RUN_LOG.md`](../scratchpad/agents/q53-v73-npu-correctness/RUN_LOG.md), [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md) |
| Hexagon SDK | SDK 6.6.0.0 | Same pinned SDK family | [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md) |
| Binary pins | `llama-bench` stub `5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507`; `libggml-hexagon.so` `f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448`; v73 skel `libggml-htp-v73.so` `c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5` | v75 skel `libggml-htp-v75.so` `46d3ac923988f20b75d6d3489eea0e1432aa275aaff61c39253e170c17729182` | [q53 `manifest.json`](../scratchpad/agents/q53-v73-npu-correctness/manifest.json), [q28 `BUILD-MANIFEST.txt`](../scratchpad/agents/q28-hexagon-sdk/BUILD-MANIFEST.txt) |
| Baseline environment | `NDEV=1`, `VERBOSE=1`; q48/q46 llama-bench runs left `HOSTBUF` unset | Direct v75 pair used `HOSTBUF=1` and `--no-host 1`; the S23 repeat with those same flags still died | [q48 `SESSION_LOG.md`](../scratchpad/agents/q48-olmoe-q40-npu/SESSION_LOG.md), [q46 `SESSION_LOG.md`](../scratchpad/agents/q46-lfm-bprime-smoke/SESSION_LOG.md) |

The q51 guard is a host-only experiment: it added `GGML_HEXAGON_NO_BINARY=1` support to decline ADD/SUB/MUL/DIV, rebuilt `libggml-hexagon.so`, and did not rebuild the v73 skel. The v73 skel hash remained `c8f9d14a…`. [q51 `PATCH.diff`](../scratchpad/agents/q51-f2b-v73-guard/PATCH.diff) [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md)

## Signature 1: v73 `dspqueue_read 0x2e` after `op_binary` NULL dereference

### Trigger and observed failure

The trigger is the all-Q4_0 OLMoE-1B-7B graph on the S23 v73 path. The repro GGUF is `3,928,037,856` bytes with SHA-256 `43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500`; it contains `113` Q4_0 tensors, `81` F32 tensors, and one Q6_K `output.weight`. It was produced from the Q8_0 source with `llama-quantize.exe --allow-requantize SRC DST Q4_0 16`. [q48 `PREP.md`](../scratchpad/agents/q48-olmoe-q40-npu/PREP.md)

The minimal recorded workload is `llama-bench` with `-p 16 -n 8 -r 1 --no-warmup -ngl 99 -dev HTP0 --no-host 1 -o jsonl --load-mode none -fa on --ubatch-size 1024`. The v73 run used `NDEV=1`, `VERBOSE=1`, `HOSTBUF=1`; the first HTP batch contained `407` ops, `252` tensors, and `6` buffers, with `m-size 124960` and vmem `3120996864`. Its observed op mix included `129` ADDs, `65` RMS operations, `65` MUL operations, `48` `MUL_MAT_ID` operations, and `16` ARGSORT operations. [q50 `logcat_hits.txt`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_hits.txt) [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md) [q48 `SESSION_LOG.md`](../scratchpad/agents/q48-olmoe-q40-npu/SESSION_LOG.md)

The host-visible error is:

```text
ggml-hexagon.cpp:1583: ggml-hex: dspqueue_read failed: 0x0000002e
```

The cDSP crash preceding it is:

```text
CDSP0: Process "/frpc/... llama-bench" crashed in thread "htp-main" due to TLBMISS RW occurrence
CDSP0: Crashed Shared Object "./libggml-htp-v73.so"
CDSP0: Fault PC   :    0x20049E8C
CDSP0: Bad VA     :    0x0
CDSP0: Error code :    0x7003
CDSP0: [<20049E8C>] op_binary+0x5B9C:     (./libggml-htp-v73.so)
CDSP0: [<200497FC>] op_binary+0x550C:     (./libggml-htp-v73.so)
CDSP0: [<20004D48>] work_queue_run_async+0xD8
CDSP0: [<20044958>] op_binary+0x668
CDSP0: [<20003DD0>] htp_iface_stop+0xB90
```

The source inspection in the diagnosis identifies `htp/binary-ops.c:857` `op_binary()` as the relevant handler; its first access reads `src1->nb[1]` without a NULL check at approximately lines `860–862`. The evidence therefore supports a v73 `op_binary` NULL dereference, with a NULL `src[1]` or NULL `data` as the matching candidate. The exact operand pointer was not printed by the crash. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md) [q50 `logcat_hits.txt`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_hits.txt)

`0x2e` is `AEE_EINTERRUPTED` / `AEE_EINTERRUPTED (46)`, meaning the response wait was canceled; it is not the timeout code. The host retries `AEE_EEXPIRED (0x00C)` and `AEE_EWOULDBLOCK`, then aborts for other errors. Here the cDSP PD is already gone, so the host observes the canceled response wait and aborts. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md)

### Ruled out or bounded

- **Timeout:** ruled out by the error-code distinction above; timeout is `0x00C`, not `0x2e`. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md)
- **Packet-too-large / queue write failure:** the batch write is logged before the cDSP crash, and the failure is on response read; the diagnosis records a `125 KB` OLMoE graph descriptor against an `852 KB` shared-memory block. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md)
- **HOSTBUF or `--no-host`:** repeating the S23 run with `HOSTBUF=1` and `--no-host 1` still produced `dspqueue_read 0x2e`, with `48` expert `MUL_MAT_ID` dispatches. [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)
- **HMX-only failure:** adding `GGML_HEXAGON_MM_SELECT=2` forced HVX, removed expert HTP dispatch, and still produced the same `0x2e` before any expert `MUL_MAT_ID`. [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)
- **Only the 407-op batch size:** the HVX variation died with a `27`-op maximum and about `186 MiB` vmem, so the large default HMX batch is an aggravating condition but not a sufficient explanation. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md)

### Minimal reproduction supported by the artifacts

1. Use the exact OLMoE GGUF above; a generic OLMoE or another quantization is not claimed equivalent.
2. Use the pinned v73 host/skel pair and set `NDEV=1`, `VERBOSE=1`, `HOSTBUF=1`.
3. Run the recorded `llama-bench` command above against HTP0, with `--no-host 1`; collect stderr and cDSP logcat from before launch through abort.
4. Expected result on the recorded S23 setup is host `dspqueue_read 0x2e` and the cDSP `TLBMISS RW`, `Bad VA 0x0`, `op_binary+0x5B9C` block. [q50 `logcat_repro.txt`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_repro.txt)

## Signature 2: binary ops removed, then v73 `qurt_exit()` in `htp_iface_stop`

### Trigger and observed failure

This is the controlled follow-up to Signature 1. The q51 patch makes `ggml_backend_hexagon_device_supports_op()` decline ADD/SUB/MUL/DIV when `GGML_HEXAGON_NO_BINARY=1`; the patch leaves `MUL_MAT` and `MUL_MAT_ID` on HTP. The same OLMoE Q4_0 GGUF, v73 skel, and `HOSTBUF=1 --no-host 1` environment were used. The run was `pp16/tg8 -v`, exited `rc=134`, emitted no JSONL, and recorded `n_binary_htp0=0` but `n_exps_htp0=42`. [q51 `PATCH.diff`](../scratchpad/agents/q51-f2b-v73-guard/PATCH.diff) [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md)

With binary ops declined, the HTP graph split into batches of `1–8` ops. The last logged work was:

```text
HTP0 execute-op MUL_MAT_ID|blk.13.ffn_down_exps.weight ... hmx-tiled
HTP0 op-queue push batch #3 : n-bufs 3 n-tensors 15 n-ops 8 ...
ggml-hexagon.cpp:1584: ggml-hex: dspqueue_read failed: 0x0000002e
```

The cDSP block is materially different from Signature 1:

```text
Application called qurt_exit(), Error 0x108
Fault PC 0xD269BC
Crashed SO fastrpc_shell_unsigned_3
qurt_exception_raise_nonfatal+0x1C -> raise+0xFC -> abort+0x8 -> htp_iface_stop+0x12E8
```

The report explicitly records that the stack does not name `op_binary`, `op_matmul_id`, or SWIGLU/glu. The host still sees `AEE_EINTERRUPTED` because the response wait is canceled, but the cDSP-side termination mechanism and fault site differ from Signature 1. [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md) [q51 `cdsp_crash_block.txt`](../results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/cdsp_crash_block.txt)

### What this isolates

- The `op_binary` hypothesis is insufficient for v73 MoE liveness: the guard produced zero HTP binary-op lines and still killed the PD. [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md)
- This is not a shifted `op_binary` crash: the cDSP error is `0x108`, the fault is in `fastrpc_shell_unsigned_3`, and the stack ends at `htp_iface_stop+0x12E8`; no op handler is named. [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md)
- The unchanged v73 skel hash (`c8f9d14a…`) bounds the result to a host scheduling/support-op change plus the same v73 skel, rather than a new skel build. [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md)
- This experiment does not identify why `htp_iface_stop` called `qurt_exit()`; it identifies a second, independent cDSP death path and shows that removing binary ops is not a liveness fix.

### Minimal reproduction supported by the artifacts

1. Start from the exact Signature 1 OLMoE GGUF and pinned v73 runtime.
2. Apply the uncommitted host-only change in `q51-f2b-v73-guard/PATCH.diff`, or use an equivalent host build exposing `GGML_HEXAGON_NO_BINARY=1`.
3. Set `NDEV=1`, `VERBOSE=1`, `HOSTBUF=1`, `GGML_HEXAGON_NO_BINARY=1`, and run the same `pp16/tg8 -v` HTP0 command with `--no-host 1`.
4. Expected result on the recorded S23 setup is `n_binary_htp0=0`, an HTP expert `MUL_MAT_ID` batch, host `dspqueue_read 0x2e`, and the `qurt_exit()` / `htp_iface_stop+0x12E8` cDSP block. [q51 `SESSION_LOG.md`](../scratchpad/agents/q51-f2b-v73-guard/SESSION_LOG.md) [q51 raw logcat](../results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/logcat_threadtime.txt)

## Signature 3: v73 write-side `dspqueue_write 0x1` during trunk-only PPL

### Trigger and observed failure

The workload is `LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf`, `3,580,407,296` bytes, SHA-256 `38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a`. The trunk is Q8_0 (`67` Q8_0 tensors); experts remain Q2_K/Q3_K and are byte-identical to the control, so the HTP placement is the Q8_0 trunk rather than the expert weights. q46 produced this variant with the `q8_0` B-prime cook; q46's successful dispatch proof shows attention Q/K/V/O on HTP and zero HTP execute-op lines for expert weights. [q46 `REPORT.md`](../scratchpad/agents/q46-lfm-bprime-smoke/REPORT.md) [q46 `SESSION_LOG.md`](../scratchpad/agents/q46-lfm-bprime-smoke/SESSION_LOG.md)

The failing command is recorded verbatim in `raw/lane1_lfm_htp_ppl.json`:

```text
./llama-perplexity \
  -m /data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf \
  -f /data/local/tmp/wiki.test.raw \
  -c 2048 -b 2048 -ub 1024 -t 8 -ngl 99 \
  --chunks 32 --ppl-stride 0 -fa on --load-mode none -dev HTP0
```

The corpus is `wiki.test.raw`, `1,290,590` bytes, SHA-256 `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08`. The run computed chunks `[1] 34.2815` and `[2] 35.8966`, then aborted with:

```text
ggml-hexagon.cpp:1624: ggml-hex: HTP0 dspqueue_write failed: 0x00000001
```

The host backtrace is:

```text
ggml_abort
ggml_hexagon_session::flush_batch
ggml_backend_sched_graph_compute_async
llama_context::graph_compute
llama_context::process_ubatch
llama_context::decode
llama_perplexity
```

The measured arm exited `rc=134` with no final PPL estimate. The companion verbose HTP probe recorded `1667` execute-op lines, including the Q8_0 attention matmuls, establishing that this lane really dispatched to HTP before the PPL failure. [q53 `manifest.json`](../scratchpad/agents/q53-v73-npu-correctness/manifest.json) [q53 raw PPL log](../scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_ppl.log) [q53 raw probe log](../scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_probe.log)

### What this isolates

- This is a **write-side** queue failure. Signatures 1 and 2 are `dspqueue_read` failures after the host waits for a response; Signature 3 aborts in `dspqueue_write` at `flush_batch`. [q53 `REVIEW_DOC.md`](../scratchpad/agents/q53-v73-npu-correctness/REVIEW_DOC.md)
- It is not a basic inability to dispatch the Q8_0 trunk: the same model and build completed llama-bench pp512 on v73 with HTP attention dispatch. [q46 `REPORT.md`](../scratchpad/agents/q46-lfm-bprime-smoke/REPORT.md)
- The artifacts do not decode `0x00000001` to a more specific DSPQUEUE or firmware cause. They establish the call site and that the failure occurred while submitting a batch from `flush_batch`.
- The observed PPL setup is `batch=2048`, `ubatch=1024`, `context=2048`, `32` chunks. Two chunks completed before the failure, so “general sustained-load failure” is not proven: content at the failing chunk, accumulated state, and duration are not separated by this run. [q53 `REVIEW_DOC.md`](../scratchpad/agents/q53-v73-npu-correctness/REVIEW_DOC.md)

### Minimal reproduction supported by the artifacts

1. Use the exact LFM GGUF and corpus hashes above. The LFM GGUF is required for this exact trigger; it was produced by the q46 B-prime cook with a Q8_0 trunk while preserving the Q2_K/Q3_K experts. [q46 `SESSION_LOG.md`](../scratchpad/agents/q46-lfm-bprime-smoke/SESSION_LOG.md)
2. Use the pinned v73 `llama-perplexity` host build and v73 skel. The q53 build used the same commit and Android flags listed in the environment table. [q53 `RUN_LOG.md`](../scratchpad/agents/q53-v73-npu-correctness/RUN_LOG.md)
3. Set `NDEV=1` with `HOSTBUF` unset and run the command recorded above on HTP0.
4. Expected result on the recorded S23 setup is a write-side `HTP0 dspqueue_write failed: 0x00000001` from `ggml-hexagon.cpp:1624` after the first two chunk values, followed by `ggml_abort`. Reproduction at a different chunk or corpus offset is not established by the artifacts.

## Cross-cutting observations

- **Dense/hybrid v73 is not uniformly broken.** The Qwen3.5-4B-Q4_0 v73 run completed with HTP execute-op proof; the q50 comparison records a maximum of `50` ops per batch, no ARGSORT, and a different hybrid GDN/SSM op family. This is a liveness counterexample, not a correctness certification. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md) [q53 `RUN_LOG.md`](../scratchpad/agents/q53-v73-npu-correctness/RUN_LOG.md)
- **MoE expert graphs are the failing family in the observed v73 tests.** The all-Q4_0 OLMoE graph dispatches expert `MUL_MAT_ID` and dies with Signature 1; forcing HVX does not save it; removing binary ops produces Signature 2. The failure is therefore not reducible to one HMX expert kernel or to `op_binary` alone. [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md) [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md)
- **Trunk-only also has a separate v73 failure under the recorded PPL shape.** The LFM Q8_0 trunk dispatches on v73 in q46, but q53 fails while submitting the `batch=2048`, `ubatch=1024` PPL graph. [q46 `REPORT.md`](../scratchpad/agents/q46-lfm-bprime-smoke/REPORT.md) [q53 `manifest.json`](../scratchpad/agents/q53-v73-npu-correctness/manifest.json)
- **Related host robustness issue:** the source used for the q35 finding logs non-OK DSP responses and then reaches `// TODO: handle errors` at `ggml-hexagon.cpp` approximately lines `1591–1594`. That status-swallowing path is separate from the three crashes, but it can turn a DSP rejection into an apparently usable, uninitialized/untouched result. [q35 source snapshot `ggml-hexagon.cpp`](../scratchpad/agents/consult-qwen-nan-mali/src/ggml-hexagon.cpp) [ALIVE.md row 9](ALIVE.md)

## v75 counter-evidence

The v75 discriminator used the same OLMoE GGUF and the same `3f545be` host revision. The v75 run used `libggml-htp-v75.so` and `HOSTBUF=1 --no-host 1`; it completed all HTP cells with `rc=0`, logged `0` `dspqueue`, `INTERNAL-ERROR`, HMX-error, `Aborted`, or `ggml_abort` lines, and executed `432` expert `MUL_MAT_ID` operations. Its pp512 results were `687.40` and `684.99` t/s; the corresponding CPU runs were `142.92` and `141.48` t/s. These are exploratory, unplugged, single-device liveness observations only — not performance claims and not evidence of numerical correctness on v75 (no HTP-vs-CPU correctness gate has been run on v75). [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)

For the q50 graph comparison specifically, v73 and v75 both queued the same first `407`-op / `252`-tensor / `6`-buffer packet; v73 produced no response pop before the cDSP death, while v75 popped the packet and continued. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md)

## Discrepancies and qualifications

1. **q53 “sustained load” wording:** q53's report describes a third death under batch-2048 load, but the hostile review records that chunks `1` and `2` completed and that content dependence, accumulated state, and duration were not separated. This report therefore calls it a failure of the recorded PPL workload, not a universal sustained-load threshold. [q53 `REPORT.md`](../scratchpad/agents/q53-v73-npu-correctness/REPORT.md) [q53 `REVIEW_DOC.md`](../scratchpad/agents/q53-v73-npu-correctness/REVIEW_DOC.md)
2. **q53 HTP proof location:** the failing PPL invocation was not verbose, so its own log has no execute-op lines. The `1667` lines are from the companion verbose probe; the PPL log separately shows HTP session initialization and the HTP-only `dspqueue_write` path. The companion probe is sufficient to establish the lane's HTP dispatch, but it is not the same process invocation. [q53 `REVIEW_DOC.md`](../scratchpad/agents/q53-v73-npu-correctness/REVIEW_DOC.md) [q53 `manifest.json`](../scratchpad/agents/q53-v73-npu-correctness/manifest.json)
3. **Same host error, different causes:** q50 and q51 both surface `dspqueue_read 0x2e`, but q50 has cDSP `TLBMISS RW`, `Bad VA 0x0`, `op_binary+0x5B9C`, whereas q51 has cDSP `qurt_exit()` `0x108` in `fastrpc_shell_unsigned_3` / `htp_iface_stop+0x12E8`. They must not be deduplicated as one crash. [q50 `logcat_hits.txt`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_hits.txt) [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md)
4. **Hostbuf confound:** the first v73/v75 comparison differed in `HOSTBUF` and `--no-host`, but the S23 rerun with `HOSTBUF=1 --no-host 1` still died with the same Signature 1 error, while v75 survived with those flags. The remaining observed discriminator is v73 versus v75 and/or the two physical devices; the artifacts do not isolate firmware from hardware generation. [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)
5. **Line number shift:** the unguarded host abort is at `ggml-hexagon.cpp:1583`; q51's extra host code shifts the same read abort to `1584`. The line-number difference is a patch-layout effect, not evidence of a fourth mechanism. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md) [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md)

## What this report is not claiming

- No numerical-correctness claim is made for v75. The v75 result is liveness and dispatch evidence; q48 explicitly says the HMX-at-`n=16` result is not a correctness proof. [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)
- This is one S23 v73 device and one Xiaomi 14 v75 device, not a population-level claim about every v73 or v75 implementation.
- The reported t/s values are exploratory and are not product benchmarks. [q46 `REPORT.md`](../scratchpad/agents/q46-lfm-bprime-smoke/REPORT.md) [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)
- No single source-level fix is claimed. Signature 1 has a strong `op_binary` NULL-dereference diagnosis; Signature 2 has no named op handler; Signature 3 has an identified host write-side abort but no decoded DSPQUEUE/firmware root cause.
- The report does not claim that Qwen3.5-4B v73 is numerically correct, only that the cited run completed and dispatched HTP operations.

## Attachments

The owner can attach the following repository artifacts directly:

- Signature 1: `scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_repro.txt`, `scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_hits.txt`, `results/htp_probe/s23_v73_olmoe_q40/crash_context.txt`, `results/htp_probe/s23_v73_olmoe_q40/tombstone_08.txt`, `results/htp_probe/s23_v73_olmoe_q40/device/kalsa_q48/a_stderr.txt`, and `results/htp_probe/s23_v73_olmoe_q40/device/kalsa_q48/a_execute_op_exps_htp0.txt`.
- Signature 2: `results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/cdsp_crash_block.txt`, `results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/logcat_threadtime.txt`, `results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/tombstone_17.txt`, `results/htp_probe/s23_v73_olmoe_q40/f2b/a_stderr.txt`, `scratchpad/agents/q51-f2b-v73-guard/PATCH.diff`, and `scratchpad/agents/q51-f2b-v73-guard/REPORT.md`.
- Signature 3: `scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_ppl.log`, `scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_ppl.json`, `scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_probe.log`, `scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_probe.json`, `scratchpad/agents/q53-v73-npu-correctness/manifest.json`, and `scratchpad/agents/q53-v73-npu-correctness/RUN_LOG.md`.
- v75 comparison: `results/htp_probe/xiaomi_v75_olmoe_q40/kalsa_q48_x/a_stderr.txt`, `results/htp_probe/xiaomi_v75_olmoe_q40/kalsa_q48_x/a_execute_op_mul_mat_id.txt`, `results/htp_probe/xiaomi_v75_olmoe_q40/kalsa_q48_x/b_r1_stderr.txt`, `results/htp_probe/xiaomi_v75_olmoe_q40/kalsa_q48_x/b_r2_stderr.txt`, and `results/htp_probe/xiaomi_v75_olmoe_q40/MANIFEST.md`.

