# PREREG-LFM — per-backend prefill heat on LFM2.5-2.6B (retarget of the Qwen arms)

**Status: locked 2026-09-25 19:12 EDT, BEFORE any LFM heat arm ran.** The Qwen-arm predictions stay UNTESTED (this cell's `REPORT.md:64`: QRD8650 ≈ +1.2 °C; `:214` QRD8750 ≈ −1.2 °C; `:266` QRD7675 "no confident sign"); this file locks the LFM ones.

## Trigger / identity / protocol

- The Qwen path cannot pass validity: the app disables the governor whenever an mmproj is loaded
  (`REPORT.md:405-406: src/engine/LlamaService.ts:2433-2441 (at 0509f8c8): governorLoad requires
  !options.mmprojPath`; `:410-411: request is never pushed, and no arm can ever satisfy route_requested =
  arm, route_push = applied, route_mismatch = false`). Owner decision 2026-09-25: arms on LFM2.5-2.6B
  (`docs/ALIVE.md:589`; `PLAN.md:504: Heat arms run on LFM2.5-2.6B (no mmproj)`).
- Model: LFM2.5-2.6B, text-only → no mmproj → governor eligible. The arms run the SHIPPED catalog file
  `LFM2.5-2.6B-QAD-Q4_0.gguf` (not a K-quant repack): `/Users/marco/Projects/kalsa/src/engine/ModelRegistry.ts:272: id: "lfm2.5-2.6b"`, `:275: quant: "QAD-Q4_0"`, `:278: file: "LFM2.5-2.6B-QAD-Q4_0.gguf"`, `:279: sizeBytes: 1_593_894_944`, `:284: // text-only: no mmproj in the HF repo`; all priors below are on it.
  Pushed name+sha+size → PROMPT.meta before pair 1; an exact-size mismatch is the load gate that voided the Qwen arms.
- Boards: QRD8650 / Adreno 750 (4 pairs), QRD7675 / Adreno 732 (2 pairs) (`PLAN.md:510`; `REPORT.md:304-305`).
- Validity kept: `route_requested = arm`, `route_push = "applied"`, `route_mismatch = false`, chunk
  sum in [973, 1126] (`REPORT.md:211-212`); tools OFF (zero `KALSA_TOOLCALL`); fresh chat per arm,
  new-token target 1024 ±5 %; no cool-start gate — start skin recorded, `warm_start` flagged,
  cooldown only caps the wait ≤720 s (`REPORT.md:262-263`, `:305`); engine pause 43 °C / kill 44 °C
  (`PLAN.md:495`; pause/kill cite `REPORT.md:297`). ΔT per arm = HAL skin after − before (`REPORT.md:48-50`); contrast = ΔT(CPU) − ΔT(GPU).

## Measured LFM priors (in-app, forced GPU, 925 new tokens, ship quant)

QRD8650 / Adreno 750, S5b run 8 (sa808770); S5b quant QAD-Q4_0 — `scratchpad/agents/qdc-governor-s5b/PREREG.md:13: Model: /Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf,`:
- `scratchpad/agents/qdc-governor-s5b/REPORT.md:166: | A | 1 | 8504.842 | … | 21.212 | 925 | … | 30.519→43.227 | …`
- `scratchpad/agents/qdc-governor-s5b/REPORT.md:167: | B | 1 | 4294.885 | 4294.885 | … | 18.944 | 925 | GPU/CPU | FAST | 36.98→47.444 | …`
- `scratchpad/agents/qdc-governor-s5b/REPORT.md:175: B1/A1 = 4294.885/8504.842 = 0.505 = 1/1.980 (A/B=1.980×) …`

QRD7675 / Adreno 732, S5b run 9 (sa811420; same QAD-Q4_0 model as above):
- `scratchpad/agents/qdc-governor-s5b/REPORT.md:205: | A | 1 | 11769.454 | … | 16.975 | 925 | … | 28.18→40.718 | …`
- `scratchpad/agents/qdc-governor-s5b/REPORT.md:206: | B | 1 | 7423.184 | 7423.184 | … | 14.953 | 925 | GPU/CPU | FAST | 36.834→44.961 | …`
- `scratchpad/agents/qdc-governor-s5b/REPORT.md:207: | A | 2 | 12475.128 | … | 16.470 | 925 | … | 38.448→46.928 | …`
- `scratchpad/agents/qdc-governor-s5b/REPORT.md:208: | B | 2 | 7421.679 | 7421.679 | … | 14.857 | 925 | GPU/CPU | FAST | 36.956→46.631 | …`
- `scratchpad/agents/qdc-governor-s5b/REPORT.md:209: | A | 3 | 12543.090 | … | 16.346 | 925 | … | 38.405→47.571 | …`
- `scratchpad/agents/qdc-governor-s5b/REPORT.md:217: B1/A1 = 7423.184/11769.454 = 0.631 … B2/A2 = 7421.679/12475.128 = 0.595 … median = 0.613 … 1/median = 1.632`

Native cross-check, QAD-Q4_0, `-fa 0` (quant stated in each row):
- `scratchpad/agents/archive-gpu-cells/REPORT.md:435: | **Adreno 750** (QRD8650, job 797935 sa802004) | QAD-Q4_0, same flags | **284.18** | **23.42** | …`
- `scratchpad/agents/archive-gpu-cells/REPORT.md:437: | **Adreno 750** tuned CPU comparator | QAD-Q4_0, `-t 4`, … | CPU pp512 **98.97 ± 12.78** | CPU tg128 **28.58 ± 0.32** |`
- `scratchpad/agents/archive-gpu-cells/REPORT.md:432: | **Adreno 732** (7+ Gen 3, job 797795 sa801864) | QAD-Q4_0, `-ngl 99 -fa 0 -t 4` taskset f0, r=3 | **151.78 ± 1.12** | **17.26 ± 0.02** | …`

## Predictions (locked)

| board | pairs | CPU−GPU skin ΔT per pair | prefill ms @1024 tok, CPU / GPU | decode tok/s, CPU / GPU |
|---|---:|---|---|---|
| QRD8650 | 4 (CGGCGCGC) | CPU hotter: P1 (cold board, C first) ≈ +2.2 (range −1.0…+4.5); P2/P4 (G first, warm start) ≈ 0…+1; median ≈ +1.5 | 9,400 / 4,750 (linear from 8,505 / 4,295 @925) | 21.2 / 18.9 |
| QRD7675 | 2 (CGGC) | no confident sign: the two measured pairs straddle zero (+4.4 / −1.2); P1 (cold) ≈ +4, P2 ≈ −1; median ≈ +1.6 (range −2…+5) | 13,800 / 8,200 (linear from medians 12,475 / 7,422 @925) | 16.5 / 14.9 |

- Basis: same-turn contrasts on the quoted rows (all sources QAD-Q4_0, so none is "basis: other quant") — 750 +12.708 vs +10.464 = **+2.244 °C**; 732
  +12.538 vs +8.127 = **+4.411** and +8.480 vs +9.675 = **−1.195**. Measured prefill ratios
  0.505 / 0.613 → GPU prefill saves ~50 % / ~39 % of wall time.
- The 732 pairs disagree because the CPU rise tracks its start skin: the same CPU workload rose
  +12.5 from 28.2 °C (A1) but +8.5 / +9.2 from 38.4 °C (A2/A3) (`:205`, `:207`, `:209`).
  Alternation is the control; a matched-start contrast ≈ 0 is expected if the 750's +2.2 is
  start-temp artifact rather than backend heat.
- Falsifiers: 750 median ≤ 0 refutes the +2.2 point; 732 contrast > +5 or < −2 refutes its range; prefill
  ratios outside 0.45–0.60 (750) / 0.50–0.75 (732), or decode spread > 20 %, are off-prior. Decode is CPU
  in both arms (the 18.9–21.2 / 14.9–17.0 t/s spread is context overhead, not route); n = 1 and n = 2
  measured pairs make this descriptive, with no routing conclusion.

---

## Pre-run amendment (2026-09-26)

**Chunk band: [973, 1075]** — ±5 % of 1024 (1024 × 0.95 = 972.8 → 973;
1024 × 1.05 = 1075.2 → 1075).

The "Validity kept" bullet above prints `[973, 1126]`: 1126 is +10 % of 1024,
contradicting the same bullet's stated `new-token target 1024 ±5 %`. The
1126 upper edge was an arithmetic slip (1024 + ~10 %), not a protocol choice;
the ±5 % figure is the rule the protocol states and the rule the driver gates
on (`CALIB_BAND_FAIL`, parse.sh token-band gate, both since 2026-09-25).

No LFM heat run has happened (the 2026-09-26 session was never opened —
REPORT "NOT OPENED"), so this correction is written before any data existed.
The driver gate was already [973, 1075]; nothing is loosened or tightened for
future runs. The predictions above are untouched by this amendment.
