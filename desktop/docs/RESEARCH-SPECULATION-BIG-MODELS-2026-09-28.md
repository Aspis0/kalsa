# Speculative decoding on the big catalog models — 2026-09-28

Question: after the alpha, which speed lever pays on the BIG catalog rows —
MTP heads and draft models for Gemma 4 (E4B/12B/26B-A4B/31B), Qwen3.6-35B-A3B
and Qwen3.8-27B — on the engines we already ship? Read in sequence after
`DSPARK-M1MAX-2026-09-28.md` and `DSPARK-SURFACE-2026-09-28.md`: DSpark on the
2.6B gave +15…+39% on English and regressed on Italian expository; the lesson
there was that a 0.6 GiB drafter is expensive *relative to a 2.6B target*. On
big models the drafter's relative cost is small — that is the hypothesis this
doc arms with evidence.

Method: same rules as the previous research docs — every number carries its
source and the exact sentence where practical; labels are **MEASURED-BY-SOURCE**
(a named third party measured it), **MEASURED-BY-US** (our own DSpark docs),
**CLAIMED** (publisher marketing), **INFERRED** (my arithmetic or judgement).
Web sources read live 2026-09-28; GitHub PR states via the API; fork states by
grepping the local clone. Machines: M1 Max 64 GB (MacBookPro18,2) and the
Lenovo (Core Ultra 9 185H, 32 GB, RTX 4050 — NIGHT-RUN-2026-09-25.md:21).

---

## 1. Gemma 4 (E4B, 12B, 26B-A4B, 31B)

### 1.1 What Google ships

Every Gemma 4 size has an **official assistant (MTP drafter) model**, Apache-2.0
(HF API listing, `author=google&search=assistant`, read 2026-09-28):
`google/gemma-4-E2B-it-assistant`, `…E4B-it-assistant`, `…12B-it-assistant`,
`…26B-A4B-it-assistant`, `…31B-it-assistant`, each with a
`…-qat-q4_0-unquantized-assistant` companion for the QAT checkpoints.

Card wording (google/gemma-4-12B-it-assistant, read live): the drafter is
"implemented by extending the base model with a smaller, faster draft model",
used so that "the draft model predicts several tokens ahead, which the target
model then verifies in parallel", and "results in significant decoding speedups
(up to 3x) while guaranteeing the exact same quality as standard generation".
The "up to 3x" is **CLAIMED**; the losslessness is exact by construction.
Sizes (HF tree API): 12B assistant = 422,856,964 params, model.safetensors
845,719,296 B; E4B assistant = 159,138,208 B; 31B assistant = 939,042,560 B.
The drafter is small relative to every target it serves (12B: 0.42/12 B ≈ 3.5%).

**GGUF sidecars already exist next to the official targets** (ggml-org repos,
tree API): `ggml-org/gemma-4-12B-it-GGUF` carries `mtp-gemma-4-12B-it-Q4_0.gguf`
(253,708,960 B), `-Q8_0` (465,109,152 B), `-BF16` (861,520,032 B);
`ggml-org/gemma-4-26B-A4B-it-GGUF` carries the same three plus
`dflash-gemma-4-26B-A4B-it-Q8_0.gguf` (472,433,824 B). Our catalog's pinned
26B-A4B repo `google/gemma-4-26B-A4B-it-qat-q4_0-gguf` carries **no** mtp
sibling (tree API: only target + mmproj) — MEASURED-BY-SOURCE (API), so for the
QAT row the drafter must be pulled from ggml-org or a third-party conversion
(e.g. `RachidAR/gemma-4-26B-A4B-it-qat-assistant-q4_0-gguf`,
`gemma-4-26b-A4B-it-assistant-Q4_0-q4emb.gguf` = 251,938,176 B).

### 1.2 llama.cpp support — merged, and in which build

- **Gemma 4 MTP: PR #23398 "llama : add Gemma4 MTP", merged 2026-06-07**
  (GitHub API). An earlier attempt, PR #22738, "was closed without merging"
  (slb350.github.io, see 1.3). Mainline MTP generally: PR #22673 "llama + spec:
  MTP Support", merged 2026-05-16; slb350 dates it "build 9191".
- **A regression and its fix.** Issue #24795 (open, 2026-06-19): "Eval bug:
  gemma4-assistant MTP draft model fails to load — 'invalid vector subscript'
  (regression: works on b9553, broken on b9702/b9717)". Fixed by **PR #28183
  "model : fix gemma4-assistant", merged 2026-09-01** (upstream merge commit
  `73159c303`).
