# HTP prefill vs `no_kv_offload` — Xiaomi 14 (Snapdragon 8 Gen 3, Hexagon v75), 2026-10-01

**Device caveat: this is the owner's personal daily-driver phone (23127PN0CG, SM8650, PIN-locked), run once, gated,
unplugged, under the `--personal-device` guard.** It repeats the QDC 8 Elite (v79) measurement of
`REPORT-qdc-8elite.md` on the Hexagon the app will actually meet on this phone class. Nothing here is a second run;
n = 3 reps per cell in a single session.

## Answer

**Yes — on v75 the host-side KV cache (`-nkvo 1`, attention pinned to the CPU) is what makes an HTP 128-token
prefill chunk slow down with context, and the effect is stronger at the top end than on the 8 Elite.** With KV on
host (A, q8_0/q8_0) the chunk grows 212 → 1275 ms from depth 0 to 3100 (slope **342.6 ms per 1k context tokens**).
With the same KV on HTP (B, `-nkvo 0`) it stays 165 → 194 ms (slope **9.4 ms/1k**). B/A is 1.29× at depth 0,
2.09× at 512, 3.97× at 1.7k, 6.57× at 3.1k. The shipping app config (C, V q4_0, `-nkvo 1`) is slowest of all at
low depth and ends at 1241 ms (slope 319.4 ms/1k, B/C 6.39× at 3.1k). Arm B did not abort or hang on v75 — it
completed every stage including the route proof and the profiled repeat.

Absolute speeds on this phone are roughly half the QRD's (B 777 tok/s at depth 0 vs 1384 on v79; A 603 vs 1149),
so the context-growth problem the app sees on 8 Gen 3 is worse in both directions: every chunk starts ~2× more
expensive, then grows at a similar slope.

## Setup

- Xiaomi 14 over WiFi adb (`192.168.1.193:35051`), `--serial` target, `--personal-device` guard on every command,
  `-dsp-arch v75`. Unplugged the whole time; screen kept awake (MIUI `screen_off_timeout` = 86400000 ms = 24 h,
  verified before the run; the only wake key the driver may send is `input keyevent 224`, and it never fired).
- Session: one `--stage all` invocation 04:02:33 → 04:14:24 UTC (11.9 min: staging 59 s incl. the 1.7 GB pushes
  and on-device sha check, then route+clean per arm, 120 s cool-downs, two profiled repeats, pull, cleanup).
  A first invocation at 04:00:58 was refused by the /data free-space gate before anything was pushed — MIUI names
  the mount `/data/user/0` (fix below). The driver had estimated 27 device-minutes; actual was 12.
- Kit `~/kalsa-qdc/kit-5b596ce43` (engine kalsallama 5b596ce43): `bin/llama-bench`, `lib/libggml-htp-v75.so`,
  model LFM2.5-2.6B-QAD-Q4_0.gguf (sha `a247afd6…8d40b03`). All four device-side shas re-verified by the driver
  against `SHA256SUMS` (`STAGE_SHAS_OK` in `session-events.log`).
- Matrix identical to the QDC run: `llama-bench -ngl 99 -dev HTP0 -p 128 -n 0 -b 128 -ub 128 -t 5 -fa auto
  --no-warmup -d 0,512,1700,3100 -r 3`, A = `-ctk q8_0 -ctv q8_0 -nkvo 1`, B = `-nkvo 0`, C = `-ctk q8_0 -ctv
  q4_0 -nkvo 1`; profiled repeats of A and B at depth 1700 (`GGML_HEXAGON_PROFILE=1 GGML_SCHED_DEBUG=2`).

## Results: clean timing (driver-gated, no logging), n = 3 reps per cell

ms/chunk = 128000 / tok/s, sd carried over proportionally.
Source: `raw/xiaomi-v75/tables.txt` and `bench.tsv`; raw logs `logs/<arm>-clean.log`.

| arm | depth | pp128 tok/s ± sd | ms / 128-tok chunk ± sd | raw file |
|---|---:|---:|---:|---|
| A nkvo=1 q8/q8 | 0 | 603.47 ± 164.73 | 212.1 ± 57.9 | A-nkvo-clean.log |
| A | 512 | 361.63 ± 13.34 | 354.0 ± 13.1 | 〃 |
| A | 1700 | 178.70 ± 0.15 | 716.3 ± 0.6 | 〃 |
| A | 3100 | 100.39 ± 0.13 | 1275.0 ± 1.7 | 〃 |
| B nkvo=0 q8/q8 | 0 | 776.85 ± 61.97 | 164.8 ± 13.1 | B-offload-clean.log |
| B | 512 | 754.07 ± 8.88 | 169.7 ± 2.0 | 〃 |
| B | 1700 | 709.85 ± 2.13 | 180.3 ± 0.5 | 〃 |
| B | 3100 | 659.35 ± 3.03 | 194.1 ± 0.9 | 〃 |
| C nkvo=1 q8/q4 (app) | 0 | 473.83 ± 19.97 | 270.1 ± 11.4 | C-app-vq4-clean.log |
| C | 512 | 345.34 ± 21.14 | 370.6 ± 22.7 | 〃 |
| C | 1700 | 167.32 ± 0.52 | 765.0 ± 2.4 | 〃 |
| C | 3100 | 103.11 ± 0.11 | 1241.4 ± 1.3 | 〃 |

