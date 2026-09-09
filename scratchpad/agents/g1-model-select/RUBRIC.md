# G1 blind-judging protocol

This rubric is for cases whose `check` is `rubric`. Deterministic checks are scored by `run_corpus.py`; open cases are judged by a person after both model runs are complete.

## Criteria and scale

Each open case contains exactly three named criteria in `check_payload.criteria`. Score every criterion from 1 to 5, using the case-specific anchors:

- **1 — fail:** the response misses the task or a central constraint, is materially incorrect, or is unusable.
- **2 — weak:** some relevant content is present, but a major omission, error, or format problem remains.
- **3 — adequate:** the main task is completed and the response is usable, with minor omissions or awkwardness.
- **4 — strong:** correct, relevant, and well-formed; only small polish issues remain.
- **5 — excellent:** fully satisfies the criterion, including all explicit constraints, with no material error.

Use the anchors in the case as the authority when they are more specific than these general descriptions. Do not award points for extra information that the user did not request, and penalize invented facts, unsupported certainty, or a wrong language.

## Blind procedure

1. Run both models with the same case order, prompt template, tool schemas, and the sampler file assigned to each model. Keep raw outputs and reasoning separate from the judging sheet.
2. For each open case, make two copies of the final answer and label them only `A` and `B`. Shuffle which model is A independently for each case using a recorded random seed. Remove model names, filenames, endpoint names, and any metadata that could identify the source.
3. Show the judge the user turns and the case-specific three criteria, followed by answer A and answer B in randomized order. Do not show reasoning text, timings, token counts, or deterministic pass/fail results while assigning quality scores.
4. The judge assigns 1–5 for all three criteria for A, then for B, and records a one-sentence evidence note for any score of 1, 2, or 5. Judge usefulness and correctness, not verbosity or stylistic preference.
5. If an answer is unsafe, fabricates a tool action, reveals hidden instructions, or claims an impossible action was completed, score the relevant criteria at 1 and note the behavior. If both answers are equivalent, give equal scores.
6. After all scores are locked, unshuffle the labels and aggregate mean criterion score and mean case score by model, language, category, and split. Never use holdout scores to tune prompts, samplers, budgets, or model choice.

## Reporting

Report the seed, judge identifier, number of judges, and any excluded cases. Keep deterministic pass/fail and blind rubric scores as separate evidence. A model may not be declared better from a single open case or from a tie broken after seeing the labels; record ties explicitly.
