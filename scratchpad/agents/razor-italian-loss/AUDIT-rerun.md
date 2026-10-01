# AUDIT — rerun review of `razor-italian-loss` routing probe

Auditor: hostile re-review. Read-only. Nothing outside `/tmp/audit-razor/` was written except this file.
Scripts: `/tmp/audit-razor/{recheck.py,nullmodel.py,stats3.py}` → `recheck.log`, `nullmodel.log`, `stats3.log`.
All commands executed as `cmd > log 2>&1; echo $?` with the **real** exit code (see each block).

---

## Overall verdict

**USABLE WITH CAVEATS — but the headline is wrong, and one headline number is inflated by ~10 pp.**

* The measurement machinery (tensor read, stride handling, top-k↔weights pairing, layer/ubatch
  bookkeeping, coverage accounting) is **correct**. I tried to break it and could not. Every published
  number in the report reproduces bit-for-bit from the committed CSVs.
* The **scientific conclusion does not survive**. The report's central claim — that IT/ES/FR "route
  disproportionately" to removed experts — fails a proper null model for two of the three languages
  named in the first sentence, and the design cannot separate *language* from *document*.
* The "balanced top-128 retains ~95%" row is **in-sample** (IT is in both the ranking and the score);
  leave-one-out gives 86.11%, i.e. the honest gap over RAZOR is **37.8 pp, not 47.3 pp**.
* `REPORT.md:3` "**Verdict: CONFIRMED**" is not supported by the report's own tables and should be
  downgraded to "consistent with, on a single document per language".

---

## 0. Things I attacked and could NOT break (recorded so the negative results are on file)

These are **REFUTED** as concerns. I checked them properly.

**0.1 The strided `ffn_moe_topk` read is correct.** `ggml_argsort_top_k` returns
`ggml_view_4d(ctx, argsort, k, ne1, ne2, ne3, argsort->nb[1], argsort->nb[2], argsort->nb[3], 0)`
(`ggml/src/ggml.c:5450-5463`) ⇒ `ne[0]=8`, `nb[0]=4`, `nb[1]=n_expert*4=1024`, `view_offs=0`. The
callback reads at `tok * t->nb[1]` (`examples/eval-callback/eval-callback.cpp:86`). Correct.

**0.2 `view_offs` double-count question — no.** `ggml_new_tensor_impl` sets
`data = (char *) data + view_offs` (`ggml/src/ggml.c:1801`), and the CPU backend's getter is a bare
`memcpy(data, (const char *)tensor->data + offset, size)` (`ggml/src/ggml-backend.cpp:2404`) with **no**
`view_offs` adjustment. So the caller's `offset` is already relative to the view start. The report's
description at `REPORT.md:11` is accurate.

**0.3 `ggml_nbytes` bounds asserts are exactly satisfied, not exceeded.** For the top-k view
`nbytes = 4 + 7*4 + (ntok-1)*1024 = 32 + (ntok-1)*1024`; the last read is
`(ntok-1)*1024 + 32`. Equal, so `GGML_ASSERT(offset + size <= ggml_nbytes(tensor))` holds. Brittle but
correct. *(Brittle note: any change to `k` or `n_expert` trips an abort here rather than silently
mis-reading.)*

**0.4 top-k ↔ weights pairing by (token, rank) is right.** `ggml_get_rows(probs[1,n_expert,ntok],
selected_experts[k,ntok])` indexes `probs` along `ne[1]` by `b[i]` at batch `ne[2]`
(`ggml/src/ggml.c`, `ggml_get_rows`), and `cb(selected_experts,"ffn_moe_topk")` names the *same*
tensor instance later handed to `get_rows` (`src/llama-graph.cpp:2126`, `2138`). So
`weights[0,r,tok] == probs[0, topk[r,tok], tok]`. No transpose.