| depth | B/A tok/s | C/A tok/s | B/C tok/s |
|---:|---:|---:|---:|
| 0 | 1.29 | 0.79 | 1.64 |
| 512 | 2.09 | 0.95 | 2.18 |
| 1700 | 3.97 | 0.94 | 4.24 |
| 3100 | 6.57 | 1.03 | 6.39 |

**Slope of ms/chunk vs depth** (OLS over the 4 depths; source `tables.txt`):

| arm | ms per 1k context tokens | intercept ms |
|---|---:|---:|
| A | 342.6 | 184.4 |
| B | **9.4** | 164.7 |
| C | 319.4 | 237.6 |

B flattens the growth by ~36× against A and ~34× against C. C's slope (0.32 ms per context token) again lands near
the in-app slope quoted in PLAN.md (+0.41 ms/token, different device and pipeline). Two v75-specific readings:
at depth 0 B is only 1.29× faster than A (the HTP attention path has a higher fixed cost here), and A's depth-0
cell is noisy (±165 tok/s), so the depth-0 B/A ratio is weak — same caveat as the QDC run.

## Route proofs

The driver gate (`HTP0 model buffer size` + `HTP0 execute-op` + `libggml-htp-v75.so` + the arm's KV buffer line)
passed on all five verbose runs. Evidence: `raw/xiaomi-v75/logs/<arm>.excerpt.txt`,
`<arm>-profile.excerpt.txt` (full logs kept off-repo, see Files).

- All arms: `load_tensors: HTP0 model buffer size = 1525.87 MiB` (CPU 205.08 MiB = token embeddings);
  `Hexagon Arch version v75, DMA64 disabled`; HTP session uri `file:///libggml-htp-v75.so`.
  Route-run execute-op line counts: A 425, B 515, C 425 (profiled runs: A 6346, B 7388).
- **KV placement**: A and C `llama_kv_cache: CPU KV buffer size` (2.12 MiB for q8/q8, 1.62 MiB for C's q8/q4);
  B `llama_kv_cache: HTP0 KV buffer size = 2.12 MiB`.
- **Scheduler placement** (`GGML_SCHED_DEBUG=2`, depth 1700; `profile-summary.txt`):
  - A: FLASH_ATTN 128 nodes on **CPU**, plus CPY 704, SET_ROWS 256, SCALE 352, GET_ROWS 720 on CPU.
  - B: FLASH_ATTN 128, CPY 704, SET_ROWS 256, SCALE 352, GET_ROWS 736 nodes all on **HTP0**; only 16 GET_ROWS
    on CPU.
  - Every MUL_MAT / RMS_NORM / SSM_CONV / SWIGLU node is on HTP0 in both arms; **no node is placed on OpenCL**
    (the kit binary registers the Adreno 750 backend but the scheduler assigns it nothing under `-dev HTP0`).
- HTP execute counts (`*-profile-placement.txt`): FLASH_ATTN_EXT 120, SET_ROWS 240, CPY 330, SCALE 22 executions
  on HTP in B; none of these ops appear on HTP in A.

## Per-op HTP profile (`GGML_HEXAGON_PROFILE=1`, depth 1700, r = 1)

Whole run = the 1700-token fill (14 ubatches) plus the timed chunk (15 ubatches × 8 attention layers = 120
FLASH_ATTN_EXT calls). Source: `profile-summary.txt`; shares exclude `OPBATCH` (A 2.10 s, B 2.40 s — the same
batch-wrapper overlap reading as the QDC report, unverified in source).

| op on HTP | A µs | B µs | B share |
|---|---:|---:|---:|
| MUL_MAT + MUL_MAT_NX | 1400788 | 1414631 | 62.3 % |
| FLASH_ATTN_EXT | — (CPU) | 262142 | 11.5 % |
| SWIGLU | 312903 | 313217 | 13.8 % |
| ADD + MUL + SSM_CONV + CONCAT + ROPE | 245316 | 247361 | 10.9 % |
| CPY + SET_ROWS + GET_ROWS + SCALE | 517 | 34663 | 1.5 % |
| total excl. OPBATCH | 1959524 | 2272014 | |

Reading: the HTP work common to both arms matches within 1 % (MUL_MAT+N). Moving attention onto HTP adds 312 ms
of HTP time over 15 ubatches (~21 ms/ubatch: 17.5 ms FLASH_ATTN_EXT at 2.2 ms per call, ~2.3 ms of CPY/SET_ROWS)
and removes the CPU attention path that costs ~536 ms per chunk at 1.7k (A 716 vs B 180, clean). HTP
FLASH_ATTN_EXT is slower per call on v75 than the v79 measurement (2.2 ms vs 1.3 ms), which is why B's depth-0
advantage is small — but it stays flat while the CPU path grows linearly. Under profiling both arms slow down
(A 136.8 tok/s, B 373.6 at d1700 vs clean 178.7 / 709.9); profile rows never enter the TSV.

## Thermal, battery, cpu7 per arm

From the driver's gate snapshots (`session-events.log` SNAP lines, every 10 s during runs) and a 60 s host-side
sampler (`samples.log`: cpu7 `scaling_max_freq`/`scaling_cur_freq`, battery, Thermal Status). Full table in
`tables.txt`.

| arm | wall s | battery % | battery °C | thermal | skin °C | cpu7 max kHz before → after |
|---|---:|---|---|---|---|---|
| A | 53 | 71–72 | 30.9–32.2 | 0 | 32.1–36.8 | 2630400 → 2169600 |
| B | 33 | 71 | 31.9 | 0 | 32.5–33.7 | 2169600 → 2169600 |
| C | 53 | 70–71 | 30.7–32.3 | 0 | 31.3–36.0 | 2630400 → 1939200 |

- Handover/preflight cpu7 max: 1939200 / 2169600; after cleanup 2630400. Observed range all session:
  1939200–2630400 kHz against a 3302400 ceiling — **MIUI kept the prime core capped the whole time while Android
  Thermal Status read 0 in every single probe** (the Xiaomi caveat: thermal status 0 does not mean uncapped).
  Battery temp stayed 30.7–32.8 °C, level 72 → 69 %, unplugged; no gate ever paused or stopped the run.

## Caveats (do not skip)

1. **v75, single session, owner's phone.** n = 3 per cell, one pass, no repeat of the session; A depth-0 has a
   large spread and makes the depth-0 B/A ratio weak. The S23 (v73) repeat is still the missing datapoint.
2. **B's numerical correctness is NOT checked** — same gap as the QDC run. HTP FLASH_ATTN_EXT on q8_0 KV needs a
   correctness gate (KLD/perplexity) before anyone ships it.
3. **B is not the app's config.** The app ships V q4_0 and HTP SET_ROWS cannot write q4_0; shipping B means V q8_0
   (more KV memory) or a q4_0 SET_ROWS on HTP.
4. **cpu7 capped by MIUI throughout** at 1.94–2.63 GHz (status 0): A and C (CPU attention, 5 threads) may be
   slower than on an uncapped 8 Gen 3. The A/B contrast is within-phone and stands; absolute A/C numbers carry
   this asterisk.
5. `-t 5` CPU threads is a fixed matrix choice; the app's thread count may differ and would move A and C.
6. The kit's llama-bench is built with OpenCL; with `-dev HTP0` the scheduler places zero nodes on the GPU
   (verified), so "OpenCL,HTP" in the table header is a loaded-backend string, not a routing fact.

## Driver fix made during the session (committed with this report)

- `run_bench.py` `free_space_error()`: the /data free-space gate required a `df -k /data` row whose mount point is
  exactly `/data`; MIUI lists the same dm-55 partition as `/data/user/0`, so the first invocation died at the gate
  before staging anything (`PERSONAL_CLEANUP rc=0`, nothing left). The parser now accepts `/data/user/0`, with
  `test_free_space.py` covering stock, MIUI, low-space, missing-row and wrong-mount cases (29 tests pass).

## End-state checks (owner rules)

- `/data/local/tmp/htp-kv-attention`: **gone** — driver `CLEANUP` + `PERSONAL_CLEANUP rc=0`; hand-verified
  `ls: No such file or directory` (`cleanup.txt`).
- Screen: `mWakefulness=Awake`, `mDreamingLockscreen=false` after the run — awake and **not locked**; the screen
  never slept (24 h timeout verified before the run; no POWER/SLEEP ever sent, no `settings put`).
- Foreground: `com.miui.home/.launcher.Launcher` — exactly the pre-run baseline (the launcher was already on top
  at pre-flight; the Paseo app `sh.paseo` pid 4098 stayed alive in recents the whole time and was never touched).
- Battery 69 %, 30.7 °C, unplugged, Thermal Status 0, /data free ~314 GB.

## Files

`raw/xiaomi-v75/`: `bench.tsv` (12 clean rows), `tables.txt` (clean/ratios/slopes/per-arm state),
`samples.log` (60 s cpu7/battery/thermal), `session-events.log` (all driver events incl. sha checks and SNAPs),
`dry-run-session-events.log` (the passing `--dry-run --stage all`), `profile-summary.txt` (per-op µs + scheduler
placement), `remote-listing.txt`, `cleanup.txt`, `logs/` (three clean logs, two placement summaries, five
excerpts). Full verbose logs (5 files, ~26 MB: three route, two profile) are kept off-repo on the Mac at
`~/kalsa-qdc/htp-kv-xiaomi-v75-full/logs/`.
