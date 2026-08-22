# AUDIT REPORT — armC-lineup-audit (hostile data audit, S23 session 2026-08-22, queue #20 + #6-lite)

Auditor: hostile/paranoid. Read-only (this report is the only write).
DATASET 1: `results\olmoe_gpu_moe_s23\armC\` + `scratchpad\agents\olmoe-armC\REPORT.md` — OLMoE A-vs-C decision cell (exploratory-registered).
DATASET 2: `results\lineup_abs_s23\` + `scratchpad\agents\lineup-abs\REPORT.md` — product-card absolutes.

---

## DATASET 1 — OLMoE armC decision cell

### Instrument truth

**F1 — REFUTED (attack fails).** Programmatic cross-check, **12/12** rows:
- csv `tg512` == jsonl `avg_ts`; sha256 of all 12 stdout files unique; every jsonl `test_time` inside its iso window;
- `n_gpu_layers` = 16 (A) / 0 (C) on every row (`n_cpu_moe=0` correct for plain `-ngl 0`); `no_repack=true` everywhere; `flash_attn=0`, `-t 4`, single sample (r=1), 512 requested and 512 generated;
- `build_commit=7686ca6fc` (HEAD) in all 12 jsonl — pins impl `8adc148c…` / opencl `f4325483…` / stub `b2ae0fa6…` in all 12 per-cell sha probes;
- model GGUF sha `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` verified on device (`probes/sha_olmoe_gguf.txt`);
- timestamps monotonic, ACCA order ×3, seq 1..12 hole-free, rc=0 ×12.
- Independent recompute agrees with the session's own `_verify_medians.txt`: med A **20.033697**, med C **27.685471**, A/C **0.723618** → displayed 20.034/27.685/0.724 exactly. Peaks 35.85/36.30. All claimed stats reproduce.

### Gates

**F2 — REFUTED (attack fails).** Block-start temps 25.8 / 33.4 / 34.5 °C — all ≤35.0, `warm_start=False`, cool-start claim TRUE. Wake: all 12 prelaunch + 24 PRE/POST probes `Awake`. Unplug headers in all 3 block metas. Brightness readback **128** archived PER CELL (PRE+POST — stricter than prior sessions). LOG_ALLOC-unset RAW printenv archived. `SHA256SUMS`: **168/168 verify**. Battery 62→55, floor never approached, ledger table reconciles with charge_counter columns.

### Cross-build caveat

**F3 — CONFIRMED (adequately handled).** The report states it twice and in the right direction: "**Never compare C against the old n10 A numbers**", "HEAD_BUILD … NOT the old OLMoE-N5 pin `2ed2e48a`", "A is RE-MEASURED in-session". This matters more than usual: n10's old-build A median was 16.356 t/s; this head-build A median is 20.034 t/s — the same *nominal* arm moves ~22% across builds, and n10's B (experts-CPU, trunk-GPU, old build) was 10.53 while head-build pure-CPU C is 27.69. These trees must not be mixed, and the report forbids it. No mixing sentence found anywhere in the report.

### The declining per-block ratio 0.809 → 0.606

**F4 — REFUTED (decision survives every pruning I tried).** Recomputed per block:
- b1 0.8093 (A-decay 13.0%), b2 0.7640 (17.5%), b3 0.6061 (22.5%) — claimed values exact.
- The decline is entirely A-side collapse (A: 25.71→14.07 across session; C stays 24.39–29.77 in a flat band). C never degrades.
- **Bias-direction honesty:** the palindrome's quadratic load sits on A, which *depresses A* and therefore *flatters* the "C beats A" decision — the anti-conservative direction for this particular call. So I stress-tested the decision against that bias:
  - coolest/cleanest block only (b1): ratio **0.809** — C still wins by 19%;
  - drop the hot block 3 entirely: **0.769**;
  - per-block best-cell duel (A's *first*, least-penalized cell vs C's *best* cell): 25.71 vs 29.77 / 21.91 vs 27.96 / 18.15 vs 27.42 — **C wins all three duels**;
  - global min C (24.389) < global max A (25.711), but the claim was "per block", and per block it holds (minC>maxA true in b1/b2/b3).
- The decision "C > A robustly" is invariant under every subset a hostile reviewer can construct. Median-based A/C 0.724 cannot be rescued for A by any cooling argument.

### Peak-temp / "cool mode" framing

**F5 — CONFIRMED (framing overreach; correction required).** This dataset supports: median peak A **35.85** vs C **36.30** — A cooler by only **0.45 °C**, and **max peaks are identical (38.5 = 38.5)**; per-block mean peaks converge to parity by block 3 (~0.65 → ~0.45 → ~0.30 °C). That is thermal *near-parity*, not a "cool mode". The 2.75 °C gap that motivates the cool-mode frame is KEXP's (37.2 vs 39.95) — a different model. The report prints the honest numbers (including maxT columns) but the one-liner "GPU = cool mode" as written extrapolates KEXP-strength thermal separation onto a 0.45 °C OLMoE delta. What THIS dataset supports: "on OLMoE, full-GPU is slower than pure CPU (A/C 0.724) and runs at approximately thermal parity (−0.45 °C median peak, identical maxima)". Same qualitative speed verdict as KEXP A/C (0.812): **supported**.

---

## DATASET 2 — lineup absolutes (#6-lite)

### The gate wrap

**F6 — CONFIRMED with a latent-enforcement caveat.** `one_cell_lineup.sh` audited line by line:
- HARNESS gate: reads own `/proc/self/{cpuset,cgroup,status}` via `read_self_cpuset`, applies the F4.3-bis predicate (nproc≥6 ∧ bits≥6 ∧ cpuset/cgroup ∉ {background, system-background, moderate}), **exits 93 before launch** on failure — semantics enforced ✓.
- BINARY side: wrapper launches detached, resolves the real binary pid (`pidof bmoe-cli.CAMPAIGN` → fallback child-of-subshell scan; `*_pids.txt` records both wrapper and binary pid — it does **not** naively read the shell), then reads `/proc/<bin_pid>/cpuset|status|cgroup` and writes `<tag>_BIN_cpuset.txt` with a `binary_gate … why=` verdict line.
- **Caveat (latent, not triggered):** a binary-side violation is *detected and recorded* (`FAIL_CPUSET BINARY` → `<tag>_BIN_why.txt`) but the wrapper neither exits 93 nor kills — "Do not SIGTERM… Host will exclude." If the PC host did not check `BIN_why.txt`, a restricted-cpuset rep would silently enter the median. Tonight this is moot: all **10/10** BIN probes (9 counted reps + the excluded CAMPAIGN attempt) read `cpuset=/ list=0-7 nproc_bits=8 why=OK`, and zero `BIN_why.txt` files exist. Fix before the next campaign: make the host exclude on `BIN_why.txt` existence, explicitly.
- Quirk noted: harness shell reports `nproc=6` while mask is 0-7 (bits 8) — gate needs ≥6 on both, passes either way; the binary-side bits (8) is the validity artifact and is recorded per rep.

### EOS-truncated generations

**F7 — REFUTED (attack mostly fails; one caveat stands).**
- The csv `tok_s` is bmoe-cli's own decode-rate line ("generation: 122 tokens, 0.122 s/token (8.199 tok/s)"); TTFT (9.419 s), prefill (108 tok / 5.290 s) and model load (4.129 s) are reported separately — **the decode metric excludes warm-up/prefill/TTFT** by construction, not by assertion.
- 122/224/222-token stops are deterministic EOS at temp 0 — identical across reps, so reps are comparable; wall windows (30–60 s) reconcile with TTFT + n_gen/tok_s arithmetic.
- Caveat that stands: 122 tokens ≈ 15 s of decode is a short steady-state window, and a product-card number built from it inherits prompt-specific MoE routing/cache behavior (hit 44.3%). It is fairly labeled as decode-to-EOS on one canonical prompt, not as tg512 — the report says so — but the card should carry the token count.
- Sanity: r1-vs-r3 Marco spread is tiny (8.206/8.199/8.037) despite cache-state differences — warm-up effects do not dominate the median.

### Config provenance

**F8 — REFUTED (provenance claims hold).** Against `docs/ALIVE.md`:
- CalaQwen measured flags byte-match the ALIVE "CalaQwen campaign config" (`-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm`), and "d=1.0 no-renorm is current" is ALIVE's own words (l.206) — the report's "current default" claim is documented, not invented.
- Marco = base streaming recipe without drop flags, explicitly labeled "k6, no drop".
- Mellum2 = d1.0 renorm-ON, flags listed verbatim (ALIVE notes Mellum2 p-values do not support the CalaQwen no-renorm config — consistent).

### Sha discipline

**F9 — REFUTED.** csv `sha_bin` per row matches probe files: CAMPAIGN `1ca51420…` (Marco + Cala rows, and the failed Mellum attempt), dedicated `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c` for all counted Mellum2 rows (`probes/mellum2_r1_bin.sha`, directory listing confirms its private .so set). Model shas in notes: Marco `2f921958…` (probe-verified, 6385238848 B), Mellum2 `b04281c2…` (probe-verified), CalaQwen cached `ac44e20c…`. Minor: `*_bin.sha` probes exist only for r1 of Marco/Mellum2; other reps rely on the csv column.

### Spread claims

**F10 — REFUTED.** Recomputed (max−min over median): Marco 0.169/8.199 = **2.06% → "2.1%"** ✓; Cala 0.512/6.810 = **7.52% → "7.5%"** ✓; Mellum2 0.218/5.098 = **4.28% → "4.3%"** ✓. Medians 8.199 / 6.810 / 5.098 recompute from the 3 reps each.

### Card-vs-measured deltas

**F11 — REFUTED (all three explanations check out).**
- Marco 8.199 vs card 8.82: the card number carries a provenance-gap flag *inside ALIVE §5 itself* ("lack a reopenable runs.csv"), and the aboard file is the 6.4G KEXP GGUF (`2f921958…`), not the i1-Q4_K_M the card implies. Report flags non-comparability explicitly ✓.
- CalaQwen 6.810 vs card 5.86: card was **k6d065** (retired 2026-08-18 per ALIVE), measurement is the current k6d1.0-no-renorm default — flagged ✓, and the direction (measured faster) is consistent with d=1.0 being −12.9% time vs d=0 on ALIVE's own table.
- Mellum2 5.098 vs 5.151: within the measured spread [4.977, 5.195] ✓, and the report correctly notes the counted cells used the dedicated mellum2 binary after `bmoe-cli.CAMPAIGN` refused the arch (`error: no MoE recipe for architecture 'mellum'` — archived in `cells/mellum_r1.err.tail.txt`, row excluded=True).

---

## Additional findings (minor)

- **F12 — CONFIRMED (cosmetic):** stray top-level `cells_marco_r1.out.txt` (+`.rc`) is a byte-identical duplicate of `cells/marco_r1.*` — archive hygiene only.
- **F13 — CONFIRMED (observation):** rep spacing is fixed 90–150 s scheduling, not a temperature-gated cooldown; temps drifted to 36.8 °C by CalaQwen r3. No gate was defined for #6-lite and the report claims only "cooldowns"/spacing — acceptable for an absolutes card, but do not describe this as gated cooldown.
- **F14 — CONFIRMED (trivial):** report criterion text "Battery 62% → 48%" reconciles (armC ended at 55; lineup started at 54 — one point between sessions; last Mellum2 rep ends 48). Floor 40% never approached, matching the tasking.
- **F15 — CONFIRMED (minor):** the binary-side gate's detect-without-enforce design (F6) plus the missing `run_bench.sh exit 93` history means the *harness-level* guarantee currently rests on one_cell_lineup.sh alone; keep that file as the single gate path or backport exit 93 into run_bench.sh.

## VERDICT SUMMARY

| # | Finding | Verdict | Severity |
|---|---|---|---|
| F1-F2 | armC instrument + gates | REFUTED (evidence survives) | — |
| F3 | cross-build caveat present and binding | CONFIRMED (handled) | — |
| F4 | 0.809→0.606 trend attacks decision | REFUTED — decision robust under all prunings | — |
| F5 | "cool mode" on OLMoE | CONFIRMED — overreach; 0.45 °C, identical maxima | **correction required** |
| F6 | cpuset gate wrap | CONFIRMED working tonight; binary side detect-only | latent fix |
| F7 | EOS-truncation fairness | REFUTED (TTFT excluded by construction); short-window caveat noted | minor |
| F8-F11 | provenance, shas, spreads, card deltas | REFUTED (all hold) | — |
| F12-F15 | duplicates, spacing semantics, battery, gate path | CONFIRMED | cosmetic/minor |

## OVERALL VERDICT: **BANK-WITH-CORRECTIONS**

Both datasets are sound as labeled — instrument truth, gates, shas, and every recomputed statistic check out, and the two headline claims survive their strongest attacks (armC: C>A in every cell of every block under any pruning, so the decision stands; lineup: gate genuinely read the binary's pid cpuset, `why=OK` ×10, and all three card deltas have verified explanations). Corrections before banking: (1) rewrite the OLMoE framing from "GPU = cool mode" to "GPU slower (A/C 0.724) at near-thermal-parity (median −0.45 °C, identical max peaks)" — the cool-mode frame is KEXP-derived and this dataset does not carry it; (2) make the host exclude on `BIN_why.txt` or add exit-93 enforcement on the binary side of the cpuset gate before the next campaign; (3) carry n_gen (122/224/222) on the product card next to the tok/s figures.
