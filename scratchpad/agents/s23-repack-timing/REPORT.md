# S23 repack A/B: timing, faults, footprint, temperature, battery

Required fix #4 of `scratchpad/agents/repack-policy-review/REPORT.md`: run a rebuilt
target APK on the S23 with explicit repack-on and repack-off arms and record load
time, prefill/decode throughput, major faults, `RssAnon`/`RssFile`/`Mlocked`,
temperature and battery under controlled power conditions.

Status of the claim that motivated this: at the end of this run, **the repack cost of
the shipped Qwen default is still not measured on Qwen**: the gate refuses the
repack-on arm on this device, and the refusal is the result (see §6). The repack cost
IS measured on LFM 2.6B, which fits both ways, and that is where the price of the new
`repack:false` default can actually be read (§5). Nothing here is reported as measured
that was not measured.

Recon (harness, lever precedence, engine-mode readback, loaded-model proof) is in
`RECON.md` in this directory and is not repeated.

**Verdict up front (added after independent review): the new Qwen default is a
memory/fit necessity that costs speed, not a performance optimisation.** (a)
Qwen-with-repack is refused 3/3 on this device (`refusedBy=fit`,
`reasonKey=model.tightNow`) and Qwen-repack-off loads 3/3, which is the strongest
Qwen-specific result here. (b) On LFM 2.6B, the equal-fit proxy, repack OFF saves
about 1497 MiB of peak `RssAnon` and costs 2.6× prefill and 1.4× decode; that ratio is
safe to quote as an A/B ratio. (c) The Qwen-specific cost of repack is unmeasurable on
this device because the gate refuses it, so the estimator's Qwen repack term is
neither confirmed nor refuted. The absolute tok/s values (LFM 18/48, Qwen 10.4/3.95)
describe this device on this day, with one core consumed by the DSP daemons and about
2 GB of swap already in use, and must not be quoted as device capability. Reading
`repack:false` as a speed win is wrong.

---

## 1. What was run

### 1.1 APK identity

Built from this worktree (`s23-repack-timing-2026-09-21`, HEAD `964dd53`); see
`RECON.md` §3 for the full build record.

| item | value |
|---|---|
| build command | `npx expo prebuild --platform android --no-install`, then `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a` |
| wall time | 557 s total; gradle reported `BUILD SUCCESSFUL in 8m 42s` (764 tasks, 736 executed) |
| APK | `android/app/build/outputs/apk/release/app-release.apk`, 159 214 430 bytes |
| sha256 | `245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c` |
| engine id in APK (`assets/app.config`) | `kalsa-eng-v2:0d5c42479bfdfeb3207fc43a25484e5d046e389511a577fd889a008981d9c6b3` |
| `node scripts/engine-build-id.js` in the worktree | identical string |
| installed on device | `adb install -r`, success, `lastUpdateTime 2026-09-20 21:52:10`, versionCode 1 / versionName 0.1.0 |
| engine variant actually loaded | `rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl`, `nGpuLayers 0` |

Two build settings deviate from a bare `expo prebuild` and both match the project's
CI (`apk.yml`), which is what makes the artifact comparable to the shipped one:
the Hexagon SDK is disabled locally (the CI runner installs none, so the CI artifact
is CPU-only; Android production is CPU-only anyway), and the release build type is
made `debuggable true` because every measurement primitive goes through `run-as`.
The built engine carries `-DGGML_USE_CPU_REPACK`, so the ARM repack path is in the
binary.

### 1.2 Levers per arm

| arm | model (`kalsa.model.id`) | `kalsa.bench.norepack` | resulting `no_extra_bufts` | engine mode |
|---|---|---|---|---|
| **LFM-N** | `lfm2.5-2.6b` | `1` | `1` | repack OFF |
| **LFM-R** | `lfm2.5-2.6b` | `0` | `0` | repack forced ON |
| **QWEN-N** | `qwen3.5-4b` | `1` | `1` | repack OFF (the new shipped default) |
| **QWEN-R** | `qwen3.5-4b` | `0` | `0` | repack ON requested (see §6) |