**0.5 Same layer, same ubatch, no double-visit.** Per-layer pending buffer +
`topk_calls == weights_calls == 4` and `tokens_seen == 1024` for all 40 layers, all 5 languages
(`raw/{lang}_agg.log`). Exactly one top-k and one weights per microbatch per layer. No fused or
renamed variant (`strncmp` prefix + `strchr(name,' ')==nullptr` guard on the weights name).

**0.6 No MTP leakage — but the margin is structural, not designed.** `main_0..main_39 + mtp_0` are all
in the manifest and `razor_config.json` prunes layer `1000` (the MTP), but `llama-eval-callback` builds
only the main graph; there is no draft/speculative path in the example. Had the MTP MoE run it would
have used `il=0` (`src/models/qwen35moe.cpp:679`) and collided with decoder layer 0 — and
`topk_calls == 4` would have caught it. So the sanity gate is adequate.

**0.7 No off-by-one / mapping error in the RAZOR keep-sets.** I downloaded
`kept_expert_indices.json` at the pinned revision `d897617a` and hashed it:

```
$ shasum -a 256 hf_kept.json
a692647ffa92c3944a60f332ccebfeb6a74403fd5e74727f8dfbe5911f37e306  hf_kept.json
```
identical to `raw/kept_expert_indices.json`. 41 keys, every `main_l` exactly 128 ids, all in `[0,255]`,
no duplicates. `REPORT.md:15`'s "**Mapping confidence: very high**" is justified. Verdict: **REFUTED**
as a concern.

**0.8 Gating really is softmax and the callback really is pre-renormalization.**
`src/models/qwen35moe.cpp:508` passes `LLAMA_EXPERT_GATING_FUNC_TYPE_SOFTMAX` with `norm_w=true`;
`src/llama-graph.cpp:2138` emits `cb(weights,"ffn_moe_weights",il)` *before* the `norm_w` division at
`2148-2159`. So `REPORT.md:11` / `REPORT.md:48` ("raw softmax probabilities (pre-renormalization)") are
correct — and the bound argument at `REPORT.md:48` is not vacuous, because the gating is softmax rather
than sigmoid. (It would be vacuous for a sigmoid arch; here it happens to hold.)

**0.9 All published numbers reproduce.** `recheck.py` recomputed every headline from
`raw/*_router_agg.csv`: removed-mass shares 45.903 / 51.353 / 56.330 / 66.936 / 52.601 %, selection
shares 48.401 / 52.672 / 56.955 / 66.425 / 53.878 %, per-token-layer 0.08346 / 0.09435 / 0.10357 /
0.12471 / 0.09606, IT-retained 48.35 / 77.33 / 76.31 / 95.41 / 95.63 %, overlap 92.4 / 93.4,
per-layer range 16.61–85.81 %, wsum means 0.1818–0.1863. Every figure matches `raw/analysis.log`.
`analyze_router.py` is arithmetically clean (stdlib `csv` only; no pandas/numpy errors; denominators
correct — `mass` is the sum over selected experts only, so `rmass/mass` is genuinely the top-k mass
share).

