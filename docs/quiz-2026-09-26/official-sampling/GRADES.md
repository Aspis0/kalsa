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

## LFM2.5-2.6B Q6_K and Q4_0 QAD — 2026-09-28

Same harness (`run_official.py`, port 8199), same sampling (temp 0.1 / top_k 50 /
repeat 1.1, max_tokens 6000), seeds 1–3, engine `kalsa-server` v1.1.2 Metal. Graded
the same way as above: `grade.py`, then reading by hand the answers it mis-scores —
Q12 (the script's `' po'` misses `**Po**` in bold; every quant names the Po in every
seed, 3/3) and Q14 (s3 of Q6_K writes `$\text{H}_2\text{O}_2$`, the documented LaTeX
miss). Totals below are after those hand corrections; everything else is the script's.

Files: `official-lfm-q4-s{1,2,3}.jsonl`, `official-lfm-q6-s{1,2,3}.jsonl` here and in
`~/kalsa-bench-models/quiz/`. Models: `LFM2.5-2.6B-QAD-Q4_0.gguf` sha256
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`;
`LFM2.5-2.6B-Q6_K.gguf` is the official LiquidAI file (no quantization done here),
fetched from the same commit the catalog pins (`e7caca5d…`), 2 221 615 104 bytes,
sha256 `2e74b1a0979a4a1936a408445147d103b8f15b2e2ec31c65fa0166f9069c250d`, equal to
the repo's LFS oid. Kalsa.app was running its Qwen 35B engine throughout (untouched);
the quiz used its own port, and its numbers match the 09-26 runs, but the speed
numbers below were taken with that engine resident on the GPU.

| model | score /54 | tg128 d0 | tg128 @ d8192 | specific wrong answers |
|---|---|---|---|---|
| LFM2.5 BF16 | 48 | 50.8 | 48.1 | ferrovia "una r" 3/3, plane riddle 0/3 (one empty) |
| LFM2.5 Q8_0 | 47 | 81.0 | 75.2 | ferrovia "una r" 3/3, plane riddle 0/3, Spa "guidando una Ferrari" 1/3 |
| LFM2.5 Q6_K | **50** | 91.6 | 83.7 | ferrovia "una r" 3/3, plane riddle 1/3 |
| LFM2.5 Q4_0 QAD | **48** | 125.2 | 112.3 | ettagono "8 lati" 3/3 (one says "ottagono"), ferrovia 1/3 ("1" twice, "2" once), plane riddle 1/3 |

Speeds are llama-bench tg128 (fork build 5102686dd, threads 8, fa on, q8_0 KV), d0
and d8192; the BF16/Q8_0 columns are the 09-26 measurements, Q6_K/Q4_0 today's.
The spread is again 46–50 over 54 samples.

### Where the quants differ most (answers quoted as written)

**Q15 «Un ettagono, quanti lati ha?»** — the only question where Q4_0 QAD loses all
three seeds and every other quant is 3/3.

- BF16 s2: «Un ettagono ha **7** lati.»
- Q8_0 s2: «Un ettagono ha **7** lati.»
- Q6_K s2: «Un ettagono ha **7** lati.»
- Q4_0 s1: «Un ettagono ha 8 lati.» — s2: «Un ettagono ha **8 lati**.» — s3: «Un ottagono ha **8 lati**.»

**Q8 «Quante lettere "r" ci sono nella parola "ferrovia"?»** — the one Q4_0 partially
gets and the denser quants all fail identically.

- BF16 s1–s3: «Nella parola «ferrovia» ci sono **una** lettera «r».»
- Q6_K s1: «Nella parola «ferrovia» ci sono **una** lettera «r».»
- Q4_0 s1: «…ci sono **1** lettera «r».» — s2: «…ci sono **2** lettere «r».» (correct) — s3: «…ci sono **1** lettera «r».»

**Q11 «Un aereo cade esattamente sul confine tra Italia e Svizzera. In quale paese
seppelliscono i sopravvissuti?»** — Q4_0/Q6_K answer the riddle in 2/3 seeds, BF16 and
Q8_0 in 0/3.

- Q4_0 s1: «Non vengono seppelliti, perché sono sopravvissuti!»
- Q4_0 s2: «…i sopravvissuti (quelli che sono vivi) non possono essere seppelliti: un sopravvissuto è per definizione in vita…»
- BF16 s1: «…il confine internazionale non appartiene a nessuna delle due nazioni…» (jurisdiction, misses the riddle)
- Q8_0 s3: «…tecnicamente si trova in…» (same miss)
- Q6_K s3: «…i loro corpi non possono essere sepolti in un solo paese…» (jurisdiction again)

**Q1 «Chi ha vinto il GP di F1 di Spa nel 2000?»** — all quants, all seeds, name
Häkkinen (3/3 everywhere); the hallucinated detail around the name differs.

- Q6_K s1: «…**Mika Häkkinen**, guidando una Ferrari.» (wrong team)
- Q4_0 s2: «…**Mika Häkkinen**. Corse alla guida della Williams e ha battuto Damon Hill (secondo) e Jacques Villeneuve (terzo).» (wrong team and podium)
- Q4_0 s3 / Q6_K s3: «…guidando per la McLaren-Mercedes, conquistando così il suo primo/secondo titolo mondiale…» (right team, invented title link)
- BF16 s2: «…**Mika Häkkinen**, guidando una McLaren-Mercedes.» (clean)

**Q12 «Qual è il fiume più lungo d'Italia?»** — every quant names the Po (3/3 after
hand-reading); the stated length degrades only in one Q4_0 seed.

- Q6_K s2: «Il fiume più lungo d'Italia è il **Po**. La sua lunghezza è di circa **652 chilometri**.»
- Q4_0 s3: «Il fiume più lungo d'Italia è il **Po**. … **Lunghezza:** Circa 1.945 km.» (reads as 1945 km)
- Q4_0 s1: «…il **Po**. La sua lunghezza è di circa **652 km**…»