`kalsa.bench.norepack` is tri-state; `=0` is the arm that lets a bench measure
repack-on on a model whose registry entry disables it (`loadPolicy.ts:20-24`,
`benchConfig.ts:518-536`). Every run also deletes `kalsa.bench.engine` and
`kalsa.bench.nctx`, writes `kalsa.context.compaction=0` + `.choice=1`,
`kalsa.bench.thinking=default`, `kalsa.memory.enabled=0`, `kalsa.locale=it`, and wipes
the conversation (`reset_chat`, copied verbatim from `ci-bench.sh:524`) so both arms
prefill the same prompt. Read-back assertions on `kalsa.model.id` and
`kalsa.bench.norepack` are in every run log (`prefs ok: …`).

### 1.3 Measurement method

- **Engine load wall time**: `KALSA_SESSION {"op":"init"}` (emitted just *before*
  `initLlama`, `LlamaService.ts:2429`) → native `RNLlama : loadModel:884 Context
  initialized`. Both are device-side logcat timestamps. This is model mmap + repack
  + context/KV init, excluding app launch and prefill.
- **Prefill / decode**: `KALSA_TELEMETRY` native timings; prefill tok/s =
  `prompt_n / prompt_ms × 1000`, decode tok/s = `predicted_per_second`.
- **Footprint / faults**: 3 s `/proc/<pid>/status` + `/proc/<pid>/stat` + `/proc/meminfo`
  sampler over the whole turn (peak values), plus the audited
  `capture_sysprobe_snapshot` pre/post.
- **Temperature / battery**: `dumpsys battery` at arm start and end; a cooling gate
  (start only when `temperature ≤ 40.5 °C`, the project's own floor is 39.0 °C resume /
  44.0 °C pause) parks the device between runs.
- **Power**: `AC powered / USB powered / Wireless powered` all checked `false` before
  every run; no run proceeded while charging.
- **Loaded model**: `run-as ls` + `/proc/<pid>/maps` GGUF VMA byte total, per arm (§4).
- **Contamination**: DSP daemon rate + loadavg + swap at arm start and end (§7).

Replicates: 3 per arm, 12 runs. Order per replicate cycle is N,R,N,R (rep 1, 3) and
R,N,R,N (rep 2), so a monotone thermal trend does not land on one arm.

Runner: `run-arm.sh` (this directory); schedule: `run-campaign.sh`; table rebuilt from
per-run artifacts by `backfill-rows.py`; summary by `summarize.py`. Raw evidence is in
`bench-out/<arm>/rep<N>/` (logcat, sysprobe, peak.csv, daemon probes, maps).
`bench-out/results.tsv` is the machine table.

---

## 2. Headline numbers (median [min–max] over 3 reps)

| metric | LFM-N (repack OFF) | LFM-R (repack ON) | QWEN-N (repack OFF) | QWEN-R (repack ON) |
|---|---|---|---|---|
| engine `no_extra_bufts` | 1 | 0 | 1 | 0 |
| load wall time (s) | 0.84 [0.72–0.89] | 3.65 [3.42–3.74] | 4.23 [4.16–25.3]¹ | 3.57 [3.52–12.9]² |
| prefill tok/s | 18.4 [18.1–22.1] | 47.7 [46.6–49.5] | 10.4 [9.96–10.91]³ | n/a² |
| decode tok/s | 9.88 [7.09–10.3] | 13.9 [13.4–14.0] | 3.95 [3.92–3.97]³ | n/a² |
| peak `RssAnon` (MiB) | 263 [262–267] | 1760 [1704–1771] | 1113 [993–1125] | 1752 [1735–1763]² |
| peak `RssFile` (MiB) | 1668 [1653–1675] | 1585 [1324–1589] | 2749 [2690–2749] | 1586 [1482–1605]² |
| `Mlocked` (MiB) | 0 | 0 | 0 | 0 |
| major faults during turn | 290 [289–566] | 1059 [996–5923] | 162 923 [53 980–191 885] | 1601 [586–8982]² |
| `MemAvailable` at arm start (MiB) | 3528 [3148–3641] | 2312 [2145–2364] | 3198 [3157–3409] | 2287 [2281–2318] |
| battery temp start → end (°C) | 40.4 → 41.7 | 40.4 → 42.3 | 40.3 → 42.7 | 40.5 → 41.5 |
| battery level start → end (%) | 68 → 67 | 70 → 69 | 74 → 71 | 76 → 75 |
| `adsprpcd` %CPU start → end | 111 → 113 | 112 → 114 | 111 → 116 | 112 → 114 |
| swap used start → end (MiB) | 1994 → 1952 | 1983 → 2223 | 1962 → 3332 | 2023 → 2184 |
| loaded model (maps, bytes) | LFM 1 585 659 904 | LFM 1 576 226 816 | Qwen 2 824 007 680 | **LFM 1 576 226 816** |
| completed turn | 3/3 | 3/3 | 2/3⁴ | 0/3 |
| fit-gate refusal | none | none | none | `fit` / `model.tightNow` 3/3 |

