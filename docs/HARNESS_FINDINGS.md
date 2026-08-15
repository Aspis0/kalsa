# Harness findings — what we know, how well we know it

Living document. **Update it every time a review lands or new data arrives**, including when a
finding is weakened or refuted. The change log at the bottom is not optional: a conclusion that
silently changed is worse than no conclusion.

Goal it serves: make Kalsa's harness better than a bare sliding window on an on-device chat —
tool calls, context that survives, memory.

Last updated: 2026-08-14 · Evidence: campaigns `31739205810` (window 10) and `31760516762`
(window 16), Qwen3.5-2B, 6 seeds/arm, 16-turn conversations, Italian, CI emulator.

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

### 1.3 `ciswire` mode beats both bare and `v42`

Primary endpoint = per-conversation mean of early and late fact recall. Window 16 (the graded
regime, where bare still has partial access — not the floor):

| arm | n | early | late | **mean** | sd |
|---|---|---|---|---|---|
| `off` (bare) | 6 | 0.563 | 0.563 | **0.563** | 0.409 |
| `ciswire` | 6 | 0.938 | 0.979 | **0.958** | **0.051** |
| `v42` | 5 | 0.550 | 0.500 | **0.525** | 0.095 |

- `ciswire` vs bare: **+0.396, p = 0.0249** (exact, 924 assignments, unit = conversation)
- `ciswire` vs `v42`: **+0.433, p = 0.0043** (exact, 462)
- `v42` vs bare: −0.037, p = 0.60 — **indistinguishable from doing nothing**

The strongest signal is not the mean but the **variance**: `ciswire` sd 0.051 vs bare 0.409. It
is not just better on average, it is reliable.

**Confidence: medium-high.** One model, one language, n=6, emulator — but a hostile audit of
the code that produced it (commit `c93d163`, isolated worktree) closed the two ways it could
have been fabricated:

- *"the baseline kept 20 messages while the treatment got 16"* — **cannot occur**: one read per
  turn, two symmetric consumers, no third assembly path.
- *"a fact reaches the digest before the probe that asks for it"*, i.e. the treated arm reading
  the answer out of its own digest — **no such path exists**.

One audit concern was checked against the data and does not apply: blank-reply probes are
excluded from denominators, and the treated arms have ~2× the blanks, which could inflate them.
On the primary pair **neither arm had a single fact probe excluded** (92/96 either way). It does
flatter `v42`, which drops 0.525 → 0.438 if exclusions counted as misses — so §1.3's "v42 adds
nothing" is if anything understated.

### 1.4 What the three modes actually do

- **`off`** — last 20 messages verbatim (8 with images), each capped at 4000 chars. Anything
  older is gone.
- **`v42`** — **shrinks** the verbatim window to ~6 recent messages (boundary advances every 3
  user turns) and compensates with a BM25 digest of the older corpus **plus a rolling LLM
  summary**.
- **`ciswire`** — **keeps the full 20-message window, identical to bare**, and **adds** a BM25
  digest of everything outside it. Purely additive.

**Why `v42` loses**: it is a trade — it gives up verbatim context to buy a summary, and **the
summary is never built**. Measured: `summaryChars = 0` on every arm of every campaign; the
scheduler condition (`turnsSinceRebuild !== K-1`) is unreachable whenever the boundary advances
on size. So `v42` pays the cost and never collects the benefit.

**Why `ciswire` wins**: it removes nothing and can only add. Structurally it cannot recall less
than bare. Its cost is +6.7% prefill and ~25 ms of ranking per turn.

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

5. **Make `ciswire` the default on the 2B path.** +0.396 over bare, p=0.0249, audited against
   both ways it could have been fabricated, and it costs *fewer* prompt tokens than bare (§1.5).
   The blocker (§3.1) is resolved. Confirm with the campaign now running before flipping it.
6. **`v42` hurts small models specifically.** On the 2B it equals bare (−0.037, p=0.60) while
   ciswire beats it by +0.433 (p=0.0043). On the 4B the two are **indistinguishable**. So this is
   "retire it for the 2B", not "retire it" — and the reason is that its rolling summary, half of
   its rationale, **never runs** (`summaryChars = 0` on every arm of every campaign).
7. **Do not ship LFM2.5-8B-A1B** (§1.7). It loads fine — memory was never the problem — but MoE
   discounts decode, not prefill: 175 s for 1394 tokens. For more than the 2B, the dense 4B is
   the better trade, which is already what `recommendedModelId` gives the high-RAM tier.
8. **Do not fine-tune for tool calls yet.** The 2B already emits near-perfect calls (19/20
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

### 3.3 Memory: still zero measurements

`kalsa.memory.enabled` has been `'0'` in every arm of every campaign. Instrumentation is being
built: counters-only telemetry, a **NOT-RUN verdict when an arm has memory on but an empty
store**, and a privacy probe asserting the echo guard blocks a stored personal fact from
reaching a web-search query. No numbers yet.

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

## Change log

| date | change |
|---|---|
| 2026-08-14 | First version. Conclusions from campaigns `31739205810` and `31760516762`. 4B campaign `31807501488` launched; memory instrumentation and a hostile audit of `cc703e6`/`aa2f350` in flight — **both may change §1.3 and §3**. |
| 2026-08-14 | **§1.1 retracted and rewritten.** Measured the gate rule offline: it blocks legitimate searches (a good query paraphrases the question, scoring 0.39-0.68) and passes spurious ones (0.15). The 2/96 web-turn figure is the gate refusing, not the model abstaining. Added §3.5: with memory on, the same 0.18 threshold blocks ordinary Italian queries ("ricetta pasta al forno" = 0.182). Both are shipping blockers. |
| 2026-08-14 | Hostile audit of `c93d163` on an isolated worktree. §1.3 confidence raised — both fabrication routes closed with quoted code. Added §3.7: three suites shipped ungated by CI, a harness that could not fail, and a NOT-RUN verdict that would have failed the next campaign — all fixed. Identity leak past the containment guard still open; the first fix attempt was reverted for adding a language wordlist that blocked ordinary German and Spanish queries. |
| 2026-08-14 | §1.1 resolved: echo-of-context inverted and shipped (`5b3ba90`) — it blocked 100% of explicitly requested searches; verified across six scripts, with CJK abstention documented. Added §3.8: the fact metric conflates an honest refusal with a wrong answer, which penalises stronger models and makes cross-model baseline comparison unsafe. |
