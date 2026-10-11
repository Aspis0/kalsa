# Lab: Bonsai 27B (ternary / 1-bit) vs Gemma 12B, 2026-10-10

The owner asked after an XDA article (Bonsai 27B 1-bit in 4.4 GB, run in LM Studio on an
8 GB card): could it replace Gemma 4 12B, or be added to the catalog?

**Verdict: no.** It does not replace Gemma 12B on Italian. Consider it as an add-on only
after a clean speed measurement. PQ2_0 also needs PrismML's llama.cpp fork (CUDA, Metal
and CPU kernels, no Vulkan), so it cannot run on our engine without porting kernels.

## Setup

- Machine: M1 Max (owner's Mac). The GPU was shared with other work, so the speed numbers
  are not trustworthy.
- Engine: PrismML fork `prism-b10770-6684606` with q8_0 KV; upstream llama.cpp at
  `aa94f208` for Q1_0.
- Models (sha256 in `dev/lab-bonsai/SHA256SUMS.txt`):
  - `prism-ml/Ternary-Bonsai-2-27B-gguf` PQ2_0, 6.7 GB (Qwen3.8 27B, ternary);
  - `Bonsai-27B-Q1_0`, 3.5 GB, the lmstudio-community build from the article. It runs
    on stock llama.cpp.
  - Baseline: Gemma 4 12B Q4_K_M.
- Batteries we already had (harnesses in `dev/lab-bonsai/harness/`):
  - the owner's Italian quiz;
  - the calendar battery;
  - restraint (tools that should not be called);
  - stories (refusals).

## Results

| | Bonsai PQ2_0 | Bonsai Q1_0 | Gemma 12B |
|---|---|---|---|
| Italian quiz (hand-corrected) | 46/54, thinking on and off | 12/18 (1 seed, invented facts) | 48/54 |
| Calendar, plain ISO: event created with the right start | 11/15 | 0/15 | 5/15 |
| Calendar, relative schema | 14/15 | — | — |
| Restraint hits | 7/13 | 5/13 | 3/13 |
| Story refusals | none | none | none |

Earlier quiz baselines: E4B 49/54, LFM 50/54.

Other findings:

- **Thinking on:** 23–31% empty answers on the hard multilingual set, where reasoning
  eats the output limit. With thinking off: 0.
- **Quiz poem (Q19), thinking on:** 2 of 3 seeds hit the 6000-token cap.
- **Quiz grading:** corrections are in `results/full/quiz/HAND-CORRECTIONS-*.md`. The
  answer keys were not checked independently against sources.

## Files

- `dev/lab-bonsai/results/full/`: raw JSONL per battery and model.
- `dev/lab-bonsai/results/` (top level): the smoke runs.
- `dev/lab-bonsai/harness/`: run scripts.
- The model files, the two llama.cpp builds and the server logs were deleted on
  2026-10-11 (14 GB); they can be re-downloaded from the hashes above.
