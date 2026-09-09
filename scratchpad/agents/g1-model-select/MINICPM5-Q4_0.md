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
