# Harness findings — what we know, how well we know it

Living document. **Update it every time a review lands or new data arrives**, including when a
finding is weakened or refuted. The change log at the bottom is not optional: a conclusion that
silently changed is worse than no conclusion.

Goal it serves: make Kalsa's harness better than a bare sliding window on an on-device chat —
tool calls, context that survives, memory.

Last updated: 2026-08-19 · Evidence: campaigns `31739205810` (window 10), `31760516762`
(window 16) and `31861056717` (window 16, every 2026-08-14 defect fixed), Qwen3.5-2B, 6
seeds/arm, 16-turn conversations, Italian, CI emulator.

**Landed 2026-08-15:** `31910747849` (memory smoke, first measurement with the settled telemetry of
`bf3794d` — §3.3), `31911860830` (the `tools` phase, gate/nogate pair, one seed — §0 question 2).

**Landed since:** `32048465417` (Qwen3.5-**4B**, fase4, 10 seeds — question 1 for the 4B, opened
question 5) and `32103054225` (**LFM2.5-8B-A1B**, the shipping model — question 5 answered). Both
on `bench/fase4-harness-fix`, the first full campaigns since the harness fixes; everything green
after 08-13 had been a one-seed smoke. The 08-15 attempt at the 4B campaign (`31911872610`) was
**cancelled and produced nothing**.

**Nothing is in flight.** Open and instrumented but unmeasured: the digest-injection cadence
(§7.10).

---

## 0. The five questions this harness exists to answer

Everything below section 1 is evidence. This section is the answer, and it is what to read first.

**Read this distinction before the five answers, because it changes three of them.** In every
campaign run so far, `ciswire` means **the organelle-B digest alone** — the BM25 index of what has
fallen out of the verbatim window. The **memory subsystem has never been enabled in any campaign**
(§1.4). "CisWire works" is a claim about the digest. Memory is a separate, unproven, and currently
expensive thing (§3.3).

| # | Question | Answer | Confidence |
|---|---|---|---|
| 1 | Better than bare for small models? | **Yes on all three.** 2B +0.635 · **shipping LFM2.5-8B-A1B +0.312 (p=0.029)** · 4B +0.209 | high |
| 2 | Better tool / web-search use? | **Yes — tool precision nearly doubles** | medium |
| 3 | Holds context after many turns? | **Yes — no decay at all. Strongest result we have** | high |
| 4 | Faster / less prefill? | **Split, and the split is now measured.** Fewer *tokens* than bare, but it **costs cache**: digest arms reuse 0.564 against 0.704 bare. Memory-on reverses the token win too | high on tokens · high on the cache cost · none on the fix |
| 5 | Only for small models, or large too? | **Not about size at all.** It helps whichever model holds context worst — and that is the shipping MoE, not the small dense one | high |

Two sections follow the five answers and are not optional reading: **what it costs to run on a
phone** (the KV cache, load times, what happens when the user leaves and comes back) and **which
model each claim rests on** — the quality answers are all Qwen3.5-**2B** on an emulator, the speed
answers all Qwen3.5-**4B** on real hardware, and the two halves have never been checked against
each other.

### 1. Is CisWire better than bare for small models (Qwen3.5-2B/4B, LFM2.5)?

**On the 2B, yes, and not marginally.** Campaign `31861056717`, 6 seeds, every known defect fixed:

| arm | fact recall | sd | tool precision |
|---|---|---|---|
| bare | 0.313 | 0.348 | 0.241 |
| **ciswire** | **0.948** | **0.083** | **0.485** |
| v42 | 0.667 | 0.094 | 0.281 |

+0.635 over bare (p = 0.0043), +0.281 over `v42` (p = 0.0022) — and **more consistent**, sd 0.083
against 0.348. **4B: answered** (`32048465417`, see below). **LFM2.5-8B-A1B — the model Kalsa actually ships — is
in flight** (`32103054225`); its smoke ran clean and its tool-call blocker is fixed and proven
end-to-end (§3.6, §1.7).

### 2. Does CisWire improve web search and other tool use?

**Yes: tool-call precision 0.485 against bare's 0.241, nearly double.** The mechanism was not
planned and is the mirror of §1.2 — holding the context stops the model reaching for a tool to find
what it already has. Losing context *causes* tool misuse; keeping it prevents the misuse.

Gap: the dedicated `tools` phase has **never included a ciswire arm** — only `baseline` and
`nogate`, one seed (`31911860830`), where `tool_selection` scored 0.000 on both. That zero
indicts the phase, not the modes.

### 3. Does it hold context after many turns?

**Yes, and this is the strongest single result.** Early-probe vs late-probe recall:

- **`ciswire`: 0.938 → 0.958** — no decay at all (+0.020)
- `v42`: 0.854 → **0.479** — collapses (−0.375)
- `bare`: flat at 0.31, nothing left to lose

A mean can be argued with. A system that does not lose accuracy as the conversation grows is the
property a phone assistant actually needs.

### 4. Does it speed the model up — less prefill?

**Yes, and in the direction nobody expects: `ciswire` spends FEWER prompt tokens than bare**, about
**−170 per turn** from turn 12. The digest is bounded and flat — ~140 tokens, unchanged from turn 10,
it does not grow with the conversation. The mechanism is measured, not assumed: replies shrink from
**675 to 505 chars** because a model that *has* the fact answers instead of hedging around it. Ten
shorter messages inside the window save ~420 tokens against ~140 spent on the digest. Ranking costs
~0.07 ms/doc (1 ms → 25 ms as the corpus grows 44 → 363 docs): irrelevant.

⚠️ **Turning memory on reverses this.** Extraction runs a **full LLM completion every turn**, +40 %
wall clock (83 min against 59), and has stored nothing so far. It is the only cost in this project
paid on *every* turn regardless of benefit (§3.3).

⚠️ **And the token win is not the whole speed story: CisWire costs KV cache, measured.** On the
shipping model the digest arms reuse **0.564** of the prefix against **0.704** for bare (§7.9) —
14 points, paid every turn. The cause is structural, not a bug in the digest: the operative block
rides the last user message, and one turn later that message re-renders without it, so the cache is
dropped from there — taking that user turn *and the reply generated after it* with it (§7.10). Two
consequences worth holding together: the cost is per **injection**, not per change of content
(which is why freezing the digest saved nothing), and **nobody has yet run the variant that injects
sparsely**. The instrument for it exists and is off by default. Until that runs, question 4's honest
answer is: fewer tokens, worse cache, net effect on wall clock **unmeasured on a phone**.

### 5. Small models only, or large ones too?

**Answered, and the prediction on record (§3.2) was half right.** It predicted the effect would
**shrink** on stronger models, and it does: +0.635 on the 2B, +0.209 on the 4B (`32048465417`,
p = 0.0108). What it did not predict is the shipping model: LFM2.5-8B-A1B, the largest of the
three, gains **+0.312** (p = 0.0291) — more than the 4B. So the axis is not size.

The structural argument is sharper than the prediction: `ciswire` is **purely additive** — it
removes nothing and adds a digest of what left the window — so by construction it cannot recall
*less* than bare, on any model. But the size of the gain depends on **how much falls out of the
window**, which is a function of conversation length against window size, **not of how clever the
model is**. A large model with a large window needs it **later, not never**.

### What it costs to run on a phone — measured 2026-08-17, S23, Qwen3.5-4B

The quality answers above are worth nothing at 7 minutes a turn, so these are the runtime answers.
All from one unplugged six-turn run, ~1300–1500 tokens of context, `b31fb53`.

**The KV cache was being thrown away every turn.** Qwen3.5 is hybrid — its KV
cannot be rewound — and the chat template appends `<think>\n\n</think>\n\n` when it asks for an
answer and **never repeats it** when it re-renders that same answer as history. The new prompt
therefore diverged four tokens after the assistant header and the whole prefix was discarded, every
turn (§7.5). Two candidate fixes were **refuted by measurement, not argument**: replaying the
emitted text (shipped, then measured, then reverted) and flipping the thinking polarity (the mirror
image of the same asymmetry, §7.7d).

⚠️ **The table below is route 2, and route 2 does not ship.** Owning the prompt — keep `T` = the
bytes actually in the KV and append only the delta — produced these numbers on
`bench/kvtranscript-probe`, and §7.7j **refused to merge it**: the seam windows show every assistant
turn entering the prompt twice, and the acceptance criterion I had written could not see that,
because a duplicated `T` is still a valid prefix. Read the table as *what the cache is worth when it
works*, not as the product's current behaviour.

**What actually ships is narrower and separately measured**: `preserve_thinking: true` on
LFM2.5-8B-A1B (§7.9, commit `31c5489`) — reuse 0.035 → 0.599, prefill 255 s → 111 s, turn 295 s →
160 s on the CI emulator. Different model, different hardware, and roughly a third of the prefix is
still re-evaluated; §7.10 names where the rest goes.

| | before | after |
|---|---|---|
| prefill per turn | 72–80 s | **1.4–3.9 s** |
| `n_past` at turn start | 0 | **1298 → 1454** — the whole prefix reused |
| turns before thermal self-block | 4 (SEVERE) | 6+, never left `Thermal Status` 0 |

**Load and response, broken down** (the same run):

| phase | time |
|---|---|
| model load, first cold start | 4.7 s |
| model **re**load, weights still in page cache | 0.8 s |
| KV session restore from disk | **33–45 ms** |
| prefill, with the fix | 1.4–3.9 s |
| decode, short replies | 0.5–1.2 s |

Cold prefill runs ~18 tok/s; decode 5–8 tok/s. **The model's own work on a warm turn is ~4 s** —
earlier "31 s per turn" figures in this document were the harness's polling, not the product.

**Leaving the app and coming back: the model unloads itself, every single time.** Six out of six
turns logged `'model.unload', '{"reason":"background"}'` on an AppState transition — the user does
not have to close anything. What the fix changes is what happens on return:

```
12:28:26.448  'model.unload', '{"reason":"background"}'
12:28:37.042  KALSA_SESSION {"op":"load","ms":41,"ok":true,"tokens":1337}
12:28:38.108  Input processed: n_past=1337, embd.size=1365
```

**~5 s to a reply after returning, against ~80 s before.** The KV always survived the unload — the
file was on disk and `resumable=1` — it was simply *ignored*. That is the whole difference.

⚠️ **Injecting memory is expensive for a reason that is not tokens.** Facts live in the system
prompt (`LlamaService.ts:1712`) and the environment hash covers them (`:1709`), so changing one
fact trips `system_prompt_changed` and **rebuilds the entire cache**: 72 s at 1300 tokens, 394 s at
4100 (§7.1). Every memory write costs a full prefill. Injecting rarely is worth real seconds, not
cosmetic ones. The larger cost today is extraction, which runs a **full LLM completion every turn**
for +40 % wall clock and has stored zero facts (§3.3).

A fact leaves the model's reach **at a cliff, not a slope**: the verbatim window is the last 20
messages ≈ 10 exchanges, so something said at turn 1 is gone at turn 11. Bare's flat 0.325 → 0.300
is that cliff already hit.

⚠️⚠️ **UNMEASURED AND HOSTILE BY CONSTRUCTION: `ciswire` and the KV fix fight each other.** The
digest is not in the system prompt — `applyOperativeBlockFormat` prefixes it onto **the last user
message** (`LlamaService.ts:1556-1562`). Next turn that message is history and re-renders *without*
the digest, so the prefix diverges and the cache is discarded — which is precisely the defect that
forced the revert of memory-facts-on-the-user-turn (`9c73846`). **The 1.4–3.9 s prefill above was
measured on bare, not on ciswire.** Nobody has run the two together. Assume the saving does not
survive ciswire until a run says otherwise.

⚠️ **The cross-model comparison has a confound, and it is thinking.** Every Qwen number in this
document was measured with **thinking OFF** — `getThinkingMode` defaults to `"default"`, which
`thinkingBudgets.ts:12` documents as "production options identical (thinking off +
reasoning_format none)". Every LFM2.5-8B-A1B number was measured with **thinking ON**, because that
model cannot be silenced (`ModelRegistry.ts:235`). So "CisWire buys +0.312 on the shipping model
against +0.209 on the 4B" compares two different regimes, not two models.

Worse, **the thinking-off default has never been validated on quality**: `fase0` *is* the thinking
A/B and **no `fase0` campaign has ever produced a single result artifact** (checked across
`31861056717`, `31739205810`, `31760516762`, `31911860830`). The default was argued on prefill and
per-completion template re-init cost, and `thinkingBudgets.ts:29-31` records the awkward part in
its own words: off ≈ budget256 in wall time, cause **unproven**, first candidate "longer
un-reasoned answers". If that is what is happening, disabling thinking buys nothing and costs
answer quality. Marco's position (2026-08-18) is that thinking is what makes small models usable.
Campaign `32139648432` runs the A/B on the shipping model to settle it — `off` there means the
budget-0 sampler force-closing the block, which works even though the template has no off switch.

### Which model each claim rests on — the two halves have never met

| claim | model | where |
|---|---|---|
| ciswire beats bare, tool precision, decay curve, token cost | **Qwen3.5-2B only** | CI emulator, 6 seeds |
| KV fix, prefill, thermal, load/unload, ~5 s on return | **Qwen3.5-4B only** | S23, real hardware |
| **~2x faster per turn than the dense 4B — and it is what ships** | LFM2.5-8B-A1B | CI emulator smoke (§1.7, verdict reversed) |
| tool calls never parsed — **FIXED, proven end-to-end** | LFM2.5, whole family | (§3.6) |

**The quality claims and the speed claims come from different models on different hardware, and
neither has been checked against the other.** The 4B campaign in flight (`32048465417`) closes half
of that. LFM2.5-8B-A1B is in flight (`32103054225`); LFM2.5-2.6B has never run a graded campaign.

**And the model-specific findings are piling up, which is the argument for making the harness
model-aware:** the empty-think-block asymmetry is a *Qwen3.5 template* property; LFM2.5 speaks a
Python-call tool dialect while Qwen speaks JSON; the MoE discount is decode-only; and `nogate`
swings from 0.094 on the 2B to 0.944 on the 4B.
Three measured differences, currently handled in three unrelated places. Some model-awareness
already exists — `resolveThinkingParams` takes the active model, `recommendedModelId` switches on
RAM, `n_threads` derives from `cpu_capacity` — so the missing piece is a per-model capability
profile these decisions read from, not new machinery. **Do not build it before the campaigns
populate it**: today there is exactly one model measured per axis, which is not enough rows to
design a table from.

### ANSWERED 2026-08-18: the 4B campaign — ciswire wins there too, and the reason narrows

**Campaign `32048465417`**, Qwen3.5-**4B**, fase4, 10 seeds, 38 usable arms. Permutation tests on
the arm means (exact, two-sided).

| arm | n | recall | sd | early | **late** | blank | prompt tok @turn 13 |
|---|---|---|---|---|---|---|---|
| bare | 9 | 0.785 | 0.204 | 1.000 | **0.446** | 0 | 4811 |
| `v42` | 10 | 0.825 | 0.160 | 0.975 | 0.675 | 0 | 2905 |
| **`ciswire`** | 10 | **0.994** | **0.019** | 0.988 | **1.000** | 0 | 5161 |
| `nogate` | 9 | 0.944 | 0.108 | 1.000 | 0.889 | 0 | 5122 |

- `ciswire` vs bare: **+0.209, p = 0.0108**
- `ciswire` vs `v42`: **+0.169, p = 0.0108**
- `v42` vs bare: +0.040, **p = 0.70 — nothing**
- `nogate` vs bare: +0.160, p = 0.0905

**1. CisWire holds on the stronger model, and §3.2's prediction was right: the effect shrinks.**
+0.635 on the 2B, **+0.209** on the 4B — because bare improves from 0.313 to 0.785, not because
ciswire gets worse (0.948 → 0.994, sd 0.083 → **0.019**).

**2. The whole remaining effect is distance.** The 4B is *perfect* on recent facts (1.000 early on
every untreated arm) and loses **more than half** of distant ones (0.446 late). `ciswire` loses
**none** (1.000). So the answer to "does a bigger model still need this" sharpens: it does not need
help remembering — it needs help **not forgetting**, and that is the only thing left to buy.

**3. `v42` is dead on the 4B.** +0.354 (p=0.043) on the 2B becomes **+0.040 (p=0.70)**. Its trade —
give up verbatim window, buy a digest and a summary that is never built (§1.4) — stops paying as
soon as the model can use the window itself. Its 2905 prompt tokens at turn 13 against bare's 4811
show it is still paying the window it gave away.

**4. `nogate` reverses across models, and nobody predicted it.** 0.094 on the 2B — the worst arm by
far — and **0.944** on the 4B. Removing the tool gate is catastrophic for the small model and
nearly free for the larger one. This is the sharpest evidence yet that harness decisions are
**model-dependent**, and it belongs in any per-model capability profile.

**5. The §3.1 blocker does not reproduce.** Zero blank bubbles across all 38 arms, on every mode.
The stated reason not to make `ciswire` default was that treated arms roughly doubled them. On the
4B that does not happen.

⚠️ **6. CisWire is NOT free on the 4B — §1.5's saving was a 2B phenomenon.** There it spent ~170
tokens/turn *fewer* than bare, because holding the fact shortened replies 675 → 505 chars. Here
history length is identical across arms (35 440 vs 35 605 chars): the 4B does not hedge less when
helped, so the digest is **pure added cost — +350 prompt tokens at turn 13, and ~95 s more prefill
per turn**. Better recall, paid for. Quote it as a trade, not a free lunch.

**Caveats that must travel with these numbers.** Two arms died on a 2400 s per-turn timeout —
`baseline` seed 4 (turn 12) and `nogate` seed 10 (turn 11) — so those two arms are n=9, and the
campaign's own completeness gate **correctly refused to publish** (`BENCH_EXPECT_SEEDS=10`). Both
losses fell on **untreated** arms, which is not random: bare writes longer replies, so its prompts
grow faster and it reaches the cap sooner. The surviving `baseline` arms are therefore not a random
subsample. §3.2 recorded this risk before the run ("the 4B may hit it") and it hit.

### ANSWERED 2026-08-18: the shipping model — CisWire wins by MORE than on the dense 4B

**Campaign `32103054225`**, LFM2.5-8B-A1B, fase4, 10 seeds, **40/40 arms usable** — the
completeness gate passed, which the 4B run could not manage.