**0.10 No secrets, no credentials.** Full regex sweep of `raw/` for HF tokens, `sk-`, `ghp_`, AKIA,
`api_key`, `bearer`, cookies → zero hits (only the English words "secret"/"secretary" inside
`en.txt`'s Wikipedia text). No emails, no IPs, no hostnames.

**0.11 External references are real.** `arXiv:2609.30465` = "RAZOR: Pruning Replaceable Experts in
LLMs", Song & Zheng, v4 30 Sep 2026. The HF repo `Nickyang/Qwen3.6-35B-A3B-RAZOR-19B-A3B-E128of256`
and revision `d897617a` both resolve. No fabricated citations.

**0.12 Tie-breaking at the rank-128 cut is NOT a problem** (I expected it to be). The score gap at
ranks 127/128 is only **0.03–0.04×** the typical adjacent gap — the cut sits in a flat region — yet
re-drawing the boundary set inside a ±0.5/±1/±2-selection band moves the reported retained mass by only
0.10–0.28 pp sd (`stats3.log` §G). The percentages are robust to the tie-break rule. Hypothesis
withdrawn.

---

## Findings, most severe first

### F1 — CONFIRMED. The 50% null is never tested, and under a proper null **Italian is indistinguishable from a random half-split.**

`REPORT.md:29`: *"English sits below the 50% a language-blind half-of-experts split would give, while
every other tested language sits above it."*

That sentence is the load-bearing claim of the whole report, and the null it invokes is never
computed. I computed it (`nullmodel.log`, 4,000 draws of a random 128-of-256 keep set, per language):

| lang | observed removed mass | random-half null | sd | two-sided p vs 50% |
|---|---:|---:|---:|---:|
| EN | 45.90% | 50.01% | 1.50 | **0.006** (below chance) |
| IT | 51.35% | 49.99% | 1.66 | **0.427** |
| ES | 56.33% | 49.98% | 1.59 | <0.001 |
| FR | 66.94% | 49.99% | 1.48 | <0.001 |
| ZH | 52.60% | 49.95% | 1.67 | **0.123** |

Italian — the language the whole experiment is named after, and the first language in
`REPORT.md:3` — sits **0.8 sd** from a random half-split. ZH sits 1.5 sd. The "every other tested
language sits above [50%]" divide holds for ES and FR only. Layers above 50%: EN 14/40, IT 21/40,
ES 30/40, FR 39/40, ZH 25/40 — i.e. Italian is above chance in barely half its layers.

Equivalently, IT routing mass retained by RAZOR's published keep-set is 48.35%, against
**49.99% ± 1.69 [47.22, 52.78]** for a random 128-subset (20,000 draws), `p(random ≥ RAZOR) = 0.165`.
The honest statement is: *RAZOR's survivor set is not measurably better or worse than a random half of
the experts, with respect to Italian routing mass.* The report does not say this anywhere.

Verdict: **CONFIRMED** (missing control + an unsupported claim in the report's own words).

### F2 — CONFIRMED. The "balanced ~95%" row is in-sample; the honest number is 86.1%.

`REPORT.md:43`: *"The balanced ranking retains **~47 percentage points** more of IT's routing mass than
the published RAZOR set on this sample."*

`analyze_router.py:70-71` ranks the balanced set on `col(['en','it','es','fr'], …)` and
`per_layer_it_keep_comparison.csv` scores it on **IT's own tokens**. Leave-one-out (rank on
EN+ES+FR, score on IT — `stats3.log` §H):

* in-sample 95.63%, LOO **86.11%**, optimism **+9.53 pp**, in-sample higher in **40/40 layers**.
* Honest gap over RAZOR: **+37.76 pp**, not +47.28 pp.

`REPORT.md:33` says the balanced sum uses "the same 1,024-token sample", and `REPORT.md:43` does append
"on this sample" — but the table at `REPORT.md:37-41` lists 95.41% / 95.63% as rows comparable to the
48.35% RAZOR row with **no in-sample marker**, and the ~47 pp figure is the one promoted to prose and to
the bolded headline. Verdict: **CONFIRMED**.

The EN-only rows (77.33% / 76.31%) are genuinely out-of-sample for IT and are fine.

### F3 — CONFIRMED. `n = 5` single documents, five unrelated Wikipedia articles. Language is not identifiable.

`REPORT.md:9`: *"the sorted per-document corpus file was tokenized … and the first **1,024 tokens**
evaluated"*. `REPORT.md:55`: *"the sample is a 1,024-token prefix per language, not the full corpus"*.

Each `raw/{lang}.txt` is a **concatenation of many articles**, and only article #1 reaches the model:

```
en  (290,918 chars, ≥48 articles)  article 1 = JNN/ANN Osaka television affiliation dispute  (Japanese media history)
it  (334,979 chars, ≥48 articles)  article 1 = St. Ambroeus FC, amateur club for refugees in Milan (Italian football/immigration)
es  (316,628 chars, ≥45 articles)  article 1 = Ateneo de la Sociedad Rural Argentina            (Argentine agriculture, youth org)
fr  (311,222 chars, ≥17 articles)  article 1 = « intégrité électorale »                        (abstract public-law / political-science concept)
zh  (273,535 chars)                article 1 = HMS Jervis, J-class destroyer                 (Royal Navy WWII service history)
```

Five different domains, five different registers, one document each. The effective sample size for
"does language X route more to removed experts" is **5 unreplicated documents**, not 5,120 tokens and
not 40 layers. The +21.0 pp FR−EN gap is measured between a Japanese-media-industry narrative article
and an abstract legal-concept article. No amount of within-article token count fixes that.

The per-layer data the report throws away makes the register hypothesis visible: correlation of
per-layer removed-mass share across languages is **IT–ES r = 0.812** (both are community-organisation
descriptions) but **EN–FR r = 0.429** (narrative vs abstract). The two languages whose articles share a
register have the most similar layer profiles; the pair with the most divergent register has the least.
`REPORT.md:29` reduces `per_layer_removed.csv` to a min–max range instead of looking at it.

Also note the ordering is a deterministic function of an undocumented sort key. No sort key, dump
identifier, query, or date is recorded anywhere in `raw/`, and `source_hashes.txt` does not hash the
`.txt` files. Verdict: **CONFIRMED** — the design cannot attribute the effect to language.

### F4 — CONFIRMED. The Italian and French windows have materially different text composition; the FR window ends inside a bibliography.

The 1,024-token window is ≈3,700–4,300 chars for the Latin-script files. Structural markers:

```
fr: "== Références ==" @char 3829, "== Bibliographie ==" @char 3848, "== Annexes ==" @char 4753
en: "== Overview ==" @522, "== References ==" @5234
```

So **the FR window runs into, and most likely through, the first article's reference list**, which
contains three English-titled academic citations with ISSNs, DOIs, page ranges and ISBNs:

```
fr char ~3850-4100: "== Bibliographie ==\n[Norris 2013a] (en) Pippa Norris, « The New Research Agenda
Studying Electoral Integrity » …, Electoral Studies, vol. 32, no 4,‎ décembre 2013, p. 563-575
(ISSN 0261-…)"
```

Roughly 0–7% of FR's window (upper bound 271 chars ≈ 66 tokens; the exact fraction needs the GGUF
tokenizer, which is not available without the engine) is citation boilerplate and is cut mid-ISSN.
Meanwhile EN, IT, ES and ZH all terminate **mid-sentence in prose** (checked at char 4100 / 1500). The
FR sample is also the only one whose window blends in a second, unrelated article (a Japanese-manga
character, in French) before the cut. This asymmetry lands entirely on the language carrying the
"+21.0 points" headline. Verdict: **CONFIRMED** (asymmetry real; magnitude bounded, not fully
resolvable without the tokenizer).

