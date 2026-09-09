# llama.cpp Hexagon backend: three independent v73 DSP-skel crash mechanisms

## Summary

On a Samsung Galaxy S23 / Snapdragon 8 Gen 2 using the Hexagon v73 skel, the artifacts show three distinct failure mechanisms: a cDSP user-PD NULL dereference in `op_binary` that surfaces on the host as `dspqueue_read` `0x2e`; a separate cDSP `qurt_exit()` path in `htp_iface_stop` that remains after all binary operations are removed from HTP; and a write-side `dspqueue_write` `0x1` abort in `flush_batch` for a trunk-only perplexity workload. The Xiaomi 14 / Snapdragon 8 Gen 3 v75 comparison runs the same OLMoE model and host revision, including the same 407-op MoE packet, to completion. These observations establish a v73/v75 liveness difference for the tested packets; they do not establish numerical correctness on v75. [q50 `DIAGNOSIS.md`](../scratchpad/agents/q50-v73-dspqueue-diagnosis/DIAGNOSIS.md) [q51 `REPORT.md`](../scratchpad/agents/q51-f2b-v73-guard/REPORT.md) [q53 `REPORT.md`](../scratchpad/agents/q53-v73-npu-correctness/REPORT.md) [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)

Cell #59 reproduced the HDK Signature 1 host proof: both arms reported `n_htp=484 n_mul_mat_id=48 n_exps_htp0=48 exit=134`. Cell #60 resolves that HDK cDSP abort to `mmap_buf()` at `main.c:729`; partial offload survives, while `VMEM=0` reports 3.00 GiB before model load fails. Cell #62 now shows pure upstream master also reaches the S23-style compute-time TLBMISS on the same HDK, including `-ngl 8`, while the separating change and any shared root with the HDK mapping abort remain unestablished. [#59 no-HOSTBUF proof](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/exp_pp16_nohostbuf_sa802553.out) [#59 HOSTBUF proof](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/exp_pp16_hostbuf1_sa802553.out) [#60 B6 raw](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_vmem0_sa802961.err) [#62 U1 raw](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/logcat_up_ngl8_sa803054.txt) [S23 raw](../scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_repro.txt)

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

Cell #60 does not bear on this signature: it exercised the mapping-budget arms, not the qurt-exit F2b configuration.

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
ggml-hexagon.cpp:1590: ggml-hex: HTP0 dspqueue_write failed: 0x00000001
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
4. Expected result on the recorded S23 setup is a write-side `HTP0 dspqueue_write failed: 0x00000001` from `/Users/marco/Projects/kalsallama/ggml/src/ggml-hexagon/ggml-hexagon.cpp:1588`: `int err = dspqueue_write(this->queue, 0, 1, &dbuf, sizeof(req), (const uint8_t*) &req, DSPQUEUE_TIMEOUT);`; `:1590`: `GGML_ABORT("ggml-hex: %s dspqueue_write failed: 0x%08x\n", this->c_name(), (unsigned) err);` after the first two chunk values, followed by `ggml_abort`. Reproduction at a different chunk or corpus offset is not established by the artifacts.

Cell #60 does not bear on Signature 3: it used the OLMoE mapping-budget workload, not the separate trunk-only PPL workload.

## Signature 1 root cause (reference hardware, 2026-09-03/04)

Cell #59 replicated the S23 death on a Qualcomm Device Cloud HDK8550 (Snapdragon 8 Gen 2, HTP v73, Android 16). A1 had HOSTBUF unset; A2 used `GGML_HEXAGON_HOSTBUF=1 --no-host 1`. Both produced the identical `484/48/48` proof and exit 134, with the newer `kalsa/npu-judge-v79` build, public allenai Q4_0 model `361e8d83…`, and `--mmap 0`. This excludes the S23 unit, its thermal history, and HOSTBUF as necessary causes, but not a v73-shared ROM/firmware component. [#59 A1](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/exp_pp16_nohostbuf_sa802553.out) [#59 A2](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/exp_pp16_hostbuf1_sa802553.out) [#59 crash log](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/logcat_exp_pp16_nohostbuf_sa802553.txt) [#59 thermal records](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/therm_pre_exp_pp16_nohostbuf_sa802553.txt)

