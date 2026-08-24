# q48 REPORT — first MoE-experts-on-NPU probe (S23 HTP v73)

REGISTRA+DICHIARA. Raw: `results/htp_probe/s23_v73_olmoe_q40/`.

## Verdict

**exps-on-HTP: YES.** `HTP0 execute-op MUL_MAT_ID|blk.*.ffn_*_exps` appeared (48 lines). Then llama-bench **aborted** (rc=134) on decode flush. (a) not sane → (b) pp512/tg128 and CPU reference **not run**.

This is dispatch proof, not a prefill t/s number.

## Exact evidence line

```
ggml-hex: HTP0 execute-op MUL_MAT_ID|blk.0.ffn_gate_exps.weight x ffn_norm-0 (reshaped) x ffn_moe_topk-0 -> ffn_moe_gate-0|2048:1024:64:1 x 2048:1:16:1 x 8:16 -> 1024:8:16:1|q4_0 x f32 x i32 -> f32|18:1152:1179648:75497472 x 4:8192:8192:131072 x 4:256! -> 4:4096:32768:524288|HTP0-REPACK x HTP0 x HTP0 -> HTP0|hmx-tiled vtcm 6293504|flags 0x0
```

Same pattern for `ffn_up_exps` / `ffn_down_exps` on layers 0–14 (prefill, HMX). Decode logged layer 15 as `hvx-tiled` at `x 8:1`.

## Counts (a, `-v`)

| class | n |
|---|---:|
| HTP0 execute-op (all) | 484 |
| attn Q/K/V/O execute-op | 96 |
| `MUL_MAT_ID` execute-op (all) | 48 |
| `HTP0 execute-op MUL_MAT_ID` on `ffn_*_exps` | **48** |
| of which hmx-tiled n=16 (pp) | 45 |
| of which hvx-tiled n=1 (tg) | 3 |
| init-tensor experts on HTP0 | 48 |
| init-tensor attn on HTP0 | 96 |
| supports-op MUL_MAT_ID `\|yes` (HTP0-REPACK) | 528 |
| supports-op MUL_MAT_ID `\|no` (HTP0 non-repack) | 48 |

The `|no` lines are the non-repack buft; the same tensors are `|yes` on HTP0-REPACK. Not a type/VTCM supports-op rejection.

## Buffer split (load-time)

offloaded 17/17. MemTotal 7074 MiB. Fit at load: **yes**.

| buft | MiB |
|---|---:|
| CPU | 55.27 |
| CPU_REPACK | 80.60 |
| HTP0 | 8.51 |
| HTP0-REPACK | **3600.02** |
| sum | 3744.40 |

Experts (~96 % of the file) landed on **HTP0-REPACK**. Inverse of KEXP B-prime (experts CPU, trunk HTP).

## t/s

| cell | pp512 | tg128 |
|---|---|---|
| (a) pp16/tg8 HTP | **no jsonl** (abort) | **no jsonl** |
| (b) HTP -r 2 | skipped | skipped |
| (c) CPU -ngl 0 -r 1 | skipped | skipped |

No first-ever experts-on-NPU prefill number: process died in `llama_decode` after the pp graph was queued.

## Why (a) died (not a supports-op negative)

```
ggml-hexagon.cpp:1583: ggml-hex: dspqueue_read failed: 0x0000002e
```

Backtrace: `llama_decode` → `graph_compute` → `flush_pending` → `ggml_abort`. rc=134 (`Aborted`).

Prefill batch #0 (`n-ops 407`) queued; decode batch #1 (`n-ops 77`) queued; `dspqueue_read` failed on the decode flush. Last expert ops on that graph: `blk.15.ffn_*_exps` **hvx-tiled** (n=1, the PREP m%32 / small routed-token path). Not a VTCM supports-op reject (those ops logged `hvx-tiled vtcm 2727936` / `475136` and were queued).

## Pins / battery

- Model 3928037856 B, sha256 `43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500` (PC = device).
- kalsahtp v73: stub `5db18906…` / hexagon `f06aa309…` / htp-v73 `c8f9d14a…`.
- Unplugged 79 % / 29.9 °C throughout. Gates held.

## Anomalies

