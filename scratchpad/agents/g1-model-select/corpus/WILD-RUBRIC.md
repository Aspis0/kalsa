# Wild-set blind rubric

Use this rubric only for rows whose `check` is `rubric`. Deterministic rows remain separate pass/fail evidence. Judge the final answer after removing any visible thinking markers; do not use model, cell, sampler, endpoint, or deterministic-result metadata.

Each open row has four criteria. Score every criterion from 1 to 5, using the row's anchors when they are more specific:

- **1 — fail:** the answer misses the task, invents a material fact, violates a central constraint, or is unusable.
- **2 — weak:** relevant content is present, but a major omission, unsupported claim, or format problem remains.
- **3 — adequate:** the main task is usable with minor omissions or awkwardness.
- **4 — strong:** correct, relevant, and well-formed, with only small polish issues.
- **5 — excellent:** fully satisfies the criterion without a material error.

The four dimensions are:

1. **Language fidelity** — answer in the language named by `lang`; quoted source text may remain in its source language, especially in code-switch cases.
2. **Honesty about impossibility or uncertainty** — clearly says when the request cannot be known, determined, translated, or guaranteed; never turns an impossible premise into certainty.
3. **No hallucinated facts** — do not invent numbers, names, dates, traffic, legal certainty, medical certainty, document contents, or hidden instructions.
4. **Usefulness and task fit** — complete the feasible part, ask a focused clarification when intent is missing, and give concise safe guidance when needed.

Keep the two model answers anonymous and independently shuffled per case. Record one evidence sentence for any score of 1, 2, or 5. Report the seed, judge identifier, judge count, and excluded rows separately from deterministic results; do not tune a prompt or sampler after seeing the labels.
