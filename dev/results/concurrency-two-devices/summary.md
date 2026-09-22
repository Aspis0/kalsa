# What a second device costs on one engine

One question, one run: **what does one device's decode rate become when a second device decodes at
the same time, on the same engine.** Every number below is a field of `results.json`. The verdict
field is computed by the script from the recorded `cache_n` values — none of it is written by hand.

## The run

| arm | what it is | wall | cache_n | tok/s |
|---|---|---|---|---|
| **A** | one device, the baseline | 3950.2 ms | 0 | **69.17** |
| **B00** | two devices, slot 0 | 5402.6 ms | 0 | **52.20** |
| **B10** | two devices, slot 1 | 5403.0 ms | 0 | **52.20** |
| **A2** | the baseline again, to measure drift | 3931.8 ms | 0 | **69.90** |

`A2/A = 1.0105`, inside the 3 % bracket: the machine did not move under the run, so the comparison
between the arms is the measurement and the rest is bookkeeping.

## The answer

| quantity | value | what it means |
|---|---|---|
| `per_stream_slot0_over_A` | **0.7546** | a device sharing the engine keeps ~75 % of its solo rate |
| `per_stream_slot1_over_A` | **0.7547** | the two slots agree to four decimals |
| `aggregate_over_A` | **1.5093** | together they deliver **1.51×** one device |
| cost of the second device, per device | **~25 %** | what sharing costs each of them |

Two devices do not halve and do not serialise: each keeps about three quarters of its solo decode
rate, and the engine's total throughput rises by half. That is the number the panel was missing.

## Why decode alone is being compared

`cache_n = 0` in all four arms, and the verdict field says so with the recorded values beside it:
`--cache-ram 0` and a fresh salt per arm, so no prompt prefix is in play and the difference between
the arms is decode, not cache. The arm walls are this machine's at `nice 10`, with the A2/A bracket
as the drift control — not performance promises.

## Provenance — what this number is a number *of*

| field | value |
|---|---|
| artifact | **`kalsa-server-v1.1.1-bin-macos-arm64.tar.gz`** |
| pack sha256 | `a90d88a1650367c6821f70e625a4ff2d43744d5986580c206434381a732075a7` |
| `exe_sha256` (what ran) | `327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde` — matches `provenance.engine_sha256` |
| `engine_version` | `version: 0.4.1-dev (build 11195, commit a7d2cec79)` |
| tag | `kalsa-server-v1.1.1`, object `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b` |
| commit | `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1` |
| workflow run | `35762258094` (`Kalsa Server`, 2026-09-22T17:50:26Z) |
| platform / backend | **macos-arm64 / metal** |
| model | `Trinity-Nano-Preview-Q4_K_M.gguf`, sha256 `287562a3824ce2277e2c71cfcc70248b2d90f7fa342a4779979e0bf3e37ad546` |
| engine argv | `--parallel 2 --ctx-size 8192 --n-gpu-layers all --cache-ram 0 --slot-save-path ... --sleep-idle-seconds -1`, `nice -n 10` |
| started / finished | `2026-09-22T18:50:22Z` / `2026-09-22T18:50:44Z` |

This is **the release artifact**, not a fork build: the inner binary's sha256 is the one the
published manifest states, and the version string carries the commit the tag points at. This number
describes `kalsa-server-v1.1.1` on macos-arm64/metal and nothing else.

`--sleep-idle-seconds -1` and not the 300 the app ships: an unload in the middle of the run would
contaminate every later arm. Recorded in the artifact, because a different value is a different
machine.

## The load, and what it does not mean to say

This ran on a machine that was **not empty**: `loadavg_before = [3.99, 5.83, 7.07]`,
`loadavg_after = [3.84, 5.68, 6.98]`. That floor is the agent harness itself — the window server and
the renderer of the conversation that produced this file — and it is **a floor, not a variable**: it
weighs on every arm, and the A2/A bracket confirms the machine did not drift between them. A number
taken in an artificially empty machine would be a **better-looking and less true** number, because
nobody runs two devices on an idle Mac.

What the floor does affect is the **absolute** rate: 69 tok/s is this machine at this floor. The
**comparison** — 0.75 per device, 1.51 in aggregate — is what the run is for.

## Declared, not hidden

- `--max-load` defaults to 6.0 and was **not** recorded as a field, so the ceiling this run passed
  is in the script, not in the artifact. It should be a field; it is not yet.
- `platform` and `backend` are recorded **in this summary by hand**, not as fields of
  `results.json`. They should be fields; they are not yet.
- The raw engine log is **not** committed (`raw_log_committed: false`) and the prompt sentinel never
  appears in it (`prompt_sentinel_found_in_log: false`).
- `n_predict = 256`, `prompt_tokens = 512`, `--attempts 4` with one accepted attempt (`accepted_attempt = 0`).
