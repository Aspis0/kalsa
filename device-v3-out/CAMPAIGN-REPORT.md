# Fase 2a stamped per-phase campaign — Jelly Star reference dataset (3 back-to-back runs)

Date (UTC): 2026-09-16. Device: Jelly Star, serial 192.168.1.82:5555. Galaxy S23 never touched.
Operator rule compliance: device unplugged for the whole campaign; repo
/Users/marco/Projects/kalsa-ngram-spec never modified (read-only); no push, no commit.

## 0. Tool revision statement (concurrent-edit provenance)

- At campaign start: HEAD `708499f597e5aa49b5f4c14bb202861f0cd1c146`,
  `scripts/energyPhaseSplit.mjs` md5 `ed1a7dca7a46dda31f40b562520ece3b`.
- During the campaign another agent committed fixes; at analysis time HEAD is
  `f2f9ea161e6b63638ecd331adf4385777ac4f56e`, tool md5 `59234fbfcbc327cdc75f3e24ecf849ee`
  (harness `7d08810a6681b2391b2fd72880ba7bdc`). Working tree at analysis: CLEAN
  (`git status`: "nothing to commit, working tree clean").
- NO split was run before run3 finished. ALL THREE runs plus the v2-fallback
  resplit were produced with the single analysis-time revision above
  (f2f9ea1 / 59234fbf) and the committed manifest
  `scripts/fixtures/energy-counts/manifest.csv`. The three runs are therefore
  guaranteed measured by the same code.
- The tool diff across the campaign window (708499f..f2f9ea1) touches
  `scripts/energyPhaseSplit.mjs` by 4 lines (fix commit c1cb693) plus docs.

## 1. Exact commands executed

Setup:
```
mkdir -p /tmp/kalsa-v3/run1 /tmp/kalsa-v3/run2 /tmp/kalsa-v3/run3
```

Run 1 (23:50:22Z start):
```
cd /tmp/kalsa-v3/run1
ANDROID_SERIAL=192.168.1.82:5555 \
LOCAL_BIN=/Users/marco/Projects/kalsa-ngram-spec/tmp/build-android-phase-stamps/bin \
MODELS="LFM2.5-2.6B-Q4_K_M.gguf LFM2.5-1.2B-Instruct-Q4_K_M.gguf" \
PROMPTS="REP PURE" ARMS="none" NGEN=256 REPS=3 THREADS=2 \
bash /Users/marco/Projects/kalsa-ngram-spec/scripts/device-ngram-spec.sh
```
Run 2 and run 3: identical except `cd /tmp/kalsa-v3/run2` / `/tmp/kalsa-v3/run3`,
started immediately after the previous run finished (back-to-back, no cooldown).

Splits (all after run3, single revision f2f9ea1):
```
cd /Users/marco/Projects/kalsa-ngram-spec
node scripts/energyPhaseSplit.mjs /tmp/kalsa-v3/run1/device-ngram-spec-out --counts-manifest scripts/fixtures/energy-counts/manifest.csv
node scripts/energyPhaseSplit.mjs /tmp/kalsa-v3/run2/device-ngram-spec-out --counts-manifest scripts/fixtures/energy-counts/manifest.csv
node scripts/energyPhaseSplit.mjs /tmp/kalsa-v3/run3/device-ngram-spec-out --counts-manifest scripts/fixtures/energy-counts/manifest.csv
```
V2-fallback isolation (same run1 bytes, stamps removed):
```
rm -rf /tmp/kalsa-v3/run1-v2only && mkdir -p /tmp/kalsa-v3/run1-v2only
cp -r /tmp/kalsa-v3/run1/device-ngram-spec-out/. /tmp/kalsa-v3/run1-v2only/
rm -f /tmp/kalsa-v3/run1-v2only/*.stamps /tmp/kalsa-v3/run1-v2only/*.phases.csv
node scripts/energyPhaseSplit.mjs /tmp/kalsa-v3/run1-v2only --counts-manifest scripts/fixtures/energy-counts/manifest.csv
```
All four splits exited 0. The fallback split logged one "phase stamps absent;
falling back to kalsa-energy-rep-v2 arithmetic" line per rep (12 total), as documented.

