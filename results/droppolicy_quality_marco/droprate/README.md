# droprate — how many slots each policy actually drops

Measured 2026-08-18 19:00 because **the number did not exist**. The PLAN and
`docs/ALIVE.md` both stated "weight drops 63.4 % of slots vs cold's 46.9 % at
d=1.0" and called it measured. It was not: those two figures appeared only in
prose, in no data file. They could not have come from the quality cell — the
`--ppl-decode` path prints only `BMOE_PPL{n_tokens,n_scored,sum_logprob,ppl,
seconds}` and no drop counters, and every `harness.err.log` in this cell is 0 bytes.

## What was run

Same binary as all five quality arms, verified by sha256, not by reading a script:

    build-pc-droppolicy/cli/bmoe-cli.exe   sha256 59f2762e54ed56af4c4b0bebfd3c9aa698785a391084adea535ba39accfcc59a
    models/Marco-Mini-Instruct-KEXP.gguf

Same config as the cell, one run per policy, 300 generated tokens:

    -t 16 -c 4096 --ubatch 512 --moe-stream --cache-mb 2000 --dense-weights anon
    --io-threads 4 --overlap --n-expert-used 6 --drop-cold-experts 1.0
    --drop-policy {cold|weight|random}
    -p results/f5.2/prompts/c1_long.txt --temp 0 --chatml --no-think

The counters come from the generation path, which prints
`moe-drop: N/M routed experts dropped (X%)` (`cli/main.cpp:1079`).

## Result

| policy | dropped / routed | fraction |
|---|---|---|
| cold   | 16427 / 50400 | **32.6 %** |
| weight | 31217 / 50400 | **61.9 %** |
| random | 14395 / 50400 | **28.6 %** |

- `weight` drops **1.90x** what `cold` drops, not the 1.35x the retracted caveat implied.
- The old 63.4 % for weight holds; **the 46.9 % for cold does not.** The real 32.6 %
  agrees with the only other independent measurement in the repo — `dropsweep_jelly`,
  `experts_routed=33600 experts_dropped=9986` -> 29.7 %.
- `random` is *not* identical to `cold` over a whole run (28.6 % vs 32.6 %). The code
  picks exactly `n_cold` slots per token (`router_hook.cpp:268-274`), but once two runs
  diverge they generate different text and fill the cache differently, so `route_miss`
  drifts. **The equal-count property is per-token, not per-run.**

## Declared limitation

Workload is **generation**, not `--ppl-decode`, so these absolutes are not the quality
cell's. What the caveat needs is the *ratio between policies at equal setup*, and that
is what this measures. Reproducing it under `--ppl-decode` would require teaching that
path to print the counters — it currently does not.
