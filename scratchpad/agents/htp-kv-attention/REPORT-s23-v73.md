# HTP prefill vs `no_kv_offload` — Galaxy S23 (SM8550, Hexagon v73), 2026-10-02

**This is the S23 repeat the two earlier reports called "the missing datapoint": the Hexagon
the app actually meets on this phone (and the phone whose in-app numbers were measured in
`s23-layers-device-proof/` the same night).** Driver `run_bench.py --serial
192.168.1.152:34673 --dsp-arch v73 --stage all`, kit `~/kalsa-qdc/kit-5b596ce43`
(engine kalsallama `5b596ce43`, model LFM2.5-2.6B-QAD-Q4_0.gguf), no `--personal-device`
(our own phone), one session, n = 3 reps per cell.

## Answer

**Yes — on v73 the host-side KV cache (`-nkvo 1`, attention pinned to the CPU) is what makes
an HTP 128-token prefill chunk slow down with context, and the effect is the strongest of the
three SoCs measured so far.** With KV on host (A, q8_0/q8_0) the chunk grows 232.5 → 1690.7 ms
from depth 0 to 3100 (slope **466.5 ms per 1k context tokens**). With the same KV on HTP
(B, `-nkvo 0`) it stays 183.6 → 219.4 ms (slope **12.0 ms/1k**). B/A is 1.27× at depth 0,
2.32× at 512, 4.35× at 1.7k, 7.71× at 3.1k. The shipping app config (C, V q4_0, `-nkvo 1`)
is slowest at depth and ends at 2005 ms (slope 570.8 ms/1k, B/C 9.14× at 3.1k).

**Arm B did not abort or hang on v73** — the stated contingency — it completed every stage
including the route proof and the profiled repeat. Absolute speeds are the lowest of the three
devices (B 697 tok/s at depth 0 vs 1384 on v79 / 777 on v75; A 550 vs 1149 / 603), and v73's
host-KV slope (467–571 ms/1k) is ~1.8× the v75 one (319–343) and v79's (248–313), so the
context-growth problem is worst exactly on the phone class the app targets first.

## Setup

- Session: one `--dry-run --stage all` at 05:06:10 UTC (**EXIT 0**, `raw/s23-v73/dry-run-stdout.log`),
  then the real `--stage all` 05:06:22 → 05:18:51 UTC (12.5 min vs the driver's 27-minute
  estimate; `raw/s23-v73/run-stdout.log`, `session-events.log`).
- Pre-run: Kalsa (`com.kalsa.app`, pid 13674, model warm from the phase-1 session) was
  force-stopped before staging so it released HTP/RAM; app and data left installed and
  untouched. Phone unplugged, battery 67 % (36.8 °C), Thermal Status 0,
  `persist.traced.enable=0`, screen awake, ~21.5 GB free on /data.
- Driver gates on every llama-bench call (all held, no pause): not charging (dumpsys fields),
  battery ≥ 25 %, battery temp < 44 °C, Thermal Status < 3, awake (only `input keyevent 224`
  ever sent), `traced==0` (SM-S911x rule). Per arm: short verbose route-proof run, then the
  clean timing run, ≥ 120 s cool-down between arms; `STAGE_SHAS_OK` at 05:07:36 (all four
  device-side shas re-verified against `SHA256SUMS`).
- Matrix: `llama-bench -ngl 99 -dev HTP0 -p 128 -n 0 -b 128 -ub 128 -t 5 -fa auto --no-warmup
  -d 0,512,1700,3100 -r 3`; A = `-ctk q8_0 -ctv q8_0 -nkvo 1`, B = `-nkvo 0`, C = `-ctk q8_0
  -ctv q4_0 -nkvo 1`; profiled repeats of A and B at depth 1700
  (`GGML_HEXAGON_PROFILE=1 GGML_SCHED_DEBUG=2`). Known benign `error 0x14` single-session URI
  fallback appears in all route logs (`raw/s23-v73/logs/A-nkvo-route.excerpt.txt`), as on v75/v79.