## 2. Battery / temperature / charging / binary record

md5 of the stamped build (unchanged at start, post-run1, post-run2, post-run3):
- `llama-cli`: d376e404e0265426de69bb9b77b94a49
- `libllama-cli-impl.so`: b35b2140f2ab708e537c315de9c98108
(Pristine `tmp/build-android/bin/llama-cli` = cca1187c7974655a50efe45d3cfd73d8 — never used.)

| checkpoint | level | batt temp | AC/USB/Wireless powered | status |
|---|---|---|---|---|
| start (pre-run1) | 92% | 27.0 C | false/false/false | Discharging path (status 3) |
| run1 pre 2.6B/REP | 92% | 27.0 C | false | — |
| run1 pre 2.6B/PURE | 89% | 31.0 C | false | — |
| run1 pre 1.2B/REP | 87% | 34.0 C | false | — |
| run1 pre 1.2B/PURE | 86% | 35.0 C | false | — |
| post-run1 (= pre-run2) | 85% | 35.0 C | false/false/false | 3 |
| run2 pre 2.6B/REP | 85% | 35.0 C | false | — |
| run2 pre 2.6B/PURE | 82% | 37.0 C | false | — |
| run2 pre 1.2B/REP | 80% | 37.0 C | false | — |
| run2 pre 1.2B/PURE | 79% | 37.0 C | false | — |
| post-run2 (= pre-run3) | 79% | 37.0 C | false/false/false | 3 |
| run3 pre 2.6B/REP | 79% | 37.0 C | false | — |
| run3 pre 2.6B/PURE | 76% | 37.0 C | false | — |
| run3 pre 1.2B/REP | 74% | 38.0 C | false | — |
| run3 pre 1.2B/PURE | 73% | 38.0 C | false | — |
| post-run3 | 73% | 38.0 C | false/false/false | 3 |

Charging evidence: preflight gate passed 3/3 runs; mid-campaign gate never
tripped; every per-stem `before:` line reads AC/USB powered false; all 2319
sampler rows across the 12 sampler CSVs read `Discharging` (zero exceptions).
No run aborted. All 36 reps produced speed lines; all 36 `.stamps` files
present and non-empty (74–77 bytes).

Throughput log (Generation t/s, r1/r2/r3 — the thermal story in one glance):
- run1: 2.6B/REP 3.9/3.9/3.9; 2.6B/PURE 4.0/4.0/4.0; 1.2B/REP 8.8/8.8/8.8; 1.2B/PURE 9.4/9.3/9.3
- run2: 2.6B/REP 3.9/3.0/2.8; 2.6B/PURE 2.8/2.7/2.6; 1.2B/REP 6.1/5.9/6.0; 1.2B/PURE 8.2/8.7/9.1
- run3: 2.6B/REP 2.8/2.7/2.7; 2.6B/PURE 2.7/2.6/2.6; 1.2B/REP 5.9/5.7/5.7; 1.2B/PURE 7.2/7.5/7.6

