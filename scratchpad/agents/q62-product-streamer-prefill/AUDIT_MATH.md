# q62 hostile mathematical audit — pre-banking

Auditor re-derivation: independent Python (stdlib) from `raw/` only. Every number below was
recomputed from the trace/CSV/stdout files, not taken from REPORT.md. `finalize_q62.py` was run
again in a temp copy (no repo mutation; `git status` for the cell unchanged; REPORT.md here is
byte-identical to the temp rerun). Raw: `raw/primary_inv{1,2,3}.{iotrace.txt,csv,stdout.jsonl,
stderr.log,cpuset.log,guard.log,battery.log,pre/post.battery.txt,workload.rc,guard.rc,record.json}`.

Trace schema (confirmed, `raw/primary_inv1.iotrace.txt:7`):
`turn,phase,step,layer,expert,proj,lane,spec,offset,req_bytes,read_bytes,latency_ns`.
All 20,502 rows: turn=0, spec=0 (no speculative reads), phase ∈ {0,1}.

---

## A. Wall and counts — CONFIRMED (2 NOTES)

| item | re-derived | source |
|---|---|---|
| prefill wall | inv1 38.049 s; inv2 35.814 s; inv3 32.781 s | CSV `# summary … prefill_s=` (inv1 `raw/primary_inv1.csv:40`) and `stdout.jsonl` perf line `prefill: 486 tokens, 38.049 s` |
| engine internal consistency | 486/38.049 = 12.773 (printed 12.77/12.8); 486/35.814 = 13.570 (13.57/13.6); 486/32.781 = 14.826 (14.83/14.8) | CSV `prefill_tps` matches print |
| prompt tokens | n_prompt=486, identical in all 3 CSV summaries; within both window wordings (PREREG 480–544, RUN_LOG 480–511) | CSV summary; `PREREG.md:54`, `RUN_LOG.md:163` |
| invocations | exactly 3, rc=0 (workload.rc, guard.rc = "0"), cooldown ≥60 s between | `RUN_LOG.md:166-173`; guard logs TRACKING_30014/1779/9196 match RUN_LOG binary_pids |
| guard | rc 0; max temp 28.7 / 29.2 / 31.2 °C (tenths 287/292/312, MAX rows); warn 40, kill 43 | `guard.log` each invocation; REPORT.md:66-68 |
| battery | pre 52/51/51, post 52/51/50; `AC powered: false`, `USB powered: false` in pre- and post-dumps; gate ≥45 | `pre/post.battery.txt`; `battery.log` |
| cpuset | `cpus_allowed_list=0-7` in every sampled row (wrapper pid) | `cpuset.log` |
| no crash marker | none of the 8 CRASH_MARKERS in any primary stderr/stdout | grep over `stderr.log`, `stdout.jsonl` |
| memory regime | MemTotal 11,436,476 kB (11.4 GB) < model 13,416,430,592 B (13.4 GB); MemAvailable pre 6.1–6.5 GB, post 6.8–6.9 GB; no LMK | `pre/post.meminfo.txt` |

NOTES:
- **A-N1 (MINOR).** The tracked "BINARY_PID" is the `/system/bin/sh -c … bmoe-cli` wrapper, not the
  bmoe-cli process (`raw/primary_inv1.cpuset.log` cmdline field; `n0_probe`/inv records). cpuset is
  inherited across fork/exec, so the 0-7 conclusion stands, but REPORT.md:62 "cpuset evidence …
  from binary_pid/guard evidence" overstates provenance, and RUN_LOG.md:45 "sampler actual bmoe-cli
  row" is inaccurate (the row is the shell wrapper). Same reason the sampler cpu cross-check is
  genuinely FAIL_WRONG_PID_SHELL_WRAPPER (below, E).
- **A-N2 (MINOR).** The Amendment-1 window is written 480–544 (PREREG.md:54) and 480–511
  (RUN_LOG.md:163). 486 satisfies both, so no numeric impact; pick one wording before banking.

## B. io-trace derivation — CONFIRMED (1 MAJOR caveat, 2 NOTES)

Phase 0 = PREFILL (19,542 rows), phase 1 = the single decode step (960 rows = 40 layers × 24
reads; one contiguous wave per layer, layer-major ascending, verified by run-length analysis).

