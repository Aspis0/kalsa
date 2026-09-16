# Per-phase energy findings — Jelly Star / Helio G99 baseline (2026-09-15)

Ground truth for every number below: the four regenerated sidecars
`device-ngram-spec-out/*.phases.csv` (schema `kalsa-energy-rep-v2`, written by
`scripts/energyPhaseSplit.mjs` at commit `cc612ef`) and the campaign aggregate
(`node scripts/energyAggregate.mjs device-ngram-spec-out`). Nothing here comes
from an earlier draft of the split: the v1 numbers were retracted and are
quoted only as the retraction story (§4).

## 1. What this measures

Per-phase energy disaggregation of LLM decode on the Jelly Star (MediaTek
mt6789 / Helio G99). The sampler reads battery-terminal `|V*I|` at ~1 Hz
nominal cadence (gauge ~1 s smoothing; observed per-stem cadence max 1.06 s on
the 1.2B stems, 3.0–3.5 s on the 2.6B stems — published per row as
`cadence_max_s` with a warning past 2 s). Models: LFM2.5 1.2B Instruct and
2.6B, both Q4_K_M, `--temp 0`, `arms=none`, REPS=3, two prompt styles per
model (PURE: short prompt, EOS-truncated; REP: longer prompt, capped at 256
generated tokens). Campaign date 2026-09-15 (preflight gates verified
discharging on every arm before sampling started). Counts come from the
committed manifest, never a guess.

## 2. Method in five lines

1. Decode is anchored to the rep END: `decode_s = gen_tokens / gen tps` from
   the rep's own speed line (perf eval-time ms when present — none in this
   campaign), so `decode = [mark_N − decode_s, mark_N)`.
2. Token counts come from the committed manifest
   (`scripts/fixtures/energy-counts/manifest.csv`; SSE-timings provenance in
   `scripts/fixtures/energy-counts/README.md`), cross-checked against each
   rep's speed line.
3. The decode bucket is exactly the intervals fully inside
   `[decode_start, mark_N)`: the straddle interval goes to `j_pre` in full and
   the tail partial interval to no bucket. The partition is exact — raw
   `j_pre + j_decode − whole-window J` ≤ 2.84e-14 J on all 12 reps, verified
   by two independent re-integrations (audits R3 and R4, own parser and
   integrator each, no repo module imported).
4. `decode_s_int` and coverage = `decode_s_int / decode_s` are published per
   row; a low-resolution warning fires below 3 attributed intervals or
   coverage < 0.7.
5. The metric stays RELATIVE battery-terminal: `j_pre + j_decode` equals the
   whole-window J exactly, and `j_pre` (model load + inter-rep idle + prompt
   eval) carries the floor dilution by design.

## 3. Results

