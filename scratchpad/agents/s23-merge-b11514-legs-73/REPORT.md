# Cell #73 — one-copy legs on the Galaxy S23 with the upstream-b11514 merge engine (correctness)

- **Device:** Galaxy S23 (SM8550, Adreno 740, Hexagon v73).
- **Power:** the phone was CHARGING. This cell is correctness only; the tok/s are indicative and are not a claim.
- **Evidence:** `raw/legs_report.grep`.

## Setup

- **Engine:** 23b2a44d7.
  - It is the merge 904d38fad (upstream b11514 merged into e01a61cee), plus the audit fixes 35233cf8e and 23b2a44d7.
  - governor-bench 50f33830: a static `build-ls-and` build, made with the documented recipe (`~/Projects/kalsa-artifacts-b11514/BUILD.txt`).
  - Release skel v73 eb78db49.
  - The hashes on the phone match the Mac copies.
- **Model:** `/data/local/tmp/heat3way/ship.gguf` (LFM2.5-2.6B Q4_0, sha a247afd6, the same file as the QDC cells).
- **Script:** `run-legs.sh` is cell #72's QDC script with three changes:
  - `R=/data/local/tmp/kalsa73`;
  - the battery watchdog is at 43.0 C (the owner's S23 line);
  - `input keyevent 224` runs before every arm.
- **Run:** 22:21:18-22:32:35 EDT. Battery went from 29.5 C to 36.6 C; the watchdog never fired.

## Result

| arm | exit | KL mean | KL max | status | tok/s (indicative, charging) |
|---|---|---|---|---|---|
| G (two-copy reference) | 0 | - | - | - | - |
| L (hops every 32 over 256) | 0 | 0.000014 | 0.000272 | PASS | cpu 15.9, gpu 15.6, npu 18.3 |
| L-npu | 0 | 0.000021 | 0.000293 | PASS | 18.6 |
| L-gpu | 0 | 0.000010 | 0.000141 | PASS | 16.5 |
| L-gpu2 | 0 | 0.000010 | 0.000141 | PASS | 17.1 |
| L-cpu | 0 | 0.000012 | 0.000243 | PASS | 15.6 |
| A-gpu (plain OpenCL) | 0 | 0.000012 | 0.000204 | PASS | - |
| A-j1 (plain HTP0+GPU) | 0 | 0.000021 | 0.000293 | PASS | - |
| V-gpu (E5, 4000 v4 GEMVs) | 0 | 0.000010 | 0.000141 | PASS | 4.1 (per-call check) |

E5 checked 4000 calls: the worst was 2.285e-05 x RMS, with 0 FAIL. All 8 one-copy arms printed 167 self-check PASS lines each. There were no ABORT, refusal or error lines.

The only warning is `ggml-hex: HTP0 failed to get URI ... error 0x14. Falling back to single session URI`. It is the v73 single-session path, and it was already in earlier S23 sessions (e.g. `onecopy-three-legs/step5-s23/raw/session4-gate-340461655.grep`). The message dates from the backend's first commit 63d2fc46e.

## Reading

**The merged engine is correct on the real S23 on every leg.**
- The one-copy GPU leg is deterministic: L-gpu, L-gpu2 and V-gpu give identical KL.
- The NPU leg's KL equals its J(1) reference A-j1.
- The forced 3-leg hop arm stays below 0.0003 max KL.

So the upstream b11514 merge and its fixes do not change correctness on the v73/Adreno 740 phone.