Excluded decode reads: Σ read_bytes = **368,214,016 B = 351.156250 MiB** — matches the engine's
`BMOE_PROGRESS {"read_mb":351.16}` (stdout.jsonl) and CSV row `read_bytes=368214016` and summary
`read_MiB=351.2` exactly. REPORT.md:56-58 CONFIRMED.

Prefill per invocation (my recomputation vs REPORT.md:20-22, exact to 6 dp):

| inv | rows | Σlat s | lane0/1/2/3 s | Σ_layers max-lane s | Σlat/4 s |
|---|---|---|---|---|---|
| 1 | 19542 | 16.483904 | 4.196081/4.097951/4.093394/4.096478 | 4.203631 = point I/O wall | 4.120976 |
| 2 | 19542 | 17.098218 | 4.285709/4.273158/4.272482/4.266868 | 4.294159 | 4.274554 |
| 3 | 19542 | 13.127897 | 3.291864/3.278180/3.276945/3.280908 | 3.297338 | 3.281974 |

- **B-M1 (MAJOR — must be stated at banking; does not flip the verdict).** "Max-lane per layer"
  is a *model*, and the trace cannot fully verify it: there are **no timestamps** — only per-read
  latency and file order. What the data does establish:
  1. File order = one wave per layer, 40 layer-blocks, layer-major ascending; lanes interleave
     throughout each block (e.g. layer-0 lane sequence 0,0,2,1,0,0,3,0,2,1,…) → consistent with
     4 lanes draining a shared queue concurrently, not lane-clustered serial batches.
  2. Each (layer, expert, proj) tensor slice is read as exactly **one** chunk by exactly **one**
     lane (layer 0: 576/576 single-lane pairs; per-layer lane sums within 0.6% of each other) →
     balanced concurrent distribution.
  3. **Decode cross-check (the strong part):** engine's own decode `io_ms=334.4 ms` vs trace
     phase-1 max-lane Σ = 328.3 ms (1.9% gap) vs Σlat = 1275 ms (3.8× too big) vs Σlat/4 =
     318.8 ms. The engine's independently measured I/O wall brackets the max-lane model
     (±2%) and refutes serialized-lane summation for the phase-1 scheduler; phase 0 uses the
     same io-thread machinery (same header flags). The same inference for the prefill phase
     itself is **PLAUSIBLE, NOT VERIFIED** — state exactly that.
  4. The "layer × step" grouping question is moot: **all 19,542 phase-0 rows carry step=485**
     (batched prefill stamps the last token index; the trace cannot discriminate tokens), so
     layer-only grouping is the finest the data allows. finalize_q62.py:156-158 is correct.
  Sensitivity: point vs lower differ by only 2%; the serialization extreme (upper) is 4× the
  point; even the engine-side overhead residual (io_ms > max-lane by ~2%) only shifts
  compute_wall by ~0.1–0.2 s (≤0.5% of wall) — not material to the verdict.
- **B-N1 (NOTE).** `overlap=0` appears in both the trace header (`# … io_threads=4 o_direct=1
  overlap=0`) and CSV comment header (`io_two_wave=0 prefetch=0 … overlap=0`); finalize reads it
  from the trace header (finalize_q62.py:136-137) ✓. With overlap=0, wall = io_wall + compute_wall
  is a legitimate decomposition, with compute_wall defined as residual.
- **B-N2 (MINOR).** Other non-compute, non-I/O phases inside the prefill wall are unmeasured for
  phase 0 (mgmt_ms/loop_overhead_NULL for phase 0 — NA, not fabricated). Decode-step analogs are
  tiny (mgmt_ms 0.071 ms, loop_overhead 0.454 ms on a 1299.9 ms step = 0.04%); tokenization of a
  1,892-char prompt is sub-ms. Residual contamination of compute_wall < ~0.5%. **Model load is
  outside the prefill wall: TTFT = load + prefill verified exactly** — inv1 7.669+38.049 = 45.718
  vs printed 45.717 (1 ms rounding); inv2 8.141+35.814 = 43.955 exact; inv3 7.849+32.781 = 40.630
  exact (`stdout.jsonl` perf lines). NOT VERIFIED: whether tokenization is inside the prefill
  timer (engine internals; immaterial at this magnitude).

## C. Shares and headroom — CONFIRMED (1 MAJOR-adjacent margin NOTE); the suspected 0.51 is REFUTED

Shares recomputed from my trace sums and CSV walls:

