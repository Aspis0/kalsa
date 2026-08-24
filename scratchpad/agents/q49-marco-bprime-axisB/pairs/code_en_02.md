# Pair `code_en_02`

Category: `code`  
Prompt language (do not infer arms from this): `en`

Judge: pick `winner=A` or `winner=B` or `winner=tie` or `winner=undecidable`. Do not try to guess which model is which. Prefer the response that better follows the prompt (correctness, language of the prompt, format, no loops).

## Prompt

Write a SQL query that selects email from a table named users where active = 1, ordered by created_at DESC, limited to 10 rows. SQL only, no explanation.

## Response A

SELECT email FROM users WHERE active = 1 ORDER BY created_at DESC LIMIT 10;

## Response B

SELECT email FROM users WHERE active = 1 ORDER BY created_at DESC LIMIT 10;
