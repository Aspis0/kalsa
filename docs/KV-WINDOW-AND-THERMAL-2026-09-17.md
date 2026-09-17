# The window slide, the heat, and what LFM2 actually is (2026-09-17)

One T20C run, a week of failures closed, and a conclusion we had been repeating
for three weeks that does not survive reading our own engine source.

Everything below is measured on the Galaxy S23 (`192.168.1.152:43089`,
SM-S911U) unplugged, or read from the shipped source with the line quoted.
Run directory: `out/t20c-sendfix-20260917/` (gitignored; the numbers are here).

## 1. T20C: the re-send defect is fixed, and it was not what killed this run

Fixed in `d934eb0`. The harness proved a send had landed by reading the user
message back out of the device database; a phone busy generating does not
persist it in time, so the 45 s window expired and the turn was re-shared over
work already in flight. It now accepts the engine's own `KALSA_THINKING` as the
proof — it arrives 0.3 s after the send instead of minutes later.

**Result on this run: 6 turn sends, 6 `KALSA_SEND` lines, zero duplicates.**
Gaps between sends 2m24s … 7m45s, every one of them past the old 45 s window.
Three turns were carried by the new evidence path, two by `skip re-share`.

The run still ended at turn 6 of 20, `T20C_EXIT=1`, `THERMAL GIVEUP`.

## 2. Why it ended: twenty turns on an unplugged S23 are not thermally possible

| | |
|---|---|
| start | 34.6 °C, 89 % |
| 6 turns / 38 min later | **44.0 °C** |
| after 25 min idle (app stopped) | 34.0 °C, thermal status 0 |

The owner's hard stop is 44.0 °C. An out-of-band guard force-stopped the app at
`10:51:21` when it reached exactly that. The harness's own pause threshold is
42 °C and it gave up after its 600 s budget.

**The design defect this exposes:** `campaign_thermal_cooldown` in
`scripts/campaign/run-t20c.sh` deliberately does NOT force-stop, so an in-flight
turn is not destroyed (that was the right call, and at turn 3 it worked — the
turn finished during the pause and the phone shed 0.7 °C in 300 s). But an app
that is still generating cannot cool. At turn 6 the phone **gained** 1.9 °C
during its "cooldown": 42.1 → 44.0.

A pause that does not stop the work is not a pause.

## 3. Where the heat goes

`scripts/campaign/verdictSpend.mjs` now prints this at the end of every run
(reported, never gated):

```
prefill vs decode: 733s prefill (153s of it prewarm) / 651s decode (prefill 53%)
decode tok/s round 0, first -> last: 10.17 -> 6.48 (-36%)
re-prefill after a KALSA_WINDOW_SLIDE that cleared the KV: 4954 tok in 207s
```

Prefill is the majority of the compute, and after a window slide it is all of
it. Decode throughput fell 36 % across six turns — thermal throttling, in a
chat with no attachments.

### The window budget, from the slide marker itself

`KALSA_WINDOW_SLIDE {"nCtx":8192,"ceiling":4312,"systemTokens":1832,...}`

| | tokens | share |
|---|---|---|
| system prompt | 1832 | 22 % |
| generation reserve (`WINDOW_RESERVE_TOKENS`) | 2048 | 25 % |
| **conversation** | **4312** | **53 %** |

The reserve is 4x the answer budget (512). The longest think block measured
today was ~490 tokens, so think + answer stayed under ~1000.

⚠️ **Corrected 2026-09-17, later.** This section first said KV costs 29.2 KB/token
and that 8192 → 16384 would be +239 MB. **Both are wrong.** 29.2 KB/token came
from `KALSA_SESSION {"op":"save","estimatedBytes":...}`, which is a calibration
of the `.kvs` FILE on disk — the wrong quantity for a RAM question. The engine
reports its own cache size at every load:

```
llama_kv_cache: size = 52.00 MiB ( 8192 cells, 8 layers, 1/1 seqs),
                K (q8_0): 34.00 MiB, V (q4_0): 18.00 MiB
```

**52 MiB for the whole 8192 context = 6656 bytes/token**, and the cache is
already quantized (K q8_0, V q4_0). `src/engine/ModelRegistry.ts:241` carries
exactly `kvBytesPerToken: 6656`, so the registry and the engine agree; only my
arithmetic did not. On that basis 8192 → 16384 costs **about +52 MiB** on the
KV line, not +239 MB — pending a check that nothing else scales with n_ctx.

Open, and worth knowing: the `.kvs` file measures ~29910 bytes/token, **4.5x the
in-RAM cache**. Whatever `llama_state_seq_save_file` writes, it is not the
quantized cache verbatim. That ratio is what a system-prefix snapshot would
actually cost on disk, so it needs measuring before the file is designed.

Both numbers are product decisions. Neither has been changed.

## 4. The claim that does not survive: "LFM2's recurrent half cannot evict a prefix"