| inv | io_share lower | io_share point | io_share upper | compute_share(point) |
|---|---|---|---|---|
| 1 | 0.108307 | 0.110479 | **0.433228** | 0.889521 |
| 2 | 0.119354 | 0.119902 | **0.477417** | 0.880098 |
| 3 | 0.100118 | 0.100587 | **0.400473** | 0.899413 |

All match REPORT.md:30-38 to the printed digit. The audit brief's suspicion ("inv2 Σlat ≈ 18.4 s
→ 0.51 → mixed under the upper bound") is **REFUTED by the raw trace**: Σlat(inv2) = 17.098218 s,
17.098218/35.814 = **0.477417 < 0.5** → compute-bound under the frozen wording (PREREG.md:39) for
all 3 invocations × all 3 bounds. "wording robust across bounds = True" (REPORT.md:30-38) is
therefore CORRECT. Margin ledger: the narrowest cell is inv2/upper at 4.5% below the 0.5 boundary
(0.4774 vs 0.5; a 9.4% rise in serialized I/O or a 4.5% wall drop at fixed Σlat flips that one
cell to "mixed"); all other cells sit at ≥13% below the boundary. Point shares (the achieved
walls) are 4–5× below 0.5. Verdict "compute-bound" holds; it is robust, not knife-edge.

Headroom (wall / max(I/O wall, compute_wall/k), k=2,4,8): all 27 cells recomputed, identical to
REPORT.md:46-48. Settling rule (headroom(k=4) ≥ 2.0 ⇒ real ceiling; ≤1.3 ⇒ stays CPU; PREREG.md:
40): point_k4 = 4.496804 / 4.544947 / 4.447344; the minimum across **all** bounds is inv2 upper_k4
= 2.094604 — every cell ≥ 2.0. Settling verdict "streaming-NPU has a real ceiling" is supported
under every bound. NOTE: REPORT.md contains no explicit settling-rule verdict line (only the
table). PREREG hygiene says numbers-only (PREREG.md:74), so not a defect; add one line at banking.

## D. Bytes reconciliation and rates — CONFIRMED (1 NOTE, units all consistent)

- Σ req_bytes vs read_bytes: 19,542 rows = 13,028 × 344,064 + 6,514 × 450,560 = 7,417,413,632 B
  requested; Σ read_bytes = **7,495,897,088 B** → **every one of the 19,161 mismatching reads
  over-reads exactly +4,096 B** (one O_DIRECT page; total +78,483,456 B = +1.05%). The
  over-read is included in ALL byte totals on both sides — trace Σ, engine decode row
  (368,214,016 = 960 reads + 960×4096 … verified row-wise), and the engine's own read counters —
  so no cross-check inconsistency is introduced. NOTE (D-N1, MINOR): REPORT.md cross-check table
  omits the +4 KiB/read detail; harmless, but state it so the 1.05% doesn't look like a rounding
  discrepancy.
- Units: the engine field named `read_mb` is MiB — 368,214,016/1,048,576 = 351.156250 → printed
  351.16 (stdout.jsonl, CSV `read_MiB=351.2`). REPORT.md:52-58 identifies this mislabeling
  correctly; decimal MB is shown separately. REPORT's main-table `read_mb` column (7148.645,
  REPORT.md:6-8) is the **trace-derived MiB** (7,495,897,088/1,048,576 = 7148.644531), not an
  engine field — the table header inherits the engine's MiB-means-MiB convention; cross-check
  table documents it. Labeling opacity only, no arithmetic impact.
- Effective prefill rate = trace bytes / point I/O wall: 1783.195705 / 1745.603129 / 2273.317930
  MB/s (= 1700.587945 / 1664.736870 / 2168.004923 MiB/s) — recomputed exactly, REPORT.md:56-58 ✓.
  Decode figure 1050 MiB/s verified: 368,214,016/1,048,576/0.334417 = 1050.06 MiB/s ✓ (inv2 1021,
  inv3 1079 from the respective io_ms values ✓). Prefill effective rate 1.6–2.1× the decode rate
  is physically plausible (bigger coalesced burst reads across the 486-token batch; per-lane
  425–542 vs 262 MiB/s) — no anomaly.

## E. Tautology removal and sampler — CONFIRMED (1 NOTE)

- finalize_q62.py contains no `read_mb/wall` division and no eval_MB_s symbol; `io_floor_s` is set
  to the trace point I/O wall (finalize_q62.py:215), `measured_eval_mbps` is None
  (finalize_q62.py:213). REPORT.md:85 states the old identity is not used ✓. The frozen PREREG
  "I/O floor = read_mb / measured eval MB/s" (PREREG.md:36) is superseded by Amendment-1 trace
  walls — declared in REPORT.md:26 ("lower = sum latency / 4; point = …; upper = …").
