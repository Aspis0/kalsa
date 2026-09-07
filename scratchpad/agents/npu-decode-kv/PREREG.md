# PREREG — NPU decode: is host-KV the cause?

Written 2026-09-07T14:46:30Z, BEFORE any measurement of this cell.
Question: the banked Hexagon decode loss (`tg 0.63×` vs CPU, ALIVE row 13)
was taken on OLMoE forced to `-nkvo` because "a 256 MB KV cache at ctx 2048
cannot be fastrpc-mapped". Is NPU decode slow **because** the KV cache sits
on the host, or is it slow anyway?

This cell answers it on the shipped model (1.48 GiB), where the owner's
4 GB mapping-ceiling hypothesis predicts the KV **will** map.

## Step 0 — feasibility (offline, done before this file)

- Kit `~/kalsa-qdc/npu-v79-cell/npu-kit-153fdbafd.tgz`
  sha256 `e7ff4cd8b18ac1b554d8660e315432926a1440ff9c7bb991de9ecf3191623350`
  unpacked at `/tmp/npu-decode-kv-kit`. Contains
  `lib/libggml-htp-v75.so` (519K) and `lib/libggml-htp-v79.so` (535K),
  plus `bin/llama-bench`.
- Hexagon backend loads
  `file:///libggml-htp-v%u.so?htp_iface_skel_handle_invoke&_modver=1.0`
  (`ggml-hexagon.cpp:1683`). v75 DSP → `libggml-htp-v75.so`.
- `hexagon-build3.log` ends `BUILD_ALL_DONE`; v73 failed in build1/2,
  v75 linked.
- **Gate: PASS (v75 skel present). Prefer QRD8650 / SM8650 (Hexagon v75).**
  8 Elite (QRD8750, v79) is the fallback only; if used, declare it and
  keep the session under 40 minutes (pool budget 89 min).
- No Hexagon SDK rebuild.

## Model (fixed)

`~/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf`
sha256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`
size 1.48 GiB / 1,593,894,944 B. Device path `$D/ship.gguf`.
Mismatch on-device = METHOD-VOID.

Architecture (GGUF, used only to **predict** KV bytes, not as a measurement):
lfm2, 30 blocks, 8 attention layers (`head_count_kv=8` at layers
2,5,9,13,17,21,24,27), `n_embd=2048`, `n_head=32` → `n_embd_head=64`.
Default K/V type f16. Predicted KV at n_ctx=2048:

```
8 * 2048 * 8 * (64+64) * 2 = 33,554,432 B = 32.0 MiB
```

Weights 1.48 GiB + KV 32 MiB ≈ 1.51 GiB. Owner's 4 GB hypothesis and
the backend default `opt_vmem=3200 MiB` (v75+) both predict C maps.

## Device dir, env, kit layout

`$D=/data/local/tmp/kalsa-npu-decode-kv`
Kit pushed as tarball, unpacked on device, SHA256SUMS verified.

```
export LD_LIBRARY_PATH=$D/lib
export ADSP_LIBRARY_PATH=$D/lib
export GGML_HEXAGON_NDEV=1
export GGML_HEXAGON_VERBOSE=1
# ⛔ NEVER /vendor/lib64 in LD_LIBRARY_PATH
```

## Why n_ctx=2048 via `-d 1920`, not bare `-p 0 -n 128`

llama-bench sets `n_ctx = n_prompt + n_gen + n_depth` (llama-bench.cpp:1259).
Bare `-p 0 -n 128` → n_ctx=128 → predicted KV 2.0 MiB. That cannot test
"host KV transfer is the decode handicap" — 2 MiB is noise vs a 256 MB
OLMoE cache. `-d 1920` makes n_ctx=2048, the same ctx that forced `-nkvo`
on OLMoE, with a 32 MiB KV that **should** map on this model.

Same model, same dummy prompt path, same 128 generated tokens, same
n_depth, same seed-irrelevant llama-bench graph. `-r 3`.

## Commands

Common flags (all speed arms):

```
./bin/llama-bench -m $D/ship.gguf --mmap 0 --poll 1000 -t 8 -ub 1024 -fa 1 \
  -p 0 -n 128 -d 1920 -r 3 -v
```

Each invocation:

```
<cmd> > $HOST_RAW/<arm>.log 2>&1; echo EXIT=$? >> $HOST_RAW/<arm>.log
```

Real exit code only (no pipe). Logs land in this cell's `raw/`.

### P0 — empirical mapping ceiling (not a speed number)

Cap 180 s. Env extra: `GGML_HEXAGON_VMEM=0`.

```
GGML_HEXAGON_VMEM=0 ./bin/llama-bench -m $D/ship.gguf --device HTP0 -ngl 99 \
  --mmap 0 -p 0 -n 1 -r 1 --no-warmup -v
```

Record the line `ggml-hex: HTP0 measured max vmem N` (ggml-hexagon.cpp:1813).
N is in bytes. Convert to MiB. This arm may fail the bench itself; the
measurement line is the result. If the line is absent, bank "UNMEASURED"
and continue — speed arms still answer the question.

Ceiling readings (one line each):
- Owner 4 GB (32-bit) hypothesis CONFIRMED if N ∈ [3500, 4096] MiB.
- Qualcomm 8gen3 ~3 GB claim CONFIRMED if N ∈ [2800, 3200] MiB.
- Backend default 3200 MiB is **not** a measurement; only this probe is.

### A — CPU decode reference

```
./bin/llama-bench -m $D/ship.gguf --mmap 0 --poll 1000 -t 8 -ub 1024 -fa 1 \
  -p 0 -n 128 -d 1920 -r 3 -v -ngl 0