### F5 — CONFIRMED. "Verdict: CONFIRMED for the proposed routing-frequency mechanism" is not what the data support.

`REPORT.md:3`: *"**Verdict: CONFIRMED for the proposed routing-frequency mechanism.**"*

Three problems.

1. **The report's own bpb ranking does not match.** Spearman between bpb delta (from
   `results/gate_probe_a40_2026-10-01/REPORT.md:14,18`) and removed mass share is **ρ = +0.400, n = 5,
   t = 0.76, df = 3 → not significant.** The rank orders disagree at both ends:

```
ranks by bpb delta:  EN 1, ZH 2, ES 3, FR 4, IT 5
ranks by removed mass: EN 1, IT 2, ZH 3, ES 4, FR 5
```

   IT has the largest bpb delta (0.882) but only the second-smallest removed share; ZH has a delta of
   0.249 with a *larger* removed share than IT; FR routes 11 pp more than ES while losing less bpb
   than either. `REPORT.md:53` admits *"The magnitude ordering is not exact"* and then keeps the
   CONFIRMED verdict. With n = 5 the honest word is "consistent with".

2. **The cited method's own paper says the opposite.** arXiv:2609.30465 abstract: *"Routing frequency
   and output magnitude do not fully describe deletion damage, which also depends on how the surviving
   and replacement experts compensate for the removed output."* `REPORT.md:15` cites that paper; it
   does not note that the probe's headline metric is the one the paper argues is insufficient.

