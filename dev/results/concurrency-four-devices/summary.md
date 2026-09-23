# What four devices cost on one engine, through the door

One question: **what does one device's decode rate become when four devices decode at the same
time, on the released engine, each through the real door with its own credential, its own salt
and its own slot, at the app's own context.** Three runs, one after the other on a quiet machine,
each written by `dev/measure-concurrency.py` at `9897785`. Every number below is a field of one of
the three `results.json` files, or one step of arithmetic named beside it. There are two exceptions,
both named where they appear, and neither source is committed. The section on the slower slot reads
the raw engine log (`/tmp/c4-r{2,3}-engine.log`). The pinning paragraph's `cache_n = 507` reads the
harness's stdout (`/tmp/c4-r3.out`).

The panel's row is **not** changed by this artifact. That row is the two-device figure in
`../concurrency-two-devices/`, and changing it is the owner's decision.

## The three runs

| run | file | path | streams | per-slot context | flags |
|---|---|---|---|---|---|
| **R3** | `results.json` | **through the door** (`via: door`) | 4 | 65 536 | `--ctx-checkpoints 1 --flash-attn on` |
| R2 | `control-four-direct/results.json` | direct to the engine | 4 | 65 536 | same |
| R1 | `control-two-direct/results.json` | direct to the engine | 2 | 65 536 | same |

R2 is the control for the door: the same engine argv and flags with the door removed. The door's
path is therefore the intended variable between R2 and R3. Its extra traffic is described below:
the pinning completions before the arms, and the probe during B. R1 is the control for the configuration: two streams at the
app's per-device context and the tier's two launch flags. The panel's artifact ran at 4 096 per
slot and without those flags, so R1 separates "the configuration changed" from "the device count
changed". The engine is a fresh instance in each run, so R2 against R3 and R1 against the panel
are comparisons between runs, not within one.

## R3, the answer

| arm | what it is | wall | cache_n | tok/s |
|---|---|---|---|---|
| **A** | one device alone, through the door | 3863.8 ms | 0 | **70.65** |
| **B** slot 0 | four devices at once | 7424.5 ms | 0 | **39.83** |
| **B** slot 1 | | 7386.5 ms | 0 | **39.54** |
| **B** slot 2 | | 7425.1 ms | 0 | **39.83** |
| **B** slot 3 | | 7425.6 ms | 0 | **39.83** |
| **A2** | the baseline again, to measure drift | 3877.2 ms | 0 | **70.63** |

`A2/A = 0.9998`, inside the 3 % bracket, on the first attempt (`accepted_attempt = 0`).

| quantity | value | what it means |
|---|---|---|
| `per_stream_slot{0,2,3}_over_A` | **0.5638** | a device among four keeps **56.4 %** of its solo decode rate |
| `per_stream_slot1_over_A` | **0.5597** | the one slower slot (below) |
| `aggregate_over_A` | **2.251** | together the four deliver **2.25×** one device |
| `per_stream_slot0_over_A2` | 0.5639 | the same comparison against the post-run baseline |

Four devices neither go to a quarter of the speed each nor serialise. Each keeps a little over
half its solo rate, and the engine's total rises to 2.25× one device.

## The two controls

| run | per device | aggregate | A2/A |
|---|---|---|---|
| R3, door, 4 | 0.5597 / 0.5638 / 0.5638 / 0.5638 | **2.251** | 0.9998 |
| R2, direct, 4 | 0.5600 / 0.5600 / 0.5560 / 0.5601 | **2.2361** | 0.9937 |
| R1, direct, 2 | 0.7305 / 0.7306 | **1.4611** | 0.9988 |
| panel (`../concurrency-two-devices/`), direct, 2, 4 096 per slot, no flags | 0.7336 / 0.7336 | 1.4672 | 1.0037 |

- **The door costs nothing measurable on decode.** The four streams' summed rate is 159.03 tok/s
  through the door and 158.91 direct (`B_aggregate`), **+0.08 %**. The ratio gap looks bigger
  (2.251 against 2.2361, +0.67 %), but almost all of it is the denominator: R3's solo `A` came out
  0.59 % lower than R2's (70.65 against 71.07). For scale, the panel's artifact was written three
  times, and each version is in git: `git show <commit>:dev/results/concurrency-two-devices/results.json`
  for `5b9b98f`, `fe14e78` and `34de14f` gives `aggregate_over_A` 1.5093, 1.4604 and 1.4672, and
  `B_aggregate` 104.41, 103.26 and 103.58. So two runs of the same configuration have moved 3.35 %
  max to min in the ratio and 1.1 % in the summed rate. That yardstick is from two devices. At four
  there is **one** run per path, so the four-device spread is not measured, and 0.08 % is a
  difference between two samples, not a bound on the door's cost.
