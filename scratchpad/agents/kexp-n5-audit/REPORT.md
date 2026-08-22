# AUDIT REPORT — kexp-n5-audit (hostile data audit, S23 KEXP N≥5 session, queue #18)

Auditor: hostile/paranoid. Read-only (this report is the only write).
Binding protocol: `results\kexp_speed_s23\PREREG_KEXP_N5.md` v1.2.
Session reports: `scratchpad\agents\kexp-n5-session\REPORT.md` and `results\kexp_speed_s23\n5\REPORT.md` (byte-equivalent content).
Raw: `results\kexp_speed_s23\n5\` (runs.csv 36 rows, 36 cell stdout jsonl, ~420 probe files, SHA256SUMS, session.log).

## FINDINGS

### Instrument truth (attack 1)

**F1 — REFUTED (attack fails): every number is real.** Programmatic cross-check, all **36/36** rows (counted + block 4):
- csv `tg512` == stdout jsonl `avg_ts` (tol 1e-4); no missing file; sha256 of all 36 stdout files unique — no reuse/duplicate;
- every jsonl `test_time` (UTC) falls inside its row's iso_pre→iso_post window — pairing is genuine, not value-copied;
- `n_prompt=0, n_gen=512`, exactly 1 sample (`samples_ns` len 1 ⇒ r=1), `flash_attn=0`, `n_threads=4` on all 36;
- `n_gpu_layers` = 99 (A), 99 (B), 0 (C) on every row; `n_cpu_moe` = 0/99/0 as pinned;
- `no_repack=true` present in **every** counted cell's jsonl (the v1.2 `-nr` evidence field);
- `model_filename=/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` (sha `b07c8087…` logged on-device at session start, session.log:5) on all 36;
- max MemAvailable drop across all ship cells: **170,920 kB** (`k_b04_c5_B`) — 12× under the 2 GB cliff; most cells show a net *increase*.
- `SHA256SUMS` (420 entries): 413 verify in place; the 6 arm-D entries resolve under `arm_d/cells|probes/` and all 6 verify there. Zero mismatches.

### Gates (attack 2)

**F2 — REFUTED (attack fails): gates hold with per-cell raw evidence.**
- sha pins: impl `8adc148c…`, opencl `f4325483…`, stub `b2ae0fa6…` in **all 36** per-cell `*_sha.txt` probe files, AND logged per cell in session.log (`SHA k_bXX_cY_A impl=… opencl=… stub=…`) — stronger than the N10 session, where per-cell sha was code-only.
- Unplug per block: `AC powered: false` + `USB powered: false` (+Wireless false) archived in all 6 `block_0X_meta.json` `.unplug` fields and `probes/block_0X_unplug.txt`; unplug gate PASS lines in session.log.
- Wakefulness: **all 36** `_wake_prelaunch.txt` = `mWakefulness=Awake`. Exactly **one** `POST_wake ≠ Awake`: `k_b04_c5_B_POST_walk`… precisely `k_b04_c5_B_POST_wake.txt = mWakefulness=Dozing` — the excluded cell (F3).
- Cooldown: block-start temps 26.5 / 34.3 / 34.9 / **35.0** / 34.9 / **35.0** — all ≤ 35.0, `warm_start=False` correct everywhere. Blocks 4 and 6 sit exactly ON the gate boundary; legal per "≤ 35.0", and both metas record cooldown_s (244 s / 327 s) proving the gate actually polled down to the line. **No hidden warm-start.**
- Battery floor at starts: levels 100/96/92/88/84/80 — never near 40; no pause needed; `pauses/` empty is consistent (report says "no pause, 100%→76%", see F8 nit).
- Brightness readback **128**, `screen_off_timeout=900000`, wifi_on=1: `probes/session_pins.txt` + session.log:16.
- LOG_ALLOC-unset: RAW full `printenv` archived (`probes/log_alloc_unset.env.txt` + `.raw.txt`), `NO_GGML_ENV_VARS` — criterion 7's evidentiary requirement met, not transcription-only.
- Lock commit: `lock_commit.txt`, `state.json`, `session_pins.txt`, and session.log line 1 all carry `6183c77e45d275746b1aa5df023a0cc6bc6056` → **618323c** ✓ (criterion 11).

### Block 4 exclusion (attack 3)

**F3 — CONFIRMED (as correct behavior): the exclusion is honest and clean.**
- Raw: csv row seq 23, `excluded=True`, `exclude_reason=wake_post_not_awake:mWakefulness=Dozing`, `wake_pre=Awake`, `wake_post=mWakefulness=Dozing`, rc=0, wall_s=220.4 (< 600 s cap ⇒ rule 7 exclude, not rule 6), tg 5.259 archived in `cells/k_b04_c5_B.stdout.txt` and probes — kept out of the median but preserved in the archive, exactly as prereg rule 8 requires.
- Whole block dropped: state.json `complete_ids=[1,2,3,5,6]`. Recomputed medians from the 30 non-block-4 rows: block-4 values {5.259, 7.791, 14.113, 15.402, 15.756, 18.617} appear in **none** of the arm sets used.
- No other survivor has `wake_post ≠ Awake` (checked all 30 counted rows).
- Note: block 4's c6_A was still run after the exclusion (its data archived, unused). Wasteful but not prohibited — rule 8 says drop the block, collect extra blocks, which they did (blocks 5–6).

### Palindrome + timestamps (attack 4)

**F4 — REFUTED (attack fails): structure is clean.** Every block is exactly **A,B,C,C,B,A** (csv order × 6). Timestamps strictly monotonic across all 36 iso_pre values; inter-cell gaps 3–4 s; the only gaps >120 s are between blocks (189/249/309/327 s = cooldown polling to reach ≤35.0, each matching a block meta `cooldown_s`). seq_global 1..36 hole-free. Cells dir contains exactly 36 files, all referenced by csv.

### The C arm / THE REFUTE (attack 5 — most important)

**F5 — REFUTED (attack fails): C = 17.553 t/s is real; no inflation vector found.**
- C jsonl: `n_gpu_layers=0`, `n_cpu_moe=0`, `no_repack=true` (so **no** repack speedup — this is product-default CPU, not stock), `-t 4`, `-fa off`, 512 gen, single replicate, same GGUF, same impl/opencl/stub shas as A/B (per-cell sha probes identical pins).
- OpenCL banner appears in C stderr — the backend *initializes* at ngl 0, but zero tensors are offloaded; an initialized-but-unused context can only *cost* memory, never inflate decode. With ngl=0 no weight buffer lives on GPU, so no op can be scheduled there.
- Wall-clock consistency: C walls 27.3–34.6 s ≈ 512 tok ÷ 17–19 t/s plus fixed overhead — arithmetic coherent with avg_ts; no impossible speed.
- Temps: C is the hottest arm (median peak **39.95 °C** vs A 37.20 / B 39.40) — exactly the signature of sustained 4-core CPU load, not of an idle-GPU freebie.
- Cached mmap: page cache warms the *load*, which is outside the timed bench loop (`avg_ns` covers the generate pass only); A and B enjoy the same warmth anyway.
- Intra-block C1 > C2 decay (~15%, every block: 19.78→19.48, 18.58→15.26, 18.38→15.70, 18.09→15.73, 17.02→15.78) mirrors the thermal-decay pattern of A and B — behaves like a measured physical effect, not an instrument artifact.
- Corroboration: independent arm D (stock binary, repack ON) at ngl 0 got 16.48/15.51 t/s — same ballpark as C. Two different binaries agree that pure CPU ≈ 16–19 t/s on this model, i.e. faster than expert-on-GPU A. The refute is physically coherent.

### Arm D hygiene (attack 6)

**F6 — REFUTED (attack fails): D is quarantined.**
- Post-bag: bag closed 02:41:12 (session.log "N>=5 bag complete=5"); D deploy 02:41:12, cells launched 02:41:16 / 02:41:55, jsonl test_times 02:41:20Z-4 / 02:41:56Z-4 — strictly after block 6's last return (02:41:09).
- Separate dir `/data/local/tmp/s18stock` (script `one_cell_d.sh` hard-codes it; `cd || exit 90`), **never writes into s3oracle**; log confirms s3oracle impl still `8adc148c…` after D ("no restore performed" — nothing to restore, untouched).
- Stock pin verified on-device: log line "ARM D pins s18stock=bad17952…" + arm_d/runs.csv sha_impl column; `-nr` correctly absent from `one_cell_d.sh`.
- MemAvailable during D: drops of ~34,000 kB and ~23,000 kB — **no oomwall-class event**, the stock-repack risk did not fire.
- Labeling: `label=kexp_n5_armD_descriptive_never_ship`; separate runs.csv; not in any median (recomputed medians use only n5/runs.csv counted rows).
- Minor nit: no per-cell sha *probe file* for D (evidence is the session.log pin line + csv column). Acceptable for a never-ship arm; archive `d_cX_sha.txt` next time for symmetry.

### Ship-criteria walk (attack 7)

Recomputed independently from raw (full precision):

| # | criterion | result | evidence |
|---|---|---|---|
| 1 | ≥5 complete ABC-CBA | **PASS** | complete_ids [1,2,3,5,6]; 30 counted cells, 10/arm |
| 2 | median A/B ≥ 1.50 | **PASS** | A 14.252032 / B 7.904407 = **1.803049** |
| 3 | peakT A ≤ B + 0.5 | **PASS** | 37.200 ≤ 39.400 + 0.5 |
| 4 | median A/C ≥ 1.20 | **FAIL** | A 14.252032 / C 17.553288 = **0.811929** — A is *slower* than the no-offload baseline |
| 5 | unplug per block, Awake launch+return per counted cell | **PASS** | F2/F3 |
| 6 | no oomwall | **PASS** | max drop 171 MB « 2 GB; all rc=0 |
| 7 | pins + -nr + LOG_ALLOC unset evidenced | **PASS** | F1/F2 |
| 8 | screen/brightness/wifi/governor pins | **PASS** | session_pins.txt, per-block governor vectors |
| 9 | pause path + raw probes archived | **PASS** | no pause occurred; 420-file SHA256SUMS'd probe tree |
| 10 | no harness SIGTERM | **PASS** | all rc files = 0; no killall in logs |
| 11 | lock commit cited in session log | **PASS** | session.log:1 `lock=6183c77e45d275746b1aa5df023a0cc6bc6056` |

**Branch determination:** criterion 4 fails with **A < C** (0.812, not merely 1.0–1.20). Prereg: "If A ≤ C: **refute** the user-facing [dossier] claim" and "If A is … slower than C …: **refute**." The prereg's refute scope is the dossier "vs product default / no-offload" sentence; the expert-placement sentence (A vs B) separately PASSES its own floor (1.803 ≥ 1.50, A cooler than B by 2.2 °C). The recorded verdict — package does not ship, dossier sentence refuted, A-vs-B sentence supported, F6 interpretive clause not triggered (primary A/B 1.803 ∉ 1.40–1.50) — is **exactly** the prereg-mandated outcome. No branch-shopping detected.

Robustness checks (pre-declared, reported honestly): per-block mean(A)/mean(B) = 1.797, 1.789, 1.783, 1.736, 1.647 — declining trend but nowhere near collapse to 1.0; A-decay per block 20.4/13.5/24.3/28.7/31.2% with second-A cells retained (protocol violation would have been dropping them — not done).

## Additional findings (minor)

- **F7 — CONFIRMED (trivial):** the tasking summary's phrase "A-decay 20-31%" mis-compresses the report; block 2's decay is **13.5%**, honestly listed as such in both REPORT tables. The report is right; the summary is sloppy.
- **F8 — CONFIRMED (trivial):** report criterion 9 says battery "100% → 76%"; last counted csv `level_post` is **77**. Probably a post-session/post-D read; the number 76 is not in n5/runs.csv. Immaterial to any gate.
- **F9 — CONFIRMED (cosmetic):** csv `no_repack` column mixes `"true"` and `"True"` (row 23). jsonl fields are uniformly boolean true. Zero impact.
- **F10 — CONFIRMED (observation):** csv `wake_pre` records the *pre-wakeup* grep (four counted cells show `mWakefulness=Dozing` there: b01c1, b03c1, b04c6, b06c1); legality rests on the `*_wake_prelaunch.txt` rechecks, which are all Awake — prereg-compliant, but anyone auditing runs.csv alone would false-alarm. Document the field semantics or add a `wake_launch` column.
- **F11 — CONFIRMED (cosmetic):** SHA256SUMS lists arm-D files by bare name though they live under `arm_d/`; verification requires path inference. All 420 entries do verify.
- **F12 — PLAUSIBLE (dossier caution, not a defect):** arm D (stock, repack ON) came out *slower* (median 15.995) than C/product (17.553), contrary to the prereg's expectation that stock upstream would beat no-repack CPU on Q5_K/Q6_K trunk. D ran hot (40.5–41.6 °C) at end-of-session with n=2, so no conclusion either way — but the dossier must not quote D as "true upstream gap" without those caveats. The report currently quotes the raw numbers only; keep it that way.

## VERDICT SUMMARY

| # | Finding | Verdict | Severity |
|---|---|---|---|
| F1-F2 | instrument + gates attacks | REFUTED (evidence survives) | — |
| F3 | block-4 Doze exclusion | CONFIRMED (correctly executed) | — |
| F4 | palindrome/timestamp attacks | REFUTED | — |
| F5 | C-arm inflation attack | REFUTED — C is genuine; refute stands | — |
| F6 | arm-D containment | REFUTED (properly quarantined) | — |
| F7 | "20-31%" decay compression | CONFIRMED | trivial |
| F8 | 100%→76% vs csv 77 | CONFIRMED | trivial |
| F9-F11 | csv/probe cosmetics | CONFIRMED | cosmetic |
| F12 | arm-D interpretation risk | PLAUSIBLE (caution note for dossier) | minor |

## OVERALL VERDICT: **BANK**

Every claimed statistic reproduces exactly from raw instrument output (36/36 cells, unique files, in-window test_times, per-cell sha probes, raw env dump, SHA256SUMS'd probe tree); all six palindromic blocks are structurally perfect; the single exclusion (b04_c5_B, wake_post=Dozing) is pre-declared, archived, and provably absent from all medians; the C arm survives every inflation vector I could construct and is corroborated by the independent stock-binary arm D; and the recorded outcome — criteria 1-3 and 5-11 PASS, criterion 4 FAIL at A/C = 0.812 with A slower than C, hence **refute of the dossier sentence, package does not ship, A-vs-B sentence supported** — is verbatim what PREREG_KEXP_N5.md v1.2 commands. The findings are compression errors and cosmetics in summaries, none touching a measurement, a gate, or the verdict.
