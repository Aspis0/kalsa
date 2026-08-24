# q48 SESSION_LOG — S23 OLMoE all-Q4_0 experts-on-NPU probe (v73)

Protocol: REGISTRA+DICHIARA (declared conditions, dispatch proof; all t/s exploratory).
Device serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (S23 only).
adb: `C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe`
Binary: `/data/local/tmp/kalsahtp` (same v73 pins as q46).
Env (HTP): `GGML_HEXAGON_NDEV=1`, `GGML_HEXAGON_VERBOSE=1`, `GGML_HEXAGON_HOSTBUF` **unset**.
Driver: `phase2_driver.sh` LF-only CR=0, detached `setsid nohup`.
No git. Did not touch `BigMoeOnEdge/`. Deleted nothing (LFM B-prime and Marco B-prime left on device).

All timestamps UTC.

## 2026-08-24T12:55Z — PC pin + device probe

- GGUF `scratchpad/agents/q48-olmoe-q40-npu/gguf/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf` 3928037856 B.
- PC hashlib sha256 `43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500` MATCH PREP.md.
- No llama on S23. Battery 79 % unplugged, 29.8–29.9 °C. `/data` 12G free before push — 3.7G fits. No deletions.

## 2026-08-24T12:56Z — push + on-device sha

- `adb push --sync` 3928037856 B in 198.6 s (18.9 MB/s) → `/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf`
- On-device sha256 MATCH pin.
- LFM B-prime 3580407296 B and Marco B-prime 6509642624 B still present. `/data` after push 8.5G.

## 2026-08-24T13:01:36Z — launch (pid 24707)

- Header: level=79, temperature=299 (29.9 °C), unplugged. MemTotal 7243744 kB.
- Binary pins MATCH. Model sha re-verified on device.
- Cool-start PASS. (a) launched 13:01:41Z.

### (a) pp16/tg8 -v HTP0 — DISPATCH YES, then abort rc=134

- 13:01:48Z `a rc=134`. jsonl empty (`n_json=0`). (b)(c) skipped by protocol (not sane).
- **Headline: experts DID run on HTP0.**
  Exact evidence:
  `ggml-hex: HTP0 execute-op MUL_MAT_ID|blk.0.ffn_gate_exps.weight x ffn_norm-0 (reshaped) x ffn_moe_topk-0 -> ffn_moe_gate-0|2048:1024:64:1 x 2048:1:16:1 x 8:16 -> 1024:8:16:1|q4_0 x f32 x i32 -> f32|…|HTP0-REPACK x HTP0 x HTP0 -> HTP0|hmx-tiled vtcm 6293504|flags 0x0`
- Counts: n_htp=484, n_attn=96, n_exps_htp0_mul_mat_id=**48**, n_mul_mat_id=48, supports-op MUL_MAT_ID yes=528 no=48.
- Kernel split of the 48: **45 hmx-tiled at n=16** (pp, layers 0–14) + **3 hvx-tiled at n=1** (decode, layer 15 gate/up/down).
- `init-tensor` of all 48 expert weights on **HTP0** (75497472 B each).
- Buffer split:

| buft | MiB |
|---|---:|
| CPU | 55.27 |
| CPU_REPACK | 80.60 |
| HTP0 | 8.51 |
| HTP0-REPACK | 3600.02 |
| **sum** | **3744.40** |

- `offloaded 17/17`. Fit at load **yes** vs MemTotal 7074 MiB. This is the inverse of KEXP B-prime: experts on HTP0-REPACK, only the Q6_K `output.weight` (+small) on CPU.
- supports-op: MUL_MAT_ID on `HTP0` (non-repack) → `|no`; on `HTP0-REPACK` → `|yes`. The 48 `|no` are the non-repack buft check, **not** a type rejection.

### Abort (why (a) is not sane)

Prefill batch #0 queued (`n-ops 407`, vmem ~3.12e9). Decode batch #1 queued (`n-ops 77`). Then:

```
ggml-hexagon.cpp:1583: ggml-hex: dspqueue_read failed: 0x0000002e
ggml_abort  (backtrace: llama_decode -> graph_compute -> flush_pending)
Aborted
```

Last logged decode experts: `blk.15.ffn_{gate,up,down}_exps` **hvx-tiled** at `x 8:1` (single token; PREP risk: m%32 HMX contract → HVX fallback). Crash is DSP queue read on decode flush, **after** MUL_MAT_ID dispatch, not a supports-op rejection.

Battery after (a): still 79 % / 29.9 °C, unplugged. No leftover llama.

## 2026-08-24T13:02Z — pull