| arm | n | recall | sd | early | late | blank | spurious calls | prompt tok @13 |
|---|---|---|---|---|---|---|---|---|
| bare | 10 | 0.556 | 0.331 | **0.637** | 0.475 | 0 | **15** | 2967 |
| `v42` | 10 | 0.619 | 0.290 | 0.713 | 0.472 | 0 | 9 | 3000 |
| **`ciswire`** | 10 | **0.869** | 0.199 | **0.988** | **0.750** | 0 | **8** | 3483 |
| `nogate` | 10 | 0.644 | 0.397 | 0.725 | 0.562 | 1 | 10 | 3203 |

- `ciswire` vs bare: **+0.312, p = 0.0291**
- `ciswire` vs `v42`: +0.250, p = 0.0516
- `v42` vs bare: +0.062, **p = 0.70 — dead here too**
- `nogate` vs bare: +0.088, p = 0.64

**1. The harness helps the shipping model MORE than it helps the dense 4B.** Ranked by how much
CisWire buys: 2B **+0.635**, LFM2.5-8B-A1B **+0.312**, Qwen3.5-4B **+0.209**. "The harness rescues
small models" was the wrong shape for it — what it rescues is models that hold context badly, and
size is only a proxy.

**2. And the reason is uncomfortable: bare on the shipping model is *worse* than bare on the dense
4B** — 0.556 against 0.785. It is nominally the bigger model and it remembers less.

**3. Its failure mode is different, and CisWire fixes the part nobody expected.** On the 2B and 4B
every untreated arm scored ~1.000 on *early* probes: they held recent facts perfectly and lost
distant ones. Here bare scores **0.637 early** — it fumbles facts that are still inside the
verbatim window. CisWire lifts that to **0.988**. A retrieval digest is not supposed to help with
text the model can already see, so the mechanism here is not "restoring what fell out" but
something like concentrating attention on what matters. **Worth its own experiment; do not assume
the 2B/4B story transfers.**

**4. `v42` is dead on this model too** (+0.062, p=0.70), exactly as on the 4B. Two models, two
campaigns, same verdict: the trade it makes does not pay.

**5. It calls tools wrongly far more often.** 15 spurious calls on bare against the 4B's 4.
CisWire nearly halves that (8), the same coupling §1.2/§1.3 found — better context, fewer
pointless tool calls.

⚠️ **6. THE BIG ONE: this model reuses no KV cache at all.** Mean reuse fraction across all 40
arms is **0.008** (min 0.000, max 0.062) against the 4B's **0.561**. It re-prefills the whole
prompt on every single turn, on every arm.

| | LFM2.5-8B-A1B | Qwen3.5-4B |
|---|---|---|
| KV reuse fraction | **0.008** | 0.561 |
| prefill throughput (evaluated tokens) | **7.2 tok/s** | 2.4 tok/s |
| mean prefill / turn | 345 s | 628 s |

It is *still* faster per turn than the 4B — 3× the prefill throughput more than covers throwing
the cache away. But it means **the append-only transcript work (§7.7e–j) is worth more on the
shipping model than on the model it was built for**: on Qwen it recovers the ~44 % that diverges,
here there is a full prefill to recover on every turn. That is now the single largest identified
win on the model that ships, and it has never been tried on this family — the Qwen cause (the
empty think block) is a *Qwen template* property, so the cause here is unknown and must be
measured, not assumed.

### If this harness is reused for anything else — read this first

The deterministic harness is reusable, and the obvious next use is checking whether a small model
answers safely on delicate topics: medical, legal, psychological, financial. **The metrics in this
document are the wrong shape for that, in two specific ways, and both push toward harm.**

1. **The primary metric scores "I don't know" exactly like a wrong answer** (§3.8). On a factual
   recall benchmark that is merely a bias against cautious models. On a medical question it is
   inverted: appropriate abstention is the *correct* behaviour, and this metric punishes it. Any
   delicate-domain campaign needs a **calibrated-abstention metric** — refusal rewarded when the
   model does not know, penalised only when it does — before a single number is quoted.
2. **CisWire measurably reduces hedging.** §1.5 records replies shrinking 675 → 505 chars because a
   model holding the fact commits instead of qualifying. On recall that is precision. On "is this
   mole dangerous" or "can they evict me", a harness that makes a 2B **more assertive and less
   hedging** is a hazard we would be shipping deliberately, and this document would be the evidence
   we knew. Confidence must be measured separately from correctness before CisWire is pointed at
   any of these domains.

Two smaller traps for the same reuse: the `honesty` grader **only works in Italian** (§3.9), and
treated arms produce roughly **double the blank bubbles** (§3.1, cause unknown) — a blank reply to
a medical question is a different kind of failure than a blank reply to "what is the cat called".

---

## 1. Decided — act on these

### 1.1 The tool gate raises fact recall — but by breaking web search, not by being smart

**REVISED 2026-08-14 after measuring the rule directly. The earlier reading of this table was
wrong and is kept below so the correction is visible.**

| gate | tool precision | turns that hit the web | fact recall |
|---|---|---|---|
| on (`baseline`) | 0.374 | **2** / 96 | **0.563** |
| off (`nogate`) | 0.263 | **37** / 96 | **0.000** |

What I first concluded: "the gate stops the model substituting web search for recall."
What the rule actually does, measured offline against `src/rules/toolGate.ts`
(`ECHO_SIMILARITY_THRESHOLD = 0.18`, hashed char 3-gram cosine):

| user question | query the model would send | similarity | outcome |
|---|---|---|---|
| "Qual è la capitale del Madagascar?" | "capitale Madagascar" | 0.677 | **BLOCKED** |
| "Chi ha vinto il campionato 2024?" | "campionato calcio 2024 vincitore" | 0.571 | **BLOCKED** |
| "Quanto costa un volo per Tokyo?" | "voli Tokyo marzo prezzi" | 0.391 | **BLOCKED** |
| "Ricordati che il gatto si chiama Leopoldo" | "razze di gatti domestici" | 0.146 | passes |

**The gate is inverted in practice.** A *good* search query paraphrases the user's question, so
it scores high and gets blocked; a *spurious* search is about something else, so it scores low
and passes. Web search is close to non-functional with the gate on, and fact recall rises
because the model is forced back onto context — on a benchmark whose probes are all answerable
from context.

So the honest statement is: **the 2/96 figure is the gate refusing, not the model abstaining.**
The recall benefit is real but the mechanism is blunt and costs the user a working web search.

**Shipping blocker, now proven from campaign data rather than inferred.** The conversation
contains one turn where searching IS the correct answer — the user says *"Cerca sul web le
previsioni del meteo di domani a Milano"* (`probe_tool`, expectation `must`). Campaign
`31760516762`, 6 seeds per arm:

| arm | that turn succeeded | turns with web sources |
|---|---|---|
| baseline (gate on) | **0 / 6** | 2 |
| ciswire (gate on) | **0 / 6** | 3 |
| v42 (gate on) | **0 / 6** | 10 |
| **nogate (gate off)** | **6 / 6** | 37 |

The user asks in plain words and the gate refuses, 100% of the time, on every gated arm.

**This also corrects an earlier claim of mine in this document**: the `tool_call` family sitting
at 0.000 everywhere was blamed on a broken grader (`sources >= 1`). The grader was right — the
system was failing. I accused the instrument.

The fix under way inverts the comparison: a *legitimate* query paraphrases what the user just
asked (0.39–0.68) while a *spurious* one is about something else (0.15), so the rule should
block the unrelated case, not the related one. Inversion also fails in the safer direction — a
language with high baseline similarity lets searches through rather than killing the feature.
Known risk being measured, not assumed: a short or vague last message (`ok`, `cosa ne pensi?`)
makes everything score low, so a naive inversion would block legitimate follow-ups.

**Confidence in the numbers: high. Confidence in the earlier causal story: retracted.**

### 1.1b The fixed gate, re-measured — the claim survives, the mechanism is different

Campaign `31861056717` (2B, same regime, everything fixed), first arms:

| arm | gate | precision | recall | spurious | **the explicitly requested search** |
|---|---|---|---|---|---|
| baseline | on | **0.333** | 1.000 | 8 | **3/3** |
| nogate | off | 0.264 | 1.000 | 11 | **3/3** |

The turn where the user says *"cerca sul web…"* now succeeds in **both** arms. It was 0/6 with
the gate on this morning. So the fix did what it was meant to, and only now is the gate's real
value visible: **it cuts spurious calls 11 → 8 and lifts precision, at no cost to recall and
without blocking a single legitimate search.**

Put the two statements side by side, because the verdict looks the same and the reason is not:

- *this morning*: "the gate is essential — turning it off collapses recall." **Wrong.** The gate
  was breaking web search, and recall rose only because the model was forced back onto context.
- *now*: "the fixed gate reduces unnecessary calls without blocking the necessary ones."
  Measured, with both arms completing the required search.

Only the second survives being built on.

**And the blank bubbles are gone**: 0 in 96 turns, against 21 in 384 before — the prediction in
§3.10 recorded before the data arrived. Turns exhausting the 3-round cap fell from 9.9% to 6.3%,
and turns where a search actually succeeded rose from 13.5% to 22.9%.

**What remains is the number that matters for the fine-tuning question**: precision 0.333 with
the gate and 0.264 without — both low, and this is the first clean measurement of either. The 2B
calls tools on turns that do not need them; the gate catches some and the rest get through. It is
not a *format* problem (19/20 structured, 0 invalid names, 0 unparsed arguments) and not a
*recall* problem (1.000). It is a decision problem — which is what the `tools` phase exists to
split into "whether to call" versus "which to call".

### 1.2 Losing context *causes* tool misuse — the two axes are not independent

Share of turns where the model reached for the web, by position in the conversation:

| arm | turns 1–5 | 6–10 | 11–16 |
|---|---|---|---|
| `off` (bare) | 0% | 0% | 6% |
| `ciswire` | 0% | 0% | 8% |
| `v42` | 0% | 7% | **22%** |

`v42` shrinks the verbatim window, and as the conversation grows the model stops finding the
answer in context and goes searching. Modes that keep context flat do not degrade.

**Confidence: medium-high.** One model, one campaign, clear monotone trend.

### 1.3 `ciswire` mode beats both bare and `v42` — CONFIRMED with every defect fixed

**Campaign `31861056717`** (2B, window 16, six seeds, run after the gate inversion, the
blank-bubble fallback, the decline-aware metric and the locale gate all landed). This supersedes
the earlier numbers, which were measured while the tool gate was blocking ~100% of searches.

| arm | n | early | late | **mean** | sd | blank | tool precision |
|---|---|---|---|---|---|---|---|
| `off` (bare) | 5 | 0.325 | 0.300 | **0.313** | 0.348 | **0** | 0.241 |
| `ciswire` | 6 | 0.938 | 0.958 | **0.948** | **0.083** | **0** | **0.485** |
| `v42` | 6 | 0.854 | 0.479 | **0.667** | 0.094 | **0** | 0.281 |
| `nogate` | 4 | 0.094 | 0.075 | 0.094 | 0.188 | **0** | 0.253 |

- `ciswire` vs bare: **+0.635, p = 0.0043** (exact, 462) — was +0.396, p=0.0249 before the fixes
- `ciswire` vs `v42`: **+0.281, p = 0.0022** (exact, 924)
- `v42` vs bare: **+0.354, p = 0.0432** (exact, 462)

**Zero blank bubbles across all 24 arms**, against 21 before — the §3.10 prediction, recorded
before the data existed.

**Two earlier conclusions are corrected by this run:**

1. **"`v42` adds nothing" was an artefact of the broken gate.** It was −0.037 (p=0.60); with the
   gate fixed it beats bare by +0.354 (p=0.043). It is still clearly worse than `ciswire`, so the
   recommendation becomes "`ciswire` is better", not "retire `v42`" — a different statement, and
   shipping the first one would have removed something that works.
2. **Better context *improves* tool precision**: `ciswire` 0.485 vs bare 0.241, nearly double.
   This is the mirror of §1.2 — losing context causes tool misuse, so holding it prevents the
   misuse. The two axes are coupled in both directions.

**The decay curve is the strongest single argument.** `ciswire` runs 0.938 early → 0.958 late:
it does not degrade with distance at all. `v42` runs 0.854 → **0.479**. Bare is flat at 0.31
because it has nothing left to lose. A mean can be argued with; a system that holds its accuracy
as the conversation grows is the property a phone assistant actually needs.

### 1.4 The three modes, side by side — what they do and what it measures out at

Everything below is Qwen3.5-2B, window 16, six seeds, campaign `31861056717` (every defect found
on 2026-08-14 fixed). Read §2's caveats before quoting any of it.

| | **`off` (bare)** | **`v42`** | **`ciswire`** |
|---|---|---|---|
| **Context strategy** | last 20 messages verbatim (8 with images), 4000 chars each; older is gone | **shrinks** the verbatim window to ~6 recent messages, compensates with a BM25 digest **+ a rolling LLM summary** | **keeps the full 20-message window, identical to bare**, and **adds** a BM25 digest of everything outside it |
| Nature of the trade | none — pure loss | **a trade**: gives up verbatim context to buy a summary | **purely additive**: removes nothing |
| **Fact recall (mean)** | 0.313 | 0.667 | **0.948** |
| — early probes | 0.325 | 0.854 | 0.938 |
| — late probes | 0.300 | **0.479** | **0.958** |
| **Decay with distance** | flat at floor (nothing left to lose) | **collapses**, −0.375 | **none**, +0.020 |
| Consistency (sd) | 0.348 | 0.094 | **0.083** |
| vs bare | — | +0.354, p=0.0432 | **+0.635, p=0.0043** |
| **Tool-call precision** | 0.241 | 0.281 | **0.485** |
| **Blank bubbles** | 0 | 0 | 0 |
| **Context cost** | baseline | — | **−170 prompt tokens/turn** vs bare; digest capped ~140 tokens, flat from turn 10 |
| **Ranking cost on device** | none | ~0.07 ms/doc | ~0.07 ms/doc (1 ms at 44 docs → 25 ms at 363) |
| **Memory subsystem** | never enabled in any campaign | never enabled | never enabled |
| **Tool repair tiers** | n/a — the 2B emits 19/20 structured calls, 0 invalid names, 0 unparsed args | n/a | n/a — nothing to repair |

**Why `v42` costs what it costs**: half of its rationale is a rolling LLM summary that **is never
built** — `summaryChars = 0` on every arm of every campaign, because the scheduler condition
(`turnsSinceRebuild !== K-1`) is unreachable whenever the boundary advances on size. It pays the
verbatim context and collects only the digest, which is why its late-probe recall collapses while
`ciswire`'s does not.

**Why `ciswire` wins**: it removes nothing and can only add, so structurally it cannot recall less
than bare — the statistics only quantify how much more. And the additive design is why it is
*cheaper*: with the fact in hand the model answers instead of hedging, replies shrink 675 → 505
chars, and the saved window space exceeds the digest's cost.

**The coupling nobody planned for**: `ciswire` nearly doubles tool precision (0.485 vs 0.241).
Holding the context stops the model reaching for a tool to find what it already has — the mirror
of §1.2, where losing context caused tool misuse. Improving context buys two axes at once.

### 1.5 What `ciswire` costs in context — bounded, and net NEGATIVE

The question that decides whether this is affordable on a phone: how much of the context window
does the digest eat, and does it grow as the conversation goes on?

Measured per turn on the 2B campaign (window 16, 6 seeds, mean across arms):

| turn | digest chars | prompt tokens, bare | prompt tokens, ciswire | delta |
|---|---|---|---|---|
| 1–9 | 0 | 1496 → 2897 | 1496 → 2613 | −0 … −284 |
| 10 | 96 | 2975 | 2819 | −156 |
| 11 | 525 | 3090 | 3117 | +27 |
| 12 | 560 | 3362 | 3197 | −165 |
| 13 | 639 | 3311 | 3144 | −168 |
| 14 | 563 | 3359 | 3192 | −167 |
| 15 | 546 | 3323 | 3151 | −173 |
| 16 | 551 | 3234 | 3154 | −80 |

**The injected text is bounded and flat.** Zero until the corpus exists (turn 10), then it
settles at 525–639 chars ≈ 140 tokens and stays there — `digestBudgetChars` caps it at 900, and
`DEFAULT_DIGEST_TOP_N` × snippet length keeps it well under. **It does not grow with turns.**

**And the net effect on the prompt is negative — ciswire uses FEWER tokens than bare**, about
−170 from turn 12 on. The mechanism is measured, not guessed: mean reply length is **505 chars
for ciswire vs 675 for bare** (−25%; v42 656). A model that *has* the fact answers it; a model
that does not hedges around it. Ten shorter assistant messages inside the 20-message window
save roughly 420 tokens, against ~140 spent on the digest.

Shorter would be a bad sign on its own — but paired with recall 0.958 vs 0.563 it is not
terseness, it is precision.

**What DOES grow is the ranking cost, not the payload**: the corpus goes from 44 to 363
documents across a conversation, and ranking time with it (1 ms → 25 ms on Hermes, ≈0.07
ms/doc). Bounded by `MAX_DIGEST_CORPUS_MESSAGES`. So the phone pays a few milliseconds more per
turn as the conversation grows, and pays nothing extra in context.

### 1.5b Retrieval is affordable on a phone

Measured on-device (Hermes, CI emulator), from `KALSA_DIGEST`:

| corpus (docs) | ranking time |
|---|---|
| 74 | 7 ms |
| 128 | 9 ms |
| 156 | 6 ms |
| 363 | 25 ms |

≈ **0.07 ms per document**, about **9× slower than the same code on a laptop (V8)** — that
factor is the useful calibration for future estimates. Corpus is bounded by
`MAX_DIGEST_CORPUS_MESSAGES`.

### 1.6 The free hybrid n-gram leg is redundant — do not ship it for retrieval quality

Kalsa's BM25 is **already character 3/4-gram based** (`retriever.ts` `ngramCounts` emits char
3-grams and 4-grams; `bm25plus` scores over those). Porting CisWire's hashed 3-gram cosine leg
therefore duplicates the existing ranker: the best case anyone could construct is a rank 2 → 1
promotion on an inflected form, never a recovery. It is committed behind
`kalsa.bench.ranking=hybrid`, **off by default**, as a lexical leg for a future dense fusion.

Consequence for the 132 MB e5-small option: it must buy **synonymy**, not robustness to
inflection or typos. That is the only thing left for it to buy.

### 1.7 REVERSED 2026-08-18 — LFM2.5-8B-A1B is the model Kalsa ships, and it is ~2x FASTER per turn than the dense 4B

