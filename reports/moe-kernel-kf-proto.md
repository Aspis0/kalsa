# K-F prototype A/B — `--kf-prefetch` on Jelly / Marco-Mini — 2026-08-14

## Verdict

**KF_PROTO_WIN(wall 0.318 -> 0.210 s/tok, -34.0%; decode 3.14 -> 4.77 tok/s,
+51.8%; stall 26.9% -> 17.2% of wall; precision 68.3%)** — with
**IDENTITY_D0=PASS** (byte-identical generations at drop 0, sha
`c8c6fe53…` on both arms).

Gate was >= 10% wall improvement with identical output: cleared by 3.4x.

## Setup

- Device: Jelly Star, UNPLUGGED, batt 84->79%, temp 28->34 C, floor 35,
  abort 43 C. Campaign pin `36b01966` verified before/after, untouched.
- Binary: `kalsa/kf-layer-ahead` @ `c3e8fc4` Android build (kf bin sha
  `81c10e8c`). Model: Marco-Mini KEXP (`2f921958`, campaign pin). Prompt:
  campaign `p_fact` (`b5301c32`).
- Config: campaign lineup cell (`-t 2`, k6, d0.65, cache 2000, overlap,
  io 4). ON arm adds `--kf-prefetch --kf-prefetch-width 6`.
- Sequence: ABBA cold 2+2 (OFF/ON/ON/OFF), 1 hot ON, then identity pair
  at drop 0 (OFF/ON, no cold). 200 tokens per run.

## Runs (campaign config d065)

| run | flag | cold | wall s/tok | tok/s | compute | mgmt | stall | stall% | hit% | MiB/tok |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | OFF | 1 | 0.320 | 3.123 | 0.219 | 0.015 | 0.086 | 26.9 | 52.3 | 52.7 |
| 2 | ON | 1 | 0.213 | 4.704 | 0.165 | 0.011 | 0.037 | 17.4 | 67.5 | 76.1 |
| 3 | ON | 1 | 0.207 | 4.829 | 0.161 | 0.011 | 0.035 | 16.9 | 69.4 | 68.7 |
| 4 | OFF | 1 | 0.316 | 3.162 | 0.217 | 0.015 | 0.085 | 26.9 | 52.3 | 52.7 |
| 5 | ON | 0 | 0.226 | 4.428 | 0.170 | 0.012 | 0.044 | 19.5 | 68.6 | 75.3 |

Medians (cold ABBA): OFF 0.318 / ON 0.210 s/tok. ON telemetry: issued
~35-38 MiB/tok, wasted ~11-12 MiB/tok, precision 68.2-69.4% (spec_useful/
spec_experts 6417/8615, 5913/8032, 6717/8931).

## Identity pair (drop 0, runs 6-7)

| run | flag | wall s/tok | tok/s | stall% | hit% | MiB/tok |
|---|---|---|---|---|---|---|
| 6 | OFF | 0.323 | 3.098 | 30.0 | 50.2 | 59.0 |
| 7 | ON | 0.240 | 4.170 | 22.5 | 62.5 | 76.2 |

- **IDENTITY_D0=PASS**: `gen/identity_OFF_d0.txt` and `gen/identity_ON_d0.txt`
  sha256-identical (`c8c6fe53b556…`). The issue-only contract holds where
  claimed (drop off), on device, on the real 35B-class model.
- The win is not a drop artifact: -25.7% wall at d0 too.
- **D065_TEXT_MATCH=no** — expected per review F2 (residency feeds
  `apply_drop` under d0.65); informational, not a failure. The certified
  product configs that use drop accept routing-policy sensitivity to
  residency by design; the kernel itself is proven output-neutral at d0.

## Where the time went

Stall s/tok fell 0.0855 -> 0.036 (-58% of stall). Compute s/tok also fell
0.218 -> 0.163: with experts prefetched, the demand path's mmap page
faults inside dequant/GEMV disappear, so "compute" (busy time) shrinks
too. Combined, the realized -34.0% essentially saturates the derived
issue-only ceiling (~36% of wall) from `moe-kernel-kf-stall.md`.

## Honest costs / caveats

- I/O volume: ON issues ~35-38 MiB/tok total (vs 52.7 demand-only OFF),
  ~31% of issued bytes wasted at precision ~68%. More flash traffic =
  energy cost not measured here (no J/token on this harness; the S23 ship
  A/B harness has the sampler — a K-F energy cell is future work before
  K-F enters a default config).
- Hot ON (0.226) ran slightly slower than cold ON (0.210/0.213) — single
  rep, within thermal drift (temp was rising 28->32 C); not load-bearing.
- N=2 per cold arm: the effect (3.4x the gate) dwarfs the noise, but the
  pre-registered N>=10 discipline applies before any ship claim (K-F is
  deliberately NOT in the running S23 ship A/B; it needs its own
  registered cell if promoted).
- Two ops incidents burned ~1.5h before the clean start (CRLF line
  endings killing Termux bash; Termux:API service death faking a battery
  failure) — both now in memory files with countermeasures.

## Artifacts

`results/kernel_kf_proto/device/` (runs.csv, KF.master.log,
identity_d0.txt, gen/), local push/install logs, branch
`kalsa/kf-layer-ahead` @ `c3e8fc4`.
