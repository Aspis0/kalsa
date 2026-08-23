# REVIEW_DOC — hostile pass on q37 REPORT

Be hostile. Quality, scope, deleted evidence, harness mismatch.

## CONFIRMED (already scoped in REPORT; no silent overclaim)

1. **Winner GGUFs on disk are control, not B′.** NPU-legal IQ4_NL/Q4_0/Q8_0 files were deleted after A/B per the disk rule. Size/type/NPU tables survive in `verify/` and `npu/`. Recook would need the source again.
2. **LFM cook is Q8_0-from-Q8_0, not F16-from-F16.** Control *size* matches shipped; expert identity vs the F16 KEXP is **not** claimed.
3. **OLMoE A/B is llama-cli, not the q36 bmoe-cli harness.** bmoe-cli: `no MoE recipe for architecture 'olmoe'`. We did not patch the WIP. Quality on OLMoE is a floor effect anyway.
4. **LFM visible answers are mostly empty `text`.** Always-think dumps into `reasoning`. Scoring used `ANSWERS_EXTRACTED.md`. Long-suite instruction gates are not usable.
5. **Marco Q8_0 from source still fails q1.** The q36 "Q8_0 is the quality candidate" guess is **refuted** on the only clean discriminator, not confirmed.
6. **Get-FileHash false FAIL** on the first Marco SHA (empty hash, same-second timestamp). Python hashlib matched `3287457a…`. Subsequent downloads use `sha256.py`.

## PLAUSIBLE (not patched)

- IQ4_NL vs Q4_0 quality: same size, Marco same q1 PASS / same code FAIL. Calling IQ4_NL the "size default" is a convention (usually slightly better than Q4_0 at ~4.5 bpw), not a measured win over Q4_0.
- LFM expert sha vs shipped F16 cook: not compared (source was Q8_0). Size match is not identity.

## REFUTED

None of the REPORT's scoped claims (from-source, three models, desk NPU, disk ≥40 GB, experts byte-identical *within* each model's four arms).

## Patch list applied to REPORT before this file

Rec line already says "not a universal default", LFM Q8_0 vs F16, OLMoE llama-cli, always-think, +64 B, Get-FileHash. No further patch required after this pass.