## Results: clean timing (driver-gated, no logging), n = 3 reps per cell

ms/chunk = 128000 / tok/s, sd carried over proportionally.
Source: `raw/s23-v73/tables.txt` and `bench.tsv`; raw logs `logs/<arm>-clean.log`.

| arm | depth | pp128 tok/s ± sd | ms / 128-tok chunk ± sd | raw file |
|---|---:|---:|---:|---|
| A nkvo=1 q8/q8 | 0 | 550.49 ± 56.24 | 232.5 ± 23.8 | A-nkvo-clean.log |
| A | 512 | 296.02 ± 46.06 | 432.4 ± 67.3 | 〃 |
| A | 1700 | 145.03 ± 0.20 | 882.6 ± 1.2 | 〃 |
| A | 3100 | 75.71 ± 0.08 | 1690.7 ± 1.8 | 〃 |
| B nkvo=0 q8/q8 | 0 | 697.31 ± 29.39 | 183.6 ± 7.7 | B-offload-clean.log |
| B | 512 | 685.61 ± 10.94 | 186.7 ± 3.0 | 〃 |
| B | 1700 | 630.28 ± 3.78 | 203.1 ± 1.2 | 〃 |
| B | 3100 | 583.41 ± 2.53 | 219.4 ± 1.0 | 〃 |
| C nkvo=1 q8/q4 (app) | 0 | 558.96 ± 74.28 | 229.0 ± 30.4 | C-app-vq4-clean.log |
| C | 512 | 297.08 ± 10.17 | 430.9 ± 14.7 | 〃 |
| C | 1700 | 131.98 ± 0.25 | 969.8 ± 1.8 | 〃 |
| C | 3100 | 63.84 ± 1.94 | 2005.0 ± 60.9 | 〃 |

| depth | B/A tok/s | C/A tok/s | B/C tok/s |
|---:|---:|---:|---:|
| 0 | 1.27 | 1.02 | 1.25 |
| 512 | 2.32 | 1.00 | 2.31 |
| 1700 | 4.35 | 0.91 | 4.78 |
| 3100 | 7.71 | 0.84 | 9.14 |

**Slope of ms/chunk vs depth** (OLS over the 4 depths; source `tables.txt`):

| arm | ms per 1k context tokens | intercept ms |
|---|---:|---:|
| A | 466.5 | 190.1 |
| B | **12.0** | 182.3 |
| C | 570.8 | 150.7 |

B flattens the growth by ~39× against A and ~48× against C. As on v75/v79, A's and C's
depth-0 cells are the noisy ones (±56/±74 tok/s), so the depth-0 B/A ratio is weak; from
depth 512 up the spreads are small. C is again slower than A at every depth ≥ 1700 (q4_0 V
on the CPU path costs more), B/C 9.14× at 3.1k — the largest B/C of the three devices.

## Route proofs

