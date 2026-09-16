# N-gram self-speculative decoding on kalsallama — findings

Branch: `ngram-spec-bench` · Worktree: `/Users/marco/Projects/kalsa-ngram-spec`
Status: tuned pass complete; verdict **NO n-gram knob in the app**. Energy was at
parity, and the durable assets are the greedy-transparency gate, the energy
harness and the clock telemetry.

## Why

CORRECTION (2026-09-15): an earlier version of this document claimed the five
n-gram speculative types are features "upstream llama.cpp does not have".
Wrong: all of them are inherited from ggml-org upstream and predate our fork's
branch point — ngram-cache #5479 (Gäßler, 2024-03), ngram-simple / map-k /
map-k4v #18471 (Rogmann, 2026-01), ngram-mod #19164 (Gerganov, 2026-01).
What is genuinely ours in this work: the greedy-transparency gate, the
ngram-cache hybrid rollback bug, and the on-device numbers on our models.

The r/LocalLLaMA Engram/Qwen3.8-Next discussion made two points that map onto
our stack: (a) hashed n-gram lookup tables are a Zipfian hot/cold-tier memory
workload — the same shape our bmoe expert streamer is built for; (b) a plain
n-gram drafter stacked on DFlash took a Qwen 3.8 27B from 2.26x to 4.68x. The
five upstream types (`ngram-simple`, `ngram-map-k`, `ngram-map-k4v`,
`ngram-mod`, `ngram-cache`; common/speculative.cpp, wired through
`--spec-type` and our llama.rn JSI `speculative.types` patch) were never
measured on our hybrid LFM2.5 models. The draft-verify loop rides the same
hybrid KV rollback paths we fixed for KV reuse, so correctness had to come
before speed.

## What was built (this branch)

- `tmp/build-android/` (not committed): llama-cli + llama-bench cross-built
  from the pinned fork commit `67c73d2` (NDK r27, arm64-v8a, android-28,
  Release, GGML_OPENMP=OFF — the dynamic libomp dependency broke on-device
  linking; the app/fork Android build does not use OpenMP either).
- `scripts/device-ngram-spec.sh`: Jelly A/B campaign. Arms `none`,
  `ngram-simple`, `ngram-map-k4v`, `ngram-mod` (+ `ngram-cache` behind
  `CACHE=1`). Prompts REP (structured checklist — n-gram friendly, the shape
  of the app's structured replies) and DIV (wiki.test.raw excerpt —
  adversarial, near-zero repeats, measures pure draft overhead). Battery
  preflight + mid-campaign re-check (aborts on charge), 45s settle, keep-awake
  via `device-env.sh`, SMOKE=1 for correctness-only runs on charge.
- `scripts/ngramSpecAggregate.mjs`: parses results.txt into per-(model,
  prompt) tables with vs-none deltas and gate status.

## Correctness gate (the load-bearing part)

Self-speculation must be greedy-transparent: `--temp 0` output with an arm
enabled must equal the baseline byte-for-byte. A divergence means the arm
accepted a draft token the target would not have sampled — a silent wrong
output, unacceptable regardless of speed.

### Host (macOS, LFM2.5-1.2B-Instruct-Q4_K_M, 160 tokens, t=4)

| arm | REP (checklist) | DIV (wiki prose) | speed vs none |
|---|---|---|---|
| ngram-simple | IDENTICAL | IDENTICAL | −1% (92.8 vs 93.6 t/s) |
| ngram-map-k4v | IDENTICAL | IDENTICAL | −3% |
| ngram-mod | IDENTICAL | IDENTICAL | −1% |
| ngram-cache | IDENTICAL | **DIFFERS** | **−23% (72.3 t/s)** |

### The ngram-cache greedy violation

On DIV, ngram-cache diverged from the baseline at ~93% of the generation
(1704/1815 bytes identical): "Appeared in the episode" vs 'Played "Craig" in
the episode', plus a truncated tail. One or two wrongly accepted tokens — a
rollback/acceptance bug in the fork's ngram-cache self-speculation on hybrid
(LFM2.5 gated-conv) KV, not noise. It is also the slowest arm by far. Verdict:
**do not wire ngram-cache anywhere until triaged** in the fork
(common/speculative.cpp, ngram-cache accept path). The on-device smoke already
reproduced the other three arms' IDENTICAL gate at n=24 (Jelly, t=2).

