# Harness findings — what we know, how well we know it

Living document. **Update it every time a review lands or new data arrives**, including when a
finding is weakened or refuted. The change log at the bottom is not optional: a conclusion that
silently changed is worse than no conclusion.

Goal it serves: make Kalsa's harness better than a bare sliding window on an on-device chat —
tool calls, context that survives, memory.

---

## STATE AS OF 2026-08-21 — read this before quoting anything below

This file is ~3 900 lines. Nobody reads it end to end, and **three mistakes were made in one day
by quoting a section that a later section had already corrected**. So: what is true right now, one
line each, with the section that owns it. If a claim is not here, check its section for a banner
before repeating it.

**The product**
- Two tiers, both LFM2 (owner, `KALSA.md` §10): fast = **LFM2.5-8B-A1B-KEXP**, quality+vision =
  **LFM2.5-VL-3B**. Nothing ships yet; there is no installed base.
- ⭐ **The quality measurement argues against keeping the 8Bs, but on language and size, NOT on
  quality** (§7.38, corrected the same day). Best score per model: 2.6B@512 **37/44**, 8B-A1B@256 35,
  Qwen3.5-2B@512 33, KEXP@512 33, LFM2.5-1.2B 25. **On quality the 2.6B and the two 8B tiers are
  indistinguishable** (p = 0.29–1.00); the first version of this line claimed the 2.6B won at
  p = 0.006–0.039 and that was a scorer defect — it penalised curly apostrophes, which the 8B tiers
  write and the smaller models do not. What genuinely separates them and never touched the scorer:
  **language drift, 2/28 on the 2.6B against 8/22 and 6/21**; **size**, 1.67 GB against 3.33; and the
  fact that the 2.6B **is** the VL-3B's backbone. What KEXP buys is speed: 848 MB/token against 1666.
  **Two things block the decision and neither is another quality run:** the 2.6B has never been
  measured on an S23, and the VL-3B is still absent from `ModelRegistry.ts`.
- KEXP decodes **~22 tok/s on the S23** in a fresh chat (§7.20) and **7.05 on the Jelly** (§7.28).
  The Jelly is a **testbed, not a target** — nothing measured on it passes even 10 tok/s.

**Where the user's time actually goes — this is the whole game**
- A cold start costs **120.8 s** on the Jelly: 77.7 s of prewarm plus 43.1 s of first-turn prefill.
  A **restored session costs 1.8 s** (§7.30). That ratio is the biggest lever we have and it works.
- The prewarm now **stands aside** after a restore instead of `seq_rm`-ing over it, and the
  per-conversation pool key is confirmed on a phone (§7.30).
- **Tuning is not a lever on prefill.** 2/4/6/8 prefill threads give 113.9 / 93.0 / 77.4 / 72.1 s;
  more threads is faster, the preset is already right, and the best arm is still over a minute
  (§7.36).

**Model quality — measured for the first time (§7.38, 24 cells, 44 prompts, 4 languages)**
- **Raise the 2.6B thinking budget from 256 to 512.** The ladder is monotone to 512 and flat after
  (30/32/34/37/36 out of 44); 512 vs 64 is 8–1, p = 0.039. It is nearly free: median tokens 306 → 309,
  so median latency does not move. **KEXP's ladder is flat — leave it at 256.**
- **Pin the answer language to the question, not to the app locale.** One clause removes the drift
  in 6 of 6 comparisons, at no quality cost. Kalsa's current rule pins to the locale.
- **KV cache quantization is free** on both 8B tiers, quality and drift alike (all p ≥ 0.063). q8_0
  halves the cache, q4_0 quarters it. Nobody had measured this axis anywhere.
- **Qwen3.5-2B ties LFM2.5-2.6B** (7–6, p = 1.000) but cannot run uncapped: unrestricted it hit the
  8192-token ceiling on 44 of 44 questions, and at its budget it writes **753 median tokens** — the
  longest of any model here, so on a phone it is the slowest to an answer despite being 1.27 GB.
- **LFM2.5-1.2B does not think at all** (no `<think>` in 44 of 44) and is a real step down: 25/44,
  losing to the 2.6B 3–12, p = 0.035. It wins judgement questions and loses reasoning ones. What it
  buys is a **~2 s median answer against ~56 s**, from 27 median tokens and a predicted 12.5 tok/s.
- **QAD-Q4_0 is better than free on the 2.6B**: same 34/44 at 5 % fewer bytes (3–3, p = 1.000) and
  **+6.9 % decode measured on the Jelly** (8.63 vs 8.07 t/s, `scripts/device-decode-lineup.sh`).
  Not on the 1.2B, where it costs quality.
- The Jelly measurement also validates the prediction method: **the bandwidth model gets ratios
  exactly right** (2.28× predicted for 1.2B over 2.6B, 2.28× measured), but the CLI runs at 1.47× the
  app on the same model, so absolute numbers need that factor and only ratios transfer.
- ⚠️ **The judge has now had five defects, every one found by reading answers rather than totals**,
  and two of them killed the run's headline result. Re-scoring is free by design (generation and
  scoring are separate passes); **use it before believing an aggregate.**

**Bytes and tokens**
- Every `MB/token` is now from a tensor map (§7.31): KEXP **848**, LFM2.5-2.6B **1666**,
  Qwen3.5-2B **1270**. On a dense model with tied embeddings it is essentially the whole file.
- **`tok/s` is tokenizer-blind.** On product-register Italian Qwen3.5-2B needs **6.9 % fewer tokens**
  than LFM2.5-2.6B, which moves the ranking (§7.34).

**The 8B on 8 GB phones — the lane is now closed** (§7.39)
- **Streaming the experts makes it easier to kill, not harder.** RSS halves (5065 → 2629 MiB) but
  file pages become **anonymous** ones (4931 file → 2602 anon), so `MemAvailable` gets **worse**
  (5797 → 3597 MiB) — the opposite of why it was tried. 3.44 tok/s against mmap's 9.37.
- **Even with infinitely fast storage it loses**: compute alone is 0.219 s/token = 4.57 tok/s, under
  KEXP's 7.0. **So: do not stream a model that fits.** ⛔ That is NOT "do not port `--moe-stream`",
  which is what this line said first and got wrong: the port exists for **CalaQwen 35B-A3B, Marco1c,
  Mellum2** — MoEs that do not fit in RAM at all, where streaming is the only way they run. CalaQwen
  35B measures **5.86 tok/s on an S23**, a model class Kalsa cannot reach otherwise.
- ⛔ `RLIMIT_MEMLOCK` on the Jelly is **unlimited**, not the "≈ 64 KB" two files claimed, and mlock
  really fires (`Mlocked` 4 912 → 215 932 kB) — but locks 211 MB, not the model, so it does **not**
  explain the lmkd death. Both files corrected.
- **Open:** why does the app hold 5.15 GB of file pages with 0.92 GB available when the CLI holds
  the same pages with 5.8 GB available? Not mlock, not repack (that arm was `norepack=1`).

**The phone**
- The Jelly is **UFS** with **f2fs**, 137 GB free, coldest sequential read **984 MB/s** — so a cold
  KEXP load has a ~3.4 s floor (§7.32). Cores: 6×A55 (capacity 348) + 2×A76 (1024).

**GPU** — answered, then partly superseded within the hour by the parallel session (§7.33 + banner)
- Their repaired OpenCL expert kernels measure **experts on GPU at 2.17× burst / 1.5× sustained,
  cooler**, on the S23. Prefill on Adreno 750 is **5.3–6.0×** CPU. **Mali is not a target.**
- **No kernel needs writing for Vulkan** (q2_K/q3_K `MUL_MAT_ID` pipelines exist); OpenCL is the one
  that was missing them, and they have now written it.

⛔ **RETRACTED — do not re-quote these, they are wrong**
| claim | why it is dead | banner |
|---|---|---|
| GPU decode is 0.41–0.44× CPU | measured **CPU fallback**: `use_adreno_moe_kernels` excludes A7X, so K-quant MoE never reached the GPU | §7.33 |
| the dense `MB/tok` estimates are **over**-estimates | they were **under** by 3–4 % | §7.31 → §7.28 |
| `ciswire` evicted old turns and injected nothing, so it is worse than `off` | it evicted **nothing**; identical to `off` at these lengths | §7.35 |
| the sliding window collapses reuse 0.82 → 0.15 at turn 12 | measured against `LEGACY_MAX_HISTORY = 20`, which is **no longer the live path** — `AppShell.tsx:4541` calls `windowStartIndex` (40 messages, char budget) | §7.35 |
| "a `ciswire` arm needs ≥12 turns" (§9) | arithmetic against that same dead cap; 16 turns still produced an empty corpus | §7.35 |

⭐ **OPEN, in order of measured payoff — work down this list**
1. **One arm with `thinking: "default"`.** It is the shipping configuration, the whole `fase4` matrix
   is hardcoded to `off`, and **two findings now hang on that difference**: §7.37's tool-round result
   and §7.35's missing window collapse could both be "we fixed it" or "we switched the variable off".
   Nothing else can be trusted until one arm runs with thinking on.
   ~~Tool-round replay~~ — **demoted by §7.37**: 15 of 16 tool-preceded turns kept 90–98 % of the
   cache, where §7.12 measured zero of ten surviving. It is now a fix for a 1-in-16 edge case, whose
   shape is `rounds: 1` + `executed: 1` — a tool result in the KV with no assistant answer in stored
   history to account for it.
2. **At what conversation length does the derived window evict at all, and does `anchored` help
   there?** The original question ("does anchored beat the sliding window") is void — the sliding
   window it was built against is gone (§7.35). Campaign `32514162034` reruns it with `winbudget`
   set low enough to force eviction.
3. **Reproduce §7.37's one failure deliberately** — the `rounds: 1` + `executed: 1` path, which cost
   **128 167 ms** of prefill in the single seed that hit it, and is the last live trace of §7.12's
   195–405 s regime.
4. **Trimming the prefix.** 3 203 characters of system prompt plus 3 tool schemas, ~1 300 tokens,
   re-read on every cold start. Never costed (§7.36).

⚠️ **Two standing traps.** The whole `fase4` matrix is hardcoded to `thinking: "off"`, which the
owner ruled out for production on 2026-08-18 — so no campaign number below is a product number. And
a bench arm can silently fail to engage its own mechanism: **check the positive control before
reading any speed number** (§7.35 is what that costs).

---

⚠️ The header below is history, not state — the block above is state. Last updated: 2026-08-19 · Evidence: campaigns `31739205810` (window 10), `31760516762`
(window 16) and `31861056717` (window 16, every 2026-08-14 defect fixed), Qwen3.5-2B, 6
seeds/arm, 16-turn conversations, Italian, CI emulator.

**Landed 2026-08-15:** `31910747849` (memory smoke, first measurement with the settled telemetry of
`bf3794d` — §3.3), `31911860830` (the `tools` phase, gate/nogate pair, one seed — §0 question 2).

**Landed since:** `32048465417` (Qwen3.5-**4B**, fase4, 10 seeds — question 1 for the 4B, opened
question 5) and `32103054225` (**LFM2.5-8B-A1B**, the shipping model — question 5 answered). Both
on `bench/fase4-harness-fix`, the first full campaigns since the harness fixes; everything green
after 08-13 had been a one-seed smoke. The 08-15 attempt at the 4B campaign (`31911872610`) was
**cancelled and produced nothing**.

⛔ **SHIPPING BLOCKER, confirmed on hardware 2026-08-19 (§7.11): LFM2.5-8B-A1B does not load on a
Galaxy S23.** The app's own RAM gate refuses it — `'model.fit', '{"verdict":"does_not_fit",
"availableMb":4030}'` — and a chat turn returns "Caricamento del modello non riuscito" instantly.
Every quality result below for the shipping model was measured on the CI emulator; none of them
reach a user on this phone. The estimate that refuses it charges 4401 MiB of weight repacking,
calibrated on a **dense 2B**, to a **MoE with ~1B active** — so it may be refusing a model the
phone could run. That is being measured now.

**In flight:** the `norepack=1` device run that answers it, plus two 8-turn arms behind it.
Open and instrumented but unmeasured: the digest-injection cadence (§7.10).

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
| 4 | Faster / less prefill? | **Fewer tokens — and a cache that dies at ~10 exchanges no matter which mode you pick.** The sliding window collapses reuse 0.82 → 0.15 in *bare* too. On the shipping model a tool call costs the whole cache, 10 of 10 (3 s → 195–405 s) | high on tokens · high on the window and tool costs · none on any fix |
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

