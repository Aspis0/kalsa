# qwen_think_replay_probe.py

Start the template server, then run the probe against a catalogue GGUF and a
captured `history2_final.json` from an e2e artifact:

```
llama-server -m <qwen3.5-4b.gguf> --jinja --reasoning-format none -c 512 -ngl 0 \
  --no-warmup --port 8899 --host 127.0.0.1 &
python3 analysis/qwen_think_replay_probe.py <qwen3.5-4b.gguf> <history2_final.json>
```

`--reasoning-format none` is not optional: it is what the app passes, and the
field is capable of changing how a message is serialised into the template.
Exit 0 means every case reused the whole cache; exit 1 names the ones that did
not and the token position where each broke.

Both positions are compared against the **same** live token sequence, so "older
and final both REUSES ALL" also means the prewarm render and the next turn's
render agree on that prefix — which is the property that makes prewarming worth
doing at all.

Measured 18/09/2026: 6/6 on the two real stored emissions plus the
closed-immediately `<think>\n\n</think>\n\n` shape. Counts only; no prompt text
is printed.

## When to re-run this

**Whenever the chat template changes or the fork is bumped.** The contract this
probe checks is a property of the template *as rendered by the engine we ship*,
not of the app: two things it depends on are invisible from JS and would break
silently.

1. For an older turn the value of `reasoning_content` is never rendered — a
   single space is enough to stop the `</think>` split. If a template version
   starts rendering it, that space lands in the prompt and the cache breaks on
   exactly the seam this work repaired.
2. The final turn needs the reasoning `rstrip`ped because the template's `|trim`
   does not take effect on that path. If it starts taking effect, the strip
   becomes wrong in the other direction.

A jest test cannot see either: no test in the app may import the module that
loads the engine. This probe is the only check that looks at the real render.

## The probe has the same blind spot the code had

This probe tests **three** shapes: the two real assistant messages from the e2e
artifact, plus one closed-immediately form that I invented. On 18/09 an audit
found a fourth shape (`<think></think>ANSWER`, no newlines inside the tags) that
diverges, and executing the app-side splitter over a wider set found **five of
seven** shapes producing a render that is not the source:

| shape | render vs source |
|---|---|
| `<think>\nplan\n</think>\n\nANSWER` | identical |
| `<think></think>ANSWER` | cannot round-trip |
| `\n<think>\nplan\n</think>\n\nANSWER` | 1 char short |
| `<think>\nplan\n</think>ANSWER` | 2 chars long |
| `<think>\nplan\n\n</think>\n\nANSWER` | 1 char short |
| `<think>\nplan</think>\n\nANSWER` | 1 char long |
| `<think>\n   </think>\n\nANSWER` | 1 char long |

Those seven belong in `spans` here, measured against the real render rather than
against arithmetic. Until they are, this probe confirms the canonical path and
nothing else — which is exactly how the gap got in.

The app-side rule that came out of it: the predicate deciding whether a turn may
use the split fields **is** the contract — build the render from the fields and
compare it to the source, fall back to the raw span on any difference. A list of
shape checks only covers the shapes its author imagined.

## The acceptance criterion, deposited before the measurement

Baseline, e2e run 35407337897 on `c45f044` (qwen3.5-4b, compaction on), from the
artifact rather than the workflow log:

```
turn1: cached=2294 evaluated=2083 promptMs=7587
turn2: cached=2460 evaluated=2215 promptMs=917518
KV_CACHE: COLD (turn2 reused 0/2215 — full re-prefill)
kvdiag_t2: n_common=2081 total=2215 search_max=2081 checkpoints=[2294,]
kvdiag_t3: n_common=2213 total=2383 search_max=2213 checkpoints=[2460,]
KV_PREFIX: best n_common=2213 embd=2460 text_tokens=2383 whole_cache_reused=NO
SESSION_RESTORE: HIT, then LOADED BUT COLD (reused 0/2383)
```