The driver gate (`HTP0 model buffer size` + `HTP0 execute-op` + `libggml-htp-v73.so` + the
arm's KV buffer line) passed on all five verbose runs. Evidence:
`raw/s23-v73/logs/<arm>-route.excerpt.txt` (full logs off-repo, see Files).

- All arms: `load_tensors: HTP0 model buffer size = 1525.87 MiB`;
  `Hexagon Arch version v73, DMA64 disabled`; session uri `file:///libggml-htp-v73.so…`.
  Route-run execute-op line counts: A 425, B 515, C 425 (profiled runs: A 6346, B 7388).
- **KV placement**: A and C `llama_kv_cache: CPU KV buffer size` (2.12 MiB q8/q8, 1.62 MiB
  q8/q4); B `llama_kv_cache: HTP0 KV buffer size = 2.12 MiB`.
- **Scheduler placement** (`GGML_SCHED_DEBUG=2`, depth 1700; `profile-summary-A.txt` /
  `profile-summary-B.txt`):
  - A: FLASH_ATTN 128 nodes on **CPU**, plus CPY 704, SET_ROWS 256, SCALE 352, GET_ROWS 720
    on CPU (32 GET_ROWS on HTP).
  - B: FLASH_ATTN 128, CPY 704, SET_ROWS 256, SCALE 352, GET_ROWS 736 nodes all on **HTP0**;
    only 16 GET_ROWS on CPU.
  - Every MUL_MAT / RMS_NORM / SSM_CONV / SWIGLU node is on HTP0 in both arms; no node is
    placed on OpenCL (the kit binary registers the Adreno 740 backend but the scheduler
    assigns it nothing under `-dev HTP0`).
- HTP execute counts (`*-profile-placement.txt`): FLASH_ATTN_EXT 120, SET_ROWS 240, CPY 330,
  SCALE 22 executions on HTP in B; none of these ops appear on HTP in A.

## Per-op HTP profile (`GGML_HEXAGON_PROFILE=1`, depth 1700, r = 1)

Whole run = the 1700-token fill (14 ubatches) plus the timed chunk (15 ubatches × 8 attention
layers = 120 FLASH_ATTN_EXT calls). Source: `profile-summary-A.txt` / `profile-summary-B.txt`;
shares exclude `OPBATCH` (A 2.39 s, B 2.71 s — same batch-wrapper overlap reading as the
previous two reports, unverified in source).

| op on HTP | A µs | B µs | B share |
|---|---:|---:|---:|
| MUL_MAT + MUL_MAT_NX | 1647520 | 1648511 | 64.4 % |
| FLASH_ATTN_EXT | — (CPU) | 293542 | 11.5 % |
| SWIGLU | 284082 | 282205 | 11.0 % |
| ADD + MUL + SSM_CONV + CONCAT + ROPE | 291750 | 290775 | 11.4 % |
| CPY + SET_ROWS + GET_ROWS + SCALE | 601 | 44357 | 1.7 % |
| total excl. OPBATCH | 2223955 | 2559390 | |

Reading: the HTP work common to both arms matches within 0.1 % (MUL_MAT+N). Moving attention
onto HTP adds ~338 ms of HTP time over 15 ubatches (~22.5 ms/ubatch: 2.45 ms per
FLASH_ATTN_EXT call plus ~3 ms CPY/SET_ROWS) and removes the CPU attention path that costs
~679 ms per chunk at 1.7k (A 882.6 vs B 203.1, clean). v73 HTP FLASH_ATTN_EXT is the slowest
per call of the three devices (2.45 ms vs 2.2 on v75, 1.3 on v79), which is why B's depth-0
advantage is small (1.27×) — but it stays flat while the CPU path grows linearly. Under
profiling both arms slow down (A 140.9 tok/s, B 410.0 at d1700 vs clean 145.0 / 630.3);
profile rows never enter the TSV.

## Thermal, battery per arm

From the driver's 10 s SNAPs inside each arm's route-start → clean-end window
(`session-events.log`); aggregated in `tables.txt`. cpu7 freq was **not** sampled this run
(no host-side sampler — the gap is visible as `-` in `tables.txt`; skin_C is empty in the
driver's SNAPs on this device, so battery temp is the thermal proxy).

| arm | wall s | battery % | battery °C | thermal status |
|---|---:|---|---|---|
| A | 63 | 66–67 | 36.5–38.8 | 0–1 |
| B | 32 | 66 | 36.2–36.5 | 0 |
| C | 63 | 65–66 | 35.3–37.4 | 0–1 |

Battery 67 → 65 % over the run (plus staging), unplugged throughout; battery temp peaked
38.8 °C; Thermal Status never exceeded 1 during any arm (post-run snapshot 1); no gate ever
paused or stopped the run. `bench.tsv` carries `thermal_before/after` per row.

## Comparison with the in-app numbers (phase 1, same phone, same night)

The app's in-app NPU prefill runs with KV on host — arm C-like (C is the shipping KV type;
the app also prefills in 512-token chunks, not the bench's 128-token ubatch). From
`s23-layers-device-proof/REPORT.md` (46/46 chunks HTP0-proven): short prompt
(`prompt_n` 1735 ≈ bench depth 1700) **173.9–178.2 tok/s**; long (`prompt_n` 3145 ≈ depth
3100) **119.6–120.8 tok/s**.

- At ~1.7k context the in-app path is **1.2–1.35× faster than the bench's host-KV arms**
  (A 145.0, C 132.0): the app's 512-token chunks amortise the fixed per-dispatch cost the
  bench pays every 128 tokens. The same ordering held inside the app itself — its all-128
  regime ran ~9–10 % slower than 512-chunks in the governor campaign.
- At ~3.1k the gap widens: in-app 119.6–120.8 vs bench A 75.7 / C 63.8 (**1.6–1.9×**) —
  the bench's smaller chunks pay more of the growing host-KV attention cost per token.
- The direction and the magnitude class agree: both pipelines put host-KV NPU prefill in the
  tens-to-low-hundreds tok/s at multi-k context with a strongly growing per-chunk cost, while
  arm B on the same silicon holds 583–630 tok/s at the same depths. **That is the size of the
  prize: KV offload (B) would make in-app NPU prefill ~3.5–5× faster at the app's working
  depths** — 630.3 vs 174–178 at 1.7k, 583.4 vs ~120 at 3.1k — provided the app moves to
  V q8_0 (more KV memory) or a q4_0-capable HTP SET_ROWS, and provided B's numerics are
  gated (still unchecked, as on v79/v75).

## Caveats (do not skip)

1. **Single session, n = 3 per cell**, one pass; A/C depth-0 cells are noisy (±56/±74 tok/s),
   depth-0 B/A weak — same caveat as both earlier reports.
2. **B's numerical correctness is NOT checked** (no KLD/perplexity gate) — unchanged gap.
3. **B is not the app's config**: V q4_0 cannot be written by HTP SET_ROWS; shipping B means
   V q8_0 or a q4_0 SET_ROWS on HTP.
4. cpu7 max-freq sampling was skipped (no `samples.log`); the v75 report's MIUI-cap caveat has
   no equivalent reading here. Samsung Thermal Status stayed 0–1 and battery temp ≤ 38.8 °C.
5. `-t 5` threads is a fixed matrix choice; the app's thread count differs and moves A/C.
6. OpenCL is loaded but unused under `-dev HTP0` (verified: zero nodes placed there).

## End-state checks (owner rules)

- `/data/local/tmp/htp-kv-attention`: **gone** — driver `CLEANUP` verified by `ls`
  (`raw/s23-v73/cleanup.txt`: `No such file or directory`, the same success signature as the
  v75 run).
- Kalsa relaunched after the run and in the foreground (`topResumedActivity=
  com.kalsa.app/.MainActivity`), screen `mWakefulness=Awake`, keyguard down, unplugged,
  Thermal Status ≤ 2, `persist.traced.enable=0`, bench keys untouched from phase 1
  (`raw/s23-v73/end-state.txt`).

## Files

`raw/s23-v73/`: `bench.tsv` (12 clean rows), `tables.txt` (clean/ratios/slopes/per-arm state;
generated with `make_tables.py` parsers via a local wrapper because the S23 SNAPs carry empty
`skin_C` — no shared-file change), `session-events.log`, `run-stdout.log`,
`dry-run-stdout.log` (the EXIT-0 dry run), `remote-listing.txt`, `cleanup.txt`,
`profile-summary-A.txt`, `profile-summary-B.txt`, `logs/` (three clean logs, two
profile-placement summaries, three route excerpts, two profile excerpts). Full verbose logs
(2 profile ~10.6/11.0 MB, 3 route ~1.7–2.0 MB) kept off-repo on the Mac at
`~/kalsa-qdc/htp-kv-s23-v73-full/logs/`.
