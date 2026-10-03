# S23 in-app speed — option (a) lane KV on HTP, app main `7ec12eb0` vs baseline `101c2bdd`

Date: 2026-10-02, 19:49–20:18 EDT (device logclock). Device: Galaxy S23 (SM-S911U,
SM8550 / Adreno 740 / Hexagon v73), serial `R3CW406P8CV`, wireless adb
`192.168.1.152:35017`. UNPLUGGED the whole session — `dumpsys battery` showed
`AC powered: false, USB powered: false, Wireless powered: false` before every
turn (hard gate; `raw/opta-*-battery-pre.txt`), status 3 (discharging) throughout.
`persist.traced.enable=0` before every turn (`raw/opta-*-state-pre.txt`). This is a
MEASUREMENT (baseline `s23-layers-device-proof` reused EXACTLY: same prompts
sha256-verified, same turn protocol `raw/turn.sh`, same per-turn tok/s reads).

Build under test: **app `7ec12eb0`** — already installed; verified, NOT reinstalled:
`dumpsys package com.kalsa.app`: versionName 0.1.0, lastUpdateTime 2026-10-02
18:13:29 = the `s23-plugged-latch-7ec12eb0` session's `adb install -r` of CI run
`37066820198` (sha256 `f9d06532…952e`, `raw/` of that session). Option (a) build:
on the NPU lane the KV lives on HTP with **K and V q8_0**. Baseline: app
`101c2bdd` (CI 36951238850), engine `5b596ce43`, KV on the host with V q4_0; the
baseline build logged NO `prefill_kv`/`cache_type_*` fields at all (checked over
all 8 baseline `raw/proof-*-kalsa.txt`), so its typing is known from its report.

## Verdict

