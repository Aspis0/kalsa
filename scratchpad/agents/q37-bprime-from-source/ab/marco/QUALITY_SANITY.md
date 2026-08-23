# Marco from-source sanity scoring (temp 0, k=6 drop=0.0)

Source texts: `ab/marco/sanity/ANSWERS.md`. Log: `logs/ab-marco-sanity.log`.
Keys same as q36 / `scripts/run_answer_quality_ab.py`:

- Spa 2000 winner = Mika Häkkinen (McLaren). **This is the gate.**
- 9×1..10 table is unique.
- Gift-of-faeces: any "no / inappropriate" is a pass.
- "armadio" vowels = **4**. Campaign suite exists because LLMs fail this; do not treat q4 as a trunk discriminator.

| prompt | control (Q5_K trunk) | trunk Q8_0 | trunk IQ4_NL | trunk Q4_0 |
|---|---|---|---|---|
| q1 Spa 2000 | **Häkkinen, correct.** Extra errors: "first F1 win" (false); podium Coulthard/Villeneuve (actual: Schumacher/Button) | starts Häkkinen, then **self-corrects to Schumacher** (wrong). No repetition loop | **Häkkinen, correct.** Rambling; wrong podium (Button 2nd) | **Häkkinen, correct.** Wrong 0.046 s margin / Button 2nd |
| q2 tabellina 9 | 1–10 correct | 1–25+ correct (cut at n_predict) | 1–10 correct | 1–10 correct |
| q3 regalo | No | No | No | No |
| q4 vocali | 5 (wrong; true=4) | 5 (same) | 5 (same) | **4** (count correct, letter order messy) |

Identity vs this-run control: **0/12** variant answers identical.

No arm hit the q36 Q8_0-from-KEXP **repetition collapse** (300/300 tokens of garbage). q8_0 q1 here is 300 tokens of *self-contradiction*, not a loop.

## Verdict (this suite, N=1 greedy)

From-source trunk requant **does not reproduce the q36 double-quant wipeout**. Control, IQ4_NL, and Q4_0 all name Häkkinen. **Q8_0 is the only arm that fails the factual gate** (final answer Schumacher). That inverts q36's "Q8_0 is the quality candidate" guess, which was never a from-source measurement.

Conservative: **do not pick Q8_0 as the Marco B′ default on this evidence.** IQ4_NL and Q4_0 keep the winner and shrink the file (−0.65 %). Long suite still pending.