- **How it is driven** (slb350, quoting the page): "Gemma 4 uses a separate
  assistant drafter file of about 0.45 GiB that you load alongside the model
  with `--model-draft assistant.gguf --spec-type draft-mtp`", and "The drafter
  shares the main model's KV cache" — i.e. no second KV bill, unlike DSpark.
  The RTX 5060 recipe (llama.cpp discussion #25357) uses `-md mtp-gemma-4-12b-it-Q6_K.gguf
  --spec-type draft-mtp --spec-draft-n-max 2 --flash-attn on`.

### 1.3 Measured numbers

**(a) The "12B 13.7 → 33.5" figure — source and conditions.**
https://slb350.github.io/strix-benchmarks/ — AMD Strix Halo ("CPU AMD Ryzen AI
MAX+ 395 (16C/32T)", "GPU Radeon 8060S Graphics (RDNA 3.5, gfx1151)", "Memory
128GB unified (120GB soft VRAM cap)"), llama.cpp on the RADV (Mesa Vulkan)
backend; the Gemma MTP sweep "ran twice on the same build 9553" with the
separate-assistant loading of 1.2. Drafter-depth sweep rows, quoted:

- "Gemma-4-12B (dense) 13.74 33.49 2.44x 4"
- "Gemma-4-31B (dense) 10.35 24.50 2.37x 4"
- "Gemma-4-31B QAT (dense) 10.95 25.08 2.29x 4"
- "Gemma-4-26B-A4B (MoE) 42.33 59.36 1.40x 2"
- "Gemma-4-26B-A4B QAT (MoE) 61.22 83.18 1.36x 2"

Columns are baseline tok/s, best tok/s, speedup, best n. Conditions named on
the page: dense models "want a draft window of n=4", MoE models "peak at n=2,
declining with deeper drafts", and "QAT drafters accept a few points lower than
the others because they were trained against unquantized weights". All
**MEASURED-BY-SOURCE** (Strix Halo, Vulkan, Q8_0-class targets per the page's
model table). No E4B MTP row exists on that page.

**(b) Consumer-GPU class (8 GB).** llama.cpp discussion #25357 ("MTP on 8GB
GPUs with draft-head quantization"), Gemma 4 12B on an "RTX 5060 Laptop
(8GB)": baseline "no MTP, KV f16" → **27.4 tok/s**; best "MTP Q6_K head, KV q8
(for 16k ctx)" → **40.4 tok/s**; "fully lossless" variant 40.0; real chat
"42+ tok/s fresh context, 33-37 with 16k filled, acceptance 0.73-0.91". Two
transferable findings: acceptance "collapses with draft depth (0.80 → 0.54 →
0.43 at depth 1→2→3)" so n_max=2 beat 3 and 4 there, and the drafter's own
quant barely matters — "Q8→Q2 acceptance only drops 55%→49% (n_max=2)".
**MEASURED-BY-SOURCE**.

**(c) Apple Silicon.** No controlled Gemma-4-MTP measurement on any M-series
chip was found anywhere (searched; say **not found**). Snippet-level only: a
LinkedIn post claims Gemma 4 26B "97 → 138 tok/s (+42%)" on "a MacBook"
(unverifiable — not used). Our own baseline anchors: gemma-4-12B Q4 = 20.4
tok/s on the M1 Max (RESEARCH-MODELS Part 7, [owner], MEASURED-BY-US) — if the
Strix-class 1.5–2.4x transfers even partially, the 16 GB "Smarter" row lands
near 30–45 tok/s (**INFERRED**, the thing to measure).

### 1.4 Table — Gemma 4

| Row | Drafter exists | llama.cpp | Claimed gain | Measured | Fork has it? |
|---|---|---|---|---|---|
| E4B | `google/gemma-4-E4B-it-assistant` (159,138,208 B safetensors) + QAT variant; GGUF conversions exist (cascade-tech et al.) | draft-mtp via #23398 (merged 2026-06-07) | "up to 3x" (card, CLAIMED) | **none found anywhere** | arch yes (v1.1.2 pin + HEAD); fix #28183 HEAD only |
| 12B | official assistant (0.42B); ggml-org `mtp-gemma-4-12B-it-{Q4_0 0.24 GiB, Q8_0 0.43 GiB, BF16}` | same | same | Strix 13.74→33.49 (2.44x, n=4); RTX 5060 8GB 27.4→40.4 (n=2) — MEASURED-BY-SOURCE | yes (see §3) |
| 26B-A4B | official + ggml-org mtp-Q4_0/Q8_0/BF16 + dflash-Q8_0; catalog QAT pin repo has **no** mtp sibling | same | same | Strix 42.33→59.36 (1.40x, n=2); QAT pair 61.22→83.18 (1.36x) — MEASURED-BY-SOURCE | yes; but open Vulkan bug #29221 with -np 4 |
| 31B | official (939,042,560 B) + conversions | same | same | Strix 10.35→24.50 (2.37x, n=4); QAT 2.29x — MEASURED-BY-SOURCE | yes; CUDA-only crash report #24440 (open) with -sm tensor |

---

## 2. Qwen3.6-35B-A3B and Qwen3.8-27B

### 2.1 What exists to load

Two layouts, both official-ish:

- **MTP-bundled GGUFs (unsloth):** `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`
  (1,091,233 downloads), `unsloth/Qwen3.6-27B-MTP-GGUF` (969,220), plus
  Qwen3.5 sizes (HF API). The MTP layer rides inside the model file — slb350:
  "If memory is tight the regular Unsloth GGUF (without the extra 0.42B MTP
  layer) is the cleaner choice." Full file list includes our exact quant:
  `Qwen3.6-35B-A3B-UD-Q4_K_XL` is in that repo (tree API).
- **Sidecar drafters (ggml-org):** `ggml-org/Qwen3.8-27B-GGUF` ships
  `mtp-Qwen3.8-27B-Q4_0.gguf` (1,680,271,776 B), `mtp-…-Q8_0.gguf`
  (3,164,006,816 B = the "official 2.95 GiB Q8_0 MTP drafter" slb350 ran),
  `mtp-…-BF16.gguf`, and a parallel `dflash-*` family — so the fork's
  `mtp-`-sibling auto-resolution (§3) can fetch the drafter from the same repo
  as the target with no catalog change beyond the flag.

### 2.2 llama.cpp support — merged, flags, and one silent trap

- Core MTP: #22673 (merged 2026-05-16, "build 9191" per slb350). Qwen3.5-family
  specifics: #24025 "qwen35: use post-norm hidden state for MTP" (merged
  2026-06-03). Qwen3.8-27B uses the same `qwen35` arch family, and its
  official mtp sidecars work on mainline today (slb350 ran them). The
  still-unmerged MTP PR slb350 mentions concerns **Qwen3.8-Flash-Next**
  (qwen4exp, PR #27842 open) — not our 27B row.
- Flags (slb350): "--spec-type draft-mtp --spec-draft-n-max N" with a launch
  line using "-ngl 999 -b 2048 -t 32 -fa 1 -c 8192"; the DGX Spark thread adds
  "--spec-draft-p-min 0.75" ("the key is the new ability to specify min-p for
  the draft").
- **The trap:** the MTP flag on a non-MTP GGUF "silently does nothing" (slb350,
  exact sentence on the page). Our catalog pins plain GGUFs (e.g.
  `unsloth/Qwen3.6-35B-A3B-GGUF`), so for the bundled layout we would have to
  switch the pin to the `-MTP-GGUF` repo, or use the ggml-org sidecar layout
  with `-md`/auto-resolution.

### 2.3 Measured numbers

**(a) Strix Halo (Vulkan), slb350 — MEASURED-BY-SOURCE:**
- "Qwen3.6-27B (dense) baseline 11.58" → "MTP n=3 21.32 1.84x 72.3%"
  (n=2: 20.37, 1.76x, 79.7% acceptance).
- "Qwen3.6-35B-A3B (MoE) baseline 54.85" → "MTP n=3 66.95 1.22x 71.4%"
  (n=2: 1.20x, 77.7%).
- Qwen3.8-27B with "the official 2.95 GiB Q8_0 MTP drafter at 64K context":
  "Generation rises from 5.10 to 11.87 tokens per second while wall time falls
  from 301 to 129 seconds" — "a 2.33x gain at 60.84 percent draft acceptance";
  and on the same nine prompts Q4 with MTP n=3 "generates 15.35 tokens per
  second against 11.87 for Q8". (The page's short-context plain llama-bench for
  the same model is 7.53 tg — the 5.10 baseline is the 64K-context condition;
  contexts differ, both quoted.)

**(b) DGX Spark (GB10) forum thread, May 2026 — MEASURED-BY-SOURCE**
(https://forums.developer.nvidia.com/t/mtp-llama-cpp-a-look-at-qwen3-6-27b/370298):
Qwen3.6-27B Q4_K_M (unsloth MTP GGUF), `--spec-draft-n-max 5
--spec-draft-p-min 0.75`: single client 13.1 → **28.3** tok/s (~2.2x); four
concurrent clients 41.5 (baseline) → **29.9** — a regression under load:
"The addition of MTP really helps the lack of concurrency at the expense of
slowing down concurrent requests." Acceptance "is sometimes very low, and never
above 70% that I've seen."
The same thread's MoE experience: Qwen3.6-35B-A3B with MTP ran ~64–72 tok/s
(c1–c4) while a no-MTP AutoRound build did "pp2048 tg128 @ d0 │ c4 │ 2,324 │
127.0 …" — "without MTP, this one beats it easily, so it needs work".
**MoE verify cost is real**: the MoE gains measured anywhere are the smallest
of any family (1.20–1.40x on Strix; net-negative on Spark against a strong
baseline), and the n-optimum drops to 2. Mechanism, **INFERRED**: a wide
verify batch activates more experts per step, so the per-token saving shrinks
exactly where MoE decode was already cheap.

**(c) Apple Silicon / our class:** Willison (2026-08-16,
https://simonwillison.net/2026/Aug/16/qwen-38-27b/): "I've been getting around
15-30 tokens a second from LM Studio" (M5 Max MacBook / DGX Spark), and a
Spark benchmark where the draft-MTP llama-server build "outperformed the LM
Studio default GGUF by around 72%" — MEASURED-BY-SOURCE (his harness), on
Spark, not Mac. No direct M-series MTP measurement for any catalog model was
found (**not found**). Our own anchors (MEASURED-BY-US, via the catalog doc):
Qwen3.8-27B mtplx at 10–15 tok/s on the M1 Max — i.e. we may already be
running the MTP-bundled file there; a clean A/B is missing.

### 2.4 Table — Qwen

| Row | Drafter exists | llama.cpp | Claimed | Measured | Fork has it? |
|---|---|---|---|---|---|
| Qwen3.6-35B-A3B | bundled in `unsloth/…-MTP-GGUF` (UD-Q4_K_XL available) | draft-mtp, #22673+#24025, merged 2026-05/06 | none by Alibaba | Strix 54.85→66.95 (1.22x, n=3, 71.4% acc); Spark: loses to strong no-MTP baseline at c4 | yes — qwen35moe MTP mode |
| Qwen3.6-27B (reference) | bundled unsloth MTP GGUF | same | none | Strix 11.58→21.32 (1.84x, n=3); Spark 13.1→28.3 (~2.2x, n=5, p-min 0.75) | yes |
| Qwen3.8-27B | ggml-org sidecars `mtp-Q8_0/Q4_0` (3.16/1.68 GB) + dflash | same (qwen35 family) | none by Alibaba | Strix 64K ctx 5.10→11.87 (2.33x, 60.84% acc); Q4+MTP 15.35; Spark-class "+72%" (Willison) | yes |

---

## 3. Our fork — does it already carry this?

Fork identity (measured): local clone `~/Projects/kalsallama`, `main` =
`833cde99b` (`git describe` → `main-b11193-833cde9`; upstream base b11193,
published 2026-09-26). `/tmp/dspark/kalsallama` is a HEAD clone. The app's
v1.1.2 pin per `KALSA_FORK.md` is `origin/main` = `67c73d26c` (2026-09-07) —
note the remote's main has since moved past that.

| Capability | In v1.1.2 pin (67c73d26c) | In fork HEAD (833cde99b) | Evidence |
|---|---|---|---|
| Speculative types: none / draft-simple / draft-eagle3 / **draft-mtp** / draft-dflash / draft-dspark / ngram-* | yes (DSpark measured working) | yes | `common/speculative.cpp:36-47` |
| MTP core (#22673), Gemma4 MTP (#23398), qwen35 post-norm MTP (#24025) | **yes — verified ancestors of 67c73d26c** | yes | `git merge-base --is-ancestor` of each upstream merge SHA |
| gemma4-assistant arch + converter | yes (`src/models/gemma4-assistant.cpp`, `conversion/gemma.py:833-836` registers `Gemma4AssistantForCausalLM`) | yes | grep |
| gemma4-assistant **fix #28183** (the #24795 "invalid vector subscript" regression) | **NO** — not an ancestor of 67c73d26c | **yes** | `git merge-base --is-ancestor 73159c303` |
| Qwen3.5-family MTP, shared-memory draft (single head; Step3.5 chain-heads mode) | yes | yes | `common/speculative.cpp:1330-1745` ("neither (qwen35 / qwen35moe): a single trained MTP head"; `is_mem_shared` path cites the transformers gemma4_assistant doc) |
| `mtp-` sidecar auto-download next to the target repo | yes | yes | `common/download.cpp:640` `find_best_sibling(files, model, "mtp-", tag)`; `common/preset.cpp:372` `draft_prefixes[] = { "mtp-", "dspark-", "dflash-" }` |
| Full draft flag family: `--spec-draft-hf`, `-md`, n-max/n-min, p-min, threads, draft KV types (`--spec-draft-type-k/v`), draft CPU masks | yes | yes | `common/arg.cpp:3970-4124` |

Practical read: **everything needed to test Gemma/Qwen MTP is already in the
shipped v1.1.2 binary except the gemma4-assistant loading fix (#28183)** — for
Gemma drafter tests use the fork-HEAD Metal build that already exists at
`/tmp/dspark/build` (built and validated in the DSpark correctness check).
Qwen sidecar tests (mtp-Qwen3.8-27B-*) can run on v1.1.2 today.

---

## 4. Known pitfalls (each with its source)

1. **Quantized targets.** Open upstream bug #25618: "Eval bug: Speculative
   decoding (draft-mtp / draft-dspark): greedy output diverges from vanilla on
   quantized targets" (open since 2026-07-13). It did **not** reproduce in our
   DSpark pair (Q8_0 target, byte-identical greedy, F16-target control
   identical — MEASURED-BY-US), but it is unresolved upstream and our Q4/Q8
   catalog rows are exactly the risk class. Mitigants: QAT drafters "accept a
   few points lower" (slb350); drafter quantization itself is benign
   (Q8→Q2 acceptance 55%→49%, #25357).
2. **Context length.** The best long-context datapoint is favourable: Qwen3.8
   Q8 at 64K context still gained 2.33x on Strix; our DSpark held +15–17% at
   7.9k on the M1 Max. KV q8_0 to fit the window costs "~+1.3% PPL" (#25357).
   Open interaction with our own feature: PR #29509 "server: don't store the
   draft KV in context checkpoints" (open, 2026-09-27) — Kalsa launches with
   `--ctx-checkpoints` + `--slot-save-path`, and the draft-KV-in-checkpoint
   behaviour is unverified (**INFERRED risk; test before shipping**).
3. **Concurrency (`--parallel > 1`).** The app launches `--parallel 3`
   (`server.state`, DSPARK-M1MAX). Measured against speculation everywhere:
   DGX Spark c1 2.2x became a c4 regression ("at the expense of slowing down
   concurrent requests"); our DSpark ‖2 probe eroded +23%→+9% and +35%→+1%
   (MEASURED-BY-US). Fork-relevant open bug: #29221 "Gemma 4 (26B-A4B MoE)
   crashes the server on the 2nd request with -np 4 on Vulkan … -np 3 is fine,
   CPU backend is fine" (open, 2026-09-21) — exactly our Lenovo config class.
4. **Italian / multilingual acceptance.** No public acceptance number exists
   for any MTP head on Italian (**not found**). The only Italian acceptance
   data we have is DSpark's: per-position 0.34–0.76 with the it_long regression
   at 0.17–0.34 (MEASURED-BY-US). Vendor-trained MTP heads drafter from the
   target's own distribution, so they should transfer better than a generic
   drafter — **INFERRED, must be measured on our Italian prompts before any
   default flips.**
5. **Loading traps.** draft-mtp on a non-MTP GGUF "silently does nothing"
   (slb350) — the catalog's plain pins need a sidecar or a repo switch. Open
   PR #28442 "speculative: fix draft model loading target path instead of
   draft path" (2026-09-05). v1.1.2 lacks #28183 (§3). CUDA-only: #24440
   "server crashes (fattn.cu:579) … Gemma 4 31B with MTP and -sm tensor"
   (open) — irrelevant to Metal/Vulkan but blocks future CUDA experiments.

---

## 5. What to measure first (ranked)

Rules: fork-HEAD Metal build on the M1 Max (`/tmp/dspark/build` already
validated); the five-prompt Italian/English harness from `/tmp/dspark/bench.py`
reused verbatim (same prompts, same greedy+catalog sampling, 3 reps,
acceptance counters from the server metrics); n_max swept {2,3,4} because the
DSpark lesson was that the documented default is wrong per-machine. On the
Lenovo (RTX 4050, Vulkan): VRAM is the constraint (6 GB-class, est. — verify),
so Q4_0 drafters and KV q8_0 only.

1. **Gemma-4-12B Q4 + `mtp-gemma-4-12B-it-Q8_0.gguf` (0.43 GiB), M1 Max.**
   Biggest expected win on a row we actually ship at two tiers (16 GB Smarter,
   32 GB Faster): dense targets measure 1.5–2.4x everywhere (Strix 2.44x,
   RTX 5060 1.47x); our 20.4 tok/s baseline would land ~30–45 (INFERRED).
   Watch the M1 Max verify-width lesson from DSpark: the optimum n may be 2–3,
   not 4.
2. **Qwen3.8-27B + `mtp-Qwen3.8-27B-Q4_0.gguf` sidecar (1.68 GB), M1 Max.**
   We already run this model at 10–15 tok/s (mtplx); dense-27B gains measured
   1.8–2.3x on Vulkan class and +72% on Spark class. Turns the owner's
   "unusable dense" verdict into a maybe. v1.1.2 is sufficient (no gemma fix
   needed).
3. **Gemma-4-26B-A4B QAT (catalog pin) + `mtp-gemma-4-26B-A4B-it-Q4_0.gguf`
   (0.23 GiB), M1 Max then Lenovo.** Strix: 1.36–1.40x at n=2 — modest but
   this is our 32 GB "Faster" default. On the Lenovo, first confirm -np 3
   stability (#29221 crashed only at -np 4) and VRAM fit.
4. **Italian acceptance gate (runs inside 1–3, called out separately).**
   Acceptance per position on it_short/it_long for each drafter before any
   default flips; a repeat of DSpark's it_long regression kills the row's
   default, per the owner's decision pattern.
5. **Qwen3.6-35B-A3B MTP-bundled UD-Q4_K_XL (pin switch to
   `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`), M1 Max.** Measured MoE gains are the
   smallest (1.20–1.22x Strix; negative vs a strong baseline on Spark) and the
   pin change costs a re-verified asset — do it last, keep expectations at
   ~1.1–1.2x (INFERRED from the MoE verify cost).
6. **E4B + assistant** — only if 1–3 leave time: no external measurement
   exists at all; small absolute gain on an already-fast row.

**Watch list:** PR #29509 (draft KV vs ctx-checkpoints — our feature);
#29221 (Vulkan -np 4 crash); #25618 (quantized-target divergence); the next
engine release folding #28183 in; `dflash-*` sidecars for Qwen3.8-27B and
26B-A4B as the alternative drafter family (DFlash2 merged #27342, 2026-08-27)
— a DFlash-vs-MTP head-to-head on the 26B would be one extra sweep on an
already-loaded server.

---

## Source index (read 2026-09-28)

- https://slb350.github.io/strix-benchmarks/ — Strix Halo drafter sweeps (Gemma
  MTP conditions, Qwen MTP rows, "silently does nothing", n-optima)
- https://github.com/ggml-org/llama.cpp/discussions/25357 — Gemma 4 12B MTP on
  RTX 5060 8GB, drafter-quant robustness, depth-collapse, recipe
- https://forums.developer.nvidia.com/t/mtp-llama-cpp-a-look-at-qwen3-6-27b/370298 —
  Qwen3.6-27B/35B-A3B MTP on DGX Spark, concurrency regression
- https://simonwillison.net/2026/Aug/16/qwen-38-27b/ — Qwen3.8-27B daily-driver
  speeds, Spark draft-MTP "+72%"
- https://huggingface.co/google/gemma-4-12B-it-assistant (+ HF API lists/trees
  for the other sizes, ggml-org/unsloth/RachidAR repos) — drafter existence,
  sizes, Apache-2.0, "up to 3x" claim
- GitHub API (ggml-org/llama.cpp): PRs #22673, #23398, #24025, #24340, #28183
  (+ merge SHAs), open issues #24795, #24440, #25618, #29221, #29509, #28442
- Local, read-only: `~/Projects/kalsallama` (common/speculative.cpp,
  common/arg.cpp, common/download.cpp, common/preset.cpp,
  src/models/gemma4-assistant.cpp, src/llama-arch.cpp, conversion/gemma.py,
  conversion/qwen.py, KALSA_FORK.md; `git merge-base --is-ancestor` checks),
  kalsa-brain docs (DSPARK-M1MAX, DSPARK-SURFACE, RESEARCH-MODELS Part 7,
  NIGHT-RUN-2026-09-25) and `crates/kalsa-catalog/src/manifest.rs`
