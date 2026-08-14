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

**Shipping blocker.** The threshold must become scale-free before this ships; 0.18 on char
3-grams is a same-language constant, not a similarity criterion. See §3.5 for the memory-facts
half of the same defect.

**Confidence in the numbers: high. Confidence in the earlier causal story: retracted.**

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

**Confidence: medium.** One model, one language, n=6, emulator. See §3 for what would raise it.

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

### 1.5 Retrieval is affordable on a phone

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

---

## 2. What to tell whoever develops Kalsa

**Not** "replace Kalsa with CisWire". Kalsa imports **zero** lines of CisWire code — verified.
The mode named `ciswire` is Kalsa's own code implementing a CisWire-*inspired* strategy (full
window + additive digest) with Kalsa's own BM25. What won is a strategy already in the repo.

1. **Make `ciswire` the default** — today `parseContextMode(null) → "off"`, so shipped devices
   run bare. The winning mode is present and switched off. **Blocked on §3.1.**
2. **Retire `v42`** — equal to bare on recall, 22% spurious web searches late in the
   conversation, and the most empty replies.
3. **The rolling summary is dead code in practice** — it never runs. Fix it or remove it; it is
   half of `v42`'s rationale.
4. **Production defect, independent of all the above**: `windowCharBudget` (16 000 chars ≈ 4k
   tokens) is a constant never derived from the engine window, while `effectiveNCtx` can be
   clamped to 2048 on low-RAM devices. Nothing bounds the assembled prompt by `n_ctx`;
   `assembleEngineHistory` caps message *count* and per-message *chars* only. On overflow,
   text-only chats rely on `ctx_shift: true` (llama.cpp evicts silently, app unaware) and
   multimodal chats have `ctx_shift: false` with no fallback. **`n_keep` is never set anywhere**,
   so we do not control what survives a shift. Not verified: llama.rn's exact ctx_shift/n_keep
   semantics — read `node_modules/llama.rn/cpp/` before acting.

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
