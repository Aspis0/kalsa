# q50 — v73 `dspqueue_read 0x2e` diagnosis (OLMoE vs 4B)

REGISTRA+DICHIARA. Desk-first. One read-only-ish device probe (logcat during a single crash repro). No code changes, no git.

Harness binary: llama-bench @3f545be (`stub=5db18906…`). Abort string maps to `ggml-hexagon.cpp:1583` in the @3f545be lineage (`scratchpad/agents/consult-qwen-nan-mali/src/ggml-hexagon.cpp`; BigMoeOnEdge fork is the same `flush_pending` with the abort a few lines earlier at 1550). Hexagon SDK 6.6.0.0 headers at `C:\Qualcomm\Hexagon_SDK\6.6.0.0`.

## 0x2e decoded

**0x0000002e = 46 = `AEE_EINTERRUPTED`.**

`AEEStdErr.h:118-119`:

```
#define AEE_EINTERRUPTED (46)  ///< Waitable call is interrupted,
                               ///< the user should return to the HLOS and retry the call
```

`dspqueue.h:486-487` (`dspqueue_read`):

```
- AEE_EEXPIRED: Request timed out
- AEE_EINTERRUPTED: The request was canceled
```

This is **not** a timeout. Timeout is `AEE_EEXPIRED` (0x00C). Host `flush_pending` already retries `AEE_EEXPIRED` and `AEE_EWOULDBLOCK` and **aborts on everything else**, including 0x2e (`consult-qwen-nan-mali/src/ggml-hexagon.cpp:1577-1583`).

FastRPC host log from the q50 repro (`logcat_hits.txt:45-48`):

```
dspqueue_cpu.c:963::error: 0x2e: (nErr = dspsignal_wait(q->domain, QUEUE_SIGNAL(...), to_now)) == 0
dspqueue_cpu.c:1014: Error 0x2e: wait_signal_locked failed ... signal 2
```

The blocking wait for a **response packet** was canceled because the **cDSP user PD died**.

## Causal event (logcat, one repro)

Battery 76 % unplugged, 26.3 °C. Same HOSTBUF=1 `--no-host 1` pp16/tg8. rc=134.

```
adsprpc: CDSP0: Process "... llama-bench" crashed in thread "htp-main" due to TLBMISS RW occurrence
adsprpc: CDSP0: Crashed Shared Object "./libggml-htp-v73.so"
adsprpc: CDSP0: Bad VA     :    0x0
adsprpc: CDSP0: Error code :    0x7003
adsprpc: CDSP0: [<20049E8C>] op_binary+0x5B9C:     (./libggml-htp-v73.so)
adsprpc: CDSP0: [<200497FC>] op_binary+0x550C:     (./libggml-htp-v73.so)
adsprpc: CDSP0: [<20004D48>] work_queue_run_async+0xD8
adsprpc: CDSP0: [<20044958>] op_binary+0x668
adsprpc: CDSP0: [<20003DD0>] htp_iface_stop+0xB90
```

**NULL dereference (Bad VA 0x0, Hexagon TLB miss 0x7003) inside the v73 skel `op_binary`**, worker thread `htp-main`. Source: `htp/binary-ops.c:857` `op_binary()` — first thing it does is `src1->nb[1]` with no NULL check (`binary-ops.c:860-862`). A NULL `src[1]` or NULL `data` matches VA 0.