## First-pass results (defaults, 2026-09-15, Jelly Star, t=2, n=256, r=2)

Greedy gate: IDENTICAL everywhere, on device too (simple/map-k4v/mod).
With DEFAULT lookup parameters the draft never fires (proven host-side:
REP has line period 8 tokens with a changing digit inside every >=8-token
window, so 0% of generation steps can match) and an inactive drafter is
pure overhead:

| block | none | simple | map-k4v | mod |
|---|---|---|---|---|
| 2.6B REP | 3.90 | +-0.0% | +-0.0% | -9.0% |
| 2.6B DIV | 2.85 | -22.8% | -15.8% | -22.8% |
| 1.2B REP | 7.60* | -24.3% | -3.9% | -7.2% |
| 1.2B DIV | 5.90* | -9.3% | -7.6% | -0.8% |

*1.2B blocks ran thermally bimodal (8.8/6.4 within one arm, battery temp
pinned at 38.0C) — small deltas there are noise; the tight 2.6B numbers
are the trustworthy ones.

Verdict so far: with defaults, n-gram self-speculation on LFM2.5 hybrid is
strictly negative (0% best case, -23% worst). The decisive test of the
MECHANISM is the tuned pass: PURE (periodic, no digits) and COPY (verbatim
repetition) prompts with window ablation --spec-ngram-simple-size-n
4/5/6, energy instrumentation on (commit c5fae2f).

## FINAL VERDICT: n-gram self-speculation is a NO for the app (2026-09-15)

Tuned pass on the 1.2B (PURE = periodic digit-free lines; COPY = verbatim
reproduction of a prompt paragraph — the most favorable workload possible
for prompt-lookup), W ablation 4/5/6, energy instrumentation on:

| workload | none | ngram-simple | delta |
|---|---|---|---|
| PURE W=4 | 9.05 t/s | 4.80 | -47% |
| PURE W=5 | 9.05 t/s | 9.05 | 0% |
| PURE W=6 | 9.10 t/s | 9.05 | -0.5% |
| COPY W=4 | 8.40 t/s | 6.40 | -24% |
| COPY W=6 | 8.40 t/s | 6.40 | -24% |

Even on COPY — where the draft fires with near-ideal acceptance — the arm
is 24% SLOWER: on 2 CPU threads the verify batch of k tokens costs more
than k sequential decodes (CPU kernels scale with tokens; the "weights
read once" amortization argument holds on GPU, not here). Energy
(fuel-gauge, W=6 COPY): 1.93 W / 79 J per rep baseline vs 1.62 W / 75 J
with the drafter — J/token PARITY. So speculation neither buys speed nor
battery: latency collapses, energy is flat. Decision: no n-gram knob in
the app; the greedy gate, energy harness and clock telemetry are the
durable assets and apply to any future technique (DSpark, next pin).

Durable side-finding: ngram-cache violates greedy transparency on hybrid
KV (accepted a wrong token, Mac repro) — upstream-reportable with the
one-command reproducer in this document's history.

## Device campaign (historical record)

`tmp/wait-and-run.sh` polls the Jelly battery (every 2 min, 90 min budget) and
starts `scripts/device-ngram-spec.sh` the moment it is unplugged, then runs the
aggregator. Defaults: LFM2.5-2.6B-QAD-Q4_0 + 1.2B, NGEN=256, REPS=2, t=2 (the
G99 decode preset). Results land in `device-ngram-spec-out/results.txt`.

Read the speed verdict ONLY from the unplugged run. Expectations: REP should
show a win for simple/map-k4v (drafts fire on self-similar text); DIV should
show ~parity (draft rarely fires, small verify overhead). If REP wins < 5% on
2.6B, the feature is not worth an app knob yet.

## Next steps

1. Verdict complete: no n-gram knob in the app; the tuned pass found energy parity.
2. Triage ngram-cache acceptance bug in the fork (upstream-reportable).
3. Preserve and reuse the greedy-transparency gate, energy harness and clock
   telemetry for future techniques.
4. The Reddit 4.68x combo — DFlash + n-gram drafter together — remains unattempted
   and is not a basis for wiring an app knob.