```

No `--device HTP0`. Number = `tg128` t/s (mean of r=3 as printed).
Proof: `llama_kv_cache:` line with a CPU/Host buffer name. The backends
column may still print `OpenCL,HTP` — ignore the table, trust the log.

### B — NPU decode, KV on host (`-nkvo 1`)

```
./bin/llama-bench -m $D/ship.gguf --mmap 0 --poll 1000 -t 8 -ub 1024 -fa 1 \
  -p 0 -n 128 -d 1920 -r 3 -v --device HTP0 -ngl 99 -nkvo 1
```

Proof required, else METHOD-VOID (silent CPU fallback):
1. `ggml-hex: Hexagon Arch version v75` (or `v79` on 8 Elite fallback).
2. `ggml-hex: HTP0 execute-op` at least once during the run
   (needs `GGML_HEXAGON_VERBOSE=1` and `-v`).
3. `llama_kv_cache:` KV buffer name is CPU/Host, **not** HTP.

### C — NPU decode, KV offloaded (no `-nkvo`)

```
./bin/llama-bench -m $D/ship.gguf --mmap 0 --poll 1000 -t 8 -ub 1024 -fa 1 \
  -p 0 -n 128 -d 1920 -r 3 -v --device HTP0 -ngl 99
```

Proof required, else METHOD-VOID:
1. Same Hexagon arch + execute-op lines as B.
2. `llama_kv_cache:` KV buffer name contains `HTP`.
If allocation fails, this is not VOID — it is a **ceiling result**
(see readings). Quote the exact error and the byte sizes
(mapped-buffer lines + attempted KV MiB).

Expected failure signature (q55):
`ggml-hex: HTP0 failed to allocate buffer context (host): ggml-hex: fastrpc_mmap failed`

## Order, thermal, session

Order: **P0 → A → B → C**. CPU before NPU so DSP heat does not contaminate
the reference. Thermal gate (#38, binding): live HAL max ≤ 60 °C and
Thermal Status ≤ 1 before **each** arm; snapshot after. If the gate fails,
do not run the remaining arms; bank what completed.

One QDC interactive session, SSH-only, ≤ 45 minutes of device
(≤ 40 if 8 Elite). Tunnel on local port **6037**, never 5037.
`ANDROID_ADB_SERVER_PORT=6037`. End Session: toolbar button by ref, `Yes`
by ref, reload, confirm `Session Status: Completed` and a populated
`Ended On` within one minute.

## Pre-registered readings

Let A, B, C be the printed `tg128` means (t/s). Ratios use those means.
An arm with non-zero exit and no t/s is FAILED, not a ratio input.
METHOD-VOID arms are excluded from ratios.

1. **C fails to allocate.** Record the exact error, mapped-buffer byte
   sizes, and the `llama_kv_cache` attempted size. That **is** the
   ceiling measurement. Verdict: `CEILING-HIT`. Do not invent a t/s.
   Justify: a mapping failure is the original OLMoE handicap; observing
   it on 1.48 GiB + 32 MiB would refute the headroom arithmetic, not
   the decode-speed question.

2. **C/A ≥ 1.0** (and C has HTP KV proof). Verdict: `KV-WAS-THE-BLOCKER`.
   NPU decode with KV on the DSP matches or beats CPU → NPU decode
   becomes a live routing option. Threshold 1.0 because "live option"
   means it must not lose; 0.99× is still a loss. Justify: the product
   question is "should decode go to NPU", not "is NPU less-bad than
   NPU-with-host-KV".

3. **C ≈ B within 10%**, i.e. `0.90 ≤ C/B ≤ 1.10` (both with engine
   proof; B has host KV, C has HTP KV). Verdict: `KV-NOT-THE-CAUSE`.
   NPU decode loses intrinsically. Justify: 10% is wider than typical
   tg stdev on these boards (~1–15% in cell #43) but much smaller than
   the banked 0.63× gap (a 37% deficit). If host-KV transfer were that
   deficit, C would beat B by ≫ 10%.

4. **C/B ≥ 1.15 AND C/A < 1.0.** Verdict: `PARTIAL`. Host-KV was a real
   handicap (C beats B by more than noise) but not enough to make NPU
   decode win vs CPU. Thesis as a routing choice still fails; the
   mechanism claim is supported. 15% (not 10%) to avoid double-counting
   the 10% band of reading 3.

5. **B METHOD-VOID** (no HTP execute-op). Do not interpret B or C/B.
   C vs A still readable if C has proof.

6. **NPU cannot run this graph at all** (init fails, or execute-op
   absent on both B and C, or ops fall back with a quoted
   `supports-op`/`INTERNAL-ERROR` reason). Verdict: `NPU-GRAPH-FAIL`.
   Quote the ops that fall back. Stop. No speed claim.

## Non-goals

No energy, no PPL/correctness, no app, no MoE, no Hexagon SDK build,
no comparison to OLMoE's 0.63× as a same-harness number (different
model). Cell #43's v79 ship-model tg (no `-nkvo`) is **not** a
substitute for C: it did not isolate KV placement and did not keep
the `llama_kv_cache` proof line.

## 8 Elite fallback (only if QRD8650 cannot be booked)

Declare `DEVICE=QRD8750` in REPORT. Same commands, expect
`Hexagon Arch version v79`. Session cap 40 minutes. Same readings.
