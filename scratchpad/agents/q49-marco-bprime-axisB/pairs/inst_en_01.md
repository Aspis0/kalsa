# Pair `inst_en_01`

Category: `instruction`  
Prompt language (do not infer arms from this): `en`

Judge: pick `winner=A` or `winner=B` or `winner=tie` or `winner=undecidable`. Do not try to guess which model is which. Prefer the response that better follows the prompt (correctness, language of the prompt, format, no loops).

## Prompt

Reply with ONLY a JSON object with exactly two keys: "ok" (boolean true) and "n" (integer 7). No markdown, no extra keys, no other text.

## Response A

{"ok": true, "n": 7}

## Response B

{
  "ok": true,
  "n": 7
}
