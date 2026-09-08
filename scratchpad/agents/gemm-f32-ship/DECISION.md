# DECISION — enable the governor's GPU prefill route on V75 (Adreno 750)

**Decided by the owner on 2026-09-07, on the numbers of ALIVE 60.**
Recorded here because rule **R6** of the logit-oracle protocol (cell `logit-oracle`,
PREREG §Rules) says: *"No automatic promotion: a PASS is reported; enabling GPU prefill on
a generation in production is the owner's decision on the numbers."* This is that decision.

## What is being changed

`src/engine/governorInputs.ts`, `GPU_PREFILL_CORRECT.V75`: **false → true**.

Consequence in production: on a phone identified as V75 (`SM8650` / `PINEAPPLE` /
`QRD8650`), and only when the RAM fit gate returns `Fit`, the governor may route a turn's
**prefill** to the GPU. Decode is unaffected — it never used this kernel and stays on the
CPU (ALIVE 58). The thermal policy is unaffected: at WARM (~38 °C) the runtime still
degrades the turn to CPU prefill, verified live in S5 run 5 (ALIVE 48).

## The evidence it rests on

Measured 2026-09-07, QRD8650 / Adreno 750, unit `36aa3b71`, QDC session 808521 job
`sa812590d`, APK `6fc14d1` (app `8269aa2` + fork pin `67c73d26c`), shipping model
LFM2.5-2.6B-QAD-Q4_0. Same board and same 32-step teacher-forced protocol that produced
the original FAIL in ALIVE 55.

| quantity | before (ALIVE 55) | after (ALIVE 60) |
|---|---|---|
| top-1 flips where the CPU is confident | **8/32** | **0** |
| median \|Δp₁\| | 0.0861 | 0.0014 |
| median max\|Δlogp\| | 3.444 nats | 0.3037 |
| steps with \|Δp₁\| > 0.02 | 21/32 | 8/32 |
| GPU prefill vs CPU (925 tokens) | 1.78× | 1.242× |

Physical cause and cure: the Adreno q4_0 GEMM computed its **product** in half. It now
computes it in f32 (fork `67c73d26c`); five other candidate causes were refuted by
measurement (ALIVE 56/57/59).

## What is knowingly accepted

State it plainly, because a promotion that hides its caveats is worthless:

1. **The raw oracle verdict is still `FAIL rule=R2`.** R2 demands |Δp₁| ≤ 0.02 at *every*
   one of 32 steps; same-top after the fix is 94.8 %, not 100 %. The PREREG registered this
   expectation *before* the data. The decision is therefore explicitly made on the effect
   size, not on a green light from the binary gate.
2. **n = 1 pair, one board, one physical unit.** No replication.
3. **Only q4_0 is measured.** The high-RAM tier is recommended `qwen3.5-4b` Q4_K_M, whose
   prefill uses `gemm_noshuffle_q4_k_f32.cl`. That kernel has received the same fix but
   **nothing about it is measured** — neither fidelity nor cost (PREREG Amendment 1).
   Enabling V75 therefore enables a GPU prefill path that is measured for the low/mid-tier
   model and unmeasured for the high-tier one.
4. **732 / 735 / 8 Elite were not re-measured** with the corrected kernel. V73 stays false.
5. The speed gain is **1.24×, not the 1.78× on the marketing slide** — that number was
   bought with a model that answered differently.

## What would reverse it

Any of: a replication that does not reproduce the collapse; a q4_K measurement showing the
high-tier path is still infidel; a field report of divergent output on a V75 phone.

## Provenance

Numbers: `scratchpad/agents/gemm-f32-ship/REPORT.md`; raw
`scratchpad/agents/qdc-governor-s5b/raw/sa812590d/` (`results.tsv`,
`8-Gen-3_{A,B}_t1_probs.jsonl`). Rules: cell `logit-oracle` PREREG, R1-R6.