This is the reason recorded in `8a2579c` and `4004117` for discarding the whole
KV on every slide, and it is why we pay the 207 s. It is correct for Mamba and
RWKV. **It is not correct for LFM2**, and we had been applying another family's
property to our own model.

Read from the engine we ship:

- `llama-hparams.cpp:189-191` — the per-layer recurrent state is
  `n_embd * (n_shortconv_l_cache - 1)`. With `lfm2.shortconv.l_cache = 3` that
  is **2 activations**, 2048 × 2 floats per layer.
- `models/lfm2.cpp:169` — `d_conv = n_shortconv_l_cache - 1` = 2.
- `models/lfm2.cpp:196` — `bx = concat(conv, bx, 0)`: the state is literally the
  previous activations prepended to the new tokens. A 2-deep FIFO, not a running
  summary.
- `models/lfm2.cpp:10` — `is_recr_impl[il] = n_head_kv(il) == 0`. The shipped
  model reports `head_count_kv = [0,0,8,0,0,8,0,0,0,8,0,0,0,8,0,0,0,8,0,0,0,8,0,0,8,0,0,8,0,0]`:
  **8 attention layers out of 30**, 22 short convolutions.
- `llama-memory-recurrent.cpp:304-331` — `seq_add` on the recurrent side only
  bumps `cell.pos`; its own comment is *"for Mamba-like or RWKV models, only the
  pos needs to be shifted"*. The state data is position-free, so a position
  renumber costs nothing and touches nothing.

Consequence: the conv stack's receptive field is bounded by roughly
2 tokens per layer × 22 layers ≈ **44 tokens**, not 8192. Tokens 1..3999 are not
mixed irreversibly into anything. *(This last step is derived from the code, not
measured — see §6.)*

### So what actually broke

`4004117` measured: `n_ctx=8192, n_common=7379` → K-shift → `tokensCached=4304`
→ next send `n_common=0`. llama.cpp's context shift keeps `n_keep` at the front
and discards the **middle** (`n_discard = n_left/2` — hence 4304 ≈ 8192/2). Our
JS then sends the whole conversation on the next turn, and a cache with a hole
in the middle is no longer a prefix of anything.

**That is the native side and the JS side disagreeing about which tokens
survive — not a mathematical impossibility.** And the two policies already have
the same *shape*: llama.cpp keeps `n_keep` at the front and drops the oldest
after it; our JS keeps `systemTokens` and advances the message start
(`prevStart:0 → newStart:4`). Nobody ever told one how much the other dropped.

⚠️ Making two sides agree about the state of the native KV is the trap recorded
three times in this project. Any fix must have **one owner of the truth** — JS
decides the window, native evicts exactly that, and the boundary travels in the
`.kvs` metadata, which it already does.

## 5. Prior art: nobody has solved this, and our case is easier than theirs

Searched: state rollover, state handoff, shadow state, parallel state warm-up,
sliding-window inference for Mamba/RWKV/Jamba/Zamba, recurrent-state
checkpointing.

- **No paper or merged implementation** maintains a second live recurrent state
  from a future boundary and swaps at the slide.