- **The tier's configuration leaves the two-device figure inside the panel's own range.** R1's
  aggregate is 1.4611 and its summed rate 103.86. Both lie inside the range of the panel's three
  runs (1.4604–1.5093 and 103.26–104.41). Against the run the panel cites, R1 is 0.42 % lower, and
  again most of it is the denominator (`A` +0.69 %, the B rates +0.27 %). R1 changes several things
  against the panel at once. Per-slot context goes from 4 096 to 65 536. Context checkpoints go
  from the engine's default, `max = 32` in the panel's `checkpoint_line`, to `max = 1`. Flash
  attention goes from the engine's default, which that artifact does not record, to `on`. And the
  engine instance is fresh. So this bounds the configuration as a whole; it does not isolate any
  one of them.
- **What the third and fourth device add.** Aggregate from two to four devices, at the same
  per-slot context: 2.2361 / 1.4611 = **1.530** direct, 2.251 / 1.4611 = 1.541 through the door. So
  the two added devices bring about 0.39 of a solo rate each, against 0.73 per device at two. The
  ratio divides across two runs with different baselines (`A` 71.08, 71.07, 70.65). It is not a
  per-device rate, and it does not separate the third device's cost from the fourth's.

## The door's pool is full at four, and the probe measured it

`door_queue_probe` in `results.json`: during B, a fifth request went through the door's worker path
(`/health`, `crates/kalsa-door/src/proxy.rs:51`). It was sent **1010 ms** after the four streams
(`sent_after_ms`), got status 200, and waited **6376.7 ms** (`wall_ms`). It was answered at
`probe_answered_ms = 7387.631`, **0.454 ms** after the first stream finished (slot 1's
`streams_done_ms = 7387.177`); the other three finished at 7425.3–7425.7 ms.
`streams_done_before_probe_answered = 1`. That count is decided by a 0.454 ms margin between two
client-side stamps, so a repeat could record a different count. The wait is the robust part:
6.4 s is about the length of the streams' decode. This is what the source predicts. The pool is
`WORKERS = 4`, `QUEUE = 8` (`door_pool_from_source`, read from `crates/kalsa-door/src/lib.rs` at run
time, because the compiled runner does not expose them), a worker holds one exchange end to end,
and four streams hold all four workers. So with four devices streaming, **any fifth request waits
for the first stream to end**, however small it is. It waits in the door's queue, which holds up to `QUEUE = 8` and is not punished for the wait (`crates/kalsa-door/src/proxy.rs:95-98`), bounded by the 300 s connection lifetime (`proxy.rs:94`). Past the queue, or past 12 connections, the answer is an immediate empty 503 (`server.rs:163-182`). With two devices, two workers stay free and
the source predicts no wait. That case is **not measured** here: R1 runs direct and has no probe.
Whether to change the pool is an owner's question (the plan, §9), and this run
does not answer it.

## The one slower slot

In each four-stream run one slot is about 0.7 % slower than the other three: slot 2 in R2 (39.51
against 39.80), slot 1 in R3 (39.54 against 39.83). It is also the slot that finishes **first**
(R3 wall 7386.5 ms against 7424.5–7425.6). The raw engine log shows when each slot started to
decode, not why the rate differs, and **that log is not committed** (`raw_log_committed: false`, at `/tmp/c4-r{2,3}-engine.log` on the measuring machine).
From each slot's `print_timing` line, the decode start is the end stamp minus the eval time. The
slower slot's decode began about **85 ms before** the other three, and those three began within
1 ms of each other (R2: 8.024 s against 8.110–8.111 s; R3: 9.273 s against 9.357–9.358 s). That
much is measured, in both runs. **Why** a head start makes the per-token rate lower is not
measured. The obvious story, that its first steps shared batches with the other prompts' prefill,
does not fit the prompt timings cleanly: in R3 they are 922.33 ms for slot 1, 990.65 for slot 0 and
773.63 / 773.68 for slots 2 and 3. Nobody has traced the engine's batch composition in those 85 ms.
The per-device figure above keeps the slot as measured; it is not averaged away.

One trap for whoever recomputes these rates from the log: the line says `6449.02 ms / 256 tokens`
and `39.54 tokens per second`, but 256 / 6.44902 s is 39.70. The engine divides by **255**: the
first of the 256 tokens comes out of the prefill, not the decode. The artifact's
`tokens_per_second` is the engine's own figure, and it agrees with 255 / eval time.

