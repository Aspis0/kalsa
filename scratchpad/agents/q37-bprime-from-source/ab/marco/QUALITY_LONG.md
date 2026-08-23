# Marco from-source long scoring (temp 0, k=6 drop=0.0)

Texts: `ab/marco/long/ANSWERS.md`. Log: `logs/ab-marco-long.log`.
Checkable keys from the harness docstring (instruction-constraint, not beauty).

| prompt | what to check | control | Q8_0 | IQ4_NL | Q4_0 |
|---|---|---|---|---|---|
| f45_3_istruzioni | exactly 3 sentences, then 2 questions, IT, no titles | **PASS** | **PASS** | **PASS** (claims empty-battery uses *more* energy) | **PASS** |
| f45_4_codice | `median_eval_tok_s`, nproc≥6, skip None, median, None if empty | **PASS** | **PASS** | **FAIL** — never filters `nproc >= 6` (example 2 treats nproc=5 as valid) | **FAIL** — same missing nproc≥6 filter |
| f45_1_esplicativo | MoE vs dense, IT, ≤180 words | coherent | coherent; 7B≈7 GB / 3B≈3 GB | coherent; same 7 GB / 3 GB | coherent |
| f45_2_scrittura | 2.4 bit, ~5 tok/s, screen on, annotate temp/batt/tok/s | all present | all present | all present; invents "check the connection" | all present; invents temp&lt;30°C / batt&gt;80% |
| f45_5_ragionamento | pick B, short, concrete check | **B**; garbled /sys path | **B**; `/proc/self/cpuset` is the best check of the four | **B**; reads `cpuset/mems` (wrong file) | **B**; vague /sys path |
| long_conversational_it | Italian prose, no list collapse | holds to 420 tok | holds; Toscana then "montagne della Campania" | holds; "25 km/h", "unghie di pane" | holds; "linea 101", wooden wagon |

Zero variant answers identical to control.

## Verdict (this suite)

Instruction-following and Italian prose **survive** from-source trunk change (same as q36's long finding). The checkable **code** gate does not: only control and Q8_0 implement `nproc >= 6`. Combined with sanity q1 (only Q8_0 names the wrong Spa winner):

| arm | sanity q1 | long code | NPU attn predicate | size vs control |
|---|---|---|---|---|
| control Q5_K | PASS | PASS | FAIL_TYPE | 0 |
| Q8_0 | **FAIL** (Schumacher) | PASS | PASS | +1.95 % |
| IQ4_NL | PASS | **FAIL** | PASS | −0.65 % |
| Q4_0 | PASS | **FAIL** | PASS | −0.65 % |

No from-source trunk type wins both gates. Winner kept on disk = **control** (quality-matched KEXP recook). B′ is not a free lunch on Marco even from source.
