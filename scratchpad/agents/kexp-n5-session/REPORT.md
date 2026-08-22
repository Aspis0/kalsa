# KEXP N>=5 session -- queue #18

**Lock commit:** `618323c77e45d275746b1aa5df023a0cc6bc6056` (`618323c`). Protocol **v1.2**. Criterion 11.

Ship arms (same s3oracle binaries, **NO rebuild / NO redeploy**): A `-ngl 99`, B `-ngl 99 -ncmoe 99`, C `-ngl 0`. ALL `-nr -fa off -t 4`. tg512 `-p 0 -n 512 -r 1 -o jsonl`. Palindrome ABC-CBA. Pins: impl `8adc148c...`, opencl `f4325483...`, stub `b2ae0fa6...`, GGUF `b07c8087...`.

## Running medians (complete blocks only; full precision; display 3 dp; no pre-rounding)

| set | nA | nB | nC | med A | med B | med C | A/B | A/C | med peakT A | med peakT B | med peakT C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| all complete (primary) | 10 | 10 | 10 | 14.252 | 7.904 | 17.553 | 1.803 | 0.812 | 37.200 | 39.400 | 39.950 |
| cool-start only (secondary) | 10 | 10 | 10 | 14.252 | 7.904 | 17.553 | 1.803 | 0.812 |  |  |  |

Floor checks (unrounded): A/B>=1.50 **PASS** ; A/C>=1.20 **FAIL** ; peakT A <= B+0.5C **PASS**. 

A-decay is pre-declared: second-A cells are **never** dropped from complete blocks.

## Blocks

| block | status | temp_c_block_start | warm_start | level_pre | tg512 (*excluded) | A-decay | mean(A)/mean(B) | governor |
|---:|---|---:|---|---:|---|---:|---:|---|
| 1 | COMPLETE | 26.5 | False | 100 | A:16.180928999999999 B:8.2412379999999992 C:19.778127000000001 C:19.476053 B:7.9323300000000003 A:12.877768 | 20.414 | 1.797 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |
| 2 | COMPLETE | 34.3 | False | 96 | A:15.339504 B:8.1252370000000003 C:18.579401000000001 C:15.261571 B:7.8623950000000002 A:13.268247000000001 | 13.503 | 1.789 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |
| 3 | COMPLETE | 34.9 | False | 92 | A:15.651725000000001 B:7.8764830000000003 C:18.382337 C:15.704283999999999 B:7.5417589999999999 A:11.841953999999999 | 24.341 | 1.783 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |
| 4 | INCOMPLETE | 35 | False | 88 | A:15.402053 B:7.7912169999999996 C:18.617231 C:15.756073000000001 B*:5.2589839999999999 A:14.112579 | 8.372 | 1.894 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |
| 5 | COMPLETE | 34.9 | False | 84 | A:15.63409 B:7.9911909999999997 C:18.090551999999999 C:15.728835 B:7.4293440000000004 A:11.140067999999999 | 28.745 | 1.736 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |
| 6 | COMPLETE | 35 | False | 80 | A:15.235816 B:8.1021149999999995 C:17.016024000000002 C:15.782347 B:7.517957 A:10.489618999999999 | 31.152 | 1.647 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt |

## Flags

- lock_commit=618323c77e45d275746b1aa5df023a0cc6bc6056
- protocol=v1.2
- complete_blocks=5/5
- cool_start_complete=5
- C_over_cap=0

Raw: `results/kexp_speed_s23/n5/runs.csv`  probes: `results/kexp_speed_s23/n5/probes/`  pauses: `results/kexp_speed_s23/pauses/`

## Final verdict (from `runs.csv`, full precision; display 3 dp)

Lock `618323c77e45d275746b1aa5df023a0cc6bc6056`. Protocol v1.2. No rebuild, no redeploy of ship binaries. No SIGTERM. No oomwall. No ABORT/STOP/AMEND.

| criterion | result |
|---|---|
| 1. >=5 complete ABC-CBA | **PASS** — blocks 1,2,3,5,6 (all cool-start). Block 4 incomplete: B5 `wake_post=Dozing` (wall 220 s, rc=0, excluded; not in median). |
| 2. median A/B >= 1.50 | **PASS** — 14.252 / 7.904 = **1.803** |
| 3. median peakT A <= B+0.5 C | **PASS** — 37.200 <= 39.400+0.5 (A cooler by 2.200 C) |
| 4. median A/C >= 1.20 | **FAIL** — 14.252 / 17.553 = **0.812**. A is slower than C. Per prereg: **refute** the dossier "vs product default / no-offload" sentence. |
| 5. unplug per counted block; Awake per counted cell | **PASS** — USB/AC/Wireless false on every counted block. Counted cells `wake_post=Awake`. Launch gate: `*_wake_prelaunch.txt`. |
| 6. no oomwall | **PASS** |
| 7. binary pins + `-nr` + LOG_ALLOC unset | **PASS** — impl `8adc148c…`, opencl `f4325483…`, stub `b2ae0fa6…`, GGUF `b07c8087…`. jsonl `no_repack=true` on every counted cell. RAW env dump: `GGML_OPENCL_LOG_ALLOC is unset`. |
| 8. pins | **PASS** — timeout 900000, brightness readback 128, wifi_on=1 held, governor walt x8 per block. |
| 9. pause path / raw probes | **PASS** — no battery-floor pause (100% -> 76%). Probes under `n5/probes/` and `kexp_speed_s23/probes/`. |
| 10. no harness SIGTERM | **PASS** |
| 11. lock commit cited | **PASS** — `618323c` |

**Confirmatory package (all 11 must hold): does not ship** because (4) fails.

- Expert-placement sentence (A vs B, same ngl): **supported** (1.803x, A not hotter).
- Dossier sentence (A vs product-default C): **refuted** (A < C).
- Interpretive F6 (1.40-1.50 + cool-start): does not fire (primary A/B is 1.803).
- A-decay pre-declared and kept: 20.4%, 13.5%, 24.3%, 28.7%, 31.2% on complete blocks. Second-A never dropped.
- Per-block mean(A)/mean(B) robustness: 1.797, 1.789, 1.783, 1.736, 1.647 (not a collapse to 1.0).

### Optional arm D (descriptive, never ship)

2 cells, `-ngl 0` without `-nr`, stock impl `bad17952…` in `/data/local/tmp/s18stock` (not s3oracle). tg512 16.484 and 15.507 t/s. MemAvailable drop ~34 MB / ~23 MB. s3oracle impl left `8adc148c…` (no restore). Not in any median.