Host then sees `AEE_EINTERRUPTED` and `GGML_ABORT`s. stderr never gets a DSP `HTP_STATUS_*` because the PD is gone — there is no `op-queue pop` on v73 OLMoE (confirmed: 0 pop lines in `device/kalsa_q48/a_stderr.txt`). v75 pops the same batches (`xiaomi_v75_olmoe_q40/.../a_stderr.txt:16868` pop batch #0 n-ops 407).

Also: `DmaBufLeakDetector: llama-bench dmabuf_rss=3710092KB` (~3.5 GiB) on this HMX load. Session URI fallback `error 0x14` = `AEE_EUNSUPPORTED` (`AEEStdErr.h:68`) for `remote_session_control` request 15 — same as the 4B v73 smoke (`results/htp_smoke/s23_v73/hwinfo.txt`), not OLMoE-specific.

## Graph-shape numbers

| | OLMoE v73 HMX (dies) | OLMoE v73 HVX MM_SELECT=2 (dies) | OLMoE v75 HMX (lives) | Qwen3.5-4B v73 (lives) |
|---|---|---|---|---|
| source | `s23_v73_olmoe_q40/.../a_stderr.txt` | `hostbuf1/a_hvx_stderr.txt` | `xiaomi_v75_olmoe_q40/.../a_stderr.txt` | `htp_smoke/s23_v73/bench_proof3.err` |
| first batch n-ops / n-tensors / n-bufs | **407 / 252 / 6** | 18 / 31 / 4 | **407 / 252 / 6** (identical) | 24 / 41 / 4 |
| first batch m-size / vmem | 124960 / **3120996864** | 6728 / 194937344 | 124960 / 3120996864 | 8920 / 1197346944 |
| 2nd batch n-ops | 77 | 27 | 77 | 30 |
| max n-ops any batch | 407 | 27 | 407 | **50** |
| `op-queue pop` | **0** | 0 | yes (407-op batches complete) | yes (many small) |
| MUL_MAT_ID queued | 48 | **0** | 87+ in first two graph pairs | 0 |
| ARGSORT queued | 16 | 2 | 30 | **0** |
| FLASH_ATTN_EXT | 16 | 2 | 30 | yes (different shape, survives) |
| top execute-ops (first flushes) | ADD 129, RMS 65, MUL_MAT 65, MUL_MAT_ID 48 | MUL_MAT 10, ADD 10, RMS 8, ROPE/SET_ROWS 4, FA/ARGSORT/GET_ROWS 2 | same family as v73 HMX | MUL_MAT, GDN/SSM/SILU/L2_NORM (hybrid) |

dspqueue itself is tiny: `req_q_size = sizeof(htp_opbatch_req) * opt_opqueue(16) * 2 + 1024` (`ggml-hexagon.cpp:1798-1809`). Op descriptors live in SHM (`shm-block-size 852352`; OLMoE m-size 125 KB << 852 KB). **Write of the batch packet succeeds.** Death is on **read of the response** after the skel crashes.

Host tunables: `GGML_HEXAGON_OPBATCH` (default 1024), `GGML_HEXAGON_OPQUEUE` (default 16). v73 caps `opt_vmem` at `3000 * MiB` = 3145728000 (`ggml-hexagon.cpp:4427`); session log `vmem 3145728000`. OLMoE HMX first batch uses 3120996864 — under the cap by ~24 MiB. v75 uses `HTP_OP_MAX_VMEM_DEFAULT` 3355443200 (`htp-ops.h:114`).

hwinfo **identical** on both devices: `threads 4, hvx 4, hmx 1, vtcm 8 MB` (v73: `htp_smoke/s23_v73/hwinfo.txt:9`; v75: q48 SESSION_LOG / a_stderr). Host does not special-case MoE. `forcing ndev to 1 for SoCs archs lower than v75` is S23-only and also present on the **working** 4B run.

v73 vs v75 skel: `libggml-htp-v73.so` `c8f9d14a…` vs `libggml-htp-v75.so` `46d3ac92…`. Same `htp/` source tree (CMake `HEXAGON_ARCH`), different ISA compile. `binary-ops.c` has **no** `v75` ifdefs — so v75 survival is not an `#ifdef`. Different codegen, CDSP firmware, and/or 16 GB vs 7 GB are the remaining device/arch deltas.

## Ranked hypotheses

### H1 — **CONFIRMED: cDSP PD crash in v73 `op_binary` (NULL / Bad VA 0)** — rank 1

OLMoE's HTP subgraph exercises `op_binary` (ADD/MUL and fused binary) on a tensor layout the v73 skel is not handling: NULL `src[1]` or NULL `data`. MoE graphs are ADD-heavy (129 ADDs in the dying flush, including chains of `ffn_moe_weighted (view)` self-ADDs). HVX still dies with only 27 ops, **no MUL_MAT_ID**, HTP0-REPACK only 144 MiB — so this is **not** "experts too big" and **not** "407 ops overflow the queue".

4B also calls ADD/MUL/`op_binary`, but not the MoE residual-view / ARGSORT / SOFT_MAX mix, and never at 407-op / 3.1 GiB vmem. FLASH_ATTN_EXT **does** run on v73 4B (`bench_proof3.err:35488`) so FA is not sufficient to kill.

**Why v75 lives:** same host packet, same 407-op batch, skel actually **returns** (`op-queue pop`). Either v75 codegen of `op_binary` does not take the NULL path, or the illegal pointer is only produced under v73 mappings. Not a host queue-size bug.

Evidence: logcat crash report; `binary-ops.c:857-862`; 0 pops on v73 vs pops on v75; HVX counterexample.

### H2 — **PLAUSIBLE contributor: MoE routing ops (ARGSORT / SOFT_MAX / GET_ROWS of top-k) plus ADD-of-views** — rank 2

4B first flushes: **0 ARGSORT**. OLMoE HVX dying flushes: ARGSORT, SOFT_MAX, GET_ROWS, SET_ROWS, FLASH_ATTN, then ADD/MUL. `op_argsort` itself returns `HTP_STATUS_VTCM_TOO_SMALL` rather than crashing (`argsort-ops.c:271-274`) — if DSP returned that, host would log `dsp-rsp` not 0x2e. So ARGSORT is a **shape marker**, not necessarily the crashing instruction. The crash PC is in `op_binary`.

### H3 — **PLAUSIBLE contributor: giant 407-op / 3.12 GiB batch on 7 GB S23** — rank 3

Explains pp512 dying even faster (bigger graph) and 4B living (max 50 ops, ~1.2 GiB vmem). **Does not explain HVX** (27 ops, 186 MiB vmem, experts on CPU_REPACK). Treat as aggravating for HMX-default, not root.

### H4 — **REFUTED: HOSTBUF / `--no-host`** — q48 hostbuf1

Same 0x2e, same 48 expert execute-ops, tombstone cmdline has `--no-host 1`.

### H5 — **REFUTED: dspqueue timeout / packet-too-big**

Timeout = `AEE_EEXPIRED` 0x0C, retried. Packet-too-big = `AEE_EBADPARM` on **write**; write succeeded (`queue-opbatch` then crash on read). SHM 125 KB << 852 KB block.

### H6 — **REFUTED as root: HMX-only** — MM_SELECT=2 still 0x2e, attn `hvx-tiled`, crash in `op_binary` not HMX matmul.

## Candidate fixes (ranked, no implementation)

| # | fix | why it might work | cost | risk | verdict |
|---|---|---|---|---|---|
| F1 | **Patch v73 skel `op_binary`** (`binary-ops.c`): NULL-check `src[0]/src[1]/data`; handle MoE **views** (self-ADD of `ffn_moe_weighted (view)`). Rebuild `libggml-htp-v73.so`, keep host. Use crash PC `op_binary+0x5B9C` + SDK `debug.html` to land the line. | Hits the confirmed NULL deref. | **High** (DSP debug, rebuild, device flash of skel). Days not hours. | Medium: wrong patch leaves other ops crashing. | **Right root-cause fix.** |
| F2 | **Keep MoE combine / routing off HTP on v73** (`--override-tensor` or `GGML_HEXAGON_OPFILTER` for ADD/ARGSORT/MUL_MAT_ID, or supports-op no for those). Leave attn MUL_MAT on HTP like 4B. | Avoids the dying op mix; 4B already proves dense-hybrid HTP lives on v73. | **Low–medium** (host flags / one supports-op patch). Hours. | Loses experts-on-NPU on v73 (v75 keeps it). May still crash if the bad `op_binary` is an attn residual ADD. | Best **liveness** experiment next, not a product MoE-NPU story. |
| F3 | **Force smaller HTP batches** `GGML_HEXAGON_OPBATCH=32` (or flush after every op). | Shrinks 407-op flush toward 4B's 50. | **Low** (env). Minutes. | **Low confidence**: HVX already dies at 27 ops. Useful as a **negative control**. | Try only to refute H3. |
| F4 | **Do not pipeline**: `flush_pending(true)` after every `dspqueue_write` (host patch, ~5 lines). | Isolates which batch kills the PD. | **Low**. | Does not fix the NULL deref. | Diagnostic, not a fix. |
| F5 | **Retry `AEE_EINTERRUPTED` in `flush_pending`** | Matches AEEStdErr comment. | **Low**. | **Useless here**: PD is dead (`CDSP0 CRASHED`). Retry will fail or hang. | Do not ship as the fix. |
| F6 | **v75-only for Q4_0 MoE**; v73 stays dense-hybrid / B′ trunk | Honest product split given skel bug. | Policy. | Blocks "NPU lane on v73" for experts until F1. | Interim. |
| F7 | Rebuild v73 skel with FARF HIGH + `llama-bench.farf` (logcat already noted missing farf file) to print op name before `op_binary`. | Names the exact ADD/MUL node. | **Low–medium**. | Debug-only. | Do before F1 if PC offset is ambiguous. |

## What OLMoE does to the v73 session that 4B does not

It enqueues a **MoE transformer HTP graph**: ADD-heavy residual of **views**, ARGSORT+SOFT_MAX+GET_ROWS routing, optional MUL_MAT_ID, and (default) a **single 407-op flush** touching ~3.1 GiB. The v73 skel then **NULL-derefs in `op_binary`**, the unsigned CDSP PD dies (`TLBMISS RW`, Bad VA 0), FastRPC cancels `dspsignal_wait` with **0x2e**, host abort. 4B never builds that graph (hybrid GDN/SSM, max 50 ops/flush, no ARGSORT, fewer ADDs). v75 runs the **identical** 407-op packet to completion.

## Stop

Diagnosis only. Next bounded experiment if wanted: F3 negative control **or** F2 opfilter (routing/ADD off HTP) as a liveness check — not a skel marathon.
