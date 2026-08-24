# Pair `inst_en_03`

Category: `instruction`  
Prompt language (do not infer arms from this): `en`

Judge: pick `winner=A` or `winner=B` or `winner=tie` or `winner=undecidable`. Do not try to guess which model is which. Prefer the response that better follows the prompt (correctness, language of the prompt, format, no loops).

## Prompt

Return a CSV with header name,year and exactly two data rows: Ada,1815 and Alan,1912. No extra lines, no commentary.

## Response A

Name,Year
Ada,1815
Alan,1912

## Response B

Name,Year
Ada,1815
Alan,1912