The #59 cDSP crash block is:

```text
CDSP0: Process "/frpc/f04342f0 llama-bench" crashed in thread "" because Application called qurt_exit()
CDSP0: Crashed Shared Object "fastrpc_shell_unsigned_3" load address : 0x00D00000
CDSP0: Error code :    0x108
CDSP0: [<00D8AC80>] abort+0x8:     (fastrpc_shell_unsigned_3)
CDSP0: [<20203E58>] htp_iface_start+0x1348:     (./libggml-htp-v73.so)
```

[Raw #59 crash block](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/logcat_exp_pp16_nohostbuf_sa802553.txt). The static objdump resolution in #60 places the return address in the cold `mmap_buf()` tail:

```text
3e30: r1 = add(pc,##0x9f474)      ; -> 0xA32A8 ~ "/workspace/ggml/src/ggml-hexagon/htp/main.c" (strings -t x: a32a4)
3e3c: r3 = add(pc,##0x9f5de)      ; -> 0xA341E ~ "mmap failed : va %p fd %u size %u"           (strings -t x: a341a)
3e44: r2 = #0x2d9                 ; = 729 = __LINE__
3e48: memw(r29+#0x8) = r4         ; size
3e4c: call HAP_debug_v2@plt       ; FARF(ERROR, ...)
3e50: memw(r29+#0x0) = #-0x1      ; va = (void*)-1
3e54: call abort@plt              ; <- crash site, return addr 0x3e58
```

[Objdump chain](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/DISASM.md) [raw #59 `htp_iface_start+0x1348`](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/logcat_exp_pp16_nohostbuf_sa802553.txt)

The source matches that resolution. `/Users/marco/Projects/kalsallama/ggml/src/ggml-hexagon/htp/main.c:711`: `static inline void mmap_buf(struct htp_context *ctx, struct htp_buf_desc *b) {`; `:718`: `#if __HVX_ARCH__ > 73`; `:719`: `void *va = HAP_mmap2(NULL, b->size, HAP_PROT_READ | HAP_PROT_WRITE, 0, b->fd, 0);`; `:720`: `#else`; `:726`: `void *va = HAP_mmap(NULL, b->size, HAP_PROT_READ | HAP_PROT_WRITE, 0, b->fd, 0);`; `:729`: `FARF(ERROR, "mmap failed : va %p fd %u size %u", va, b->fd, (uint32_t) b->size);`; `:730`: `abort(); // can't do much else at this point`. Thus v73 selects `HAP_mmap`, receives `-1`, logs the failed VA, and aborts; the FARF `HAP_mmap2 failed` wording below is not evidence that `HAP_mmap` internally calls `HAP_mmap2`. [DISASM.md](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/DISASM.md) [raw B5](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/logcat_ngl99_vmem1800_sa802961.txt)

The same raw B5 trace gives the FARF-to-logcat chain verbatim:

```text
CDSP0: qurt_vtlb_mmap:  unable to get virtual address, size 29a01000
CDSP0: Error 0x80000483: fastrpc_mmap failed pa 0x31cc00000 size 0x29a01000 mode 7 perm 11
CDSP0: Error 0x8000054d: HAP_mmap2 failed for fd 27 of length 698355712 bytes, flags 0x0, prot 0x3, offset 0x0
CDSP0: mmap failed : va FFFFFFFF fd 27 size 698355712
```
### Same host symptom, two DSP-side manifestations

The shared host symptom is `dspqueue_read 0x2e`, but the DSP records differ: S23 Signature 1 is `TLBMISS RW` in `op_binary+0x5B9C`, thread `htp-main`; HDK #59/#60 is `qurt_exit()`/`abort()` at `htp_iface_start+0x1348`, with thread `""`. [S23 raw](../scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_repro.txt) [HDK #59 raw](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/logcat_exp_pp16_nohostbuf_sa802553.txt)
The 3f545bec skel already contained `mmap_buf()` with the same `HAP_mmap` + `abort()` path. Exact relevant lines from `3f545bec:ggml/src/ggml-hexagon/htp/main.c` are `for (uint32_t i=0; i < HTP_MAX_MMAPS; i++) {` (:837), `void *va = HAP_mmap(NULL, b->size, HAP_PROT_READ | HAP_PROT_WRITE, 0, b->fd, 0);` (:848), `if (va == (void*)-1) {` (:850), `FARF(ERROR, "mmap failed : va %p fd %u size %u", va, b->fd, (uint32_t) b->size);` / `abort(); // can't do much else at this point` (:851-852), and `return;` followed by the closing braces (:860-863).
These are `3f545bec:ggml/src/ggml-hexagon/htp/main.c:837,848,850-853,860-863`. When all 16 `HTP_MAX_MMAPS` slots are occupied, the mapping loop returns silently, leaving `b->base` = 0 so a consuming op can fault (TLBMISS): a plausible but UNPROVEN reading of the S23 signature. Explicitly: whether the S23 TLBMISS and the HDK abort share the VA-exhaustion root is not established; both are mapping-failure manifestations in the same function family.
The host sees the canceled queue wait, then aborts: `/Users/marco/Projects/kalsallama/ggml/src/ggml-hexagon/ggml-hexagon.cpp:1545`: `int err = dspqueue_read(this->queue, &flags, 1, &n_dbufs, &dbuf, sizeof(rsp), &rsp_size, (uint8_t *) &rsp, timeo);`; `:1551`: `GGML_ABORT("ggml-hex: dspqueue_read failed: 0x%08x\n", (unsigned) err);`. The runtime message prints source line 1552, the macro's last line. The skel-side VA failure is therefore the proximate cause of the HDK host `0x2e`, not a new host flush mechanism. [B5 raw](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/logcat_ngl99_vmem1800_sa802961.txt)
### Signature 1 reproduced with pure upstream master on reference hardware (2026-09-04)

Cell #62 used upstream/master @64a155d24, containing #26501 and #28202, built with the `docs/backend/snapdragon` presets in the Snapdragon toolchain Docker image for android-34; no kalsa code was used, and those changes could not be cherry-picked onto the kalsa tree. [BUILD.md:1-4,8-9,15-32](../scratchpad/agents/qdc-npu-mmapfix-kit/BUILD.md) [PREREG.md:6-12](../scratchpad/agents/qdc-8g2-npu-upstream-62/PREREG.md) [MODEL_SHA.txt:4,6](../scratchpad/agents/qdc-8g2-npu-upstream-62/MODEL_SHA.txt)
The board was HDK8550 (Snapdragon 8 Gen 2, v73, Android 16) on Qualcomm Device Cloud, with the public `allenai/OLMoE-1B-7B-0924-Instruct-GGUF` Q4_0 model, SHA-256 `361e8d83…`. [REPORT.md:3-7](../scratchpad/agents/qdc-8g2-npu-upstream-62/REPORT.md)
The commands were PREREG #62 template T plus `-ngl 8` or `-ngl 99` (PREREG.md:25-34), reproduced verbatim in recipe B below.
All four arms died with exit 134 and the same TLBMISS class, including U1 `-ngl 8`: U0 `-ngl 99`, U2 `-ngl 99`/`MBUF=512`, U5 `-ngl 99`/`VMEM=1800`, and U1 `-ngl 8`. [REPORT.md:13-18](../scratchpad/agents/qdc-8g2-npu-upstream-62/REPORT.md) [U0](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/up_ngl99_sa803054.out) [U2](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/up_ngl99_mbuf512_sa803054.out) [U5](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/up_ngl99_vmem1800_sa803054.out) [U1](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/up_ngl8_sa803054.out)
The U1 cDSP block is:
```text
CDSP0: Process "/frpc/f0432fe0 llama-bench" crashed in thread "work-queue:2" due to TLBMISS RW occurrence
CDSP0: Fault PC   :    0x20242B34
CDSP0: Bad VA     :    0x0
CDSP0: Error code :    0x7003
CDSP0: [<20242B34>] op_binary+0x50E4:     (./libggml-htp-v73.so)
```
Thus `op_binary+0x50E4` resolves to the `binary_job_vector_same_shape` vector-add loop:
```text
42b0c: 5a d8 20 5c 5c20d85a    if (!p0.new) jump:t 0x42bb8 <binary_job_vector_same_shape+0xa78> }
42b2c: 10 40 0d 60 600d4010 {  loop0(0x42b34,r13)
42b34: 14 c1 09 29 2909c114 {  v20 = vmem(r9++#0x1) }
42b38: 36 74 b5 1f 1fb57436 {  v22.qf32 = vadd(v20.sf,v21.sf)
```
[U1 CDSP raw](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/logcat_up_ngl8_sa803054.txt) [PC resolution](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/crash_pc_resolution.txt)
Host-side, the raw error is `/workspace/ggml/src/ggml-hexagon/ggml-hexagon.cpp:2734: ggml-hex: dspqueue_read failed: 0x0000002e`. No `mmap failed` or `defragmentation` FARF line was observed in any of the four raw logcats, so mapping failure was not the observed upstream-kit path. [up_ngl8 err](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/up_ngl8_sa803054.err) [REPORT.md:20-27](../scratchpad/agents/qdc-8g2-npu-upstream-62/REPORT.md) [U0 logcat](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/logcat_up_ngl99_sa803054.txt) [U2 logcat](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/logcat_up_ngl99_mbuf512_sa803054.txt) [U5 logcat](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/logcat_up_ngl99_vmem1800_sa803054.txt) [U1 logcat](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/logcat_up_ngl8_sa803054.txt)
The last two strided-view ADDs queued by the host were:
```text
ggml-hex: HTP0 execute-op ADD|node_928 x ffn_moe_weighted-15 (view) -> ffn_moe_out-15|2048:1 x 2048:1 -> 2048:1|f32 x f32 -> f32|4:8192 x 4:65536 -> 4:8192|HTP0 x HTP0 -> HTP0|----|flags 0x0
ggml-hex: HTP0 execute-op ADD|ffn_moe_out-15 x ffn_inp-15 -> l_out-15|2048:1 x 2048:1 -> 2048:1|f32 x f32 -> f32|4:8192 x 4:8192 -> 4:8192|HTP0 x HTP0 -> HTP0|----|flags 0x0
```
The queue is asynchronous, so these lines do not prove which operation faulted; the strided view in the first ADD is only a suspect. [up_ngl8 err](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/up_ngl8_sa803054.err)
The `Bad VA : 0x0` and `Error code : 0x7003` values are identical to q50's S23 block, while the offset and thread differ on this different skel: `op_binary+0x50E4` and `work-queue:N`/`htp-main` here versus `op_binary+0x5B9C` and `htp-main` on q50. [#62 raw](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/logcat_up_ngl8_sa803054.txt) [q50 raw](../scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_repro.txt) [REPORT.md:42-46](../scratchpad/agents/qdc-8g2-npu-upstream-62/REPORT.md)
Our `022458a28` + kalsa kit did not exhibit this TLBMISS in #59/#60: those arms died only in mapping or survived at `-ngl 8/12`; the separating change is not established. [REPORT.md:47-49](../scratchpad/agents/qdc-8g2-npu-upstream-62/REPORT.md) [#59 raw](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/logcat_exp_pp16_nohostbuf_sa802553.txt) [#60 B1](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl8_mbuf1g_sa802961.out) [#60 B2](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_mbuf512_sa802961.out) [#60 B3](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl12_mbuf1g_sa802961.out) [#60 B5](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_vmem1800_sa802961.out)
Candidate explanations remain hedged and unseparated: the kalsa HMX-eligibility gate, `HTP_ZERO_TILE_PAD`, upstream changes after #25968 including #26501 work-queue changes, or the android-34/build difference; none was bisected or tested as the separator. [REPORT.md:42-52,69-74](../scratchpad/agents/qdc-8g2-npu-upstream-62/REPORT.md) [BUILD.md:28-40](../scratchpad/agents/qdc-npu-mmapfix-kit/BUILD.md)

Cell #60's six-arm result is:

| arm | result |
|---|---|
| B1 `-ngl 8`, MBUF 1 GiB | 1575 MiB, 8 host buffers; proof `189`, exit `0` [err](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl8_mbuf1g_sa802961.err) [out](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl8_mbuf1g_sa802961.out) |
| B2 `-ngl 99`, MBUF 512 MiB | 3600 MiB, 12 host buffers, max map 459 MiB; proof `48`, exit `134`, `:729` [err](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_mbuf512_sa802961.err) [out](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_mbuf512_sa802961.out) |
| B5 `-ngl 99`, VMEM 1800 MiB | 3600 MiB, 8 host buffers; proof `48`, exit `134`, `:729` [err](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_vmem1800_sa802961.err) [out](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_vmem1800_sa802961.out) |
| B6 `-ngl 99`, VMEM 0 | measured max vmem `3221225472` = 3.00 GiB; proof `0`, exit `1`; subsequent model mapping fails [err](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_vmem0_sa802961.err) [out](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_vmem0_sa802961.out) |
| B3 `-ngl 12`, MBUF 1 GiB | 2475 MiB, 9 host buffers; proof `297`, exit `0` [err](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl12_mbuf1g_sa802961.err) [out](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl12_mbuf1g_sa802961.out) |
| B4 `-ngl 8 -p 0 -n 128` | 1575 MiB; proof `2688`, exit `0`; 128-token decode survives [err](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl8_tg128_sa802961.err) [out](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl8_tg128_sa802961.out) |

The B2 failure had approximately 501 MiB live at the failed 462426112-byte map; the B5 failure had approximately 1033 MiB live at the failed 698355712-byte map. These are the double-audited file-order reconstructions after the evictions, not cumulative allocation totals. [B2 map trace](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/logcat_ngl99_mbuf512_sa802961.txt) [B5 map trace](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/logcat_ngl99_vmem1800_sa802961.txt)

The cell does not discriminate among (1) fragmentation leaving no suitable hole, (2) QuRT TLB/alignment constraints on the requested range, and (3) VA that is not or is only lazily reclaimed after `fd_mmap_destroy`. The evidence excludes HOSTBUF, the S23 unit and its thermal history, and a hard 2 GiB PD cap on this HDK: B3 survives with 2475 MiB of HTP-repacked weights and B6 measures 3.00 GiB before its post-probe model load fails. [B3 raw](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl12_mbuf1g_sa802961.err) [B6 raw](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_vmem0_sa802961.err) [#59 thermal raw](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/therm_post_exp_pp16_nohostbuf_sa802553.txt)

`prep_op_bufs()` is the relevant eviction gate: `/Users/marco/Projects/kalsallama/ggml/src/ggml-hexagon/htp/main.c:743`: `static void prep_op_bufs(struct htp_context *ctx, struct htp_buf_desc *bufs, uint32_t n_bufs) {`; `:765`: `if ((m_vmem + e_vmem) > ctx->max_vmem) {`; `:769`: `if (!used) { drop_mmap(ctx, ctx->mmap + i); }`; `:776`: `mmap_buf(ctx, b);`. The host default is `/Users/marco/Projects/kalsallama/ggml/src/ggml-hexagon/ggml-hexagon.cpp:4373`: `opt_vmem = opt_arch >= 75 ? HTP_OP_MAX_VMEM_DEFAULT : 3000 * MiB;`. Measurement is `/Users/marco/Projects/kalsallama/ggml/src/ggml-hexagon/ggml-hexagon.cpp:1608`: `static size_t ggml_hexagon_measure_max_vmem(ggml_hexagon_session *sess) {`; `:1609`: `// Allocate a bunch pinned buffers till failure.`; `:1632`: `for (auto b : sbufs) { delete b; }`; `:1634`: `return vmem - step;`. The B6 result shows that this measurement can leave the subsequent model load broken on this v73 build; measurement should be non-destructive. [B6 raw](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_vmem0_sa802961.err)

### Minimal public reproduction

#### A. Our kalsa kit — mapping abort :729

Board: HDK8550 on Qualcomm Device Cloud. Model: `allenai/OLMoE-1B-7B-0924-Instruct-GGUF`, Q4_0, SHA-256 `361e8d83f0820e50d0ed1a13b10586ed9f476d99dcaf6aafd14f07e11840b22b`. Build: kalsallama branch `kalsa/npu-judge-v79` at `022458a28`, carrying upstream through `#25968`; fork: `Aspis0/kalsallama`. [#59 preregistration](../scratchpad/agents/qdc-8g2-npu-v73death-59/PREREG.md) [#59 verified kit](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/kit_verify_sa802553.txt) [#59 model/run raw](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/exp_pp16_nohostbuf_sa802553.out)

```sh
./bin/llama-bench -m olmoe.gguf -p 16 -n 8 -r 1 --no-warmup -dev HTP0 -v -o jsonl --mmap 0 -fa on --ubatch-size 1024 -ngl 99
```

For either recipe, place the runtime FARF file in the directory named by `ADSP_LIBRARY_PATH`, then capture the `adsprpc` tag:

```sh
echo 0x1F > <ADSP_LIBRARY_PATH>/llama-bench.farf
adb logcat -s adsprpc
```

Expected A lines are the #59 proof and the mapping-abort crash, with the recorded #60 B5 FARF detail when emitted; fd/size values may vary with mapping order:

```text
proof n_htp=484 n_mul_mat_id=48 n_exps_htp0=48 exit=134
CDSP0: qurt_vtlb_mmap:  unable to get virtual address, size 29a01000
CDSP0: Error 0x80000483: fastrpc_mmap failed pa 0x31cc00000 size 0x29a01000 mode 7 perm 11
CDSP0: Error 0x8000054d: HAP_mmap2 failed for fd 27 of length 698355712 bytes, flags 0x0, prot 0x3, offset 0x0
CDSP0: mmap failed : va FFFFFFFF fd 27 size 698355712
CDSP0: [<20203E58>] htp_iface_start+0x1348:     (./libggml-htp-v73.so)
```

[Recorded proof](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/exp_pp16_nohostbuf_sa802553.out) [recorded FARF](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/logcat_ngl99_vmem1800_sa802961.txt)

#### B. Pure upstream master — Signature 1 TLBMISS at every tested `-ngl`

Use the same board/model, but build pure upstream/master @64a155d24 with the Snapdragon toolchain Docker/android-34 preset and no kalsa code (`BUILD.md:1-4,15-32`; `MODEL_SHA.txt:4,6`). This is the recipe an upstream maintainer can run with zero third-party code.

```sh
./bin/llama-bench -m olmoe.gguf -p 16 -n 8 -r 1 --no-warmup -dev HTP0 -v -o jsonl --mmap 0 -fa on --ubatch-size 1024 -ngl 8
./bin/llama-bench -m olmoe.gguf -p 16 -n 8 -r 1 --no-warmup -dev HTP0 -v -o jsonl --mmap 0 -fa on --ubatch-size 1024 -ngl 99
```
Expected B result is the compute-time TLBMISS block quoted above at both `-ngl 8` and `-ngl 99`, with no `mmap failed` or `defragmentation` FARF line; the exact four-arm evidence is above. [#62 U1 logcat](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/logcat_up_ngl8_sa803054.txt) [#62 U1 err](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/up_ngl8_sa803054.err)

### Relation to upstream

All claims in this subsection are as reported by web search on 2026-09-04, not re-verified. [UPSTREAM-SEARCH.md](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/UPSTREAM-SEARCH.md)

- `ggml-org/llama.cpp #26123` (open) reports “Full or partial Hexagon offload works correctly for a 1B model but crashes with `dspqueue_read failed: 0x0000002e`” for 8 Gen 2/v73, including a 7B dense and 4B hybrid; #22208 (closed/not planned) reports v73 Snapdragon X Elite `0x2e` or `0x72` at load; #18192 (closed) reports shape-specific v73 `0x2e`. These are the same signature class, without a root cause in the search notes. [UPSTREAM-SEARCH.md](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/UPSTREAM-SEARCH.md)
- #21071 (merged) is reported as the `__HVX_ARCH__ > 73` split using HAP_mmap2 and says “check to prevent mapping more than 2GB with HAP_mmap (which is unsupported)”. #22487 (merged) adds `GGML_HEXAGON_VMEM` / `GGML_HEXAGON_MBUF`, with default vmem “around 3.2GB” and a 1GB buffer. [UPSTREAM-SEARCH.md](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/UPSTREAM-SEARCH.md)
- #26501 (merged) is reported as a multi-NPU overhaul touching `main.c` mmap; #28202 (merged) is titled “Op batch buffers are now sorted by size to avoid address space fragmentation”. Both are after our pin, neither was tested by us, and neither is in our fork. [UPSTREAM-SEARCH.md](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/UPSTREAM-SEARCH.md)
- Qualcomm fastrpc #137 (closed/not planned) is reported as “Q6 cDSP only have 32-bit virtual address space, limited number of shared buffers can be mapped”; its maintainer is quoted as “limited to 2GB on older devices and has been increased to 3GB on newer devices (8gen3)”. [UPSTREAM-SEARCH.md](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/UPSTREAM-SEARCH.md)

Cell #62 adds direct local evidence that upstream/master itself crashes on a public HDK8550 with the public model; this report remains a draft for the owner and no issue has been filed. [#62 U1 raw](../scratchpad/agents/qdc-8g2-npu-upstream-62/raw/logcat_up_ngl8_sa803054.txt) [BUILD.md:1-4](../scratchpad/agents/qdc-npu-mmapfix-kit/BUILD.md)

### Suggested upstream action

Draft suggestion for the owner: (1) on v73, `mmap_buf()` should not `abort()` on `HAP_mmap` failure; it should return an error to the host so the op can fall back to CPU (`main.c:729-730`, `ggml-hexagon.cpp:1545`/`:1551`; the runtime prints `:1552`); (2) the host's 3000 MiB v73 default (`ggml-hexagon.cpp:4373`) should be measured or lowered, with measurement made non-destructive (`ggml-hexagon.cpp:1608-1634`); and (3) evaluate #28202's size-sorted batching on v73. This remains a local draft for the owner; no issue has been filed.

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

### Follow-up observations after the initial draft (2026-08-25, qualified)

- Signature 3 reproduces at `-b 512 -ub 512` on the same model/build: the
  identical `dspqueue_write failed: 0x00000001` abort in `flush_batch`, after
  9/32 perplexity chunks (vs 2/32 at `-b 2048 -ub 1024`). The failure is
  therefore not bound to the large batch size; longer survival at the smaller
  batch is consistent with, but does not prove, accumulated DSP/queue state
  (n=1 per configuration). Raw: `scratchpad/agents/q53b-v73-batch-discriminator/raw/`.
- Device-health observation, reported without causal claim: during a
  sustained `llama-perplexity` run of a dense/hybrid model placed entirely on
  HTP0 on the v73 device (Qwen3.5-4B Q4_0, `-b 2048 -ub 1024`), the device
  dropped off adb twice (after 8/32 and 4/32 chunks; ICMP still answered at
  the second drop) and was subsequently found very hot, powered off and not
  booting. Our harness captured battery temperature only before/after each
  arm, so no in-run thermal trace exists. We flag this so maintainers testing
  v73 with long HTP workloads use an in-run thermal guard.
- Update: the device-side log of that run, recovered after the device came
  back, shows the perplexity run itself COMPLETED (32/32 chunks, final
  estimate 8.5179 ± 0.12523, 55,730 HTP execute-op lines, log mtime
  04:14:45Z, 28 min after the adb drop); the boot reason recorded afterwards
  was `shutdown,lpm` (an OS-initiated shutdown, not a kernel panic). A CPU
  reference over the same corpus is still pending; the first chunk agrees
  closely (HTP 7.9075 vs CPU 7.9064 running PPL, +0.014 %). So on this v73
  device the dense/hybrid full-on-HTP graph did not hit signatures 1–3 in a
  32-chunk run; the MoE and trunk-only-under-perplexity graphs did.

## What this report is not claiming

- No numerical-correctness claim is made for v75. The v75 result is liveness and dispatch evidence; q48 explicitly says the HMX-at-`n=16` result is not a correctness proof. [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)
- This is one S23 v73 device and one Xiaomi 14 v75 device, not a population-level claim about every v73 or v75 implementation.
- The reported t/s values are exploratory and are not product benchmarks. [q46 `REPORT.md`](../scratchpad/agents/q46-lfm-bprime-smoke/REPORT.md) [q48 `REPORT.md`](../scratchpad/agents/q48-olmoe-q40-npu/REPORT.md)
- No single source-level fix is claimed. S23 Signature 1 has a strong `op_binary` NULL-dereference diagnosis; the HDK manifestation is the `mmap_buf()` abort at `main.c:729`; whether they share a root is not established. Signature 2 has no named op handler; Signature 3 has an identified host write-side abort but no decoded DSPQUEUE/firmware root cause. [S23 raw](../scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_repro.txt) [HDK raw](../scratchpad/agents/qdc-8g2-npu-v73death-59/raw/logcat_exp_pp16_nohostbuf_sa802553.txt)
- The report does not claim that Qwen3.5-4B v73 is numerically correct, only that the cited run completed and dispatched HTP operations.
- Cell #60 does not identify fragmentation, TLB alignment, or non-reclaimed VA as the unique cause; it excludes HOSTBUF, the S23 unit/thermal history, and a hard 2 GiB PD cap on this HDK. Partial-offload survival remains neither a performance nor a correctness claim. [B3 raw](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl12_mbuf1g_sa802961.out) [B6 raw](../scratchpad/agents/qdc-8g2-npu-mmapbudget-60/raw/ngl99_vmem0_sa802961.err)

## Attachments

The owner can attach the following repository artifacts directly:

- Signature 1: `scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_repro.txt`, `scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_hits.txt`, `results/htp_probe/s23_v73_olmoe_q40/crash_context.txt`, `results/htp_probe/s23_v73_olmoe_q40/tombstone_08.txt`, `results/htp_probe/s23_v73_olmoe_q40/device/kalsa_q48/a_stderr.txt`, and `results/htp_probe/s23_v73_olmoe_q40/device/kalsa_q48/a_execute_op_exps_htp0.txt`.
- Signature 2: `results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/cdsp_crash_block.txt`, `results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/logcat_threadtime.txt`, `results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/tombstone_17.txt`, `results/htp_probe/s23_v73_olmoe_q40/f2b/a_stderr.txt`, `scratchpad/agents/q51-f2b-v73-guard/PATCH.diff`, and `scratchpad/agents/q51-f2b-v73-guard/REPORT.md`.
- Signature 3: `scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_ppl.log`, `scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_ppl.json`, `scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_probe.log`, `scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_probe.json`, `scratchpad/agents/q53-v73-npu-correctness/manifest.json`, and `scratchpad/agents/q53-v73-npu-correctness/RUN_LOG.md`.
- v75 comparison: `results/htp_probe/xiaomi_v75_olmoe_q40/kalsa_q48_x/a_stderr.txt`, `results/htp_probe/xiaomi_v75_olmoe_q40/kalsa_q48_x/a_execute_op_mul_mat_id.txt`, `results/htp_probe/xiaomi_v75_olmoe_q40/kalsa_q48_x/b_r1_stderr.txt`, `results/htp_probe/xiaomi_v75_olmoe_q40/kalsa_q48_x/b_r2_stderr.txt`, and `results/htp_probe/xiaomi_v75_olmoe_q40/MANIFEST.md`.
