# Sanity A/B scoring (temp 0, k=6 drop=0.0, session mode)

Source texts: `ab/sanity/ANSWERS.md`
Protocol clone of `scripts/run_answer_quality_ab.py` (see `ab-sanity.log`).
True facts used as keys:

- Spa 2000 winner = Mika Häkkinen (McLaren). Baseline of this run and
  `results/answer_sanity_marco` shipped arm both say Häkkinen.
- 9×1..10 table is unique.
- Gift-of-faeces: any "no / inappropriate" is a pass; inventing a specific
  Italian criminal article is extra, not required.
- "armadio" = a-r-m-a-d-i-o → vowels a,a,i,o = **4**. The campaign's
  sanity suite exists because LLMs fail character counting; baseline itself
  says 5. Do not treat q4 as a trunk-quant discriminator.

| prompt | baseline | trunk Q8_0 | trunk IQ4_NL | trunk Q4_0 |
|---|---|---|---|---|
| q1 Spa 2000 | **Häkkinen (correct)** | Jenson Button / Jarno Trulli, then repetition loop to n_predict=300 | claims the 2000 race was cancelled | starts Häkkinen then "corrects" to Button |
| q2 tabellina 9 | 1–10 correct | 1–10 correct (shorter coda) | 1–10 correct | 1–10 correct; extra 9×12=108 also correct |
| q3 regalo | No, inappropriate | No, inappropriate | No, inappropriate | No, inappropriate (adds a fake art. 585-bis) |
| q4 vocali | 5 (wrong; true=4) | 5 (same wrong list a,i,a,i,o) | 5 then self-debate to 4, scrambled spelling | **4** (count correct, letter order a,i,a,o) |

Identity vs this-run baseline: **0/12** variant answers identical (see ANSWERS.md `DIFFERS` tags).

Decode tok/s (from `ab-sanity.log`, not a speed cell):

| tag | q1 | q2 | q3 | q4 |
|---|---|---|---|---|
| baseline | 6.445 | 7.241 | 6.42 | 7.726 |
| q8_0 | 6.02 | 7.276 | 6.587 | 7.415 |
| iq4_nl | 6.611 | 7.025 | 6.865 | 7.141 |
| q4_0 | 5.853 | 7.184 | 6.066 | 7.357 |

Speed is in the same band; this experiment is not a speed claim.

## Verdict on this suite

Requantizing the trunk **from the shipped Q5_K KEXP** (double-quant) **fails the
factual-recall prompt on every candidate**, including Q8_0. Q8_0 additionally
collapses into a repetition loop on q1. Arithmetic table and "don't gift faeces"
survive. That is enough to reject B′-from-KEXP as a quality-preserving path.
It is **not** enough to reject B′ from the original Q8_0 source, which was not
on disk and was not used.
