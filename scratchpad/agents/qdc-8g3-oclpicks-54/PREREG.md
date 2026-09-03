# PREREG — Cell #54: OpenCL picks A/B on QRD8650 (Snapdragon 8 Gen 3 / Adreno 750)

Date: 2026-09-03. **This cell inherits the ENTIRE preregistration of cell #53**
(`../qdc-8g2-oclpicks-53/PREREG.md`, including Amendment 1 on fragmented ABBA)
with exactly these deltas:

1. **Device: QRD8650 (8 Gen 3, Adreno 750)** instead of HDK8550. Reason:
   the HDK8550 queue starved (>35 min in Submitted, job 797850 cancelled
   unbilled). The Adreno 750 is ALSO an A7x-family GPU — the declared target
   of pick b7a5e926b — and the 750-class is a shipped-phone class in its own
   right.
2. **Scope of the verdict**: Q1/Q2 and grid G1-G4 apply to the 750 ONLY.
   **This cell does NOT close the S23-class (740) device gate** — that gate
   stays owned by a future HDK8550 run of the unmodified #53 cell.
3. Materials, arms, caps, model (LFM2.5-2.6B-Q4_K_M, sha in MODEL_SHA.txt),
   kits, thermal gates: byte-identical to #53 (driver diff = folder name and
   device work dir only; pre-run audit of #53 rev2 carries over, M1 fix
   included).
4. Bonus observation (recorded, not gridded): whether FLASH_ATTN_EXT compiles
   on the 750 (vs the 732's sub_group_shuffle_xor failure, cell #52).