37 files (2643239 B) → `results/htp_probe/s23_v73_olmoe_q40/device/kalsa_q48/`. GGUF left on device. No deletions. No git.

## 2026-08-24T13:10Z — follow-up (b') prefill-only

- Battery 78 % unplugged, 28.1 °C. No llama. sysfs charge_counter Permission denied. Tombstones listable: `tombstone_08` is (a) (09:01:48-0400, SIGABRT, cmdline match). Pulled to `tombstone_08.txt`.
- crash_context.txt written from (a) stderr ±50 lines around dspqueue_read (line 16878 / 16893).
- INTERNAL-ERROR in (a) stderr: **0**.
- kalsahtp has no llama-cli — skip.

### Driver `bprime` (pid 25096)

Two HTP `-r 1` + two CPU `-r 1`, charge-bracketed. `-n 0` first.

- 13:11:15Z HTP r1 `-n 0`: rc=134 in 7 s, jsonl empty. Fallback `-n 1` overwrote r1 files (later recaptured uniquely as `n0/`).
- 13:11:22Z HTP r1 `-n 1`: rc=134. stderr: `benchmark 1/2: prompt run 1/1` then dspqueue_read 0x2e in llama_decode. jsonl empty.
- 13:11:29Z HTP r2 `-n 1`: rc=134, same.
- 13:11:35Z CPU r1 `-ngl 0 -n 1`: rc=0. pp512 **39.24 t/s**, tg1 18.48 t/s.
- 13:11:54Z CPU r2: rc=0. pp512 **100.52 t/s**, tg1 17.83 t/s.
- STATUS DONE 13:12:05Z. Charge counter 2951250 throughout bprime session (dQ=0 per rep).

### Unique `-n 0 -r 2` recapture (`n0/`) 13:14:29Z

- `-n 0` accepted (`benchmark 1/1: prompt run 1/2`).
- Abort on the **first prompt rep**, jsonl empty, stderr 1861 B, rc=134, same 0x2e.
- Charge 2928750 pre=post (6 s, below tick). 78 % / 28.9 °C.

No leftover llama. Nothing deleted. No git.

## 2026-08-24T13:24Z — Xiaomi houji v75 discriminator

Serial `adb-625689a2-9xEOfw._adb-tls-connect._tcp` houji. S23 not addressed. Unplugged 89 % / 31.9 °C. df 303G. No deletes.

Push 3928037856 B in 247 s. On-device sha `43379486…` MATCH. kalsahtp v75 pins match Marco cells. HOSTBUF=1 `--no-host 1`.

Driver `/data/local/tmp/kalsa_q48_x` pid 7352. **ALL rc=0.**
- (a) 9 s, MUL_MAT_ID exps **432**, rc=0 (S23 died here)
- (b) pp512 `-n 0` r1/r2 rc=0, **687 / 685 t/s**
- tg `-p 0 -n 128` rc=0, **21.76 t/s**
- (c) CPU r1/r2 rc=0, pp512 143/141, tg128 34.6/34.0
- dspqueue/INTERNAL-ERROR/hmx error/Aborted: **0**
- Charge per-rep mostly 0 ticks; session 3717000→3693000 µAh

Pulled 96 files → `results/htp_probe/xiaomi_v75_olmoe_q40/`. MANIFEST written. No git.

## 2026-08-24T13:50Z — S23 v73 HOSTBUF=1 confound-closer

S23 only. Battery 77 % unplugged, 25.9 °C. No llama. GGUF already on device, sha re-verified `43379486…`. Stub 5db18906, hexagon f06aa309, **htp v73** c8f9d14a.

Env: `GGML_HEXAGON_HOSTBUF=1` `NDEV=1` `VERBOSE=1` `--no-host 1` (houji pair). Launch pid 26870.

- 13:50:29Z (a) pp16/tg8 -v: **rc=134**. proof n_htp=484 n_mmid=48 **n_exps_htp0=48** n_attn=96 n_json=0. Same `dspqueue_read failed: 0x0000002e`. Experts still hmx-tiled. Tombstone_13 cmdline has `--no-host 1`.
- 13:50:37Z (a_hvx) `GGML_HEXAGON_MM_SELECT=2`: **rc=134**. n_exps_htp0=0. Attn execute-op **hvx-tiled** (select applied). Same 0x2e around blk.1 ffn_gate_inp. Stop.

Confound closed: HOSTBUF=1 + `--no-host 1` does not make v73 live. Crash not HMX-only. Pulled 55 files (4.2 MB) → `results/htp_probe/s23_v73_olmoe_q40/hostbuf1/`. No git. No leftover llama.



