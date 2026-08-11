# trial-marco interim status 2026-08-10T19:24:28.7881827-04:00

## FASE 0 corpus
corpus/multi5: en=50943 es=52648 fr=50848 it=50054 zh=50284 (UTF-8 LF)
SHA256SUMS present.

## Marco model
path: models/Marco-Mini-Instruct.i1-Q4_K_M.gguf
bytes: 10505424704 (match mandate)
sha256: A001D324B6EDC6A797009FBE6EB94A52A9F32453EE8D06465409875F3E3A6DBC

## Jelly binary pin
sha256: 36b01966ba0f471d17f8fcb29ab49f64f760999c4256f612f959a7a0b178ce81
arch: armv8.2-a+dotprod+fp16 (no i8mm; Helio G99)
wrapper: ~/bin/run-bmoe (unset LD_LIBRARY_PATH)

## T0 PASS
arch: qwen3moe
16 tokens, 1.328 tok/s cold, cache 41.2% hit, 173.88 MiB/token

## T1 PASS  
campaign config cache=2000 dense=anon overlap -t2
46 tokens, 1.318 tok/s, 179.57 MiB/token, cache 35.3% hit / 1998.9 MiB
high re-reads (67.3/token) — small experts fill cache but thrash under diversity

## KEXP baseline (PC, in progress)
EN done: bpb=0.53857 ppl=5.56 n_tok=11088
es/fr/it/zh: running

## Next
- finish KEXP multi5
- Marco multi5 ppl (T2a fail-fast EN/ZH/IT then T2b)
- Qwen3.5-4B multi5 (T2c)
- push KEXP to Jelly for T3 ABBA
