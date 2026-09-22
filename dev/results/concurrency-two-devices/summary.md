# What a second device costs on one engine

One question, one run: **what does one device's decode rate become when a second device decodes at
the same time, on the same engine.** Every number below is a field of `results.json`. The verdict
field is computed by the script from the recorded `cache_n` values — none of it is written by hand,
and neither is the provenance: `max_load`, `platform` and `backend` are fields of the artifact now.

## The run

| arm | what it is | wall | cache_n | tok/s |
|---|---|---|---|---|
| **A** | one device, the baseline | 3863.2 ms | 0 | **70.70** |
| **B00** | two devices, slot 0 | 5432.1 ms | 0 | **51.63** |
| **B10** | two devices, slot 1 | 5432.8 ms | 0 | **51.63** |
| **A2** | the baseline again, to measure drift | 3898.1 ms | 0 | **70.58** |

`A2/A = 0.9982`, inside the 3 % bracket: the machine did not move under the run, so the comparison
between the arms is the measurement and the rest is bookkeeping.

## The answer

| quantity | value | what it means |
|---|---|---|
| `per_stream_slot0_over_A` | **0.7302** | a device sharing the engine keeps ~73 % of its solo rate |
| `per_stream_slot1_over_A` | **0.7302** | the two slots agree to four decimals |
| `aggregate_over_A` | **1.4604** | together they deliver **1.46×** one device |
| `per_stream_slot0_over_A2` | **0.7315** | same comparison against the post-load baseline |
| cost of the second device, per device | **~27 %** | what sharing costs each of them |

Two devices do not halve and do not serialise: each keeps about three quarters of its solo decode
rate, and the engine's total throughput rises by about half. That is the number the panel will
print, and it is `ratios.aggregate_over_A = 1.4604` of this artifact.

## Why decode alone is being compared

`cache_n = 0` in all four arms, and the verdict field says so with the recorded values beside it:
`--cache-ram 0` and a fresh salt per arm, so no prompt prefix is in play and the difference between
the arms is decode, not cache. The arm walls are this machine's at `nice 10`, with the A2/A bracket
as the drift control — not performance promises.

## Provenance — what this number is a number *of*

Every row below is a field of `results.json`, under `provenance` or `provenance.release`.

| field | value |
|---|---|
| `max_load` | **6.0** — the ceiling this run passed (`--max-load`, after its default) |
| `release.status` | **`matched`** — the executed binary's `exe_sha256` is a row of the manifest |
| `release.manifest_url` | `https://dl.kalsa.io/kalsa-server/v1.1.1/manifest.json` (derived from the `kalsa-server-v1.1.1` binary directory) |
| `release.manifest_sha256` | `55d8128c05a985f54f7cb87a7cc99a89c640542d0619f4ae3cbf9ac1ec87f450` |
| `release.checked_utc` | `2026-09-22T21:36:51Z` |
| `release.tag` / `release.tag_object` | `kalsa-server-v1.1.1` / `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b` |
| `release.commit` | `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1` |
| `release.run_url` | `https://github.com/Aspis0/kalsallama/actions/runs/35762258094` |
| `release.built_at` | `2026-09-22T17:50:26Z` |
| `release.file` | `kalsa-server-v1.1.1-bin-macos-arm64.tar.gz` |
| `release.pack_sha256` | `a90d88a1650367c6821f70e625a4ff2d43744d5986580c206434381a732075a7` |
| `release.platform` | **macos-arm64**, `platform_source: manifest` (never the host) |
| `release.backend` | **metal** |
| `release.exe_sha256` | `327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde` — equals `provenance.engine_sha256`; the match is by this hash and by nothing else, never a path, never a directory name |
| `engine_version` | `version: 0.4.1-dev (build 11195, commit a7d2cec79)` |
| `model` | `Trinity-Nano-Preview-Q4_K_M.gguf`, sha256 `287562a3824ce2277e2c71cfcc70248b2d90f7fa342a4779979e0bf3e37ad546` |
| `argv` | `--parallel 2 --ctx-size 8192 --n-gpu-layers all --cache-ram 0 --slot-save-path ... --sleep-idle-seconds -1`, `nice -n 10` |
| `started_utc` / `finished_utc` | `2026-09-22T21:36:51Z` / `2026-09-22T21:37:11Z` |
| `loadavg_before` / `loadavg_after` | `[1.99, 1.81, 2.75]` / `[2.14, 1.85, 2.74]` |

This is **the release artifact**, not a fork build, and the artifact says so itself:
`release.status = matched`, which the harness derives by hashing the binary that ran and comparing
it with the published manifest. The three statuses are kept apart on purpose — `matched`,
`not-the-release` (manifest read, no row carries this hash → the §9 label
`fork build, not the release`, platform from the host, `backend: null`) and `unverified` (the
manifest could not be read → a dead network is never called a fork build). The version string
carries the commit the tag points at, so this number describes `kalsa-server-v1.1.1` on
macos-arm64/metal and nothing else.

`dev/test-release-provenance.py` is the executable check on those fields: a manifest whose
`exe_sha256` differs must go `not-the-release`, an unreadable manifest must go `unverified` and not
`not-the-release`, `max_load` must be in the artifact and equal the argument the run used — and an
always-true match (the hash comparison replaced by `True`) turns case (a) red.

`--sleep-idle-seconds -1` and not the 300 the app ships: an unload in the middle of the run would
contaminate every later arm. Recorded in the artifact, because a different value is a different
machine.

## The load, and what it does not mean to say

The run passed its own gate: `max_load = 6.0` against `loadavg_before = [1.99, 1.81, 2.75]`, and
the gate refuses to start the engine at all when the 1-minute load is above the ceiling. The machine
was **not empty** — `loadavg_after = [2.14, 1.85, 2.74]` — and that floor is the agent harness
itself. It is **a floor, not a variable**: it weighs on every arm, and the A2/A bracket confirms the
machine did not drift between them. A number taken in an artificially empty machine would be a
**better-looking and less true** number, because nobody runs two devices on an idle Mac.

What the floor does affect is the **absolute** rate: 70.7 tok/s is this machine at this floor. The
**comparison** — 0.73 per device, 1.46 in aggregate — is what the run is for.

## Declared, not hidden

- The raw engine log is **not** committed (`raw_log_committed: false`) and the prompt sentinel never
  appears in it (`prompt_sentinel_found_in_log: false`).
- `n_predict = 256`, `prompt_tokens = 512`, `--attempts 4` with one accepted attempt
  (`accepted_attempt = 0`).
- The artifact was written by the harness, not by hand:
  `python3 dev/measure-concurrency.py --bin /tmp/k111/kalsa-server-v1.1.1/kalsa-server --out
  dev/results/concurrency-two-devices/results.json --log /tmp/k111/server.log --slots-dir
  /tmp/kalsa-slots-concurrency`.
