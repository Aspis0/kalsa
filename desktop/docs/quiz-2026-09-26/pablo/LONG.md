# Pablo, long conversation — 2026-09-26, M1 Max 32 GB

`run_long.py`: turn 1 says "Il mio cane si chiama Pablo.", then N filler turns of
*I promessi sposi* (1400 chars each), then "Come si chiama il mio cane?". Depths
10/25/50/75/100/120 turns, seeds 1 and 2. Fork kalsa-server v1.1.2, `--ctx-size 65536`,
q8_0 KV cache, flash attention, each model's publisher sampling. Pass = the answer names Pablo.

| model | pass | prompt tokens where it breaks |
|---|---|---|
| Gemma 4 E4B Q4_K_M | 12/12 | — (up to ~54k) |
| Gemma 4 12B Q4_K_M | 12/12 | — |
| Gemma 4 26B-A4B Q4_0 | 12/12 | — |
| Qwen3.6-35B-A3B UD-Q4_K_M | 12/12 | — |
| LFM2.5-2.6B Q8_0 | 6/12 | all 6 at ≥ ~35.5k fail (5 of them claim "we never talked about a dog") |
| LFM2.5-2.6B F16 | 6/12 | same 6 cells; precision is not the cause |

LFM2.5 passes everything up to ~24k tokens and fails everything from ~35k up. Its
advertised 128k context is not a usable chat memory past ~30k; the chooser's 64k window is
honest for every other row. Raw answers in `long-*.jsonl`.