**This section used to end "do not ship it". That verdict is withdrawn**, on two grounds: Marco
states LFM2.5-8B-A1B is the shipping model (a product decision, not a benchmark's to make), and
the measurement it rested on does not survive contact with the 4B campaign.

**Smoke `32097043246`** (8 arms, CI emulator, same harness as the 4B campaign the day before):

| | LFM2.5-8B-A1B (smoke) | Qwen3.5-4B (campaign `32048465417`) |
|---|---|---|
| mean prefill / turn | **189–311 s** | 424–685 s |
| mean whole turn | **223–361 s** | ~541 s |
| per-turn cap (2400 s) | never approached | **killed 2 arms** |

**The dense 4B is not the better trade — it is the slower one.** The old recommendation
("for more capability than the 2B, the dense 4B is the better trade") was drawn from a single
first turn of a failing smoke, against no comparable number for the 4B. There is one now.

**`arms died after 56–60 minutes having completed a single turn` does not reproduce.** Eight of
eight arms ran clean: no `errorTurns`, no `captureFailedTurns`, no `contextFullTurns`. Whatever
killed those early arms was one of the three infrastructure defects listed at the end of this
section, not the model.

**And the §3.6 parser fix is now proven end-to-end**, which unit tests could not do:
`emittedAnyToolCall` and `firstTryValid` are **true on all eight arms**. LFM2.5 emits Python-style
calls, the parser reads them, the harness sees the calls. Two arms did show blank replies
(`ciswire_off` turn 2, `off_on` turn 7) — §3.1's open issue, on this family too.

**What survives from the original finding, unchanged and still true:** the MoE discount is a
decode-time property, not a prefill one — prefill batches hundreds of tokens which route across
all experts, so it activates the full 8B. That remains the reason `n_ctx` matters more here than
on a dense model, and the reason a small window plus CisWire's digest is the interesting
combination rather than a large window.

Campaign `32103054225` (fase4, 10 seeds) is running to give this model the same graded treatment
the 2B and 4B got.

#### Original measurement, kept as the record



Measured on the CI emulator (x86_64, swiftshader, no GPU), first turn of a smoke run:

```
tokensEvaluated  1394     promptMs      174851      ~175 s of prefill
tokensPredicted    97     predictedMs    30332
predictedPerSecond 3.20
```

**Decode is fine** — 3.2 tok/s, comparable to the 2B's 2.45. The MoE promise holds there: ~1B
active parameters, 1B-class generation speed. **Prefill is not**: 175 s for 1394 tokens, ~8
tok/s. Arms died after 56–60 minutes having completed a single turn.

The reason is architectural, not a defect. MoE saves compute when decoding one token (one token,
one expert set). Prefill processes ~1400 tokens at once, they route to different experts, and the
batch effectively activates the whole 8B. **You get 8B knowledge at 1B decode speed and pay 8B
prefill cost** — and in a long conversation prefill is what dominates.

It does **load**: 5.2 GB resident on an 8 GB emulator, 6.5 GB still available at the fatal
moment, no OOM, empty crash buffer. So the memory question — the one that motivated trying it —
answers positively, and is not the reason to decline it.

Caveat: emulator without GPU, so the absolute numbers would improve a lot on a real phone. The
*ratio* (prefill expensive, decode cheap) is a property of the architecture and would not.

For more capability than the 2B, the dense 4B is the better trade on a phone — which is already
what `recommendedModelId` gives the high-RAM tier.

Getting to this answer took three attempts and three unrelated infrastructure defects (a
revision copied from the sibling repo, a two-copy sideload needing 10.4 GB on an 8 GB disk, and
a sideload that never verified it had worked). It was only diagnosable because the fatal-path
capture added the same day worked on its first real failure — before it, the artifact was a
screenshot of the Android home screen.

---

## 2. What to tell whoever develops Kalsa

**Not** "replace Kalsa with CisWire". Kalsa imports **zero** lines of CisWire code — verified.
The mode named `ciswire` is Kalsa's own code implementing a CisWire-*inspired* strategy (full
window + additive digest) with Kalsa's own BM25. What won is a strategy already in the repo.

### Shipped defects worth acting on regardless of any benchmark

1. **The tool gate blocked ~100% of the searches users explicitly asked for** (§1.1). Measured:
   the turn where the user says *"cerca sul web…"* succeeded 0/6 with the gate on and 6/6 with it
   off, on every gated arm. The rule compared the query to the user's message and blocked on
   *high* similarity — but a good query paraphrases the question, so it scored high and died,
   while a spurious one was about something else and survived. Inverted in `5b3ba90`.
2. **LFM2.5 tool calls were never parsed, on the whole family** (§3.6). The parser `JSON.parse`d
   a payload the model does not emit — both LFM2.5 templates produce Python-style
   `[func(arg="v")]`. Every call was silently dropped: no error, no log. Fixed in `c93d163`.
   Never caught because LFM had never been benchmarked, and the comment stating the wrong
   dialect is why nobody looked.
3. **Blank assistant bubbles** (§3.10) were tool rounds running out with no answer produced —
   100% of blank turns hit the 3-round cap against 5% of normal ones. Driven by (1); the
   fallback in `a4343c7` fixes the blank itself, which would otherwise recur with any model or
   an unreachable network.
4. **`windowCharBudget` is not derived from the engine window.** 16 000 chars ≈ 4k tokens is a
   constant, while `effectiveNCtx` can be clamped to 2048 on low-RAM devices. Nothing bounds the
   assembled prompt by `n_ctx`; `assembleEngineHistory` caps message *count* and per-message
   *chars* only. On overflow, text-only chats rely on `ctx_shift: true` (llama.cpp evicts
   silently, app unaware) and multimodal chats have `ctx_shift: false` with no fallback.
   **`n_keep` is never set anywhere**, so we do not control what survives a shift. Not verified:
   llama.rn's exact ctx_shift/n_keep semantics — read `node_modules/llama.rn/cpp/` before acting.

### Product decisions the data supports

5. **`ciswire` is the default on the 2B path — DECIDED 2026-08-15.** The confirming campaign
   (`31861056717`) landed: **+0.635 over bare, p = 0.0043**, sd 0.083 against bare's 0.348, no
   decay with distance (0.938 early → 0.958 late), and it costs *fewer* prompt tokens than bare
   (§1.5). The §3.1 blocker is closed: zero blank bubbles in 96 turns. The pre-fix figure quoted
   here before (+0.396, p=0.0249) was measured through the inverted gate — do not quote it.
6. **`v42` hurts small models specifically.** On the 2B it equals bare (−0.037, p=0.60) while
   ciswire beats it by +0.433 (p=0.0043). On the 4B the two are **indistinguishable**. So this is
   "retire it for the 2B", not "retire it" — and the reason is that its rolling summary, half of
   its rationale, **never runs** (`summaryChars = 0` on every arm of every campaign).
7. **WITHDRAWN 2026-08-18 — "do not ship LFM2.5-8B-A1B"** (§1.7): it is the shipping model, and it
   is ~2x faster per turn than the dense 4B this recommendation preferred. Original text: it loads fine — memory was never
   the problem — but MoE discounts decode, not prefill: 175 s for 1394 tokens. For more than the
   2B, the dense 4B is the better trade, which is already what `recommendedModelId` gives the
   high-RAM tier. **The one thing that could reopen it** is the physical-device track (§6): that
   175 s is swiftshader with no GPU, and the *absolute* prefill cost is the whole verdict. The
   *ratio* (prefill expensive, decode cheap) is architectural and will not move.
8. **Do not fine-tune for tool calls yet — DECIDED 2026-08-15.** The 2B already emits near-perfect calls (19/20
   structured, 0 invalid names, 0 unparsed arguments) — there is no headroom in *format*. Every
   precision number available before today was measured through the inverted gate and is void.
   The `tools` phase (`e907809`) separates the three failure modes; only *selection* is the kind
   a fine-tune fixes better than a rule. Measure, then decide.

### Measurement caveats anyone quoting these numbers must carry

- One model per result, one language, 16-turn conversations, CI emulator.
- The effect is only visible in a regime that had to be engineered (`legacywindow=16`); at the
  shipped window of 20 the baseline lost facts in 2 conversations out of 6.
- The 4B result is directionally larger (+0.469) but **not significant** (p=0.139) because arm
  crashes and honest-refusal exclusions cut n to 3.
- `honesty` is graded by an Italian wordlist (§3.9) and means nothing in another language.

---

## 3. Open — do not claim these are settled

### 3.1 Treated arms produce more empty replies (blocker for making `ciswire` default)

Blank assistant bubbles per campaign: `ciswire` 6, `v42` 8, bare 3, `nogate` 4. Roughly double
on the treated arms, in both campaigns. An assistant that recalls facts but shows a blank bubble
~1 turn in 12 is not obviously better for a user. **Cause unknown. Close this before changing
any default.**

### 3.2 Generalisation beyond one model

Everything above is Qwen3.5-2B — which is the **low-RAM fallback**, not the shipped default
(`recommendedModelId`: high RAM → `qwen3.5-4b`). Campaign `31807501488` runs the 4B in the same
graded regime; LFM2.5-2.6B is next. Prediction on record: **the effect should shrink on the 4B**
— a stronger model holds more context and needs the crutch less. If it shrinks a lot, the
conclusion becomes "the harness rescues small models", which is still valuable but changes the
default recommendation.

Risk on record: a 2B arm took **143 min median** against a 300-min cap; the 4B may hit it.

### 3.3 Memory: measurable at last, and it extracts nothing — the benchmark is the wrong shape

Smoke `31885329570` (2B, window 16, `memory=1`) ran 8 arms green. Six had memory enabled:

| arms with memory on | 6 |
|---|---|
| **facts extracted, total** | **0** |
| facts stored | 0 |
| facts injected | 0 |

Zero across every context mode — `baseline`, `ciswire`, `v42`, `nogate` — so it is not
mode-dependent. The memory-off arms are correctly zero, so the negative control holds and the
NOT-RUN verdict (§3.7) no longer false-fires.

Cost, measured: `off_on` took **83 min against 59** for its memory-off twin. The extraction
completion runs every turn, adds ~40% wall clock, and stores nothing. It is the first cost in
this project paid on *every* turn regardless of benefit — the digest costs 25 ms of ranking and
*saves* 170 prompt tokens; memory costs a whole inference.

**CORRECTION (later the same day): the explanation below was wrong, twice over.** A second smoke
(`31891272873`) planted explicit user facts — *"Mi chiamo Teodoro lavoro come orologiaio e mi
piace il cibo piccante"* — and changed nothing: still zero extracted on every memory-enabled arm.
And the new `extractParseOutcome` field reads **0 = did not run**, not 1 = ran and returned empty,
which is what the prompt-mismatch story predicted.

**And the deeper problem: these counters cannot currently prove anything.** The extract job is
fire-and-forget (`AppShell.tsx:3487`) and runs a **full LLM completion** (`n_predict: 256`, tens
of seconds on a 2B), while the telemetry line is emitted at turn end (`:4018`) and
`getAndResetMemoryTelemetry()` **resets** the accumulator. The snapshot almost certainly happens
before the extraction finishes, and the reset discards the outcome rather than letting it surface
on the next turn. So the subsystem may be working and invisible. Measuring at an instant when the
work has not happened yet, and concluding it never happens, is the same error as reading
`nogate`'s 0.000 recall as "the gate protects recall" (§1.1). Fix dispatched: make the
measurement match the work, without logging the extraction output, which is user data.

**Superseded hypothesis, kept so nobody re-derives it:** `strings.memory.extractPrompt` (`src/i18n/it.ts:800`) asks for
facts *about the USER* — "nome, preferenze, interessi, lavoro, lingua" — and says explicitly
"I fatti devono riguardare l'utente, non le tue risposte". The fase4 conversation plants
arbitrary tokens: *"il gatto si chiama Leopoldo il budget e 4500 euro … il codice e PK42"*. A
model following that prompt correctly answers `{"add": [], "remove": []}`.

So the extractor is probably working and the benchmark is the wrong shape for it. **Not yet
verified**: nothing distinguishes "the model returned empty arrays" from "the model returned
something the parser rejected", because the extraction output contains user facts by definition
and must not be logged. A numeric parse-outcome field is being added to separate the two without
recording text.

**The 24-arm campaign was not launched.** With an empty store, memory-on and memory-off arms are
the same experiment run twice at 40% extra cost — the empty-digest disaster with a different
name. The smoke cost 83 minutes and prevented it; that is what the smoke is for.

### 3.3b The settled telemetry measured nothing either — and the fault was the instrument, three times

Smoke `31910747849` (2026-08-15, 2B, window 16) is the first run carrying `bf3794d`'s settled
line. Result: **`memoryExtractTelemetry` empty on every arm, every turn** — zero
`KALSA_MEMORY_EXTRACT` lines in 8 arms. The turn-end `KALSA_MEMORY` line, captured from the same
logcat buffer by the same mechanism, was populated throughout, so the capture is not the
suspect: the app never emitted the line.

Reading the code found three separate reasons the instrument could not see, none of them a
defect of the memory subsystem itself:

1. **"Ran and threw" was indistinguishable from "never ran."** `extractionRan` was set only
   *after* `await extractMemory(...)` resolved (`AppShell.tsx:3502`), the `catch` swallowed
   everything (`:3523`), and the emit was guarded on that flag (`:3529`). An extraction that
   started and failed produced the identical artifact to one that never started — precisely the
   distinction §3.3 needs. Fixed: attempt semantics, plus a numeric outcome for the throw.
2. **The line was suppressed exactly in the case it existed to capture.** The emit also required
   `!signal.aborted`, so a late-finishing extraction — the reason the settled line was added —
   was dropped. Fixed: counters-only lines are emitted regardless of abort.
3. **The codes were meaningless on the line that carries them.** The turn-end line resets and
   emits *before* the extract job is armed (`:4051-4056`), so `extractParseOutcome`,
   `extractGateSource` and `extractStopReason` were structurally always 0 there — reading as
   "did not run" even on turns where extraction ran; and on the settled line `memoryEnabled` was
   always 0 because the reset had already cleared it, so that line could not tell "memory off"
   from "memory on, nothing extracted". Fixed: the settled line re-tracks what the reset cleared
   and is now authoritative; the turn-end line reports not-applicable fields with a sentinel
   instead of a misleading zero; the bench consumers read the codes from the settled line.

**Nothing is yet known about whether extraction works.** Every measurement so far has measured
the measurement. The next smoke is the first one whose zero — if it is a zero — will mean
something, because the line now always arrives and carries a reason code.

**Standing lesson, stated plainly because this is the third round on the same subsystem in two
days**: an instrument that can only report success is not an instrument. Each of the three
defects above shipped with a green harness and a plausible commit message.

### 3.5 FIXED 2026-08-14 — the memory guard was breaking web search; replaced with containment

The same `ECHO_SIMILARITY_THRESHOLD = 0.18` governs `echo-of-memory-fact`, which compares the
query against the injected memory facts. Measured with three plausible stored facts:

| query | max similarity to a fact | outcome |
|---|---|---|
| the fact, verbatim | 1.000 | blocked — correct |
| "allergia alle arachidi cosa fare" | 0.598 | blocked — correct |
| "meteo Torino domani" | 0.283 | **blocked — false positive** |
| "ricetta pasta al forno" | 0.182 | **blocked — false positive** |
| "quantum chromodynamics lattice" (English) | 0.113 | passes |

Any two Italian sentences share enough character trigrams (" di ", "la ", "co ") to clear 0.18.
Only a different language falls below it. **Turning memory on would block essentially every web
search an Italian user makes.** The privacy direction holds (facts do not leak); the usability
direction fails completely.

This is the debt recorded weeks ago — "0.18 has 0.0146 of margin, and an Italian-only benchmark
will never exercise it" — now demonstrated with numbers. **Fixed in `8226817`.** `echo-of-memory-fact` now uses containment
(`src/rules/entityContainment.ts`): block on a distinctive token from a fact (digit, `@`, or
leading uppercase) or on two consecutive content tokens. 12/12 acceptance cases verified
independently — the six MUST-BLOCK still block, the six MUST-PASS now pass.

**Residual risk, accepted knowingly**: a single common token (`arachidi`) or a synonym
(`allergia alle noccioline`) passes. That is *topic* exposure, not *identity* exposure — neither
carries the user's name or an identifier — and no containment rule can catch synonymy. The old
rule blocked those only because it blocked everything.

`echo-of-context` is deliberately UNCHANGED and still has the defect described in §1.1: it
blocks legitimate searches. That is a separate decision, to be made from campaign data — fixing
both at once would make the next campaign uninterpretable.

### 3.6 FIXED — LFM2.5 tool calls never parsed; the parser spoke a dialect the family does not emit

`src/engine/toolCallParser.ts:70` documents the LFM dialect as
`<|tool_call_start|>[{"name":...,"arguments":{...}}]<|tool_call_end|>` and `parseLfmToolCalls`
does `JSON.parse` on the payload. **LFM2.5 does not emit that.** Both `LFM2.5-2.6B` and
`LFM2.5-8B-A1B` ship a chat template whose macro builds
`func_name + "(" + args + ")"`, i.e. Python-style calls:
`<|tool_call_start|>[web_search(query="capitale del Madagascar")]<|tool_call_end|>`.

Measured against the compiled parser:

```
real LFM2.5 format       -> []                          every call silently dropped
the format kalsa assumes -> [{"name":"web_search",...}]
```

`JSON.parse` throws, the `catch` returns `[]`, the caller reads "no tool calls". No error, no
log. Never caught because LFM has never been benchmarked — and the comment stating the wrong
dialect is why nobody looked.

**FIXED and verified on disk 2026-08-18.** `parseLfmToolCalls` now tries the Python-call form
first and keeps the JSON array as a fallback for finetunes that emit it. The ordering is
deliberate and documented at the function: once the payload is recognised as Python-call-shaped, a
parse failure yields `[]` rather than falling through to `JSON.parse`, which would also yield `[]`
but for the wrong reason and hide the bug again. Green: 23 jest cases plus `toolCallParseHarness`
F6f–F6i, including "garbage payload → [] (never throws, never partial)" and "Qwen dialect
unaffected". **Still unproven end-to-end**: no LFM campaign has ever run, so the parser is right
in unit tests and untested against what the model actually emits under load. Smoke `32096631132`
is the first attempt.

### 3.4 Spurious tool calls survive the gate

17 spurious calls still get through with the gate on. The gate more than doubles precision but
does not finish the job.

---

### 3.8 The primary metric scores "I don't know" the same as "I got it wrong"

`fact_recall_*` grades found/not-found. A reply that correctly reports the facts are
unavailable scores identically to one that invents them. Real Qwen3.5-4B baseline reply on
`probe_facts_late`, scored 0.000:

> *"Non posso ripetere i dati dei tuoi primi messaggi perché non ho memoria delle conversazioni
> precedenti una volta che la sessione si è riavviata."*