1. Prefill `execute-op` for `blk.15` MUL_MAT_ID is **missing** from stderr (layers 0–14 hmx n=16 = 45; only decode `blk.15` hvx n=1 = 3). Graph split / batching, not a supports-op no.
2. `rpcmem_alloc2 not found, falling back to rpcmem_alloc` (same as q46; not new).
3. `failed to get URI for session 0 : error 0x14` then single-session fallback (also seen on prior HTP runs).
4. Device still holds LFM B-prime 3.3G + Marco B-prime 6.5G + this 3.7G. Nothing deleted.

No leftover llama. No git.

---

## Follow-up (b') — prefill-only, 2026-08-24T13:11Z

Goal: first MoE-experts-on-NPU prefill number. `-p 512 -n 0` (skip tg). Same kalsahtp v73, NDEV=1 VERBOSE=1 HOSTBUF unset.

### HTP pp512: NO NUMBER (abort on the prompt run itself)

`-n 0` **is accepted** (`benchmark 1/1: prompt run 1/2`). Then:

```
llama-bench: benchmark 1/1: prompt run 1/2
ggml-hexagon.cpp:1583: ggml-hex: dspqueue_read failed: 0x0000002e
```

backtrace still `llama_decode` (llama.cpp prompt eval uses `llama_decode` on the prompt batch). rc=134, **stdout jsonl empty** (also with `-oe jsonl` on stderr). Captured uniquely in `results/htp_probe/s23_v73_olmoe_q40/n0/`.

Fallback `-n 1` (two reps): same abort on `prompt run`, jsonl empty. So the abort is **not tg-only** at pp512 — the 512-token prefill graph dies on `dspqueue_read 0x2e`. (a) pp16 got far enough to log 48 MUL_MAT_ID execute-ops; pp512 does not.

| cell | pp512 t/s | tg | rc |
|---|---:|---|---:|
| HTP `-n 0` -r 2 | **none** (abort before jsonl) | skipped | 134 |
| HTP `-n 1` r1 | none | none | 134 |
| HTP `-n 1` r2 | none | none | 134 |
| CPU `-ngl 0` r1 | **39.24** | n_gen=1: 18.48 | 0 |
| CPU `-ngl 0` r2 | **100.52** | n_gen=1: 17.83 | 0 |

CPU spread 39 vs 100 t/s on two `-r 1` invocations (load each time; r1 after three HTP aborts). Exploratory. Mean ~70 t/s is not a number to ship.

### J/token

sysfs `/sys/class/power_supply/battery/charge_counter` **Permission denied** (same as Xiaomi). Fallback: `dumpsys battery` `Charge counter:` (uAh).

Per-rep windows (7–18 s): **dQ = 0 uAh** on every HTP and CPU pair. Samsung counter ticks ~3750 uAh (~55 J at 4.1 V); these cells are below one tick. Session bprime start=end `2951250` uAh. n0 later `2928750` (idle + n0, not a per-rep figure).

**J/token: not measurable at this duration.** Bracket files saved (`bprime/charge_*`, `n0/charge_*`). Temp 27.7–28.9 °C, level 78 % unplugged.

### INTERNAL-ERROR / correctness flag