- Sampler cross-check: sampler rows sampled the shell wrapper pid (cpu_s = 0.020 s, read_bytes ≤
  12 KiB vs 7.49 GB engine); REPORT.md:62-68 declares FAIL_WRONG_PID_SHELL_WRAPPER and derives **no
  CPU share** from it ✓; RUN_LOG.md:181 reiterates. NOTE (E-N1): RUN_LOG.md:45 calls the cpuset row
  "actual bmoe-cli" — it is the wrapper (see A-N1); cpuset conclusion unaffected.

## F. finalize_q62.py — no bugs found; REPORT reproducible byte-identical

Reviewed after independent derivation; then executed in a temp copy (`$TEMP/q62finalize/cell`,
raw/ untouched) → **REPORT.md regenerated byte-identical** (sha bf8517b1…). Specific probes:
- phase filtering: `row.get("phase") == "0"` (finalize_q62.py:141) — phase codes are "0"/"1"
  strings; phase-1 (decode) correctly excluded ✓.
- lane/layer grouping (finalize_q62.py:153-158): per-(layer,lane) sums, Σ max-lane — no off-by-one
  (40 layers, 4 lanes, indices 0-39/0-3 verified) ✓; step ignored — forced by data (step ≡ 485) ✓.
- units: latency_ns ÷1e9 (finalize_q62.py:152); bytes ÷1,048,576 for MiB (finalize_q62.py:162);
  decimal MB ÷1e6 ✓.
- walls: `summary_number(tag,"prefill_s")` (finalize_q62.py:123-131,209) reads the CSV summary
  `prefill_s=`, i.e. the PREfill wall, not TTFT, not load ✓. compute_wall = wall − point I/O wall
  (finalize_q62.py:216) ✓; headroom formula matches PREREG (finalize_q62.py:411-414) ✓; wording
  thresholds 0.8/0.5 (finalize_q62.py:263-267) ✓; overlap read from trace header comment ✓.
- `decode_summary` last-row decode assumption holds (single decode row) ✓.
- Dead code: `classify()` (finalize_q62.py:250) is defined but never called — NOTE, harmless.
- Sampling-of-records regex `(?:primary|secondary)_inv\d+` selects exactly inv1-3 ✓; two calib1
  records (rc 0 then rc 1) and calib2/n0_probe excluded ✓; calibration loads discarded
  (calib1 n_prompt=360; calib2 "prompt + n_predict exceeds the session n_ctx (512)"; n0_probe
  stderr "config error: n_predict must be positive") ✓.

## G. Scope statement — what the cell does NOT show (CONFIRMED as declared, + trend analysis)

Declared and verified: single device (Xiaomi houji, adb-625689a2…, MemTotal 11.4 GB < 13.4 GB
model → structural streaming); KEXP GGUF only (one model, sha ac44e20c…); prefill 486 tokens,
**not** 512 (26 short of target, inside Amendment-1 window); cache off (`--cache-mb 0`,
cache_hit_pct −1.0); decode n=1 (n=0 rejected); secondary `--cache-mb 2000` arm not run (owner-
directed primary-only, RUN_LOG.md:170); optional `-p 2048` not run; page cache not dropped
(drop_caches denied, no root — declared, not retried; O_DIRECT reads do not populate the page
cache, so residual inter-invocation caching is bounded to the small non-expert mmap regions).

**Invocation trend (quantified):** wall 38.049 → 35.814 → 32.781 s: Δ −2.235 s (−5.87%), −3.033 s
(−8.47%), total −5.268 s (−13.85%); mean 35.55 s, SD 2.16 (CV 6.1%). Component accounting:
compute_wall fell monotonically −2.326 / −2.036 s (total −4.362 s = **82.8% of the wall drop**),
while I/O was **non-monotone**: point +0.091 s then −0.997 s; Σlat +0.614 s then −3.970 s. The
hypothesis "the I/O part is the one shrinking" is REFUTED by the components: I/O did not shrink
inv1→inv2 at all (it grew ~2-4%), and compute drives ~5/6 of the total decline. Even the hostile
counterfactual — attribute the entire −5.27 s to I/O — leaves inv3 upper serialized share =
13.128/32.781 = 0.4005 < 0.5 → the "compute-bound" verdict survives the trend in both readings
(if I/O is truly shrinking toward a floor, the steady state is even more compute-bound). Guard
temperature rose 28.7→29.2→31.2 °C while walls fell, so the drift is not thermal-release in the
obvious direction; engine cpu_s/tok is non-monotone (1.412/1.189/1.502) — cause NOT VERIFIED
from the files (plausibly UFS/FTL warm-up or system settling); the drift does not touch the
verdict because every share is 2-10× inside its boundary.