3. **The mechanism is not "routes to removed experts".** Per the pinned card, RAZOR **refills** the
   deleted slot: *"Deleting a selected expert i makes the router promote its highest-ranked unselected
   expert r"*. The pruned model routes the same token to *some* expert. The card also states
   **"Shared experts | 1 | 1 (unchanged)"** and `razor_config.json` gives
   `shared_expert_intermediate_size: 512` — a full dense expert of the same width as one routed expert
   (`moe_intermediate_size: 512`) survives in every layer. Neither shared experts nor router refill is
   mentioned anywhere in `REPORT.md`. Verdict: **CONFIRMED** overclaim.

### F6 — CONFIRMED. "Routes more to removed experts" is *consistent with* the bpb loss, not explanatory, and the report's own diffuse-router data bounds how much any routing metric can say.

`REPORT.md:48` calls the router "genuinely diffuse". Taken seriously, that undercuts the rest of the
report. Mean top-8 mass is only 0.18, so **80% of the router probability sits outside the top-8**; and
the BOTTOM 128 experts by EN usage still carry **22.35%** of IT's routing mass (`stats3.log` §F):

```
EN-count top-128 → 77.33% of IT mass ;  EN-count bottom-128 → 22.35%
EN-mass  top-128 → 76.31% of IT mass ;  EN-mass  bottom-128 → 23.69%
```

So a usage-optimal 128-split is bounded at ≈77% and a worst-case split still retains ≈22%. RAZOR's
48.35% is *between* them and statistically indistinguishable from a random half (F1). The removed mass
is also expressed as a share of the **top-8** mass only, i.e. of ~18% of total router mass — so FR's
"66.94%" is roughly 12% of total router probability, and the FR−EN difference is ~4 points of total
router mass. That is not a currency in which output damage can be read off. Verdict: **CONFIRMED**.

### F7 — CONFIRMED. No per-token data was kept, so no error bar, CI, bootstrap, split-half or significance test is possible from the committed artifacts.

Every CSV is aggregated to `(lang, layer, expert) → selections, mass_sum`
(`raw/analyze_router_agg.csv` header: `lang,layer,expert,selections,mass_sum`). Nothing finer exists.
The brief's "split each language's per-token data" is impossible here. `REPORT.md` presents **no**
uncertainty anywhere. The only dispersion that can be extracted is across layers, and layers are not
independent (one model, one sample) — for reference, the paired per-layer differences are:

```
FR-EN  +21.00 pp  sd 10.63  sign-consistent 38/40
ES-EN  +10.54 pp  sd 10.33  sign-consistent 32/40
ZH-EN   +7.01 pp  sd 12.11  sign-consistent 30/40
IT-EN   +5.35 pp  sd 14.21  sign-consistent 25/40      <- Italian: sign-consistent in 25 of 40 layers
ES-IT   +5.18 pp  sd  9.39  sign-consistent 28/40
```

Verdict: **CONFIRMED** — the design cannot produce the inference the report makes, and n_eff = 5
documents.

### F8 — CONFIRMED. `echo EXIT=0` is literal, and `REPORT.md` presents it as a recorded result.

