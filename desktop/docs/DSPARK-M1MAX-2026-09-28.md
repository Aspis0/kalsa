# DSpark on the M1 Max — measured, 2026-09-28

Question: does `LiquidAI/LFM2.5-2.6B-DSpark` pay for itself as a speculative drafter
for the catalog's LFM2.5-2.6B Q8_0 row, on the engine the app already ships?
Everything here was measured on this machine (MacBookPro18,2, Apple M1 Max, 64 GB)
on 2026-09-28, port 8190/8191, scratch in /tmp/dspark. The owner's Kalsa.app
(pid 9587, port 8130) was running the whole time and was never touched; its CPU
was sampled per run and never exceeded 0.1%.

## Verdict

**Speed-up: yes at both temperatures, but content-dependent and far below the
claimed 2.27x — and negative on one Italian prompt.** At temp 0 the outputs are
byte-identical to the baseline on every prompt tried, so correctness is not the
blocker; the economics are. At 8k context the gain holds. Under a second
in-flight stream it mostly evaporates.

- Median per-prompt speed-up: +39% (English summarize), +23% (English code),
  +15%/+17% (7.9k-token long context), +2%…+14% (Italian short),
  **−11%…−12% (Italian expository — a real regression)**.
- Mean accepted per decode step incl. the target token: 1.50–1.69 (ceiling with
  the measured config is 4). Liquid's M4 Max table claims 4.42 mean; that was
  **not reproduced** on this engine and these prompts (see "What I could not verify").
- Cost: +1.7 GiB peak RSS (3.43 → 5.13 GiB) and one more asset to pin.

## Identity of everything that ran

| Thing | Value | Status |
|---|---|---|
| Engine under test | `~/Library/Application Support/kalsa-brain/runtime/builds/metal/kalsa-server-v1.1.2/kalsa-server` | measured |
| Launcher sha256 | `327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde` — equals the pin at `crates/kalsa-runtime/src/assets.rs:196` and `.kalsa-build` | measured |
| Build marker | `runtime=kalsa-server-v1.1.2-bin-macos-arm64.tar.gz:691943209c64…cb6961` (`builds/metal/.kalsa-build`) | measured |
| Target GGUF | `LFM2.5-2.6B-Q8_0.gguf`, 2,874,779,648 bytes, sha256 `1e22128dfa128bdfb684da167e74e072d0a056baa7d06d9f280291e2839b0fc9` — equals the catalog pin `crates/kalsa-catalog/src/manifest.rs:853-856` (repo `LiquidAI/LFM2.5-2.6B-GGUF`, commit `e7caca5d835a3901a8e0d63e94009429bafafdfc`) | measured |
| Drafter GGUF used | `LiquidAI/LFM2.5-2.6B-DSpark-GGUF` → `LFM2.5-2.6B-DSpark-F16.gguf`, 663,691,776 bytes, sha256 `e198962c08903f3ba29f0ce6bf8e17f5e60bf85ec2f8673e1e2aab03508937e5` | measured |
| Fork at HEAD | `/Users/marco/Projects/kalsallama` `833cde99b47b81f5f6a2a6309fbb8504033174f5`, `git describe` → `main-b11193-833cde9` (upstream base b11193, not b10950 as the research doc guessed) | measured |
| Drafter sources | safetensors 655,421,522 bytes (matches research §6), sha256 `a464fec8d5cd06042ffb96b4da8cbb9d3222684901bae6830685c8464a536044`; `config.json` `86f67eed…`, architectures `Lfm2DSparkDraftModel`, block_size 9, markov_rank 256 | measured |

The shipped v1.1.2 binary **already accepts** the DSpark flags: `--help` lists
`draft-dspark` among `--spec-type` values and the full `--spec-draft-*` family.
No local build was needed for the measurement. A Metal build of the fork at HEAD
was still made (`/tmp/dspark/build`, `--target llama-server`, Release,
`GGML_METAL_EMBED_LIBRARY=ON`, UI targets off; version string `0.4.1-dev (build
11193, commit 833cde99b)`) and behaved identically where compared — used to
rule out engine-version effects.

