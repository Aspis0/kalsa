# Ling-3.0-tiny multilingual probe — 2026-10-01

Owner question: is Ling-3.0-tiny good enough to chat in Kalsa's five languages?
Owner decision after reading it: **Ling is not offered for the European and
American languages (EN, IT, ES, FR). It stays a candidate for Chinese only.**

## Setup

- Model: `inclusionAI/Ling-3.0-tiny-GGUF` @ 01b850e2, `Ling-3.0-tiny-Q4_K_M.gguf`,
  4,823,894,944 B, sha256 `246d67d45f5b0c7447ca0ce0bdb8b46b8a47b593c5068635dc16422c051d7be9`
  (matches the HF LFS oid and the Lab's Lenovo copy).
- Engine: fork `llama-server` Metal build, commit 9f3c2e069, M1 Max, all layers on the GPU,
  `-c 65536 --jinja --temp 1.0 --top-p 0.95 --top-k 20` (inclusionAI's recommended sampling).
- 13 hard questions (4 IT, 3 FR, 3 ZH, 3 ES), `max_tokens` 4096, thinking at its default (on).
  The four empty ones re-asked with `chat_template_kwargs: {enable_thinking: false}`.
- Speed: 94–99 tok/s decode throughout.
- Raw outputs, next to this file: `quiz.py`, `quiz-out.json` (thinking on), `nothink.txt` (thinking off).

## Results

Thinking on (default): **4 of 13 answers empty** — 3 of the 4 Italian questions and the
Spanish poem spent all 4096 tokens reasoning and never answered.

| Lang | Question | Verdict |
|---|---|---|
| IT | Train crossing time | Empty; thinking off: wrong setup (15 min gap instead of 30) → wrong time |
| IT | "gli" vs "le" + fix "Se avrei saputo" | Empty; thinking off: explains them as plural direct objects — wrong |
| IT | Dante, Inferno V | Empty; thinking off: fully hallucinated (no Paolo and Francesca, invented verse) |
| IT | Formal condo e-mail | OK |
| FR | « mangerais » vs « mangerai » | Correct |
| FR | Outfit combinatorics | Correct (22) |
| FR | CDD vs CDI | Legally wrong (claims a CDD can be broken at will) |
| ZH | 画蛇添足 meaning + sentence | Correct |
| ZH | Pipes filling a tank | Correct (3 hours) |
| ZH | Confucian vs Taoist government | Correct |
| ES | ser/estar with aburrido/listo | Incomplete (misses "es aburrido", "está listo" examples) |
| ES | Percent + simple interest | Correct (1,040.40 €) |
| ES | Four-line rhymed poem | Empty; thinking off: one unrhymed line |

## Reading

- Chinese: 3/3, clean. Arithmetic is solid in every language.
- Italian is the weakest: confident, invented grammar and culture. For Kalsa that is the
  worst failure mode. French and Spanish are uneven.
- Default thinking produces empty answers on hard prompts; if Ling ever ships for Chinese,
  the app must cap or disable thinking and treat an empty answer as a failure.
- Consistent with the Lab's Lenovo run (kalsa-brain `docs/LAB-LENOVO-2026-10-01.md`): owner Italian quiz
  45/54 vs Gemma E4B 49, 3/104 empty answers.