Not shown / not verifiable (stated for the bank): no timestamps in the trace (concurrency is
inferred — B-M1); prefill phase-0 io_ms/compute_ms absent from the shipped binary (NA, not
fabricated — REPORT.md:72); the engine's `--csv`/`--io-trace` instrumentation is inside the
measured wall (binary help: "--csv … costs speed — not for benchmark runs"; single row + trace
file writes, estimated < 1% — the trace write is inherent to this measurement); only one
invocation sequence on one device; `-t 4` compute threads + 4 io threads (8 threads) — the
compute_wall is 4-thread CPU-bound time, so NPU headroom inference is per PREREG's
k-scaling model, not a measured property of any NPU.

---

## Findings summary

| # | severity | finding | status |
|---|---|---|---|
| A | MINOR | tracked pid is the shell wrapper, not bmoe-cli (cpuset/sampler provenance; RUN_LOG.md:45 wording) | CONFIRMED as issue |
| A | MINOR | accepted-window wording 480–544 vs 480–511 (PREREG.md:54 vs RUN_LOG.md:163) | CONFIRMED as issue |
| B | MAJOR | "point I/O wall" = per-layer max-lane model; no timestamps; verified only via decode io_ms cross-check (1.9%) + lane interleaving; prefill concurrency itself PLAUSIBLE, NOT VERIFIED — must be stated | CONFIRMED as caveat |
| B | MINOR | mgmt/tokenization/scheduling inside the residual compute_wall; magnitude ≤0.5% (decode analogs 0.04%) | CONFIRMED as caveat |
| B | — | load outside wall; TTFT = load + prefill exact (45.717/43.955/40.630) | CONFIRMED |
| C | MINOR | inv2 upper share margin only 4.5% below the 0.5 boundary; Δ 9.4% from "mixed"; all point/lower cells ≥13% margin | CONFIRMED as caveat |
| C | — | audit-brief suspicion "inv2 Σlat 18.4 s ⇒ 0.51 mixed" — actual 17.098 s ⇒ 0.4774 | REFUTED |
| C | NOTE | REPORT has no explicit settling-rule verdict line (numbers: ceiling, min headroom 2.095 ≥ 2.0) | CONFIRMED as caveat |
| D | MINOR | +4 KiB/read systematic over-read (+1.05%) not documented; units otherwise consistent (read_mb is MiB, flagged) | CONFIRMED as caveat |
| E | — | tautology removed; sampler wrong-PID declared; no CPU share derived from sampler | CONFIRMED |
| F | — | finalize: no off-by-one/unit/filter/wrong-wall bugs; REPORT regenerated byte-identical | CONFIRMED |
| G | MINOR | inv-to-inv wall drift −13.85% unreported; components show compute drives 82.8% of the drop; verdict survives every reading | CONFIRMED as caveat |

No BLOCKER. No arithmetic error found anywhere in REPORT.md, manifest.json, or finalize_q62.py:
every number reproduced to the printed precision from raw/. The one structural limitation
(B-M1, concurrency inference) does not threaten the verdict because the fully-serialized extreme
(upper) is already inside the compute-bound band for all three invocations.

VERDICT: BANK-WITH-CORRECTIONS B-M1 (state the max-lane model + decode io_ms=334.4 vs 328.3 ms cross-check + step≡485 degeneracy in the bank statement), A-N1/A-N2 (wrapper-pid provenance wording; unify the 480–511 window wording), C-margin (report the inv2/upper 4.5% margin to the 0.5 boundary), D-N1 (+4 KiB/read over-read), G-trend (report the −13.85% wall drift and the component accounting), plus a one-line settling verdict (headroom(k=4) min 2.095 ≥ 2.0 → real ceiling)
VERDICT: BANK-WITH-CORRECTIONS B-M1, A-N1, A-N2, C-margin, D-N1, G-trend, settling-verdict-line