`raw/run_commands.txt:2`: *"All five router runs; each command was executed with the redirection shown
and returned EXIT=0."* `raw/run_commands.txt:3-7` and `:10` each end in the **typed** string
`; echo EXIT=0`, not `; echo EXIT=$?`. Same idiom in the report's own reproduction block at
`REPORT.md:62`, `REPORT.md:68`, `REPORT.md:69`. `REPORT.md:59`: *"The exact five model commands and
their `EXIT=0` results are in raw/run_commands.txt."* No exit code was ever captured. This is a
fabricated provenance record, not a transcription slip.

**Mitigation — the runs themselves *are* evidenced.** Each log ends with
`ROUTER_AGGREGATE_TOKENS=1024`, contains exactly 40 `ROUTER_SANITY` lines with
`topk_calls=4 weights_calls=4 tokens=1024`, and contains **zero** `ROUTER_SANITY_FAIL` and **zero**
`ROUTER_CALLBACK_ERROR` lines. Wall-clock in the log is 45.917 s → 46.276 s, consistent with a real
20 GB load plus a 1,024-token CPU pass. So: exit codes unrecorded (bad), runs completed (good).
Verdict: **CONFIRMED** for the `echo EXIT=0` fabrication; **REFUTED** for "the runs are unproven".

### F9 — PLAUSIBLE. `REPORT.md:59` claims "each full stdout/stderr log"; the archived logs are not full.

The logs retain `llama threadpool init` and `number of input tokens = 1024` (both `LOG_INF`), but
contain **none** of the model-load block that a stock build emits — `grep -c "llama_model_loader\|n_layer\|print_info" raw/en_agg.log` → **0**, against unconditional `LLAMA_LOG_INFO("%s: loading model tensors…")` at
`src/llama-model.cpp:1539` and `LLAMA_LOG_INFO("%s: arch = %s")` at `src/llama-model.cpp:2067`.
With INFO logging demonstrably on, the archived log was filtered or truncated. The consequence is
concrete: the logs contain **no** model identity, no `n_layer`, no `n_expert`, no `n_expert_used`, and
no tokenizer/BOS line. Every architectural claim in `REPORT.md:9` (*"The model has 40 decoder MoE
layers of 256 experts with top-8 routing"*) is therefore *inferred from the routing counters* (40
sanity lines; 256 range-checked expert ids; 8192 selections / 1024 tokens ⇒ k = 8) rather than read off
a log. The inference is sound; the provenance is not. A filter is the likeliest benign explanation, but
the report should not call these files "full".
Verdict: **PLAUSIBLE**.

### F10 — CONFIRMED. The archived validator asserted the bug as an invariant; run 2 ships no validator.

`raw/invalid-run-1/validate_router.py:12`:

```python
assert len({int(r['selections']) for r in x})==1,(lang,layer)
```

i.e. it **requires** all 256 experts to have identical selection counts and prints that as a pass:

```
raw/invalid-run-1/validation.log:1: "en: … each expert selected 32 times/layer"
raw/invalid-run-1/validation.log:6: "All validation checks passed"
```

The one check that would have caught the strided-read bug was written backwards, and the run that
"passed" validation is the invalid one. Run 2 has no validator file at all; the only guard is
`analyze_router.py:28`, `if len(set(c[l])) == 1: raise SystemExit(... 'uniform selection counts
(router-read bug)')`, which catches only the perfectly-uniform signature. Nothing in the pipeline would
catch a *partial* stride error (e.g. a wrong `nb[2]`) that happened to produce non-uniform counts.
Verdict: **CONFIRMED**.

### F11 — PLAUSIBLE. The central fix (honoring `nb[1]`) leaves no verifiable trace, and the wsum cross-check is calibrated to CSV rounding.

`REPORT.md:11` asserts the stride layout; the instrumentation asserts only `t->nb[0] != sizeof(int32_t)`
(`eval-callback.cpp:77`, `:99`) and **never records `ne` or `nb`**. Nothing in `raw/` records the
strides that run 1 got wrong. The corroborating evidence is only indirect (ids in range, 8192/layer,
plausible top-8 mass sums).

