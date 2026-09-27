# Quiz with each publisher's sampling, 3 seeds — M1 Max 64 GB, 2026-09-26

Sampling: Gemma 4 temp 1.0 / top_p 0.95 / top_k 64; LFM2.5 temp 0.1 / top_k 50 / repeat 1.1. max_tokens 6000.
18 objectively gradable questions x 3 seeds = 54. grade.py mis-scored Q12 (**Po**) and Q14
(LaTeX H_2O_2) for Gemma, and Q11/Q15 wording; totals below are after reading those answers by hand.

| model | score /54 | notable misses |
|---|---|---|
| Gemma 4 E4B Q4_K_M | 49 | Spa 1/3 wrong, heptagon "otto" 1/3, ferrovia "three" 1/3, plane riddle 1/3 |
| Gemma 4 12B Q4_K_M | 48 | Spa 0/3 (Schumacher x2, Coulthard), heptagon "8" 3/3 |
| LFM2.5 BF16 | 48 | ferrovia "una r" 3/3, plane riddle 0/3 (one empty) |
| LFM2.5 Q8_0 | 47 | ferrovia "una r" 3/3, plane riddle 0/3, Spa "guidando una Ferrari" 1/3 |
| Gemma 4 E4B Q8_0 | 46 | Spa 2/3 wrong, heptagon "otto" 2/3, plane riddle 2/3 wrong, one "two" in English |

The spread (46-49) is within the noise of 54 samples: no model separates.