- Closest published: *Sparse Prefix Caching for Hybrid and Recurrent LLM
  Serving* (arXiv 2605.05219) and **Marconi** (MLSys'25,
  <https://github.com/ruipeterpan/marconi>) — recurrent-state checkpoints for
  cross-request prefix reuse, not context-window rollover.
- Closest implementation pattern: vLLM **internal checkpoints**
  (<https://github.com/vllm-project/vllm/issues/52959>, open RFC) and **recompute
  backfill** (<https://github.com/vllm-project/vllm/issues/53041>), which
  explicitly considers loading the attention KV and re-running only the
  Mamba/SWA layers over the missing suffix.
- llama.cpp, vLLM, SGLang, TensorRT-LLM: none ship the technique.

All of that literature is about models whose state genuinely is unbounded.
**LFM2 is not in that family** (§4). The hard problem the field has not solved is
not the problem we have.

## 6. What is still unproven

- The ~44-token receptive field is **derived from the graph code, not measured**.
  A measurement is in flight on the Mac using
  `/Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/` and the shipped
  `LFM2.5-2.6B-Q4_K_M.gguf`.
- Whether a shift that keeps the conv state produces coherent output. Dropping an
  attention prefix changes attention outputs at later positions — the same
  approximation StreamingLLM accepts, but we have not verified it here.
- The decisive number: **`n_common` on the turn after a shift.** High means the
  on-device discard is avoidable. Zero means the original decision was right.
  *(Superseded later the same day — see §10: the run log already answers a
  sharper version of this question.)*

## 7. The Governor: one lever is already refuted, one is untouched

`docs/CORE-PLACEMENT-PILOT-2026-09-16.md` measured core placement on the Jelly
Star: restricting **decode** to the A55 cores costs **5.0–5.3x** decode time
(+402 % against a rule that tolerates +25 %). The energy win it reported is not
trustworthy either — the device dozed during the long arms. Conclusion recorded
there: *the energy-objective policy should not be built on core placement.*

That refutation is about **normal operation**, where latency has a budget.

**During a thermal pause the latency budget is infinite** — we are stopped
anyway. Today's alternatives are: force-stop (loses the turn) or keep running at
full speed (does not cool, §2). A third exists and the pilot does not touch it:
**keep generating on the little cores during the pause.** 5x slower costs nothing
when the comparison is a full stop, and it is the only option that saves the turn
*and* sheds heat. Unmeasured.

## 8. Open, and the owner's to decide

- The catalog admission threshold (deferred 2026-09-17).
- The thermal pause threshold: the owner's rule says thermal status ≥ 3, the
  harness is configured at `CAMPAIGN_THERMAL_PAUSE=5` and trips on battery > 42 °C
  instead. The two do not say the same thing.
- `WINDOW_RESERVE_TOKENS` 2048 against a 512 answer budget (§3).
- `n_ctx` 8192 vs 16384: **~+52 MiB** (see the correction in §3, not the +239 MB
  first published here), and the S23 is excluded from the upgrade by a gate on
  **total** RAM it misses by 82 MB while reporting 2.2 GB **available**
  (`src/context/windowProfile.ts`). At +52 MiB that gate is the only thing
  standing in the way.
- Whether a 20-turn acceptance run on battery is the right acceptance test at
  all, given §2.

## 9. Separately: the first turn of every conversation shows its reasoning

Not related to the above, found in the same run. `out/t20c-sendfix-20260917`,
assistant turn 1 begins *"The user wants me to respond in Italian about a 7-day
trip to Portugal…"* — 752 characters of raw chain-of-thought served as the
answer.

| turn | `<think>` | `</think>` | result |
|---|---|---|---|
| 1 | **absent** | at 752 | reasoning shown as the answer |
| 2 | present | at 1455 | clean |
| 3 | present | at 1481 | clean |

The chat template opens the block itself, so the completion carries only the
close. `src/engine/thinkStream.ts` has no rule for a closing tag that precedes
any opening tag: in both phases it deletes the tag and keeps the reasoning.
Under repair.

## 10. Later the same day: we already ship the fix, and the slide deletes it

Reading the shipped fork instead of re-arguing the theory.

`node_modules/llama.rn/cpp/rn-completion.cpp` carries a RAM **state checkpoint
cache** for hybrid models, enabled by default (`rn-llama.h:132-133`: 160 MiB,
8 snapshots; `rn-completion.cpp:150` gates it on
`llama_model_is_recurrent || llama_model_is_hybrid`). When `seq_rm` fails on the
recurrent half, `recoverStateCheckpoint` (`:325`) restores the longest snapshot
that is a prefix of the prompt and verifies `pos_max + 1 == k` before trusting
it. `evictStateCheckpoints` (`:158`) pins the lowest-position snapshot —
*"the first message boundary (system-prompt end) a brand-new session shares."*

That is the technique §5 reports nobody shipping.

**It works on this model on this phone.** `out/t20c-sendfix-20260917/logcat.txt:4357`:

```
KALSA_KVPREFIX embd=3993 text_tokens=4257 n_common=3189
```

804 tokens past the shared prefix, reused, with no `KALSA_KVDIAG` failure in the
run. Three times. *Caveat: the run captured RNLlama at W level only, so this does
not separate "seq_rm succeeded" from "a checkpoint was restored" — the success
path logs at INFO. Both readings support partial reuse; they are not the same
proof.*

**And the slide throws it away.** `rn-llama.cpp:1150` — `clearCache()` calls
`clearStateCheckpoints()`; `discardChatKvForWindowSlideLocked`
(`src/engine/LlamaService.ts:1528`) calls `clearCache()`. The system prompt is
byte-identical across a slide, so the recoverable prefix is 1832 tokens:
**4954 → 3122, −37 %**, exact.

This does not make the slide free. Dropping a prefix invalidates every later K/V
in any transformer — only the system prefix is recoverable, and that was always
the honest ceiling.

**Separately, and larger than the slide:** `src/app/foregroundIdleDispose.ts:4`
sets `FOREGROUND_IDLE_DISPOSE_MS = 180_000` while the thermal cooldowns in §2 run
300–360 s, so every cooldown unloads the model:

```
10:36:55  'model.unload', '{"reason":"idle","idleMs":343158}'
10:42:59  'model.unload', '{"reason":"idle","idleMs":331491}'
```

Each is followed by a reload and a fresh system prefill — prewarm ran three times
for the same 1832 tokens (71.9 s / 40.4 s / 40.3 s = 152 s in a 30-minute run).
The cooldown produces the compute that reheats the phone.