Per stem: generation throughput per rep (the run's own speed line), decode
energy per generated token (`j_per_tok_decode`), decode coverage
(`decode_s_int / decode_s`), and row warnings. All cells verbatim from the
sidecars.

| stem | rep | gen t/s | decode_s | J/decode-tok | coverage | warnings |
|---|---|---|---|---|---|---|
| 1.2B none PURE | 1 | 9.1 | 3.297 | 0.184 | 63 % | low-resolution (2 intervals) |
| 1.2B none PURE | 2 | 9.0 | 3.333 | 0.183 | 62 % | low-resolution (2 intervals) |
| 1.2B none PURE | 3 | 9.1 | 3.297 | 0.242 | 94 % | — |
| 1.2B none REP | 1 | 8.4 | 30.476 | 0.293 | 95 % | — |
| 1.2B none REP | 2 | 8.4 | 30.476 | 0.293 | 95 % | — |
| 1.2B none REP | 3 | 8.4 | 30.476 | 0.295 | 95 % | — |
| 2.6B none PURE | 1 | 3.9 | 52.308 | 0.672 | 97 % | cadence max 3.020 s |
| 2.6B none PURE | 2 | 3.9 | 52.308 | 0.629 | 97 % | cadence max 3.020 s |
| 2.6B none PURE | 3 | 3.9 | 52.308 | 0.608 | 97 % | cadence max 3.020 s |
| 2.6B none REP | 1 | 3.6 | 71.111 | 0.646 | 99 % | cadence max 3.520 s |
| 2.6B none REP | 2 | 3.6 | 71.111 | 0.645 | 99 % | cadence max 3.520 s |
| 2.6B none REP | 3 | 3.6 | 71.111 | 0.653 | 98 % | cadence max 3.520 s |

**The headline**: the cross-stem cost of doubling the model, read the only
sanctioned way (REP-vs-REP, paired per rep), is **2.20–2.21x per decode
token** (r1 0.646/0.293 = 2.20, r2 0.645/0.293 = 2.20, r3 0.653/0.295 = 2.21;
2.21x on decode-J sums, 497.675/225.518 J). Rep-to-rep spread inside each arm
is ≤ 1.3 % (1.2B: 0.293–0.295; 2.6B: 0.645–0.653), so the ratio is stable
across reps.

The PURE arms are a different story: 1.2B/PURE r1 and r2 are flagged
low-resolution (2 attributed intervals, coverage 62–63 %) and their cells
must not be quoted against another stem. The implied PURE-vs-PURE cross-stem
ratio (~3.1x, mean of per-stem means; per-rep 2.51–3.65) is **not usable** —
the flagged 1.2B buckets truncate 37–38 % of the nominal decode span, which
pushes their J/tok down and any ratio against them up. 2.6B/PURE is not
flagged (97 % coverage) but stays out of cross-stem statements by the rule in
§5.

## 4. The bias story, told honestly

- **The v1 numbers are retracted.** v1 (commits `572d3be`/`f936c16`, never
  published) placed the prefill/decode boundary at `window_start + prompt-eval
  duration`. The run's startup — inter-rep sleep, process spawn, model load —
  sits before that point, so the v1 "prefill" bucket was inter-rep idle
  (0.03–1.1 W) in 8/12 campaign reps and the published decode J/tok carried
  load + prefill + decode: inflated 12–153 % against the mark-anchored
  recompute (+111–153 % on the short-EOS 1.2B/PURE stems, +12–20 % on the
  long stems; audit `ENERGY-PHASE-AUDIT-2026-09-15`, F1/F2, NO-SHIP). v2
  re-anchors the split to the rep end; every number in §3 is v2.
- **Within the 1.2B model, the prompt-arm delta is convention-dependent.**
  REP vs PURE per decode token reads 1.59x (r1) and 1.60x (r2) on the flagged
  reps, but 1.22x on the only clean PURE rep (r3, 94 % coverage). The
  flagged PURE buckets are sampling-granularity dominated: a different
  sample phase would move the published figure by double-digit percent. That
  is exactly what the low-resolution warning is for — short-decode buckets
  are fragile, and the warnings, not the stem name, decide whether a cell is
  quotable.
- **What remains biased even in clean rows.** `j_decode` is a lower bound on
  the nominal `[decode_start, mark_N)` span, short by at most two sample
  intervals (straddle → `j_pre`, tail gap → no bucket); at 95–99 % coverage
  the truncation is a few percent of the bucket. `w_decode` includes the
  boundary sample whose interval energy is in `j_pre`, so it is
  deliberately not `j_decode / decode_s`. Absolute joules are diluted by the
  load floor in `j_pre` by design — see the contract below.

## 5. Usage rules (the contract)

1. **Between-arm deltas of the same stem are the sanctioned read** — same
   model, same prompt, different arm, identical arithmetic per arm. This
   baseline campaign ran `arms=none` only, so it contains no arm deltas; it
   is the reference future arm campaigns diff against.
2. **Cross-stem statements are REP-vs-REP only**, with the arm label and the
   coverage caveat attached, or they stay out of a report. The sanctioned
   figure from this campaign: 2.6B/1.2B = 2.20–2.21x per decode token.
3. **Decode J is a lower bound**, biased low by at most two sample
   intervals; coverage per row says how much of the nominal span the bucket
   actually integrated. Read `decode_s_int` before comparing arms whose
   decode lengths differ.
4. **Absolute J/tok is not quotable from the whole window**: `j_pre`
   (load + idle + prompt eval) carries the floor dilution by design, so
   whole-window J/token runs smaller than the physics. The decode bucket is
   the closest thing to an absolute figure this harness produces, and even
   it is convention-dependent below full coverage.

## 6. What this unlocks

- **Tema 3 (speculative gating) has its baseline**: decode J/token on the
  1.2B/REP stem, 0.293–0.295 J/tok at 95 % coverage (2.6B/REP: 0.645–0.653).
  A gating arm that skips draft work must show its per-decode-token delta
  against exactly this number, same stem, same protocol.
- **Next steps**: replicate on the Galaxy S23 with the same protocol (same
  manifest discipline, same coverage gates) to see whether the 2.20–2.21x
  ratio and the coverage profile transfer. Prefill-only J stays out of reach
  at 1 Hz with the model load inside the window — it needs an in-engine phase
  timestamp (Fase 2 bus) rather than a sampler-side fix.

## 7. Provenance

- Code: commits `2dbc9a9..cc612ef` (branch `energy-framework`): schema module
  + CodeCarbon-compatible export; per-phase split tool; aggregate
  `*.phases.csv` skip + exact token counts; rep-end re-anchor with guards
  (audit F1–F8); CI wiring of both harnesses (F9); decode coverage published
  (audit R1–R6).
- Audits: `ENERGY-SCHEMA-AUDIT-2026-09-15` (SHIP),
  `ENERGY-PHASE-AUDIT-2026-09-15` (NO-SHIP — retracted v1),
  `ENERGY-PHASE-AUDIT-R3-2026-09-15` (NO-SHIP, narrow — forced the
  rep-end re-anchor follow-through),
  `ENERGY-PHASE-AUDIT-R4-2026-09-15` (SHIP with non-blocking notes N1–N6;
  sidecars byte-identical to a fresh run of the committed code).
- Campaign raw data: `device-ngram-spec-out/` (sampler CSVs, `.marks`,
  per-rep `_rN.txt` speed lines, `results.txt`); between-arm aggregate via
  `node scripts/energyAggregate.mjs device-ngram-spec-out`.
- Token counts: `scripts/fixtures/energy-counts/manifest.csv`, method of
  record in `scripts/fixtures/energy-counts/README.md` (server SSE
  `timings.prompt_n`/`predicted_n` from a diagnostic build; pristine
  binaries md5-pinned, the patch never committed).
