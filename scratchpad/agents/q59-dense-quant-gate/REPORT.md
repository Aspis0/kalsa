# q59 — Qwen3.5-4B dense quant gate

## PPL and Δ% vs same-source Q4_K_M

| corpus | chunks | Q4_K_M PPL ± err | IQ4_NL PPL ± err | IQ4_NL Δ% | Q4_0 PPL ± err | Q4_0 Δ% |
|---|---:|---:|---:|---:|---:|---:|
| wiki | 64 | 8.6983 ± 0.0918 | 8.5977 ± 0.0906 | -1.1565% | 8.4839 ± 0.0884 | -2.4648% |
| it | 60 | 7.5985 ± 0.0768 | 7.6624 ± 0.0779 | +0.8410% | 7.7800 ± 0.0793 | +2.3886% |
| es | 59 | 7.2232 ± 0.0728 | 7.3238 ± 0.0747 | +1.3927% | 7.4428 ± 0.0761 | +3.0402% |
| fr | 59 | 7.1786 ± 0.0720 | 7.2117 ± 0.0724 | +0.4611% | 7.3331 ± 0.0742 | +2.1522% |
| zh | 61 | 12.8935 ± 0.1474 | 13.0255 ± 0.1500 | +1.0238% | 13.3264 ± 0.1535 | +3.3575% |

## Sizes

| arm | bytes | MiB | Δ vs same-source Q4_K_M | Δ vs shipped Q4_K_M | sha256 |
|---|---:|---:|---:|---:|---|
| Q4_K_M | 2783446240 | 2654.50 | +0.0000% | -1.8176% | `a7d67feff949041d766c910f2faa641016a5dad6d8c5f7fada05d61b84eb1887` |
| IQ4_NL | 2689443040 | 2564.85 | -3.3772% | -5.1334% | `d1badf2682c66c4bf3aaa410c8e15a5605746a33ba049ae5a968afe82c71c539` |
| Q4_0 | 2611782880 | 2490.79 | -6.1673% | -7.8728% | `cabebaae4ed75bad16b0098e381cfa08d63c0a45040d05b6481c318f558b9b7a` |
| shipped Q4_K_M | 2834975040 | 2703.64 | — | 0.0000% | `3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630` |

## Verdict

| IQ4_NL all-corpus gate | FAIL |
| Q4_0 all-corpus gate | FAIL |
| Q8_0 | SKIPPED |
| decision | **OWNER DECISION** |

## Provenance

| item | repo/path | revision/commit | file/bytes/sha256 |
|---|---|---|---|
| app default | `unsloth/Qwen3.5-4B-MTP-GGUF` | `86835bf9949e4d14d6860f7910b1340ad4f271a9` | `Qwen3.5-4B-Q4_K_M.gguf` / 2834975040 / `3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630` |
| common source | `Qwen/Qwen3.5-4B` | `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` | BF16 safetensors |
| source shard | `gguf/source/model.safetensors-00001-of-00002.safetensors` | — | 5329398688 / `26a93f066e1916adb13453dae5a0c707c0fbc71299ed98779571a907b8e74c61` |
| source shard | `gguf/source/model.safetensors-00002-of-00002.safetensors` | — | 3990429408 / `cb544bd9bfae93dc59b0f22b292f5933573854a7f9b97835c67060d7d910e188` |
| quantizer | `build-pc-quantize/bin/llama-quantize.exe` | `e5605f3bd3545867b2eb2581c96fd7042e243541` | BF16 → Q4_K_M/IQ4_NL/Q4_0; `--allow-requantize` absent |
| PPL binary | `build-llama-pc/bin/llama-perplexity.exe` | `1882bf8cd99659246f4ddecb99c268669d7bb3c9` | `-c 2048 -b 512 -ub 512 -t 8 -ngl 0` |
| protocol caveat | `scratchpad/agents/q37-bprime-from-source/PREP.md` | — | requested file absent; BF16 direct path used |

## Run records

| arm | corpus | chunks | wall_s | command |
|---|---|---:|---:|---|
| control | wiki | 64 | 3927.16 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_K_M.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q41-ppl-gate\corpus\wikitext-2-raw\wiki.test.raw -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks 64 --ppl-stride 0` |
| iq4_nl | wiki | 64 | 4937.27 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-IQ4_NL.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q41-ppl-gate\corpus\wikitext-2-raw\wiki.test.raw -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks 64 --ppl-stride 0` |
| q4_0 | wiki | 64 | 4425.19 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_0.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q41-ppl-gate\corpus\wikitext-2-raw\wiki.test.raw -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks 64 --ppl-stride 0` |
| control | it | 60 | 3596.74 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_K_M.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\it.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| iq4_nl | it | 60 | 4576.11 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-IQ4_NL.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\it.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| q4_0 | it | 60 | 4121.92 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_0.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\it.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| control | es | 59 | 3419.03 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_K_M.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\es.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| iq4_nl | es | 59 | 4400.30 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-IQ4_NL.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\es.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| q4_0 | es | 59 | 4057.07 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_0.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\es.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| control | fr | 59 | 3448.29 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_K_M.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\fr.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| iq4_nl | fr | 59 | 4525.87 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-IQ4_NL.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\fr.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| q4_0 | fr | 59 | 4143.92 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_0.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\fr.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| control | zh | 61 | 3599.90 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_K_M.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\zh.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| iq4_nl | zh | 61 | 4566.32 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-IQ4_NL.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\zh.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
| q4_0 | zh | 61 | 4338.19 | `C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q59-dense-quant-gate\gguf\Qwen3.5-4B-fromsrc-Q4_0.gguf -f C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q43-q8trunk-ppl-gate\corpus\zh.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0` |