¹ 25.3 s in rep 1 is the LFM→Qwen model switch (cold file); reps 2–3 load the same
model from a warm page cache at 4.16 / 4.23 s.
² **QWEN-R never ran Qwen.** Its refusal is real, but the resident engine was LFM
2.6B, so every QWEN-R footprint/timing number above is LFM's. See §6.
³ QWEN-N rep 1 aborted before any token (see ⁴); the medians are over reps 2–3.
Qwen prefill uses the native **evaluated** token count (1885 in both reps), not the
app's `prompt_n` (1988 / 1976), which also counts prefix-cached tokens; on `prompt_n`
the figure would read 11.0 [10.5–11.4], about 5 % high, which overstates throughput.
LFM is unaffected (`prompt_n` = evaluated = 1853).
⁴ QWEN-N rep 1 hit the app's own prefill deadline: `KALSA_STALL {"reason":"prefill",
"tokens":0,"tokPerSec":null}`; the abort is a result, recorded in §6.

### Per-rep detail

```
LFM-N  rep1 mode=1 load=0.839s prefill=18.1 t/s decode= 9.88 t/s anon= 263MiB file=1653MiB majflt=   289 comp=1
LFM-N  rep2 mode=1 load=0.885s prefill=22.1 t/s decode=10.34 t/s anon= 267MiB file=1675MiB majflt=   566 comp=1
LFM-N  rep3 mode=1 load=0.719s prefill=18.4 t/s decode= 7.09 t/s anon= 262MiB file=1668MiB majflt=   290 comp=1
LFM-R  rep1 mode=0 load=3.737s prefill=49.5 t/s decode=13.39 t/s anon=1771MiB file=1324MiB majflt=   996 comp=1
LFM-R  rep2 mode=0 load=3.646s prefill=46.6 t/s decode=13.91 t/s anon=1704MiB file=1589MiB majflt=  5923 comp=1
LFM-R  rep3 mode=0 load=3.425s prefill=47.7 t/s decode=13.99 t/s anon=1760MiB file=1585MiB majflt=  1059 comp=1
QWEN-N rep1 mode=1 load=25.301s prefill=  NA    decode=  NA   anon=1125MiB file=2690MiB majflt=191885 comp=0  (prefill deadline)
QWEN-N rep2 mode=1 load= 4.164s prefill= 9.96t/s decode= 3.97 t/s anon=1113MiB file=2749MiB majflt= 53980 comp=1
QWEN-N rep3 mode=1 load= 4.231s prefill=10.91t/s decode= 3.92 t/s anon= 993MiB file=2749MiB majflt=162923 comp=1
QWEN-R rep1 mode=0 load= 3.567s REFUSED fit/model.tightNow  anon=1735MiB file=1605MiB comp=0
QWEN-R rep2 mode=0 load=12.882s REFUSED fit/model.tightNow  anon=1763MiB file=1482MiB comp=0
QWEN-R rep3 mode=0 load= 3.519s REFUSED fit/model.tightNow  anon=1752MiB file=1586MiB comp=0
```

Qwen prefill in this block is on evaluated tokens (1885 in both reps); on `prompt_n`
(1988 / 1976) it would read 10.50 / 11.44 t/s, about 5 % high.

---

## 3. What the LFM pair prices (the equal-fit A/B)

LFM 2.6B fits with and without the repack copy, so this pair is where the price of the
new `repack:false` default is actually measurable, with the same model, the same
reset prompt (`prompt_n 1853` in all six runs), the same levers except `norepack`,
matched start temperatures (40.4 °C both) and interleaved order.

- **Load time**: repack ON costs **+2.8 s** (0.84 → 3.65 s, 4.4× the repack-off load).
  The repack pass reads and rewrites the weights during load.
- **Anonymous footprint**: repack ON raises peak `RssAnon` by **~1497 MiB**
  (263 → 1760 MiB), i.e. the second buffer. Against the estimator's
  `0.8951 × file` = 1423 MiB for this 1.59 GB file, the estimate is close on LFM.
- **File-backed footprint**: repack ON *lowers* peak `RssFile` by ~83 MiB median
  (1668 → 1585 MiB; min 1324): weight pages migrate from page cache to the anonymous
  repack buffer.
- **`MemAvailable` at arm start**: **1217 MiB lower** with repack ON (3528 → 2312 MiB).
  Part of that gap is carried-over device state, not the repack buffer: the arms do not
  start from a matched memory baseline (no drop-caches or reboot between runs) and the
  gap tracks the repack flag whichever arm ran first. What is defensible is the
  decision-instant comparison the gate itself makes: `send_fit.availableMb` 2440 for
  the refused repack attempt vs 3247 for Qwen-off. The 1217 MiB is a start-of-arm
  difference, not a measured allocation.
- **Prefill**: repack ON is **2.6× faster** (18.4 → 47.7 tok/s); ranges do not overlap.
- **Decode**: repack ON is **1.41× faster** (9.88 → 13.9 tok/s). The ranges are
  disjoint here too (LFM-N max 10.35 < LFM-R min 13.39), so the median understates
  nothing.
- **Major faults**: ~3.7× more with repack ON (290 → 1059).
- **Swap**: only the repack-on arm pushes swap up within the run (+254 MiB median,
  minimum +241; per rep +282 / +241 / +254), consistent with a new ~1.5 GB anonymous
  buffer under a kernel that has already swapped out ~2 GB.

Direction of the trade is therefore unambiguous on LFM: **turn repack off and you
save ~1.5 GiB of anonymous RSS and ~1217 MiB of `MemAvailable`, and you pay roughly
2.6× on prefill and 1.4× on decode.** That is the cost the Qwen entry now takes on
the models it applies to. It is measured here on LFM, not on Qwen.

---

## 4. Loaded-model ground truth (why every arm carries it)

`/proc/<pid>/maps` GGUF VMA byte totals, per run:

| arm | mapped file | mapped bytes |
|---|---|---|
| LFM-N ×3 | `…/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf` | 1 585 659 904 |
| LFM-R ×3 | same LFM file | 1 576 226 816 |
| QWEN-N ×3 | `…/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf` | 2 824 007 680 |
| QWEN-R ×3 | **same LFM file** | **1 576 226 816** |

The LFM file is 1 593 894 944 bytes and the Qwen file 2 834 975 040, so the mapping
identifies the model without ambiguity. Note also that the LFM map is *smaller* under
repack ON (1 576 226 816 vs 1 585 659 904, −9.4 MB): the load path is observably
different, not just differently flagged. This check is what caught §6; without it,
QWEN-R's numbers would have been published as Qwen's.

---

## 5. Refusals and aborts hit

**QWEN-R: the fit gate refused Qwen-with-repack in all 3 reps**, verbatim:

```
KALSA_LOAD {"phase":"fitGate","modelId":"qwen3.5-4b","refusedBy":"fit","reasonKey":"model.tightNow","disposedResident":false,"source":"ensure"}
```

(`reasonKey: "model.tightNow"` is the 1.5× rule at `deviceProfile.ts:483-486`.)
This is the outcome `REPORT.md` §2.3 predicted: with the repack term priced, the
admission needs ≥ 5177 MiB against a device whose **MemTotal is 7 243 748 kB
(6.91 GiB)**. The same-model repack-on timing for Qwen is therefore **not obtainable
on this device**, and this campaign does not obtain it.

**After the refusal the app did not load Qwen; it loaded LFM 2.6B** with
`no_extra_bufts=0`. Sequence from `bench-out/QWEN-R/rep1/logcat.txt`:

```
1789958581.948  KALSA_LOAD {"phase":"fitGate","modelId":"qwen3.5-4b","refusedBy":"fit","reasonKey":"model.tightNow",…,"source":"ensure"}
1789958582.014  KALSA_SESSION {"op":"init","no_extra_bufts":0}
1789958582.206  llama_model_loader: … from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0…
1789958585.581  RNLlama : loadModel:884 Context initialized with n_seq_max = 1
```

while `kalsa.model.id` on the device still read `qwen3.5-4b`. Two facts follow, and
both belong in the record:

1. The gate refused *and* an engine init with `no_extra_bufts=0` still appears in the
   same run; we do not claim which path won; both lines are reported. That init is
   the LFM load that follows 192 ms later (the QWEN-R `load_wall_s` values, 3.52–3.57 s
   in reps 1 and 3, match LFM's repack-on load times, not Qwen's), and the LFM map is
   the one in `/proc` at the end of the run.
2. The QWEN-R arm is a **Qwen fit refusal plus an LFM fallback**, not a Qwen
   repack-on measurement. Its footprint numbers are LFM's and are labelled so
   throughout. The task's warning about a "qwen" configuration that measured LFM is
   exactly this failure mode, and the maps check is what exposed it.

**QWEN-N rep 1: the app's own prefill deadline aborted the first turn**:

```
KALSA_STALL {"gapMs":0,"tokens":0,"turnId":"1","reason":"prefill","tokPerSec":null}
'KALSA_PREWARM' '{"op":"skip","reason":"eval-failed",…,"promptMs":116362.126,"promptN":1858,…}'
```

The static-prefix prewarm and the send's prefill contend for the same engine, and the
send's deadline (floor 180 s, `prefillDeadline.ts:2`) expires before a first token.
Reps 2 and 3 completed normally (the prewarm was warm), so Qwen's prefill/decode
medians are over 2 of 3 reps. This is a real first-turn behaviour of the shipping
default on this device: **a cold first send on Qwen can be aborted by the app's own
prefill watchdog.**

---

## 6. Environment contamination record (required addendum)

A contributor that is not ours burns CPU on the test device throughout every arm.

- **The process is `adsprpcd`** (pid 2251, user `system`): the Qualcomm ADSP RPC
  daemon. `top -b -n 1` names it as the top consumer; `dumpsys`/`top` show it alone in
  the 55–75 % single-snapshot band on an 800 %-scale (≈0.6–1.2 cores), and the
  two-point tick delta over 5 s measures **107–123 % of one core for the whole
  campaign**. It was already spinning before this campaign: its lifetime CPU at the
  first probe was `1058:34` (17 h 37 m), and the independent check during the run
  reported the same pid and pressure.
- **`cdsprpcd` (pid 2252) and `audioadsprpcd` (pid 955) measured 0.0 %** in every arm.
  So the ~100 % belongs to `adsprpcd`, not to the compute-DSP or audio DSP daemons.
- `/proc/loadavg` ran 1.3–3.4 at arm start and 5.0–9.1 at arm end.
- **Swap**: `SwapTotal 4 194 300 kB`; **~2.0 GB already used at every arm start**, and
  the Qwen arms push it to 3.2–3.5 GB. QWEN-N went 1962 → 3332 MiB within a single
  run; QWEN-N rep 3 reached 3539 MiB.

Nothing was killed or stopped; the contamination is recorded, per instruction.

### What this invalidates, and what it does not. We agree with the reading, with data

- **Proposed: the constant background is present in every arm, so an A/B difference
  remains valid.** Confirmed by the record: `adsprpcd` sits at 111–116 % in all four
  arms (start and end), `cdsprpcd`/`audioadsprpcd` at 0 %, and the arms are
  interleaved. The LFM-N vs LFM-R comparison (§3) is the pair we consider
  **comparable**, and the QWEN-N reps 2–3 to each other are comparable as a baseline.
- **Proposed: absolute tok/s and thermal headroom do not generalise to a quiet
  device.** Confirmed as a caveat: one core is gone, prefill and decode are running on
  a SoC that is simultaneously faulting roughly 290–190 000 majors and swapping, and
  start temperatures could only be held to ≈40.3–40.5 °C, not the project's cooler
  39.0 °C floor, because the daemon keeps the phone warm between arms. Absolute
  numbers therefore describe *this device, on this day, with this background*.
- **Energy and sustained-performance claims are unsafe.** We make none. Battery
  level moved 1–3 points per ~2–7 min arm; that is not a usable energy measurement
  and is reported only as the power-condition record.
- **Memory claims are conditional on ~2 GB of already-used swap.** `MemAvailable` and
  the peak-`RssAnon` numbers sit on top of a kernel that has already evicted ~2 GB of
  anonymous memory, and both Qwen arms push swap higher during the run. Peak
  `RssAnon` is therefore a peak *committed* anonymous figure, not a guaranteed
  resident one.
- **`Mlocked` is 0 kB in every sample of every arm.** This is a measured zero, not a
  missing value: `use_mlock=true` is requested, but retail Android caps
  `RLIMIT_MEMLOCK` far below a multi-GB model, so mlock cannot hold the weights. No
  arm's residency claim rests on mlock.

---

## 7. MEASURED vs OBSERVED-FUNCTIONAL

**Measured on device (this APK, this campaign):**

- LFM 2.6B repack-on vs repack-off A/B: load time, prefill and decode tok/s, peak
  `RssAnon`/`RssFile`/`Mlocked`, major faults, `MemAvailable` before/after,
  temperature and battery, engine-internal `no_extra_bufts`, and the loaded model,
  3 reps per arm (§2, §3).
- Qwen 3.5 4B with `no_extra_bufts=1`: load time, prefill and decode tok/s, peak
  `RssAnon`/`RssFile`/`Mlocked`, major faults, temperatures/battery: 2 completed
  reps (§2).
- The fit-gate refusal of Qwen-with-repack, 3/3 (`refusedBy=fit`,
  `reasonKey=model.tightNow`), and the LFM fallback that followed it.
- The first-turn prefill-deadline abort on Qwen, once.
- The daemon/swap contamination record of §6.

**Observed-functional only (compiles and runs; NOT a performance measurement):**

- That the rebuilt APK loads and runs; that `kalsa.bench.norepack=0` reaches the
  engine as `no_extra_bufts=0` and `=1` as `no_extra_bufts=1` on both models; that the
  registry policy for Qwen (`repack:false`) is what produces `no_extra_bufts=1` on the
  lever-absent path.
- The new default's *fit* effect: Qwen loads under repack-off in 3/3 QWEN-N reps
  (the functional claim of commit `964dd53`).

**NOT measured / remains unknown:**

- **Qwen's repack-on load time, throughput and footprint.** The gate refuses it, and
  the QWEN-R runs measured LFM. The estimator's ~2994 MiB Qwen repack term therefore
  remains an estimator output, not a device measurement; nothing here confirms or
  refutes it.
- Whether turning repack off for Qwen *helps or hurts its speed*. The LFM pair shows
  the direction on a dense model; a dense 2.6B and a hybrid 4B are not the same
  kernel workload, so extrapolating LFM's 2.6× prefill / 1.4× decode penalty to Qwen
  is a hypothesis, not a result.
- Any Qwen repack-off decode measured past ~90 tokens (the app's answers were short)
  and any long-context or multi-turn drift.
- Energy (J/token) on any arm, and any sustained/steady-state performance.
- Behaviour on a private/quiet device: not achievable here (§6).

---

## 8. Evidence index

```
RECON.md                     harness, lever precedence, engine-mode readback, model proof
run-arm.sh                   one arm run (this campaign's runner)
run-campaign.sh              the 12-run schedule
backfill-rows.py             rebuilds results.tsv from per-run artifacts
summarize.py                 per-arm medians with spread
bench-out/results.tsv        the machine table (12 rows)
bench-out/<ARM>/rep<N>/      run.log, logcat.txt, reduced.json, peak.csv,
                             sysprobe_pre/post.txt, daemon_start/end.txt,
                             maps_gguf.txt, maps_gguf_bytes.txt, prefs.txt, model_files.txt

Log hygiene: the inline `ROW:` line inside a run's `run.log` is not trustworthy for
refused or idle arms; QWEN-R rep1 logs a stale `LFM-R 1` row because that emitter
scrapes whatever telemetry was last in the buffer. Only `bench-out/results.tsv`, which
`backfill-rows.py` rebuilds from each run's `reduced.json` plus the maps proof, is
authoritative.
