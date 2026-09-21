# Adversarial review — S23 repack timing/thermal A/B (`s23-repack-timing`)

Independent reviewer, different model from the experiment agent. Read-only of the
target directory; nothing there was modified. All numbers below were recomputed from
`bench-out/results.tsv` and the per-run artifacts, not copied from the report prose.

Target reviewed:
- `scratchpad/agents/s23-repack-timing/REPORT.md`, `RECON.md`
- `run-arm.sh` (not fully audited line-by-line), `run-campaign.sh`, `summarize.py`,
  `backfill-rows.py`, `bench-out/results.tsv`, and all 12 `bench-out/<ARM>/rep<N>/` dirs.

---

## 0. Bottom line

**The report is honest and, on the load-bearing numbers, reproducible.** Every A/B and
footprint figure in the §2 headline table reproduces from the raw rows to rounding
**except one** (the LFM-N swap row, see F1). The central experimental claims survive
recomputation: the LFM prefill A/B ranges are genuinely disjoint, the loaded-model
ground truth is real and correctly exposes the QWEN-R contamination, the fit-gate
refusal is real 3/3, the aborted Qwen rep is correctly excluded, the DSP-daemon load is
captured as a real rate (not a lifetime total), and no run charged.

**Verdict on the motivating question (repack-policy-review fix #4):** this report
**partially qualifies** the Qwen `repack:false` default. It qualifies the *fit /
necessity* rationale (Qwen cannot load with repack on this device at all) and it prices
the repack trade *on LFM as a proxy*. It does **not** performance-qualify Qwen itself:
the Qwen-specific repack cost is unmeasurable on this device, and the one thing the data
does show is that repack-off is a throughput **cost**, not a throughput **win**. Details
in §6.

Findings are ranked; only F1 is a data-integrity defect, and it is non-load-bearing.

---

## 1. Recomputation vs the report (§2 headline table)

Recomputed with Python over `results.tsv` (12 rows, 4 arms × 3 reps; medians and
[min–max] over 3 reps as the report specifies). Result: **match** unless noted.

| metric | arm | report | recomputed | verdict |
|---|---|---|---|---|
| load wall s | all four | 0.84 / 3.65 / 4.23 / 3.57 (+ranges) | 0.839 / 3.646 / 4.231 / 3.567 | ✅ |
| prefill tok/s | LFM-N / LFM-R / QWEN-N | 18.4 / 47.7 / 11.0 | 18.45 / 47.69 / 10.97 | ✅ |
| decode tok/s | LFM-N / LFM-R / QWEN-N | 9.88 / 13.9 / 3.95 | 9.882 / 13.918 / 3.948 | ✅ |
| peak RssAnon MiB | all | 263 / 1760 / 1113 / 1752 | 262.8 / 1760.0 / 1113.4 / 1752.5 | ✅ |
| peak RssFile MiB | all | 1668 / 1585 / 2749 / 1586 | 1667.6 / 1584.8 / 2749.4 / 1585.8 | ✅ |
| major faults | all | 290 / 1060 / 162900 / 1600 | 290 / **1059** / 162923 / **1601** | ✅ (±1 rounding) |
| MemAvailable start MiB | all | 3528 / 2312 / 3198 / 2287 | 3528.5 / 2311.7 / 3197.5 / 2287.3 | ✅ |
| temp start→end °C | all | 40.4→41.7 / 40.4→42.3 / 40.3→42.7 / 40.5→41.5 | identical medians | ✅ |
| battery level | all | 68→67 / 70→69 / 74→71 / 76→75 | identical medians | ✅ |
| adsprpcd %CPU | all | 111→113 / 112→114 / 111→116 / 112→114 | identical medians | ✅ |
| swap start→end MiB | LFM-R/QWEN-N/QWEN-R | 1983→2223 / 1962→3332 / 2023→2184 | 1982→2223 / 1962→3332 / 2023→2184 | ✅ |
| **swap start→end MiB** | **LFM-N** | **1971 → 1964** | **1994 → 1953** | ❌ **F1** |
| loaded model bytes | all | 1585659904 / 1576226816 / 2824007680 / 1576226816 | identical (from maps) | ✅ |
| completed turn | all | 3/3 / 3/3 / 2/3 / 0/3 | 3/3 / 3/3 / 2/3 / 0/3 | ✅ |

The prose derived figures in §3 also check out: load +2.8 s (3.646−0.839=2.81) and 4.4×
(3.65/0.84); anon +1497 MiB (1760−263); RssFile −83 MiB; prefill 2.6× (47.7/18.4=2.59);
decode 1.41× (13.9/9.88); majflt 3.7× (1060/290). Estimator 0.8951×1590 = 1423 MiB ✅.

---

## 2. Is the A/B actually controlled?

Verified as controlled on the axes that matter, with **one real residual confounder**.

**Controlled (confirmed from artifacts):**
- **Same model / same prompt for the LFM pair.** Both LFM arms carry `prompt_n=1853`
  and — checked in `reduced.json` — both actually *evaluated* 1853 tokens
  (`tokensEvaluated=1853` in LFM-N and LFM-R rep1), so the 18.4 vs 47.7 tok/s prefill
  gap is like-for-like real work, not a caching artifact.
- **Same levers apart from repack.** `norepack` 1 vs 0 → `no_extra_bufts` 1 vs 0,
  confirmed in each `reduced.json.init`; all other prefs set identically per §1.2.
- **Interleaved, not blocked.** `run-campaign.sh` alternates N,R,N,R (reps 1,3) and
  R,N,R,N (rep 2). I cross-checked the actual `POWER`-line wall-clock timestamps in all
  12 `run.log`s and the execution order matches exactly (round 1: 22:24/22:28/22:32/22:40;
  round 2 reversed; round 3 back). A monotone thermal drift cannot land on one arm.
- **Matched start temperatures.** A cooling gate (`temp ≤ 40.5 °C`) parks the device
  before each run; achieved starts are 40.3–40.5 °C across all arms.
- **DISJOINT prefill ranges survive recomputation:** LFM-N [18.13–22.09] vs
  LFM-R [46.64–49.48] — non-overlapping. **Confirmed.** (Decode is *also* disjoint:
  LFM-N max 10.35 < LFM-R min 13.39 — see F4, the report wrongly calls it overlapping.)

**Residual confounder (F2, moderate):** the two repack-ON arms start every rep ~1.2 GB
lower on `MemAvailable` (LFM-R/QWEN-R 2145–2364 MiB vs LFM-N/QWEN-N 3148–3641 MiB), and
this gap tracks the repack flag regardless of which arm preceded it under interleaving.
There is no drop-caches/reboot between arms, so the arms do **not** start from a matched
memory baseline. Consequence: the MemAvailable and major-fault *deltas* attributed to
repack are partly starting-state, not purely the repack pass. The throughput A/B is
robust to this (the repack arm runs with *less* free memory yet is still faster, so the
confounder works against the measured effect), but the report's framing that the
MemAvailable gap is "the direct cost the fit gate prices" (§3) conflates carried-over
device state with the repack buffer. It is defensible only at the fit-gate decision
instant (`send_fit.availableMb` = 2440 for the repack attempt vs 3247 for Qwen-off), and
should be caveated as such.

---

## 3. Are the caveats real, not decorative?

All three demanded caveats are backed by data.

- **DSP daemon CPU is a genuine RATE.** `daemon_start.txt` samples `/proc/2251/stat`
  fields 14+15 (utime+stime) **twice over a 5 s interval** and derives %CPU from the
  tick delta (`adsprpcd %CPU=110.2 (ticks 6375556 → 6376107)`). Cross-checked against
  `top -b -n 1` in the same file: pid 2251 shows instantaneous `%CPU` ~100–111 and a
  lifetime `TIME+` growing 1062:35 → 1062:41 (≈5.5 s CPU over 5 s wall ≈ one core). This
  is **not** a lifetime total; it is a properly-sampled rate, validated two ways.
  `cdsprpcd` and `audioadsprpcd` are a true 0.0 % (ticks unchanged) in every arm.
- **Swap recorded per arm.** `swap_used_kb_{start,end}` = `SwapTotal − SwapFree` from
  the daemon meminfo probe, present for all 12 runs. ~2.0 GB already used at every start;
  the Qwen-N arm drives it to 3.15–3.54 GB within a run (matching the 54k–192k major
  faults — genuine mmap thrashing under pressure).
- **No-charging verified for ALL 12 runs.** Every `run.log` carries
  `AC=false USB=false WIRELESS=false`. No deliberate bypass anywhere; none needed. ✅
- **Report's "what survives the background" reasoning is consistent with the data:**
  adsprpcd sits at 111–116 % in all four arms start/end and arms are interleaved, so an
  *A/B difference* is defensible; the report correctly declares absolute throughput,
  energy, and sustained-performance claims unsafe (§6). I agree — see §6 here.

---

## 4. Honesty of refusals and aborts

**The QWEN-R contamination trap is real, and the report handles it correctly.**
- `bench-out/QWEN-R/rep*/maps_gguf.txt` shows the **LFM** file resident
  (`…/lfm2.5-2.6b/…` , 1 576 226 816 bytes), while `reduced.json.kalsa_load` records
  `refusedBy:"fit", reasonKey:"model.tightNow"` for `modelId:"qwen3.5-4b"`, 3/3.
- The final `results.tsv` QWEN-R rows carry the LFM `gguf_vma`, blank prefill/decode,
  `turn_completed=0`, and the refusal keys — and the report labels every QWEN-R number
  as LFM's throughout (§2 note ², §5). **Verified against the raw rows: no unlabelled
  LFM number appears in a Qwen column.** ✅
- **The trap actually fired in the raw log layer, which strengthens the report's point.**
  `bench-out/QWEN-R/rep1/run.log`'s inline `ROW:` line emits a full **`LFM-R 1 …`** row
  (load 3.737, prefill 37447 ms, decode 13.39, wall 110 — i.e. LFM-R rep1's telemetry
  scraped stale). Had `results.tsv` been built from those inline ROW lines, LFM-R's
  throughput *would* have been published as Qwen's. It was not, because `results.tsv` is
  rebuilt by `backfill-rows.py` purely from `reduced.json` (no `rounds` for a refusal →
  blank prefill/decode) + the maps proof. So the report's claim that "the maps check is
  what caught this trap … without it QWEN-R's numbers would have been published as
  Qwen's" is **supported** — and is more than hypothetical; the contaminated ROW is on
  disk. (F5, minor: the inline ROW emitter is unreliable for refused/idle arms; only the
  backfilled table is trustworthy. This is a log-hygiene note, not a result error.)
- **QWEN-N loaded-model ground truth is genuinely Qwen:** `QWEN-N/rep2/maps_gguf.txt`
  shows `…/qwen3.5-4b/…` (2 824 007 680 bytes), `init.no_extra_bufts=1`. ✅
- **Aborted Qwen rep correctly excluded.** QWEN-N rep1 (`prefill_deadline_abort=1`,
  `turn_completed=0`) has no telemetry `rounds`, so `backfill-rows.py` leaves prefill/
  decode blank and `summarize.py` takes the median over the 2 completed reps. The report
  states the exclusion (§2 notes ³/⁴, §5). ✅ Its footprint (anon/file/majflt) *is*
  included in those medians, which is legitimate and disclosed (`comp=0`).

---

## 5. APK identity

Verifiable from the recorded artifacts; two items rest on documentation rather than a
re-derivable on-disk check (unavoidable — the APK is not in this worktree).
- `RECON.md` records sha256 `245c514c…fff3c`, engine id
  `kalsa-eng-v2:0d5c4247…c6b3` "byte-identical to `node scripts/engine-build-id.js` in
  this worktree", HEAD `964dd53`, `-DGGML_USE_CPU_REPACK` present, `debuggable true`
  patch matching `apk.yml`. The **engine variant actually loaded**
  (`rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl`, `nGpuLayers 0`) is confirmed in every
  `reduced.json.native_variant`, consistent across all 12 runs.
- **Cannot be independently re-verified from this directory:** the APK sha256 and that
  the *installed* build equals this APK (relies on the recorded `lastUpdateTime` /
  versionCode). Reasonable provenance, but it is attestation, not artifact.
- Minor: REPORT §1.1 quotes build wall "557 s total; gradle … 8m 42s" while RECON quotes
  "Total 557 s (9 m 17 s)". These are consistent (557 s = 9m17s total; 8m42s is gradle's
  own subset), just presented confusingly. Non-issue.

---

## 6. Verdict in plain terms

**Does this performance-qualify the Qwen default (repack OFF) on this device?
Partially.**

**Supported by measurement:**
- **Fit / necessity of `repack:false` on Qwen — YES, directly measured.** Qwen-with-repack
  is refused 3/3 (`model.tightNow`) on a 6.91 GiB device; Qwen-repack-off loads 3/3.
  This is the strongest, Qwen-specific result.
- **The repack trade, priced on LFM (proxy):** repack OFF saves ~1497 MiB peak RssAnon
  and costs **2.6× prefill** (disjoint ranges) and **1.4× decode** (also disjoint). This
  is a clean, controlled A/B and is safe to quote **as an A/B ratio**.
- **Qwen functionally runs repack-off** (2/3 completed; one cold first-turn aborted by
  the app's own 180 s prefill watchdog — a real shipping behaviour, correctly reported).

**NOT measured / remains open (the report says so, and it is right to):**
- **The Qwen-specific cost of repack cannot be measured on this device at all** — the
  gate refuses it. So the estimator's Qwen repack term is neither confirmed nor refuted.
- **Whether repack-off helps or hurts Qwen's speed is unmeasured.** The only directional
  evidence (LFM) shows repack *improves* throughput, i.e. `repack:false` is a
  memory/fit **necessity that costs speed**, not a performance optimisation. Anyone
  reading the default as "faster" would be wrong; extrapolating LFM's 2.6×/1.4× penalty
  to a hybrid 4B is a hypothesis.

**A/B difference vs absolute throughput:**
- **Safe as an A/B difference:** the LFM ratios (2.6× / 1.4× / +1497 MiB), because the
  constant `adsprpcd` ~110 % load (with `cdsprpcd`/`audioadsprpcd` at 0) is present in
  both interleaved arms.
- **Unsafe as absolute throughput:** LFM 18/48 and Qwen 11/3.95 tok/s describe *this
  device, this day, with one core consumed and ~2 GB swap already used and (Qwen)
  54k–192k major faults*. Do not quote them as device capability. (Additional soft spot,
  F6: the Qwen absolute prefill is itself inflated ~5 % because tok/s uses `prompt_n`
  1988 while only 1885 tokens were evaluated — 1971 were prefix-cached. Non-load-bearing;
  Qwen is not the A/B.)

---

## 7. Findings, ranked

**F1 — data integrity, LOW impact (blocking-by-rule).** §2 LFM-N swap row reads
`1971 → 1964 MiB`; the raw rows give `1994 → 1953 MiB` (median of
2042348/2068104/1896840 and 2044720/1999240/1885320 kB ÷1024). Every other arm's swap
row matches ÷1024 exactly, so this is an isolated transcription error, and it lands in
the contamination-record row, not an A/B metric — no conclusion changes. Still, it is a
prose number the raw data does not support and should be corrected.

**F2 — uncontrolled confounder, MODERATE.** Repack-ON arms start every rep ~1.2 GB lower
on `MemAvailable`; arms are not reset to a matched memory baseline. The report presents
the MemAvailable gap as a pure repack cost; it is partly carried-over state. Throughput
A/B unaffected; MemAvailable/major-fault deltas partly confounded. Add a caveat.

**F3 — internal inconsistency, MODERATE.** §3 states the MemAvailable saving as both
"1217 MiB lower" (bullet) and "~951 MiB" (conclusion). Measured value is 1216 MiB; the
951 figure is unexplained and unsupported. Reconcile to ~1217 MiB.

**F4 — misstatement, MINOR (over-conservative).** §3 says LFM-N decode rep3 (7.09)
"overlaps the low end of the repack-on range". It does not — 7.09 ≪ repack-on min 13.39;
decode ranges are disjoint. The claim understates the result.

**F5 — log hygiene, MINOR.** The inline `ROW:` line in refused/idle arms' `run.log`
scrapes stale telemetry (QWEN-R/rep1 logs an LFM-R row). Harmless because `results.tsv`
is authoritatively rebuilt by `backfill-rows.py`, but the raw ROW lines must not be
trusted; worth a one-line note in the evidence index.

**F6 — measurement nuance, MINOR.** §3 swap "median +241 MiB" — the median of the
per-rep deltas {282, 241, 254} is 254; 241 is the minimum. And Qwen absolute prefill
tok/s is ~5 % high (uses `prompt_n` 1988 vs 1885 evaluated). Neither affects a
conclusion.

**Credit where due:** the loaded-model ground-truthing, the refusal/abort handling, the
rate-based daemon accounting, the interleaving, the no-charging discipline, and the
MEASURED-vs-NOT-measured section are all genuine and hold up under recomputation. The
report does not claim as measured anything it did not measure — most importantly it does
**not** dress the LFM proxy up as a Qwen repack measurement.