The arithmetic names the defect without any inference: the turn-2 prompt is
**2215 tokens while the cache holds 2294**, and turn 3 is 2383 against 2460.
The replay comes out SHORTER than what was generated, which is the reasoning
block missing.

**The 79 and the 77 are floors, not the measurement.** Turn 2's prompt does not
only replay turn 1 — it also adds the new user turn and the generation prompt.
So the dropped reasoning is 79 *plus* whatever those cost, and the honest
statement is "at least 79 tokens short despite also carrying a new user turn".
Reporting 79 as the loss understates it.

Divergence puts `n_common` (2081) *below* the only checkpoint (2294); on a
hybrid model there is no partial `seq_rm`, so the whole cache is cleared.

After the repair, on the same cells:

1. **Turn 2's prompt must be LONGER than turn 1's final `cached`**, not shorter.
   This is a property of the rendered prompt alone and does not depend on any KV
   mechanics: if it still comes out short, the fix never reached the template and
   nothing else in this list matters.
2. `kvdiag_t2`: `n_common` at or above the checkpoint, so a checkpoint
   `<= n_common` exists.
3. `reuse_t2.txt`, the line whose `embd.size` equals turn 2's `tokensEvaluated`:
   `n_past > 0` → `KV_CACHE: WARM`.
4. Turn 2 `promptMs` collapses from ~917 s toward turn 1's ~7.6 s plus the new
   tokens.
5. The restart leg: `SESSION_RESTORE: HIT` without `LOADED BUT COLD`.

Prediction 1 is the cheap one and the one that falsifies fastest.

**The verdict line alone is not the evidence.** `pickReuse` in `scripts/ci-e2e.sh`
selects the native `Input processed` line whose `embd.size` equals the turn's
`tokensEvaluated`, and falls back to the last line of the turn when no exact
match exists — a fallback that can pick a background load. In the baseline the
exact match existed (`n_past=0, embd.size=2215`), so COLD there is real and not a
picker artifact. Check that the exact match exists before believing either verdict.

## Two things that will look like the fix failing, and are not

**On a phone that updates, every existing conversation pays one cold prefill.** The prompt
rendered for the *same* history changed, so a `.kvs` written by the previous build no longer
matches what the new build renders. It is one cold turn per conversation, once. In CI this never
appears — the emulator starts clean and the same build both writes and restores the session
within the run — so a cold restart leg in CI is a real failure, while a cold first turn on a
freshly upgraded device is expected.

**The repair only covers turns whose raw emission was stored.** An assistant turn whose
`modelEmittedText` is missing or whitespace-only falls back to `content`, which is the answer
without the reasoning, and still diverges from the KV. That is deliberate and pre-existing
(`modelEmittedText.ts:246-249`: assemble falls back to `text`/`content` when the emission is
missing, and G1 interrupted turns were saved that way). So "the history replays byte-exact" is
true for emission-present turns, not for every row ever written. A conversation carrying old
interrupted turns will still lose its tail at those rows.

### Why the upgrade turn is worse than a cold start, and why that is still not a bug

Traced on `sessionPersistence.ts:283-306`: the restore guard compares `historyHash`, computed
from the stored **messages**, against the saved meta. This fix does not change what is stored —
only how the stored history is rendered into a prompt. So after an upgrade the hash still
matches, the guard accepts, and the `.kvs` is read from disk in full.

Then the new prompt diverges from those tokens. On a hybrid model there is no partial
`seq_rm`, so the cache is cleared and the turn re-prefills from zero. The first turn of an
existing conversation therefore pays **the file read plus the full prefill** — strictly more
than a cold start would have cost.

It is not a correctness risk: the guard is right to accept (the KV really is that history under
the old render), and the divergence is caught by comparing actual token ids, not by trusting a
flag. But on a device it will look like the fix made the first turn slower, because for that one
turn it did. Measure the SECOND turn of an existing conversation, or a fresh conversation, and
say which one the number came from.