Stamped engine counts cross-check clean on all 36 reps: stamped
prompt_n/predicted_n = 73/256 (2.6B/REP), 52/204 (2.6B/PURE), 72/256
(1.2B/REP), 51/30 (1.2B/PURE) — identical to the committed manifest on every
rep. Only the informational manifest-vs-speed-line tps cross-check warns
(expected: the manifest encodes the 2026-09-15 campaign's t/s).

## 3. Full v3 rows per stem and rep

Sampler cadence on ALL 12 stems in ALL 3 runs: cadence_median_s = 1.03,
cadence_max_s = 1.04–1.05. No cadence warning fired anywhere (contrast the
2026-09-15 campaign: 3.0–3.5 s max on the 2.6B stems). Coverage below =
_s_int/_s per bucket. j_per_tok_decode = j_decode/gen_tokens.

### run1

| stem | rep | j_load_idle | j_prefill | j_decode | prefill_s (cov) | decode_s (cov) | j/tok_dec |
|---|---|---|---|---|---|---|---|
| 1.2B/PURE | 1 | 9.324 | 11.726 | 7.594 | 4.297 (96.1%) | 3.200 (64.7%) | 0.253 |
| 1.2B/PURE | 2 | 11.984 | 11.618 | 7.464 | 4.296 (95.9%) | 3.218 (64.0%) | 0.249 |
| 1.2B/PURE | 3 | 9.983 | 10.679 | 7.604 | 4.298 (96.1%) | 3.210 (63.9%) | 0.253 |
| 1.2B/REP | 1 | 9.780 | 16.480 | 100.875 | 6.085 (101.7%) | 29.167 (95.3%) | 0.394 |
| 1.2B/REP | 2 | 12.790 | 17.067 | 103.670 | 6.087 (101.9%) | 29.233 (95.0%) | 0.405 |
| 1.2B/REP | 3 | 9.921 | 16.330 | 105.905 | 6.077 (102.0%) | 29.173 (98.7%) | 0.414 |
| 2.6B/PURE | 1 | 14.145 | 27.516 | 181.863 | 10.449 (98.8%) | 50.398 (98.2%) | 0.891 |
| 2.6B/PURE | 2 | 14.824 | 27.833 | 180.259 | 10.446 (98.9%) | 50.398 (98.1%) | 0.884 |
| 2.6B/PURE | 3 | 15.098 | 30.666 | 181.288 | 10.443 (108.7%) | 50.379 (98.1%) | 0.889 |
| 2.6B/REP | 1 | 20.093 | 39.239 | 222.317 | 14.787 (104.6%) | 65.442 (97.6%) | 0.868 |
| 2.6B/REP | 2 | 16.621 | 37.053 | 225.663 | 14.775 (97.7%) | 65.292 (97.7%) | 0.881 |
| 2.6B/REP | 3 | 16.777 | 37.656 | 230.994 | 14.818 (97.4%) | 65.531 (99.0%) | 0.902 |

### run2

| stem | rep | j_load_idle | j_prefill | j_decode | prefill_s (cov) | decode_s (cov) | j/tok_dec |
|---|---|---|---|---|---|---|---|
| 1.2B/PURE | 1 | 9.812 | 10.621 | 9.564 | 4.392 (94.0%) | 3.646 (85.0%) | 0.319 |
| 1.2B/PURE | 2 | 12.163 | 11.579 | 6.777 | 4.297 (96.3%) | 3.457 (59.6%) | 0.226 |
| 1.2B/PURE | 3 | 12.262 | 11.604 | 7.074 | 4.298 (96.1%) | 3.313 (62.5%) | 0.236 |
| 1.2B/REP | 1 | 9.770 | 14.641 | 98.325 | 6.519 (95.3%) | 42.133 (98.2%) | 0.384 |
| 1.2B/REP | 2 | 10.481 | 15.035 | 100.007 | 7.201 (100.8%) | 43.572 (99.6%) | 0.391 |
| 1.2B/REP | 3 | 11.909 | 15.857 | 96.496 | 7.103 (102.2%) | 42.434 (97.5%) | 0.377 |
| 2.6B/PURE | 1 | 15.208 | 27.049 | 171.262 | 10.539 (97.9%) | 72.535 (98.4%) | 0.840 |
| 2.6B/PURE | 2 | 14.863 | 27.322 | 175.004 | 11.770 (105.5%) | 76.066 (97.9%) | 0.858 |
| 2.6B/PURE | 3 | 17.035 | 26.267 | 179.283 | 12.268 (101.2%) | 78.919 (98.3%) | 0.879 |
| 2.6B/REP | 1 | 15.080 | 38.978 | 239.884 | 14.788 (97.6%) | 66.126 (98.1%) | 0.937 |
| 2.6B/REP | 2 | 17.750 | 38.937 | 221.534 | 14.750 (97.8%) | 85.943 (98.5%) | 0.865 |
| 2.6B/REP | 3 | 16.379 | 37.228 | 224.701 | 15.554 (99.7%) | 91.490 (99.5%) | 0.878 |

### run3

| stem | rep | j_load_idle | j_prefill | j_decode | prefill_s (cov) | decode_s (cov) | j/tok_dec |
|---|---|---|---|---|---|---|---|
| 1.2B/PURE | 1 | 9.351 | 11.613 | 7.746 | 4.835 (107.1%) | 4.184 (73.9%) | 0.258 |
| 1.2B/PURE | 2 | 10.619 | 12.197 | 8.074 | 4.663 (110.7%) | 4.008 (77.3%) | 0.269 |
| 1.2B/PURE | 3 | 11.317 | 10.089 | 8.407 | 4.581 (90.4%) | 3.930 (78.6%) | 0.280 |
| 1.2B/REP | 1 | 9.355 | 16.365 | 96.780 | 6.777 (106.8%) | 43.732 (97.0%) | 0.378 |
| 1.2B/REP | 2 | 10.613 | 16.492 | 98.214 | 7.541 (109.8%) | 44.762 (97.0%) | 0.384 |
| 1.2B/REP | 3 | 10.379 | 16.228 | 96.848 | 7.667 (108.1%) | 44.913 (96.7%) | 0.378 |
| 2.6B/PURE | 1 | 15.270 | 25.768 | 172.977 | 10.784 (95.9%) | 74.659 (98.4%) | 0.848 |
| 2.6B/PURE | 2 | 16.296 | 25.905 | 173.374 | 12.495 (99.3%) | 77.312 (99.0%) | 0.850 |
| 2.6B/PURE | 3 | 15.405 | 27.579 | 172.069 | 12.711 (106.1%) | 78.488 (97.5%) | 0.843 |
| 2.6B/REP | 1 | 15.749 | 39.096 | 230.657 | 14.745 (97.9%) | 90.523 (99.3%) | 0.901 |
| 2.6B/REP | 2 | 14.882 | 36.870 | 220.595 | 16.532 (100.2%) | 94.116 (99.0%) | 0.862 |
| 2.6B/REP | 3 | 14.546 | 38.220 | 221.462 | 16.198 (102.2%) | 95.356 (98.6%) | 0.865 |

Warnings, verbatim from the CSVs. Every row carries a manifest tps-mismatch
note of this exact form (numbers vary per stem/rep, quoted here for run1 r1
of each stem; the full per-row texts are in the phases.csv files):
- `manifest campaign_gen_tps_r1 (8.4) differs from this run's speed line (8.8) - wrong manifest/campaign pairing?`
- `manifest campaign_gen_tps_r1 (9.1) differs from this run's speed line (9.4) - wrong manifest/campaign pairing?`
- `manifest campaign_gen_tps_r1 (3.9) differs from this run's speed line (4) - wrong manifest/campaign pairing?`
- `manifest campaign_gen_tps_r1 (3.6) differs from this run's speed line (3.9) - wrong manifest/campaign pairing?`
  (r2/r3 variants substitute r2/r3 and that rep's speed-line value.)
- Low-resolution suffix, verbatim, on flagged reps only (run1: all three
  1.2B/PURE reps; run2: 1.2B/PURE r2, r3):
  `decode bucket low-resolution: 2 interval(s) attributed to decode (coverage 2.07/3.20 s = 65%); j_per_tok_decode is sampling-granularity dominated — between-arm deltas of the same stem remain the sanctioned use`
  (per-row numbers vary: 2.06/3.22 s = 64%, 2.05/3.21 s = 64%, 2.06/3.46 s = 60%, 2.07/3.31 s = 62%.)
- run3 1.2B/PURE reps (coverage 73.9–78.6%, 4 attributed intervals) carry NO
  low-resolution flag — only the manifest note.
- All REP and all 2.6B/PURE rows: manifest note only, no bucket flag.

## 4. Within-run spread vs the committed v2 values

Spread = (max − min)/mean × 100 on j_per_tok_decode (this formula reproduces
all four committed figures from the findings table).

| stem | committed v2 | run1 v3 | run2 v3 | run3 v3 |
|---|---|---|---|---|
| 1.2B/REP | 0.68% | 4.95% (0.394/0.405/0.414) | 3.65% (0.384/0.391/0.377) | 1.58% (0.378/0.384/0.378) |
| 2.6B/REP | 1.23% | 3.85% (0.868/0.881/0.902) | 8.06% (0.937/0.865/0.878) | 4.45% (0.901/0.862/0.865) |
| 2.6B/PURE | 10.06% | 0.79% (0.891/0.884/0.889) | 4.54% (0.840/0.858/0.879) | 0.83% (0.848/0.850/0.843) |
| 1.2B/PURE | 29.06% | 1.59% (0.253/0.249/0.253) | 35.72% (0.319/0.226/0.236) | 8.18% (0.258/0.269/0.280) |

Explicit verdict on the question asked: NO — the 2.6B/PURE 10.06% spread does
NOT reproduce. All three runs are far tighter (0.79% / 4.54% / 0.83%), with
98–99% decode coverage on every rep. The old 10.06% does not transfer to the
stamped path at 1.03–1.05 s cadence. The 1.2B/PURE fragility story DOES
reproduce qualitatively: run2's flagged short buckets swing 35.72%, worse
than the committed 29.06%.

## 5. Between-run spread (new number — the point of the exercise)

Range of the three run-means divided by their grand mean:

| stem | run1 mean | run2 mean | run3 mean | between-run spread |
|---|---|---|---|---|
| 1.2B/PURE | 0.2517 | 0.2603 | 0.2690 | 6.66% |
| 1.2B/REP | 0.4043 | 0.3840 | 0.3800 | 6.25% |
| 2.6B/PURE | 0.8880 | 0.8590 | 0.8470 | 4.74% |
| 2.6B/REP | 0.8837 | 0.8933 | 0.8760 | 1.96% |

Sanctioned cross-stem check (REP-vs-REP paired per rep): run1 gives
0.868/0.394 = 2.20, 0.881/0.405 = 2.18, 0.902/0.414 = 2.18 (decode-J sums
ratio 2.19x) — the committed 2.20–2.21x finding reproduces in the cold run.
Under throttling it drifts: run-means ratio 2.33x (run2), 2.31x (run3).
The headline ratio is therefore thermal-state dependent.

## 6. v2-versus-v3 on the SAME run1 bytes (stamps deleted in scratch copy)

| stem | rep | v3 j/tok | v2 j/tok | delta | v3 dec_s → v2 dec_s |
|---|---|---|---|---|---|
| 1.2B/PURE | 1 | 0.253 | 0.253 | 0.00% | 3.200 → 3.191 |
| 1.2B/PURE | 2 | 0.249 | 0.249 | 0.00% | 3.218 → 3.226 |
| 1.2B/PURE | 3 | 0.253 | 0.253 | 0.00% | 3.210 → 3.226 |
| 1.2B/REP | 1 | 0.394 | 0.394 | 0.00% | 29.167 → 29.091 |
| 1.2B/REP | 2 | 0.405 | 0.405 | 0.00% | 29.233 → 29.091 |
| 1.2B/REP | 3 | 0.414 | 0.414 | 0.00% | 29.173 → 29.091 |
| 2.6B/PURE | 1 | 0.891 | 0.910 | −2.09% | 50.398 → 51.000 |
| 2.6B/PURE | 2 | 0.884 | 0.884 | 0.00% | 50.398 → 51.000 |
| 2.6B/PURE | 3 | 0.889 | 0.907 | −1.98% | 50.379 → 51.000 |
| 2.6B/REP | 1 | 0.868 | 0.868 | 0.00% | 65.442 → 65.641 |
| 2.6B/REP | 2 | 0.881 | 0.881 | 0.00% | 65.292 → 65.641 |
| 2.6B/REP | 3 | 0.902 | 0.902 | 0.00% | 65.531 → 65.641 |

Whole-window J is conserved exactly (v3 li+pre+dec equals v2 pre+dec to
≤0.001 J on all 12 reps). On 10/12 reps the decode bucket is bit-identical;
on 2.6B/PURE r1 and r3 the engine re-anchor moves exactly one sample interval
(~3.8 J, ~2%) between decode and pre-decode. The re-anchoring effect, isolated
from any device difference, is therefore: zero at 3-decimal display on 10/12
reps, ~2% on 2/12. The new information in v3 is the pre-decode subdivision
(j_load_idle vs j_prefill), not a changed decode number.

## 7. Design decision

DECISION: sequential A-then-B comparison on j_per_tok_decode is NOT usable
for the effect sizes this program cares about. Any future A/B needs ABBA
interleaving AND a temperature gate.

Minimum distinguishable effect (two-sample, two-sided alpha 0.05, power 0.8;
SD = pooled 9-rep SD including the thermal drift a sequential design suffers):

| stem | pooled CV | MDE at n=3 | MDE at n=5 |
|---|---|---|---|
| 1.2B/PURE | 10.45% | 31.7% — not distinguishable at this resolution | 21.1% — not usable |
| 1.2B/REP | 3.33% | 10.1% | 6.7% |
| 2.6B/PURE | 2.41% | 7.3% | 4.9% |
| 2.6B/REP | 2.81% | 8.5% | 5.7% |

Plainly: in a sequential design, effects below ~5–10% are not distinguishable
at this resolution, and on 1.2B/PURE nothing is. With ABBA interleaving inside
a thermally stable window, the floor drops to the within-run MDE (cold-regime
run1: 1.2% on 2.6B/PURE, 2.8% on 1.2B/PURE, 5.9% on 2.6B/REP, 7.5% on
1.2B/REP at n=3) — still percent-scale, so the temperature gate (start arms in
a narrow battery-temp band, refuse runs with monotonic rep-to-rep decay) is
load-bearing, not cosmetic.

## 8. Unexplained items, cadence, clocks

- Cadence: median 1.03 s, max 1.04–1.05 s on every stem in every run. No
  warning. The 3.0–3.5 s stalls of the 2026-09-15 campaign did not recur —
  why they occurred there and not here is unexplained.
- Throughput decayed progressively across the back-to-back runs (2.6B/REP
  3.9 → 2.7 t/s) coincident with battery temperature rising 27 → 38 C, yet
  the sampled big-core clocks (cpu6/cpu7) read a pinned 2.20 GHz mean in
  EVERY decode window of runs 1–3, including the slowest reps. The per-CPU
  clocks in the CSVs therefore do not account for the decay; its mechanism
  is recorded as unexplained, not attributed.
- Prefill coverage reads above 100% on several rows (max 110.7%, run3
  1.2B/REP r2). This follows the documented straddle-to-earlier-bucket
  assignment (prefill gains the boundary interval); decode coverage is below
  100% on all 36 rows, as constructed.
- Run2 1.2B/PURE r1 (85.0% coverage, 4 intervals, no flag, 0.319 J/tok) vs its
  flagged siblings r2/r3 (0.226/0.236) is sample-phase luck of the kind the
  low-resolution warning exists for — no further claim made.

## 9. What I could not verify / did not do

1. Did NOT copy evidence into /Users/marco/Projects/kalsa-ngram-spec/device-v3-out/run{1,2,3}:
   the task brief orders it, but the hard read-only rule for the repo forbids
   creating anything there. Evidence lives at /tmp/kalsa-v3/run1|run2|run3/device-ngram-spec-out/
   (each with 4 sampler CSVs, 4 .marks, 12 _rN.txt, 12 .stamps, 4 .phases.csv,
   results.txt) plus the v2-only scratch copy at /tmp/kalsa-v3/run1-v2only/.
2. The residual mark lag (CLI-exit → mark write teardown, one-way into decode
   per the schema doc) is not measured per rep; its 0.05–0.5 s plausible range
   is taken from the doc, not verified here.
3. Absolute J/token is unverifiable by contract (relative metric); none quoted.
4. No verification that no other party touched the Jelly Star during the
   campaign window beyond the observed clean adb session and the absence of
   anomalies in the logs.
5. Nothing about the Galaxy S23 — untouched, unverified, as ordered.
6. Battery-gauge absolute accuracy (level %, temperature scaling) is taken
   from dumpsys as-is.
7. energyAggregate.mjs was not run (not required by the brief).

No run aborted; no number in this report is filled in — every cell comes from
the CSVs quoted above, and gaps are stated as gaps.
