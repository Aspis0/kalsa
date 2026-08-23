# Long A/B scoring (temp 0, k=6 drop=0.0)

Source: `ab/long/ANSWERS.md`, log `ab-long.log`.
Checkable keys from `scripts/run_answer_quality_ab.py` docstring.

## f45_3_istruzioni — 3 sentences then 2 questions, Italian, no titles

| tag | 3 complete sentences? | then 2 questions? | extra chrome? | IT? |
|---|---|---|---|---|
| baseline | yes | yes | no | yes |
| q8_0 | yes | yes | no | yes |
| iq4_nl | yes | yes | no | yes |
| q4_0 | yes | yes | no | yes (typo "misurarele") |

All **PASS** structure.

## f45_4_codice — `median_eval_tok_s`

All four: def with that name, skip nproc None, nproc>=6, skip missing eval_tok_s,
sort + median, return None if empty, `if __name__` example. **PASS**.
q4_0's first example comment says "No rows with nproc >= 6" while the list
contains nproc 6 and 7 — comment is wrong, function is not.

## Other prompts (not binary gates)

- f45_1: all Italian MoE explanations. Q8_0: "7B × 4 byte = 28 GB RAM" is
  false for any shipped quant.
- f45_2: all mention 2.4 bit, ~5 tok/s, screen on, annotate temp/battery/tok/s.
- long_conversational_it: all stay in Italian prose to n_predict=420; no
  list-collapse. iq4_nl puts Bari on a Milano–Napoli route.

Identity vs baseline: 0/18 variant texts identical.
