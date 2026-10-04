# S23 in-app decode hop CPU<->NPU every 32 tokens vs CPU-only decode (app 3238e1bb, 2026-10-03)

Build: app `3238e1bb` (kalsa.rn `c3f982b5`, kalsallama `32f6033c8`), CI run 37160382939, debuggable APK sha256
`f40dccb9...43f4`, skels byte-identical to the binding manifest, hop code present (`decode hop cpu-to-npu` string).
S23 unplugged, 96 % at start, traced 0. Production defaults (npu_lane/route keys deleted), hop arm =
`kalsa.bench.decode_hop=32`, CPU arm = key absent; keys restored after (`raw/keys-found.txt` == `raw/keys-restored.txt`).
Same cold-launch turn harness as `s23-warm-1thread-8eba7982`, new decode-heavy prompt (`raw/prompt-decode.txt`,
~900-word guide). Zone sampler (1 Hz) on the phone for the session. No cool-start gate (owner rule).

## Smoke turn (short prompt, hop 32) - the hop works on real HTP

`decode_hops 11`, `decode_tokens_cpu 192 / npu 181`, hop KV commits **7.0 MB in 3.34 ms total**, decode 13.1 tok/s
(CPU-only short turns today: 10.6-11.1), answer correct, 0 crash markers, failed false.

## Session (decode prompt), order cpu, hop, cpu, hop, cpu

| turn | decode | tokens | decode tok/s | hops (cpu/npu tok) | hop commit ms | battery start -> end C | rise C / 1k tok |
|---|---|---:|---:|---|---:|---|---:|
| cpu-1 | CPU | 1116 | 10.25 | 0 | 0 | 32.7 -> 38.2 | 4.9 |
| hop-1 | hop | 1309 | **11.47** | 40 (670/640) | 19.3 | 36.9 -> 41.0 | 3.1 |
| cpu-2 | CPU | 1626 | **8.09** | 0 | 0 | 39.7 -> 42.8 | 1.9 |
| hop-2 | hop | 1399 | **11.30** | 43 (704/696) | 16.9 | 40.8 -> 42.8 | 1.4 |
| cpu-3 | CPU | - | - | - | - | 38.8 -> KILL 43.4 | VOID (watchdog) |

- **Speed: the hop holds decode speed under heat; CPU-only does not.** CPU-only fell 10.25 -> 8.09 tok/s (-21 %) as
  the phone warmed; the hop arms ran 11.47 and 11.30 (-1.5 %), the second one from the hottest start (40.8 C).
- **Thermal events: the only Android thermal status 3 came in a CPU-only arm** (cpu-2, 55 s in; governor saw
  platform status 2 at its end). cpu-3 then hit the 43 C watchdog. Hop turns ended at platform status 1.
- **Hop cost is negligible**: ~40 hops per ~1300-token turn cost 17-19 ms of KV commit in total.
- **Heat per token: direction only.** Battery rise per 1k tokens was lower in the hop arm of both pairs (3.1 vs 4.9,
  1.4 vs 1.9), but each hop arm started hotter, which by itself lowers the rise. The 1 Hz area metric is VOID after
  the sampler's own status-3 stop (it stopped during cpu-2), so only cpu-1/hop-1 have areas (0.42 vs 0.27 battery
  C·s/token), same start-temperature confound. A matched-start heat comparison is still to do.
- Answers: all four completed turns produced coherent ~900-word guides; 0 crash markers, failed false everywhere.