The facts genuinely were outside its window. The model is right and is punished for it.
Counted across finished arms: **4B baseline 5 of 8 probe turns are explicit refusals; 2B
baseline 6 of 12**. The stronger model refuses more, so it scores lower — 4B baseline 0.362 vs
2B baseline 0.563.

Consequences, in order:

1. **It does NOT invalidate ciswire vs bare.** Retrieval genuinely supplies facts the window
   lost; that comparison measures something real. What it invalidates is reading a low bare
   score as *unreliability*. Bare is honest about its limit; ciswire removes the limit. That is
   a capability difference, not a correctness one — and §1.3 was written as if it were the
   latter.
2. **Cross-model comparison of the baseline is unsafe.** A model that confabulates more looks
   better. "4B bare 0.362 vs 2B bare 0.563" does not mean the 4B remembers worse.
3. **It contaminates any fine-tuning decision.** If a fine-tune shifts how readily the model
   declines, this metric moves for the wrong reason and the change gets miscredited.

Fix in flight: three outcomes per probe — recovered / asserted-but-wrong / **declined** — with
declined excluded from the denominator like blank replies already are, and reported per arm so
an arm that declines everything is readable as such. Detection must be wordlist-free: the
signal is whether the reply asserts any fact-shaped token at all (the distinctive-token
primitive from `entityContainment.ts`, already verified across four languages), not how it is
phrased.

Open question flagged with it: the `honesty` family may be rewarding the very reply
`fact_recall` punishes — the same turn scored good by one family and bad by another.

### 3.9 The `honesty` grader only works in Italian

`HONESTY_PATTERNS` (`scripts/benchGraders.mjs:34-48`) is a hardcoded list of Italian regexes —
`non ho (informazioni|dati|notizie)`, `non lo so`, `non conosco`, `non risulta`… A model that
admits ignorance in English, German or Japanese scores as dishonest. This is the same
worldwide-app defect that got two rule fixes reverted today, sitting in the measurement layer
instead of the product.

It does not corrupt the campaigns run so far — every bench conversation is Italian by
construction (`ci-bench.sh` forces locale `it`). It becomes wrong the moment anyone benchmarks
another language, and it silently caps what the honesty axis can ever tell us.

Note also that `honesty` and `fact_recall` grade **different turns** (`probe_honesty` vs
`probe_facts_*`), so the two families cannot contradict each other on the same reply — an
earlier worry of mine that turned out to be wrong.

## 3.7 Process failures the audit caught (fixed) — and one still open

- **Three suites were not gated by CI.** No workflow ran jest, and `bench.yml` omitted
  `rulesCoreHarness`, `toolCallParseHarness` and `memoryTelemetryHarness`. The privacy guard's
  acceptance cases, the LFM tool-dialect fixtures and the memory telemetry contract were all
  manual-only — true when run, unprotected afterwards. Fixed in `5e422fc`.
- **`memoryTelemetryHarness` could not fail**: it re-implemented the functions it claimed to
  test. Now imports the real modules; verified by mutating the real formatter to emit a fact
  string (goes red). An interface-only mutation does not count — it changes no runtime
  behaviour.
- **The NOT-RUN verdict did the opposite of its job**: telemetry was emitted unconditionally, so
  every memory-OFF arm looked like "memory on, store empty" and fed the INCOMPLETE gate. The
  next primary campaign would have failed its own gate. Fixed in `da70755`.
- **Facts survived across arms** — `reset_chat` never deleted `kalsa.memory.facts`. Fixed.
- **The `tools` phase could never have run — four defects on one path, none of them measured
  because nobody had dispatched it once** (found and fixed 2026-08-15, `6516b3e`). It was
  offered as a dispatch option, had a complete 14-turn plan and working graders, and was cited
  in this document as "built, never executed". It would have died in seconds:
  1. `ci-bench.sh`'s phase guard accepted `fase4|smoke|mem` and sent `tools` to
     `die "unknown PHASE"`. The gate now derives both lists from the real files
     (`matrixParityHarness.mjs`) and fails if either parses empty.
  2. Its prompts were **the only non-ASCII lines in any turn plan** (`Qual è …`), against the
     contract at `ci-bench.sh:655` — `input text` mangles punctuation and the landing gate is
     `grep -qF "$msg"`, so the arm would have died at turn 3 after ~30 min of runner time.
     Every other plan de-accents.
  3. The tool graders never consulted `empty`, while every sibling family nulls out on a blank
     reply: a blank bubble scored as a **correct abstention** on `tool_forbidden`. An app defect
     credited to the model — the §3.8 error in a different family.
  4. A single gated arm cannot separate the model from the rule it is being measured through, so
     the phase now runs a `baseline`/`nogate` pair.
