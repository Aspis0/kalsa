# Calibration sources — licences and provenance

All sources are public, ungated, and licensed for redistribution of derived
calibration mixes. Verified live on 2026-09-29 via the HF API (dataset_info:
`cardData.license`, `gated=False`, canonical ids and revisions below; the
`CohereForAI/*` ids now resolve to `CohereLabs/*` — same repos, same sha).

| repo | revision (sha) | license | used for |
|---|---|---|---|
| `CohereLabs/aya_dataset` (via `CohereForAI/aya_dataset`) | `f9ea04583f02a8f86404ff6c58bf75fe637df8a2` | apache-2.0 | human-written chat: EN/IT/ES/FR (no ZH — 0 rows) |
| `CohereLabs/aya_collection` (via `CohereForAI/aya_collection`) | `09069079fad96ad9c7f8781be8c1d70471dfa768` | apache-2.0 (collection); `translated_dolly` rows are **cc-by-sa-3.0** — see below | `translated_flan_cot` (reasoning, 5 langs), `translated_dolly` (chat filler) |
| `openai/gsm8k` | `740312add88f781978c0658806c59bc2815b9866` | mit | EN reasoning (train split; full solutions; thinking + non-thinking rows) |
| `google-research-datasets/mbpp` | `4bb6404fdc6cacfda99d4ac4205087b89d32030c` | cc-by-4.0 | EN code (audit fix: replaces Magicoder) |
| `NousResearch/hermes-function-calling-v1` | `dae3e1d28cfbcf4b915c04ea1e072030529b4bda` | apache-2.0 | EN tool-calling dialogues (calibration: `func-calling*.json`) |

Every download passes `revision=<sha>` (`calib/build_calib.py:REVISIONS`,
`eval/build_holdouts.py`), so the pin is enforced, not just recorded.

Quoted licence texts (summary):

- **Apache-2.0** (aya_dataset, aya_collection, hermes): grants a
  copyright licence to "reproduce Prepared Outputs ... and to prepare Derivative
  Works" with attribution and licence-text carriage — redistribution of a
  filtered/derived calibration mix for training is the intended use. Full text:
  https://www.apache.org/licenses/LICENSE-2.0 (shipped verbatim in each repo).
- **MIT** (gsm8k): "Permission is hereby granted, free of charge, to any person
  obtaining a copy of this software and associated documentation files ... to
  deal in the Software without restriction" — includes use in the calibration
  set. Full text: https://opensource.org/licenses/MIT.
- **CC-BY-4.0** (mbpp — audit fix): the licence read live from the repo card
  (`license: ['cc-by-4.0']`). CC-BY-4.0 §2 grants "to reproduce and Share the
  Licensed Material in whole or in part" and "to produce, reproduce, and Share
  Adapted Material" for any purpose, including commercial, with attribution
  (§3(a)(1)) — no share-alike, no restrictions on outputs. MBPP is
  human-written Google research data, not model output, so the GPT-output
  provenance ambiguity that motivated removing Magicoder does not arise.
  Full text: https://creativecommons.org/licenses/by/4.0/legalcode.

Notes:

- **`translated_dolly` is CC-BY-SA-3.0, not Apache-2.0** (review fix
  2026-09-30): the config is Cohere's professional translation of
  `databricks/databricks-dolly-15k`, whose licence is CC-BY-SA-3.0 — the
  share-alike travels with the rows even though the aya_collection repo card
  says Apache-2.0. Rows from that config are tagged `cc-by-sa-3.0`
  (`calib/sources.py:CONFIG_LICENCE`, `build_calib.py` writes the tag
  per row). Not blocking while the calibration set stays private; it becomes
  a real obligation only if the mix itself is ever redistributed.
- `translated_flan_cot` rows are professional translations of FLAN
  chain-of-thought data (Apache-2.0 upstream) and stay `apache-2.0`.
- hermes `func-calling*.json` rows embed the tool schemas in the system turn;
  the conversion to `{role, content}` messages is mechanical (`from`→`role`,
  `value`→`content`).
- Tool-calling and code are EN-only because no ungated, permissively licensed
  source provides them in IT/ES/FR/ZH. This is recorded in `counts.json`.
