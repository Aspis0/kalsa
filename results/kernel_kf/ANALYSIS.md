# K-F Phase 0 — stall derived from Jelly Marco1c lineup

No device run. Numbers copied from `results/lineup_card/jelly_1c/logs/*/stdout.txt`
(run 2026-08-13). Campaign binary `36b01966…`, Marco1c `2f921958…`, flags identical
to the gated cell (`-t 2 -k 6 --drop-cold-experts 0.65 -n 200 --temp 0 --moe-stream
--overlap --io-threads 4 --cache-mb 2000 --dense-weights anon`). No prefetch /
route-ahead / predict-prefetch.

## Identity (closes per row)

```
wall = compute + cache_mgmt + stall
```

`flash I/O` is summed I/O-lane syscall time (`expert_stream_source.cpp:1401-1404`),
not a wall term. `wall − max(compute, flash)` is the wrong estimator (negative
here). Engine stall is `on_expert_ready` wait divided by `n_threads`
(`session.cpp:168-170`).

`moe-waits: drain` is not printed on any of the four stdout files → drain < 0.0005
s/tok (`cli/main.cpp:1045`). Previous-layer I/O is done before the next
`load_layer_async`. Tail already hidden.

## Per-run

See `derived.csv`. Median stall **0.1025 s/tok** / median wall **0.2746 s/tok**
(SPEED_VERDICT 3.642 tok/s) = **37.3%**.

## Ceiling inputs (Marco-Mini)

28 layers, k=6 (33600 routed / 200 tokens). Per-layer median: stall 3.66 ms,
compute 5.52 ms, lane-busy 12.6 ms, 1.84 MiB. Mean I/O parallelism
0.3525/0.2746 = 1.28 of 4 lanes.

Recoverable = min(stall, next-layer I/O issuable early). Layer 0 cannot be
prefetched. Two windows documented in `reports/moe-kernel-kf-stall.md`.
