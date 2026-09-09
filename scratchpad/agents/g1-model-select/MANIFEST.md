# G1 model manifest

Collected on 2026-09-09 on macOS arm64.

## Downloaded candidate

Downloaded with:

~~~sh
hf download openbmb/MiniCPM5-2B-GGUF MiniCPM5-2B-Q4_K_M.gguf \
  --revision main --local-dir /Users/marco/kalsa-qdc/models
~~~

| field | value |
|---|---|
| HF repository | openbmb/MiniCPM5-2B-GGUF |
| revision | d00c954e5f9a0f2605468f24703ffa7e5cb0c492 |
| filename | MiniCPM5-2B-Q4_K_M.gguf |
| local path | /Users/marco/kalsa-qdc/models/MiniCPM5-2B-Q4_K_M.gguf |
| byte size | 1561318368 |
| sha256 | ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd |
| quantization selection | exact official Q4_K_M; no fallback |

## Existing comparison models

All hashes below were computed with shasum -a 256.

| filename | local path | byte size | sha256 |
|---|---|---:|---|
| LFM2.5-2.6B-QAD-Q4_0.gguf | /Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf | 1593894944 | a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03 |
| LFM2.5-2.6B-Q4_K_M.gguf | /Users/marco/kalsa-qdc/models/LFM2.5-2.6B-Q4_K_M.gguf | 1674455040 | 02a8b7e17487d326e46d68ce0ba24211e1b80a14c4cd0597fa73c1cd697f52ed |
| Qwen3.5-4B-Q4_K_M.gguf | /Users/marco/kalsa-qdc/models/Qwen3.5-4B-Q4_K_M.gguf | 2834975040 | 3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630 |

## Scope

The four files above are the four inputs to inventory.py. The comparison
smoke uses LFM2.5-2.6B-QAD-Q4_0.gguf and MiniCPM5-2B-Q4_K_M.gguf.