## The exact argv

Baseline A (port 8190), the app's launch argv from
`crates/kalsa-launch/src/argv.rs` + the running app's own `server.state`, with
the measurement's declared deviations:

```
kalsa-server --host 127.0.0.1 --port 8190 \
  --model /tmp/dspark/dl/LFM2.5-2.6B-Q8_0.gguf --alias LFM2.5-2.6B-Q8_0 \
  --threads 4 --threads-batch 4 --batch-size 2048 --ubatch-size 512 \
  --ctx-size 65536 --n-gpu-layers all --flash-attn on \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  --temp 0.1 --top-k 50 --repeat-penalty 1.1 \
  --sleep-idle-seconds 300 --no-webui --parallel 1 --cache-ram 6144
```

DSpark B = A plus exactly:

```
  --spec-type draft-dspark \
  --spec-draft-model /tmp/dspark/dl/LFM2.5-2.6B-DSpark-F16-official.gguf \
  --spec-draft-n-max 3 --spec-draft-threads 4 --spec-draft-threads-batch 4
```

Deviations from the app's argv, all deliberate: `--parallel 1` (app uses 3; the
single stream must own the full 65,536 window), no `--slot-save-path` /
`--ctx-checkpoints` (app storage features, inert here), drafter KV left at the
engine default f16 and drafter layers at the default `auto`. Per-request
sampling overrode the server defaults: temp 0 (greedy) and the catalog row's own
sampling (temp 0.1, top_k 50, repeat_penalty 1.1; `manifest.rs:817-822`), seed 42.
Every request carried `cache_prompt: false`, so each rep pays its own prefill.
All runs used `/v1/chat/completions` (the GGUF's embedded `tokenizer.chat_template`
applies; the model emits a `reasoning_content` block first — that text counts as
generated output in every number below).

## Results (median tok/s decode, min..max over 3 reps)

Harness: /tmp/dspark/bench.py; rows in /tmp/dspark/results-*.jsonl. A second
full baseline pass (A2, 30 runs) bounded cross-arm machine noise at ±3%; the
numbered speeds are conservative for B by at most that much.

| cond | prompt (n_predict) | A med | A min..max | B med | B min..max | speedup | B acc/step | B acc rate |
|---|---|---|---|---|---|---|---|---|
| greedy | it_short (160) | 80.7 | 79.4..81.3 | 82.7 | 81.3..83.0 | **1.02x** | 1.57 | 0.45 |
| greedy | it_long (512) | 80.4 | 80.2..80.7 | 71.4 | 71.2..73.1 | **0.89x** | 1.51 | 0.35 |
| greedy | en_short (160) | 81.3 | 81.2..81.5 | 113.2 | 111.2..113.5 | **1.39x** | 1.69 | 0.76 |
| greedy | en_code (512) | 80.7 | 80.2..80.8 | 99.1 | 98.3..99.2 | **1.23x** | 1.64 | 0.60 |
| greedy | long_ctx (384) | 74.5 | 73.5..74.5 | 85.9 | 85.4..86.4 | **1.15x** | 1.64 | 0.61 |
| catalog | it_short (160) | 81.2 | 81.2..81.2 | 92.8 | 90.0..93.0 | **1.14x** | 1.61 | 0.54 |
| catalog | it_long (512) | 80.5 | 79.4..80.5 | 71.1 | 70.3..71.4 | **0.88x** | 1.50 | 0.34 |
| catalog | en_short (160) | 81.2 | 77.6..81.3 | 109.9 | 102.9..110.2 | **1.35x** | 1.68 | 0.71 |
| catalog | en_code (512) | 80.6 | 79.7..80.8 | 98.5 | 97.1..99.4 | **1.22x** | 1.64 | 0.60 |
| catalog | long_ctx (384) | 72.7 | 72.7..74.5 | 85.2 | 84.9..85.3 | **1.17x** | 1.64 | 0.59 |

- `acc/step` = (draft_n_accepted + predicted_n) / predicted_n — mean tokens per
  decode step including the verified target token. `acc rate` =
  draft_n_accepted / draft_n, the per-position acceptance of drafted tokens.