⚠️ **The token win is not the speed story, and the speed story is worse than we thought** (§7.12,
cross-checked on the 4B campaign and the shipping model's smoke).

**The cache dies at about ten exchanges, in every mode including bare.** `LEGACY_MAX_HISTORY` is 20
messages; past that the oldest exchange falls out of the window each turn, the prompt's first
message changes, and the prefix diverges right after the system prompt. On the 4B, mean reuse goes
**0.82 at turn 11 → 0.15 at turn 12 — in `baseline`, which never carries a digest.** This is not a
CisWire cost; it is the shipping default's cost, and it caps what every KV fix in this document can
be worth.

**On the shipping model there is no partial credit.** LFM2.5 cannot roll back recurrent state
(`llm_arch_supports_rs_rollback` is false for it, true for Qwen3.5), so reuse is 0.98 or exactly 0
and one divergent token costs everything. A tool call is one such divergence, guaranteed: 10 of 10
turns after a tool lost the whole cache — **3 s prefill becomes 195–405 s**. The same event on the
4B costs 0.507 against 0.637, survivable only because it can roll back.

The digest adds cost on top of that, but it is second-order and it is collinear with the window by
construction. Memory-on is worse by construction still: `extractMemory` calls `clearCache()`.

Question 4's honest answer: fewer tokens, a cache worth having only in short conversations, and on
the shipping model only until the first tool call. Net wall clock on a phone is still
**unmeasured**.

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

⚠️ **This was measured, written down, and never shipped — and on 2026-08-19 it became the
difference between the shipping model running and not running at all (§7.11).** `no_extra_bufts`
is still a bench-only knob (`kalsa.bench.norepack`), production always loads with repack on, and
until today both RAM gates hardcoded the repack-on footprint with no way to say otherwise. The
table above is the 4B. On LFM2.5-8B-A1B the same arithmetic refuses the load outright on an S23.
What §7.2 never measured is **prefill** — it says "nothing measurable in decode", and the two are
not the same claim; llama.rn's own knob description says repack-off is slower to prefill. That
number is what decides whether shipping `no_extra_bufts` on ≤8 GB is a fix or a different problem.

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

### 7.42 MEASURED 2026-08-23: the in-session decay is not a phone — it reproduces at 2.8x lower speed on the Jelly

First arm ever run on the Jelly Star from the **mainline** build. Until today `minSdk 35` made the
shipping APK uninstallable there (`INSTALL_FAILED_OLDER_SDK`), so the Jelly was benched off a
never-merged branch; the floor was lowered to 33 the same day. Same APK, same harness, same model
and same config as the S23 arm in §7.41 — the first genuinely comparable pair we have.

LFM2.5-2.6B-QAD-Q4_0, `PHASE=fase4`, 16 turns, production config, both unplugged.

| turn | S23 tok/s | Jelly tok/s | S23 promptMs | Jelly promptMs |
|---|---|---|---|---|
| 1 | 19.2 | 7.2 | 34 563 | 44 159 |
| 4 | 19.1 | 6.5 | 240 | 1 728 |
| 8 | 17.8 | 6.2 | 277 | 2 752 |
| 12 | 15.7 | 6.0 | 3 068 | 2 863 |
| 16 | **14.1** | **5.5** | 6 122 | 3 424 |
| mean | 17.2 | 6.2 | | |
| decay | **−26 %** | **−24 %** | | |

**The decay is the finding.** −26 % and −24 % across sixteen turns, on silicon a factor 2.8 apart,
with the Jelly running 4–6 °C cooler and never approaching a thermal trip. Whatever causes the
in-session slide, it is not one phone's throttling curve. A turn-1 number is wrong by about a
quarter on both, which is the concrete cost of the rule in §7.23.

**The Jelly does not get the prompt-state cache the S23 gets.** The S23 falls to 232–553 ms for
turns 2–11 (§7.41); the Jelly never goes below 1661 ms and sits at 2–3 s throughout. Same model,
same 160 MB budget, same code — so the cache is either evicting or costing more to restore here.
Unexplained, and worth a look before any conclusion about "prefill is solved".

**Memory was never the constraint on either.** Jelly `MemAvailable` is flat at ~2.35 G for all
sixteen turns (the S23 declined 2.31 → 2.03 G). Battery 72 % → 62 % for the arm.

At 6.2 tok/s mean the Jelly remains below the 10 tok/s floor KALSA.md sets, now measured on the
build that ships rather than on a bench branch. That confirms the "testbed, not a target" call —
but it is worth stating that the phone was excluded by an INSTALL failure, not by this number,
until today.

⚠️ **This arm was first reported as `arm measured nothing (error/empty turns > half)` and it was
none of those things** — see the commit that fixed benchGrade's isMain symlink guard and the
measured-nothing check. Any earlier arm dismissed with that sentence deserves re-reading before
it is trusted as a null result.

### 7.41 MEASURED 2026-08-23: the 8B does not get killed — it gets thrashed, and it is the battery that ends the run

First in-app kill-campaign arms on the S23 (Android 16, APK `073c489`, unplugged, disk 79 % — see
the caveat at the end). Harness: `ci-bench.sh PHASE=fase4`, 16 turns, `COMPACTION=ciswire`.

**Arm A, production config: the app refused, exactly as §7.11 predicted.** `modelGateVerdict`
returned `blocked_ram` and the UI said "Memoria libera insufficiente per eseguirlo". §7.11 derived
this on 2026-08-19 from the constants; this is the same verdict reached through the normal user
path, with the engine never invoked. Measured at the refusal: `MemAvailable` 4022 MiB against a
repack term of 4401 MiB, `RssAnon` 128 MB — no allocation was attempted.

**§7.11 left one question open, and this answers it.** It flagged that `REPACK_FRACTION` is
calibrated on a DENSE 2B, that an MoE with ~1B active may allocate far less, and that the gate
would then be a **false negative** — refusing a model it could have run — invisible because a
blocked load produces nothing to compare against. Setting `kalsa.bench.norepack=1` (repack term
→ 0, non-evictable → 249 MiB) admits the model, so the counterfactual is now measurable.

The model does run. It is unusable.

| turn | tok/s | promptMs | RssFile | RssAnon | MemAvailable | majflt | battery |
|---|---|---|---|---|---|---|---|
| 1 | 0.27 | 33 916 | 1.96 G | 0.07 G | 4.24 G | 388 423 | 51 % |
| 2 | 0.28 | 29 536 | 2.54 G | 0.05 G | 4.31 G | 622 584 | 44 % |
| 3 | 0.26 | 6 499 | 2.35 G | 0.06 G | 4.26 G | 803 595 | 38 % |
| 5 | 0.27 | **190 086** | 2.23 G | 0.06 G | 4.25 G | 1 400 146 | 23 % |
| 6 | 0.29 | 4 777 | 2.31 G | 0.07 G | 4.29 G | 1 547 005 | 18 % |
| 7 | 0.28 | 6 978 | 2.31 G | 0.07 G | 4.25 G | **1 738 800** | **11 %** |

Three things this table says that the plan did not predict:

1. **Nothing is ever short of memory.** `MemAvailable` is flat at ~4.25 GB from first turn to last.
   No lmkd, no kill. §7.27's "lmkd at turn 8" is a different regime — that one had 0.92 GB available
   and, by inference, repack ON making the footprint anonymous and unreclaimable.
2. **Throughput does not decay** (0.26–0.29 across seven turns, against the 2.6B's −26 % over
   sixteen). This is not thermal throttling; it is I/O. Major faults grow linearly at ~200 000 per
   turn to 1.74 M. Of 4917 MiB of weights the kernel keeps only ~2.3 GB resident and re-reads the
   rest, every token.
3. **The cost is the battery: 51 % → 11 % in seven turns**, ~5.7 points per turn, ~1205 mA
   sustained (against ~690 mA for the 2.6B). The arm ended when Android dozed the phone at 11 %,
   and `ci-bench` refused to continue rather than time a sleeping device.

So the gate's refusal is a false negative in the narrow sense §7.11 feared — the model *can* load —
and substantively right anyway: what it refuses is 0.26 tok/s and a flat battery in an hour. **The
right conclusion is not "loosen the gate". It is that the gate reaches a correct verdict through an
arithmetic that does not describe this model**, and that stays true until `REPACK_FRACTION` is
recalibrated on an MoE.

**Arm C, LFM2.5-2.6B-QAD-Q4_0, first ever in-app measurement** (§9's starred gap is about the
Q4_K_M, so this answers the neighbouring question, not that one). 16/16 turns, never in danger:
`RssAnon` flat at ~1.8 G, `MemAvailable` 2.31 → 2.03 G.

| turn | 1 | 5 | 9 | 12 | 16 |
|---|---|---|---|---|---|
| tok/s | 19.2 | 19.0 | 17.6 | 15.7 | **14.1** |
| promptMs | 34 563 | 423 | 299 | 3 068 | 6 122 |
| battery °C | 33.6 | 33.3 | 34.4 | 36.4 | 37.6 |

**−26 % inside one session**, mean 17.2. Publishing turn 1 would have claimed 19.2, a rate the model
does not hold. Two causes are confounded — growing context and 33.6 → 38.4 °C — and this data
cannot separate them.

The prefill row is its own lesson: 34.6 s cold, then **232–553 ms** for turns 2–11 because the
recurrent prompt-state cache (160 MB, RAM, `rn-completion.h`) returns the prefix, then back to 3–17 s
from turn 12 as the conversation outgrows it. Fast prefill here is work **skipped**, not work done
quickly, and it stops being skipped.

**Streaming glue: first execution on a phone, and it works.** Armed and bound on the KEXP, S23.
Success is silent by design — llama.rn logs `kalsa moe stream:` only on failure — so the evidence is
from the kernel: `RssAnon` 2.70 G against `RssFile` 72 MB (a mmap-resident model is the other way
round: arm C ran at `RssFile` 942 MB), `read_bytes` climbing ~300 MB/s throughout decode, 16.7 GB
read for a 3.33 GB model. The reply was coherent, which also rules out the decode-on-zeros path
`44f6035` fixed by audit rather than by running it.

⛔ **Arm E (8B + streaming) could not run, and the reason is structural.** `MoeStream::arm()` forces
`no_extra_bufts = true` — streaming disables repack, because repack would change the byte layout the
file offsets describe. The gate reads the `norepack` pref, not `moeStream`, so it charges the 8B
4401 MiB for a repack that streaming would have removed, and refuses before the engine is reached.
This is the "no streaming awareness in the gate" gap with a number on it.

⚠️ **Two caveats on comparing these numbers to earlier ones.** The S23's disk went from 97 % to 79 %
full between §7.27 and this run (21 GB of another line's models deleted), so this is a new series,
not a continuation. And `kalsa.bench.norepack=1` was found already set on the phone at session
start, left from an earlier run — every arm above states its own repack setting because of it.

### 7.40 MEASURED 2026-08-22: on a model that does NOT fit, streaming is 19.5x — and the drop policy is worth another 1.38-1.83x

§7.39 measured streaming on an 8B that **fits** in 8 GB and found it loses. That result stands and
is not the port's case. This is the port's case: `Marco-Mini-Instruct.i1-Q4_K_M.gguf`,
**10,505,424,704 B** (9.78 GiB) against `MemTotal` of 7.24 GB (S23) and 7.97 GB (Jelly). The byte
count matches the sibling repo's own record, so this is that artifact and not a lookalike.

One binary for both phones — `bmoe-cli` and its `.so` set pulled off the Jelly and pushed to the
S23 unchanged — so the device is the only thing that differs. Raw CSVs and logs:
`results/moe-stream-2026-08-22/`.

**Why streaming exists.** Same binary, same device (S23), same prompt, `-n 32`:

| arm | tok/s | s/token | major faults/token |
|---|---:|---:|---:|
| streaming, lossless | **2.971** | 0.337 | 0.00 |
| plain mmap | **0.152** | 6.562 | **17,478** |

**19.5x.** The mechanism is in the fault count: without streaming the page cache thrashes ~17.5k
pages (~68 MB) back in per token. The model technically runs; at 6.5 s/token it is not a product.

**The drop policy is regime-dependent, and the regime is the cache hit rate.** Both arms stream;
A adds `--n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm`, B is lossless top-8. ABBA per
block, medians of n=6/arm, exact two-sided Mann-Whitney:

| device | A | B | A/B | U | p |
|---|---:|---:|---:|---:|---:|
| Jelly (G99, t2) | **2.962** | 2.144 | **1.381x** | 36/36 | 0.0022 |
| S23 (8Gen2, t4) | **5.792** | 3.175 | **1.825x** | 31/36 | 0.0411 |

Bytes are identical across devices (deterministic at temp 0): **197.01 -> 53.61 MiB/token, -72.8%**;
re-reads **93.4 -> 15.7 per token**; hit 28.3% -> 39.5%. The sibling repo records -27% time / -68%
bytes for this policy on Marco; measured here, **-27.6%** time and -72.8% bytes (medians of the
CSV's own `s_per_tok` column: 0.4660 -> 0.3375). Independently reproduced. An earlier draft of
this section said -29.8%: that came from inverting the tok/s medians and re-deriving, instead of
reading the seconds the runs actually recorded.

**This corrects a generalisation of mine.** I had excluded both knobs from the app's bench arm on
the grounds that "every measured LFM2.5 drop level was a net loss" — true, and true *only there*.
Where the expert set nearly fits the cache there is nothing cold to drop (LFM2.5: 93.5% hit, drops
capped at 3.6%); where half the reads are re-purchases of bytes already paid for, dropping IS the
recipe (Marco: ~50% hit). The rule is the hit rate, never the model name.

**Two things this does not prove.**

*The S23 ratio is directional.* Two runs collapsed (`3,3,B` 1.357, `3,4,A` 2.467). Flash I/O barely
moved across the collapse (0.213 -> 0.231 s/token) while **CPU occupancy halved, 61% -> 30%**,
per-token compute nearly tripled and model load went 7.3 -> 13.5 s. The process lost cores: `nproc`
reports **6** with 8 online, and the sibling repo has seen `nproc=3` on this device and tracks it as
open item #5b. Medians survive it; the ratio is not proven.

*The cooldown gate watched the wrong signal.* It gates on battery temperature, which sat flat at
28.4-28.5 dC straight through both collapses. A gate that works records per-run **core
availability**, not degrees. The Jelly needs none: 12 runs, 30 -> 33 dC, A-arm spread 2.2% — the
phone with no thermal headroom to boost is the better measuring instrument.

**Do not divide these tok/s by the sibling repo's cards.** Different harness, and its default drop
changed (d065 -> d1.0 no-renorm), so its older absolute numbers describe neither this config nor
this bench. Only the A/B ratio within one device on one binary is comparable.

**Not measured here: the app.** Every number above is `bmoe-cli`, the engine. The llama.rn glue
(`native/bmoe/rn/bmoe_stream.cpp`) has never run on a phone — it needs a CI build.

### 7.39 MEASURED 2026-08-22: streaming the experts makes the 8B *easier* to kill, not harder — and the compute ceiling closes the door anyway

The question, asked because the owner asked it: LFM2.5-8B-A1B does not fail slowly on the Jelly,
it fails by being **killed** — 100 % resident, 5.15 GB `RssFile`, 0.92 GB `MemAvailable`, lmkd at
turn 8 (§7.27). Streaming trades speed for memory, which is the failing constraint, so it was the
one untried idea that addressed the actual failure.

`--moe-stream`, `--drop-cold-experts` and `--dense-weights` exist in **no** llama.cpp we ship:
zero matches in llama.rn's bundled cpp and in upstream 10360's `--help`. They live only in
`kalsa-moe-experiments/kalsa-engine/cli/main.cpp`. So this needed the NDK, a cross-compile of that
fork (armv8.2-a + dotprod + fp16, **no i8mm** — it SIGILLs the prefill GEMM on pre-2021 SoCs — and
`GGML_CPU_ALL_VARIANTS`/`GGML_BACKEND_DL` **off**, or the statically-linked
`ggml_cpu_set_expert_ready_hook` disappears and arm B silently measures something that is not
streaming), and a device session. Delegated; numbers re-derived here from the raw `/proc` traces in
`/tmp/bmoe-stream-out/`, not from the report.

Jelly, unplugged, t=2, k=4 (native for this model — `run_g99_freetier_jelly.sh:222` reads
`# Phase 3 k lever (speed only). Default K0=4`), ABBA, n=3:

| arm | tok/s | peak RSS | **RssAnon** | **RssFile** | min `MemAvailable` |
|---|---|---|---|---|---|
| A — plain mmap | **9.37** | 5065 MiB | 133 | **4931** | **5797 MiB** |
| B — CalaQwen streaming | **3.44** | 2629 MiB | **2602** | 30 | **3597 MiB** |

**The memory result inverts the premise, and it is the finding.** Total RSS halves — and the *kind*
of memory flips. mmap holds 4.9 GB of **file** pages, which the kernel can drop under pressure;
streaming holds 2.6 GB of **anonymous** pages, which it cannot. `MemAvailable` is therefore
**worse** with streaming, 5797 → 3597 MiB. lmkd kills on memory pressure, so streaming would make
the 8B **easier** to kill per unit of RSS, not harder. It fails at the exact thing it was tried for.
The anon is the cache (`moe-cache: resident 1997.3 MiB` against `--cache-mb 2000`), so it is
tunable — but shrinking it costs the 87 % hit rate that is the only reason arm B is not far slower.

**And a compute ceiling closes the door independently of storage.** `B1.log`:
`decode 0.287 s/token (compute 0.219 + cache mgmt 0.007 + flash I/O 0.139 s/token, 265 MiB/s)`.
Compute alone caps the path at **4.57 tok/s** — below KEXP's 7.0–7.3 in-app **even with infinitely
fast flash** — and against mmap's 0.107 s/token the streaming path's compute is ~2× slower.

⛔ **My prediction was right in the number and wrong in every reason**, which is worth more than the
number. I predicted 3–5 tok/s from ~1030 MB/token of weight traffic, 984 MB/s sequential flash, and
a 71.8 % byte cut. Measured: `moe-drop: 1517/11264 routed experts dropped (13.5%)` — not 71.8 %,
because that figure belongs to a **different model's** table; flash delivering **265 MiB/s**, not
984, because expert reads are not sequential; `moe-cache: 87.0% hit`; `read 4698.2 MiB
(36.71 MiB/token)`. 3.44 landed inside my range through compensating errors. Also in the log and
worth keeping: `1028 evictions, 711 re-reads (5.6/token) — bytes the cache had already paid for
once`.

**Verdict, and it is narrower than the first version of this line:** do not stream a model that
**fits**. Everything above is measured against plain mmap of a 5.15 GB model on an 8 GB phone, where
mmap is available — and there streaming is slower, capped below KEXP even with perfect storage, and
actively worse for the memory failure it was meant to fix.

⛔ **I first wrote "do not port `--moe-stream` into Kalsa" and that was wrong, because it answered
the wrong question.** The owner's reason for wanting the port is not the 8B: it is **CalaQwen
35B-A3B, Marco1c and Mellum2 12B/A2.5B — MoEs that do not fit in RAM at all**, where streaming is
not competing with mmap, it is the only thing that makes them run. Their measured product-card
numbers (`kalsa-moe-experiments/docs/ALIVE.md`, section 5, at `0a48896`):

| model | S23 (8 GB) | Xiaomi 14 (11.4 GB) | Jelly (G99, 8 GB) |
|---|---|---|---|
| **CalaQwen 35B-A3B KEXP** | **5.86 t/s** (t4, k6d065) | 4.75 (t6) | — |
| **Marco1c** | 8.82 (t4) | 10.57 (t4) | 3.64 (t2) |
| Mellum2 12B/A2.5B | 5.151 (t2, k6d1.0) | — | — |

A **35B** at 5.86 tok/s on an 8 GB phone is a model class Kalsa cannot reach by any other route.
That is the case for porting, and this experiment neither made nor refuted it — it measured the one
configuration where streaming was always going to lose.

Two caveats to carry into that decision, both stated by the source: those two figures (CalaQwen S23
5.86, Marco1c Jelly 3.64) "match the speed grid but lack a reopenable `runs.csv` + analysis pair",
and consecutive-run variance on that rig reached **±50 %** (3.99 → 8.27 t/s), so speed claims there
need ABBA pairs. What this experiment *does* contribute to the port decision is the memory shape:
streaming's footprint is **anonymous and unreclaimable**, so on a phone that is already tight, the
cache size is not a free knob — it trades directly against lmkd risk.

#### The mlock side-quest: a documented reason that was wrong, and a hypothesis of mine that was too

A review agent died mid-stream, but the fragment it had already emitted pointed at
`use_mlock: true` (`LlamaService.ts:1211`). The signature fit alarmingly well: the app shows 5.15 GB
`RssFile` with 0.92 GB `MemAvailable`, while the CLI on the same model and phone shows 4931 MiB
`RssFile` with **5797 MiB still available** — the same pages counted in opposite ways, which is what
locking would do.

`KNOWN_ISSUES.md` and `engineLiveness.ts` both said mlock is fail-soft "(RLIMIT_MEMLOCK ≈ 64 KB)".
**That reason is false here:** `/proc/self/limits` reports `Max locked memory: unlimited`, for the
adb shell **and** for the app process under `run-as`. And mlock does take effect — system `Mlocked`
goes 4 912 → **215 932 kB** under `--load-mode mlock`, three thousand times the claimed ceiling.

**But it locks ~211 MB, not the 1.67 GB model, so it cannot starve an 8 GB phone and the hypothesis
is dead.** Both files now carry the measurement instead of the folklore (`a093d89`). The first
attempt at this measurement sampled `/proc` *after* the process had exited and showed no movement at
all, which is why every arm now prints `alive pid=` next to its numbers.

**Still not explained, and now the open question:** what does make the app hold 5.15 GB of file
pages with only 0.92 GB available, when the CLI holds the same pages with 5.8 GB available? Not
mlock. Not repack — §7.27's arm was `norepack=1`.

### 7.38 MEASURED 2026-08-21: the quality bake-off — LFM2.5-2.6B wins, the thinking budget was set backwards, and a one-line prompt change removes a 30 % language defect

Four models, 11 questions decided **before** any model ran, 4 languages, 44 prompts per cell, 24
cells. Everything below is regenerated by `node scripts/quality/analyse.mjs`; no figure here was
transcribed by hand, because this file has been burned by transcribed figures before.

**Method.** `scripts/quality/questions.json` holds the prompts and the pass criteria together, so
the scorer cannot be tuned to a result after seeing it. `run.mjs` launches one `llama-server` per
cell and writes raw completions; `report.mjs` and `analyse.mjs` score them. Generation and scoring
are separate passes on purpose: re-scoring must never cost a re-run, and it did not — the judge was
rebuilt twice against completions already on disk. Cells are compared with an **exact two-sided
McNemar** on the questions both answered. They are the same 44 questions, so pairing is the correct
test and it is far more powerful than comparing two totals.

**Ran on this Mac, not on CI.** All three LFM2.5 GGUFs were already on disk and Homebrew's
llama.cpp 10360 is native arm64; CI would download ~10 GB per run. Only Qwen3.5-2B had to be
fetched.

#### The result that decides a product question

⛔ **RETRACTED THE SAME DAY, and the table below is the dead version — kept because it is what a
fifth judge defect looks like from the inside.** The scorer folded accents but not **typographic
punctuation**. KEXP writes `I’m sorry, but I can’t help with that.` with U+2019; every marker held
U+0027. Invisible on screen, systematic in effect: each marker containing an apostrophe was biased
against whichever model uses curly quotes, and **the 8B tiers do while the 2.6B and 1.2B do not**.
Re-scored, KEXP goes **26 → 31/44** and 8B-A1B **33 → 35/44**, while the 2.6B, the 1.2B and Qwen do
not move at all.

**The corrected result: on quality the 2.6B, 8B-A1B and KEXP are indistinguishable.**

| comparison | 2.6B wins | 8B wins | p (retracted) | **p (corrected)** |
|---|---|---|---|---|
| 2.6B vs KEXP, production budget | 6 | 3 | 0.039 | **0.508** |
| 2.6B vs KEXP, both at 512 | 6 | 2 | 0.012 | **0.289** |
| 2.6B vs 8B-A1B, both at 512 | 6 | 2 | 0.008 | **0.289** |
| 2.6B vs 8B-A1B, production budget | 2 | 3 | 1.000 | **1.000** |

Found because the owner refused to believe a 731 MB model could tie a 3.33 GB one and asked to see
the answers. That is the second time in this run that "show me the answers behind the significant
result" killed the significant result. **What still separates the models is language drift, which
never passes through the scorer and is unaffected** — 2/28 on the 2.6B against 8/22 and 6/21 on the
8B tiers — together with size and speed.

The dead version follows.

**LFM2.5-2.6B beats both 8B tiers**, consistently and across independent configurations:

| comparison | 2.6B wins | 8B wins | p |
|---|---|---|---|
| 2.6B vs KEXP, production budget | 10 | 2 | **0.039** |
| 2.6B (unrestricted) vs KEXP (production) | 11 | 1 | **0.006** |
| 2.6B vs KEXP, both unrestricted | 9 | 1 | **0.021** |
| 2.6B vs 8B-A1B, both at 512 | 8 | 0 | **0.008** |
| 2.6B vs 8B-A1B, q8_0 KV | 6 | 0 | **0.031** |
| 2.6B vs 8B-A1B, production budget | 3 | 2 | 1.000 |

The last row is the honest caveat: against **KEXP** the result is unambiguous, against **8B-A1B** it
is won in most configurations but tied in one, and `prod-8b-a1b` (33/44) sits above that model's
other five cells (28–30), which is what a lucky sample looks like at temperature 0.7.

**Qwen3.5-2B ties the 2.6B** at its registry budget: 7–6, p = 1.000, 33/44 against 34/44. The
competitor is level with our quality tier. (This one survives the correction — Qwen's score does not
move.)

**LFM2.5-1.2B-Instruct is a genuinely weaker model, and it does not think at all.** 25/44, no
`<think>` block in any of its 44 answers, median completion **27 tokens** against the 2.6B's 306. It
loses to the 2.6B 3–12, p = 0.035. Its 731 MB predicts **12.5 tok/s** on the Jelly against the 2.6B's
measured 5.47, and because it does not think its median answer is **~2 s against ~56 s** — but the
per-question split shows what that buys and what it costs: it takes `genuine_refusal` 4/4 and
`absurd_gift` 4/4 where KEXP takes 0/4 and 2/4, and loses `count_vowels` 1/4 against 4/4,
`fermi_estimate` 2/4 against 4/4, `arith_change` 3/4 against 4/4. **It is better at judgement and
worse at anything requiring reasoning**, which is what a non-reasoning model should be, and it means
the aggregate hides the difference rather than measuring it. (KEXP's 0/4 on `genuine_refusal` was the
punctuation bug, not a safety failure: it refused correctly in all four languages.)

**QAD-Q4_0 is a free 5 % on the 2.6B**: 34/44 against Q4_K_M's 34/44, paired 3–3, p = 1.000, at
1594 MB instead of 1674. On the 1.2B it does not help (21/44 against 25/44, p = 0.289).

**There is no KEXP for a dense model, and there cannot be.** Verified on disk with `llama-gguf`:
LFM2.5-2.6B has **0** tensors matching `_exps`, LFM2.5-8B-A1B has **264**. The KEXP recipe
(`~/kalsa-models/kexp-build/tensor_types_lfm25.txt`) assigns `ffn_gate_exps`/`ffn_up_exps` → q2_K
and `ffn_down_exps` → q3_K. Those tensors exist only in a MoE.

#### Two of the predictions are now measured on the Jelly, and the ratios hold

Unplugged, 98 % battery, 26.0 °C, `llama-bench` t=2 (the helio-g99 **decode**
count from `deviceTuning.ts`, not its prefill count), tg128, r=3
(`scripts/device-decode-lineup.sh`):

| model | file | measured t/s (CLI) | in-app, via the control factor |
|---|---|---|---|
| LFM2.5-2.6B Q4_K_M — **control** | 1.55 GiB | **8.07 ± 0.00** | 5.47 (measured in-app, §7.28) |
| **LFM2.5-2.6B QAD-Q4_0** | 1.48 GiB | **8.63 ± 0.08** | **~5.85** |
| **LFM2.5-1.2B-Instruct Q4_K_M** | 695 MiB | **18.39 ± 0.01** | **~12.5** |

The control is what makes the other two readable: llama-bench reads 8.07 where
the app reads 5.47 for the same model on the same phone, so the app factor is
**0.678**. Through it, **QAD-Q4_0 is +6.9 % over Q4_K_M at identical quality**
(34/44 either way, p = 1.000, 80 MB smaller) — better than the +4.6 % predicted —
and the 1.2B lands at ~12.5 against 12.46 predicted.

**The bandwidth model predicts ratios exactly**: 2.28× predicted for the 1.2B
over the 2.6B, 2.28× measured. Ratios transfer between the CLI and the app;
absolute in-app numbers do not, and need the factor.

⚠️ **That 0.678 is not called overhead.** llama-bench decodes with no context
while the app decodes above ~1 300 tokens of system prompt plus the KV, and
decode slows as the KV grows. How much of the 32 % is context and how much is
the app is **not separated**, and until it is, it is not a defect.

#### The thinking budget was tuned in the wrong direction — and this reverses an earlier claim in this very section

`ModelRegistry` gives every LFM2.5 entry `{ short: 256, extended: 512 }` and
`resolveThinkingParams` sends `short` in `"default"` mode, which is production. The owner states
those numbers were picked early for speed and never measured. Measured now, score out of 44:

| budget | 64 | 128 | 256 | 512 | unrestricted |
|---|---|---|---|---|---|
| **LFM2.5-2.6B** | 30 | 32 | 34 | **37** | 36 |
| LFM2.5-8B-A1B | 28 | 29 | 33 | 29 | 29 |
| LFM2.5-8B-KEXP | 26 | 25 | 26 | 28 | 28 |

⛔ **I first reported "the budget buys nothing on any LFM2.5 tier" and that was wrong for the 2.6B.**
It rested on adjacent steps — 256 vs 512 is 0–3, p = 0.25 — which 44 binary items cannot resolve.
Across the full span the effect is there: **512 vs 64 is 8–1, p = 0.039**, and the ladder is
monotone to 512 and then flat. The lesson is about the instrument, not the model: a dose-response
measured only between neighbouring doses will read as absent.

**The recommendation is therefore to RAISE the 2.6B to 512, and it is nearly free.** Median total
tokens are 306 at 256 and 309 at 512 — the extra budget is spent only by the questions that need
it, so median latency does not move, and the score goes 34 → 37. On **KEXP the ladder really is
flat** (26, 25, 26, 28, 28): leave it.

**Qwen3.5-2B is the opposite case and cannot run uncapped.** Unrestricted it hit the 8192-token
ceiling on **44 of 44** questions and scored 13/44; at its registry budget of 512 it scores 33/44.
Paired: 1–19, p < 0.001. The failure is a *semantic* loop, which is why a token-level repeat penalty
cannot break it — the span repeats with one slot varying:

    *(Wait, actually, I need to check if there's any specific policy regarding "Child Safety".)*
    *(Wait, actually, I need to check if there's any specific policy regarding "Animal Welfare".)*
    *(Wait, actually, I need to check if there's any specific policy regarding "Harmful Content".)*

#### Language drift is real, and one clause removes it

With the system prompt in the question's language, **the 2.6B essentially never drifts** (0/26, 2/28,
0/26 across three cells) while the 8B tiers answer in the wrong language about a third of the time
(8/22, 5/20 – 8/24). Drift is always **into English**, never out of it, and it concentrates on the
questions where the model does not know the answer.

Adding one clause — *"write your answer in the same language as the question, even when you are
unsure or cannot answer"* — collapses it, in **six of six** comparisons with **zero** cases where
the pinned cell drifts and the unpinned one does not:

| comparison (drift) | pinned only | unpinned only | p |
|---|---|---|---|
| pin vs production, 8B-A1B | **0** | 7 | **0.016** |
| pin vs q8_0 KV, 8B-A1B | **0** | 7 | **0.016** |
| pin vs unrestricted, 8B-A1B | **0** | 6 | **0.031** |
| pin vs q4_0 KV, KEXP | **0** | 6 | **0.031** |
| pin vs q8_0 KV, KEXP | **0** | 6 | **0.031** |
| pin vs production, KEXP | **0** | 4 | 0.125 |

Absolute: 8/22 → **1/23** on 8B-A1B, 6/21 → **2/22** on KEXP. **And it costs no quality** — 1–4
(p = 0.375) and 4–4 (p = 1.000).

⭐ **Product change indicated.** Kalsa's prompt already carries a language rule, but pinned to the
**app locale** (`i18n/en.ts:1033`, `it.ts:989`): *"Write all natural-language answer text … in
English."* The form that works is pinned to the **question**. The trailing clause is not decorative:
the drift lives precisely where the model is unsure.

#### KV cache quantization is free — the axis nobody had measured

moe-experiments never tested it: its `k` is `--n-expert-used` and no `cache-type` flag appears
anywhere in that repo. Measured here on the production configuration, **no effect on either 8B
tier**, on quality (all p ≥ 0.063; 8B-A1B f16 vs q4_0 is the closest at 5–0, p = 0.063) or on drift
(all p ≥ 0.727). q8_0 halves the cache and q4_0 quarters it for no measured quality cost.

#### Four harness defects found and fixed, all mine, and what each one teaches

1. **A 2048-token cap** cut answers off mid-thought and the scorer read my ceiling as the model's
   quality. Truncation is now its own column, never folded into a wrong answer.
2. **Greedy decoding (`temp 0`)** drove Qwen's reasoning into a literal repetition cycle. A
   benchmark's determinism is not worth a sampler no product uses.
3. **No system prompt at all.** Kalsa always sends one. Without it Qwen failed to terminate on 6 of
   6 questions; with it, 3 of those 4 terminate. Diagnosed by talking to the live server one knob at
   a time — `2+2` answered in 163 tokens and stopped, which cleared the template and the sampler
   before anything else was suspected.
4. **An English system prompt in front of a non-English question.** The prompt's language dominates
   the answer's: 8B-A1B then answered **16 of 26** non-English questions in English and
   code-switched into nonsense — *"3 books at 12.50 ciascuno, which totals 37.50 ciascuni"*, where
   *ciancina* is a word in no language. Every language now gets its own prompt.

The judge itself had four more, found only because the owner asked to see the answers behind the one
significant result. Markers were looked up **only in the language of the question**, so an English
*"I'm sorry, but I can't help with that."* answered to an Italian question scored as *"treated an
absurd request as a normal one"*. That artefact alone produced the run's only significant KV result
— KEXP with q4_0 KV, 8 lost against 1, p = 0.039 — which **evaporated to p = 0.289 once the judge was
fixed**. Also: `I do not have` missed because only the contraction was listed; `isn't a typical or
appropriate gift` read as obliviousness; and `12{,}50`, which these models emit constantly, not
matching `12,50`. Harness 37 → 54 assertions, every new one a verbatim answer the old judge got
wrong.

⚠️ **What this instrument cannot do.** 44 binary items per cell. It resolves large effects and the
consistent direction of small ones; it cannot resolve a few points. Three separate conclusions here
turned on that limit — the KEXP/q4_0 artefact, the adjacent-budget null, and the 8B-A1B tie. The fix
is more items or repeated seeds, not more cells.

**Not measured, and both block the tier decision:** LFM2.5-2.6B has **never been run on an S23**
(`KALSA.md` has only the Jelly row), and **LFM2.5-VL-3B is still absent from `ModelRegistry.ts`**
despite being the named quality tier.

### 7.37 MEASURED 2026-08-21: the tool round no longer costs the whole cache — 15 of 16, and the one failure has a shape

Written **before** building the tool-round replay, because §7.35 had just cost a day by shipping an
`anchored` window built against a sliding window that no longer slides. The same question applies
here: §7.12 called the tool round the second-biggest cache destroyer on the model we ship —
*"of 48 turns after the first, 14 missed and 10 were the turn immediately after a tool executed —
with zero tool-preceded turns surviving"*, priced at **3.1–3.9 s on a hit against 195–405 s on a
miss**. The tool-round replay was going to be the next thing built. **Check first.**

Campaign `32503221846`, 18 seeds across four arms, turn 12 is `probe_tool` and turn 13 is the turn
after it. Restricting to the **16** seeds where a tool actually executed:

| `rounds` recorded on the tool turn | n | mean reuse on turn 13 | values |
|---|---:|---:|---|
| **2** (call + synthesis) | **15** | **0.956** | 0.90 – 0.98, every one |
| 1 | 1 | **0.000** | — |

**15 of 16 tool-preceded turns kept 90–98 % of the cache.** §7.12 measured zero of ten surviving.
The claim does not reproduce, and the replay it justified would have been built for a problem that
is mostly gone.

⭐ **The one failure is not noise — it has a mechanism worth chasing.** `baseline` seed 6 is the only
seed whose tool turn recorded **`rounds: 1` with `executed: 1`**: the tool ran, and no synthesis
round followed. Its next turn reused **nothing** and paid **128 167 ms** of prefill — the 195–405 s
regime §7.12 described, alive and well, in exactly one place. The other two `rounds: 1` seeds had
`executed: 0` (no tool call at all) and kept 0.994. So the shape is: **the cache dies when the turn
ends with a tool result in the KV that no assistant answer in stored history accounts for.** That is
§7.12's mechanism, surviving as an edge case instead of the rule.

⚠️ **What this does NOT establish, and it matters before anyone celebrates.** These arms ran
`thinking: "off"`. §7.9 measured that think blocks entering the KV and vanishing from re-rendered
history are themselves a divergence worth 295 s → 160 s per turn, and §7.29 measured the same
mechanism on Qwen costing 104–138 s. **With thinking off, one of the two divergence sources is
switched off entirely**, so this may be measuring a configuration rather than a fix. §7.12's own
numbers came from a smoke run whose thinking mode is not recorded either. **Neither section can be
retracted against the other until one arm runs with thinking on.**

**What changes in the plan.** The tool-round replay drops from "the next thing to build" to "a fix
for a 1-in-16 edge case", and the cheap work in front of it is now:
1. one arm with **`thinking: "default"`**, which is the shipping configuration and the only way to
   tell a fix from a switched-off variable;
2. reproduce the `rounds: 1` + `executed: 1` path deliberately and see whether it always costs the
   whole cache.

**Limits.** n=16, one campaign, one model, CI emulator, `thinking: "off"`, and the six jobs that died
at 13–15 minutes mean these are surviving seeds. `reuseFrac` here is `reusedTokens/promptTokens` from
the engine's own `reusing n/m` line, not an inference.

### 7.36 MEASURED 2026-08-21: prefill scales with threads on the Jelly — §7.32's "the little cores are pacing the batch" is refuted, and the reproducibility is the surprising part

§7.32 asked whether running prefill on 8 threads is a mistake on a 6×A55 + 2×A76 phone, since
llama.cpp finishes a batch when its slowest thread does and the A55s have a third of an A76's
capacity. It is not a mistake. **More threads is monotonically faster.**

Measured on the prewarm — `KALSA_PREWARM {"op":"done","promptMs":…}`, a prompt eval of the same
static system+tools prefix with `n_predict: 0`, hash `730983069` identical on all eight arms, so the
work is provably the same every time. Decode fixed at 2, `.kvs` cleared between arms, on the charger,
thermal status 0 throughout. **Run twice, in ascending and descending order**, because the first run
had the arm order confounded with page-cache warm-up and temperature, both of which drift the same
way (§7.20 documents page-cache contamination producing exactly this artifact).

| prefill threads | ascending | descending | Δ | **mean ms** | prefill tok/s |
|---:|---:|---:|---:|---:|---:|
| 2 | 113 849 | 113 886 | **0.03 %** | **113 867** | 11.4 |
| 4 | 93 044 | 92 954 | **0.10 %** | **92 999** | 14.0 |
| 6 | 77 467 | 77 371 | **0.12 %** | **77 419** | 16.8 |
| 8 | 68 867 | 75 374 | 9.02 % | 72 121 | 18.0 |

⭐ **The reproducibility is the headline.** Reverse the order — so the confound now points *against*
the effect — and the 2, 4 and 6-thread arms come back within **0.1 %** of themselves. That is a
tighter repeat than anything else this project has measured on a phone, and it settles the
confound outright: this is thread scaling, not page cache and not temperature. Temperature rose
29.0 → 34.0 °C across the reversed run and moved those three numbers not at all.

⚠️ **6 and 8 are not distinguishable, and the table shows why.** The 8-thread arm is the only one
that failed to repeat: 68 867 against 75 374, a **9.0 %** spread, larger than the 7.3 % gap between
its own mean and the 6-thread mean. It was the *last* arm ascending and the *first* descending, so
the warm-up it is sensitive to is real — plausibly because at 8 threads the run is shortest, so a
fixed cold-start cost is a bigger fraction of it. **Do not quote 8 as better than 6.** Everything
below 6 is separated by margins 50× the repeat error.

**Scaling is sublinear and healthy**: 4× the threads buys **1.58×**, i.e. per-thread throughput falls
from 5.7 to 2.3 tok/s. Same shape as §7.20's S23 result (2 threads 13.26 vs 5 threads 21.32). The six
A55s are not free, but they are not dead weight either — they carry roughly a third of an A76 each,
which is exactly what `cpu_capacity` 348 against 1024 predicts.

✅ **`deviceTuning.ts`'s `helio-g99` preset needs no change.** `prefillThreads: 8` is at or above the
plateau, and whoever calibrated it was right. §7.32's open question is closed, negatively, and that
is worth the two runs — the alternative was shipping a hunch.

⛔ **The product consequence is the uncomfortable one.** The prewarm costs **69–114 s on this phone
and no thread setting fixes it** — the best arm is still over a minute. Prefill is not where a
tuning knob is going to save this device; §7.30 already showed the lever that works, and it is not
tuning: a restored session turns that 120.8 s cold start into **1.8 s**. So the prewarm only ever
pays on a genuinely cold start with no session on disk, and the UFS session pool is what makes those
rare. **The 3 203-character system prompt and 3 tool schemas that make up that ~1 300-token prefix
are the other lever, and nobody has costed trimming them.**

**Limits.** One phone, one model (KEXP), n=2 per arm and only because the second run was a
deliberate control. All eight arms are on the charger, and all report `thermal=0`, so nothing here
describes throttled behaviour. The prewarm prefix is ~1 300 tokens; scaling on a 4 000-token chat
prompt is not measured and may differ. Harness notes, not product defects: `tap_node` missed the
`Send` node on every arm and fell through to the Italian `Invia` label, and a "Tap to reload" banner
appeared on three arms where the tap was reported missed — the sends succeeded anyway, but the UI
driver is fragile enough that a future run should verify rather than assume.

### 7.35 VACUOUS 2026-08-21: the anchored campaign never moved its boundary — the arm that was supposed to be measured never ran, and both knobs that would have made it run were left empty

Campaign `32503221846`, `fase4` on **LFM2.5-8B-A1B**, 6 seeds × 4 arms × 16 turns, launched to settle
§9's open question — does the `anchored` window beat the legacy sliding window in long
conversations. 34 of 40 jobs produced a `result.json`. The arms are **indistinguishable**, and the
positive control says why.

| arm | seeds | mean `reuseFrac` | miss rate (<0.5) | mean `promptMs` |
|---|---:|---:|---:|---:|
| baseline | 4 | 0.951 | 3.1 % | 20 326 |
| **anchored** | 6 | 0.956 | 2.1 % | 19 219 |
| ciswire | 5 | 0.965 | 1.3 % | 25 147 |
| nogate | 3 | 0.980 | 0 % | 18 539 |

⛔ **Do not read that as "anchored is no better". Read the positive control instead.**

| arm | `boundaryByTurn` | `digestCharsByTurn` |
|---|---|---|
| **anchored**, all 6 seeds | **0 on every one of the 16 turns** | 0 |
| ciswire, all 5 seeds | 0 → 6 → 12 → 18 → 24 | **0 on every turn** |
| baseline, all 4 seeds | `null` (regime has no boundary) | 0 |

`anchored` is defined as a **boundary→end** window that rebuilds when the character budget is
exceeded (`compactor.ts:260`). With the boundary pinned at 0 for all sixteen turns it rendered the
**entire history from index 0** — which is not a window at all, and is indistinguishable from
`baseline` on a conversation that fits the context. `promptTokens` confirms it independently: it
grows monotonically 1 546 → 4 201 across the sixteen turns in **every** arm, so nothing was ever
evicted anywhere.

**Why the boundary never moved, and it is not a bug.** It advances only when
`anchoredWindowExceedsBudget` fires, and the bench exposes exactly the knob that controls that —
`winbudget`, *"Bench-only verbatim-window char budget (empty = 16000). **Controls how often
compaction fires.**"* A 16-turn fase4 conversation never approaches 16 000 characters. Its sibling
`legacywindow` does the same job for the baseline arm. **I launched the campaign with both empty.**
That is the whole defect: the experiment could not have produced a difference, because neither
regime was ever asked to evict anything.

⛔ **RETRACTED WITHIN THE HOUR, mine.** The first version of this paragraph said `ciswire` had
*"evicted the oldest turns and put nothing in their place — strictly worse than `baseline` by
construction"*. **That is wrong. It evicted nothing.** A trace of the live path shows why, and the
mistake was reading a stale doc instead of the code:

- `AppShell.tsx:4541-4552` calls **`windowStartIndex`** — the derived profile from
  `windowProfile.ts` — **not** `legacyWindowStartIndex`. The 20-message legacy cap is no longer the
  live path for the engine window. At `n_ctx` 8192 the budget is `(8192−2048) × 3` chars times the
  regime's share: **13 824 characters** with no digest, **11 059** for `ciswire`, against
  `WINDOW_MAX_MESSAGES = 40`.
- A 16-turn fase4 conversation is **30 messages and ~7 653 characters**. It fits, entirely, in
  every arm. So `legacyWindowStart = 0`, `splitAtBoundary(...).older = []`, and the digest corpus is
  empty because **there is nothing outside the window** — not because retrieval failed.
- The `boundaryByTurn` 0/6/12/18/24 I read as eviction is **the compactor state's rebuild cadence**
  (K=3 user turns, R=6 messages), and `ciswire` does not use it for the engine window at all:
  `AppShell.tsx:4754` passes `compactionEnabled: contextMode === "anchored"`, which is false here.
- `RetrieverIndex.documentCount` **is** a number, so the `corpusSize: 0` trap I flagged in
  `buildDigest` did not fire and the zero is truthful.

So `ciswire` at these lengths is **identical to `off`**, not worse than it. The correct reading of
this campaign is simpler and applies to every arm at once: **nothing was evicted anywhere**, because
the live window comfortably held the whole conversation.

⭐ **Which reframes the question, and this is the part worth keeping.** §7.12 called the sliding
window *"the dominant destroyer in a real conversation"* and measured reuse collapsing from 0.82 to
0.15 at turn 12 on `LEGACY_MAX_HISTORY = 20`. **That path is gone from production.** The window is
now 40 messages under a character budget, so at sixteen turns it never slides — which is exactly
what the 0.95–0.98 reuse below shows, in every arm including `baseline`. The `anchored` regime was
built to fix a collapse that the window-profile work had already removed at these lengths.
**The open question is no longer "does anchored beat the sliding window" but "at what conversation
length does the derived window start evicting, and does anchored help there".** §9's "a ciswire arm
needs ≥12 turns" is wrong for the same reason: it was arithmetic against the 20-message cap, and
that cap is not what runs.

✅ **One real result survives, and it contradicts §7.12 on the model we ship.** With thinking off and
no eviction, KV reuse on LFM2.5-8B-A1B is **0.95–0.98 at every turn, in every arm** — including
turn 12, which is `probe_tool` with `rounds: 2`, where `reuseFrac` is **0.993**. §7.12 measured that
"a tool call is a guaranteed total loss on this model" (10 of 10 tool-preceded turns lost the whole
cache) and that reuse there was strictly bimodal, 0 or 0.98. **Neither reproduces here.** The turn-12
`promptMs` spike (108–140 s across arms) is the tool round's second prefill summed into one turn, not
a cache miss. What changed since §7.12 is not established — candidates are the merge's KV work and
`preserveThinking`, and the arms ran `thinking: "off"`, which removes §7.9's think-block divergence
entirely. **This is a reason to re-run §7.12's tool claim, not to retract it yet.**

**The corrective run, stated so it is not got wrong twice:** same phase and model, with
`winbudget` and `legacywindow` set low enough that both regimes actually evict inside sixteen turns,
and the acceptance criterion checked **before** reading any speed number — `boundaryByTurn` must
advance in `anchored`, and `promptTokens` must stop growing monotonically in `baseline`. If either
fails, the run is vacuous again and no comparison may be quoted from it.

**Limits.** `thinking: "off"` is hardcoded in the whole fase4 matrix and is not the shipping
configuration (decision of 2026-08-18). Six of forty jobs died at a tight 13.0–15.2 minutes with no
`result.json`; the cause is unread and the surviving seeds are therefore a survivor sample — 4 of 6
baseline, 3 of 6 nogate.

### 7.34 MEASURED 2026-08-21: `tok/s` is tokenizer-blind, and on Italian that hides 12 points — Qwen3.5-2B delivers more Italian per second than LFM2.5-2.6B

Owner's question: *"se il Qwen 3.5 2B è un chatbot MOLTO migliore dell'LFM, allora anche se più
lento, vince il Qwen."* Checking the premise first turned up that **"più lento" is not established** —
because every speed number in §2.1 is in tokens per second, and a token is not the same amount of
Italian in the two models.

**Measured, and reproduced in this tree before being written down.** HF tokenizers via
`AutoTokenizer.from_pretrained`, `add_special_tokens=False`, on the first 30 000 UTF-8 bytes of
`kalsa-moe-experiments/corpus/multi5/it.txt` (the Wikipedia IT *"Caffè"* text, 29 602 characters),
with a 5 000-byte English control:

| | vocab (loaded) | Italian tokens | **chars/token, IT** | English tokens | chars/token, EN |
|---|---:|---:|---:|---:|---:|
| LFM2.5-2.6B | 124 893 | **8 233** | **3.596** | 1 101 | 4.522 |
| Qwen3.5-2B | 248 044 | **7 382** | **4.010** | 1 105 | 4.506 |

**Qwen needs 10.3 % fewer tokens for the same Italian paragraph, and English is a dead heat**
(1105 vs 1101, 0.4 %). So the larger vocabulary is not a general win — it is specifically an
Italian win, which is the language this app is for.

⚠️ **Register matters, and the 10.3 % above is the best case for Qwen — measured, same day.** The
Wikipedia sample is long encyclopedic prose. Re-run on two samples closer to the product:

| sample | LFM chars/token | Qwen chars/token | **Qwen needs fewer** |
|---|---:|---:|---:|
| Wikipedia IT "Caffè", 30 kB | 3.596 | 4.010 | **10.3 %** |
| **Kalsa's own Italian UI strings**, 27 kB (accents, punctuation) | 3.618 | 3.887 | **6.9 %** |
| the bench's Italian prompts, 1.8 kB (short turns) | 3.485 | 3.576 | 2.5 % |

The UI-strings row is the closest to the register the product writes in, so **~7 % is the honest
number and 10.3 % is the ceiling.** The third row is not a register result and should not be read as
one: `ci-bench.sh` strips accents and punctuation on purpose (`adb shell input text` mangles them),
so those prompts are not Italian as a user types it — worth knowing separately, since it means our
own bench prompts under-represent real Italian tokenization for **both** models.

Recomputed on the 6.9 % figure, the ranking still moves but less: LFM2.5-2.6B **19.8** Italian
chars/s, Qwen3.5-2B **23.3**, KEXP **25.5** — Qwen **+17.8 %** over the 2.6B (not 22.3), KEXP
**+9.5 %** over Qwen (not 5.4), and LFM2.5-2.6B reads **41 %** more memory per Italian character
(not 46). Every conclusion below holds in direction; the magnitudes are the ceiling, not the
expectation.

⭐ **Put that against §7.31's bytes-per-token and the ranking changes.**

| | MB/token (§7.31) | chars/token IT | **MB per Italian character** | Jelly decode (§7.28) | **Italian chars/s** |
|---|---:|---:|---:|---:|---:|
| LFM2.5-2.6B | 1666.2 | 3.596 | **463.4** | 5.47 tok/s | **19.7** |
| Qwen3.5-2B | 1269.9 | 4.010 | **316.7** | 6.00 tok/s | **24.1** |
| LFM2.5-8B-A1B-KEXP | 848 | 3.596 (same 128k vocab) | 235.8 | 7.05 tok/s | **25.3** |

**LFM2.5-2.6B reads 46 % more memory per character of Italian than Qwen3.5-2B does.** Qwen's
248 320-token vocabulary costs it 417 MB per token in output-head reads (§7.31) and **more than earns
it back** on this language.

Two rankings move:
1. **Qwen3.5-2B is 22 % faster than LFM2.5-2.6B in delivered Italian**, where the `tok/s` column
   shows it only 10 % ahead. Twelve points of the gap were hidden by the unit.
2. **KEXP's lead over Qwen3.5-2B collapses from +17.5 % to +5.4 %.** On the Jelly, in Italian, they
   are nearly the same speed.

And it is not only speed: 10.3 % fewer tokens is also **10.3 % more Italian conversation inside the
same 8192-token context**, which is the budget §7.12's window collapse is fighting over.

**On quality, which is the actual question, we have one independent Italian number and it does not
favour us.** EuroEval's Italian generative leaderboard (extracted and re-read locally), mean rank
score, **lower is better**: `Qwen/Qwen3.5-2B (val)` **2.69 ± 0.23** against
`LiquidAI/LFM2.5-8B-A1B (val)` **3.53 ± 0.25**. **LFM2.5-2.6B is not in the table at all.**

⚠️ **Do not quote that as "Qwen beats our model on Italian" yet, for a reason visible in the same
row.** `LFM2.5-8B-A1B-Base` scores **2.89** — the *instruct* model is worse than its own base — and
on one task pair the instruct model collapses to `14.35 ± 3.27 / 7.53 ± 1.51` where Qwen scores
`69.42 ± 0.80 / 48.73 ± 0.71`. A tuned model losing to its own base, with one task at a tenth of the
comparator, is the signature of a harness mishandling an output format — this model emits
`<think>` blocks and Pythonic tool calls — not of a capability gap. **Unresolved, and worth
resolving:** if it is real we have a problem, and if it is the harness then EuroEval understates
every LFM2.5 model in the same way.

**What we do NOT have, stated plainly.** No graded campaign on LFM2.5-2.6B (still true). No graded
PPL/bpb or instruction score on Qwen3.5-2B in our tree either — only speed and a greedy-identity
check. The vendor numbers are not a bake-off: Liquid reports BFCLv4 56.88 / IFBench 59.17 for the
2.6B, Qwen reports BFCL-V4 43.6 / IFEval 61.2 for the 2B, on different harnesses. Our own multi5
Italian bpb exists only for the 8B family: LFM2.5-8B-A1B Q4_K_M **1.3206**, KEXP **1.4115** at k=4.

**Languages.** Both cards list Italian. LFM2.5-2.6B's card adds Vietnamese, Thai, Indonesian, Hindi,
Russian and Polish over the 8B's ten. Qwen3.5-2B's card claims "201 languages and dialects" without
enumerating them. Neither vendor publishes a per-language Italian score. Liquid states its
65K→128K expansion mainly helps under-tokenized Thai/Bengali/Vietnamese/Hindi — **a bias away from
Italian**, which is consistent with the measurement above.

**Limits.** One Italian text, one register — encyclopedic prose about coffee. Chat Italian, with
short turns, names and punctuation, may tokenize differently, and that is the register the product
actually runs in. The decode figures are §7.28's n=1 four-turn fresh-chat arms and cannot see the
turn-11 collapse. Nothing here measures answer quality on our prompts; the chars/s table is a
throughput statement, not a good-chatbot statement.

### 7.33 CROSS-TREE 2026-08-21: the GPU question, answered from evidence that already existed — and the owner's battery hypothesis is measured and refuted

Asked because the owner is deciding whether to commission Vulkan/OpenCL kernel work on the parallel
llama.cpp branch. His prior: *"la velocità non credo, ma calore/batteria forse"*. Both halves are
answerable today, and one of them is answerable in the opposite direction. Everything below is from
the sibling repo or from llama.cpp source **checked out locally**, and every load-bearing line was
re-read in this tree before being repeated here.

⛔ **RETRACTED IN PART, same day, by the parallel session — and the warning was already in this
file.** The decode row below (0.41-0.44×) is quoted from §7.16, which says of that very figure:
*"Either the 750 figure predates the kernel work, or the two describe different quants/paths. **Do
not average them and do not pick one** — the next Adreno 750-class measurement settles it."* I
quoted it as settled anyway. Worse, `KALSA.md:308` records that on our `llama.rn 0.12.8` tree
`use_adreno_moe_kernels` excludes `A7X` and **730/740/750 are all A7X**, so K-quant MoE **never
reached the GPU at all** — every "GPU decode" number we hold measured CPU fallback with graph
splits, not a GPU.

**The parallel session has since repaired the OpenCL expert kernels and measured on the S23:
experts on GPU = 2.17× burst and 1.5× sustained against experts on CPU, at a lower temperature.**
No prior benchmark anywhere could have contained that number, because the kernels were broken or
gated off for everyone. That supersedes the decode row below on Adreno.

**Three further corrections owed:**
1. **"Try Vulkan, not OpenCL" is probably backwards on Adreno.** Vulkan kernels *existing* (§7.33
   point 3, still true) is not Vulkan being fast on this silicon — Qualcomm's investment is in the
   Adreno-specific OpenCL path, which is exactly the one §7.16 documents as present-but-gated. The
   correct statement is the one this section itself made and then failed to apply: **`supports_op`
   says allowed, not correct and not fast.**
2. **"That split is not a flag" is imprecise.** Trunk-vs-expert placement *is* a flag —
   `--n-cpu-moe` / `--override-tensor`, in use in their benches. My point was about a *temporal*
   split (GPU prefill, CPU decode), which is a different thing and is moot if the GPU wins decode.
3. **The energy conclusion below was contingent on the GPU being slower.** 0.61 % vs 0.79 % per 1k
   tokens was measured on a **dense** Qwen3.5-2B with the GPU running at 0.67× the CPU's speed.
   Faster *and* cooler inverts that arithmetic, and their configuration is MoE experts, not a dense
   model. **The battery claim does not transfer to their arm and must not be quoted against it.**

**What still stands:** the Adreno 750 *prefill* ratios (a dense-path measurement, untouched by the
expert-kernel question), the observation that GPU decode is thermally flat where CPU decays 16 %,
and the Mali conclusion — nothing in the Adreno work touches a Mali-G57/G68.

**Open, and their proposal is the right one:** a Vulkan-vs-OpenCL cell on the S23, same model, same
`-ngl`, same protocol, after their S4 lands. That settles which backend this silicon actually wants,
with a number instead of an inference from `supports_op`.

**1. Decode on GPU loses. Prefill on GPU wins by 5-6×.**

| | CPU | GPU | ratio |
|---|---:|---:|---:|
| **prefill**, Xiaomi 14 / **Adreno 750**, Qwen3.5-2B Q4_K_M, unplugged, `llama-bench -t 6 -r 2` | 31.5 / 35.9 / 38.4 / 51.1 t/s at pp 128/512/1024/2048 | 181.7 / 214.5 / 216.3 / 211.6 | **5.77 / 5.97 / 5.63 / 4.14×** |
| prefill, real TTFT median, same device | 38.25 | 201.05 | **5.26×** |
| decode, Adreno 750 | 16.15 | 7.07 | **0.44×** |
| decode, Adreno 740 | 12.37 | 5.06 | 0.41× |

The prefill ratio is measured on the **shipping GPU class**, unplugged, two samples per cell — not
on the Adreno 740 whose negative result §7.16 correctly refused to generalise. And prefill is where
this app spends the user's wait (§7.30: 77.7 s of a 120.8 s cold start).

**2. ⛔ The battery hypothesis is refuted, and the mechanism is not the one it sounds like.**
S23, unplugged, 15 minutes per arm, cooldown between arms
(`kalsa-moe-experiments/reports/moe-gpu-sustained.md:139-142`):

| arm | first third | final third | degradation | end temp | **battery per 1k tokens** |
|---|---:|---:|---:|---:|---:|
| CPU `-ngl 0` | 12.2 | **10.2** | **−16 %**, still rising | **42.3 °C** | **0.61 %** |
| GPU `-ngl 99 -fa off` | 8.2 | **8.2** | **0 %**, plateau | **38.5 °C** | **0.79 %** |

**The GPU is 4 °C cooler and perfectly flat — and spends 30 % more battery per token**, because it
is slower and therefore stays on longer. Thermal stability is real and is a genuine product
property; energy efficiency is the opposite of the guess. Same outcome on the 4B: CPU ends at 5.0
against the GPU's 4.0, GPU 0.80× sustained. **Cooler is not cheaper.**

**3. ⭐ For Vulkan there is no kernel to write. This is the finding that changes the question.**
Verified in this tree, not inferred:
`kalsa-engine/third_party/llama.cpp/ggml/src/ggml-vulkan/ggml-vulkan.cpp:17254-17255` lists
`case GGML_TYPE_Q2_K:` and `case GGML_TYPE_Q3_K:` under `MUL_MAT_ID`, and the pipelines are real —
`:4330-4331` create `matmul_id_subgroup_q2_k_f16` and `matmul_id_subgroup_q3_k_f16`, with f32
variants at `:4453-4454`. **KEXP's 2-and-3-bit experts already have Vulkan kernels.** `SSM_CONV` is
present too. The `lfm2` / `lfm2moe` graph is covered on Vulkan today.

**OpenCL is the one that would need writing**, and it is the backend our S23 arms used.
`ggml-opencl.cpp:6688-6713` admits q4_0/q8_0/MXFP4 and selected Adreno q4/q5/q6 for `MUL_MAT_ID` —
**not** q2_K/q3_K — and ordinary q3_K `MUL_MAT` reaches
`GGML_ASSERT(false && "not implemented")` at `:19204-19221`. So every KEXP expert matmul falls back
to CPU on OpenCL, and a rejected op means the ggml scheduler splits the graph with a sync and an
activation copy per split.

**4. Mali is not a target.** Dimensity 900 / Mali-G68, Llama-3.2-3B Q4_K_M: CPU 6.0 prefill /
3.9 decode against Vulkan 1.2 / 2.9 — **0.20× and 0.74×**, i.e. the GPU loses both ends. The Jelly's
Mali-G57 is in that class. Nothing here argues for GPU work aimed at the Jelly.

**What this means for the commission.** The shape of the only win the evidence supports is **GPU for
prefill, CPU for decode** — 5.3-6.0× on the half that dominates the wait, and staying off the half
where the GPU is 0.44×. ⚠️ **That split is not a flag.** llama.cpp does not switch backends
mid-context, so it is real engineering, and its cost is **UNMEASURED** here. What is *not* needed is
what the question assumed: writing q2/q3 kernels, at least for Vulkan.

**Limits.** No number here was taken on a phone we ship to, in our app, on our model. The prefill
5.26-5.97× is Qwen3.5-2B, not LFM2 — LFM2's short-conv graph has no published GPU ratio, and §7.17
is a standing reminder that a GPU arm can fail to test the GPU at all. Thermal/energy is S23 /
Adreno 740 only; for Adreno 750+ and for Mali, joules per token GPU-vs-CPU is **NOT PUBLISHED**.
The Vulkan coverage above is `supports_op` and pipeline creation read in source — **allowed is not
correct, and not fast**; §7.16's own MXFP4 note makes exactly that point.

### 7.32 MEASURED 2026-08-21: the Jelly's CPU and storage, and the one tuning question the numbers open

Read-only pass on the Jelly Star (on the charger, thermal status 0 throughout), taken because
§7.28 concluded this phone is **dequant-bound** — i.e. its limit is CPU work, not bytes — and nobody
had looked at what CPU it actually has or where our threads land.

**Topology.** `/proc/cpuinfo` CPU part and `cpu_capacity`, both read per core:

| cores | part | max freq | `cpu_capacity` | governor |
|---|---|---:|---:|---|
| cpu0–5 | `0xd05` (**A55**) | 2 000 000 | 348 | policy0, file is `0660 system:system` — unreadable from shell |
| cpu6–7 | `0xd0b` (**A76**) | 2 200 000 | 1024 | `sugov_ext` |

**Our thread split is already hand-tuned, and it was not obvious that it would be.**
`deviceTuning.ts:180-188` carries a measured preset for this exact SoC —
`{ id: "helio-g99", decodeThreads: 2, prefillThreads: 8, capacitySignature: [348 ×6, 1024 ×2] }` —
resolved as `n_threads: 2`, `n_threads_batch: 8`, provenance `soc-preset:helio-g99`
(`deviceTuning.ts:400-405`). Decode on two threads is exactly the two A76s. No bench override is set
on the device (`kalsa.bench.engine` absent).

✅ **CLOSED, negatively, the same day by §7.36 — more threads is faster and the preset is right.**
Measured twice in opposite orders: prefill `promptMs` is 113 867 / 92 999 / 77 419 / 72 121 at
2/4/6/8 threads, and the 2/4/6 arms repeat to within **0.1 %** when the order is reversed. The A55s
contribute rather than pace. The paragraph below is preserved as the hypothesis it was.

⭐ **The open question this raises, and it aims at the dominant cost.** Prefill runs on **8** threads,
so six of them sit on cores with **a third** of an A76's capacity. llama.cpp splits a batch across
threads and the batch finishes when the slowest thread does, so on a 6+2 machine with a 3:1 capacity
split the six small cores can set the pace for all eight. Prefill is where this app spends most of
the user's wait (§7.30: 120.8 s of cold start, of which 77.7 s is a system-prompt prewarm). **Nobody
has measured prefill at 2 / 4 / 6 / 8 threads on this phone.** It is a knob, not a rewrite, and it
points at the biggest number we have.

⚠️ **Affinity is NOT established and the attempt should not be quoted.** Sampling
`/proc/<pid>/task/*/stat` field 39 on an idle-but-loaded app gave 48 of 89 threads last-running on
A55s and 41 on A76s, with the `mqt_v_native` threads concentrated on cpu6/cpu7. But no thread is
named `ggml`/`llama`, the app was **not** mid-turn, and "last ran on" is not "runs on". A real answer
samples during a decode.

**Storage: it is UFS, and the design note that assumed so is right for this phone.** Checked rather
than assumed, because a phone in this class could easily have been eMMC:
`/sys/class/block/sda` resolves under `.../platform/soc/11270000.ufshci/host0/...`,
`ro.boot.boot_devices` is `[bootdevice,soc/11270000.ufshci,11270000.ufshci]`, `userdata` is
`/dev/block/sdc60`, and there is **no `mmcblk*`** device. (`ro.vendor.mtk_emmc_support` is `1`, which
is a vendor flag and not the block layer — do not read it as evidence.)

`/data` is **f2fs**, mounted `rw,lazytime,noatime,background_gc=on,discard,inline_data,inline_dentry,extent_cache,mode=adaptive,fsync_mode=nobarrier`. 228 GB total, **137 GB free**, 40 % used — disk space is not a constraint on this device and the session pool is not near any limit.

**Sequential read, `dd bs=1m count=512` on a 5.15 GB GGUF the app was not using, three runs:**

| run | throughput | what it is |
|---|---:|---|
| 1 | **984 MB/s** | coldest available |
| 2 | 2.9 GB/s | page cache |
| 3 | 3.2 GB/s | page cache |

Two consequences worth carrying: a cold KEXP load has a **~3.4 s floor** (3.33 GB ÷ 0.984 GB/s) that
no engine tuning can remove; and re-reading weights from flash costs about a gigabyte per second, so
a page-fault storm of §7.14's size would be minutes of pure I/O — on the S23, which is a different
device and whose storage has not been measured this way.

**Session pool on disk:** 37 MB total — the live
`lfm2_002e5-8b-a1b-kexp__conv-…__3524921208.kvs` at 10 041 119 B, plus a **28 674 134 B
`qwen3.5-2b.kvs`** left by the old per-model scheme.

✅ **A suspicion raised and refuted in the same pass.** The legacy file looked like it would be
invisible to the pool and strand 28.7 MB of a 300 MB budget: `deleteLegacyModelSession` only ever
runs for the *active* model (`LlamaService.ts:1951, 2198`), so a legacy file for any other model is
never cleaned. But the budget does see it — `listPoolFiles` keys on `stemFromPooledName`, which just
strips the extension and does not require the new three-part stem, so the legacy file is counted in
the total and is evictable LRU like anything else. No defect. Recorded because the wrong version of
this paragraph was nearly written.

**Limits.** One phone, on the charger, idle-but-loaded — no measurement here was taken during
inference. `dd` through `run-as` on f2fs with no way to drop caches is not a storage benchmark; the
984 MB/s is "the coldest number we could get", not a cold-read spec. The A55 policy's governor could
not be read at all.

### 7.31 COMPUTED 2026-08-21: every dense `MB/token` we carried was too LOW — the tied output head is read in full on every token, and on one model it is a third of the bill

§7.28 discounted its own throughput spread with *"the two dense `MB/tok` figures are estimated from
file size, an over-estimate, so part of the 46 % may be estimation error"*, and asked for the tensor
map before treating the spread as a design constant. Done here, and **the estimates were low, not
high** — so the caveat pointed the wrong way.

Method: the GGUF tensor index read straight off the pinned Hugging Face revisions in
`ModelRegistry.ts` with an HTTP range request (first 25 MB — header, metadata and the full tensor
index; the weights are never downloaded), then per-tensor bytes from dims and the ggml block sizes.
Arithmetic on the file, not a measurement on a phone.

| | arch | blocks | `token_embd` | **MB/token** | file | old estimate |
|---|---|---:|---:|---:|---:|---|
| **LFM2.5-2.6B** | `lfm2`, 30 blocks, d 2048, vocab 128 000 | 1451.2 MB | **215.0 MB** (Q6_K) | **1666.2** | 1674.5 MB | ~1600 — **4.1 % low** |
| **Qwen3.5-2B** | `qwen35`, 24 blocks, d 2048, vocab **248 320** | 852.7 MB | **417.2 MB** (Q6_K) | **1269.9** | 1280.8 MB | ~1230 — **3.2 % low** |

**Neither file has an `output.weight` tensor** — only `output_norm` — so on both the embedding is
**tied**, and the same matrix is read in full as the output projection for the logits of every
generated token. That is why a dense model's `MB/token` is essentially its whole tensor set, and why
file size is a *good* proxy for a dense model and a terrible one for a sparse one: KEXP reads 848 MB
against a 3330 MB file only because 28 of its 32 experts are skipped per token.

⭐ **Vocabulary size is a decode cost, and on a small model it is not a rounding error.**
Qwen3.5-2B's 248 320-token vocabulary costs **417 MB per generated token — 33 % of everything it
reads**, against 215 MB (13 %) for LFM2.5-2.6B's 128 000. Two models of nearly the same shape, and a
third of one's bandwidth bill is the tokenizer's fault. Worth remembering before treating vocab
expansion as free.

**What moves.** §7.28's effective-throughput table, recomputed on the same measured means
(5.47 / 6.00 / 7.05 tok/s):

| | old | **corrected** |
|---|---:|---:|
| LFM2.5-2.6B, q4_K_M | 8.75 GB/s | **9.11 GB/s** |
| Qwen3.5-2B, q4_K_M | 7.37 GB/s | **7.61 GB/s** |
| KEXP, q2_K/q3_K | 5.98 GB/s | 5.98 GB/s (already tensor-map) |

The spread by packing alone on one phone is **52 %, not 46 %** — larger than §7.28 reported, and
none of it is estimation error. The S23 predictions move the other way and get slightly worse:
LFM2.5-2.6B **13.1** tok/s (was quoted 13.6 in chat, 13.0 in §2.1) and Qwen3.5-2B **17.2** (was
17.7), both still unmeasured, both from the 21.8 GB/s q4_K_M constant the S23's Qwen3.5-4B row
implies.

⚠️ **A provenance label that was wrong:** §2.1's LFM2.5-VL-3B row carried *"1674 (from the GGUF)"*.
1674.45 MB is the **file size** of LFM2.5-2.6B, not a tensor-map figure from the VL model. The
number happened to land within 0.5 % of the right one (1666), so no conclusion moves — but it was
not computed the way the column header promises, and the column header is the reason anyone trusts
it.

**Limits.** This is arithmetic, not a measurement. It assumes every block tensor is read once per
token and the tied head once, which holds for a dense decoder at batch 1 and is exactly what the
`MB/token` column claims to mean. It does **not** model the KV cache, activations, or the VL model's
583 MB `mmproj` — a vision turn reads more than this number says. And it says nothing about
*achieved* bandwidth, which §7.28 shows varies 52 % by quant family on one phone.

### 7.30 MEASURED 2026-08-21: the prewarm now stands aside — 120.8 s of cold start becomes 1.8 s, and the diagnostic built to keep us honest is the last thing still lying

§7.29 landed two fixes and could not measure the first one, because no APK carried the merge.
This is that APK: `d2f34eb` (`bench/jelly-minsdk33-v2`, minSdk 33 for the Jelly, **not** for the
merge). Jelly Star, on the charger, KEXP, `norepack=1`, `thinking=off`, `compaction=0` — §7.29's
configuration kept deliberately, so the **APK is the only variable that moved**. Protocol per
cycle: `force-stop` → relaunch → wait for Ready → one continuation turn. Five cycles, 326 s.

| cycle | what the prewarm did | turn prefill | decode |
|---|---|---:|---:|
| 1 — cold, no `.kvs` on disk | `op:"start"` → `op:"done"` **promptMs 77 693.7** | **43 071.9 ms** (`reusing 1189/1801`) | 7.43 |
| 2 — after force-stop | **`op:"skip"`, `reason:"restored_kv"`** | **2 079.9 ms** | 7.04 |
| 3 | **`skip` / `restored_kv`** | **1 788.2 ms** | 7.12 |
| 4 | **`skip` / `restored_kv`** | **1 760.8 ms** | 7.10 |
| 5 | **`skip` / `restored_kv`** | **1 933.8 ms** | 7.26 |

✅ **The claim §7.29 could not test is confirmed.** The prewarm skipped on **every one of the eight
restore events** in the run — two per cycle, because the `kalsa://share` deep link backgrounds RN
and the engine re-inits, so each cycle exercises the restore path twice and both times the prewarm
stands aside. Cold start costs 77.7 s of prewarm plus 43.1 s of turn prefill, i.e. **120.8 s before
the first token**; a restored session costs **1.76–2.08 s**, mean 1.89. Session load is 35–72 ms for
1814–1946 tokens. Decode is 7.04–7.43 across all five cycles, which reproduces §7.28's 6.80–7.31 on
this phone and quant — the run is internally consistent with the only other in-app measurement we
have.

✅ **The per-conversation pool key works on the phone**, and this is the first sight of it:
`files/sessions/lfm2_002e5-8b-a1b-kexp__conv-1787321650710-my3somud__3524921208.kvs`. Model,
conversation, prompt-environment hash — the key §7.25 said was the missing piece.

⛔ **Four defects the run exposed, none of which it was looking for.**

1. **`KALSA_KVDIAG` reports `n_past: 0` on every restore while 1814–1946 tokens are resident and
   being reused.** That field is hardcoded to 0 for hybrid/kvUnified models
   (`TTFT_FIXES.md`, "KVDIAG honesty (V2-4)": *"`n_past` | `0` for hybrid/kvUnified (native wipes;
   do not repeat the JS lie)"*), and it was written on **Q6.c — the assumption §7.29 refuted**. The
   diagnostic that exists to stop us claiming reuse we do not have now denies reuse we *do* have.
   It should report what the restore actually populated. Note this also means §7.29's `n_past`
   column did not come from this line, and where it did come from is not recorded there.
2. **`KALSA_PREWARM {"match":false,"prewarm":null,"send":"730983069"}` logs a hash miss on every
   send that in fact reused the entire session.** `prewarmPrefixHash` is null precisely *because*
   the prewarm correctly skipped. Same family as (1): a match diagnostic decoupled from actual
   reuse.
3. **The disk gate over-charges by 12.7×, measured on the shipping model.** `estimatedBytes` is
   127 533 056 for 1946 tokens (~65 kB/token, `estimateSessionBytes`'s constant) against a real file
   of **10 041 119 B — 5.16 kB/token**, which reproduces §7.25's ~5.2 kB/token on a second
   conversation. §9's open question 4 predicted 19× from the constants; the measured figure on this
   model is 12.7×. Consequence for the pool: a 300 MB budget bills ~2 conversations where ~30 fit.
4. **Every turn writes the session twice.** Two `op:"save"` lines 60–190 ms apart, and after a
   restore they are byte-identical (same `tokens`, same `hash`, same `messageCount`). That is ~10 MB
   written twice per turn against the UFS budget the pool exists to conserve.

⚠️ **`tokensEvaluated` is the prompt length, not the tokens computed.** Cycle 2 reports 1836
"evaluated" in 2.08 s where cycle 1 computed 612 in 43.1 s (70 ms/token). Telemetry alone therefore
cannot report reuse on this path; `promptMs` is the only signal in it that can.

**Limits, and they are not small.**
- One phone, one model, one conversation, **n=4 restores**. On the charger — the 1.8 s figures are
  ratios against 120.8 s, not quotable product latencies.
- The conversation ran 1814 → 1946 tokens and **the 20-message window never slid**. This says
  nothing about §7.12's turn-11 collapse, which is the regime that actually decides the product.
- `thinking=off` and `compaction=0` are **not** the shipping configuration. They were kept to hold
  the APK as the only variable against §7.29. §7.29 itself does not record which thinking mode it
  ran, which is why this had to be assumed rather than matched.
- The native `restored state checkpoint: reusing n/m` line appears **once** in the whole run (cycle
  1, from the prewarm's own checkpoint) and **not** on any restore cycle. The 1.8–2.1 s is the
  evidence that reuse happened; the native line naming the count is absent, so the reused-token
  count on a restore is inferred from timing, not read.

### 7.29 MEASURED 2026-08-21: the hybrid restore is real — `n_past=1473` against the assumed 0, and what kills the cache is a prompt that is not an exact continuation

Ran to settle a disagreement that turned out not to be one. `TTFT_FIXES.md` assumes a hybrid
`loadSession` does **not** populate native KV ("Q6.c"), and the prewarm gate was built on that
assumption. §7.25 measured the opposite. Checking the source first: Q6.c is listed under
*"explicitly not in this branch — out of scope. We prewarm after restore and we log honest
KALSA_KVDIAG"*. **It was never measured.** It is a conservative assumption, honestly labelled, and
this section replaces it with a number. The claim that our two measurements contradicted each other
was wrong, and it was mine.

Jelly Star, on the charger (the signal is a 50× ratio, not a rate — no timing precision needed),
APK `fb941ef`, which **predates the prewarm**, so `loadSession` is measured alone. n=2 per model.

| after force-stop + relaunch | `n_past` on the next send | `promptMs` |
|---|---|---|
| **LFM2.5-8B-A1B-KEXP** (LFM2MoE, hybrid) | **1368 · 1473 · 1517 · 1604** | **4.30 · 2.14 · 2.00 · 1.99 s** |
| **Qwen3.5-2B** (hybrid, kvUnified) | **0 · 0** + `full cache clear` | **104.4 · 112.7 · 122.0 · 138.0 s** |

**The restore succeeds on both.** Qwen logs `is_hybrid=1 resumable=1` too and loads 1605 tokens in
43 ms. What differs is what happens at the *next prompt*:

```
KALSA_KVDIAG n_common=1591 total=1627 search_max=1591
no usable state checkpoint (recurrent/hybrid/SWA model), doing full cache clear
```

So the rule is not "hybrid restores are fake". It is: **the restore is real, and it is destroyed by
whoever sends a prompt that is not an exact continuation** — and on a recurrent model there is no
partial credit, so the whole cache goes. That is §7.12's bimodality seen from the restore side.

**Qwen's divergence is now measured, not inferred.** §7.28 deduced from the registry that
`qwen3.5-2b` declares `thinking` without `preserveThinking`; here the mechanism is on the wire — 14
reasoning tokens sit in KV and are absent from the re-rendered prompt. It also happens **without** a
force-stop (122 s), which is what proves the restore is not the failing part.

**Two fixes follow, both landed with this section:**

1. `shouldSkipPrewarmAfterRestore` no longer asks whether the model is dense. It asks whether the
   restore populated KV, because the architecture never told us that and the carve-out was built on
   the unmeasured Q6.c. On the merged branch the prewarm would otherwise `seq_rm` over a live
   1600-token session on the model we ship. Skipping is right for Qwen too: its KV is cleared at
   prompt time anyway, so the prewarm would not have survived either.
2. `preserveThinking: true` on `qwen3.5-2b` and `qwen3.5-4b-q3`. §7.28 called this hygiene; at
   104-138 s of prefill per turn it is not.

**Limits.** One phone, one APK, two models. Nothing here says what the prewarm does *after* the fix —
that needs a build carrying the merge, which does not exist yet. The 2 s figures are on the charger
and are ratios, not quotable rates.

### 7.28 MEASURED 2026-08-21: the two small models both lose to the 8B MoE on the Jelly — bytes per token beat file size, and one of them never reuses its cache at all

Ran to answer "does a smaller model rescue the Jelly", after §7.27 concluded — wrongly — that it
would. Unplugged, production config, 4 turns each, hand-rolled script.

| | quant | MB/tok | decode | prefill turns 2-4 |
|---|---|---:|---|---|
| **LFM2.5-8B-A1B-KEXP** | q2_K/q3_K | **848** (from the tensor map) | **7.31 · 7.14 · 6.95 · 6.80** | 2.7-3.0 s ✓ |
| LFM2.5-2.6B | Q4_K_M | ~1600 (est. from file — **1666.2**, §7.31) | 5.68 · 5.53 · 5.40 · 5.27 | 2.7-3.2 s ✓ |
| Qwen3.5-2B | Q4_K_M | ~1230 (est. from file — **1269.9**, §7.31) | 6.61 · 5.73 · 4.94 · 6.70 | **80.7 · 101.3 · 127.7 · 85.2 s ✗** |

**The sparse 8B beats both dense small models**, with a file 2-3× larger. Decode reads `MB/token`,
not the file, and a dense 2B reads more per token than a MoE with ~1B active. §7.27's "the Jelly
needs a smaller model" is retracted there and here: it needs a smaller **byte budget**, which is not
the same thing. The one force pushing the other way — q4_K unpacks cheaper than q2_K/q3_K on a
dequant-bound SoC — is real but did not compensate.

**Predictions were written before the run and scored after.** Qwen 2B ~8 (got ~6.0, over by 33 %),
the 2.6B ~6-7 (got ~5.5), neither reaches 20 tok/s (correct). Over-predicted twice. Contrast with
the S23, where the same method predicted Qwen3.5-4B at 8.1 against **8.06 measured**: the byte
budget holds where the machine is bandwidth-bound and fails where it is dequant-bound. That is the
rule for trusting it, and it was learned by getting it wrong here.

**Effective throughput is quant-dependent on this phone, and now has three points instead of an
assertion:**

| | tok/s × MB/tok |
|---|---:|
| LFM2.5-2.6B, q4_K_M | **8.75 GB/s** |
| Qwen3.5-2B, q4_K_M | 7.37 GB/s |
| KEXP, q2_K/q3_K | **5.98 GB/s** |

Same phone, same RAM, **46 % apart by packing alone**. A single scalar per device — the obvious way
to implement the §9 bandwidth gate — would be wrong by that much across quant families. Note the
term is throughput, not bandwidth: it folds memory traffic and dequantization cost into one number,
and on this SoC the second dominates. Caveat that cuts the other way: the two dense `MB/tok` figures
are estimated from file size, an over-estimate, so part of the 46 % may be estimation error. Compute
them from the tensor map before treating the spread as a design constant.

⛔ **RETRACTED the same day by §7.31 — the caveat above pointed the wrong way.** The tensor maps were
computed: LFM2.5-2.6B is **1666.2** MB/token and Qwen3.5-2B **1269.9**, so both file-size estimates
were **too low** (4.1 % and 3.2 %), not too high. The spread is **52 %, not 46 %**, and none of it is
estimation error. Corrected table, same measured means: LFM2.5-2.6B **9.11 GB/s**, Qwen3.5-2B
**7.61 GB/s**, KEXP 5.98 GB/s. The instruction in the last sentence was right and has been carried
out; the number it was hedging was the one that needed raising.

**Qwen3.5-2B never reuses its KV, and the cause is a missing flag, not the architecture.** Its
prefill stays at 80-128 s on every turn while the 2.6B drops to 2.8 s. It cannot be the sliding
window: at turn 2 nothing has fallen out of a 20-message window yet. The registry explains it —
`qwen3.5-2b` and `qwen3.5-4b-q3` declare `thinking` but **not** `preserveThinking`, while
`qwen3.5-4b` and all three LFM2 entries have it. The think block enters the KV and is then absent
from stored history, so the prompt diverges at the first assistant reply, every turn. §7.9 already
priced that flag: turn 295 s → 160 s. Inferred from the registry and the prefill curve, **not**
measured by toggling the flag.

**Limits.** n=1 per arm. **4-turn arms cannot see §7.23's degradation**, which appears around turn
11 when the window starts sliding — so every number here, KEXP's 7.31 included, is a fresh-chat
figure. Battery 53 % → 38 % across 8 turns, ~1.9 points per turn.

### 7.27 MEASURED 2026-08-21: unplugged on the Jelly, KEXP beats Q4_K_M by 1.7× — the opposite of what the CLI said, and neither is within 2.7× of the product floor

**First timings on this device that our own rules allow us to quote.** Every Jelly number before
this one was taken on the charger (§7.25, §7.26) and is therefore not a measurement. This arm ran
**unplugged**, screen held awake through a single shell invocation so the keep-awake restore trap
never fired in the gaps, battery 94 % → 82 % across both arms.

| | KEXP (3.33 GB) | Q4_K_M (5.15 GB) |
|---|---:|---:|
| decode tok/s | **7.31 · 7.14 · 6.95 · 6.80** | **4.23** (turn 1 only) |
| turn-1 prefill | 132.8 s for 1952 tok = **14.7 tok/s** | 250.1 s for 3182 tok = **12.7 tok/s** |
| prefill, turns 2–4 | **2.96 · 2.70 · 2.89 s** | turn 2 never completed in 420 s |
| `RssFile` | 3.42 GB | 5.15 GB |
| `MemAvailable` | **2.37 GB** | **0.92 GB** |
| `io_read` during the arm | **frozen** at 3 389 177 856 | crept 10.023 → 10.083 GB |

**The CLI ranking inverts inside the app, and that is the finding.** `docs/ALIVE.md` has Q4_K_M at
10.60 and KEXP at 8.83 on this same phone under `llama-cli`, which is why §2.1 carried "the Jelly is
dequant-bound, so cheaper unpacking wins → Q4_K_M". Inside Kalsa the order is reversed and the
margin is larger: **7.31 against 4.23**. The CLI measurement was not wrong — it was taken without
Kalsa's own ~1.5 GB in RAM. Add that and Q4_K_M is left with 0.92 GB of `MemAvailable`, where its
`io_read` counter keeps creeping (~60 MB over the arm) while KEXP's sits **exactly frozen**: not a
storm on §7.14's scale, but the difference between a model that is finished reading and one that
never quite is. **A quant must be benchmarked inside the binary that will ship it**; a CLI ranking
describes the kernel, not the product.

**The decode gap exceeds the byte ratio.** Files are 1.55× apart, decode is **1.73×** apart, while
prefill — which is compute-bound and touches every expert — is only **1.16×** apart. Bytes alone
predict neither number: the excess is what Q4_K_M pays to the reclaim path for running with a
quarter of the headroom.

**§7.25's KV restore is confirmed unplugged and across turns.** KEXP's prefill drops from 132.8 s to
**~2.8 s** from turn 2 onward, with `tokensCached` climbing 2253 → 2559 → 2883 → 3153. On this model
the cache is genuinely reused turn to turn on a second device.

**Product, stated plainly: the Jelly cannot run this model.** The owner's floor is 20 tok/s always.
The best result here is 7.31 and it is already the winning quant, so the gap is **2.7×** — that is
not a distance a quant choice closes. ⛔ **This section first said "the Jelly needs a smaller model".
That was wrong and it was mine.** Decode reads `MB/token`, not the file: a *dense* 2B reads more per
token (Qwen3.5-2B ~1230, LFM2.5-2.6B ~1600) than this *sparse* 8B does (848), so on bytes the small
models are the worse bet. The one force pushing the other way is unpacking cost — q4_K_M against
KEXP's q2_K/q3_K — which on this dequant-bound SoC is the binding term. Predicted before measuring,
so it can be falsified: neither reaches 20 tok/s; Qwen 2B ~8, the 2.6B ~6-7. The per-phone selection this
repo has been arguing for has its first hard "neither option qualifies" answer.

**Limits, and they are real.** n=1 per arm. The Q4_K_M arm has **one** decode number, because its
second turn never finished inside the 420 s cap, so "4.23" is a turn-1 figure being compared against
a 4-turn plateau — §7.20's own methodology rule says quote the plateau, and for Q4_K_M we do not
have one. The two arms also evaluated different prompt lengths (1952 vs 3182 tokens), so only the
prefill *rates* are comparable, not the wall-clocks. **Q4_K_M was not killed here**, unplugged,
across ~12 minutes — where the charging run in §7.26 lost it to a suspected lmkd at turn 8. Two runs,
two outcomes, one variable that was not controlled; nothing about the kill is settled.

**Instrument gap that blocked the real harness.** This arm ran under a hand-written batch script,
not `ci-bench.sh`, because `ci-bench.sh` cannot drive this phone: an earlier validation arm died at
turn 2 with the composer holding `Ricorda anche il coloRicorda anche il colored e Zaffiro…` — the
text injection double-lands on the Jelly and the three retry attempts each made it worse. Until that
is fixed, no graded multi-turn arm (tools, ciswire, thinking) can run on this device, and every
Jelly number will stay hand-rolled and ungraded.

### 7.26 MEASURED 2026-08-20: on a roomier phone the 4.80 GiB build goes 100 % resident — and is killed anyway. The gate needs headroom, not a fit.

The residency hypothesis, tested for the first time on a **second** device. Jelly Star, 5.78 GB of
`MemAvailable` with the app stopped, the **same** Q4_K_M file the S23 ran (md5
`f57def02e4e034d4f16ffa125977c45a`, verified at every hop), same `norepack=1` configuration, on the
charger — so the counters below are valid and any timing is not.

| sample | `RssFile` | `io_read_bytes` | `MemAvailable` |
|---|---:|---:|---:|
| PRE, app stopped | — | — | **6 055 428 kB** |
| t1 | 2 253 756 kB | 4.03 GB | 5 905 388 kB |
| **t2** | **5 160 316 kB — the whole file** | 9.82 GB | **833 812 kB** |
| t3–t7 | 5.16 GB, flat | 9.82 GB | ~810 000 kB |
| **t8** | — | — | **process dead, no reply produced** |

✅ **The hypothesis holds: residency is governed by available memory, not by file size.** The file
that sits at **51 %** on the S23 (4.0–4.2 GB available, §7.13) goes **100 % resident** on a phone
with 1.6 GB more. Everything §7.20–§7.24 built on that assumption was resting on a single device;
it now has a second point.

⛔ **And the correction nobody predicted: full residency is not survival.** Holding the whole file
drove `MemAvailable` to **0.83 GB**, and about two minutes later the process was gone — **no
telemetry line, the turn never completed**. The system let us load it and then took the app.

**So the rule the RAM gate needs is not `model ≤ available`. It is `model ≤ available − headroom`,
and headroom now has a measured lower bound: 0.8 GB is not enough.** Today `estimateMemory` models
non-evictable memory (repack + compute + KV) and is blind to page-cache residency, which is the
thing that actually decides between 22 tok/s, 0.26 tok/s, and a dead process. Two calibration points
now exist, and they fail in two different ways:

| | file | available | outcome |
|---|---|---|---|
| S23 | 5.15 GB | 4.0–4.2 GB | 51 % resident, survives, **25× slow** |
| Jelly | 5.15 GB | 5.78 GB | 100 % resident, **killed** |

The gate must refuse both, for different reasons.

⚠️ **Stated rather than implied:** the kill was **not** confirmed as `lmkd` in logcat — the app died
and the line was not recovered, so this says "killed", not "killed by lmkd". `read_bytes` reached
**9.82 GB for a 5.15 GB file**, i.e. it was read ~1.9× during load and settling, which is itself
unexplained. n=1, on the charger.

### 7.25 MEASURED 2026-08-20: the disk KV restore works on `lfm2moe` — 83.9 s of prefill becomes 1.5 s, and the UFS session pool is buildable

Measured on the **Jelly Star** (G99, Android 13, on the charger), KEXP selected, production config
(`no_extra_bufts:0`, no bench overrides), messages delivered by `kalsa://share?text=` deep link.

| | turn 1, cold | turn 2, after force-stop + relaunch |
|---|---:|---:|
| `promptMs` | **83 867.66** | **1 523.61** |
| `tokensEvaluated` | 1511 | 1690 |
| decode tok/s | 8.041 | 7.977 |

**55× less prefill**, and the engine says why in its own words:

```
RNLlama: loadSession:105 KALSA_KVRESUME n_tokens=1672 pos_max=1671 is_recurrent=0 is_hybrid=1 resumable=1
ReactNativeJS: KALSA_SESSION {"op":"load","ms":29,"ok":true,"tokens":1672}
RNLlama: loadPrompt:524 restored state checkpoint: reusing 1672/1747 prompt tokens
```

`is_hybrid=1` and `resumable=1`: the engine recognises the hybrid architecture as restorable, loads
the state in **29 ms**, and reuses **95.7 %** of the prompt.

✅ **llama.cpp #25913 does not apply to Kalsa, and this is now measured rather than reasoned.** That
issue is a `llama-server` `/slots` defect — the server fails to persist its own
`common_prompt_checkpoint` index (fix PR #26004 still open, not in our pin, llama.cpp **b10156**).
Kalsa never runs llama-server: `LlamaService.ts:1249` calls `ctx.saveSession()`, i.e. the low-level
`llama_state_seq_save_file`, which serialises hybrid recurrent state correctly.

**Size of the artefact:** the `.kvs` for 1672 tokens is **8 668 927 B**, i.e. **~5.2 kB per token**.
At the loaded 8192 context that projects to **~41 MB per conversation** — 5 % of what the model reads
for a *single* generated token. The KV is not big; we simply throw it away.

⛔ **What this unblocks, and what it does not.** `sessionPersistence.ts` keys the file per **model**:
`documents/sessions/${modelId}.kvs`. `AppShell.tsx:3237` states the consequence in a comment —
*"`.kvs` is kept at a time, so switch-back is always a cold start"* — so today **every chat switch
pays a full prefill**, which on this model is minutes. The mechanism to avoid it already works; what
is missing is the **key** (model + conversation + prompt-environment hash) and a **budget with LRU
eviction**. Owner's call, taken 2026-08-20: the budget lives on **UFS, not RAM** — 300 MB by default,
user-adjustable — because every anonymous megabyte moves the working set toward §7.20's 25× cliff,
and a restore costs 29 ms against a 100 ms write.

⚠️ It does **not** fix the turn-to-turn cost of §7.23. A restored state is only reusable if the next
prompt is an exact continuation; the moment the sliding window rewrites the beginning of the prompt,
the restored state is discarded exactly as the in-RAM one is today. **The pool and the append-only
transcript are the same fix seen from two ends**, and the transcript is the part they share.

**Cross-check obtained for free:** KEXP decoded at **8.04 tok/s inside Kalsa** on this phone against
**8.83 tok/s under the `moe-experiments` CLI** — a 9 % gap. On this device our stack loses nothing
meaningful to a bare llama-cli, which is the control §7.19 tried to establish indirectly and got
wrong.

⚠️ The phone was charging, so the absolute times are not product numbers. An 83.9 s → 1.5 s ratio is
not a charging artefact. n=1.

### 7.24 MEASURED 2026-08-20: the collapsed regime persisted for a whole arm — and the `ciswire` arm that revealed it was vacuous for an unrelated reason

Two `fase4` arms on KEXP, back to back on the S23, `norepack=1`, `THINKING=default`, unplugged:
`off` from 17:26 to 19:11 (16 turns, complete), then `ciswire` from ~19:15 (stopped at turn 9 by the
battery guard at 34 %).

**First, the arm is vacuous as a `ciswire` measurement, and the reason is arithmetic.** The pref was
written and verified on device (`kalsa.context.compaction|ciswire`), but at turn 9 the digest is
empty:

```
turn9/digest.jsonl        {"durationMs":0,"corpusSize":0,"selectedCount":0}
turn9/compactor_state     {"frozenDigest":"","rollingSummary":"","builtAtUserTurn":7,...}
```

`LEGACY_MAX_HISTORY` is 20 messages; turn 9 is 18 messages, so nothing had fallen out of the window
yet and there was nothing to summarise. The corpus would first become non-empty around **turn 11**.
This is §8's trap verbatim — *"a conversation too short against a 20-message window leaves the digest
empty, and `ciswire` then renders byte-identical to `off`"* — and it has now cost a third campaign.
**A `ciswire` arm shorter than ~12 turns cannot measure `ciswire`.**

**But because the two arms were byte-identical, they measured something else: run-to-run
reproducibility. And it is terrible.**

| turn | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| arm `off` | 18.2 | 20.6 | 20.3 | 17.2 | 17.0 | 8.2 | 6.7 | 16.4 | 16.9 |
| arm `ciswire` | **2.8** | **0.5** | **1.6** | **1.4** | **4.0** | **1.4** | **4.1** | **0.5** | **0.3** |

Same model, same file, same prompts, same prefs, one arm after the other. **The second arm never
exceeded 4.12 tok/s on any turn.** It began in the collapsed regime and stayed there for its whole
hour.

⚠️ **What this changes, and what it does not license us to say.** §7.20 established that the
collapsed regime is reachable and recoverable — contaminate the page cache and the very next turn
recovers (1.15 → 20.92). This arm shows it can also be **persistent**: entered near the end of the
first arm and never exited across sixteen attempted turns. For a consumer app that is a different
class of defect: not "the fifteenth reply is slow" but "after a long session the app stays slow,
including in a fresh chat".

⛔ **Two candidates, and this arm cannot separate them.** The phone was at **thermal status 2** and
~40 °C for the whole second arm, against status 1 for the first arm's early turns. So the persistent
collapse is confounded between **cumulative memory pressure** and **sustained thermal state**.
§7.20's contamination experiment and §7.23's turn 14 both argue against thermal as the cause of an
individual collapse (turn 14 collapsed at status 1), but neither speaks to a whole arm. **Do not
write that this is memory. It is not established.**

**The experiment that separates them** is the one already owed: re-run the 14-turn arm with
`RssFile`, `RssAnon`, `majflt` and `MemAvailable` sampled **per turn**, alongside the thermal line
`ci-bench.sh` already records. If residency falls and faults rise while thermal is flat, it is
memory. If both move together, we need a cooled-phone repeat to break the tie. The instrument gap
is real and is the reason this section ends in a fork instead of an answer: **`ci-bench.sh` samples
thermal per turn and memory not at all**, while the probe that does sample memory
(`kexp-probe.sh`) is a different runner.

⚠️ n=1 pair. The second arm is also the later arm, so session order and thermal are collinear with
everything else about it.

### 7.23 MEASURED 2026-08-20: a sixteen-turn conversation costs 42 points of battery and grows to eleven minutes of compute per reply — the consumer numbers nobody had taken

Recorded at the owner's instruction: this was a stress arm, but Kalsa is a consumer app and these
are the numbers a user would feel. `fase4`, `COMPACTION=off`, KEXP, `norepack=1`, S23, screen on,
unplugged at 17:21:20 with the battery at 100 %.

| | |
|---|---|
| turns | 16, from **17:26:13** to **19:11:09** = **1 h 45 m** |
| battery | **100 % → 58 %**, i.e. **42 points**, ~2.6 points per reply |
| drain rate | ~23 %/h of screen-on session (the doc's standing figure is ~30 %/h; this is in line, slightly better) |

**The growth of a single turn is the finding, not the total.** Wall clock per turn:

| turn | 1→2 | 3→4 | 7→8 | 10→11 | 12→13 | 13→14 | 14→15 |
|---|--:|--:|--:|--:|--:|--:|--:|
| wall | 2m00 | 6m08 | 4m52 | 7m31 | 8m46 | 14m19 | **27m21** |

⚠️ **Decomposed before anyone quotes it.** Of the 105 minutes of wall clock, only **~47 are compute**
(summed from `promptMs` + `predictedMs` across the 14 turns carrying telemetry). The rest is the
harness waiting for history-stable + UI-idle, capped at 240 s per turn, plus inter-turn dumps. **The
27-minute turn is not all model.** What *is* all model, straight from llama.cpp's own timers:

| turn | prefill | decode | **compute for one reply** |
|---|--:|--:|--:|
| 1 | 79 s | 11 s | **90 s** |
| 10 | 205 s | 8 s | 213 s |
| 13 | 219 s | 79 s | 298 s |
| **14** | **397 s** | **263 s** | **660 s = 11 minutes** |

**Where it goes, and it is not the decode.** Prefill dominates every late turn, and its *rate* is
normal — 5525 tokens in 396.6 s is **13.9 tok/s**, the ordinary prefill speed of this model. The cost
is that we pay a full prefill **every turn**: the 20-message window slides, the prompt's first message
changes, the prefix diverges right after the system prompt, and LFM2 cannot roll back recurrent state
(`llm_arch_supports_rs_rollback` = false), so the whole cache goes. That is §7.12, priced in minutes
for the first time.

⛔ **Product consequence, stated plainly.** A user who sends a fifteenth message waits minutes, not
seconds, and a single long conversation costs ~40 % of the phone's battery. Neither is a benchmark
artifact: the compute half is the model, and the battery is the battery. **This is a shipping
blocker for long conversations independent of every quantization question**, and it is not fixed by
making the model smaller or the decode faster — decode is 8–79 s of an 11-minute turn.

The levers that touch it are the ones §7.12 already named and nobody has built: **replaying tool
rounds in history**, an **append-only window**, and — for devices where it is real — **GPU prefill**,
measured at 3.18–6.95× on 750-class silicon in the sibling repo, which is the only lever that attacks
the 397 seconds directly.

⚠️ **Conditions that inflate the session numbers**: debuggable APK, logcat capture running, adb
attached, screen on for 105 minutes, and thermal status 2 from turn 10. A shipped app on an idle
screen would drain less. None of that touches the per-turn compute figures.

### 7.22 MEASURED 2026-08-20: KEXP's 2-bit experts do not break tool calling — our own gate does

The `tools` phase, gate/nogate pair, on the S23, on `LFM2.5-8B-A1B-KEXP`, `THINKING=default`,
production repack, one seed, 14 turns each. Run because a 2-bit expert quantization is exactly the
kind of change that degrades **structured** output before it degrades prose, and Kalsa depends on
tool calls.

**The quantization did not do it.** Across both arms: `firstTryValid: true`,
`recoveredByFallback: 0`, `toolCallsFailed: 0`, `privacyBlocks: 0`, and per-turn telemetry showing
`structuredCalls` with `namesValid: true` / `argsParsed: true` — the native structured path, never
the text-dialect fallback. `emptyReplyTurns: []`, `errorTurns: []`, `reasoningLeakTurns: []`,
zero truncations. **The risk was named before the run and it did not materialise.**

**Our gate did.**

| | gate ON | gate OFF | Δ |
|---|---:|---:|---|
| tool precision | 0.750 | **0.833** | +0.083 |
| tool recall | 0.429 | **0.714** | **+0.286** |
| missed calls | 4 | **2** | −2 |
| **spurious calls** | **1** | **1** | **0** |
| `tool_required` | 3/4 | 3/4 | — |
| `tool_forbidden` | 4/5 | 4/5 | — |
| `tool_selection` | 0/3 | 1/3 | +1 |

Removing the echo-of-context gate recovers **half the missed calls** and **raises precision at the
same time** — the trade the rule exists to make does not exist. And the decisive detail: the single
spurious call is **identical in both arms**, so the gate is not even catching the case it was written
for. §1.1 derived this from the scoring rule in 2026-08-14 (a good query paraphrases the question and
scores 0.39–0.68; a spurious one scores 0.15); this is the first measurement of it on the model we
would ship, and on the phone.

⚠️ **What is still the model's.** With the gate off, two `tool_required` misses remain and
`tool_selection` is 1/3 — and every failure is `noCall: true`, `wrongTool: false`. The model does not
pick the wrong tool; it declines to call. That residue, and only that residue, is what a fine-tune
would be aimed at — after the gate is fixed, not before.

⚠️ **Limits.** One seed per arm. Both arms ran with production repack, so half the turns of the gate
arm sat in §7.21's collapsed regime — which costs wall clock, not correctness. The phone was on the
charger: no timing in this section is a measurement. There is **no Q4_K_M control for the `tools`
phase on this model**, so these numbers say KEXP is usable, not that it is equal to the unquantized
build.

### 7.21 MEASURED 2026-08-20: production repack makes KEXP unstable — and it refutes §7.15's "the repack arm is VOID on this model"

Not designed. It fell out of the `tools` quality arm, which ran in **production** config
(`KALSA_SESSION {"op":"init","no_extra_bufts":0}`), i.e. repack ON — the first time KEXP had ever
run that way.

Decode per turn, 13 turns with telemetry, same model, same prompt plan:

| turn | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 11 | 12 | 13 | 14 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| tok/s | 19.96 | **0.45** | **1.16** | 17.31 | 14.89 | 14.20 | 14.35 | 17.94 | 14.12 | **1.24** | **0.53** | **0.50** | **0.75** |

Against `norepack=1` on the same phone the same morning: **19.97 · 21.81 · 22.26 · 21.98**, flat
(§7.20). Repack ON is not slower on average — it is **bimodal**, dropping 40× on six of thirteen
turns.

⛔ **This refutes a conclusion written in §7.15, which was mine.** That section states the repack arm
is *"VOID on this model. Do not run it"*, reasoning that q2_K and q3_K have no ARM repack path so the
flag cannot matter. The premise is right and the conclusion is wrong, because it only looked at the
experts. KEXP's **trunk** is 47 `q5_K` + 20 `q6_K` tensors, and **`q5_K` and `q6_K` are both in the
ARM repack list** (`repack.cpp`, the same list §7.15 quotes). That is ~0.5 GB of weights copied into
a full-size **anonymous** buffer — non-evictable — stacked on top of the 2.76 GB of expert file pages
that have to stay resident for §7.20's plateau to hold. The working set crosses the line, the experts
start refaulting, and the turn lands in the 0.5 tok/s regime §7.20 reproduces on command.

**The flag was never a lever through the experts. It is a lever through the trunk's footprint.**

⚠️ **Caveat, stated rather than buried: the phone was on the charger for this arm**, so these timings
are not quotable as measurements. What survives charging is the *shape*: a 40× swing inside one
session is structural, not a clock artifact, and the flat `norepack` control was taken on battery.
A clean unplugged repack-ON series is still owed.

✅ **Product consequence.** `no_extra_bufts` is currently a bench knob (`kalsa.bench.norepack`) and
production repacks by default — so today Kalsa would ship the unstable configuration for this model
class. For a model whose experts get no ARM repack anyway, repack buys nothing and costs residency.
It should become a **resolved production setting keyed on the model's quant mix**, not a flag.

⚠️ **And it re-opens a gate question.** `estimateMemory` charges `REPACK_FRACTION × size` for the
whole file. For KEXP that over-charges — only the trunk is repack-eligible, not the q2_K/q3_K
experts — so the gate's arithmetic is wrong in *both* directions on this model: too pessimistic about
the anonymous copy, and blind to the page-cache residency that actually decides the speed (§7.20).

### 7.20 MEASURED 2026-08-20: KEXP decodes at ~22 tok/s on the S23 — §7.15's 0.861 was the *previous model's* page-cache storm, and it reproduces on demand

The whole "where does the decode go" investigation was chasing a **state**, not a property. There
was no missing 25×. Every number below is raw `KALSA_TELEMETRY` from logcat, read on disk, not a
delegate's summary; artifacts in `~/kalsa-runs/decode-partition/`.

**Four consecutive turns, KEXP, `norepack=1`, nothing else set, phone idle overnight:**

| turn | decode tok/s | prompt ms | `majflt` delta | `RssFile` | `MemAvailable` |
|---|---:|---:|---:|---:|---:|
| 1 (contains the load) | **19.97** | 55 644 | 8 336 | 3 313 572 kB | 4 084 304 kB |
| 2 | **21.81** | 447 | 55 | 3 365 024 kB | 4 120 708 kB |
| 3 | **22.26** | 437 | 14 | 3 330 616 kB | 4 137 520 kB |
| 4 | **21.98** | 443 | 23 | 3 330 892 kB | 4 213 592 kB |

Steady state is **~22 tok/s** — **2.7× the dense Qwen3.5-4B measured the same morning in production
config (8.06 tok/s)**, which is exactly what ~1B active parameters should buy. At §7.19's byte
budget (~654 MiB of weights read per token) 22 tok/s is ~14 GB/s, i.e. the DRAM roof of this SoC.
The physics closes; it did not close at 0.861.

**The 0.861 reproduces on command, and the cause is the other model.** Contaminate the page cache
first, then run KEXP immediately:

| step | decode tok/s | `majflt` delta | `workingset_refault_file` delta |
|---|---:|---:|---:|
| LFM2.5-8B-A1B **Q4_K_M 4.80 GiB**, one turn | **0.263** | 182 608 | 15 237 370 pages = **58 GiB** |
| KEXP turn 1, immediately after | **1.15** | 5 275 | 123 965 pages = 484 MiB |
| KEXP turn 2 | **20.92** | 665 | 14 868 pages |

⛔ **That is exactly the shape of §7.15, because §7.15 *was* this experiment without knowing it.**
Its two KEXP turns (0.324, 0.861) were run in the wake of §7.14's 1134-second, 93.5 GiB storm on the
4.80 GiB model, on a KEXP file that had been written to app storage twenty minutes earlier. It
measured the recovery, not the model.

**RETRACTED, and both retractions are mine, from the same day:**

- §7.15's headline — *"residency solved, speed not… kernels are the remaining lever"*. Residency was
  the lever, and it was the only one. There is no kernel problem.
- §7.19's conclusion — *"the 6–15× gap is between the two stacks, not inside the arithmetic"*. There
  is no gap. Our stack decodes this model at 22 tok/s, four times what the mainline CLI got on the
  older 8B-A1B in §7.19's table, on the same phone. §7.19's demotion of the batch-1 `MUL_MAT_ID`
  suspect stands; its diagnosis of where the missing time went does not.
- The minor-fault hypothesis raised the same morning: **refuted**, 519 `minflt` per generated token
  against the ~167 000 it predicted. The probe now captures `minflt`/`majflt` from
  `/proc/<pid>/stat` (`kexp-probe.sh`), which no run before today did.

**Threads are healthy, and that is now a real measurement rather than an assumption.** 2 threads
13.26 tok/s against 5 threads 21.32, with `Attached ggml threadpool (n_threads=2, n_threads_batch=5)`
in the log confirming the override actually applied. Sublinear scaling on a bandwidth-bound decode
is the correct shape; a synchronisation pathology would have shown a flat line.

⚠️ **What is NOT separated.** Between §7.15 and today, **three** things differ, not one: the APK
(installed 2026-08-19 22:52, i.e. *after* §7.15's 13:44 measurement), the weight of the
contamination (93.5 GiB then against 58 GiB today), and the fact that yesterday's KEXP file had just
been written to storage, leaving gigabytes of dirty pages awaiting writeback. Today's contamination
reproduced the slow turn but recovered by turn 2, where yesterday's had not recovered by turn 2. So
**page-cache contention is demonstrated as sufficient to produce the slow regime; it is not proven to
be the whole of yesterday's persistence.** Do not write that it is.

⚠️ **Methodology consequence, and it is retroactive.** Every device number in §7.11–§7.15 was taken
within one session of another model's storm, on a two-turn protocol that quotes turn 2. Today's data
says turn 2 is inside the recovery, not after it. **A model switch invalidates the next turn or two.
Measure four turns and quote the plateau, or force-stop and let the cache settle first.**

✅ **Product consequence, and it reopens a decision that was closed as hopeless.** KEXP at ~22 tok/s
with `norepack=1` is the **fastest configuration ever measured on this phone**, and it holds
`MemAvailable` at 4.1–4.2 GB with `RssAnon` of 175 MB. Against it, the dense 4B in **production**
config (repack ON) allocates **3.77 GB of anonymous memory**, drives `MemAvailable` down to **930
MB**, pays **961 major faults per generated token**, and returns 8.06 tok/s. So the quality gate KEXP
misses (+0.0705 macro bpb, §2 of `KALSA.md`) is now a live trade against a shippable decode number
instead of against nothing — which is the owner's call, not a technical one.

⚠️ **And it puts repack itself on trial, on this device.** We have no `norepack` arm for a dense
model here, but the other tree measured the same combination on the same phone: REPACK + i8mm turns
Q4_K into `q4_K_8x8_q8_K`, a GEMM win and a **GEMV loss**, worth **+47 % of decode** when removed
(`research-mellum2-paper-tuning.md:263-267`). The `.so` this app loads is
`librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so` — confirmed in logcat on every arm today — so
that path is live in production. One dense arm with `norepack=1` settles it.

### 7.19 CROSS-TREE 2026-08-20: the same phone decodes an 8B-A1B at 5.3 tok/s under llama-cli — so the batch-1 `MUL_MAT_ID` suspect is demoted

⚠️ **Superseded the same day by §7.20 — read that first.** The demotion of the batch-1
`MUL_MAT_ID` suspect below still holds. The framing built on top of it — that a 6–15× gap exists
between the two stacks — does **not**: KEXP decodes at ~22 tok/s in this app once the page cache is
not contested, and the 0.861 this section reasons from was a transient.

§7.15 closed with "the remaining suspect is the batch-1 `MUL_MAT_ID` path" and asked for a profile.
Before spending a phone session on one, read `~/Projects/kalsa-moe-experiments`, which had already
run this exact shape of model on **this exact phone**. It had.

**Our own number, from the other tree: S23, mainline llama.cpp pin `67d5978`, `llama-cli`, unplugged**
(`results/runs.csv`, phases `F2.3` / `F2.3c`; write-up `reports/moe-f2.md:29-46`):

| model | file | cell | decode |
|---|---|---|---|
| `LFM2-8B-A1B-Q4_K_M.gguf` | 5 044 779 712 B | `t=4 c=512 kv=q8_0`, warm, `n_gen=128` | **median 5.30 tok/s** |
| `LFM2-8B-A1B-Q4_0.gguf` | 4 733 893 312 B | same cell | **median 6.20 / 7.60 tok/s** |

**And that grid was thrashing while we measured it.** `moe-f2.md` declares that grid *"INVALIDO come
baseline stabile"* precisely because of it: millions of major faults, **~10 GB re-read per 128
tokens**, `memfree_min` 8–12 MB — the same page-fault storm §7.14 measured. Those rows span 0.9 to
21.9 tok/s for that reason.

**Now put ours beside it, same phone, same model family, same 8B-A1B shape:**

| | file | regime | decode |
|---|---|---|---|
| `llama-cli`, mainline (`moe-experiments`) | LFM2-8B-A1B **Q4_K_M** 5.04 GB | thrashing, ~80 MiB/tok | **5.30** |
| the Kalsa app, `llama.rn 0.12.8` (§7.13) | LFM2.5-8B-A1B **Q4_K_M** 4.80 GiB | thrashing, **309 MiB/tok** | **0.357** |
| the Kalsa app, `llama.rn 0.12.8` (§7.15) | LFM2.5-8B-A1B-KEXP 3.10 GiB | **96 % resident, no storm** | **0.861** |

Quant-controlled, I/O-controlled the wrong way (the CLI had the *worse* excuse and the app had none),
the gap is **6–15×**. And the wider lineup on the same phone says the CPU is not the wall either
(`reports/lineup-card.md`, `-t 4`, unplugged, cold fadvise): a **35B-A3B** MoE streamed
from a 13.4 GB file decodes at **5.696 tok/s**, and a 6.4 GB MoE at **8.819 tok/s** — three times
our active-parameter count, ten times our misses, five to ten times our speed.

⛔ **So "MoE decode at batch 1 is intrinsically ~1 tok/s on this CPU" is refuted.** The remaining
suspect named at the end of §7.15 was the generic `MUL_MAT_ID` path — the same code, from the same
upstream, that produces 5.30 on this silicon. It cannot be the explanation on its own. **The gap is
between the two stacks, not inside the arithmetic**, and that changes the next experiment: not an
on-device profiler, but an A/B of **the `moe-experiments` CLI against the Kalsa app on the same file**, which partitions
the search space in one 20-minute session.

**What the comparison does *not* control, stated before anyone quotes it:** the CLI ran LFM2, the app
runs LFM2.5 (same shape, different generation and different file); the CLI cell is `n_gen=128` at
`c=512/1024` with no thinking, the app's is a real turn at `n_ctx=8192` with ~1400 tokens of prefix;
the CLI is a stripped mainline binary, the app is `llama.rn` inside a React Native process. None of those is
worth 6×, but the A/B is what settles it, and it must run the **same GGUF**.

**One candidate cause killed on arithmetic, before it cost anything.** The per-token JS callback
across the RN bridge cannot be it: **the dense 4B runs 5–8 tok/s in this same app**, so app-level
per-token overhead is bounded at ~125–200 ms, against the 1161 ms/token that 0.861 tok/s means.
Whatever is wrong is inside the engine's decode for this arch in our build, not in our JS.

**Candidates worth carrying into the A/B**, all cheap to vary and none yet measured here:

1. **CPU variant and build flags.** `llama.rn` builds six ARM variants and the S23 selects
   `v8_2_dotprod_i8mm` (`node_modules/llama.rn/android/src/main/CMakeLists.txt:151-156`). We
   measured that exact combination as a **decode** regression on this phone, in the other tree: REPACK +
   `lm_ggml_cpu_has_matmul_int8()` converts Q4_K to `q4_K_8x8_q8_K`, a GEMM win and a **GEMV loss**,
   12.37 → 18.19 tg256 = **+47 %** when removed, plus ~3 t/s from stripping an unstripped `-g`
   binary (`reports/research-mellum2-paper-tuning.md:263-267`). Our device runs are `norepack=1`,
   which should neutralise the first half — **should**, unverified — and KEXP's q2_K/q3_K have no
   ARM repack path at all (§7.15). Note this is a **decode-only** regression that leaves prefill
   *faster*, which is the shape of our anomaly.
2. **Threads.** We resolve 5; that grid, on this model on this phone, picked **4**, and this document
   already records a thread cliff (`>= 7` → 0.06 tok/s on SD 8 Gen 3).
3. **`n_ctx` 8192 against the CLI's 512–1024**, on a hybrid whose recurrent state and checkpoint budget
   (`state_cache_budget_mb`, §7.7c — never set by Kalsa) scale with it.
4. **Flash attention + `v: q4_0`**, the pair §7.17 already caught refusing to initialise.

Not a candidate: our native patch. `patches/llama.rn+0.12.8.patch` touches `common.cpp`,
`JSIParams`, `JSISession`, `rn-completion`, `rn-llama`, `rn-slot` — telemetry and session plumbing,
**no kernel and no `ggml` file**.

⚠️ **The process lesson, which is the same one that cost a day on 2026-08-19.** Every number above
existed on this disk before the question was asked. Our other tree is the first stop for anything
about kernels, quants, GPU or on-device speed — not the second.

### 7.18 MEASURED 2026-08-19: GPU offload initialises on the S23 and kills the app — and our RAM gate cannot see the memory that does it

Second attempt, with §7.17's fixes in the build. **This one is about the GPU.** Dense Qwen3.5-4B
(Q4_K_M, 2.83 GB, plus the F16 vision projector at 672 MB — that entry is multimodal), `NGL=99`,
unplugged at 98 %.

Init **accepted** `n_gpu_layers=99`, no `KALSA_GPU_FALLBACK`. Then:

| | PRE | during turn 1 | |
|---|---|---|---|
| app `RssFile` | 136 MB | **26–33 MB** | the weights are not in the process |
| app `RssAnon` | 95 MB | 121–183 MB | nor here |
| system `MemAvailable` | **4.02 GB** | **583 MB** | 3.4 GB gone anyway |
| `VmSwap` | 26 MB | **1.02 GB** | |

```
22:57:26 lmkd: Reclaim 'com.kalsa.app' (14122), oom_score_adj 0, state 2
               to free 155740kB rss, 1021552kB swap;
               reason: min2x watermark is breached even after kill
22:57:28 Zygote: Process 14122 exited due to signal 9 (Killed)
```

`oom_score_adj 0` is the foreground app — Android killed what the user was looking at, after
killing everything else first. **Zero of three turns completed.**

**The finding is not "the GPU is slow", it is where the memory goes.** In every previous arm the
model sat in the process's `RssFile`. Here the process shows ~150 MB total while the system loses
3.4 GB: the weights live in driver/CL allocations that `/proc/<pid>/status` does not account for.

⛔ **So the RAM fit gate is blind on this path, and that is a defect, not an imprecision.**
`estimateMemory` models mmapped weights plus the repack buffer — both inside the process. On an
offload path it would see ~150 MB, return `fits` with enormous margin, and hand the user a
configuration that takes the phone down. It is not a bad estimate; it is measuring the wrong place.

Caveat stated rather than buried: the battery went 98 → 100 during the run, so the phone reached the
charger. That invalidates timings — and there are none, because nothing completed. An OOM kill is
not a timing measurement, so the result stands.

⚠️ **Read this next to what `kalsa-moe-experiments` already knew**, because it is the other half and
it was measured months earlier (`docs/kernel-plan-v1.md:113-118`): decode on GPU is **0.41× CPU on
the 740** (5.06 vs 12.37) and **0.44× on the 750** (7.07 vs 16.15); prefill is **1.29× on the 740**
and up to 5.77× on the 750 — *"the GPU dividend on A7X is TTFT"*. Subgroup broadcast is **absent on
all A7X**, first silicon is Adreno 830 / 8 Elite. And the E2E gap is *"the executor, not the
kernels"* — ~60 ms/token of dispatch glue with the kernels already at the DRAM roof (34–41 GB/s).
This section adds the memory wall those numbers never had to reach, because on the phones they ran
on the app survived long enough to be timed.

### 7.17 NOT MEASURED 2026-08-19: the first offload arm tested a KV constraint, not a GPU — and the engine knew, but could not tell us

The arm §7.16 was built for, run on the S23 with the dense Qwen3.5-4B. **It produced no GPU
result.** Recorded because the failure path is worth more than the arm was.

All three turns returned the error bubble — *"Caricamento del modello non riuscito… tocca Riprova
caricamento"* — and every init attempt failed, GPU and CPU retry alike:

```
16:30:03 init  (gpu=99, fa=off) → 16:30:25 FAIL  (22 s)
16:30:26 retry (gpu=0,  fa=off) → 16:30:32 FAIL   (6 s)   ← the fallback fails too
```

The cause is not the GPU. `llama-context.cpp:3566` refuses a quantized V cache when flash attention
is disabled — `"V cache quantization requires flash_attn"`, `return nullptr` — and **every LLM in
our catalogue ships `v: "q4_0"`**. The CPU retry failed for the same reason, which is why the
fallback could not rescue the turn.

⚠️ **The defect was the knob's design, written the same morning.** Making `flashAttn: "off"` the
mandatory escort for `nGpuLayers` on Android built an arm that cannot initialise on any shippable
model, and confounded two variables so the result was unattributable even in principle. An audit
had already passed over that code — briefed at whether the JS *guard* was correct, never at whether
the *engine* would accept the parameters. The defect sat one level below the question asked.

**Two misdiagnoses before the right one, both with corroborating noise**: first "GPU offload does
not initialise on this device", then "it is memory" — logcat did show `lmkd` killing processes with
`min2x watermark is breached even after kill` in the same second. Neither was the cause. The lesson
is not about the GPU: **a plausible mechanism visible in the log is not a cause**, and the second
guess felt stronger than the first precisely because it had evidence attached to it.

✅ **Why it took an afternoon instead of thirty seconds, and this is the real finding.**
`ensureNativeLogCapture` set `nativeLogSetupDone = true` *before* its try block. If
`toggleNativeLog` threw, the listener was never installed, the catch swallowed it, and every later
call short-circuited on a flag promising a capture nobody had made. The tail stayed empty for the
process lifetime, so `rethrowWithNativeTail` enriched failures with nothing. **llama printed the
exact and complete cause and it never reached JS.** Fixed (`1df593b`): the flag goes last, so a
failed setup is retried instead of latched.

Also fixed (`3b20bae`): turning flash attention off has exactly one valid spelling, so
`applyEngineOverride` now writes it — `flashAttn: "off"` also forces `cache_type_v: "f16"`.

**What is now known about GPU offload on this device: nothing.** The question is unchanged and, for
the first time, cleanly askable. A follow-up audit enumerated all eight init constraints and
confirmed the fix is sufficient, that production (`flash_attn_type: "auto"`) never reaches the
refusal, and that the only remaining drift is the RAM gate estimating KV from the catalogue while
the arm runs an f16 V — real on `qwen3.5-2b` alone, bench-only.

### 7.16 CROSS-TREE 2026-08-19: on an **Adreno 740** the GPU is not a decode lever — and that is a statement about one GPU, not about GPUs

⚠️ **Scope this section before quoting it. Everything below is the Adreno 740 — the phone we own.**
Owner, 2026-08-19: *"da Adreno 750 la GPU fa volare tutto."* So the pessimism here does **not**
generalise upward; it is the floor of the range, on the device that happens to be on our desk.
Product consequence: these numbers argue about what an S23 can do, **not** about whether Kalsa
should use the GPU on the phones it will actually ship to.
⚠️ Recorded tension, not resolved here: the 0.41–0.44× decode figure below was reported as covering
**740 *and* 750**, which sits against "from 750 it flies". Either the 750 figure predates the kernel
work, or the two describe different quants/paths. **Do not average them and do not pick one** — the
next Adreno 750-class measurement settles it.

Intel from the parallel session working on the OpenCL kernels, cross-checked against what this tree
says. **Their numbers, not ours** — recorded here because they close a direction we were about to
spend a phone session on, and because the two trees disagree in a way that matters.

**The two trees have different gates, and both readings were right about their own.** Here
(`llama.rn 0.12.8`) `use_adreno_moe_kernels` excludes `A6X`, `A7X` and `ADRENO_UNKNOWN`
(`ggml-opencl.cpp:7027`), and `get_adreno_gpu_gen` (`:249`) puts **730, 740 and 750 all in `A7X`** —
so the K-quant MoE path never runs on this phone, and K-quant MoE falls back to CPU: correct, but
CPU. In *their* tree the same gate is name+shape only (`backend_ctx` explicitly `GGML_UNUSED`), so
those kernels **do** run on a 740 — which is why they are measuring the corruption upstream merely
switched off. Upstream's own comment names the defect class: `*_trans4_ns` aliases a private
`ushort8` through a `uchar*` and some A6x/A7x compilers miscompile it, corrupting the weights.

⛔ **Do NOT lift the A7X exclusion in this tree.** It looks like free unlock of the whole K family
for `MUL_MAT_ID` — Q4_K_M included, at zero quality cost — and that prize is real, but it arrives by
fixing the defect, not by removing the sign. On 740/750 those kernels measure **ERR 0.36–0.9 against
a 0.0005 threshold** on every tight quant. Lifting the gate trades correct-CPU for garbage-GPU. This
retracts a suggestion made here earlier the same day.

**The number that closes the direction for our problem:** MoE **decode** on GPU is
**0.41–0.44× the CPU** on 740/750, with ~60 ms/token of dispatch glue (their measurement; their note
says the fix is a fused executor, months). Applied to §7.15's 0.861 tok/s that predicts ~0.36 —
*worse than where we are*. Our blocker is decode. **The GPU is not the lever for it.**

✅ **What the GPU *is* a lever for, and it lands on a wound we already have:** prefill, **3.2–7×**.
§7.12 is the reason that matters — when the sliding window moves, the cache dies and a full prefill
is paid again every turn. §7.15's run did not feel it only because two turns never slid the window
(`n_common` 1411/1431, 98.6 % reused). Over eight turns it bites, and that is the cost a 3–7× lever
cuts. Also from them: for models streamed beyond RAM the experts stay on CPU **by architecture**
(the streaming hook lives in the CPU `mul_mat_id`), so GPU `MUL_MAT_ID` pays on resident-expert
models — the LFM2.5 class — and in prefill-shaped designs, not on streamed decode.

⚠️ **A claim made here earlier the same day, corrected.** This tree's `supports_op` puts
`Q4_0 / Q8_0 / MXFP4` in a general `MUL_MAT_ID` branch with no Adreno gate (`:7299`), and that was
read as "an MXFP4 MoE would run on GPU on the S23 today". **`supports_op` returning true is not
correctness.** Nobody has tested MXFP4 MoE correctness on a 740; in their tree mxfp4 takes the
Adreno path and fails **0/74**. The only general-branch MoE quant with measured-green correctness on
a 740 is **q8_0, 75/75** — at 8.5 bpw, ~8.8 GB for this model, which is not a candidate. The MXFP4
question stays open and is settled by a run, not a gate: it needs an MXFP4-expert MoE GGUF, which is
a quantization job in `moe-experiments`, and then the `NGL` knob below on this phone.

**The instrument, since it did not exist this morning.** `applyEngineOverride` refused `nGpuLayers`
on Android unconditionally, and that guard sits on the path production and bench share — so the one
untested cell was unmeasurable from either side. It now refuses unless the same override carries
`flashAttn: "off"`, which is precisely the configuration never run (production sends `"auto"`, and
the recorded HTP failure is offload *with FA on CPU*). Production passes no override and stays at
`n_gpu_layers=0`. Two defects fixed while wiring it: `LlamaService` kept its own inline copy of the
override shape without `flashAttn` — TypeScript skips excess-property checks on a variable, so the
field arrived at runtime while being invisible in the type — and `initLlama` had **no fallback at
all**, so a stale `kalsa.bench.engine` key would have left the model permanently unloadable behind
the same "Riprova caricamento" dead end §7.11 documents. Android now retries once on CPU and logs
`KALSA_GPU_FALLBACK`, loudly on purpose: a silent fallback would hand the GPU arm a CPU number to
publish. Driver knob: `NGL=99` in `lfm-setup.sh`, which also **deletes** the key when unset, because
the production path reads it too. 12 tests; that guard previously had none.

**What survives of the offload arm.** Not "how much does the GPU buy" — that is answered, and the
answer is negative for decode. Three things still unmeasured and useful to both trees: GPU
**prefill** on this device through our own path; **how CL buffers account against RAM** on an S23
(everything measured in §7.11–§7.15 is mapped-file accounting, and offload rewrites it); and that
the knob works end to end, so `KALSA_GPU_FALLBACK` distinguishes "refused" from "ran" when their
patch lands.

### 7.15 MEASURED 2026-08-19: KEXP stays resident and the storm stops — 130× fewer refaults, and 0.86 tok/s is still not a product

⛔ **The 0.86 in this title is wrong, and §7.20 replaces it.** Measured 2026-08-20: this model's
steady-state decode on this phone is **~22 tok/s**. Both turns below were run in the wake of §7.14's
93.5 GiB storm on the 4.80 GiB model, on a file written to app storage twenty minutes earlier — they
measured the recovery, not the model. §7.20 reproduces the slow regime on command and then shows it
clearing within one turn. Everything this section says about **residency** stands; every conclusion
it draws about **speed** is retracted.

The residency bet of §7.14, run. `LFM2.5-8B-A1B-KEXP`, 3.10 GiB, our own requantization,
sideloaded to app storage (md5 `ceb2820d…` identical across desktop / `/data/local/tmp` /
`files/models/`, so the measured PPL transfers). Two turns, unplugged, 59 % → 49 %, 26.8 → 34.7 °C,
45 samples at 20 s. Prefs byte-identical to the §7.14 arm except `kalsa.model.id` — including
`norepack=1`. Read that last word twice; it is the whole of §7.15's coda.

| | §7.14 Q4_K_M, 4.80 GiB | §7.15 KEXP, 3.10 GiB |
|---|---|---|
| `RssFile` plateau | 2.54 GiB → **53 %** of the file | 3.12 GiB → **96 %** |
| `RssFile` oscillation | 4152280 → 2017356 kB = **2.04 GiB** | 3285500 → 3182772 kB = **100 MiB** |
| `workingset_refault_file`, warm turn | +24 523 321 pages = **93.5 GiB** | +193 224 pages = **755 MiB** |
| `RssAnon` / `VmSwap` | 60 / 208 MB | 173 / 69 MB |
| `MemAvailable` | never collapsed | never below 4.13 GB |
| decode | 0.313 / 0.357 / 0.363 tok/s | t1 **0.324** · t2 **0.861** |
| wall | ~19 min (1 turn) | 797 s · 254 s |

The prediction was written before the run: *if `RssFile` plateaus near the whole file the ceiling
was competition and KEXP fits; if it plateaus at the same ~2.5 GiB the ceiling is a page-cache
budget and requantizing further buys nothing.* It plateaued at 3 270 144 kB against a 3 248 203 kB
file, with the app's own 138 256 kB of mappings inside that number — the model is **~96 % resident**
and the oscillation collapsed from gigabytes to a hundred megabytes. The ceiling was competition.

Turn 1 (0.324 tok/s) is indistinguishable from the §7.14 baseline because it *contains* the load and
the settling: 1 220 796 pages = 4.66 GiB refaulted, 1.5× the model. Turn 2 is the warm regime, and
it is the one to quote. **Do not average the two.**

⚠️ **This corrects §7.14's forecast, which was mine.** §7.14 closed with "the lever is residency,
not kernels." Half right, and the wrong half matters: residency was the lever for the *storm* —
130× fewer refaults, exactly as predicted — and it bought only **2.7×** of decode. 0.86 tok/s is
two minutes for a short reply. Size was a real lever, correctly identified, and it was not the
whole problem. Kernels looked like the remaining one. **They are not either — see the next two
paragraphs, both of which closed the same afternoon, on disk, before either cost a phone session.**

⛔ **The repack arm is VOID on this model. Do not run it.** Every number in §7.11–§7.15 was measured
with `norepack=1`, and the plan was to finally turn ARM GEMM on now that 3.10 GiB leaves room
(2839 + 249 = 3088 MiB non-evictable against 4016 MiB of measured `MemAvailable`). Then the shipped
C++: `arch/arm/repack.cpp` implements `q8_0, q4_K, q6_K, q5_K, q4_0, mxfp4, iq4_nl` and **nothing
else**; `q3_K` appears **zero** times in `repack.cpp`, and `q2_K`'s only selection paths are
`lm_ggml_cpu_has_avx512()` and `riscv_v` (`repack.cpp:4627`, branch read in full). KEXP's experts are q2_k on
gate/up and q3_k on down — nearly the whole file — so on ARM they get no repack whether the flag is
on or off. The flag was never the lever for this quant. Note the design bind this exposes: the
types small enough to stay resident have no ARM fast path, and the types with an ARM fast path are
≥ 4 bpw and do not stay resident.

⛔ **And the GPU is not the escape either, on this phone, for this model** (owner, 2026-08-19). The
current llama kernel does MoE-on-GPU only above **Adreno 750**; the S23 is an Adreno **740**. Two
independent walls — MoE unsupported *and* the hardware floor — and the shipping model is a MoE. Work
is under way in another session to patch the kernel for MoE; whether that also lifts the 750 floor
is not known here. Dense models offload fine on this device, which is what makes the arm below
measurable at all.

**So what is left is a profile, not another A/B.** The elimination is now tight: not page cache
(fixed here), not repack (unavailable), not the KV cache (`n_common` 1411/1431, 98.6 % reused, so
turn 2's prompt cost 1716 ms), not thermal (§7.14: 0.3627 cold vs 0.3572 warm), not threads
(`n_threads=5`). Prefill is **normal** at 17.1 tok/s while decode is 20× worse — and a **dense** 4B
carrying **4× more active parameters** decodes at 5–8 tok/s on this same CPU, so per active
parameter the MoE decode is roughly **25× less efficient**. The remaining suspect is the batch-1
`MUL_MAT_ID` path.

Artifacts: `~/kalsa-runs/kexp/` (PRE, T1_01–T1_34, T2_01–T2_11, POST_1, POST_2, logcat), driver
`~/kalsa-scripts/kexp-probe.sh`.

### 7.14 MEASURED 2026-08-19: the decode collapse is a page-fault storm — 93.5 GiB re-read from flash in one turn

§7.13 left the explanation as the reading that fitted the numbers. This is the number. One turn on
the S23, unplugged, `norepack=1`, 37 samples at ~30 s across a 1134 s window, `/proc/vmstat` and
`/proc/<pid>/status` deltas.

| | delta over the turn |
|---|---|
| `workingset_refault_file` | **24 523 321 pages = 93.5 GiB re-read from flash**, 84 MiB/s sustained |
| `workingset_refault_anon` | 708 549 — the file side is **34.6×** larger |
| per generated token | **309 MiB re-read**, for a model whose whole file is 4.8 GiB |

And the process shows the same thing directly. `RssFile` does not sit still, it oscillates by
gigabytes inside one pid while `VmHWM` stays pinned at the peak — the pages were had, then taken:

```
T03 11:36:53  4152280 kB   (peak; VmHWM 4223536)
T29 11:50:06  2017356 kB   (minimum, mid-decode)
T30 11:50:36  2518724 kB   (+501 MB in 30 s — faulted straight back)
```

`RssAnon` stays flat and small throughout (27–95 MB), which is what `no_extra_bufts` promises.

⚠️ **The honest qualification, and it changes the mechanism's name.** `pgsteal_direct` is only
**1.65 %** of steals and `allocstall_*` moved by 1824 in 1134 s. So the decode thread is **not**
stalling in direct reclaim; kswapd is doing the evicting. The cost is the other half: kswapd takes
the model's pages, and the decoding thread then takes a **major fault** and waits on flash to read
them back. `allocstall` counts stalls while *allocating*; the refault counter is what counts pages
that had to be fetched again, and that is the one at 93.5 GiB. Note also that `/proc/vmstat` is
system-wide — not all of it is our GGUF — but nothing else on an idle phone generates 84 MiB/s of
file refaults, and the app's own `RssFile` trajectory shows the model's pages among them.

Decode this run: 310 tokens in 991.1 s = **0.313 tok/s**, against **18.6 tok/s** prefill. Third
consistent decode measurement (0.3627, 0.3572, 0.3128).

**Why this matters for the fix:** the lever is residency, not kernels. A build small enough to stay
resident stops the loop; a build that cannot, cannot be rescued by tuning. `LFM2.5-8B-A1B-KEXP`
(3.10 GiB, our recipe) against ~4.3 GB of `MemAvailable` is the first candidate that could actually
stay in.
⚠️ **"not kernels" was wrong — see §7.15.** KEXP was run and does stay resident: the storm stopped
(130× fewer refaults, as this section predicted) and decode still only reached 0.86 tok/s. Residency
was the lever for the *storm*; kernels are the remaining lever for the *speed*. Also worth recording: at launch this run the gate said `"verdict":"fits"` — the model is
not marginal on RAM once the repack term is gone; it is marginal on **page cache**, which is a
different resource and one the gate does not model at all.

### 7.13 MEASURED 2026-08-19: the shipping model loads without repacking — and decodes at 0.36 tok/s, which is not a product

The gate fix worked, and the answer it unblocked closes the question the other way.

**The gate opens.** With `kalsa.bench.norepack=1` and both gates reading the real load mode:

```
I/ReactNativeJS: 'model.fit', '{"verdict":"tight","availableMb":3861}'
I/ReactNativeJS: KALSA_SESSION {"op":"init","no_extra_bufts":1}
```

`tight`, not `does_not_fit`. Native init to `Context initialized` in **~12.6 s**, reproduced at
~12.2 s on a second launch.

**Anonymous RAM is negligible without repacking**, which is the whole point of the knob:

| | measured, model resident |
|---|---|
| `RssAnon` | **32 308 kB ≈ 32 MiB** (against the 4401 MiB of repack the gate charges) |
| `RssFile` | 2 577 496 kB = **2.46 GiB of a 4.80 GiB file — 51 % resident** |
| `VmSwap` | 226 836 kB |
| system `MemAvailable` | 4 679 068 kB ≈ 4.57 GB — nothing like the 726 MB the 4B left with repack ON (§7.2) |

**And then the decode number.** From `KALSA_TELEMETRY`, verified in the raw logcat, not from the
agent's summary:

```
{"turnId":"1","round":0,"tokensCached":1434,"tokensEvaluated":1211,"tokensPredicted":222,
 "promptMs":67390.575,"predictedMs":621547.92,"predictedPerSecond":0.357,"interrupted":false}
```

| | |
|---|---|
| prefill | 1211 tokens in 67.4 s = **18.0 tok/s** |
| decode | 222 tokens in 621.5 s = **0.357 tok/s** |
| one reply | **10.4 minutes** |

**Prefill is completely normal** — 18.0 tok/s is exactly the cold-prefill figure this document
already records for the 4B. So `no_extra_bufts` did *not* cost prefill, contrary to the knob's own
description. Decode is 15–20× below the 4B's 5–8 tok/s.

**Not thermal.** Two measurements, one on a cold phone at 10:29 (0.3627 tok/s) and one warmer at
11:17 (0.3572 tok/s), agree to three decimals. The thermal stop (status 3, 42.5 °C) came *after*.

**Leading hypothesis, and it is the one the deleted roadmap wrote down before we measured it:** the
asymmetry between a normal prefill and a 20×-slow decode does not look like missing kernels, which
would hurt both. It looks like I/O. Prefill streams every expert once, in one batch. Decode picks a
*different* expert set per token **and per layer**, over a file that is only 51 % resident — so it
faults. `ROADMAP_BIGGER_MODELS.md` (removed today, subject now in the `moe-experiments` repo) opened
with exactly this: *"in un MoE gli esperti attivi cambiano a ogni token e a ogni layer. Non esiste
un sottoinsieme fisso da tenere residente."* Not proven here — nobody counted page faults — but it
is the reading that fits both numbers.

⛔ **Product consequence: on an 8 GB phone both configurations of the shipping model are dead ends.**
Repack on does not load (4650 MiB non-evictable against ~4030 available, §7.11). Repack off loads
and answers in ten minutes. **LFM2.5-8B-A1B is not shippable on this device class**, and that is a
decision for the owner, not a bug to fix.

⚠️ **What this run did not get.** The arm stopped after turn 1 on `Thermal Status: 3` at 42.5 °C
with battery 71 %. No turns 2–8, no reuse series, no recall probes, no `ciswire` arm. Also unmeasured:
repack-on decode for this model on this phone — it cannot load, so the 0.357 tok/s has no in-model
control and cannot be attributed to `no_extra_bufts` with certainty. Two harness bugs were found and
fixed by the run: `local tag="$1" f="$OUT/mem_${tag}.txt"` explodes under `set -u`, and the memory
sample fired before the lazy load, capturing an app with no model in it (`RssFile` 136 MB).

### 7.12 MEASURED 2026-08-19: two cache regimes, one per model — and the biggest destroyer is the sliding window, in **every** mode including bare

Cross-checked on two campaigns before writing anything down, because the first version of this
section (written this morning from the smoke alone) was wrong twice. Sources: smoke `32157672018`
(**LFM2.5-8B-A1B**, 8 arms × 7 turns) and campaign `32048465417` (**Qwen3.5-4B**, 38 arms, 16
turns, 570 turn observations). Neither run set `kalsa.bench.legacywindow`, so both used the
production window of 20 messages.

**1. Reuse behaves completely differently on the two models, and §7.8 already said why.**

| | LFM2.5-8B-A1B | Qwen3.5-4B |
|---|---|---|
| per-turn `reuseFrac` | **bimodal: 0.98 or exactly 0** | **continuous** — 482 of 570 turns strictly between 0 and 0.90 |
| what a divergence costs | **everything** | only the suffix after it |

**The bimodality is not a small-sample artifact.** Checked against the full pre-fix LFM campaign
`32103054225` (40 arms, 16 turns, **600 turn observations**): **595 exactly 0, 5 at 0.90+, and not
one value in between.** On this model reuse is a switch, not a fraction.

⚠️ **That campaign cannot strengthen the tool claim, and I checked before trying to use it.** It was
created 2026-08-18 05:29 UTC; `preserve_thinking` landed at 15:52 UTC the same day, so it is the
pre-fix world — its base miss rate is 99.2 %, which makes "165 of 165 turns after a tool missed"
vacuous. The tool result rests on the post-fix smoke (n=10) and on the 4B's attenuated version.

That is `llm_arch_supports_rs_rollback`: true for `QWEN35`/`QWEN35MOE`, false for `LFM2`/`LFM2MOE`,
which falls to `default: return false` → `seq_rm` fails → `llama_memory_clear` → `n_past = 0`. On
Qwen the recurrent state rolls back to the divergence point and the prefix before it survives. **On
the model Kalsa ships there is no partial credit: one divergent token anywhere costs the whole
cache.**

This also retires a number I published. §7.9's "reuse 0.599, so about a third of the prefix is
still re-evaluated" describes nothing physical — on this model there is no third. 0.599 is a **hit
count**: four turns of seven kept their cache, three lost all of it.

**2. On the shipping model, a tool call is a guaranteed total loss.** In the smoke, of 48 turns
after the first, 14 missed and **10 were the turn immediately after a tool executed — with zero
tool-preceded turns surviving.** The mechanism is in the code, which already flags it: a tool round
appends `assistant(tool_calls)` and `tool(result)` to the prompt (`LlamaService.ts:1930-1941`) so
both enter the KV, stored history keeps only the final answer, and `:1942` sets
`kvReproState = "tool_calls_detected"`. Nobody had priced it: **3.1–3.9 s prefill on a hit against
195–405 s on a miss.** The same event on the 4B costs a fraction instead (mean reuse 0.507 after a
tool against 0.637 otherwise) — same defect, survivable only because that model can roll back.

**3. The dominant destroyer in a real conversation is the legacy sliding window, and it hits bare
too.** Mean `reuseFrac` by turn on the 4B:

| turn | 2 | … | 11 | **12** | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|
| `baseline` (no digest, ever) | 0.94 | ~0.80 | 0.82 | **0.15** | 0.15 | 0.30 | 0.34 | 0.35 |
| `ciswire` | 0.93 | ~0.79 | 0.84 | **0.14** | 0.00 | 0.14 | 0.32 | 0.08 |

`LEGACY_MAX_HISTORY` is 20 messages, so from turn 11–12 the oldest exchange starts falling out of
`slice(start)` (`compactor.ts:642-651`). The first message of the prompt then changes **every
turn**, the prefix diverges immediately after the system prompt, and reuse collapses — in
`baseline`, which never carries a digest, exactly as much as in `ciswire`. `RESEARCH_CONTEXT_LOSS.md:104`
predicted this in design ("una finestra recente che *scorre* fa divergere i token subito dopo il
system prompt A OGNI turno"); this is the first time it has been measured. **Note what it means for
everything else in section 7: the KV work pays off for about ten exchanges, after which the window
throws the cache away for every mode Kalsa ships.**

Also visible in that table: the clean-regime plateau is **~0.80, not ~1.0**, and that is the
ceiling, not a defect — prompt ~2000 tokens growing ~400 per turn.

**4. The digest does cost cache — measured with both confounds removed, and it is second-order.**
The naive comparison is worthless: turns carrying a digest reuse 0.326 against 0.690 without, but
`digestChars > 0` happens **exactly when** the corpus is non-empty, which is **exactly when** the
window starts sliding. They are collinear by construction, and `baseline` — no digest, ever —
crashes just as hard.

So compare `baseline` against `ciswire` **inside turns 12–16, where the window is sliding for both**,
and then drop every turn preceded by a tool call, since `ciswire` calls tools slightly more (2.00
tool-turns per seed against 1.56):

| turns 12–16, no tool in the previous turn | mean `reuseFrac` |
|---|---|
| `baseline` (n=9 seeds) | **0.272** |
| `ciswire` (n=10 seeds) | **0.171** |

**−0.100, exact two-sided permutation p = 0.0016.** With the window held constant and tool turns
excluded, the digest still costs a tenth of the prefix — the §7.10 mechanism, real and now
quantified, but roughly a sixth of what the window itself destroys.

None of this was visible in the smoke, and could not have been: 14 messages against a 20-message
window means the corpus stayed empty and `digestChars` was **0 on 55 of 56 turns**.

**5. Memory-on discards the cache by construction**, not as a side effect: `extractMemory` calls
`engine.clearCache()` (`LlamaService.ts:2495`). Three of the four non-tool misses in the smoke are
memory-on arms.

⚠️ **What is NOT established here.** No fix has been attempted for any of the three. The tool-round
replay is the most valuable next lever on the shipping model and the same shape as
`preserve_thinking` (§7.9); an append-only window is the most valuable one for long conversations,
and `v42` is the existing attempt at it — which crashes *earlier* (turn 7) on its rebuild cadence
and measured worse on recall. Priority order by measured cost: window, then tool rounds, then the
digest cadence knob of §7.10, which stays available and demoted.

### 7.11 CONFIRMED ON HARDWARE 2026-08-19: the shipping model does not load on a Galaxy S23

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

**MEASURED, same day, on the phone** (debuggable APK `32254348018`, model copied into app storage
and md5-verified against the Mac source, `f57def02e4e034d4f16ffa125977c45a`, unplugged, 93 %,
28.6 °C):

```
I/ReactNativeJS: 'model.fit', '{"verdict":"does_not_fit","availableMb":4030}'
```

The app never attempted an engine init — the log goes straight from that verdict to memory-pressure
polling. A chat turn sent through the deep link came back **instantly**, same millisecond timestamp
as the user message:

```json
{"role":"user","text":"Ciao, chi sei?","createdAt":1787146704276}
{"role":"assistant","text":"⚠️ Caricamento del modello non riuscito. Apri Impostazioni → Modelli
 e tocca Riprova caricamento per LFM2.5 8B-A1B.","createdAt":1787146704276}
```

So the estimate predicted 4650 MiB against 4121 MiB probed; the app measured 4030 MiB available and
refused. **The model Kalsa ships cannot be used on a 2023 flagship**, and the error text tells the
user to *retry* — which cannot help, because nothing about the RAM will be different next time.

**And `norepack=1` did not help, because the gates never read it.** Measured immediately after:
verdict unchanged, `availableMb` 3910, same error bubble. `deviceProfile.ts` carried this comment
above a hardcoded `repack: true` —

```
// Gates deliberately assume the conservative repack-ON footprint. The bench
// norepack arm bypasses these gates; wiring a gate to a different load mode
// than the engine actually uses is the S23-class bug class.
```

— and **the bypass did not exist**, so the bug class it names was live in the file that names it.
There are two gates, not one: `evaluateModelFit` (`AppShell.tsx:2615`, logs `model.fit`, blocks lazy
restore) and `gateForModel` → `modelGateVerdict` inside `ensureEngineForModel`
(`AppShell.tsx:2951-2965`), which is the one that produces the bubble and refuses **before any
engine init**. Both now take the resolved load mode, default `true`; production with the knob absent
is unchanged. Three regression cases in `deviceProfileHarness` carry the measured numbers.

⚠️ **RETRACTION of my own hedge, from reading the shipped C++.** I wrote above that
`REPACK_FRACTION` is calibrated on a dense 2B and so "may be badly wrong for a MoE". Checked in
`node_modules/llama.rn/cpp`, and it mostly is not:

- `repack.cpp:4791-4795` explicitly supports `LM_GGML_OP_MUL_MAT_ID` with a **3-dimensional**
  `src[0]` — that *is* the MoE stacked-expert matmul. Experts are eligible.
- `block_q4_K` has repack traits (`:4535-4536`, `:4567`), and the model is Q4_K_M.
- `lm_ggml_backend_cpu_repack_buffer_type_alloc_buffer` (`:4751`) allocates a **full-size ordinary
  CPU buffer** and repacks into it, so the copy is genuinely anonymous and those tensors are not
  mmapped.

In an 8B-A1B the experts are nearly the whole file, so a repack-on load really does want ~file-size
of anonymous RAM. **The gate's refusal is substantively correct: an S23 cannot hold this model with
repacking on.** That narrows the product question to a choice — ship `no_extra_bufts` for this model
on ≤8 GB devices and pay slower prefill, or do not offer it there at all. What decides it is whether
it is *usable* without repacking, which is the run now queued behind the gate fix.

### 7.10 MECHANISM 2026-08-19: the digest costs cache per INJECTION, not per change — knob written, UNMEASURED

> **DEMOTED, then partly VINDICATED, the same day by §7.12.** The measurement this section was
> written to explain is not about the digest — `digestChars` is 0 on 55 of 56 turns of the smoke it
> cites. But the mechanism itself is real and now has its own number, from the 4B campaign with the
> sliding window held constant and tool turns excluded: **−0.100 reuse, p = 0.0016**. Keep the
> mechanism, keep the knob, drop the priority: the window costs about six times more.

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

⚠️ **CORRECTED 2026-08-19 by §7.12 — read that before believing the paragraph below.** On this
model `reuseFrac` is bimodal (0.98 or exactly 0, never partial), so "a third of the prefix is
re-evaluated" never happened: 0.599 is a hit count, four turns of seven. And `digestChars` is 0 on
55 of 56 turns, so the arm split below is **not** the digest — it is the tool calls. The paragraph
is kept as written because the change log is not allowed to quietly repair conclusions.

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

> **REFUTED.** The digest was not in these prompts at all (`digestChars` 0 on 55 of 56 turns,
> `corpusSize` 0): 14 messages against a 20-message window, so the corpus stayed empty. The ciswire
> arms lose a turn because they call tools more often, and on **this** model — which cannot roll
> back recurrent state — a tool call costs the entire cache, 10 times out of 10. See §7.12. The
> "number attached rather than an argument" was attached to the wrong thing.

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
| 2026-08-22 | **§7.39: the streaming lane is closed, and it closes for the opposite of the expected reason.** The 8B does not fail slowly on the Jelly, it fails by being killed, so streaming the experts was the one untried idea aimed at the real failure. Cross-compiled the custom fork (NDK 29, no i8mm, backend-DL off so the overlap hook survives) and measured ABBA n=3: mmap **9.37 tok/s**, streaming **3.44**. **RSS halves and the kind of memory flips** — 4931 MiB of reclaimable *file* pages become 2602 MiB of unreclaimable *anon* — so `MemAvailable` gets **worse**, 5797 → 3597 MiB, and streaming would make lmkd **more** likely to kill the app. A compute ceiling closes it anyway: 0.219 s/token of pure compute caps the path at **4.57 tok/s**, below KEXP's 7.0 even with infinitely fast flash. **My 3–5 tok/s prediction was right in the number and wrong in every reason** — 13.5 % experts dropped not 71.8 % (that figure was another model's), flash at 265 MiB/s not 984, and an 87 % cache hit doing the actual work. **Side-quest, from a review agent that died mid-stream but had already pointed at the right line:** `RLIMIT_MEMLOCK` is **unlimited** on this phone, for the shell and the app alike, not the ≈64 KB that `KNOWN_ISSUES.md` and `engineLiveness.ts` both asserted, and mlock genuinely fires (`Mlocked` 4 912 → 215 932 kB) — but locks 211 MB, not the model, so **my hypothesis that mlock caused the lmkd death is dead too**. Both files corrected (`a093d89`). Still unexplained and now the open question: the app holds 5.15 GB of file pages with 0.92 GB available where the CLI holds the same pages with 5.8 GB available. |
| 2026-08-21 | **§7.38: model quality measured for the first time, and it argues against every 8B we were going to ship.** 24 cells, 11 questions written before any model ran, 4 languages, exact paired McNemar; every figure regenerated by `scripts/quality/analyse.mjs` rather than transcribed. **LFM2.5-2.6B beats KEXP** in three independent configurations (p = 0.006 / 0.021 / 0.039) and beats 8B-A1B in most but ties in one — `prod-8b-a1b` at 33/44 sits above that model's other five cells, which is what a lucky sample looks like at temp 0.7. **Qwen3.5-2B ties the 2.6B** (7–6, p = 1.000) but cannot run uncapped: 44 of 44 questions hit the 8192-token ceiling in a *semantic* loop that a repeat penalty cannot break. **The thinking budget was tuned backwards** — the ladder 64/128/256/512/∞ scores 30/32/34/**37**/36 on the 2.6B (512 vs 64: 8–1, p = 0.039) and is flat on KEXP, so raise the 2.6B to 512 (median tokens 306 → 309: latency does not move) and leave KEXP alone. **I had reported the opposite** — 'the budget buys nothing on any tier' — from adjacent steps that 44 binary items cannot resolve; retracted in §7.38. **Language drift is a 30 % defect on the 8B tiers and ~0 % on the 2.6B**, always into English, concentrated on questions the model cannot answer; one clause pinning the answer to the *question's* language (Kalsa pins to the *app locale*) removes it in 6 of 6 comparisons at no quality cost. **KV-cache quantization is free** on both 8B tiers — an axis moe-experiments never tested, since its `k` is `--n-expert-used`. **A KEXP for the 2.6B is impossible**: `llama-gguf` shows 0 `_exps` tensors against 8B-A1B's 264. Eight harness defects fixed along the way, all mine, four in the runner (2048-token cap, greedy decoding, no system prompt, an English prompt in front of non-English questions) and four in the judge — the judge's monolingual marker lookup alone manufactured the run's only significant KV result, which evaporated from p = 0.039 to p = 0.289 once fixed. Harness 37 → 54 assertions. Still unmeasured and blocking the tier decision: the 2.6B on an S23, and VL-3B's absence from `ModelRegistry.ts`. |
| 2026-08-21 | **§7.37: the tool round no longer costs the whole cache — 15 of 16 — so the replay that was next to build is demoted before it was built.** Checked BEFORE building, because §7.35 had just cost a day on an `anchored` window aimed at a sliding window that no longer slides. §7.12 priced a tool round at **3.1-3.9 s on a hit against 195-405 s on a miss** and measured **zero of ten** tool-preceded turns surviving. In campaign `32503221846`, of the 16 seeds where a tool actually executed, **15 kept 0.90-0.98 of the cache on the next turn** (mean 0.956). ⭐ The single failure has a shape: it is the only seed whose tool turn recorded **`rounds: 1` with `executed: 1`** — tool ran, no synthesis round — and its next turn reused **nothing** and paid **128 167 ms**. The two other `rounds: 1` seeds had `executed: 0` and kept 0.994. So §7.12's mechanism survives as an edge case, not a rule: the cache dies when a tool result sits in the KV with no assistant answer in stored history accounting for it. ⚠️ **Not a retraction of §7.12**: these arms ran `thinking: "off"`, which switches off the *other* divergence source entirely (§7.9, §7.29), and §7.12's own thinking mode is unrecorded. Neither can be settled against the other until an arm runs with thinking on — which is now the top open item, ahead of the replay. |
| 2026-08-21 | **§7.36: prefill scales with threads on the Jelly — §7.32's hypothesis refuted, and the repeat error is 0.1 %.** Measured on the prewarm (same prefix, hash `730983069` on all eight arms), decode fixed at 2, run **twice in opposite orders** because the first run had arm order confounded with page-cache warm-up and temperature. Mean `promptMs` at 2/4/6/8 prefill threads: **113 867 / 92 999 / 77 419 / 72 121** — monotonic. ⭐ Reversing the order returns the 2, 4 and 6 arms within **0.03 / 0.10 / 0.12 %** of themselves, the tightest repeat this project has ever got on a phone, which settles the confound: thread scaling, not page cache, and temperature rising 29 → 34 °C moved them not at all. ⚠️ **8 is NOT distinguishable from 6**: the 8-thread arm is the only one that failed to repeat (9.0 % spread, wider than its 7.3 % gap to the 6-thread mean), so do not quote it as better. Scaling is sublinear and healthy — 4× the threads buys 1.58×, per-thread throughput 5.7 → 2.3 tok/s, the same shape as §7.20's S23 result. ✅ `deviceTuning.ts`'s `helio-g99` preset needs no change; §7.32's open question closes negatively. ⛔ Product consequence: the prewarm costs **69-114 s on this phone and no thread setting fixes it**. Tuning is not the lever — §7.30's restored session turns a 120.8 s cold start into 1.8 s. The other untouched lever is the prefix itself: 3 203 chars of system prompt plus 3 tool schemas, ~1 300 tokens, and nobody has costed trimming it. Limits: one phone, one model, n=2, all arms on the charger at `thermal=0`; scaling on a 4 000-token chat prompt is unmeasured. |
| 2026-08-21 | **§7.35: the anchored campaign is VACUOUS — the boundary never moved, and I launched it with both knobs that control that left empty.** `32503221846`, fase4 on LFM2.5-8B-A1B, 6 seeds x 4 arms x 16 turns. The arms are indistinguishable (mean `reuseFrac` 0.951 / **0.956** / 0.965 / 0.980) and the positive control says why: **`anchored`'s `boundaryByTurn` is 0 on all sixteen turns of all six seeds**, so a boundary→end window rendered the entire history from index 0 — not a window at all. `promptTokens` confirms it independently, growing monotonically 1 546 → 4 201 in **every** arm, so nothing was evicted anywhere. The boundary advances only when the character budget is exceeded, and the bench exposes `winbudget` (*"controls how often compaction fires"*, default 16 000) and `legacywindow` for exactly that. Both were empty. **The experiment could not have produced a difference.** ⛔ **My first reading of the ciswire arm was wrong and is retracted in the section**: I called the 0/6/12/18/24 boundary an eviction and concluded ciswire was *worse* than baseline. It evicted nothing. `AppShell.tsx:4541` calls **`windowStartIndex`**, not `legacyWindowStartIndex` — the 20-message cap is no longer the live path — and at n_ctx 8192 the budget is 13 824 chars (11 059 for ciswire) against `WINDOW_MAX_MESSAGES = 40`, while a 16-turn fase4 conversation is 30 messages and ~7 653 chars. Nothing was outside the window in ANY arm, which is the single cause of the whole null result; that boundary is the compactor's rebuild cadence, which ciswire does not use for the engine window (`:4754` passes `compactionEnabled: contextMode === "anchored"`). ⭐ **The reframing is the keeper: §7.12's sliding-window collapse is GONE from production.** It measured reuse falling 0.82 → 0.15 at turn 12 against `LEGACY_MAX_HISTORY = 20`; that cap is not what runs. So the question is no longer *does anchored beat the sliding window* but **at what conversation length does the derived window start evicting, and does anchored help there**. §9's "a ciswire arm needs ≥12 turns" is arithmetic against the dead cap. ✅ One real result survives and it **contradicts §7.12 on the model we ship**: with thinking off and no eviction, reuse is **0.95-0.98 at every turn**, including turn 12 (`probe_tool`, `rounds: 2`) at **0.993** — where §7.12 measured a tool call as a guaranteed total loss, 10 of 10. The turn-12 `promptMs` spike (108-140 s) is the tool round's second prefill summed into one turn, not a miss. Cause unestablished; `thinking: "off"` removes §7.9's divergence entirely, so this is a reason to re-run §7.12's tool claim, not to retract it. Corrective run: set `winbudget` and `legacywindow` low, and check `boundaryByTurn` advances **before** reading any speed number. Limits: `thinking: "off"` is hardcoded in the whole fase4 matrix and is not the shipping config; 6 of 40 jobs died at 13.0-15.2 min with no `result.json`, so the surviving seeds are a survivor sample. |
| 2026-08-21 | **§7.34: `tok/s` is tokenizer-blind, and on Italian that hides 12 points.** Measured and reproduced locally on 30 000 bytes of the multi5 Italian corpus: Qwen3.5-2B needs **7 382** tokens where LFM2.5-2.6B needs **8 233** — **10.3 % fewer** — while English is a dead heat (1105 vs 1101). Combined with §7.31's bytes-per-token, **LFM2.5-2.6B reads 46 % more memory per character of Italian** (463.4 MB vs 316.7). In delivered Italian on the Jelly: LFM2.5-2.6B **19.7 chars/s**, Qwen3.5-2B **24.1**, KEXP **25.3** — so **Qwen is 22 % faster than the 2.6B** where the tok/s column shows 10 %, and **KEXP's lead over Qwen shrinks from +17.5 % to +5.4 %**. Qwen's 248 320-token vocab costs it 417 MB/token in output-head reads and earns it back on this language; 10.3 % fewer tokens is also 10.3 % more conversation inside the same 8192 context. **Quality:** the one independent Italian number is EuroEval's generative leaderboard (lower is better) — Qwen3.5-2B **2.69 ± 0.23** against LFM2.5-8B-A1B **3.53 ± 0.25**, with LFM2.5-2.6B absent from the table. ⚠️ **Not quotable yet:** `LFM2.5-8B-A1B-Base` scores **2.89**, i.e. the instruct model loses to its own base, and one task pair collapses to `14.35/7.53` where Qwen scores `69.42/48.73` — the signature of a harness mishandling `<think>` blocks and Pythonic tool calls, not of a capability gap. Resolve it: if real we have a problem, if it is the harness then EuroEval understates every LFM2.5 model. Still absent: any graded campaign on LFM2.5-2.6B, and any graded bpb/instruction score on Qwen3.5-2B in our tree. Vendor numbers are different harnesses and are not a bake-off. **Limit closed the same day:** re-measured on Kalsa's own Italian UI strings the gap is **6.9 %**, not 10.3 (and 2.5 % on the bench's deliberately accent-stripped prompts), so Qwen is **+17.8 %** over the 2.6B in delivered Italian and KEXP **+9.5 %** over Qwen — direction holds, magnitudes are a ceiling. Remaining limit: no sample of real user chat Italian, and that is the register the product runs in. |
| 2026-08-21 | **§7.33 RETRACTED IN PART the same day, by the parallel session — and by a warning already in this file.** I quoted §7.16's 0.41-0.44× GPU decode as settled; §7.16 says of that exact figure *"Do not average them and do not pick one — the next Adreno 750-class measurement settles it"*, and `KALSA.md:308` records that `use_adreno_moe_kernels` excludes A7X with 730/740/750 all A7X, so **K-quant MoE never reached the GPU** and every GPU-decode number we hold measured **CPU fallback with graph splits**. The parallel session repaired the OpenCL expert kernels, certified them bit-exact against the CPU reference (nfail=0), and measured on the S23 **experts on GPU at 2.17× burst / 1.5× sustained, at lower temperature** — a number no prior benchmark could contain. Three further corrections owed: **"try Vulkan not OpenCL" is probably backwards on Adreno** (Qualcomm invests in the Adreno-specific OpenCL path; kernels *existing* on Vulkan is `supports_op`-allowed, not fast — the very trap this section named and then fell into); **"the split is not a flag" is imprecise** (trunk-vs-expert placement is `--n-cpu-moe` / `--override-tensor`; my point was about a *temporal* prefill/decode split, which is moot if the GPU wins decode); and **the 0.61 % vs 0.79 % battery figure was contingent on the GPU being slower** — measured on a dense Qwen at 0.67× CPU speed, it does not transfer to a MoE-expert arm and must not be quoted against it. Still standing: the Adreno 750 prefill ratios, GPU decode being thermally flat where CPU decays 16 %, and Mali not being a target. Agreed next step, theirs: a **Vulkan-vs-OpenCL cell on the S23** after S4. |
| 2026-08-21 | **§7.33: the GPU question answered from evidence that already existed — decode loses, prefill wins 5-6x, and the battery hypothesis is refuted.** On the **shipping** GPU class (Xiaomi 14, Adreno 750, unplugged, Qwen3.5-2B Q4_K_M, `llama-bench -t 6 -r 2`) prefill is **5.77 / 5.97 / 5.63 / 4.14x** CPU at pp 128/512/1024/2048 and **5.26x** on real median TTFT, while decode is **0.44x** (7.07 vs 16.15). ⛔ **The owner's calore/batteria prior is measured and inverted:** S23, 15 min per arm, CPU 12.2 -> 10.2 tok/s (**-16 %**, 42.3 °C still rising) against GPU 8.2 -> 8.2 (**0 %**, 38.5 °C plateau) — the GPU is 4 °C cooler and flat, and spends **0.79 % of battery per 1k tokens against the CPU's 0.61 %**, i.e. **30 % more energy per token**, because it is slower and stays on longer. Cooler is not cheaper. Same on the 4B (5.0 vs 4.0). ⭐ **And for Vulkan there is no kernel to write**: verified in the local checkout, `ggml-vulkan.cpp:17254-17255` lists Q2_K and Q3_K under `MUL_MAT_ID` and `:4330-4331` create `matmul_id_subgroup_q2_k_f16` / `q3_k_f16`, so **KEXP's 2-3-bit experts already have Vulkan kernels** and `SSM_CONV` is present. **OpenCL** is the backend that would need writing — `ggml-opencl.cpp:6688-6713` omits q2_K/q3_K from `MUL_MAT_ID` and q3_K `MUL_MAT` hits `GGML_ASSERT(false && "not implemented")` at `:19204-19221` — and OpenCL is what our S23 arms used. Mid-range **Mali is not a target** (Mali-G68: 0.20x prefill, 0.74x decode). The only shape the evidence supports is **GPU for prefill, CPU for decode**, which is not a flag — llama.cpp does not switch backends mid-context — so its cost is UNMEASURED. Limits: nothing measured on our phone, our app or our model; the prefill ratio is Qwen3.5-2B, not LFM2; thermal/energy is Adreno 740 only; and `supports_op` says allowed, not correct and not fast. |
| 2026-08-21 | **§7.32: the Jelly's CPU and storage, read rather than assumed — and prefill runs on eight threads where six of them are third-speed cores.** Topology measured: cpu0-5 are **A55** (`0xd05`, capacity **348**), cpu6-7 **A76** (`0xd0b`, **1024**). Our split is already hand-tuned — `deviceTuning.ts:180-188` carries a `helio-g99` preset resolving to `n_threads: 2` / `n_threads_batch: 8`, provenance `soc-preset:helio-g99` — so decode already sits on exactly the two big cores. **Open and cheap:** llama.cpp finishes a batch when its slowest thread does, so on a 6+2 machine with a 3:1 capacity split, prefill on 8 threads may be paced by the A55s. Prefill is most of the user's wait (§7.30: 77.7 s of the 120.8 s cold start is a prewarm). Prefill at 2/4/6/8 threads has never been measured on this phone. **Storage is UFS, checked not assumed** (`/sys/class/block/sda` under `11270000.ufshci`, `ro.boot.boot_devices` names it, no `mmcblk*`; `ro.vendor.mtk_emmc_support=1` is a vendor flag, not the block layer). `/data` is **f2fs**, `fsync_mode=nobarrier`, 137 GB free of 228 — disk is not a constraint here. Sequential read **984 MB/s coldest**, 2.9-3.2 GB/s from page cache, so a cold KEXP load has a **~3.4 s floor** no tuning removes. Session pool 37 MB: the live 10 041 119 B file plus a **28 674 134 B legacy `qwen3.5-2b.kvs`**. **Suspicion refuted in the same pass:** the legacy file is NOT stranded — `listPoolFiles` keys on the bare filename stem, so it is counted in the budget and evicted LRU, even though `deleteLegacyModelSession` only ever runs for the active model. Limits: one phone, on the charger, **idle — nothing here was sampled during inference**, so the thread-affinity histogram is inconclusive and is not quoted as a result. |
| 2026-08-21 | **§7.31: every dense `MB/token` we carried was too LOW, and §7.28's caveat pointed the wrong way — retracted there.** Tensor maps read off the pinned HF revisions with a range request (25 MB of header, no weights): **LFM2.5-2.6B = 1666.2 MB/token** (blocks 1451.2 + tied `token_embd` 215.0) against the ~1600 estimate, **Qwen3.5-2B = 1269.9** (852.7 + **417.2**) against ~1230. Neither GGUF has an `output.weight`, so on both the embedding is tied and the same matrix is read in full as the output head every token — which is why file size is a good proxy for a dense model and a terrible one for a sparse one (KEXP: 848 against a 3330 MB file). **Vocabulary size is a decode cost**: Qwen3.5-2B's 248 320-token vocab is **33 % of everything it reads per token**, against 13 % for LFM2.5-2.6B's 128 000. §7.28's throughput spread corrects to **52 %** (9.11 / 7.61 / 5.98 GB/s) and none of it is estimation error. S23 predictions move slightly worse: LFM2.5-2.6B **13.1** tok/s, Qwen3.5-2B **17.2**, both still unmeasured. Also corrected: §2.1's LFM2.5-VL-3B cell said "1674 (from the GGUF)" when 1674.45 MB is the **file size** of LFM2.5-2.6B — within 0.5 % of right, but not computed the way the column header promises. Limits: arithmetic, not a measurement; assumes one read per block tensor and one of the tied head at batch 1; models no KV, no activations, and not the VL model's 583 MB `mmproj`. |
| 2026-08-21 | **§7.30: the prewarm stands aside after a restore — 120.8 s of cold start becomes 1.8 s, measured on the APK that carries the merge.** `d2f34eb` on the Jelly, KEXP, §7.29's exact configuration kept so the APK is the only variable. Five `force-stop` -> relaunch -> turn cycles: the prewarm logged `op:"skip" reason:"restored_kv"` on **all eight** restore events (two per cycle — the share deep link backgrounds RN and the engine re-inits), and turn prefill was **2.08 / 1.79 / 1.76 / 1.93 s** against a cold start of 77.7 s of prewarm plus 43.1 s of first-turn prefill. Decode 7.04-7.43 reproduces §7.28's 6.80-7.31, so the run is internally consistent. First sight of the per-conversation pool key on a phone: `lfm2_002e5-8b-a1b-kexp__conv-…__3524921208.kvs`. **Four defects it was not looking for:** (1) `KALSA_KVDIAG` reports `n_past: 0` on every restore while 1814-1946 tokens are resident and reused — the field is hardcoded to 0 for hybrids on the strength of Q6.c, which §7.29 refuted, so the honesty diagnostic is now the least honest line in the log; (2) `KALSA_PREWARM` logs `match:false` on every send that reused the whole session; (3) the disk gate over-charges **12.7x** — `estimatedBytes` 127 533 056 against a real file of **10 041 119 B for 1946 tokens (5.16 kB/token)**, reproducing §7.25's ~5.2 kB/token, so a 300 MB pool bills ~2 conversations where ~30 fit; (4) every turn writes the session **twice**, byte-identical after a restore. Also: `tokensEvaluated` is the prompt length, not the tokens computed. Limits: one phone, one conversation, n=4 restores, on the charger; the conversation ran 1814 -> 1946 tokens so **the window never slid** and this says nothing about §7.12's turn-11 collapse; `thinking=off` / `compaction=0` are not the shipping configuration; and the native `reusing n/m` line never appears on a restore cycle, so the reused-token count is inferred from timing, not read. |
| 2026-08-21 | **§7.29: the hybrid restore is real — `n_past=1473`, not the assumed 0 — and the thing that destroys the cache is a divergent prompt, not the architecture.** KEXP after force-stop: `is_hybrid=1 resumable=1`, loaded in 19 ms, next send at n_past 1368-1604 and **~2 s of prefill**, n=2. Qwen3.5-2B restores just as well (1605 tokens in 43 ms) and then logs `no usable state checkpoint … doing full cache clear`, **n_past=0 and 104-138 s**. **Correction, mine:** this was reported as two of our measurements disagreeing. It was not — `TTFT_FIXES.md` lists Q6.c under *"explicitly not in this branch, out of scope"*, so it was an honestly-labelled assumption and §7.25 was the only measurement. §7.28's inferred cause for Qwen is now measured on the wire: 14 reasoning tokens in KV, absent from the re-rendered prompt, and it reproduces **without** a force-stop (122 s), which is what clears the restore of blame. Two fixes landed: `shouldSkipPrewarmAfterRestore` now keys on whether the restore populated KV rather than on dense-vs-hybrid (otherwise the merged branch's prewarm `seq_rm`s over a live 1600-token session on the model we ship), and `preserveThinking` is set on both Qwen entries that lacked it. Limits: one phone, one APK that predates the prewarm, two models; what the prewarm does after the fix is untested because no build carries the merge yet. |
| 2026-08-21 | **§7.28: the two small models lose to the 8B MoE on the Jelly, and one never reuses its cache.** KEXP **7.31** against LFM2.5-2.6B **5.47 mean** and Qwen3.5-2B **~6.0** — the sparse 8B wins with a file 2-3x larger, because decode reads `MB/token` (848) and a dense 2B reads more (~1230-1600). §7.27's "needs a smaller model" retracted: it needs a smaller **byte budget**. Predictions written before the run and scored after: over-predicted both by up to 33 %, while the same method hit **8.1 predicted vs 8.06 measured** on the S23 — the byte budget holds where the machine is bandwidth-bound and fails where it is dequant-bound. Effective throughput on one phone spans **46 % by packing alone** (8.75 / 7.37 / 5.98 GB/s), so the §9 per-device scalar must be per quant family; caveat, the two dense MB/tok are file-size estimates and part of that spread may be estimation error. **New defect found: `qwen3.5-2b` and `qwen3.5-4b-q3` declare `thinking` without `preserveThinking`**, so the think block enters the KV and vanishes from history — divergence every turn from turn 2, which is what the 80-128 s prefill is. Inferred from the registry, not measured by toggling. All arms 4 turns, so none of these numbers can see the turn-11 collapse. |
| 2026-08-21 | **§7.27: unplugged on the Jelly, KEXP wins by 1.7x — the CLI ranking inverts inside the app, and neither quant is within 2.7x of the product floor.** First Jelly timings taken off the charger, so the first ones quotable at all. KEXP **7.31 / 7.14 / 6.95 / 6.80** against Q4_K_M **4.23**, reversing `ALIVE.md`'s 10.60-vs-8.83 CLI ordering on this same phone. Cause is headroom, not arithmetic: add Kalsa's ~1.5 GB and Q4_K_M runs at **0.92 GB `MemAvailable`** with a creeping `io_read`, while KEXP sits at **2.37 GB** with the counter **exactly frozen**. Decode is 1.73x apart on files 1.55x apart, prefill only 1.16x — the excess is reclaim, not bytes. **Benchmark the quant inside the binary that ships it.** §7.25's KV reuse confirmed unplugged and across turns: prefill 132.8 s -> ~2.8 s, `tokensCached` 2253 -> 3153. **Product: the Jelly cannot run this model in any quant tested** — 7.31 against a 20 tok/s floor is 2.7x, the first hard "neither option qualifies" for per-phone selection. Limits stated: n=1, Q4_K_M has a single turn-1 number because its turn 2 never finished in 420 s (so it is compared against a 4-turn plateau, which §7.20 forbids), differing prompt lengths make only the prefill *rates* comparable, and Q4_K_M **survived** here where §7.26 lost it to a suspected lmkd — two runs, two outcomes, uncontrolled. Instrument gap: this ran on a hand-written script because `ci-bench.sh` cannot type into the Jelly's composer without double-landing text, so no graded arm can run on this phone yet. |
| 2026-08-20 | **§7.26: the residency hypothesis is confirmed on a second phone — and full residency turns out not to be survival.** The same Q4_K_M file (md5 verified identical) that sits at 51 % on the S23 goes **100 % resident** on the Jelly Star, which has 1.6 GB more `MemAvailable`. So residency is governed by available memory, not file size, and every conclusion §7.20-§7.24 drew from one device now has a second point. **But holding the whole file pushed `MemAvailable` to 0.83 GB and the process was killed about two minutes later, with no reply produced.** The rule the RAM gate needs is therefore `model <= available - headroom`, with headroom > 0.8 GB — and today `estimateMemory` models non-evictable memory only and is blind to page-cache residency, the thing that decides between 22 tok/s, 0.26 tok/s and a dead app. Two calibration points now exist and they fail differently: S23 51 %/survives/25x slow, Jelly 100 %/killed. Stated rather than implied: the kill was not confirmed as lmkd in logcat, `read_bytes` hit 9.82 GB for a 5.15 GB file (~1.9x, unexplained), n=1, on the charger. |
| 2026-08-20 | **§7.25: the disk KV restore works on `lfm2moe` — 83.9 s of prefill becomes 1.5 s.** Measured on the newly onboarded Jelly Star with KEXP in production config: after a force-stop and relaunch the engine logs `KALSA_KVRESUME ... is_hybrid=1 resumable=1`, loads the state in **29 ms** and reuses **1672/1747** prompt tokens. So **llama.cpp #25913 does not apply to us** — measured, not merely reasoned: it is a `llama-server /slots` defect (fix PR #26004 still open, not in our pin b10156) and Kalsa calls the low-level `llama_state_seq_save_file`, which serialises hybrid recurrent state correctly. The `.kvs` is 8 668 927 B for 1672 tokens = **~5.2 kB/token**, projecting to ~41 MB at the loaded context — 5 % of what the model reads for one generated token. **The UFS session pool is therefore buildable**: `sessionPersistence.ts` keys per model, and `AppShell.tsx:3237` already documents the consequence ("switch-back is always a cold start"), so what is missing is the key and an LRU budget — on UFS, not RAM, by owner's decision. It does **not** fix §7.23's turn-to-turn cost: a restored state survives only if the next prompt is an exact continuation, so the pool and the append-only transcript are the same fix from two ends. Free cross-check: KEXP does **8.04 tok/s inside Kalsa** vs **8.83 under the moe-experiments CLI** on this phone — a 9 % gap, so our stack loses nothing meaningful to a bare llama-cli. Charging, n=1. |
| 2026-08-20 | **§7.24: the collapsed regime persisted for a whole arm, and the arm that revealed it was vacuous for an unrelated reason.** Two `fase4` arms back to back on KEXP: `off` complete at 14-20 tok/s, then `ciswire` which **never exceeded 4.12 tok/s on any of its nine turns** — same model, same prompts, same prefs. §7.20 showed the collapsed regime recovers in one turn after contamination; this shows it can also be entered and **not** exited for an hour, which for a consumer app is a different defect: not a slow fifteenth reply but an app that stays slow afterwards, fresh chat included. **Two candidates and this arm cannot separate them:** cumulative memory pressure vs sustained thermal (the second arm ran entirely at thermal status 2, ~40 C). Not established as memory; the doc says so. Separately, the `ciswire` arm is **vacuous as a ciswire measurement**: `corpusSize: 0` and `frozenDigest: ""` at turn 9, because the 20-message window had dropped nothing yet — the digest first populates around turn 11. That is §8's documented trap, now on its third campaign: **a ciswire arm shorter than ~12 turns cannot measure ciswire.** Instrument gap named: `ci-bench.sh` samples thermal per turn and memory not at all, while the runner that samples memory is a different script. |
| 2026-08-20 | **§7.23: the consumer numbers, taken for the first time — a 16-turn conversation costs 42 points of battery and grows to 11 minutes of compute for one reply.** Recorded at the owner's instruction: stress arm or not, Kalsa is a consumer app. 16 turns in 1h45m, 100% -> 58% unplugged, ~2.6 points per reply, ~23%/h screen-on (in line with the standing 30%/h figure). Per-turn wall grows 2m00 -> 27m21. **Decomposed honestly:** only ~47 of the 105 wall minutes are compute; the rest is harness settling, so the 27-minute turn is not all model. What is all model, from llama.cpp's timers: turn 1 = 90 s, turn 14 = **660 s**, of which **397 s is prefill**. And the prefill *rate* is normal (13.9 tok/s) — the cost is that we pay a full one every turn, because the 20-message window slides and LFM2 cannot roll back recurrent state. §7.12, priced in minutes. **Shipping blocker for long conversations, independent of every quantization question**, and not fixed by a smaller model or a faster decode: decode is 8-79 s of an 11-minute turn. The levers are tool-round replay, an append-only window, and GPU prefill where it is real. |
| 2026-08-20 | **§7.22: the 2-bit experts did not break tool calling — our own gate did.** `tools` gate/nogate pair on KEXP, S23, 14 turns each. Structured output **intact** in both arms: `firstTryValid`, zero fallback-dialect calls, zero parse failures, zero empty bubbles, zero truncations. Turning `toolgate` **off**: recall **0.429 -> 0.714**, precision **0.750 -> 0.833**, missed calls 4 -> 2, and the one spurious call **unchanged** — the rule blocks good calls and does not stop the bad one, which is what §1.1 derived from its scoring on 2026-08-14 and nobody had measured on a real model. **The largest available improvement to Kalsa's tool use is a JS rule, not the weights.** Residue that is genuinely the model's: two `tool_required` misses and `tool_selection` 1/3, all `noCall` never `wrongTool` — that, and only that, is a fine-tune target, and only after the gate is fixed. Limits stated: n=1 seed, production repack (so the gate arm spent half its turns in §7.21's collapsed regime), phone on the charger so no timing here is a measurement, and no Q4_K_M control exists for this phase on this model. |
| 2026-08-20 | **§7.21: production repack makes KEXP bimodal — 0.45 to 19.96 tok/s across 13 turns — and it refutes §7.15's "the repack arm is VOID on this model".** Found by accident: the `tools` quality arm was the first time KEXP ran with `no_extra_bufts:0`. §7.15 argued the flag could not matter because q2_K/q3_K have no ARM repack path; true of the **experts**, false of the **trunk** — 47 `q5_K` + 20 `q6_K` tensors, ~0.5 GB, all repack-eligible, copied into non-evictable anonymous memory on top of the 2.76 GB of expert pages that must stay resident. Working set crosses, experts refault, turns collapse into the regime §7.20 reproduces on command. Charging caveat stated: the timings are not quotable, the 40x shape is. Product: `no_extra_bufts` must stop being a bench flag for this model class. Gate: `estimateMemory` charges repack on the whole file, which over-charges KEXP while still being blind to residency. |
| 2026-08-20 | **§7.20: KEXP decodes at ~22 tok/s, and the 0.861 that drove two days of investigation was the previous model's page-cache storm.** Four consecutive turns on an idle phone: **19.97 · 21.81 · 22.26 · 21.98** tok/s, `RssFile` ~3.33 GB, `majflt` deltas of 14–55 after the load — **2.7x the dense Qwen3.5-4B measured the same morning in production config (8.06)**, which is what ~1B active parameters should buy, and ~14 GB/s against §7.19's byte budget, i.e. this SoC's DRAM roof. **The slow regime reproduces on command:** run the 4.80 GiB Q4_K_M first (0.263 tok/s, 182 608 major faults, 15 237 370 refaulted pages = **58 GiB** in one turn), then KEXP immediately — turn 1 **1.15**, turn 2 **20.92**. That is exactly §7.15's shape, because §7.15 unknowingly ran that experiment: its two turns followed §7.14's 93.5 GiB storm, on a file written to app storage twenty minutes earlier. **Three retractions, all mine, two of them written the same day:** §7.15's "residency solved, speed not — kernels are the remaining lever" (there is no kernel problem); §7.19's "the 6-15x gap is between the two stacks" (there is no gap — this app is four times faster than the mainline CLI number that section quotes); and the minor-fault hypothesis, refuted at 519 `minflt` per token against ~167 000 predicted. Threads measured healthy for the first time rather than assumed: 2 threads 13.26 vs 5 threads 21.32, with the `Attached ggml threadpool (n_threads=2, ...)` line confirming the override applied. **Not separated, and the doc says so:** the APK also changed between the two runs (installed 2026-08-19 22:52, after §7.15's 13:44), the contamination was heavier yesterday, and yesterday's KEXP file had just been written — page-cache contention is proven *sufficient*, not proven to be the whole of yesterday's persistence. **Methodology, retroactive to §7.11-§7.15:** a model switch invalidates the next turn or two, so the two-turn protocol quotes a number taken inside the recovery; measure four and quote the plateau. **Product:** the quality gate KEXP misses (+0.0705 macro bpb) is now a live trade against a shippable decode number instead of against nothing. New on trial: repack itself, which in production config left the dense 4B with 3.77 GB anonymous, `MemAvailable` at 930 MB and **961 major faults per generated token**. Probe now captures `minflt`/`majflt` from `/proc/<pid>/stat`, which no run before today did. |
| 2026-08-20 | **§7.19: the batch-1 `MUL_MAT_ID` suspect is demoted, by a number that was already on this disk.** §7.15 ended by asking for a profile of MoE decode at batch 1. Our own other tree, `kalsa-moe-experiments`, had run **LFM2-8B-A1B Q4_K_M on this same S23** under mainline `llama-cli` (pin `67d5978`) back on 2026-08-04: **median 5.30 tok/s** at `t=4 c=512 kv=q8_0` — and *while thrashing*, millions of major faults and ~10 GB re-read per 128 tokens, which is why that grid is marked invalid as a stable baseline there. Q4_0 on the same cell: 6.20 / 7.60. The Kalsa app on the same phone and the same shape: **0.357** thrashing (§7.13) and **0.861** at 96 % resident with no storm at all (§7.15). The same lineup card records a **35B-A3B** streamed from 13.4 GB at **5.696 tok/s** and a 6.4 GB MoE at **8.819**. So the generic `MUL_MAT_ID` path — same upstream code — produces 5–9 tok/s on this silicon and cannot be the explanation: **the 6–15× gap is between the two stacks, not inside the arithmetic.** Next experiment changes shape accordingly: not an on-device profiler but that CLI against the Kalsa app **on the same GGUF**, one session. Killed on arithmetic before it cost anything: the per-token RN bridge callback, since the dense 4B does 5–8 tok/s in this same app, bounding app overhead at ~125–200 ms against the 1161 ms/token that 0.861 means. Candidates carried in: the `v8_2_dotprod_i8mm` variant we select (`CMakeLists.txt:151-156`) against our own measured **GEMM-win / GEMV-loss** on exactly that combination (12.37 → 18.19 tg256, `research-mellum2-paper-tuning.md:263-267`); threads 5 against the 4 that grid picked; `n_ctx` 8192 against 512–1024 on a hybrid; flash attention with `v: q4_0`. Not a candidate: our native patch — it touches telemetry and session plumbing, no kernel, no `ggml` file. |
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
| 2026-08-19 | **The RAM gates never read the norepack knob, and the file that hardcoded it says why that is a bug — then I retracted my own hedge by reading the C++.** `NOREPACK=1` on the phone changed nothing: `does_not_fit`, `availableMb` 3910. Cause: `evaluateModelFit` hardcoded `repack: true` under a comment reading "The bench norepack arm bypasses these gates; wiring a gate to a different load mode than the engine actually uses is the S23-class bug class" — the bypass did not exist. Two gates, not one: `evaluateModelFit` blocks lazy restore, `gateForModel` inside `ensureEngineForModel` (`AppShell.tsx:2951-2965`) produces the error bubble and refuses before any engine init. Both now take the resolved mode, default `true`, production unchanged; 3 regression cases carry the measured 5155564768 B / 4030 MiB. **Retraction:** I had hedged that `REPACK_FRACTION` (calibrated on a dense 2B) might be badly wrong for a MoE. `repack.cpp:4791-4795` supports `MUL_MAT_ID` with 3-dim `src[0]` — the stacked-expert matmul — `block_q4_K` has repack traits, and `:4751` allocates a full-size ordinary CPU buffer to repack into. Experts are nearly the whole file of an 8B-A1B, so the estimate is substantively right and **the S23 genuinely cannot hold this model with repacking on**. The product choice narrows to: ship `no_extra_bufts` on ≤8 GB and pay prefill, or do not offer the model there. |
| 2026-08-19 | **§7.11 confirmed on the phone: the shipping model does not load on a Galaxy S23.** Predicted from the app's own constants in the morning, measured in the afternoon on the debuggable APK `32254348018` with the GGUF md5-verified end to end. `'model.fit', '{"verdict":"does_not_fit","availableMb":4030}'`, no engine init attempted, and a deep-linked turn answered in the same millisecond with "Caricamento del modello non riuscito … tocca Riprova caricamento" — advice that cannot work, since the RAM will not be different next time. The gate charges 4401 MiB of weight repack from `REPACK_FRACTION` 0.8951, a constant calibrated on **Qwen3.5-2B, a dense model**, applied to a **MoE with ~1B active**; nobody has checked whether llama.cpp repacks expert tensors at all. So the app may be refusing a model this phone could run, and the refusal leaves no allocation behind to compare against. `norepack=1` run dispatched to settle it. Also restored to this branch: `scripts/device-env.sh`, `device-share-send.sh` and `test_device_share_send.sh` (17/17 pass), which existed only on `bench/kvtranscript-probe` — the commit that added them is literally titled "Stop losing the way to drive the phone" and it was lost again anyway. |
| 2026-08-19 | **§7.12, third version and the first that survived a second dataset: there are two cache regimes, one per model, and the biggest destroyer is the sliding window — in bare too.** Checked the smoke (`32157672018`, LFM2.5-8B-A1B) against the 4B campaign (`32048465417`, 570 turn observations) instead of trusting either alone. **Regimes:** on Qwen3.5 reuse is continuous (482/570 turns strictly between 0 and 0.90); on the shipping model it is bimodal, 0.98 or exactly 0. That is `llm_arch_supports_rs_rollback` — true for QWEN35, false for LFM2 — so on the model we ship one divergent token costs the whole cache and there is no partial credit. Which retires §7.9's "a third of the prefix is re-evaluated": 0.599 is a hit count, not a fraction. **Window:** mean reuse on the 4B goes 0.82 at turn 11 → **0.15 at turn 12**, in `baseline`, which never carries a digest — `LEGACY_MAX_HISTORY` is 20 messages, so the oldest exchange starts falling out of `slice(start)` and the prefix diverges right after the system prompt every turn. Predicted in design at `RESEARCH_CONTEXT_LOSS.md:104`, measured here for the first time: **the KV work pays for about ten exchanges, then the window throws it away for every shipping mode.** **Tools:** on the shipping model, 10 of 10 turns following a tool call lost everything, zero survivors — `LlamaService.ts:1930-1941` puts `assistant(tool_calls)` + `tool(result)` in the KV, history keeps only the final answer, `:1942` already marks it; 3 s prefill on a hit against 195–405 s on a miss. On the 4B the same event costs 0.507 against 0.637 — survivable only because it can roll back. **Digest:** real but second-order, and collinear with the window by construction (a digest exists exactly when the corpus is non-empty, i.e. exactly when the window slides); the `baseline` row is what separates them. Two earlier versions of this row today were wrong — the first blamed the digest, the second generalised 10/10 from one 7-turn smoke. Both are kept above with banners. |
| 2026-08-19 | **§7.10: the reason written in the code for why the digest costs cache is wrong, and the wrong reason has already cost one experiment.** The block is last only for the turn that carries it; next turn `promptContentForHistoryMessage` re-renders that user message clean (`modelEmittedText.ts:16-23` replays assistant messages only), so the last stable token falls back past the block, past that user turn, and past **the reply generated after it**. The cost is therefore per *injection*, not per *change of content* — which is precisely why the 2026-08-03 freeze, which held content still and kept injecting every turn, could only measure zero prefill saved. `compactor.ts`'s header and `RESEARCH_CONTEXT_LOSS.md:157` both carry the old reasoning; the header is corrected in place. Instrument written, **result not**: `parseBenchDigestCadence` + `shouldInjectOperativeBlock` (8 unit tests), `getBenchDigestCadence`, `DIGESTCADENCE` in `ci-bench.sh` with the both-branch assert, `digestcadence` workflow input, pref visible in `prefs.txt`. Empty/1 = production, untouched. Acceptance criterion fixed before the run: cache must rise *and* the loss must concentrate on injection turns, *and* recall must be reported alongside — cadence trades cache against exactly the staleness the freeze revocation measured at 33.3 % vs 100 %, so a cache win alone does not ship. |
| 2026-08-19 | **§7.15: KEXP was run on the phone and the residency bet won — the storm stopped, and the speed did not arrive.** 3.10 GiB, md5 verified identical across desktop / `/data/local/tmp` / app storage, prefs byte-identical to the §7.14 arm except `kalsa.model.id`. `RssFile` plateaus at 3 270 144 kB against a 3 248 203 kB file (**~96 % resident**, against 53 % for the 4.80 GiB build) and its oscillation drops from **2.04 GiB to 100 MiB**; `workingset_refault_file` on a warm turn falls from 24 523 321 pages (93.5 GiB) to 193 224 (755 MiB), **130×**. The prediction was written before the run and is confirmed: the ceiling was competition for page cache, not a page-cache budget. **But decode reached only 0.861 tok/s** (turn 2; turn 1 is 0.324 and contains the load — do not average them), so §7.14's closing "the lever is residency, not kernels" is **half wrong and the wrong half is mine**: residency was the lever for the storm, kernels are the lever for the speed. Named the confound the whole device campaign has carried: §7.11–§7.15 are all `norepack=1`, ARM GEMM **off**, because at 4.80 GiB the repacked buffer did not fit. At 3.10 GiB it should: 2839 + 249 = **3088 MiB non-evictable against 4016 MiB of measured `MemAvailable`**, conditional on the file pages being released after repack — `RssAnon` vs `RssFile` settles it in one turn. Not yet run; the phone went to another task at 49 %. Also fixed: the KEXP registry entry had been committed **twice** with the same id (`656f5ee`), harmless to `getModelById` but a double row in Settings. |
| 2026-08-19 | **§7.17: the first offload arm measured a KV constraint, not a GPU — and the engine knew the answer but could not tell us.** All three turns returned the load-failed bubble; GPU init and the CPU retry both failed, because `llama-context.cpp:3566` refuses a quantized V cache when flash attention is off and every LLM we ship has `v: "q4_0"`. The defect was the knob designed that morning: making `flashAttn:"off"` the mandatory escort for `nGpuLayers` built an arm that cannot initialise on any shippable model and confounded two variables. An audit had passed over that code already — briefed at whether the JS guard was correct, never at whether the engine would accept the parameters, so the defect sat one level below the question asked. **Two misdiagnoses first**, GPU offload and then the low-memory killer, the second more convincing precisely because logcat showed `lmkd` reclaiming in the same second: a plausible mechanism visible in the log is not a cause. The reason it cost an afternoon is the real finding — `ensureNativeLogCapture` set its done-flag *before* the try, so a failed `toggleNativeLog` latched a capture nobody had installed and llama's exact error never reached JS (fixed `1df593b`, flag last). Also fixed `3b20bae`: `flashAttn:"off"` now forces `cache_type_v:"f16"`, the only spelling that can initialise. A follow-up audit enumerated all eight init constraints, confirmed the fix sufficient and production (`flash_attn_type:"auto"`) never affected. **Known about GPU offload here: still nothing** — but for the first time the question is cleanly askable. |
| 2026-08-19 | **§7.16: the GPU is not the lever for our blocker, and one suggestion made here the same day is retracted.** Cross-tree with the session working on the OpenCL kernels. Their measurement: MoE **decode** on Adreno 740/750 is **0.41–0.44× the CPU**, ~60 ms/token of dispatch glue — applied to §7.15's 0.861 tok/s that predicts ~0.36, worse than where we are. The GPU *is* a **3.2–7× prefill** lever, which is precisely what §7.12's sliding window costs us every turn the cache dies. The two trees have different gates and each reading was right about its own: here `use_adreno_moe_kernels` excludes A7X and `get_adreno_gpu_gen` puts 730/740/**750** all in A7X, so K-quant MoE never reaches the GPU on this phone; in their tree the gate is name+shape only, so those kernels run and they are measuring the corruption upstream merely switched off (upstream's own comment names it: `*_trans4_ns` aliasing a private `ushort8` through a `uchar*`). **Retracted: "lift the A7X exclusion".** On this silicon that unlocks kernels measuring ERR 0.36–0.9 against a 0.0005 threshold — correct-CPU traded for garbage-GPU. **Also corrected: "an MXFP4 MoE would run on the S23 today".** `supports_op` returning true is not correctness; nobody has tested it on a 740, and in their tree mxfp4 fails 0/74 on the Adreno path. Only q8_0 is measured green (75/75) at 8.5 bpw, ~8.8 GB, not a candidate. Instrument built the same day: `applyEngineOverride` now allows `nGpuLayers` on Android when the override carries `flashAttn:"off"` (the never-run cell), production untouched; `initLlama` gained the CPU fallback it never had, logging `KALSA_GPU_FALLBACK` loudly so the arm cannot publish a CPU number as GPU. |
| 2026-08-18 | **The 4B campaign landed and CisWire holds: +0.209 over bare, p = 0.0108** (`32048465417`, 38 usable arms, permutation tests). §3.2's prediction was right — the effect shrinks, from +0.635 on the 2B, because bare climbs 0.313 → 0.785 while ciswire goes 0.948 → 0.994 with sd 0.083 → 0.019. What survives is entirely **distance**: the 4B is perfect on recent facts and loses over half the distant ones (0.446 late), ciswire loses none (1.000). Three things nobody predicted: **`v42` dies** on the stronger model (+0.040, p=0.70, against +0.354 p=0.043 on the 2B); **`nogate` reverses**, 0.094 on the 2B against 0.944 on the 4B, which is the hardest evidence yet that harness decisions are model-dependent; and **§1.5's token saving does not reproduce** — history length is identical across arms, so on the 4B the digest is pure cost, +350 prompt tokens at turn 13 and ~95 s more prefill per turn. §3.1's blocker did not reproduce either: zero blank bubbles across all 38 arms. Two arms died on the 2400 s per-turn cap, both **untreated** (bare writes longer replies, so it reaches the cap first), so `baseline` and `nogate` are n=9 and the completeness gate correctly refused to publish. |
| 2026-08-17 | **§7.7j: the join is closed, and the diagnostic that proved it refutes my own acceptance criterion** (`b31fb53`). Six turns unplugged from the coldest start yet (27.9 °C): 103 s then **31, 32, 32, 32, 31** — turn 6 was 151 s in §7.7i. One `rebuild` in the session (`fresh`, turn 1), `KALSA_KVDIVERGE` zero, five consecutive boundaries reused against two, `Thermal Status` 0 throughout, 2 % battery for six turns. `glueEot` fired at every boundary (`glue=11`), which was the fix's whole job. **But the 48-char seam windows show `T` ending with the reply in generation form and the delta restarting from the same reply in history form: every assistant turn is in the prompt twice.** Not caused by the glue and not a deep-link artifact — `kvTranscript.ts:157` builds `T` from `candidate + emitted + suffix` and `candidate` ends with the empty think block, so the ordinary path duplicates too; §7.7i had it without the glue between the copies. The criterion I fixed before measuring — no divergence, `n_common == embd.size()` — is **true with the duplicate in place**, because `T` stays a valid prefix however malformed its content: it measures reuse, not correctness, and all six replies read fine. Latency result stands, correctness result does not, **route 2 does not merge**. Suspect is `cutPPrevFromRolePair` (`kvTranscriptFormat.ts:130`): `pPrev`=5532 against a turn-1 prompt of 5551, short by exactly the 19 chars of `<think>\n\n</think>\n\n`. |
| 2026-08-17 | **§3.11 closed by reading the code, not by fixing it: the privacy gate was never inspecting the wrong facts.** The two slices genuinely disagree on their face — prompt takes `slice(-10)`, `webSearchTool.ts:88` takes `slice(0, 10)` — but the array reaching the gate is capped upstream at `AppShell.tsx:2348`, so the second slice is the identity, and `:4485` hands the gate **the same array object** `:4724` sends to the engine. The 2026-08-16 row below calls it "a pre-existing privacy defect"; that was wrong, and this row is the correction. What survives is a latent trap: the guarantee rests entirely on the upstream cap, so raising it — or sourcing `getMemoryFacts` from `MemoryStore.listFacts()` — silently splits the two sets with nothing failing. |
| 2026-08-17 | **§7.7f: MEASURED PASS — the KV survives a turn boundary for the first time** (`3a3a15f`). Arm A: `n_common` equals the cached size at both boundaries (1298 and 1353), `n_past` resumes at 1298 instead of 0, `KALSA_KVDIVERGE` count zero. Control arm reproduces §7.5's signature exactly — same `[248068 271 248069 271]`, same full clear — so the zero is not a dead arm. 29 tokens prefilled where 1298 used to be. Four earlier attempts failed for reasons worth keeping: thinking-polarity refuted by measurement; a run invalidated by an app restart and by tools left on; then `prefix_mismatch` at every boundary, whose cause was the template rendering the last assistant differently when it is final — §7.5's asymmetry biting the delta computation this time — fixed by rendering the previous state with a trailing sentinel and cutting at the longest common prefix of a user-probe and an assistant-probe render. Also settled: `T` and `pPrev` differ by 50 chars at the passing boundary, which is why the `T === pPrev` guard had to go — `pPrev` is a ruler for what is new, not a claim about the cache. Not durability: two boundaries, one run, text-only, no tools, no images, inside 8192 ctx, and §7.7e's production blockers still open. |
| 2026-08-17 | **§7.7e: route 2 built — the prompt is ours now, behind `kalsa.bench.kvtranscript`, off by default** (`9d92f5f`, `934954c` on `bench/kvtranscript-probe`). `T` holds what entered the KV; each turn's delta is the difference between two consecutive *history* renders, never history against generation, which keeps it template-agnostic for LFM2.5 and gemma. `messages` must be omitted or llama.rn overwrites `prompt` with the jinja render (`src/index.ts:795-816`). The end-of-turn suffix is captured with a marker-bearing dummy assistant message — no template's tokens hardcoded, which was the objection that killed the override. Every untrustworthy path rebuilds with a **named reason**; the silent re-prefill is the defect, the declared one is correct behaviour. **Three hostile audit rounds by a different model than the author**, which found in order: `T` advancing sixty lines before the engine saw the prompt; stale `T` after OFF and auxiliary turns; dispose resurrecting a reset transcript; then, by reading the engine's C++, that `context_full` is returned *before* the prompt is accepted under `ctx_shift:false`; and finally that a non-throwing `llama_decode` failure sets no flag at all while trimming the token list. Rounds one and two are closed and re-verified; round three authorises **the bounded phone experiment but not production**. Also refuted along the way: my own hypothesis that a commit erases the untrusted mark. |
| 2026-08-16 | **§7.7d: thinking ON measured on the device and REFUTED, at zero build cost.** Flipping the polarity does remove the empty think block, and replaces it with its mirror image: the KV holds the reasoning the model emitted, the re-rendered prompt holds the cleaned answer, because the template's history branch strips the think block. `n_common=1616` against `embd=1814` / `text_tokens=1747`, one `KALSA_KVDIVERGE`, full clear, `n_past=0`. `modelEmittedText` was persisted and preferred correctly, so the defect is not on our side: **the template will not re-render history to match the KV in either polarity**, and route 1 of §7.7 is dead in both directions. Engine proven to have run (turn 1 `n_common=0`, saves at messageCount 2 and 4, visible reply). Also recorded: the single checkpoint sat at exactly the end of the restored state in both this run and §7.5's, which suggests checkpoints come from session save/restore rather than prefill progress — tempering §7.7c before a build is spent on it. Device left at `kalsa.bench.thinking=budget512` with the chat wiped; revert before quoting any campaign. |
| 2026-08-16 | **§7.7c: a third road, found by reading the engine's own type declarations — the hybrid checkpoint budget is a parameter, and Kalsa has never set it.** `state_cache_budget_mb` (default 160 MiB) and `state_cache_max_checkpoints` (default 8) are `NativeContextParams` fields (`types.d.ts:166,171`) documenting a cross-turn KV prefix cache built for recurrent/hybrid models; `grep` over `src/` finds neither. The device observed **one** checkpoint where eight are permitted. A checkpoint at or before the divergence point would restore reuse **without touching the template**, changing no model behaviour and arming no privacy defect — it costs one build, which is the only reason the zero-build polarity test of §7.7b runs first. Web research the same day (primary sources) adds: the asymmetry is open upstream as Qwen3 #1826 with no fix coming (Qwen3.6 #48/#131 closed with no PR; llama.cpp #20182/#21511 closed as not planned); no mainstream wrapper keeps a template-agnostic append-only transcript; and — the part that may matter most — llama.cpp #25913 reports that disk slot restore does not serialise context checkpoints, so a restored hybrid slot reports all tokens restored and re-prefills anyway. If that applies here, fixing the template closes the turn boundary and leaves the restore-after-restart path still paying full price. Unverified against this engine; check before declaring the 390 s closed. |
| 2026-08-16 | **§7.7b: the "template symmetry" route was refuted by reading the code, before any build was spent on it.** The flags it proposed setting — `enable_thinking`, `chat_template_kwargs` — are already set to `false` on the production path (`thinkingBudgets.ts:45-58,75-86`, spread at `LlamaService.ts:2000`), and that is precisely why the template injects the empty think block. The corrected route is the opposite polarity (Marco): run with thinking **enabled**, so there is no empty block to inject and the real reasoning block — genuine model output — is replayed by the machinery already shipped in `6447ff2`. It costs **zero builds**: `thinkingMode` is a persisted setting (`benchConfig.ts:155-163`) and the on-device APK already supports `budget512`. Four costs recorded before measuring (context at `engineCtx` 8192, `nPredict` squeeze, an armed privacy defect in `ci-dflash-ab.sh:235-238`, stream shape), plus Marco's correction that compaction is an event rather than a per-turn rewrite. Three citations in route 2 corrected on disk: `types.d.ts:540` is `NativeSessionLoadResult`, not a completion input; `prompt` is reachable from JS only because `CompletionBaseParams` re-adds it (`index.d.ts:65,91`); `generation_prompt` is both an input (`types.d.ts:216`) and a `getFormattedChat` result (`:565`). |
| 2026-08-16 | **Two hostile audits, and the second one earned its cost by refuting rather than adding.** Run at max reasoning against the first auditor's findings, it confirmed three, **refuted four** (the atomicity race I had suspected reconciles in every direction at boot; the `undefined` key is a red herring; no new leaks), and corrected two of the first auditor's citations. It also found the reachable case the first had missed: the replay cap is **2000** chars, not 4000, whenever the current turn carries an image, applied to every history message. Implementing on the first audit alone would have written code for a race that does not exist and shipped the truncation defect that re-introduces the whole 390 s. |
