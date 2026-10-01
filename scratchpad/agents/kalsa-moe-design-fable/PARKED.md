# Kalsa MoE prune - PARKED (owner, 2026-10-01)

Owner decision 2026-10-01: the plan is good but costs more than expected (realistic total $65-90). Parked until
after the alpha, when user interest justifies it. No Runpod spend until the owner reopens it.

## Where everything is

- Design: `DESIGN.md` (REAP on a 7-domain calibration, 128/layer, quant artifacts PC ~10.7 GB / phone ~8.7 GB).
- Plan audit that amends the design: `AUDIT-PLAN-2026-10-01.md` (verdict: approve with changes, section 7).
- Evidence: `../moe-expert-usage-v3/` (routing-mass keep-sets, audited), `../moe-keepset-128/` (128-average and
  per-layer allocation, audited, corrections appended), `../razor-italian-loss/` (a public prune lost Italian).
- Phase 0 (Mac, $0): `../kalsa-reap-prep/PHASE0-CALIB.md` (calib-v2, 7 x ~450k tokens; data in
  `~/kalsa-models/reap-calib-v2/`, hashes in `CALIB-V2-MANIFEST.sha256`) and `PHASE0-EVALS.md` (HumanEval+, FLORES
  chrF++/wrong-language, GSM8K-IT, gate fixes) with their audits `AUDIT-PHASE0-CALIB.md` and `AUDIT-PHASE0-EVALS.md`.

## Resume checklist (in order, all $0 on the Mac until step 7)

1. Confirm the phase-0b fix round (B1 fail-open stop rule, B2 gameable HumanEval+ scorer, B3 pod budgets,
   B4 FLORES truncation) is committed, then re-audit it with a non-GLM model.
2. Apply the calib-v2 audit findings; add the templated `chat` domain (thinking traces + tool dialogues, five
   languages), reuse it for the imatrix.
3. Add stop rules S0 (harness sanity), S5 (BFCL v3 multi-turn, 150 episodes, loop rate), S6 (knowledge MC in
   IT/FR/ES/EN/ZH) and define "beats" for S3.
4. Write the Super-Expert guard rule down.
5. Add the routing-mass/MSAN keep-set arm next to REAP; export nested 128 within 160 within 192 keep-sets.
6. Keep MTP: export a pruned MTP head with the same keep-set (replaces the `--no-mtp` GGUF step).
7. Owner budget OK, then one pod: prune arms + public controls (crucible-labs REAP-48-v2, anik-jha coding-reap50).
8. Healing only if the training-free best arm passes S0/S1/S5/S6: cached top-64 teacher logits, LoRA + router,
   cap $30 / stop $40.

Rejected by the owner, do not re-propose: keeping all experts with a hot/cold resident+streamed split (months of
research for a doubtful result).