- Prefill is unaffected within noise: A 617–707 tok/s short prompts, 1,124 at
  7.9k; B 565–675 and 1,096. The drafter pays no prefill toll beyond noise.
- Long context: the speed-up **holds** at 7,895 prompt tokens (+15–17%), on a
  prompt that is varied prose, not repetition.
- Peak RSS: A 3.43 GiB, B 5.13 GiB (median of per-run maxima) — the drafter's
  0.62 GiB weights plus its f16 draft KV at 65,536 tokens.

## Correctness at temp 0

**Byte-identical.** For all five prompts, the three greedy A reps are identical
to each other and the B output equals A exactly (string equality over the full
generated text, reasoning + content). Draft counts are also exactly reproducible
(e.g. en_code 545/329 in every rep). The open upstream bug #25618 ("greedy
output diverges from vanilla on quantized targets") did **not** reproduce here
on the Q8_0 target at these settings — and an F16-target control run gave the
same acceptance, so target quant is not a factor for this pair.

## What moved the needle during diagnosis (all measured on the code prompt)

The first drafter tried was **self-converted** from `LiquidAI/LFM2.5-2.6B-DSpark`
safetensors with the fork's own converter — and it is a trap:

- Conversion is supported (`conversion/qwen.py:778-830`, class
  `DSparkModel`/`Lfm2DSparkDraftModel`, arch `dflash`; requires
  `--target-model-dir` pointing at the target repo's config+tokenizer,
  `conversion/qwen.py:655-667`), and the produced GGUF loads and runs — but
  acceptance collapsed to 0.36–0.46 acc/step (~28 tok/s, slower than baseline).
- Diffing my GGUF against the official `LFM2.5-2.6B-DSpark-F16.gguf`: identical
  tensor names, shapes, and dtypes; `fc.weight` and `markov_w1.weight`
  byte-identical; **attention weights differ — the converter permutes q/k for
  the config's `rope_is_neox_style: false`, the official file does not**.
  Re-converting without the permutation did not recover (0.38), so the defect is
  the permutation itself being applied at all. INFERRED: the official GGUF is
  the layout this engine expects; do not self-convert this drafter — pin the
  official file. (The research doc's claim "no official GGUF for the drafter"
  is wrong: `LiquidAI/LFM2.5-2.6B-DSpark-GGUF` ships F16/Q8_0/Q4_K_M.)
- `--spec-draft-n-max` matters and the default is wrong for this pair: 3 → 100
  tok/s; 5 → 80; 9 → 55. Liquid's PR-thread examples use 7–10 on other
  hardware; **3 is the measured optimum here**.
- No effect: KV q8_0 vs f16 (identical to the token), target Q8_0 vs F16,
  `--spec-draft-p-split 0`, `--no-spec-draft-backend-sampling`,
  v1.1.2 vs fork HEAD. `--spec-type draft-dflash` on this drafter is nonsense
  (0.02 acc/step) — `draft-dspark` is required.
- The engine reads block_size 9, mask 125017, target layers [2,9,17,21,27]
  (GGUF stores them +1 as hidden_states indices, `conversion/qwen.py:717-718`,
  consumed at `src/models/dflash.cpp:23`) and logs
  `sample_from_anchor=true`.

## Concurrency probe (--parallel 2, two requests in flight)

Same two prompts fired simultaneously, catalog sampling, 2 reps, port 8191
(server B2 = B with `--parallel 2`), against the same probe on baseline A2.

| stream | A solo med | B solo med | A ‖2 med | B ‖2 med | speedup ‖2 |
|---|---|---|---|---|---|
| en_code | 80.6 | 98.5 | 73.1 | 79.9 | **1.09x** |
| en_short | 81.2 | 109.9 | 60.7 | 61.5 | **1.01x** |

The speed-up survives concurrency only partially: +23% solo becomes +9% with a
neighbour; +35% becomes +1%. The drafter's GPU work is exactly the cycles the
second stream wanted. Note the app launches `--parallel 3`
(`server.state`), so a busy phone-family box is the *worse* end of this.