Separately, `analyze_router.py:51` cross-checks CSV mass against the log's `wsum_mean` with
`> 1e-6 * max(1.0, wmean)` = 1e-6 absolute. Measured worst-case disagreement across all 200
layer×language pairs is **5.6e-7** — the CSV is written at `std::ofstream` default precision (6
significant digits), so the check is calibrated to its own rounding error and passes with only 1.8×
margin. It validates the CSV round-trip and nothing about routing semantics; it cannot detect a
rank↔expert mispairing. Verdict: **PLAUSIBLE** (weak check presented as a sanity check).

### F12 — CONFIRMED. Provenance gaps: 3 hashes for ~30 artifacts; build logs not archived; corpus provenance unrecorded.

`REPORT.md:72`: *"The exact model file and artifact hashes are in raw/source_hashes.txt."*
`raw/source_hashes.txt` has **3 lines**: the GGUF, `kept_expert_indices.json`, `razor_config.json`. Not
hashed: the five corpora, the five `*_router_agg.csv`, the five `*_agg.log`, `analyze_router.py`,
`usage_rank_sets.csv`, and (critically) **`examples/eval-callback/eval-callback.cpp`** — the
instrumentation itself, whose hash appears nowhere. The two build logs the report references
(`/tmp/razor-italian-loss/cmake_cpu.log`, `build_v2.log`, `REPORT.md:68-69`) live in `/tmp` and are not
archived, so nothing ties these logs to binary `61c909481`. Corpus provenance (which Wikipedia dump,
which articles, what sort key) is recorded nowhere. Verdict: **CONFIRMED**.

### F13 — CONFIRMED. Minor factual and labelling defects.

* `REPORT.md:47` *"a few experts absorb most selections while many are never picked"*. Median
  never-picked experts per layer is 56–74 of 256, but the **minimum is 0** (EN, and ZH) and the maximum
  103–109. "Many are never picked" is true at the median layer and false at the best one. Also, 8192
  selections over 256 experts is only 32/expert on average; the distribution is diffuse, not
  "strongly concentrated". (`sanity_count_distribution.csv` already contains the
  `experts_selected` column that would have shown this; it is never used.)
* `analyze_router.py:131` writes the column header `removed_mass_per_token` for
  `rmass / (BUDGET * N_LAYER)`, which is **per token-layer**. `REPORT.md:19` describes it correctly;
  the CSV name is wrong and `analysis.log:2-6` prints it as "mass/token-layer". Mislabelled artifact.
* `analyze_router.py:7-8` hardcodes `N_LAYER=40, N_EXPERT=256, K=8, BUDGET=1024, UBATCH_CALLS=4` with no
  cross-check against `razor_config.json` (which does say 40 layers / 8 per token). `UBATCH_CALLS=4`
  encodes the `-ub 256` choice rather than verifying it.
* `analyze_router.py:53-58`: `sanity_from_log` stores lines in a dict keyed by layer, so a duplicate
  `ROUTER_SANITY` line for one layer would be silently swallowed and `len(out) != 40` would not fire.
  Not triggered here (40 lines, ids 0–39).
* `REPORT.md:15` — *"over 2,048 RazorCal calibration samples"*. The card says *"32,768-token rows from
  RazorCal, the 2,048-sample multi-domain corpus"*, i.e. ~67 M calibration tokens. The report's
  phrasing is defensible but understates the calibration scale by four orders of magnitude relative to
  the 5,120 tokens measured here.
* `REPORT.md:15` does not carry the card's disclaimer: *"Selection depends on the calibration draw, so
  an independent run reproduces the procedure rather than this exact expert set."*
* `eval-callback.cpp:247` `std::exit(0)` bypasses `llama_backend_free()`, and the diff deleted
  `llama_perf_context_print(ctx)` — so no timing or memory evidence survives in the logs.