## Why decode alone is compared

`cache_n = 0` in every arm of every run (`warm_prefix_in_play`). `--cache-ram 0` is in the argv,
and in the door run each device's slot is erased before every arm, because a device's salt is
fixed and a missed erase would show up as a warm arm. Door mode **refuses to write the artifact**
if any arm is warm. Every arm generated 256 tokens from a 512-token prompt (`tokens_generated`,
`prompt_tokens_per_slot`).

Before measuring, each device's pinning was proved: through the door the device's request landed
on slot k, and a direct completion on slot k with that device's computed salt came back warm
(`cache_n = 507` for each of the four), after which the slot was erased.

## Provenance

| field | value |
|---|---|
| `release.status` | **`matched`**, and `release.identity.ok = true`: the module `libllama-server-impl.dylib` sha256 `714e8ba12e7f…` is recorded, and `--version`'s commit `a7d2cec79` agrees with the manifest's `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1` |
| `release.platform` / `backend` | **macos-arm64** / **metal** |
| `engine_sha256` | `327fb363e5246284…` (the launcher, the manifest's `exe_sha256`) |
| `running_engine_build` | `b11195-a7d2cec79`: the engine that ANSWERED on the port, from `/props`, agrees with `--version` |
| `engine_version` | `version: 0.4.1-dev (build 11195, commit a7d2cec79)` |
| `model_sha256` | `287562a3824ce2277e2c71cfcc70248b2d90f7fa342a4779979e0bf3e37ad546`, the panel artifact's model |
| `door_bin_sha256` | `22a187b18cc70cf9629ca1a071c4517377543c55e8e285dc2e975fab9c4bfe72` (`crates/kalsa-door/examples/measure_door.rs`, release build) |
| `door_source` | commit `989778504233d5823197b2f1545f719f992feffc`, `porcelain: ""` (the door subtree was clean) |
| `script_sha256` | `7dec052087546843bba3e0a94c96c925c5a83fe212a11a0f94441f30b8a07030` (`dev/measure-concurrency.py` at `9897785`) |
| `context_size_per_slot` | **65 536**, the app's default per device; `checkpoint_line`: `context checkpoints enabled, max = 1` |
| `max_load` / `attempts_max` | 6.0 / 4 |
| `loadavg_before` / `loadavg_after` (R3) | `[2.40, 2.28, 1.93]` / `[1.92, 2.17, 1.90]` |
| `started_utc` / `finished_utc` (R3) | `2026-09-23T17:33:54Z` / `2026-09-23T17:34:18Z` |

The machine was quiet, by the author's check by hand before the runs, which no artifact records:
no agent running, no other engine up, and the app closed. Activity Monitor was open, and it was the only
visible load. The floor, ~2.4 over one minute, is lower than the panel run's 4.08. What a floor
moves is the absolute rate, 70.6 tok/s here; it cancels in the comparison. The A2/A bracket
bounds the drift between the baseline before and the baseline after. It does not prove the
machine's state was unchanged all through the run.

No credential and no full salt is in any of the three files. In door mode the credentials came from
`secrets.token_hex(32)` and went to the door runner on its stdin only; the arms carry `salt_label`
`device-k`. Every 32+ hex string in the files is one of the identities in this table, or the
harness's own sha (`harness_sha256`), the manifest's and the pack's sha, or the release tag
object. In the direct runs, `salt_label` is the first 16 hex of each arm's salt, as in the panel
artifact, repeated under `arms` and `attempts`. Those salts are derived from public seed
strings: `44652eed8deaf2a5` is `sha256("kalsa-measure-concurrency/arm-A-0")[:16]`. Direct mode
generates no credential.

## Declared, not hidden

- One run of each. The spread quoted above is the panel's, three runs at two devices. Nobody has
  repeated the four-device run, so its own spread is not measured.
- The raw engine logs are not committed. The slower-slot section is the only place that reads
  them.
- The commands, exactly as run:
  `python3 dev/measure-concurrency.py --bin /tmp/k111/kalsa-server-v1.1.1/kalsa-server --streams 4
  --ctx-size 262144 --ctx-checkpoints 1 --flash-attn on --door-bin
  target/release/examples/measure_door --out dev/results/concurrency-four-devices/results.json
  --log /tmp/c4-r3-engine.log --slots-dir /tmp/kalsa-slots-c4-r3/`. R2 is the same without
  `--door-bin` and writes `control-four-direct/results.json`. R1 is `--streams 2 --ctx-size 131072`
  without `--door-bin` and writes `control-two-direct/results.json`.