## What I could not verify

- **Liquid's headline numbers did not reproduce.** 61 → 139 tok/s (2.27x, mean
  acceptance 4.42/10) is their M4 Max harness; on this M1 Max, this engine, and
  these five prompts the mean gain is ~1.1–1.2x at acc/step ≈ 1.6. Their build,
  prompt suite, and exact flags for the Metal table are not published — the
  model card's Metal claim does not even name llama.cpp ("in SGLang and on
  Apple silicon via Metal"). Whether a newer upstream build than b11193 closes
  the gap is untested.
- Windows (Vulkan/CPU) behaviour of the fork with draft-dspark: untested here,
  still the open cross-platform question from research §6.
- The it_long regression's mechanism (Italian expository text at 0.34
  acceptance) is described, not explained — no access to the drafter's
  training distribution.
- `pmset -g therm` was not sampled per run; the ±3% noise bound comes from the
  A/A2/Adrift passes instead.
- The drafter's `lfm1.0` licence carries the same $10M-revenue condition as the
  target row (`manifest.rs:788-794`); legal, not measured.

## Files (all under /tmp/dspark, left in place)

`dl/` all model files with the hashes above; `bench.py`, `analyze.py` harness;
`results-A.jsonl`, `results-A2.jsonl`, `results-B.jsonl`,
`results-A-drift.jsonl` raw rows (timings, acceptance, RSS, owner-CPU per run,
full generated texts); `server-*.log` engine logs including the DSpark init
lines; `build/` the fork-HEAD Metal build; `kalsallama/` the HEAD clone.
Bench servers were killed; nothing outside /tmp/dspark and this doc was
modified.

---

## Correctness check — are we running DSpark correctly? (2026-09-28, later)

The numbers above carry three red flags: acceptance far below Liquid's 4.42/10, a
steep n_max penalty (9 → 55 tok/s vs 3 → 100) that a one-pass block drafter should
not pay, and a converter that already proved able to corrupt this arch's rope.
This section closes the question: **the fork is equivalent to upstream llama.cpp —
identical speed, identical acceptance, byte-identical output — so 1.6× is simply
what this pair does on our prompts on this machine.** Measured unless labelled.

### a) Liquid's own reference run

The `LiquidAI/LFM2.5-2.6B-DSpark-GGUF` README (read live today) gives the exact
reference argv and nothing more specific:

> `llama-server -m LFM2.5-2.6B-F16.gguf -md LFM2.5-2.6B-DSpark-F16.gguf --spec-type draft-dspark --spec-draft-n-max 10 --spec-draft-n-min 0 -fa on -ngl 99`
> "DSpark speculative decoding is in mainline, ggml-org/llama.cpp #25173."

No exact commit is named, and the README publishes **no acceptance or speedup
numbers for llama.cpp** — the 4.42/10 and 2.27x figures live in the
safetensors-card/blog tables, measured on **their** task mix: per-task acceptance
on M4 Max of 4.45 (MATH-500), 4.91 (GSM8K), 5.24 (HumanEval), 4.19 (MBPP), 3.33
(MT-Bench), mean 4.42 of 10. The upstream PR that added LFM2 DSpark (#27383,
merged 2026-08-20, commit `07822bddf`) reports the author's own 1.2B numbers on
an RTX 4070 Laptop: mean 2.12x (94 → 199 t/s) with per-task acceptance 18–66% —
and community results in that thread agree with our range, not the headline:
simongonzalezdc (Strix Halo) got acceptance 0.70–0.80 on prose with the default
`n_max=3` and only **+17.7%** with the F16 draft (Q8_0 draft: −20%); insraq's
"~3x" on Windows CUDA/Vulkan came with no acceptance figures.

On thinking: the target's chat template **always** opens the assistant turn with
`<think>` (README: "The generation prompt opens with `assistant\n<think>`"), so
reasoning tokens are the model's designed output; our runs counting
`reasoning_content` matches the design. Whether Liquid's acceptance tables were
computed over reasoning+answer or answer-only is not stated anywhere — CODE-DERIVED
from their use of eval harnesses (MATH-500 etc.): likely over everything the model
emits.

