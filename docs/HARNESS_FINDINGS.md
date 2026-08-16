# Harness findings — what we know, how well we know it

Living document. **Update it every time a review lands or new data arrives**, including when a
finding is weakened or refuted. The change log at the bottom is not optional: a conclusion that
silently changed is worse than no conclusion.

Goal it serves: make Kalsa's harness better than a bare sliding window on an on-device chat —
tool calls, context that survives, memory.

Last updated: 2026-08-15 · Evidence: campaigns `31739205810` (window 10), `31760516762`
(window 16) and `31861056717` (window 16, every 2026-08-14 defect fixed), Qwen3.5-2B, 6
seeds/arm, 16-turn conversations, Italian, CI emulator.

**In flight, dispatched 2026-08-15 22:20 UTC on `6516b3e`:** `31910747849` (memory smoke, the
first measurement with the settled telemetry of `bf3794d`), `31911860830` (the `tools` phase,
gate/nogate pair — never executed before today), `31911872610` (Qwen3.5-**4B**, fase4, **10
seeds**, window 16). Nothing below is revised for them yet.

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

### 1.7 LFM2.5-8B-A1B: do not ship it — the MoE discount does not apply to prefill

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
7. **Do not ship LFM2.5-8B-A1B — DECIDED 2026-08-15** (§1.7). It loads fine — memory was never
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

### 3.6 LFM2.5 tool calls never parse — production bug, whole family

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
dialect is why nobody looked. Fix dispatched.

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

## 3.11 The privacy gate inspects a different fact set than the prompt exposes

Found by hostile audit 2026-08-16 while reviewing an unrelated change; **pre-existing, not
introduced by it**, and not yet fixed.

- the prompt takes the **last** ten facts — `.slice(-MAX_PROMPT_FACTS)` in the fact renderer;
- `webSearchTool.ts:88` passes `memoryFacts: facts.slice(0, 10)` — the **first** ten — to the check
  that decides what may leave the device.

So with more than ten durable facts the two sets can be disjoint: the gate clears facts the prompt
never shows, and the prompt shows facts the gate never saw. A setting that means "where do I send
traffic" must never quietly also mean "you may upload the user's content", and a consent check that
inspects the wrong list is exactly that failure in slow motion.

Not fixed here because it is orthogonal to the prefill work and deserves its own change plus a test
that constructs eleven facts and asserts both sides agree.

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
an empty composer.

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

Prime suspect for those 66 tokens — **stated as a hypothesis, not a finding**: the Qwen3.5 chat
template retroactively strips `<think>` blocks from earlier assistant turns (the sibling repo's
`preserve_thinking` fix, which does not exist in this template). A `KALSA_KVDIVERGE` diagnostic
printing the tokens on both sides of the divergence is queued to settle it by measurement.

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
