# Calibration sources — licences and provenance

All sources are public, ungated, and licensed for redistribution of derived
calibration mixes. Verified live on 2026-09-29 via the HF API (dataset_info:
`cardData.license`, `gated=False`, canonical ids and revisions below; the
`CohereForAI/*` ids now resolve to `CohereLabs/*` — same repos, same sha).

| repo | revision (sha) | license | used for |
|---|---|---|---|
| `CohereLabs/aya_dataset` (via `CohereForAI/aya_dataset`) | `f9ea04583f02…` | apache-2.0 | human-written chat: EN/IT/ES/FR (no ZH — 0 rows) |
| `CohereLabs/aya_collection` (via `CohereForAI/aya_collection`) | `09069079fad9…` | apache-2.0 | `translated_flan_cot` (reasoning, 5 langs), `translated_dolly` (chat filler) |
| `openai/gsm8k` | `740312add88f…` | mit | EN reasoning |
| `ise-uiuc/Magicoder-Evol-Instruct-110K` | `b0079beaa036…` | apache-2.0 | EN code |
| `NousResearch/hermes-function-calling-v1` | `dae3e1d28cfb…` | apache-2.0 | EN tool-calling dialogues |

Quoted licence texts (summary):

- **Apache-2.0** (aya_dataset, aya_collection, Magicoder, hermes): grants a
  copyright licence to "reproduce Prepared Outputs ... and to prepare Derivative
  Works" with attribution and licence-text carriage — redistribution of a
  filtered/derived calibration mix for training is the intended use. Full text:
  https://www.apache.org/licenses/LICENSE-2.0 (shipped verbatim in each repo).
- **MIT** (gsm8k): "Permission is hereby granted, free of charge, to any person
  obtaining a copy of this software and associated documentation files ... to
  deal in the Software without restriction" — includes use in the calibration
  set. Full text: https://opensource.org/licenses/MIT.

Notes:

- `translated_flan_cot` / `translated_dolly` rows are professional
  translations of English open datasets made by Cohere For AI for the Aya
  project and released under the collection's Apache-2.0.
- hermes `func-calling*.json` rows embed the tool schemas in the system turn;
  the conversion to `{role, content}` messages is mechanical (`from`→`role`,
  `value`→`content`).
- Tool-calling and code are EN-only because no ungated, permissively licensed
  source provides them in IT/ES/FR/ZH. This is recorded in `counts.json`.