- **The job timeout was deciding the sample size, not the model.** In `31807501488` (4B, 6
  seeds) two arms were cancelled at exactly 300 min by `timeout-minutes: 300` and three more
  finished at 285–298. Raised to 350 (GitHub's hard ceiling is 360). Any 4B arm count quoted
  from that campaign is a count of *survivors*, not of runs.
- **STILL OPEN — identity leaks past the containment guard.** A fact that *starts* with the
  user's name never contributes it, so `Mario Rossi abita in Via Roma 12` + `dove abita Mario?`
  passes. Inert today (memory is off), blocking before memory ships. The first fix attempt was
  rejected: it added an Italian/English function-word list, and measured on the built rule a
  German user's `der beste film 2024` and a Spanish user's `el mejor libro del año` were
  BLOCKED — the same defect, reintroduced for every other language. **No wordlist. The app ships
  worldwide.**

## 3.10 Blank assistant bubbles: same root cause as the gate — and three vacuous harnesses

**The blocker on making `ciswire` default is resolved diagnostically.** Blank bubbles were never
a retrieval defect. Campaign `31760516762`, 384 turns:

| turns | hit the 3-round tool cap |
|---|---|
| **blank (21)** | **21 — 100%** |
| normal (363) | 17 — 5% |

Every blank turn generated 88–177 tokens and rendered `reply_len = 0`: the model spent all three
tool rounds and never produced an answer. The frequency driver was the inverted
`echo-of-context` gate blocking ~100% of searches — call, blocked, call, blocked, call, cap. Fixed
in `5b3ba90`, so the rate should fall on its own; that is a prediction the next 2B campaign will
confirm or refute. The blank bubble itself is a separate defect and was fixed independently: a
two-tier fallback, because a future model or an unreachable network would reproduce it whatever
the gate does.

**Method note that cost the most time today.** Three harnesses were delivered that could not
fail, each reported as verified:

- `memoryTelemetryHarness` re-implemented the functions it tested;
- a lexical-miss assertion used a 4-document corpus with `topN 4` (every document returned
  regardless of ranking) plus a both-agree escape branch;
- `toolRoundExhaustedHarness` re-implemented the fallback decision — the real block was replaced
  with `if (false)` and it still reported 19/19 passed.

The pattern is not laziness: it appears exactly where the real code is hard to reach (a module
needing llama.rn and a loaded model). The fix is not a copy but **extracting the pure decision
into its own module** so the harness can exercise the shipped code — done here as
`src/engine/toolRoundFallback.ts`. Verified by mutating the real module: red, then green on
restore.

Standing rule from this: a spec asks for a mutation test **on the real module**, with the failing
output pasted. "Write a test" and "write a test that can fail" are different requests.

## 3.11 The privacy gate looked like it inspected a different fact set — CLOSED, not a live hole

Raised by hostile audit 2026-08-16 from two slices that disagree on their face:

- the prompt takes the **last** ten facts — `.slice(-10)`;
- `webSearchTool.ts:88` passes `memoryFacts: facts.slice(0, 10)` — the **first** ten — to the check
  that decides what may leave the device.

**Traced on disk 2026-08-17: the two sides see the same facts, and the gate is sound.** The list the
gate receives is already capped upstream, so `slice(0, 10)` is the identity on it:

- `AppShell.tsx:2348` — `setMemoryFacts(facts.map((f) => f.text).slice(-10))`, so the state is ≤ 10;
- `AppShell.tsx:2332` — `memoryFactsRef.current = memoryFacts`, the ref mirrors that state;
- `AppShell.tsx:4480` — `promptFacts = memoryEnabledRef.current ? memoryFactsRef.current : []`;
- `AppShell.tsx:4724` passes **that array** to the engine and `:4485` assigns **the same array** to
  `injectedFactsRef`, which is all `getMemoryFacts` (`:1825`) ever returns.

One array reaches both the prompt and the gate. The env-hash sites (`:3104`, `:3589`) use the same
`slice(-10)`, so they agree too.

**Reopen if the cap moves.** The comment at `AppShell.tsx:4483` promises the guard uses "exactly the
facts injected this turn"; that is true only because of the cap at `:2348`. Raise it, or feed
`getMemoryFacts` from `MemoryStore.listFacts()` directly, and `slice(0, 10)` silently starts
inspecting a different subset with nothing failing. A test that constructs eleven facts and asserts
both sides agree would pin it; absent that, this paragraph is the pin.

### 3.12 The thinking A/B cannot answer the thinking question — `fase0` carries two probes and both hit the floor

**Campaign `32139648432`** (LFM2.5-8B-A1B, `fase0`, 3 block formats × `off`/`budget256`). It ran
green and measured **nothing usable**.

`fase0` grades exactly **two** fact probes, both for the same fact, at turns 7 and 14:

| arm | probe t7 | probe t14 | recall |
|---|---|---|---|
| `none_budget256` | declined | declined | **null** |
| `none_off` | declined | not found | 0 |
| `user-note_*`, `user-prefix_*` | not found | not found | 0 |

**All six arms at the floor.** With two probes of one fact, and a model that misses them in every
configuration, `off` and `budget256` cannot separate — the metric has no resolution left to detect
a difference with. Declines make it worse: the decline-aware rule excludes them, and excluding both
leaves `total: 0` and `rate: null`.

**Do not read this as "thinking does not matter".** It is the §3.10 failure again — a vacuous
harness producing zeros that look like findings. The only signal the run carries is cost, at n=1
per cell: thinking ON adds **+8 to +113 s per turn** depending on block format. Zero blank bubbles
and zero spurious calls across all six.

**What would answer it**: `fase4`, which carries the probe density that separated four arms at
p=0.03 twice this week — but its matrix hardcodes `thinking=off` for every arm, so the question
needs a `thinking` dimension there, not a bigger `fase0`.

## 4. Refuted — do not re-derive these

- **"`n_ctx` drives compaction."** False. `shouldRebuild` fires on a K-turn cadence and on
  `windowCharBudget`, and never reads `n_ctx`. Shrinking `n_ctx` only makes llama.cpp truncate.
- **"`windowCharBudget` is the lever for the primary arm."** False for `ciswire`: its corpus is
  `legacyWindowStartIndex(...)` and its history is the legacy window, so the boundary that
  budget moves reaches nothing the model sees. It only affects `v42`.
- **"The benchmark never compacted."** Too strong. The K-turn cadence fired ~5× per
  conversation; what never happened was engine-level context pressure (peak 4968 prompt tokens
  against a 16384 window = 30% fill).
- **"CisWire loses on honesty."** False — that was a broken grader, in both directions.
- **"The APK was built without the native patches."** False — the patch applied every time; the
  proof marker was in a binary the assert never inspected.
- **"n_ctx = 4096 puts the bench in the phone regime."** False, see above. The lever that
  reproduces phone-like eviction for `off` and `ciswire` is `LEGACY_MAX_HISTORY`
  (`kalsa.bench.legacywindow`).

---

## 5. Method notes that earned their place

- **A label is not evidence.** Positive controls demand direct proof of mechanism
  (`digestCharsByTurn > 0`, observed `toolGateActive`), never the arm name. Three campaigns were
  spent measuring a retrieval system whose digest was empty.
- **Prompt-token divergence is not a mechanism signal** — arms diverge from generation noise
  alone. Removed from the verdict.
- **Every new assertion must be seen failing.** One test in this repo was structurally vacuous
  (4-document corpus with topN 4, plus a both-agree escape branch) and another harness ran green
  for a day against a stale compiled build.
- **Run the whole offline harness suite from a wiped build dir**, not jest alone, and not a
  subset.

---

## 6. The physical-device track — opened 2026-08-15

Every number in this document was measured on a CI emulator with no GPU, at 2.45 tok/s, inside
a job GitHub kills at 6 h. That ceiling is what blocks the regime a phone actually lives in:
16-turn conversations are what fits, not what is representative. A **Galaxy S23** (SM-S911U,
Android 16, arm64, 7.2 GB usable RAM) is now attached for a multi-day campaign.

**What it buys, with numbers rather than hope.** The sibling repo `kalsa-moe-experiments` has
207 logged runs on this exact handset (`results/runs.csv`, `reports/moe-litert-product-classes.md`):
**Qwen3.5-2B Q4 tg256 = 18.10 tok/s, 4B = 8.38 tok/s**, CPU, unplugged. Against the emulator's
2.45 tok/s for the 2B that is ~7×, so a turn falls from ~9 min to ~1.5–2 min and a **40-turn
conversation costs 60–80 min per arm** — feasible, and with no 6 h cap above it.

*Correction on record*: an earlier estimate of mine in this session said a turn would drop "to
seconds" on real silicon. That was wrong by an order of magnitude; the measured factor is ~7×,
not ~100×. The instrument that corrected me was the sibling repo's own CSV.

**What it costs — four things, all verified on the device rather than assumed:**

1. **`run-as` needs a debuggable build, and today's device APK is a release build.** `apk.yml`
   builds `assembleRelease`, so `android:debuggable=false`, and on a user build with no root
   `run-as` is refused — the harness cannot reach the app at all.

   **Correction, recorded because I published the wrong version of this first**: I also claimed
   that APK might be running an *unpatched* engine, because `apk.yml` never sets
   `KALSA_LLAMA_FROM_SOURCE: "1"` the way `bench.yml` does. That is false, and the hostile audit
   caught it. `plugins/withLlamaFromSource.js:34` is **opt-out only** — `=0` restores the
   prebuilt jniLibs, everything else (including unset) builds from source. The env in `bench.yml`
   is decorative and its comment there is inverted too. What `apk.yml` genuinely lacked is the
   *verification*: it never ran `scripts/assert-native-patch.sh`, so nothing proved the marker
   was in the binary. A missing check is not the same finding as a broken build, and quoting the
   first would have sent someone hunting a bug that does not exist.
2. **The harness assumes a root-capable shell.** `ci-lib.sh:19` is
   `sql() { adb shell "sqlite3 $DB \"$1\"" ...}` against `/data/data/$PKG/databases/RKStorage`,
   and the model sideload writes into `/data/data/$PKG/files/models` and `chown`s it. Verified
   on the device: **no `sqlite3` binary and no `su`** (`ro.build.type=user`). Both paths have to
   go through `run-as` (or the app's own downloader for the model).
3. **Measurement discipline is inherited, not invented.** From `kalsa-moe-experiments`
   (`scripts/run_staccato.sh`): unplugged hard-gate per cell, die-temperature gates
   `DIE_STOP_MC=98000` / `DIE_START_MC=80000`, `BATT_STOP=30`, flight recorder mandatory, one
   CSV row per run. USB is for setup only — measuring while charging is explicitly forbidden
   there, so the campaign runs over adb-on-Wi-Fi (`192.168.1.152:5555`) and is cyclic:
   measure 100 % → 30 %, charge without measuring, resume.
4. **A single device serialises what CI parallelised**, so time-of-day and thermal drift become
   confounds the matrix never had. Mitigation to build into the driver: interleave arms rather
   than running an arm's seeds back to back, randomise seed order, and log battery temperature
   per turn — the sibling repo's CSV already carries `batt_temp_start/end` for this reason.

**Storage**: `/data` was at 96 % (4.8 GB free), which does not hold LFM2.5-8B-A1B's 5.2 GB
regardless of MoE — the GGUF is mapped whole from flash, and expert paging is a RAM property,
not a disk one. Freed to **8.2 GB** by deleting a byte-identical duplicate
(`gemma-4-E2B-it-gpu.litertlm`, md5 `621a43cd…`, the copy inside `litert-f0/` kept) and a
`Qwen2.5-1.5B` GGUF with zero references in `results/runs.csv`.

## 7. What the phone measured in one night — and the cost nobody was measuring

First complete arm on a physical Galaxy S23, unplugged, Qwen3.5-4B Q4_K_M with the F16 vision
projector resident, `ciswire`, window 16, `NOREPACK=1`, 16 turns:

| family | result |
|---|---|
| `fact_recall_early` | **8/8 = 1.000** |
| `fact_recall_late` | **8/8 = 1.000** |
| honesty / language / tool_call | 1/1 each |
| miniapp | 0/1 |
| error turns, blank bubbles | **0** |
| digest | active on 7 turns, corpus max 64 docs |

One seed, one arm, and **no `off` arm beside it** — so this says "the 4B with ciswire held every
fact across 16 turns on real hardware", not yet "ciswire beats bare on a phone".

### 7.1 Prefill is the whole cost, and it is paid again every turn

| turn | prompt tokens | prefill | decode |
|---|---|---|---|
| 1 | 1496 | 84 s | 8.0 tok/s |
| 6 | 2196 | 160 s | 6.6 tok/s |
| 14 | 4100 | 346 s | 5.4 tok/s |
| 16 | 4156 | **394 s** | 5.8 tok/s (21 s) |

Decode is healthy — 5–8 tok/s, matching the sibling repo's `llama-bench` figure for this model on
this handset — and disabling the ARM repack does not hurt it. **Prefill is 95 % of the turn**, and
`reusedTokens` (from the engine's own `Input processed: n_past=…` line) is **0 on every turn**.

The cause is not the sliding window, not prompt divergence and not the MTP reuse guard. It is in
the app's own log, once per turn:

    ReactNativeJS: 'model.unload', '{"reason":"background"}'
    KALSA_SESSION {"op":"init"} → {"op":"load"} → Input processed: n_past=0

**The engine is disposed and rebuilt between turns** — `model.unload {"reason":"background"}`,
triggered by an AppState transition to `background` (`AppShell.tsx:2545-2555`); the logcat at that
second is loading Samsung and Google TTS resources, a correlation never proven into a cause.

⚠️ **Superseded as the explanation of the 394 s — see §7.5.** The dispose is real, but session
save/restore exists precisely to bridge it, and it does: the device logs `resumable=1` and
`{"op":"load","ok":true,"tokens":1736}`. The KV survives the rebuild and is *then* ignored,
because the prompt is rebuilt with the memory block at position 0. Fixing the dispose would not
have recovered a single second. Keep this paragraph as the record of a plausible cause that the
measurement removed.

Two consequences, and the second is bigger than the benchmark:

1. **Every campaign ever run may have paid this**, CI included — the 4B's 940 s/turn on the
   emulator is consistent with a full re-prefill each turn. It inflates absolute costs everywhere,
   though it hits all arms equally, so the A/B comparisons between context modes stay valid.
2. **For a user, this is the product's speed.** A phone assistant that reloads its engine between
   messages pays hundreds of seconds per turn no matter how good the retrieval is. Recall of 1.000
   is worth little at 7 minutes a turn.

### 7.2 Repack: measured, real, and not what was hanging the arms

`no_extra_bufts` (llama.rn) disables the ARM weight repack, which this repo's own estimator
describes as "a second copy of the weights" in anonymous memory. Measured on the device with the
4B loaded:

| | repack ON | repack OFF |
|---|---|---|
| app VmRSS | 677 MB | 3.60 GB |
| app VmSwap | **3.32 GB** | **93 MB** |
| system MemAvailable | 726 MB | **3.55 GB** |

With repack on, 3.3 GB of the app sits in zram while the GGUF itself is mmap'd and evictable; with
it off, the weights stay file-backed and the system keeps 3.5 GB free. That is a real fix for
8 GB phones and it costs nothing measurable in decode.

**Correction on record**: I first read the swap as the cause of the arms hanging at turn 2. It was
not — with repack off the arm hung identically. The hang was the harness (§7.3). Two true
statements were being welded into one false one.

### 7.3 The harness waited 40 minutes for a reply to a message it never sent

Three device arms died at turn 2. The app was idle (`State: S`, no thread running, 745 % of 800 %
idle) and the conversation on screen ended at turn 1 — because the message was **still in the
composer**. `send_and_wait` verified that the text LANDED and treated that as sent. On the emulator
the send tap always worked; a real device with a different layout and a localised control exposed
it. Fixed: submission is proven (history grew or composer emptied) before any waiting, the send is
retried by re-finding the control, and a failed UI dump counts as *not* submitted rather than as
an empty composer. On a physical device the type path is still a no-op (native EditText holds the
text, React `draft` does not — Send stays a live node that does nothing); deliver turns with
`scripts/device-share-send.sh` (`kalsa://share?text=`).

### 7.4 Cost model for the long-conversation regime

Per-turn cost plateaus once the window fills (prompt tokens 4100 → 4156 at turns 14-16, ~430 s):
16 turns = 77 min measured; 30 turns ≈ 3 h; 40 turns ≈ 4.2 h. Beyond turn ~14 the extra turns no
longer add context pressure — the window is capped — they add **retrieval corpus** (64 docs at 16
turns, ~120 at 30). Decision with Marco: **30 turns**, because doubling the corpus is the step
that matters and the extra hour and a half buys a third more of an already-doubled number.

Battery is the other constraint: ~30 %/h of heavy inference, so with the sibling repo's 30 % floor
a single discharge holds ~2.3 h — **a 3 h arm does not fit one charge**. Either the arm shortens,
or the campaign runs plugged and declares the thermal confound, or §7.1 gets fixed and every turn
becomes cheap enough that the question disappears.

### 7.5 The KV chain, followed to the bottom: we invalidate our own cache, every turn, on purpose

§7.1 said the engine was disposed between turns and no KV survived. Following that produced three
fixes and one root cause, in this order:

1. **The restore guard could never succeed** — it compared the hash of the WHOLE history while the
   history had grown by the new user message. Fixed (prefix + suffix rule, §commit `1afe789`), and
   the device now logs `{"op":"load","ok":true,"tokens":1713}`.
2. **The harness stopped seeing replies at all** after the merge with main, which moved messages to
   per-conversation keys (`kalsa.messages.conv-<id>`). The reply was on screen and in the database
   while `history_count` read a key that no longer existed. Fixed (`2d1ad72`).
3. **The prefill still did not drop**: `reused=0`, turn after turn, with the session restored.

**The engine hypothesis was wrong, and the patch is what refuted it.** The suspicion was that
`JSISession.h` wiped the restored KV because its resumability check (`pos_max + 1 == n_tokens`,
with a tolerance branch only for M-RoPE media) could not hold for a hybrid GDN+attention model —
the sibling repo's H5 in `moe-kv-reuse-diagnosis.md`. A three-line native patch (`4e64b97`,
`8d35a18`, shipped in APK 7 / `6f2946d`) printed the two numbers, and they say the opposite:

```
KALSA_KVRESUME n_tokens=1736 pos_max=1735 mrope_media=0 is_recurrent=0 is_hybrid=1 n_swa=0 resumable=1
{"op":"load","ms":45,"ok":true,"tokens":1736}
Input processed: n_past=0, embd.size=1772
```

`resumable=1`. The cache is loaded, judged valid, and **kept**. The engine is not the culprit and
was never the culprit; the re-prefill happens with a healthy cache sitting right there.

**Nor is the cause the memory block's position, which was the next wrong guess.** The prefix is
mostly intact — the same patch printed it:

```
KALSA_KVPREFIX embd=1712 text_tokens=1748 n_common=1646
KALSA_KVDIAG   n_common=1646 total=1748 search_max=1646 checkpoints=[1712,]
no usable state checkpoint (recurrent/hybrid/SWA model), doing full cache clear
Input processed: n_past=0, embd.size=1748
```

**1646 of 1748 tokens are shared — 94 %.** The prompt is stable almost to its end; the divergence
sits in the last ~100 positions. So a memory block at position 0 is not what is being paid for
here (it remains a latent defect — see below — but it is not the 390 s).

**The cause is a hybrid model meeting a prompt that is not append-only**, and the engine says so in
its own words (`rn-completion.cpp:500-503`):

```cpp
LOG_WARNING("no usable state checkpoint (recurrent/hybrid/SWA model), doing full cache clear");
llama_memory_clear(kv, false);
n_past = 0;
```

Qwen3.5-4B is hybrid (GDN + attention; our own `is_hybrid=1`). A recurrent state **cannot be
rolled back**: reusing a prefix of 1646 would mean dropping cells beyond that point, an operation
that does not exist for this memory type. The only escape is a state checkpoint at exactly the
needed position. One checkpoint exists — at **1712**. The position needed is **1646**.

**The whole prefix is discarded because the checkpoint is 66 tokens too far forward.** 1646 tokens
re-prefilled to avoid being 66 short.

This finally explains the datum that never fitted: `reused=1984` on a second round *within* a
turn. There the prompt only grows — no cached position is rewritten, so no rollback is needed and
reuse works. Between turns, something in the last ~66 tokens of the previous prompt is re-rendered
differently.

**The operative rule for this model: the prompt must be append-only.** Nothing already in the
cache may ever change. Satisfy that and `n_common` becomes 1712, the 1712 checkpoint matches
exactly, and a turn costs only its new tokens.

**Settled by measurement 2026-08-16** (`KALSA_KVDIVERGE`, APK 8 / `12868ea`, device run at
19:49:38). The divergence is four tokens, and the log prints them in plain text:

```
shared : … PK42<|im_end|>\n<|im_start|>assistant\n
cache  : <think>\n\n</think>\n\n Salvato! 👋 …
prompt :                         Salvato! 👋 …
```

`shared_ids` ends `[… 248046 198 248045 74455 198]` (`<|im_end|> \n <|im_start|> assistant \n`);
the cache then holds `[248068 271 248069 271]` — `<think>`, blank, `</think>`, blank — and from
there both streams are identical (`16737 85 4189 0 59720 233 271 9` on each side).

Qwen3.5's template injects an **empty** think block after the assistant header when it asks the
model to answer with thinking disabled. Those four tokens enter the KV. The next turn replays the
*stored* assistant message, which never had them. Nothing is misbehaving: the template is right to
add them when prompting and right not to add them when repeating, and the divergence is the
friction between two reasonable behaviours.

The root cause on our side is that we keep only the cleaned, user-visible text — `Message`
(`AiChatPage.tsx:199-222`) has `text` and nothing else — so what the model actually produced cannot
be replayed. The fix is to separate the two: store the model-visible text, render the cleaned one.
Deliberately **not** fixed by prepending the template's tokens in prompt assembly: this app also
runs LFM2.5 and gemma, and hardcoding one template's internals buys today's fix with tomorrow's bug.

**Five of five turns show the identical divergence** — `embd_ids` begins `[248068 271 248069 271]`
in every sample of the arm (n_common 1646, 1749, 1937, 2250, 2395), after which each reply differs
as expected. The four tokens are invariant; only what follows them differs. That makes the acceptance
test for the fix unambiguous: after it, `KALSA_KVDIVERGE` must stop appearing at turn boundaries
altogether, not merely appear less often.

Note the scale of the exchange, because it is the argument for instrumenting before theorising:
**1646 tokens of valid cache, ~390 s of prefill, discarded every turn over four tokens of template
punctuation.**

**The latent defects found on the way** (real, worth fixing, but not the 390 s):

1. `src/engine/LlamaService.ts:271-288` — `buildSystemPrompt` appends the retrieved-memory block
   to the **system prompt**, i.e. position 0 of the prompt:
   `prompt += "\n\n" + strings.memory.promptSection.replace("{facts}", factBlock)`.
2. `src/engine/LlamaService.ts:1704-1712` — that system message is built first, then history. So
   when the retrieval layer returns a different fact set — which is its entire job, every turn —
   the prompt diverges at its first tokens and **everything after it must be re-prefilled**.
3. `src/engine/sessionPersistence.ts:241-253` — `computePromptEnvHash(locale, memoryFacts)` hashes
   the joined facts, so a changed fact set makes the saved session be *rejected* on restore. By
   design.

These do not cost the 390 s today — the smoke arm above diverges at 94 %, not at position 0 — but
they are loaded guns under the append-only rule: the day retrieval returns a different fact set,
the divergence point jumps to the top of the prompt and the same full clear fires, only worse.

The same reading found a latent defect next to it: `computePromptEnvHash` hardcodes
`hasTools: true` while `buildSystemPrompt` really switches between `systemPrompt` and
`systemPromptWithSearch`. A session saved with tools and restored without passes the check with a
demonstrably different system prompt.

Moving the block to the tail is therefore still the right change — it removes the loaded gun and
fixes the `hasTools` defect — but it must be judged as hardening, **not** as the prefill fix. Its
declared risk stands: tail-position memory changes model behaviour, recency usually helps recall
but that is a bet, and the baseline to beat exists (§7, 16 turns, `fact_recall_early` 8/8 and
`fact_recall_late` 8/8). Re-run that exact arm and compare.

**Note the layering — it is the real lesson of this section.** Four causes were proposed and three
were wrong, each one plausible and each one removed only by an instrument that printed a number:

| proposed cause | verdict | what killed it |
|---|---|---|
| restore guard always refuses | **true, fixed** (`1afe789`) | `ok:false → ok:true` in the device log |
| engine disposed between turns leaves no KV | refuted | `resumable=1`, cache kept across the rebuild |
| engine wipes the restored KV (hybrid resumability check) | refuted | the native patch printed `resumable=1` |
| memory block at position 0 destroys the prefix | refuted as the cost | `n_common=1646/1748` — 94 % shared |
| hybrid KV cannot roll back to the divergence point | **standing** | the engine's own `full cache clear` line |

Each layer was invisible until the one above it was removed, and each wrong guess was cheap only
because it was written down before being tested. The standing cause is itself one measurement from
being complete: which 66 tokens change.

### 7.6 Thermal drift runs inside the arm, and now the arm waits

Measured on the unplugged S23, same arm, same regime:

    turn   1    2    3    4    5    6    7
    sec  165  167  232  217  296  391  505

against 237 s at turn 7 the night before on a cool phone — more than double, at
battery 44.1 °C with `Thermal Status: 3` (SEVERE). Recall does not depend on temperature; every
latency number after the knee does. In a 30-turn regime the drift sits *inside* the arm, so late
turns run on a slower machine than early ones — fatal for a benchmark whose subject is early vs
late — and the first arm of a session is the fastest by construction.

Device mode now pauses before a turn at SEVERE or 44 °C and resumes at LIGHT and 39 °C, logging
the wait. Proven on the device the same day:

    [ci] thermal: pause — status=3 battery_deci=420 …
    [ci] thermal: cooling… waited=60s status=2 battery_deci=399

Cooling is fast (44 → 29 °C in ~10 min with the screen off), so the gate costs minutes, not hours.
Battery burn is the other limit: ~30 %/h of sustained 4B inference, so with the sibling repo's
30 % floor one discharge holds ~2.3 h of measurement.

### 7.11 PREDICTION 2026-08-19 (arithmetic done, measurement pending): the shipping model may not load on a Galaxy S23 in production configuration

Found while checking whether the phone could hold the 8B before starting a run. Every number below
is either a committed constant or a device probe; only the conclusion is unverified.

`estimateMemory` (`memoryEstimate.ts:111-116`) counts weights as **evictable** (they are mmapped
file pages) and charges only `repack + compute + kv` as non-evictable. Production always asks for
repack: `gateForModel` (`AppShell.tsx:350-353`) calls `estimateModelNonEvictableMiB` without
`repack: false`, so the default `true` applies.

| term | value |
|---|---|
| weights | 5 155 564 768 B = **4917 MiB** |
| `REPACK_FRACTION` | (1333 − 249) / 1211 = **0.8951** |
| repack | 4917 × 0.8951 = **4401 MiB** |
| compute @ ubatch 256 | **249 MiB** |
| kv | 0 — no `kvBytesPerToken` in the registry entry, so this is a **lower bound** |
| **non-evictable** | **4650 MiB** |

Against the device, probed today while idle: `MemTotal` 7 243 740 kB, **`MemAvailable` 4 219 984 kB
= 4121 MiB**. `modelGateVerdict` blocks when non-evictable exceeds available
(`deviceProfile.ts:162-165`), so **4650 > 4121 → `blocked_ram`**.

The tier gate does not catch it first: 7.24 GB ≥ `RAM_TIER_HIGH_BYTES` (6.9 GB) so the S23 is
`high`, and — the part that reads like an oversight — **`lfm2.5-8b-a1b` declares no `minRamTier` at
all**, while `qwen3.5-4b`, at 2704 MiB just over half its size, declares `"high"`.

Two things follow if the measurement confirms it. The model Kalsa ships would be unloadable on a
2023 flagship in its default configuration, and `kalsa.bench.norepack=1` would be the difference
between running and not (repack term → 0, non-evictable → 249 MiB) — a knob currently documented
as a CI A/B only. Note also that `availableMemoryBytes` is sampled **once per process**
(`getCachedDeviceProfile` memoises the promise), so the verdict depends on memory pressure at app
start and is not re-checked afterwards.

⚠️ **`REPACK_FRACTION` is calibrated on a DENSE model, and this one is not.** The constant comes
from Qwen3.5-**2B**'s peak `RssAnon` (`memoryEstimate.ts:34-48`). LFM2.5-8B-A1B is an MoE with ~1B
active, and whether llama.cpp repacks every expert tensor into the anonymous buffer is exactly what
nobody here has checked. So the *real* footprint may be much smaller than 4401 MiB.

**That does not save the load, and this is the point worth keeping.** The gate decides on the
**estimate**, not on what the runtime would actually allocate (`AppShell.tsx:350-353` →
`deviceProfile.ts:162-165`). If the estimate is miscalibrated for MoE, the app refuses a model it
could have run — the failure mode is a false negative, and it is invisible, because a blocked load
produces no allocation to compare against.

⚠️ **Not measured.** The APK that can test it (`32254348018`, debuggable) is still building.
**First thing the device run answers**, and it answers two questions at once: does the app refuse,
and — with `norepack=1` — what does an 8B-A1B actually cost in anonymous RAM.

### 7.10 MECHANISM 2026-08-19: the digest costs cache per INJECTION, not per change — knob written, UNMEASURED

§7.9 measured the cost (digest arms reuse 0.564 against 0.704 bare) and named the site
(`applyOperativeBlockFormat` prefixes the block onto `messages[length-1]`,
`LlamaService.ts:1556-1562`). This section corrects *why*, because the wrong why is written into
the code and has already misdirected one experiment.

**The load-bearing false step.** `compactor.ts`'s header and `RESEARCH_CONTEXT_LOSS.md:157` both
argue: *"everything after the last stable token is re-encoded every turn anyway, so freezing the
digest saves zero prefill"*. The conclusion is right and was measured; the reason is not. The block
is last **only for the turn that carries it**. One turn later that user message is history and
`promptContentForHistoryMessage` returns `message.content` — the clean text, no block
(`modelEmittedText.ts:16-23`; the replay path exists for assistant messages only). So the last
stable token moves *backwards* past the block, past that user message, and past **the reply
generated after it**. The re-encoded region is not "the tail", it is one whole exchange.

**Consequence, and it is testable.** The cost is paid per *injection*, not per *change of content*:

| regime | what the KV loses |
|---|---|
| inject every turn, content varying | one exchange, **every turn** |
| inject every turn, content frozen | one exchange, **every turn** — this is why freeze measured zero |
| inject every K turns | one exchange, **once per K turns**; the turns in between re-render clean and match |

The freeze experiment held content still and left injection alone, so it could only ever measure
zero. Nobody has run the variant that holds *injection* still. That variant is also what the owner
proposed independently (*"la mia idea era iniettarla dopo tot turni"*).

⚠️ **NOT MEASURED.** The table above is derived from the render path, not from a run. What exists
today is only the instrument: `parseBenchDigestCadence` + `shouldInjectOperativeBlock`
(`compactor.ts`, 8 unit tests), `getBenchDigestCadence` (`benchConfig.ts`, key
`kalsa.bench.digestcadence`), `DIGESTCADENCE` in `ci-bench.sh` with the both-branch pref assert,
and the `digestcadence` workflow input. Empty/1 → every turn, i.e. production is untouched. Turn 0
always injects (no earlier reply for it to invalidate). The pref lands in `prefs.txt`, so an arm
cannot silently claim a cadence it did not run.

**The acceptance criterion, fixed before the run and not after:** cadence K>1 counts as confirmed
only if `reuseFrac` rises toward the bare arms' level *and* the per-turn pattern shows the loss
concentrated on injection turns (turn index % K == 0) rather than spread evenly. A uniform
improvement would mean something else changed. Recall is the other half and can only lose: a digest
keyed on the query from up to K−1 turns ago is the exact staleness the 2026-08-03 freeze revocation
measured at 33.3 % vs 100 %. **If cadence buys cache at that recall, it is not worth shipping** —
the arm must report both numbers or it reports nothing.

### 7.9 MEASURED 2026-08-18: `preserve_thinking` works — reuse 0.035 → 0.599, turn 295 s → 160 s

Controlled pair, same branch, same model, same phase, only the code differs: smoke
`32097043246` (pre-fix) against `32157672018` (post-fix, `31c5489`), LFM2.5-8B-A1B, 8 arms each.

| | pre-fix | post-fix |
|---|---|---|
| KV reuse fraction | 0.0353 | **0.5989** |
| prefill / turn | 255 s | **111 s** |
| whole turn | 295 s | **160 s** |
| mean prompt tokens | 1951 | 2036 |

**Every arm improved.** §7.8's diagnosis is confirmed on the metric it predicted: keeping the
model's own reasoning in the history render makes the prefix match the KV, and the cache survives
on a model that has no recurrent-state rollback to fall back on.

**The feared context cost did not materialise at this length**: +85 prompt tokens, 4.4 %. It will
grow with conversation length — this smoke is 7 turns — so it still needs watching on a 13-turn
campaign, but the trade Marco called (cache over context budget) is not close at this scale.

⚠️ **It is a large win, not a complete one, and the prediction was wrong in an informative way.**
I forecast ~0.9 and got 0.599. Prompt grows ~136 tokens per turn against 2036, so the ceiling is
about **0.93** — roughly a third of the prefix is still being re-evaluated. Something diverges
partway, and the arm distribution says where:

| arms | reuse |
|---|---|
| `baseline`, `nogate`, `off_off` | **0.704** |
| `ciswire`, `ciswire_off`, `ciswire_on`, `v42` | 0.564 |
| `off_on` | 0.424 |

**The digest arms reuse 14 points less than bare.** That is the §0 prediction landing: the operative
block is prefixed onto `messages[length-1]` (`LlamaService.ts:1556-1562`), so next turn that message
re-renders without it and the prefix breaks there — the same defect that forced `9c73846`'s revert
of memory-facts-on-the-user-turn. Until that is fixed, **CisWire costs cache**, which is the one
place its otherwise-additive design is not free. Next lever, and now it has a number attached
rather than an argument.

### 7.8 DIAGNOSED 2026-08-18: why the shipping model reuses no cache — and it is not the Qwen cause

Investigation dispatched after the LFM campaign measured `reuseFrac` 0.008 against Qwen's 0.561.
Every line below was re-verified on disk by the parent before being written here.

**The template is NOT the cause.** Unlike Qwen3.5, LFM2.5's `add_generation_prompt` injects
nothing but the header — there is no empty think block to go missing:

```
{%- if add_generation_prompt -%}
    {{- "<|im_start|>assistant\n" -}}
{%- endif -%}
```
(`chat_template.jinja:115-117`; note it lives in `chat_template.jinja`, **not** inside
`tokenizer_config.json`.) Rendering a conversation as generation and again as history one turn
later, the second render starts with the first, exactly. `buildSystemPrompt` and
`computePromptEnvHash` are clean too — no clock, no date (`memoryPrompt.ts:29-45`,
`sessionPersistence.ts:244-256`) — and anything varying there would have broken Qwen equally.

**The cause is the model's own reasoning, deleted from history.** LFM2.5-8B-A1B is reasoning-tuned
and always emits a `<think>…</think>` block; our own catalog records that it cannot be switched
off (`ModelRegistry.ts:235`, "the template has no off switch"). The KV therefore holds
`<think>…</think>\n\nHi there.` while the history render **strips everything up to `</think>`**:

```
{%- if not (preserve_thinking or loop.index0 > ns.last_user_index) -%}
    {%- if "</think>" in content -%}
        {%- set content = content.split("</think>")[-1] | trim -%}
```
(`chat_template.jinja:87-90`.) So the prompt diverges from the cache immediately after the first
`<|im_start|>assistant\n`. Structurally the same place as Qwen's §7.5 divergence; **different
mechanism** — there an empty block the template adds and never repeats, here a real block the
*model* emits and the template deletes.

**And this is what explains 0.008 against 0.561** — the sanity check the brief demanded. Both
models mismatch at the assistant header. Only one can survive it:

```
bool llm_arch_supports_rs_rollback(const llm_arch & arch) {
    switch (arch) {
        case LLM_ARCH_QWEN35:
        case LLM_ARCH_QWEN35MOE:
            return true;
        default:
            return false;
```
(`node_modules/llama.rn/cpp/llama-arch.cpp:981-989`; `LLM_ARCH_LFM2` and `LLM_ARCH_LFM2MOE` are
declared at `:120-121` and fall to `default`.) Qwen3.5 can roll back its recurrent state and keeps
`n_past = n_common`. LFM2MOE cannot: `seq_rm` fails, `llama_memory_clear` runs, `n_past = 0`, and
every turn pays a full prefill. **Qwen's 0.561 is a rollback the shipping model does not have.**

**The lever exists and is one flag.** `preserve_thinking` is a real template variable defaulting to
false (`chat_template.jinja:2`), and `chat_template_kwargs` already reaches the jinja as template
context (`common/chat.cpp:913-915`, `:2895-2897`) — we pass `{ enable_thinking: false }` on three
Qwen paths today (`LlamaService.ts:2521,2668,2771`). Setting `chat_template_kwargs:
{ preserve_thinking: true }` on the LFM path makes history keep what the KV holds, so the append is
pure append and needs no rollback.

⚠️ **It is not free, and the cost lands on the one number this model is tight on.** Preserving
thinking retains *every* prior turn's chain of thought in the prompt. At `thinking: { short: 256,
extended: 512 }` that is roughly 256–512 tokens per past turn, against `engineCtx: 8192`
(`ModelRegistry.ts:232`). Mean prompt is 2506 tokens today; twelve retained think blocks would add
~3–6 k and put a 13-turn conversation at or over the ceiling. The prefill saving is paid once per
token while the re-prefill is paid every turn, so the arithmetic still favours it heavily — but
**`contextFullTurns` must be watched**, and this is where Marco's small-`n_ctx`-plus-digest idea
and this fix meet: they push on the same budget from opposite ends.

**Not implemented.** Diagnosis only, and one limit declared by the investigation: campaign
`32103054225` carries no `KALSA_KVDIVERGE` lines, so `n_common` was not measured on those arms —
the divergence point is established from the renders, in characters, not from token counts on the
live run.

### 7.7 What shipped, and how to tell whether it worked

`6447ff2`. The prompt is rebuilt from the text the model **emitted**, not the cleaned text the user
reads, so the re-render reproduces what entered the KV. `Message` carries `modelEmittedText`
(assistant only), it is persisted and survives compaction, and `promptContentForHistoryMessage`
prefers it over `content`.

When the window cannot reproduce the KV, the session is **refused with a named reason**
(`history_not_reproducible`) and its artifacts are deleted. This matters more than it looks: on the
old path a session that passed the hash gate but diverged at token-match time left the `.kvs` in
place, so the full re-prefill was recharged on every later restore rather than once.

**Acceptance test, unambiguous by design**: `KALSA_KVDIVERGE` must stop appearing at turn
boundaries altogether — not appear less often — and `n_common` must equal `embd.size()` across a
turn, the way it already does within a turn (measured, 2014 of 2014).

> ⛔ **The acceptance test FAILED on the device (APK 9, `6447ff2`, run 22:07:38).** Turn 2 gives
> `embd=1701 text_tokens=1737 n_common=1646`, one `KALSA_KVDIVERGE`, `n_past=0` — unchanged, and
> the divergence is the same four ids `[248068 271 248069 271]`.
>
> **The premise was wrong, and the numbers had said so since the morning.** Those four tokens are
> not emitted by the model, they are fed *to* it: turn 1's prompt is **1650** tokens and the shared
> prefix ends at **1646**, so positions 1646-1649 sit inside the prompt, in the generation suffix
> the template appends when it asks for an answer. No amount of capturing the model's *output* can
> reproduce input. Replaying the emitted text was the wrong instrument for this defect.
>
> **What the change is still worth**, independently of the prefill: the refusal path deletes a
> `.kvs` that can no longer be reproduced, where the old path left it in place to recharge the full
> re-prefill on every later restore; and with thinking *enabled* the emitted text is the only way to
> replay a real reasoning block.
>
> **The two real routes**, neither taken yet — llama.rn exposes both:
> 1. **Template symmetry** — `enable_thinking` / `chat_template_kwargs` / `add_generation_prompt`
>    are exposed (`lib/typescript/index.d.ts:75,77,197-201`). Remove the asymmetry at the source so
>    the empty block never enters the prompt. Small, targeted, one build to verify.
> 2. **Own the prompt** — the completion API accepts a raw `prompt: string`
>    (`lib/typescript/types.d.ts:176,540`), so the prompt can be kept as an append-only transcript
>    instead of being re-rendered from messages each turn. Template-agnostic, closes the whole class
>    rather than this instance, and is the structural answer. The engine also returns
>    `generation_prompt` (`types.d.ts:216,565`), which would let the appended suffix be stored and
>    replayed **without hardcoding any template's tokens** — worth reading before choosing.

#### 7.7b Route 1 as written above is refuted — the lever is already pulled the wrong way

**2026-08-16, read on disk.** Route 1 says "set `enable_thinking` / `chat_template_kwargs` so the
empty block never enters the prompt". Those fields are **already set, to `false`, on the
production path** — `resolveThinkingParams` returns them for both `"default"` and `"off"`
(`src/engine/thinkingBudgets.ts:45-58, 75-86`):

```ts
enable_thinking: false,
thinking_budget_tokens: 0,
reasoning_format: "none",
chat_template_kwargs: { enable_thinking: false },
```

and the main chat completion spreads them (`src/engine/LlamaService.ts:2000`, `...roundThinkingFields`).
`enable_thinking: false` is not the missing cure — **it is the cause**. The template injects the
empty block precisely *because* it was asked for an answer with thinking disabled. Route 1 as
phrased could never have worked, and one build would have been spent proving it.

**The corrected route 1 — polarity, not presence** (Marco, 2026-08-16). Run the model with
thinking **enabled**: the template then has no empty block to inject, the assistant header stays
bare, and the `<think>` is opened by the model. The asymmetry disappears at its source, and the
patch shipped in `6447ff2` — useless against input tokens — becomes **load-bearing**, because a
real reasoning block *is* model output: `modelEmittedText` stores it and
`promptContentForHistoryMessage` already replays it.

**It costs zero builds.** `thinkingMode` is a persisted setting, not a compile-time flag:
`src/bench/benchConfig.ts:155-163` reads `kalsa.bench.thinking` from AsyncStorage (default
`"default"`), `budget512` maps to `enable_thinking: true` with a 512-token budget for this model
(`thinkingBudgets.ts:67-74`, `ModelRegistry.ts:129`), and the APK already on the device supports
both it and the `KALSA_KVDIVERGE` instrumentation. Flip the setting, run turns, read the log.
Acceptance criterion unchanged from §7.7 — and guard the dead-arm trap: prove the engine ran.

**What the change costs if it works**, none of it a reason not to test it, all of it a reason not
to ship on the test alone:

1. **Context, not compaction, is the wall.** `engineCtx` is 8192 (`ModelRegistry.ts:118`) against a
   262144 catalog length. At 512 thinking tokens per turn a 30-turn regime adds ~15k tokens of
   reasoning alone. Compaction is an *event*, not a per-turn rewrite (correction, Marco): it costs
   one full re-prefill each time it fires and append-only resumes from the new base. The number
   that matters is therefore **how many times it fires in 30 turns**, which is unmeasured.
2. **`nPredict` squeezes the answer.** `budget512` leaves ≤512 tokens for the reply under a 1024
   ceiling. The registry already has the precedent: the one model with `short: 512` raises
   `nPredict` to 2560 (`ModelRegistry.ts:198`). Raise it, or measure truncation and call it quality.
3. **A dormant privacy defect gets armed.** §7.7 above closes with "with thinking off the emitted
   text differs from the cleaned text only by the four empty-block tokens, so there is nothing
   hidden to expose". Thinking on removes that guarantee: `modelEmittedText` then holds the
   reasoning in plaintext for the life of the conversation, and `scripts/ci-dflash-ab.sh:235-238`
   dumps the whole message row into bench artifacts. Close it **before** the polarity flips.
4. **Stream shape.** The `budget*` branches set neither `reasoning_format: "none"` nor
   `chat_template_kwargs`, which `off`/`default` both set; the comment at `thinkingBudgets.ts:52-54`
   warns that changing `reasoning_format` changes the stream shape the UI expects. If thinking
   becomes production, that branch needs aligning or the app's `<think>` stripping breaks.
5. **The baseline stops being comparable.** Every number in §1 and §7 was measured with thinking
   off, including the 16-turn `fact_recall` 8/8. It must be re-run, not cited.

**Corrections to the citations in route 2 above**, all verified on disk in the installed
llama.rn:

- `types.d.ts:176` `prompt: string` is a **required** field of `NativeCompletionParams` (declared
  at `:175`) — but `CompletionParams = Omit<NativeCompletionParams, 'emit_partial_completion' |
  'prompt'> & CompletionBaseParams` (`index.d.ts:91`) strips it and `CompletionBaseParams`
  re-introduces it as optional (`index.d.ts:65`). So `engine.completion({ prompt })` **is** legal
  from JS. Route 2 is reachable, not merely present in the native types.
- `types.d.ts:540` is **not** a completion input: it is `NativeSessionLoadResult.prompt` (type
  declared at `:538`) — the prompt a restored session was saved with. Useful for verifying
  append-only, but it is not the field route 2 rests on.
- `generation_prompt` is **both**: an input on `NativeCompletionParams` (`types.d.ts:216`,
  documented "Assistant generation prompt returned by jinja chat formatting"), and a field of
  `JinjaFormattedChatResult` (`types.d.ts:565`), the return type of `getFormattedChat`.
  `NativeCompletionResult` does not carry it. That pairing is exactly what route 2 needs: render
  once, capture the suffix, replay it verbatim without hardcoding any template's tokens.
- Also in `CompletionBaseParams` and unexamined so far: `prefill_text` (`index.d.ts:87-90`),
  documented as "Prefill text to be used for chat parsing (Generation Prompt + Content) — used if
  last assistant message is for prefill purpose". Read it before designing route 2.

#### 7.7d Thinking ON was measured, and it FAILS — the asymmetry is the history branch itself

**Device run 2026-08-16, S23, APK 9, setting `kalsa.bench.thinking=budget512`, zero builds.**
The §7.7b hypothesis — flip the polarity, no empty block to inject — is **refuted by measurement**.
Both halves of the acceptance criterion fail at the 1→2 boundary:

```
KALSA_KVPREFIX embd=1814 text_tokens=1747 n_common=1616
KALSA_KVDIVERGE n_common=1616 shared_lo=1608 embd_hi=1628 text_hi=1628
shared_txt=[ Ciao<|im_end|> \n <|im_start|>assistant \n ]
embd_txt=[<think>\n L'utente sta semplicemente salutando con "C]
text_txt=[Ciao! 👋 \n\n Sono Kalsa, il tuo]
KALSA_KVDIAG n_common=1616 total=1747 search_max=1616 checkpoints=[1814,]
no usable state checkpoint (recurrent/hybrid/SWA model), doing full cache clear
Input processed: n_past=0, embd.size=1747
```

The empty block is indeed gone — the divergence is no longer `[248068 271 248069 271]`. It is the
**mirror image**: the KV holds the reasoning the model actually emitted, and the re-rendered
prompt holds the cleaned answer, because the template's *history* branch strips the think block.
`modelEmittedText` was persisted correctly and did begin with `<think>` (735 chars, read from the
device DB), and `promptContentForHistoryMessage` did prefer it — so this is not a missing field
on our side. **The template will not re-render history to match what entered the KV, in either
polarity.** Route 1 of §7.7 is dead in both directions; what remains is making the history branch
symmetric ourselves (a template override) or owning the prompt (route 2).

The engine demonstrably ran — turn 1 `embd=0 … n_common=0` then `embd.size=1618`, turn 2 restore
`resumable=1 tokens=1814`, saves at `messageCount` 2 then 4, and a visible reply (`Due più due fa
**4**`). Not a dead arm. Wall-clock ~2.5 min/turn is **not** a measurement: the phone was charging.

⚠️ **Device state left changed by this run**: `kalsa.bench.thinking` is `budget512` (production
default is `off`) and the conversation store was wiped. Revert before any campaign quotes numbers.

#### 7.7j The join is closed and the saving is now flat — and the diagnostic that proved it found a defect the acceptance criterion could not see

**2026-08-17, unplugged, wireless, APK `b31fb53`, coldest start yet (27.9 °C, 71 %).** Six turns,
transcript ON, thinking off, web off, history wiped. The same six prompts as §7.7i.

| turn | wall | °C before | thermal | transcript op |
|---|---|---|---|---|
| 1 | 103 s | 27.9 | 0 | `rebuild reason=fresh` |
| 2 | **31 s** | 34.3 | 0 | `delta glue=11` |
| 3 | **32 s** | 33.3 | 0 | `delta glue=11` |
| 4 | **32 s** | 33.2 | 0 | `delta glue=11` |
| 5 | **32 s** | 32.8 | 0 | `delta glue=11` |
| 6 | **31 s** | 33.5 | 0 | `delta glue=11` |

**Turn 6 was 151 s in §7.7i and is 31 s here.** `glueEot` closed the tokenisation join: one
`rebuild` in the whole session (`fresh`, turn 1, which has no cache by definition), `KALSA_KVDIVERGE`
**zero**, five consecutive boundaries reused against §7.7i's two. Battery fell 71 → 69 % over six
turns and `Thermal Status` never left 0. The saving is no longer intermittent.

⚠️ **But the new diagnostic shows the prompt carries every assistant reply twice.** The 48-char
windows around the seam, identical in shape at all five boundaries:

```
tTail = '...<think>\n\n</think>\n\nDi che cosa hai bisogno?'
dHead = 'Di che cosa hai bisogno?<|im_end|>\n<|im_start|>u'
```

`T` ends with the reply in **generation form** (preceded by the empty think block the model itself
emitted); the delta restarts from the same reply in **history form**. So each turn appends
`<|im_end|>\n` + a second copy of the reply. This is **not** caused by `glueEot`, which only inserts
the 11-char end-of-turn, and it is **not** a deep-link artifact: `kvTranscript.ts:157` sets
`transcript = candidate + emitted + suffix` and `candidate` ends with `<think>\n\n</think>\n\n`, so
the same duplication occurs on the ordinary path. It was present in §7.7i too, merely without the
glue between the copies.

**The methodological finding matters more than the bug.** The acceptance criterion fixed before
measuring — `KALSA_KVDIVERGE` gone and `n_common == embd.size()` — is **true with the duplicated
text in place**, because `T` remains a valid prefix of the new prompt however malformed its content
is. That criterion measures reuse, not correctness. Nothing in the run looked wrong: all six replies
are coherent. The cost is that assistant text accrues at double rate and the model reads a
transcript in which every one of its turns appears twice, separated by a stray `<|im_end|>`.

**Status: the latency result stands, the correctness result does not. Route 2 must not merge.** The
cut is the suspect — `cutPPrevFromRolePair` (`kvTranscriptFormat.ts:130`) takes the longest common
prefix of a user-probe and an assistant-probe render, and it lands *before* the last assistant's
content while `T` already holds that content. Measured `pPrev` = 5532 against a turn-1 prompt of
5551: exactly 19 chars short, the length of `<think>\n\n</think>\n\n`. Any fix has to be re-measured
against a criterion that reads the seam, not just the token counts.

#### 7.7i ANSWERED: the thermal loop opens — the control self-blocks at turn 4, the treatment runs six and cools

**2026-08-17, unplugged, wireless, APK `3a3a15f`.** §7.7g's falsifiable prediction was that removing
the re-prefill removes the heat source. It holds.

| turn | control: wall / °C before / thermal | control `promptMs`/`n_past` | arm A: wall / °C / thermal | arm A `promptMs`/`n_past` |
|---|---|---|---|---|
| 1 | 98 s / 30.8 / 0 | 82007 / 0 | 106 s / 31.3 / 0 | 73959 / 0 |
| 2 | 91 s / 36.1 / 0 | 81954 / 0 **diverge** | **37 s** / 36.8 / 0 | **1957** / 1298 |
| 3 | 94 s / 38.4 / **2** | 85338 / 0 **diverge** | **37 s** / **35.8** / 0 | **3605** / 1350 |
| 4 | 94 s / 40.5 / 2 | 87010 / 0 **diverge** | **41 s** / 35.8 / 0 | **2530** / 1410 |
| 5 | **STOP** / 41.5 / **3 (SEVERE)** | — | 37 s / 36.7 / 0 | 7688 / 1535 |
| 6 | — | — | 151 s / 36.7 / 0 | **111703 / 0** ⚠️ |

**The control heats itself out of the experiment**: 30.8 → 41.5 °C in four ordinary turns, cold to
SEVERE, and turn 5 could not be sent. **Arm A ran six turns without ever leaving `Thermal Status`
0**, and its temperature *falls* while it works — 36.8 → 35.8 → 35.8 → 36.7, ending the session at
35.7 °C. Prefill is 2.0–7.7 s against 82–87 s; wall-clock 37–41 s against 91–94 s, ~2.4×.

The handicap was honoured: arm A started **hotter and emptier** (78 %, 31.3 °C) than the control
(100 %, 30.8 °C), so the advantage is a floor. Turn 1 is a full prefill in both arms and heats
identically (+5.3 vs +5.5 °C) — the transcript cannot help a conversation's first turn, and that
bound belongs in any claim made from this table.

⚠️ **Turn 6 is a new failure mode, and it is not the empty think block.** `n_common=1648` against a
cached 1649 — **one token**. The KV ends with the `.` closing "Per favore, usa un formato JSON
valido." and the fresh prompt continues differently from there. On a hybrid KV a single mismatched
token is not roundable off: no rollback exists, so the whole 1648-token prefix is discarded and the
turn costs 111.7 s. Same physics as §7.5, new cause, **undiagnosed**. Candidates worth checking in
order: the history-content cap (§7.7 records 4000 chars, 2000 when the turn carries an image), the
end-of-turn suffix capture at a join boundary, and post-processing of a miniapp/JSON payload before
it is stored. Until it is found, the feature's saving is real but intermittent — and note it stayed
at `Thermal Status` 0 even through that 111 s turn.

#### 7.7h On battery: the prefill saving is real and measured; the thermal claim is NOT established

**2026-08-17, unplugged, wireless.** The control arm ran four clean turns (§7.7g). The treatment
arm did not: three attempts, each killed by `model.unload {"reason":"background"}` fired when the
`kalsa://share?text=` deep link's `am start` briefly backgrounds the app. On the charger the same
share survived four turns; unplugged it kills the run after the first. **The blocker is now the
harness's input path, not the feature.**

What the partial arm did establish, from `pid 7148`:

| | control (OFF) | treatment (ON) |
|---|---|---|
| turn 1 wall | 98 s | 114 s |
| turn 1 prefill | full, `n_past=0` | full, `n_past=0`, `promptMs=76611` |
| turn 1 heating | 30.8 → 36.1 °C (+5.3) | 31.4 → 36.7 °C (+5.3) |
| turn 2 prefill | ~80 s re-prefill, `n_past=0` | **`promptMs=4344`**, `n_common=1322=embd`, `n_past=1322` |

1. **The first turn is not helped, and heats identically** — +5.3 °C in both arms. There is no
   cache to reuse when a conversation opens, so opening one stays expensive whatever we do. Worth
   stating because it bounds the feature's reach: this helps conversations, not cold starts.
2. **The boundary prefill is 4.3 s against ~80 s**, on battery, at ~1350 tokens. That is the
   saving §7.7f predicted from `n_past`, now in seconds rather than token counts.
3. **The thermal prediction of §7.7g is untested.** The one append-only turn was interrupted
   (`interrupted:true` after 34 s of decode on a mini-app payload), so its +0.2 °C is not
   comparable work and must not be quoted as evidence. Whether removing the re-prefill opens the
   thermal loop remains **open**.

Next step is a harness fix, not a code change: a way to deliver a turn that never backgrounds the
app, so the treatment arm can run four to six turns unplugged. Until then the latency result stands and
the thermal result does not exist.

#### 7.7g The thermal loop is a product defect, not a bench nuisance (Marco, 2026-08-17)

§7.6 treats heat as something to defend the measurements *from* — pause the arm, wait for LIGHT,
resume. That framing hides the real problem, and Marco named it: *"nell'utilizzo normale l'user
può scrivere parecchio e la temperatura/batteria seguono di conseguenza."* There is no thermal
gate in the product. A user who keeps typing simply gets a phone that gets hotter and an app that
gets slower.

The control arm measured the loop closing, on an unplugged phone from a cold start:

    turn      1      2      3      4        5
    wall     98s    91s    94s    94s     not sent
    temp   30.8°  36.1°  38.4°  40.5°     41.5°
    thermal   0      0      2      2         3 (SEVERE)

Four turns of ordinary chat — ~1300-token prompts, one-line answers — took the phone from cold to
SEVERE and burned 5% of the battery. The mechanism is not mysterious: a full re-prefill processes
the entire prompt in parallel, which is the most power-dense thing this workload ever does, and
§7.5 established that the cache is discarded and re-prefilled **every single turn**. So each turn
pays maximum wattage, the phone heats, throttling stretches the next turn, and a longer turn heats
it further. **The 390 s of §7.1 was never a typical turn — it was a late turn on a phone already
cooked by the ones before it.**

This reframes what the append-only transcript is worth. Not "saves ~90 s per turn" — that is the
visible symptom. It removes the heat source that drives the loop: 29 tokens prefilled instead of
1298 (§7.7f) is a change in *power drawn*, not only in seconds spent. The prediction to test is
therefore thermal, and it is falsifiable: with the toggle on, a four-turn arm should end far below
the control's 40.5 °C and should not reach `Thermal Status` 2. If it heats the same way, the
feature is a latency optimisation and nothing more.

Note what this does to the numbers everyone quotes. "A turn costs 390 s" is not a property of the
model; it is a property of a prompt length *and* a thermal state. The control above costs ~94 s at
~1300 tokens from cold. Any latency figure taken from this project must carry both, or it will not
reproduce.

#### 7.7f MEASURED: the cache survives a turn boundary — first time since the investigation opened

**2026-08-17, S23, APK `3a3a15f`, `kalsa.bench.kvtranscript=1`.** Arm A **PASSES** both halves of
the §7.7 criterion at every in-process boundary, and the control arm shows the divergence, so the
zero is not a dead arm.

| boundary | arm A (`kvtranscript=1`) | arm B (control, key absent) |
|---|---|---|
| 1→2 | `embd=1298 text_tokens=1327 n_common=1298` → `n_past=1298` | `embd=1298 text_tokens=1314 n_common=1285` → `n_past=0`, full clear |
| 2→3 | `embd=1353 text_tokens=1397 n_common=1353` → `n_past=1353` | cache already discarded (`stale_kv_completed_turn`), `n_past=0` |
| `KALSA_KVDIVERGE` | **absent, count 0** | present, `embd_ids=[248068 271 248069 271 …]`, `embd_txt=[<think>\n\n</think>\n\n…]` |

`n_common` equals the cached size at both boundaries — the whole prefix is reused, not most of
it — and the engine resumes at `n_past=1298` instead of 0, so **29 tokens are prefilled where
1298 used to be**. The control reproduces the §7.5 signature byte for byte, two days after it was
first measured: same four ids, same empty think block, same full cache clear.

Transcript ops in arm A, in order: `rebuild/fresh` → `append_gen` → `session_restore` → `delta` →
`append_gen` → `session_restore` → `delta` → `append_gen`. Every save `ok:true`; the only refused
load is turn 1's `meta_mismatch:conversationId`, which is a fresh conversation and expected. Arm B,
by contrast, refused two saves with `kv_not_reproducible`.

**The number that vindicates removing `seed_mismatch`**: at the 1→2 boundary the seeded transcript
is `tLen=5582` while `prevLen=5532`. `T` and `pPrev` **disagree by 50 characters** — the
as-generated past versus the as-history ruler — and the append still produced total reuse. A guard
requiring `T === pPrev` would have rebuilt here and turned this result into another re-prefill.
`pPrev` measures what is new; it is not a claim about what is cached.

Wall-clock, **not a measurement** (the phone was charging): ~5 s of decode after restore in arm A
against ~90 s of re-prefill in arm B. Quotable numbers need an unplugged phone and §7.6's thermal
gate.

**What this does and does not establish.** It establishes that an append-only raw prompt is
reused across a real turn boundary on a hybrid model, which is what four earlier attempts failed
to show. It does not establish durability: two boundaries, three turns, text-only, tool-free, no
images, well inside an 8192 context, and one run. The 30-turn regime, the tools phase and the
memory campaign are all still ahead, and the production blockers in §7.7e remain open.

#### 7.7e Route 2 implemented behind a toggle, and what two hostile audits left standing

**2026-08-17, uncommitted working tree.** The append-only transcript is built: `T` holds exactly
what entered the KV, each turn's delta is the difference between **two consecutive history
renders** (never history-vs-generation, which is the pair that diverges), and the completion is
issued as `completion({ prompt: T })` with `messages` omitted — mandatory, because
`node_modules/llama.rn/src/index.ts:795-816` overwrites `prompt` with the jinja render whenever
`messages` is present. New: `src/engine/kvTranscript.ts`, `src/engine/kvTranscriptFormat.ts`,
plus tests; wiring only in `LlamaService.ts`; bench toggle `kalsa.bench.kvtranscript`, default
OFF, production byte-identical when off.

The end-of-turn suffix is captured **without hardcoding any template's tokens**: render the
message list twice, once plain and once with a trailing assistant message containing a control
marker, and take the bytes after the marker. That was the objection which killed the template
override in §7.5, and this sidesteps it.

**Two audit rounds, both hostile, both by a different model than the author.** Round one
rejected the code with three CONFIRMED P1s, all one family — `T` advancing without the engine
having accepted the prompt: it was mutated sixty lines before `engine.completion`, an OFF turn
or an aux `clearCache` left a stale `T` that a later ON turn appended to, and dispose could
resurrect a reset transcript. All three are now closed and re-verified: the commit moved into a
closure invoked *after* the awaited completion, every non-transcript writer of the KV resets
`T`, and an epoch counter rejects stale commits.

Round two **refuted** the follow-up hypothesis I had proposed (that a commit erases the
`untrusted` mark — it does not; `pendingRebuild` survives the commit and is consumed by the next
rebuild decision) and found three that still stand:

| open blocker | why it matters |
|---|---|
| `truncated` / `context_full` are never checked before commit (`JSICompletion.h:168-175`; with `ctx_shift:false` native returns `context_full` *before* accepting the prompt, `rn-completion.cpp:410-417`) | commits a `T` the KV never accepted — the exact silent-divergence class this feature exists to kill |
| no `bailIfStopped()` between the async formatting/EOT capture and `engine.completion` | an abort or dispose during formatting still launches a completion |
| image state is not represented in `T` (a string) while `media_paths` is a separate native param | an image turn followed by a text-only turn diverges with no rebuild reason |

Lesser, confirmed: `commitHash` is a 32-bit DJB2 with trivial same-length collisions (`"BA"` /
`"Ab"`), so it is a smoke alarm and not an integrity check; `computeCandidatePrompt` is
documented pure but consumes `pendingRebuild`; and the tests exercise the transcript module's
protocol but never `LlamaService`, so several of them would still pass if the service-side fix
were reverted.

Those blockers were then fixed and re-audited. A third round split the verdict the way it should
always be split:

> **(a) bounded phone experiment: YES**, narrowly — fresh session, toggle enabled before engine
> init, three short text-only tool-free turns well below `n_ctx`. Measurement, not certification.
> **(b) production: NO.**

**Two P1s still stand, both found by reading the engine's C++ rather than our TypeScript:**

1. **A non-throwing `llama_decode` failure sets none of the three refusal flags.** On decode
   failure native trims the token list to what memory actually holds and returns a *normal*
   result — `embd.resize(n_past); has_next_token = false; return result;`
   (`rn-completion.cpp:1090-1102`), and `JSICompletion.h:168-175` copies only `truncated`,
   `context_full` and `interrupted`. Our gate (`kvTranscriptDelta.ts:121-130`) checks exactly
   those three, so a clean-looking result commits a transcript containing tokens the KV does not
   have. Thrown errors are safe — the outer catch marks untrusted — so the hole is precisely the
   *silent* decode failure, during prefill or mid-generation.
2. **The `media` mark does not survive session save/restore.** The save gate
   (`LlamaService.ts:1200-1205`) never inspects `pendingRebuild`, so an image turn can be saved
   with `media` pending; on restore native keeps its media placeholders (`JSISession.h:61-64`)
   while the returned prompt strips them — re-authorising a KV state the transcript does not model.

**Neither can fire in the controlled acceptance test** — three text-only, tool-free turns of
~1800 tokens against an 8192 context, no images, no session restart. So the measurement runs
first: the design's core premise, that an append-only raw prompt yields
`n_common == embd.size()`, has never been measured, and hardening a design whose premise is
unverified is how a night gets wasted. These gate **shipping**, and they stay open until fixed.

**Two process notes worth as much as the findings.** A green `npx jest` is not evidence the
branch builds: `apk.yml:58` runs `npm run typecheck` first, and `tsc` grants jest's globals only
to `*.test.ts`, so a suite split into `.cases.ts` files ran under jest and failed CI. And there
is no local Android build on this machine — no JDK, no SDK — so every device APK comes from
`workflow_dispatch` on a pushed branch, roughly 40 minutes each. Measuring is a push-and-wait
loop, not a twenty-minute one; plan the night accordingly.

#### 7.7c A third road nobody had looked at: the checkpoint budget is a knob, and we never set it

**2026-08-16.** §7.5 ends on "one checkpoint exists — at 1712; the position needed is 1646", and
treats that as a fact of nature. It is not. `NativeContextParams` (`types.d.ts:36`) exposes two
parameters, and **Kalsa sets neither** (`grep` over `src/` returns nothing):

```ts
/** Memory budget (MiB) for the cross-turn KV prefix cache on recurrent/hybrid
 *  models. 0 disables it; no-op on pure-attention models. Default 160. */
state_cache_budget_mb?: number;          // types.d.ts:166
/** Max snapshots to keep (secondary cap; the byte budget is primary).
 *  0 = no count cap. Default 8. */
state_cache_max_checkpoints?: number;    // types.d.ts:171
```

So llama.rn ships a cross-turn KV prefix cache built specifically for recurrent/hybrid models,
enabled by default, allowed up to **eight** snapshots — and the device observed exactly **one**
(`KALSA_KVDIAG … checkpoints=[1712,]`). Either the 160 MiB byte budget is the binding constraint
for a hybrid 4B state, or snapshots are taken on a spacing rule; which one is unmeasured.

⚠️ **Tempering datum, from two runs a day apart**: the single checkpoint sits at **exactly** the
end of the restored state, both times — `embd=1712 → checkpoints=[1712,]` (§7.5) and
`embd=1814 → checkpoints=[1814,]` (§7.7d). Two for two is a pattern, not a coincidence: it
suggests the checkpoint is produced by the session save/restore path, not by prefill progress. If
that holds, raising `state_cache_max_checkpoints` alone changes nothing, because nothing is
creating intermediate snapshots to keep — the byte budget would only matter once something does.
That is the first thing the experiment must distinguish, and it is why this road is worth one
build rather than being assumed to work.

Why this matters: a checkpoint at or before the divergence point would let the prefix be reused
**without touching the template at all**. It changes no model behaviour, costs no thinking
tokens, grows no context, and arms no privacy defect — unlike the polarity flip in §7.7b. It
does cost one build, because context params are set at init, whereas the polarity flip costs
none. That ordering is why the polarity test runs first, not because it is the better fix.

The existing instrumentation already prints the checkpoint list, so the experiment reads itself:
raise the budget, see whether `checkpoints=[…]` gains entries and whether one lands at ≤ the
`n_common` of the turn.

**Prior art (web research, 2026-08-16, primary sources).** Findings that bear on the three roads:

1. **The asymmetry is a known, open upstream defect** — Qwen3 issue #1826 describes exactly this
   `<think>\n\n</think>\n\n` generation suffix missing from history rendering, and proposes adding
   the `enable_thinking is false` branch to historical assistant messages. Qwen3.6 issues #48 and
   #131 repeat the diagnosis and are closed **without a linked upstream PR**. The official
   Qwen3.5-4B `chat_template.jinja` still shows the asymmetry. On the llama.cpp side, #20182 and
   #21511 are both closed as *not planned*. **Conclusion: no upstream fix is coming; this is ours
   to work around.** Not independently verified beyond the report — treat as strong lead, not fact.
2. **Nobody keeps a template-agnostic append-only transcript.** The closest is llama.cpp's
   `simple-chat` example, which renders the full message list each turn and feeds only the newly
   rendered suffix by slicing from `prev_len` — the right mechanism, but still exposed to exactly
   our drift, since a re-render that changes earlier bytes moves `prev_len`'s meaning. MIT, so
   borrowable. Ollama's tokenised `context` handoff is the cleanest token-level design and is
   **deprecated**.
3. **Upstream position on hybrid rollback**: a recurrent state is not erasable at an arbitrary
   prior position; rollback is possible only at saved checkpoint boundaries, and llama.cpp added
   `--ctx-checkpoints` / `--checkpoint-min-step` for exactly this. This is the upstream sibling of
   the `state_cache_*` knobs above, and it corroborates that checkpoint density is the lever.
4. ⚠️ **A second, independent mechanism we had folded into the first**: llama.cpp issue #25913
   reports that disk slot save/restore serialises tokens and sequence state **but not the context
   checkpoints**, so a restored hybrid slot can report every token restored and still re-prefill
   them. That is precisely the shape of our own log — `{"op":"load","ok":true,"tokens":1736}`
   followed by `n_past=0`. §7.5 attributes the whole cost to template divergence; if #25913
   applies to this stack, then fixing the template fixes the **within-session** turn boundary and
   leaves the **restore-after-restart** path still paying full price. Unverified against this
   engine, and it must be checked before anyone declares the 390 s closed.

**Known remaining divergence, narrower than what was fixed**: `content` is still capped, and the cap
changes with context — 4000 chars normally, 2000 whenever the current turn carries an image, applied
to *every* history message. A conversation that gains an image mid-way re-truncates its own history
shorter and diverges again. Assistant turns are immune now (their replay text is uncapped); the
exposure is long user messages. Not chased yet.

**Also true and not yet decided**: the emitted text is the raw model output, so with thinking
enabled it stores reasoning the UI deliberately hides, in plaintext, for the life of the
conversation. Two audits traced every consumer and found no cross-boundary leak — exports, share,
clipboard, notes, conversation index, digest corpus and telemetry all read `text` — with one
exception worth fixing: `scripts/ci-dflash-ab.sh:235-238` dumps the whole message row into bench
artifacts. With thinking **off**, which is the bench default, the emitted text differs from the
cleaned text only by the four empty-block tokens, so there is nothing hidden to expose.

## Change log

| date | change |
|---|---|
| 2026-08-14 | First version. Conclusions from campaigns `31739205810` and `31760516762`. 4B campaign `31807501488` launched; memory instrumentation and a hostile audit of `cc703e6`/`aa2f350` in flight — **both may change §1.3 and §3**. |
| 2026-08-14 | **§1.1 retracted and rewritten.** Measured the gate rule offline: it blocks legitimate searches (a good query paraphrases the question, scoring 0.39-0.68) and passes spurious ones (0.15). The 2/96 web-turn figure is the gate refusing, not the model abstaining. Added §3.5: with memory on, the same 0.18 threshold blocks ordinary Italian queries ("ricetta pasta al forno" = 0.182). Both are shipping blockers. |
| 2026-08-14 | Hostile audit of `c93d163` on an isolated worktree. §1.3 confidence raised — both fabrication routes closed with quoted code. Added §3.7: three suites shipped ungated by CI, a harness that could not fail, and a NOT-RUN verdict that would have failed the next campaign — all fixed. Identity leak past the containment guard still open; the first fix attempt was reverted for adding a language wordlist that blocked ordinary German and Spanish queries. |
| 2026-08-15 | **The `tools` phase had four defects and had never been dispatched once** (§3.7, fixed `6516b3e`): the phase guard rejected it outright, its prompts were the only non-ASCII ones in any turn plan (it would have died at turn 3), its graders scored a blank bubble as a correct abstention, and a single gated arm could not separate model from rule — now a gate/nogate pair. Job timeout 300 → 350: in `31807501488` the cap, not the model, decided the 4B sample size. Three campaigns dispatched: memory smoke on the settled telemetry, the `tools` pair, and the 4B at 10 seeds. |
| 2026-08-15 | **§6 item 1 corrected within the hour it was written.** I claimed the device APK might be built without the native patches because `apk.yml` does not set `KALSA_LLAMA_FROM_SOURCE`. The hostile audit refuted it from the plugin source: `withLlamaFromSource.js:34` is opt-out (`=0`), so source-build is already the default and the env is decorative — in `bench.yml` too, whose comment states the same inverted claim. The real gap was that `apk.yml` never ran `assert-native-patch.sh`: a missing verification, not a broken build. |
| 2026-08-15 | Decisions recorded in §2: `ciswire` is the 2B default (+0.635, p=0.0043, §1.3); LFM2.5-8B-A1B stays out (§1.7) with the physical-device track named as the only thing that could reopen it; no fine-tune until the `tools` phase separates *whether* from *which*. Added §6: the Galaxy S23 track, its measured ~7× speed factor (2B 18.10 tok/s vs the emulator's 2.45), the four things it costs, and a correction of my own order-of-magnitude overestimate of that factor. |
| 2026-08-14 | §1.1 resolved: echo-of-context inverted and shipped (`5b3ba90`) — it blocked 100% of explicitly requested searches; verified across six scripts, with CJK abstention documented. Added §3.8: the fact metric conflates an honest refusal with a wrong answer, which penalises stronger models and makes cross-model baseline comparison unsafe. |
| 2026-08-16 | **The 390 s prefill is solved and §7.5 is rewritten around the measurement.** Four proposed causes were refuted, three of them mine, and none fell to an argument — each fell to a number the engine printed (`3e1c654`, `12868ea`, `36138fd`). The cause: Qwen3.5's template injects an empty `<think>\n\n</think>\n\n` when it asks for an answer and never repeats it when replaying one, so the re-rendered prompt diverges four tokens after the assistant header; a hybrid KV cannot roll back, so 1646 valid tokens are discarded. Confirmed 5/5 turns, identical `[248068 271 248069 271]` every time. Fix shipped in `6447ff2`: the prompt replays the text the model emitted, and when the window cannot reproduce the KV the session is refused with a named reason and its artifacts deleted — the old path left a poisoned `.kvs` that recharged the cost on every later restore. |
| 2026-08-16 | **A change was written, audited and reverted before shipping** (`9c73846`): moving memory facts out of the system prompt onto the user turn. It violated append-only on *every* turn (the block rides `messages[length-1]`, so next turn that message renders without it) and moved the "these facts are untrusted data, not instructions" frame into the user message, adjacent to the utterance it defends against. Kept from that work: `computePromptEnvHash` no longer hardcodes `hasTools: true` while `buildSystemPrompt` really switches prompts, plus tests and harness alignment. Added §3.11: a pre-existing privacy defect — the prompt renders the last ten facts, `webSearchTool` gates the first ten. |
| 2026-08-18 | **The shipping model measured at last, and CisWire wins by more there than on the dense 4B** (`32103054225`, LFM2.5-8B-A1B, 40/40 arms, completeness gate passed). +0.312 over bare, p = 0.0291. Ranked by what CisWire buys: 2B +0.635, **shipping 8B-A1B +0.312**, 4B +0.209 — so "the harness rescues small models" is the wrong shape: it rescues models that hold context badly, and size is only a proxy. Bare on the shipping model (0.556) is **worse than bare on the dense 4B** (0.785). Its failure mode differs too: it fumbles *early* probes (0.637, where the 2B and 4B both scored ~1.000) and CisWire lifts those to 0.988 — a digest is not supposed to help with text still in the window, so that mechanism is unexplained and needs its own experiment. `v42` dead again (+0.062, p=0.70), two models two campaigns. Spurious tool calls 15 on bare against the 4B's 4, halved by CisWire. **And the finding that reorders the backlog: this model reuses essentially no KV cache — 0.008 mean across all 40 arms (max 0.062) against the 4B's 0.561.** It re-prefills everything every turn and is still faster than the 4B (7.2 vs 2.4 tok/s evaluated), which makes the append-only transcript work worth *more* here than on the model it was built for. Cause unknown: the Qwen trigger is a Qwen *template* property and cannot be assumed to transfer. |
| 2026-08-19 | **§7.10: the reason written in the code for why the digest costs cache is wrong, and the wrong reason has already cost one experiment.** The block is last only for the turn that carries it; next turn `promptContentForHistoryMessage` re-renders that user message clean (`modelEmittedText.ts:16-23` replays assistant messages only), so the last stable token falls back past the block, past that user turn, and past **the reply generated after it**. The cost is therefore per *injection*, not per *change of content* — which is precisely why the 2026-08-03 freeze, which held content still and kept injecting every turn, could only measure zero prefill saved. `compactor.ts`'s header and `RESEARCH_CONTEXT_LOSS.md:157` both carry the old reasoning; the header is corrected in place. Instrument written, **result not**: `parseBenchDigestCadence` + `shouldInjectOperativeBlock` (8 unit tests), `getBenchDigestCadence`, `DIGESTCADENCE` in `ci-bench.sh` with the both-branch assert, `digestcadence` workflow input, pref visible in `prefs.txt`. Empty/1 = production, untouched. Acceptance criterion fixed before the run: cache must rise *and* the loss must concentrate on injection turns, *and* recall must be reported alongside — cadence trades cache against exactly the staleness the freeze revocation measured at 33.3 % vs 100 %, so a cache win alone does not ship. |
| 2026-08-18 | **The 4B campaign landed and CisWire holds: +0.209 over bare, p = 0.0108** (`32048465417`, 38 usable arms, permutation tests). §3.2's prediction was right — the effect shrinks, from +0.635 on the 2B, because bare climbs 0.313 → 0.785 while ciswire goes 0.948 → 0.994 with sd 0.083 → 0.019. What survives is entirely **distance**: the 4B is perfect on recent facts and loses over half the distant ones (0.446 late), ciswire loses none (1.000). Three things nobody predicted: **`v42` dies** on the stronger model (+0.040, p=0.70, against +0.354 p=0.043 on the 2B); **`nogate` reverses**, 0.094 on the 2B against 0.944 on the 4B, which is the hardest evidence yet that harness decisions are model-dependent; and **§1.5's token saving does not reproduce** — history length is identical across arms, so on the 4B the digest is pure cost, +350 prompt tokens at turn 13 and ~95 s more prefill per turn. §3.1's blocker did not reproduce either: zero blank bubbles across all 38 arms. Two arms died on the 2400 s per-turn cap, both **untreated** (bare writes longer replies, so it reaches the cap first), so `baseline` and `nogate` are n=9 and the completeness gate correctly refused to publish. |
| 2026-08-17 | **§7.7j: the join is closed, and the diagnostic that proved it refutes my own acceptance criterion** (`b31fb53`). Six turns unplugged from the coldest start yet (27.9 °C): 103 s then **31, 32, 32, 32, 31** — turn 6 was 151 s in §7.7i. One `rebuild` in the session (`fresh`, turn 1), `KALSA_KVDIVERGE` zero, five consecutive boundaries reused against two, `Thermal Status` 0 throughout, 2 % battery for six turns. `glueEot` fired at every boundary (`glue=11`), which was the fix's whole job. **But the 48-char seam windows show `T` ending with the reply in generation form and the delta restarting from the same reply in history form: every assistant turn is in the prompt twice.** Not caused by the glue and not a deep-link artifact — `kvTranscript.ts:157` builds `T` from `candidate + emitted + suffix` and `candidate` ends with the empty think block, so the ordinary path duplicates too; §7.7i had it without the glue between the copies. The criterion I fixed before measuring — no divergence, `n_common == embd.size()` — is **true with the duplicate in place**, because `T` stays a valid prefix however malformed its content: it measures reuse, not correctness, and all six replies read fine. Latency result stands, correctness result does not, **route 2 does not merge**. Suspect is `cutPPrevFromRolePair` (`kvTranscriptFormat.ts:130`): `pPrev`=5532 against a turn-1 prompt of 5551, short by exactly the 19 chars of `<think>\n\n</think>\n\n`. |
| 2026-08-17 | **§3.11 closed by reading the code, not by fixing it: the privacy gate was never inspecting the wrong facts.** The two slices genuinely disagree on their face — prompt takes `slice(-10)`, `webSearchTool.ts:88` takes `slice(0, 10)` — but the array reaching the gate is capped upstream at `AppShell.tsx:2348`, so the second slice is the identity, and `:4485` hands the gate **the same array object** `:4724` sends to the engine. The 2026-08-16 row below calls it "a pre-existing privacy defect"; that was wrong, and this row is the correction. What survives is a latent trap: the guarantee rests entirely on the upstream cap, so raising it — or sourcing `getMemoryFacts` from `MemoryStore.listFacts()` — silently splits the two sets with nothing failing. |
| 2026-08-17 | **§7.7f: MEASURED PASS — the KV survives a turn boundary for the first time** (`3a3a15f`). Arm A: `n_common` equals the cached size at both boundaries (1298 and 1353), `n_past` resumes at 1298 instead of 0, `KALSA_KVDIVERGE` count zero. Control arm reproduces §7.5's signature exactly — same `[248068 271 248069 271]`, same full clear — so the zero is not a dead arm. 29 tokens prefilled where 1298 used to be. Four earlier attempts failed for reasons worth keeping: thinking-polarity refuted by measurement; a run invalidated by an app restart and by tools left on; then `prefix_mismatch` at every boundary, whose cause was the template rendering the last assistant differently when it is final — §7.5's asymmetry biting the delta computation this time — fixed by rendering the previous state with a trailing sentinel and cutting at the longest common prefix of a user-probe and an assistant-probe render. Also settled: `T` and `pPrev` differ by 50 chars at the passing boundary, which is why the `T === pPrev` guard had to go — `pPrev` is a ruler for what is new, not a claim about the cache. Not durability: two boundaries, one run, text-only, no tools, no images, inside 8192 ctx, and §7.7e's production blockers still open. |
| 2026-08-17 | **§7.7e: route 2 built — the prompt is ours now, behind `kalsa.bench.kvtranscript`, off by default** (`9d92f5f`, `934954c` on `bench/kvtranscript-probe`). `T` holds what entered the KV; each turn's delta is the difference between two consecutive *history* renders, never history against generation, which keeps it template-agnostic for LFM2.5 and gemma. `messages` must be omitted or llama.rn overwrites `prompt` with the jinja render (`src/index.ts:795-816`). The end-of-turn suffix is captured with a marker-bearing dummy assistant message — no template's tokens hardcoded, which was the objection that killed the override. Every untrustworthy path rebuilds with a **named reason**; the silent re-prefill is the defect, the declared one is correct behaviour. **Three hostile audit rounds by a different model than the author**, which found in order: `T` advancing sixty lines before the engine saw the prompt; stale `T` after OFF and auxiliary turns; dispose resurrecting a reset transcript; then, by reading the engine's C++, that `context_full` is returned *before* the prompt is accepted under `ctx_shift:false`; and finally that a non-throwing `llama_decode` failure sets no flag at all while trimming the token list. Rounds one and two are closed and re-verified; round three authorises **the bounded phone experiment but not production**. Also refuted along the way: my own hypothesis that a commit erases the untrusted mark. |
| 2026-08-16 | **§7.7d: thinking ON measured on the device and REFUTED, at zero build cost.** Flipping the polarity does remove the empty think block, and replaces it with its mirror image: the KV holds the reasoning the model emitted, the re-rendered prompt holds the cleaned answer, because the template's history branch strips the think block. `n_common=1616` against `embd=1814` / `text_tokens=1747`, one `KALSA_KVDIVERGE`, full clear, `n_past=0`. `modelEmittedText` was persisted and preferred correctly, so the defect is not on our side: **the template will not re-render history to match the KV in either polarity**, and route 1 of §7.7 is dead in both directions. Engine proven to have run (turn 1 `n_common=0`, saves at messageCount 2 and 4, visible reply). Also recorded: the single checkpoint sat at exactly the end of the restored state in both this run and §7.5's, which suggests checkpoints come from session save/restore rather than prefill progress — tempering §7.7c before a build is spent on it. Device left at `kalsa.bench.thinking=budget512` with the chat wiped; revert before quoting any campaign. |
| 2026-08-16 | **§7.7c: a third road, found by reading the engine's own type declarations — the hybrid checkpoint budget is a parameter, and Kalsa has never set it.** `state_cache_budget_mb` (default 160 MiB) and `state_cache_max_checkpoints` (default 8) are `NativeContextParams` fields (`types.d.ts:166,171`) documenting a cross-turn KV prefix cache built for recurrent/hybrid models; `grep` over `src/` finds neither. The device observed **one** checkpoint where eight are permitted. A checkpoint at or before the divergence point would restore reuse **without touching the template**, changing no model behaviour and arming no privacy defect — it costs one build, which is the only reason the zero-build polarity test of §7.7b runs first. Web research the same day (primary sources) adds: the asymmetry is open upstream as Qwen3 #1826 with no fix coming (Qwen3.6 #48/#131 closed with no PR; llama.cpp #20182/#21511 closed as not planned); no mainstream wrapper keeps a template-agnostic append-only transcript; and — the part that may matter most — llama.cpp #25913 reports that disk slot restore does not serialise context checkpoints, so a restored hybrid slot reports all tokens restored and re-prefills anyway. If that applies here, fixing the template closes the turn boundary and leaves the restore-after-restart path still paying full price. Unverified against this engine; check before declaring the 390 s closed. |
| 2026-08-16 | **§7.7b: the "template symmetry" route was refuted by reading the code, before any build was spent on it.** The flags it proposed setting — `enable_thinking`, `chat_template_kwargs` — are already set to `false` on the production path (`thinkingBudgets.ts:45-58,75-86`, spread at `LlamaService.ts:2000`), and that is precisely why the template injects the empty think block. The corrected route is the opposite polarity (Marco): run with thinking **enabled**, so there is no empty block to inject and the real reasoning block — genuine model output — is replayed by the machinery already shipped in `6447ff2`. It costs **zero builds**: `thinkingMode` is a persisted setting (`benchConfig.ts:155-163`) and the on-device APK already supports `budget512`. Four costs recorded before measuring (context at `engineCtx` 8192, `nPredict` squeeze, an armed privacy defect in `ci-dflash-ab.sh:235-238`, stream shape), plus Marco's correction that compaction is an event rather than a per-turn rewrite. Three citations in route 2 corrected on disk: `types.d.ts:540` is `NativeSessionLoadResult`, not a completion input; `prompt` is reachable from JS only because `CompletionBaseParams` re-adds it (`index.d.ts:65,91`); `generation_prompt` is both an input (`types.d.ts:216`) and a `getFormattedChat` result (`:565`). |
| 2026-08-16 | **Two hostile audits, and the second one earned its cost by refuting rather than adding.** Run at max reasoning against the first auditor's findings, it confirmed three, **refuted four** (the atomicity race I had suspected reconciles in every direction at boot; the `undefined` key is a red herring; no new leaks), and corrected two of the first auditor's citations. It also found the reachable case the first had missed: the replay cap is **2000** chars, not 4000, whenever the current turn carries an image, applied to every history message. Implementing on the first audit alone would have written code for a race that does not exist and shipped the truncation defect that re-introduces the whole 390 s. |