### b) Fork vs upstream, same everything

Upstream `ggml-org/llama.cpp` at master `57b557cb9` (today) built for Metal with
the same flags as the fork build. Diff of the DSpark runtime between upstream
master and fork HEAD `833cde99b`: `src/models/dflash.cpp`, `common/speculative.cpp`
(the whole `common_speculative_impl_draft_dflash` class) and `src/llama-arch.cpp`
differ **only** by upstream's `common_batch` API migration (#29385) and
unrelated-arch additions (DeepSeek YaRN rope_freqs, Gemma4 backbone #29226,
NVFP4 #28000) — no behavioural change in drafting, sampling, truncation, or
verification. No commit matching "apply the DSpark interleaved-rope reorder once,
not twice" (the PR-thread rumour) exists in upstream history; searched `git log`.

Same three prompts, Liquid's exact argv (F16 target, `--spec-draft-n-max 10`,
official drafter, greedy, seed 42):

| prompt | upstream tps | v1.1.2 tps | acc rate | tokens/step |
|---|---|---|---|---|
| en_short | 71.3 | 72.1 | 0.40 | 4.6 |
| en_code | 58.3 | 58.7 | 0.30 | 3.7 |
| it_long | 40.3 | 40.4 | 0.17 | 2.5 |

F16 no-draft baseline en_code on upstream: **56.3 t/s** (Liquid's M4 Max baseline
61 is consistent with the ~1.1x M4/M1 bandwidth ratio). At n_max 3: upstream
98.2 vs fork 100.6. And the greedy output of upstream and v1.1.2 at identical
argv is **byte-identical** (en_code, 2,117 chars, exact string equality). The
earlier table's "B acc/step" column is the ratio (accepted drafts + emitted) /
emitted; restated as tokens per decode step including the bonus token it reads
2.5–2.9 at n_max 3 and 2.5–4.6 at n_max 9.

**One pass per block — confirmed, not autoregressive.** The fork's
`common_speculative.cpp` `draft()` builds "one batch holding every drafting
sequence's noise block into a single decode" and calls `llama_decode(ctx_dft,
batch)` exactly once per step (comment and call in
`common_speculative_impl_draft_dflash::draft`). The `-v` logs agree: each block
emits candidate lines for all 9 positions at the same timestamp (e.g. 10,179
candidate lines for these runs, `pos 0..8` grouped per step). The n_max penalty
is on the **target's verify pass**: with n_max 3 the target decodes 4 tokens per
step at ~28.5 ms (98.2 t/s at 2.8 tokens/step); with n_max 9 it decodes 10 at
~63.5 ms (58.3 t/s at 3.7) — the M1 Max Metal cost of a width-10 dense F16
verify is ~3.6x the single-token step (17.7 ms), and the extra accepted tokens
do not pay for it. Liquid's M4 Max numbers were measured with the Metal
small-batch tiles of #27441 (2026-08-31) on a 1.37x-bandwidth chip; even so, on
our prompt mix their argv yields 1.04x here (58.7 vs 56.3) and the plausible
reading of their 2.27x is the math/code-heavy task mix (acceptance 4.4–5.2) at
those flags on M4 Max. INFERRED, not measured: no M4 Max available.

### c) Verdict

**Fork == upstream** — to the first decimal in tok/s, identical acceptance, and
byte-identical greedy text. No defect to name; in particular the +1
hidden-state layer offsets (`src/models/dflash.cpp:23`), mask token 125017,
`sample_from_anchor=true`, and the official GGUF's rope layout are all read the
same way by both engines, and bug #25618 did not reproduce (greedy exact, and
the F16-target control matched the Q8 one). Acceptance 2.5–4.6 tokens/step sits
inside Liquid's own per-task spread (their MT-Bench row is 3.33); the shortfall
against the 4.42 mean is our prompt mix — Italian expository worst at 0.17
per-position — plus the M1 Max verify-width cost that makes n_max 3, not 10, the
right flag here. The first doc's conclusion stands unchanged.