| stderr | INTERNAL-ERROR | hmx error | dspqueue_read 0x2e |
|---|---:|---:|---:|
| (a) pp16/tg8 | **0** | 0 | 1 |
| (b') HTP n=0 | **0** | 0 | 1 |
| (b') HTP n=1 r1/r2 | **0** | 0 | 1+1 |
| CPU r1/r2 | 0 | 0 | 0 |

No `INTERNAL-ERROR` / `hmx error` strings. That does **not** prove HMX output is correct.

q35 caveat still applies to (a): expert MUL_MAT_ID ran **hmx-tiled at n=16** (`16 % 32 != 0`). Host selected HMX; 0 INTERNAL-ERROR lines; no generated tokens to inspect. **(a) remains dispatch-proof only, not correctness-proof.** pp512 HTP produced no number to mislabel.

llama-cli: **skipped** — `kalsahtp` has no `llama-cli` (only `llama-bench` / `test-backend-ops` / `llama-gguf`).

### Crash evidence

- `results/htp_probe/s23_v73_olmoe_q40/crash_context.txt` — (a) stderr ±50 lines around `dspqueue_read` (**yes**).
- Tombstone **accessible without root**: `/data/tombstones/tombstone_08` pulled. Timestamp `2026-08-24 09:01:48.469-0400`, cmdline matches (a) (`-p 16 -n 8 -v ... OLMoE ...`), signal 6 SIGABRT, pid 24761. Saved as `tombstone_08.txt`.
- (b') n0 stderr: abort on **prompt run**, same `dspqueue_read 0x2e`.

---

## Xiaomi v75 discriminator — 2026-08-24T13:24Z

**SURVIVED.** Same model/sha, same llama-bench @3f545be, **v75** `libggml-htp-v75.so` `46d3ac92…`, HOSTBUF=1 + `--no-host 1` (Marco v75 convention). houji 16 GB, unplugged 89 % / 31.9 °C start → 89 % / 33.4 °C end. Raw: `results/htp_probe/xiaomi_v75_olmoe_q40/`.

v73 on S23 died with `dspqueue_read failed: 0x0000002e` at pp16-decode and at pp512 prompt. v75 on houji: **every HTP cell rc=0**, **0** `dspqueue` / `INTERNAL-ERROR` / `hmx error` / `Aborted` / `ggml_abort` lines in all stderr. No crash_context, no new tombstone. The HTP MUL_MAT_ID path is **not** broken under load in general — the death was **v73-specific**.

### Execute-op (a, pp16/tg8 `-v`, rc=0)

Same dispatch line as S23, but the process **finished**:

```
ggml-hex: HTP0 execute-op MUL_MAT_ID|blk.0.ffn_gate_exps.weight ...|q4_0 x f32 x i32 -> f32|...|HTP0-REPACK x HTP0 x HTP0 -> HTP0|hmx-tiled vtcm 6293504|flags 0x0
```

| class | n |
|---|---:|
| HTP0 execute-op (all) | 4100 |
| attn Q/K/V/O execute-op | 608 |
| `MUL_MAT_ID` on `ffn_*_exps` | **432** |
| of which gate / up / down | 144 / 144 / 144 |
| of which hmx-tiled | 45 |
| of which hvx-tiled | 387 |

Load split identical to S23: CPU 55.27 / CPU_REPACK 80.60 / HTP0 8.51 / **HTP0-REPACK 3600.02** MiB, offloaded 17/17. Experts on NPU.

### t/s (exploratory, unplugged)

| cell | pp512 t/s | tg128 t/s | rc |
|---|---:|---:|---:|
| HTP (b) r1 `-n 0` | **687.40** | — | 0 |
| HTP (b) r2 `-n 0` | **684.99** | — | 0 |
| HTP tg `-p 0 -n 128` | — | **21.76** | 0 |
| CPU (c) r1 `-ngl 0` | 142.92 | 34.64 | 0 |
| CPU (c) r2 `-ngl 0` | 141.48 | 33.96 | 0 |

HTP/CPU pp512 **686.2 / 142.2 = 4.82×**. HTP/CPU tg128 **21.76 / 34.30 = 0.63×** (CPU faster generate). First MoE-experts-on-NPU prefill number: **~686 t/s pp512** (mean of two process-level `-r 1`). Wall times match (b_r1 ~7 s including load).

(a) sanity: pp16 68.05 / tg8 21.46 (tg matches b_tg).

### J/token

sysfs charge_counter **EACCES**. dumpsys Charge counter. Per-rep windows 7–23 s: **mostly 0 µAh ticks** (b_r2 6 mAh, c_r2 18 mAh). Session 3717000→3693000 µAh (24 mAh) mixes HTP+CPU. **J/token not measurable at this duration** (same granularity problem as S23 and the Marco energy extras). Brackets saved (`charge_*_pre/post.txt`).

### Correctness-flag counts

All stderr: dspqueue=0, INTERNAL-ERROR=0, hmx error=0, Aborted=0. q35 caveat still applies (hmx-tiled at n=16, `16%32 != 0`) — this is a **liveness + dispatch** result, not a numerical-correctness proof.

No git. Nothing deleted. No leftover llama.


