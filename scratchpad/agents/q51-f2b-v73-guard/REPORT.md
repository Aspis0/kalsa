# q51 F2b — v73 host guard `GGML_HEXAGON_NO_BINARY=1`

REGISTRA+DICHIARA. Raw: `results/htp_probe/s23_v73_olmoe_q40/f2b/`. Patch: `PATCH.diff` (not committed).

## Verdict

**Survived: NO.** rc=134, jsonl empty, same `dspqueue_read failed: 0x0000002e`.

The guard **did what it was asked**: binary ops (ADD/SUB/MUL/DIV) are **not** on HTP (`n_binary_htp0=0`). **Experts stayed on the NPU** (`n_exps_htp0=42` MUL_MAT_ID on `ffn_*_exps`, hmx-tiled). Probe is **not void**.

F2b as a **liveness** fix is **REFUTED**. q50's `op_binary` crash is not the only killer; after removing those ops the PD still dies while executing a small MUL_MAT_ID/SWIGLU batch (layer 13, n-ops=8).

## Lineage

- Source: git worktree `scratchpad/agents/q51-f2b-v73-guard/llama.cpp` detached **3f545becc** (did not touch `upstream-hexagon` judge-exp branch or BigMoeOnEdge).
- Build: `build-android-f2b`, NDK 27.1, android-31, LOW priority, ninja `-j 4`, **host** `ggml-hexagon` + `llama-bench` only (no skel rebuild).
- Pinned `kalsahtp` left intact (`llama-bench 5db18906…`, `libggml-hexagon f06aa309…`).
- New dir `/data/local/tmp/kalsahtp_f2b/`. Skel still `libggml-htp-v73.so` `c8f9d14a…` (PIN MATCH).

| artifact | sha256 |
|---|---|
| llama-bench (stub, new) | `f01a4d425a0dbacba9e5da17e88d33b032ccf85345f89725ec2b46441f241a33` |
| libggml-hexagon.so (patched) | `57c7ca6f4c86b0153439cf9b8c44e6bec00aee25f465b3be86612d582d220dfc` |
| libggml-htp-v73.so | `c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5` |
| model | `43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500` |

## (a) pp16/tg8 `-v` NO_BINARY=1

Battery 75 % unplugged, 25.8 °C. Env: NDEV=1 VERBOSE=1 HOSTBUF=1 `--no-host 1` `GGML_HEXAGON_NO_BINARY=1`.

Log: `ggml-hex: GGML_HEXAGON_NO_BINARY=1: declining ADD/SUB/MUL/DIV ...`

| | unguarded q48 (a) | F2b |
|---|---:|---:|
| rc | 134 | **134** |
| n_htp execute-op | 484 | 294 |
| MUL_MAT_ID ffn_*_exps | 48 | **42** |
| HTP execute-op ADD/MUL/SUB/DIV | 129+ | **0** |
| dspqueue_read 0x2e | 1 | **1** |
| HTP0-REPACK MiB | 3600.02 | **3600.02** |

Batches are now small (graph splits at CPU/HTP cuts): n-ops 1–8. Crash after:

```
HTP0 execute-op MUL_MAT_ID|blk.13.ffn_down_exps.weight ... hmx-tiled
HTP0 op-queue push batch #3 : n-bufs 3 n-tensors 15 n-ops 8 ...
ggml-hexagon.cpp:1584: ggml-hex: dspqueue_read failed: 0x0000002e
```

42 = 14 layers × 3 expert tensors (died during blk.13).

## (b) skipped

(a) not sane. No pp512/tg128 HTP numbers. No CPU ref this cell.

Compare vs CPU: **n/a** (HTP did not finish). Do not compare t/s vs the doomed unguarded run.

## Anomalies

1. F2b **refutes** “binary-ops-off-HTP restores liveness.” Experts-on-NPU still crash the v73 PD.
2. `n_exps=42` not 48: abort mid-graph, last two layers never queued.
3. New host stack (not the 5db18906 stub) because llama-bench was rebuilt at 3f545be; skel unchanged. ABI is the F2b dir only.
4. No `CPU_REPACK` line; CPU buffer 136.37 MiB (binary/activations on CPU).

No leftover llama. No git commits. Pinned `/data/local/tmp/kalsahtp` not modified.