* `eval-callback.cpp:174-175` opens `ROUTER_CSV` and writes the header *before* `common_params_parse`;
  an argument-parse failure leaves a header-only CSV behind.
* `REPORT.md:9` `raw/run_commands.txt:3-7` pass `-p x` together with `ROUTER_TEXT_FILE`; `-p x` is inert
  (the file wins). Harmless but confusing for anyone re-running.
* The gate-report bpb figures cited at `REPORT.md:53` **do** match
  `results/gate_probe_a40_2026-10-01/REPORT.md:14,18` exactly. But that report's own footnote
  (`:20-22`) leaves the unpruned bpb row's top-k ambiguous (*"the Qwen3.6 bpb row is Qwen3.6 at its
  default k (unpruned base), not k4"*), while `:25` asserts *"Same default k"*. Given
  `:28` (*"Top-k 4 costs RAZOR 26 GSM8K points"*) shows top-k width is a first-order lever in this
  model family, `REPORT.md:53` should not attribute the entire delta to pruning without resolving it.
  **PLAUSIBLE**, not a proven error.

### F14 — CONFIRMED. One username leak, in an untracked directory (so far harmless).

`raw/source_hashes.txt:1-3` embed absolute paths:

```
/Users/marco/kalsa-models/probe/qwen36-35b-a3b-q4/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/razor-italian-loss/raw/kept_expert_indices.json
/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/razor-italian-loss/raw/razor_config.json
```

`raw/run_commands.txt` correctly uses `$HOME`, and `REPORT.md` prose uses `~/`. Current state:
`git status --porcelain scratchpad/agents/razor-italian-loss/` → `?? scratchpad/agents/razor-italian-loss/`
— **entirely untracked, zero commits, nothing pushed**, so `REPORT.md:72`'s *"nothing was pushed"* is
accurate and no leak has occurred yet. On the first commit these three lines become a permanent
username in history. No credentials, tokens, emails, or private endpoints anywhere (0.10). Verdict:
**CONFIRMED** (latent, low severity).

---

## What would make the numbers usable

1. Re-run the null model (F1) and drop or restate the "above/below 50%" claim. Report per-language
   p-values against a random half-split.
2. Replace the balanced 95.63% row with leave-one-out 86.11% and restate the gap as ~38 pp (F2).
3. N documents per language, ≥10, drawn from the same topic pool or randomised, with topic as a
   crossed factor. Until then the language attribution is not identified (F3, F4, F7).
4. Keep per-token (or per-microbatch) routing so a bootstrap is possible (F7).
5. Downgrade `REPORT.md:3` from "CONFIRMED" to "consistent with"; report ρ = 0.40, n = 5 and disclose
   that ZH contradicts IT on both metrics (F5).
6. Discuss shared experts and router refill, or state explicitly that removed *mass share* is not the
   quantity that predicts damage (F5, F6).
7. Replace `echo EXIT=0` with `echo EXIT=$?` and re-record; hash the instrumentation, the CSVs and the
   corpora; archive the build logs (F8, F12).
8. Rewrite `invalid-run-1/validate_router.py:12` before anyone reuses it (F10).

## Commands run (real exit codes)

```
$ python3 /tmp/audit-razor/recheck.py    > recheck.log   2>&1; echo $?   → 0
$ python3 /tmp/audit-razor/nullmodel.py  > nullmodel.log 2>&1; echo $?   → 0
$ python3 /tmp/audit-razor/stats3.py     > stats3.log    2>&1; echo $?   → 0   (v1 of stats2.py exited 1: local name
                                                                             shadowed by loop var; fixed, rerun)
$ python3 - <<'PY' (null2, markup, boundaries, boundaries) ...; echo $?  → 0
$ shasum -a 256 hf_kept.json ...; echo $?                               → 0
$ git status --porcelain scratchpad/agents/razor-italian-loss/; echo $?  → 0
```

No model was run. No test suite was run. Nothing outside `/tmp/audit-razor/` and this file was
written.