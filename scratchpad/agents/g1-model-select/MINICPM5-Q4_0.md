# MiniCPM5-2B Q4_0 controlled comparison

Date: 2026-09-09

## Provenance

- Hugging Face repo: `openbmb/MiniCPM5-2B-GGUF`
- Revision: `d00c954e5f9a0f2605468f24703ffa7e5cb0c492` (F16 exists there)
- F16: `MiniCPM5-2B-F16.gguf`, 5039006688 bytes, SHA-256 `0ffba3682a853295566b98bc38c0ab755d6b2d91b994bc031ed727a08cfcdf25`
- Q4_0: `MiniCPM5-2B-Q4_0.gguf`, 1490355168 bytes, SHA-256 `a3a1152d0e636b4fcd36a82b1cae8b54ef15948b13de2e216bde5525c88041c9`
- Existing Q4_K_M: 1561318368 bytes, SHA-256 `ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd`
- Optional Q8_0 reference: 2679710688 bytes, SHA-256 `c5415f8989bf88a8288f1b55a3cc371af53c07b0faa220a63bd7a990cfaba078`

## Quantization

Command:
`nice -n 10 ~/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-quantize ~/kalsa-qdc/models/MiniCPM5-2B-F16.gguf ~/kalsa-qdc/models/MiniCPM5-2B-Q4_0.gguf Q4_0 > /tmp/mcpm-q40.log 2>&1; echo rc=$?`

- `llama-quantize` was built first with `cmake --build ... --target llama-quantize`.
- Quantize rc: `0`.

## Tensor inventory

| artifact | total | F32 | Q4_0 | Q4_K | Q6_K |
|---|---:|---:|---:|---:|---:|
| MiniCPM5-2B-Q4_0.gguf | 381 | 85 | 295 | 0 | 1 |
| MiniCPM5-2B-Q4_K_M.gguf | 381 | 85 | 0 | 253 | 43 |

## Perplexity

Same 50000-byte plain-text input, `-c 2048 -b 512 -t 6 -ngl 0`; all runs rc=0.

| model | final PPL |
|---|---:|
| Q4_K_M | 23.5502 |
| Q4_0 | 26.1851 |
| Q8_0 reference | 22.3440 |

## Smoke

Q4_0 llama-server on port 8090 used the RESULTS-DEV flags, with Jinja, deepseek reasoning, and thinking on. Italian request returned a sane three-sentence answer: “Un governor termico regola la temperatura del telefono per prevenire il calore eccessivo. Aiuta a mantenere le prestazioni del dispositivo durante l'uso intensivo. Questo sistema protegge l'equipaggiamento dai danni causati dalle alte temperature.”

- Health/request rc: `0/0`; prompt: `378.49 tok/s`; generation: `48.44 tok/s`.
- The server process started for this smoke was stopped; no other process was touched.

Q4_K_M stays the primary candidate; Q4_0 is the repack-question reference for the phones.

## imatrix quants

### Calibration provenance

- `~/kalsa-qdc/imatrix/calib.txt`: 370454 bytes, SHA-256 `241f2b9d36f07781f4e8295f9a34a1445db419bdf6a5fb4f86d7e103f3ca6014`.
- Composition: 100 KB English from *Pride and Prejudice* (Gutenberg 1342), 100 KB Italian from *La Divina Commedia* (Gutenberg 1012), 70 KB Spanish from *Don Quijote* (Gutenberg 2000), 60 KB French from *Les misérables, Fantine* (Gutenberg 17489), plus short Q&A/chat, JSON, Markdown, and tool-call-like lines.
- Calibration is disjoint from the G1 corpus prompts; no G1 corpus text was used.

### Imatrix extraction

`nice -n 15 ~/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-imatrix -m ~/kalsa-qdc/models/MiniCPM5-2B-F16.gguf -f ~/kalsa-qdc/imatrix/calib.txt -o ~/kalsa-qdc/imatrix/minicpm5-2b.imatrix -c 2048 -t 6 > /tmp/mcpm-imatrix.log 2>&1; echo rc=$?`

- rc: `0`; wall time: 756 s; chunks: 55.
- Imatrix: 3141824 bytes, SHA-256 `dec2854e11fd91e433b90214879bede8b3e1f232fd3b20f131b024e53b7273c4`.

### Imatrix quantization

- `nice -n 15 .../llama-quantize --imatrix ~/kalsa-qdc/imatrix/minicpm5-2b.imatrix ~/kalsa-qdc/models/MiniCPM5-2B-F16.gguf ~/kalsa-qdc/models/MiniCPM5-2B-Q4_K_M-imx.gguf Q4_K_M > /tmp/mcpm-q4km-imx.log 2>&1; echo rc=$?` — rc `0`; 1561318624 bytes; SHA-256 `21483ea6dc19367d7846ffaafde1af74d6a69448a5359cad22326b9bad257686`.
- `nice -n 15 .../llama-quantize --imatrix ~/kalsa-qdc/imatrix/minicpm5-2b.imatrix ~/kalsa-qdc/models/MiniCPM5-2B-F16.gguf ~/kalsa-qdc/models/MiniCPM5-2B-Q4_0-imx.gguf Q4_0 > /tmp/mcpm-q40-imx.log 2>&1; echo rc=$?` — rc `0`; 1494287584 bytes; SHA-256 `55d20c4db848cb4034f477bc4fcf57b186e12b77ddbf99d7338ef4cea26b9324`.

### Tensor inventory

| artifact | total | F32 | Q4_K | Q6_K | Q4_0 | Q4_1 |
|---|---:|---:|---:|---:|---:|---:|
| official Q4_K_M | 381 | 85 | 253 | 43 | 0 | 0 |
| Q4_K_M-imx | 381 | 85 | 253 | 43 | 0 | 0 |
| official Q4_0 | 381 | 85 | 0 | 1 | 295 | 0 |
| Q4_0-imx | 381 | 85 | 0 | 1 | 290 | 5 |

### Perplexity

Same `/tmp/mcpm-ppl-50kb.txt` and `-c 2048 -b 512 -t 6 -ngl 0`; every run rc `0`.

| model | final PPL |
|---|---:|
| Q8_0 reference | 22.3440 |
| official Q4_K_M | 23.5502 |
| Q4_K_M-imx | 23.3642 |
| official Q4_0 | 26.1851 |
| Q4_0-imx | 24.6415 |

### Smoke

Each imx file was served once on port 8090 with the RESULTS-DEV flags, thinking on, and `nice -n 15`; each health/request rc was `0/0`, and each server was stopped.

- Q4_K_M-imx: 44.62 generation tok/s (198.05 prompt tok/s). Answer was a sane three-sentence Italian explanation: “Un governor termico regola la temperatura del telefono per evitare il calore eccessivo. Questo aiuta a mantenere le prestazioni del dispositivo ottimali. In sostanza, protegge la batteria e previene il surriscaldamento.”
- Q4_0-imx: 48.48 generation tok/s (254.70 prompt tok/s). Answer was a sane three-sentence Italian explanation: “Un governor termico regola l'uso della batteria per evitare il calore. Questo consente al telefono di mantenere le temperature adeguate. In sintesi, protegge la durata e la sicurezza del dispositivo.”

Recommendation: keep Q4_K_M-imx as the quality/primary candidate, and push Q4_0-imx to the phone as the ARM-repack reference.
