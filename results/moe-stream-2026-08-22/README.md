# MoE expert streaming on a model that does not fit — 2026-08-22

Model: `Marco-Mini-Instruct.i1-Q4_K_M.gguf`, **10,505,424,704 B** (9.78 GiB), arch `qwen3moe`,
256 experts, top-8, 28 blocks. Source `mradermacher/Marco-Mini-Instruct-i1-GGUF`; the byte count
matches the sibling repo's own record (`mandates/trial-marco.md:41`), so this is that artifact.

Binary: one build for both phones — `bmoe-cli` + its `.so` set, pulled off the Jelly and pushed to
the S23 unchanged. Built without i8mm, which costs the S23 some prefill and nothing in decode.
Same binary on both devices is deliberate: it removes the build as a source of device difference.

Both phones have less RAM than the model: S23 `MemTotal` 7,243,748 kB, Jelly 7,968,548 kB.

## What was compared

Both arms **stream**; the question is whether the drop policy pays.

  A  `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4`
     `--n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm`
  B  the same, lossless: model's own top-8, no drop

ABBA per block, medians over n=6 per arm, exact two-sided Mann-Whitney.

| device | A (tok/s) | B (tok/s) | A/B | U | p |
|---|---:|---:|---:|---:|---:|
| Jelly (G99, t2) | **2.962** | 2.144 | **1.381x** | 36/36 | 0.0022 |
| S23 (8Gen2, t4) | **5.792** | 3.175 | **1.825x** | 31/36 | 0.0411 |

Bytes are identical across devices (deterministic at temp 0): **197.01 -> 53.61 MiB/token,
-72.8%**; re-reads **93.4 -> 15.7 per token**; cache hit 28.3% -> 39.5%.

The sibling repo records -27% time / -68% bytes for this policy on Marco. Measured here, on this
harness: -27.6% time (Jelly, medians of `s_per_tok`: 0.4660 -> 0.3375) and -72.8% bytes. Same
effect, independently reproduced. The absolute
tok/s are NOT comparable to that repo's cards — different harness, and its default drop changed
(d065 -> d1.0 no-renorm), so its older absolute numbers do not describe this config either.

## Why streaming exists at all

Same binary, same device (S23), same prompt, `-n 32`:

| arm | tok/s | s/token | major faults/token |
|---|---:|---:|---:|
| streaming (lossless) | **2.971** | 0.337 | 0.00 |
| plain mmap | **0.152** | 6.562 | **17,478** |

**19.5x.** Without streaming the model technically runs and is not a product.

## Two caveats, both load-bearing

**The S23 series is directional, not citable.** Two runs collapsed (`3,3,B` 1.357 and `3,4,A`
2.467). Flash I/O barely moved across the collapse (0.213 -> 0.231 s/token, bandwidth 251 -> 232
MiB/s) while **CPU occupancy halved, 61% -> 30%**, per-token compute nearly tripled, and model
load went 7.3 -> 13.5 s. The process lost cores. `nproc` on the S23 reports **6** with 8 online;
the sibling repo has already seen `nproc=3` on this device and tracks it as open item #5b
("cpuset-gate enforcement, detect-only today"). Medians are robust to it, the ratio is not proven.

**The cooldown gate watched the wrong signal.** It gates on battery temperature, which was flat
(28.4-28.5 dC) straight through both collapses. A useful gate records per-run core availability,
not degrees. The Jelly needs no gate at all: 12 runs, 30 -> 33 dC, A-arm spread 2.2%.

## Files

  jelly_abba_block1.csv      first block, gate off
  jelly_abba_blocks2-3.csv   two more blocks, gate off  (n=6/arm across the two files)
  s23_abba_cooldown.csv      3 blocks, battery-temp gate at 28.5 dC
  s23_abba_aborted.csv       an earlier S23 series, killed by a 10-min foreground adb timeout
                             (the script survived and blocked writing to a dead pipe). Kept
                             because its two collapses match the same cpuset pattern.
  s23_mmap_control.summary.txt   the no-streaming control (result lines only; `*.log` is gitignored)
  jelly_lfm25_*.summary.txt      LFM2.5-8B-A1B, a model that FITS: streaming 2.338 vs mmap 8.403 tok/s.
                             The counter-example — do not stream what fits.