**Option (a) is a large prefill win and decode-neutral. Lane-on prefill (NPU, KV
on HTP, K/V q8_0) went from 177.5 → 706.7 tok/s median at short context (4.0×)
and 120.2 → 661.4 tok/s at long context (5.5×) — and the long-context gain is
the headline: the same 3145-token prompt that took 26.1 s of prefill on
`101c2bdd` takes 4.75 s here. Decode is unchanged within noise: lane-on short
11.1 → 10.6 tok/s median (−4.7 %, inside the baseline's own 10.2–11.3 spread),
lane-on long 8.65 → 9.10 (+5.2 %, n=2, not claimable) — V q8_0 on the lane does
not cost measurable CPU decode at these lengths. Answers correct on 7/7 turns.**
The cross-session control holds: lane-off (GPU) turns — code path unchanged vs
`101c2bdd` — landed within 4 % of the baseline (prefill +4.0 %/+3.3 %, decode
−0.1 %/+4.4 %), well inside the ±10 % comparability window, so the lane-on delta
is attributable to the build change. Every turn: exactly one `KALSA_GOVERNOR {`
line, `attempt:1`, `failed:false`, `interrupted:false`, `n_common=0` (cold loads),
`route_chunks_dropped:0`, zero crash markers (`CDSP0 CRASHED`, `dspqueue_*`,
`GGML_ASSERT`, `Aborted`, `Segmentation`, `Decoding Interrupted` — all 0), zero
dead markers, staging `stage-count=1` every turn, single send tap per turn
(the re-tap trap never triggered). 40/40 lane-on route chunks
`layers_device:"HTP0"`, 21/21 lane-off chunks `"GPUOpenCL"` — every chunk named.

## Side-by-side (all turns cold-launched, unplugged; prefill tok/s = prompt_n/(promptMs/1000), decode = predictedPerSecond, both from KALSA_TELEMETRY exactly as the baseline read them)

Per-turn values are listed in run order (thermal drift runs warm across the
evening session — see temps row). "npu arm" = `npu_lane=on, route=auto`;
"gpu arm" = `npu_lane=off, route=gpu`.

| cell | baseline `101c2bdd` (n) | option-a `7ec12eb0` (n) | median Δ |
|---|---|---|---|
| **Lane-on prefill, short** (1735 tok) | 178.2 / 177.5 / 173.9 (3), **med 177.5** | 706.7 / 709.0 / 706.6 (3), **med 706.7** | **+398 % (4.0×)** |
| **Lane-on prefill, long** (3145 tok) | 120.8 / 119.6 (2), **med 120.2** | 662.4 / 660.4 (2), **med 661.4** | **+450 % (5.5×)** |
| Lane-on decode, short (tok/s) | 11.3 / 11.1 / 10.2 (3), med 11.1 | 11.10 / 10.58 / 9.89 (3), med 10.58 | −4.7 % (noise) |
| Lane-on decode, long (tok/s) | 8.9 / 8.4 (2), med 8.65 | 9.25 / 8.94 (2), med 9.10 | +5.2 % (n=2, not claimable) |
| **Lane-off (GPU) prefill, short — CONTROL** | 112.2 / 101.9 (2), med 107.05 | 116.7 / 105.3 (2), med 111.0 | **+3.7 % (control PASS)** |
| Lane-off (GPU) decode, short — CONTROL | 10.7 / 9.7 (2), med 10.2 | 10.69 / 10.13 (2), med 10.41 | +2.1 % (control PASS) |

Covariates per turn (`raw/all-rows.tsv`, machine-generated):

| turn | arm | state/plat | lvl | temp pre (°C) | wd peak (°C) | chunks | layers_device | engine_prefill | prefill_kv | cache k/v | prefill tok/s | decode tok/s | tokens_predicted |
|---|---|---|---|---:|---:|---:|---|---|---|---|---:|---:|---:|
| opta-npu-s1 | npu | FAST/0 | 93 | 29.6 | 32.9 | 6 | HTP0×6 | NPU | device | q8_0/q8_0 | 706.7 | 11.10 | 593 |
| opta-gpu-s1 | gpu | FAST/0 | 91 | 34.4 | 37.4 | 6 | GPUOpenCL×6 | GPU | device | q8_0/**q4_0** | 116.7 | 10.69 | 574 |
| opta-npu-s2 | npu | FAST/0 | 90 | 36.0 | 37.4 | 6 | HTP0×6 | NPU | device | q8_0/q8_0 | 709.0 | 10.58 | 493 |
| opta-npu-l1 | npu | WARM/1 | 88 | 38.3 | 40.2 | 11 | HTP0×11 | GPU* | device | q8_0/q8_0 | 662.4 | 9.25 | 674 |
| opta-gpu-s2 | gpu | COOLMODE/2 | 87 | 39.7 | 41.0 | 15 | GPUOpenCL×15 | GPU | device | q8_0/**q4_0** | 105.3 | 10.13 | 546 |
| opta-npu-l2 | npu | FAST/1 | 85 | 37.5 | 40.7 | 11 | HTP0×11 | NPU | device | q8_0/q8_0 | 660.4 | 8.94 | 626 |
| opta-npu-s3 | npu | FAST/1 | 83 | 37.4 | 39.1 | 6 | HTP0×6 | NPU | device | q8_0/q8_0 | 706.6 | 9.89 | 581 |

\* the known label/device divergence at WARM: `engine_prefill:"GPU"` while all 11
chunks ran `layers_device:"HTP0"` at NPU speed — identical to the baseline's
`proof-npu-l1`; `layers_device` resolves it per chunk.

Chunk schedules match the baseline per prompt: short = `512+512+512+125+71+3`
(6 chunks) on both builds; long = 11 chunks `512+512+512+125+512+512+128+128+128+73+3`
on both; gpu-s2 chunked at 128 (15 chunks, COOLMODE) on both. Same prompts
(`raw/prompts.sha256` verified before the run), same prompt_n 1735/3145 every turn.

## Control check (lane-off vs baseline lane-off)

- opta-gpu-s1 116.7 vs baseline gpu-s1 112.2 → **+4.0 %**; opta-gpu-s2 105.3 vs
  101.9 → **+3.3 %**. Decode −0.1 % / +4.4 %. All inside ±10 % ⇒ conditions are
  comparable across the two sessions and the lane-on deltas above are
  attributable to the build change, not to session drift. Worth noting the
  control turns ran WARMER than the baseline's (pre-turn 34.4/39.7 °C vs the
  baseline's COOLMODE evening) and still came out slightly faster — the control
  is conservative.

## Decode, and why "no change" is safe

The lane-on decode delta is −4.7 % (short median) with mine and the baseline
both spanning ~10 % turn-to-turn (baseline 10.2–11.3; mine 9.89–11.10 across
pre-turn temps 29.6–37.4 °C). Two covariates push the same way: (1) mean decode
tok/s correlates negatively with generation length, and my turns generated
LONGER answers than the baseline (493–593 tokens vs 313 on the short prompt;
626–674 on the long) — a real q8_0-V decode penalty would therefore show up
larger than −4.7 %, not smaller; (2) the lane-off control decode moved +2.1 %
on identical code, bounding measurement noise. Conclusion: V q8_0 vs q4_0 costs
nothing measurable on CPU decode at these context sizes (≤ 3.8k tokens held).

## Correctness

- Short prompt (4 turns): every answer is exactly three sentences, no lists or
  headings, on-topic (battery % falls faster on a hot day; the OS throttles the
  processor to avoid overheating). `raw/opta-*-answer.txt` (4 short files).
- Long prompt (2 turns): both answers give the four required sentences —
  battery window, thermal ceiling, specialized engines (CPU/GPU/DSP), memory
  bandwidth — and then the final sentence beginning exactly **"The dominant
  factor"** naming the thermal ceiling (the baseline prompt's needle; the
  ZAFFIRO-42 prompt was a different session's). `raw/opta-npu-l{1,2}-answer.txt`.
- **7/7 turns correct** under the same acceptance the baseline used.

## Temps and gates

Pre-turn battery temp 29.6 → 39.7 °C (per turn in the table, from
`dumpsys battery` immediately before send); intra-turn watchdog (mandatory rule)
polled every 10 s during each turn: peaks 32.9 / 37.4 / 37.4 / 40.2 / 41.0 /
40.7 / 39.1 °C, **WARN(40) hit on 3 turns, never 43 °C, no kill, never 44.0**;
pre-turn Thermal Status 0–2 every turn (≥3 gate never fired, no cooldown wait
was ever needed); `persist.traced.enable=0` every turn; screen Awake +
keyguard `showing=false` + `topResumedActivity=com.kalsa.app/.MainActivity` at
every send; `low_power=0` all session. Battery 93 % → 82 %, floor 25 % never
approached.

## Protocol

`raw/turn.sh` is the baseline's harness reused with the deltas in
`raw/harness-deltas.md` (floor 25 % per owner rule 2026-09-23; filtered
dumpsys-battery lines committed; `low_power` covariate; intra-turn thermal
watchdog; early break if the app pid dies; post-telemetry answer-text capture).
Keys written only with the app force-stopped via the run-as sqlw harness
(`raw/sqlw.sh`, write + read-back verified every write): found before any write
(`raw/keys-found.txt`) = `route=gpu, npu_lane=off, nativelog=off,
energy_trace=1, kvtranscript=1`, `devmodels` absent, model `lfm2.5-2.6b` — the
values every previous session restored. Arms alternated per turn
(npu→gpu→npu→npu→gpu→npu→npu) to cancel thermal drift, which the baseline's
per-turn protocol allows; read-backs in `raw/arm-opta-{npu,gpu}-keys-readback.txt`.
At the end the keys were restored to the found values and read back
(`raw/keys-restored.txt`, byte-identical to `keys-found.txt`), Kalsa relaunched
and left foreground: boot plan `{"npu_device":null,…,"npu_lane":"off",
"gpu_fit":"Fit","npu_fit":"Fit","available_src":"fresh"}`
(`raw/final-state-relaunch.txt`), unplugged, 82 %, Thermal Status 2, traced 0.

## Anything odd

1. **`prefill_kv:"device"` is NOT by itself the option-(a) signature** — the
   lane-OFF turns also log `prefill_kv:"device"` (GPU-side prefill KV), with
   `cache_type_v:"q4_0"`. The option-(a) fingerprint on a stats line is
   `prefill_kv:"device"` **plus** `cache_type_k/v = q8_0/q8_0` (vs q8_0/q4_0 off
   the lane). The baseline build printed neither field.
2. After each key-restore force-stop, Android brought the **Dialer** (previous
   back-stack activity) to the foreground — harness artifact, twice, never
   during a turn (foreground re-verified at every send); Kalsa relaunched and
   left foreground at the end.
3. `opta-npu-l1` labeled `engine_prefill:"GPU"` at WARM with all chunks HTP0 —
   pre-existing label/device divergence, same as baseline l1, resolved by
   `layers_device` (see table footnote).
4. The evening session ran systematically warmer than the baseline's overnight
   one (baseline pre-turn battery 29–32 °C at FAST/0; mine up to 39.7 °C at
   plat 1–2) — this is exactly what the lane-off control absorbs; no gate was
   ever hit and the tightest cells (lane-on short: 706.6–709.0 tok/s across
   29.6–37.4 °C pre-turn) show prefill on the lane is thermally insensitive in
   this range.

## Evidence map

`raw/` holds ONLY grep-filtered lines and small state files — no full logcat:
per turn `raw/opta-<label>-*`: `-kalsa.txt` (KALSA_* extract; the governor line
carries `route_chunks[].layers_device`, `prefill_kv`, `cache_type_k/v`),
`-hexlog.txt`, `-fastrpc.txt` (grep-filtered), `-battery-pre/-post.txt`
(filtered dumpsys battery), `-state-pre/-post.txt` (wakefulness, keyguard,
thermal, traced, low_power), `-watchdog.txt` (10 s intra-turn temps),
`-answer.txt` (grep of UI text nodes after telemetry; full XML in /tmp only),
`-ui*.txt` (staging verification dumps, kept per the baseline's r1-audit
convention), `-sendtime.txt`, `-stage-count.txt`, `-amstart.txt`. Cross-turn:
`all-rows.tsv` (machine-generated by `raw/extract.sh`), `env.sh`,
`harness-deltas.md`, `turn.sh`, `sqlq.sh`, `sqlw.sh`, `extract.sh`,
`keys-found.txt`, `arm-opta-npu-keys-readback.txt`,
`arm-opta-gpu-keys-readback.txt`, `keys-restored.txt`, `final-state.txt`,
`final-state-relaunch.txt`, prompts + `prompts.sha256`. Screenshots only in
/tmp/s23-opta/shots (raw/ stays text-only).
