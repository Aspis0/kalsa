# LFM2.5 from-source sanity

`--no-think` does **not** suppress LFM2.5-8B-A1B think: most `text` fields are empty, the generation is in JSON `reasoning` (English planning). Scored from `ANSWERS_EXTRACTED.md`.

| prompt | control | Q8_0 | IQ4_NL | Q4_0 |
|---|---|---|---|---|
| q1 Spa 2000 | Schumacher (wrong) | Schumacher (wrong) | Schumacher (wrong) | Schumacher (wrong); only arm with visible `text` |
| q2 tabellina | 1–9 correct in reasoning (no ×10) | visible only 1×9 and 2×9 | visible 1–9 table | 1–9 in reasoning |
| q3 regalo | English reasoning, no firm Italian No | same; misreads "barbone" | same | same |
| q4 vocali | **4** (correct) | **4** | **5** (wrong) | **4** |

q1 is a model-knowledge fail on **control**, so it does not discriminate trunk types. IQ4_NL uniquely fails the vowel count. Always-think is a harness confound, not a trunk-type effect.
