# Hostile audit: phase 0a calibration

Scope: the phase-0a files in `c9311d89`, provenance note `19767120`, the committed calibration scripts and patch, and the seven external JSONL files plus `counts.json`. The local data was read from `~/kalsa-models/reap-calib-v2/`. The coordinator's manifest-hash and seven-by-seven overlap runs were not repeated. I did rerun the committed synthetic smoke into `/tmp`.

Verdicts mean: **CONFIRMED** = the cited source or artifact establishes the issue; **PLAUSIBLE** = a material risk not proven to have caused a bad keep set; **REFUTED** = the specific concern does not hold as stated.

## Findings, ranked by severity

### P1 — The committed pruning command never consumes `norm_max`

**Evidence:** `PHASE0-CALIB.md:109-111` says “the SE guard reads `norm_max` from the same file in phase 1.” `pod/30_score.sh:26-28` runs `moep.cli score` with `--criterion reap`. The pinned scorer's `src/moep/scoring.py:21-34` returns only `freq`, `gate_mass`, `prob_mass`, `man`, `msan`, `reap`, and `reap_flow`; the patch does not modify it.

> `pod/30_score.sh:26-28`: `--criterion reap --keep-ratio "$keep"`

**Failure scenario:** pruning to 128 experts can discard an expert with a rare but extreme output because the selection criterion ranks only mean REAP. The statistic can be present in `profile.stats.pt` and still have no effect on selection. This contradicts `DESIGN.md:304` (“SE guard on all”). **CONFIRMED.**

### P1 — The data called `toolcall` mostly contains no tool calls

**Evidence:** `~/kalsa-models/reap-calib-v2/code.jsonl:286` is tagged `category: "toolcall"` while its system message says “You are a helpful assistant, with no access to external functions.” `calib/build_calib.py:183-191` adds Hermes/Glaive rows as toolcall examples without checking for a call. A scan of all 159 `toolcall` rows found no tool-call marker or tool-role message. The English set has one actual tool-trajectory row (`en.jsonl:308`), out of 118 Hermes multiturn rows.

**Failure scenario:** the code domain gives the pruner substantial ordinary code-help dialogue but almost no examples that exercise structured calls, tool results, or tool-call continuation. It does not support the implied coverage of a product requirement that tool use survive. **CONFIRMED** as a dataset-label/content mismatch; impact on the eventual keep set is **PLAUSIBLE**.

### P1 — `norm_max` is not the Super-Experts paper's statistic

**Evidence:** In the pinned `moep@fdc9a3fc` tree after applying the patch, `src/moep/profiler.py:100-105` computes `n = f.float().norm(dim=-1)` and takes `n.max()`: the maximum L2 norm of each down-projection output vector. The patch adds the max update at `patches/moep-domain-normmax.patch:180-184`. The cited paper defines its statistic as the maximum absolute output element, `max |h W_down_proj|` (Appendix algorithm, [Super-Experts](https://arxiv.org/html/2507.23279)). The hook does correctly inspect the unweighted `down_proj` output before multiplying by router weight; that part matches the intended output location.

**Failure scenario:** L2 norm and maximum coordinate can rank experts differently. Diffuse moderate coordinates can produce a larger L2 score than a sharper single-coordinate outlier; the implemented guard can therefore protect a different set of experts than the paper's guard. **CONFIRMED.**

### P1 — A stale `.ok` marker can certify old calibration and old scores

**Evidence:** `pod/20_observe.sh:22` exits successfully if `runs/20_observe.ok` exists, before checking calibration files, domains, or stats. `pod/30_score.sh:22-23` likewise exits if `30_score.ok` exists. `PHASE0-CALIB.md:107-110` explicitly says the stage and markers are unchanged.

> `pod/20_observe.sh:22`: `if [ -f "$OK" ]; then echo "20_observe: already verified OK"; exit 0; fi`

**Failure scenario:** reuse a run directory that completed v1 (or an earlier v2 attempt): `20_observe.sh` reports success without profiling v2, and `30_score.sh` may report success without scoring the new merged stats. The marker identifies the stage, not the calibration manifest or input hashes. **CONFIRMED.**

### P2 — The engine source is neither commit-pinned nor license-clean

**Evidence:** `calib-v2/SOURCES.md:15` claims the kalsallama source is at commit `63a51b6d…` and that “test/vendor dirs [are] skipped.” In `calib-v2/sources_v2.py:39-41`, `engine_commit()` merely reads the current checkout's `HEAD`; `:33-35` omits `build`, `vendor`, and `node_modules` from `SKIP_PARTS`; `:136-139` recursively scans the entire engine root for Python. `build_calib_v2.py:120-128` records that dynamic `HEAD` and assigns MIT to every non-CPython row.

> `sources_v2.py:39-41`: `return subprocess.run(["git", "-C", str(ENGINE_ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()`
>
> `sources_v2.py:33-35`: `SKIP_PARTS = {"test", "tests", "site-packages", "idlelib", "turtledemo", "__pycache__", "lib2to3", "test-data", ".git"}`

The external row `~/kalsa-models/reap-calib-v2/code.jsonl:2` is from `build/tools/ui/ui-src/node_modules/flatted/python/flatted.py`, tagged MIT and revision `63a51b6d…`. That file is in ignored build output, not the pinned commit. Its `package.json:47` says `"license": "ISC"`; its `flatted.py:1-7` requires the copyright and permission notice. The chunk begins at line 8, and `sources_v2.py:80-91` strips the leading license block.

**Failure scenario:** a rebuild from a different checkout or changed build directory can silently include different Python and third-party code while claiming the same engine commit and MIT license. This particular ISC chunk is already in the data without its required notice. **CONFIRMED.**

The CPython claim also is not a true pin: `sources_v2.py:23-24` reads the mutable Homebrew `Versions/3.14` path, while `build_calib_v2.py:124-125` labels every selected file “3.14.6” and PSF-2.0 without checking the interpreter or per-file license. Python's own [license page](https://docs.python.org/3/license.html) lists incorporated components with other licenses. No specific non-PSF CPython row was established in this audit, so that blanket-label concern is **PLAUSIBLE**, not confirmed.

The HF pins do exist in code: `sources_v2.py:26-28` pins FineWeb-2 `af9c13333eb981300149d5ca60a8e9d659b276b9`, FineWeb `9bb295ddab0e05d785b879661af7260fed5140fc`, and GSM8K `740312add88f781978c0658806c59bc2815b9866`; its `:58` and `:71` pass `revision=rev`. `evalsets.py:29-34` pins GSM8K `740312add88f781978c0658806c59bc2815b9866`, HumanEval `7dce6050a7d6d172f3cc5c32aa97f52fa1a2e544`, HumanEval+ `d32357cf319e50e9c8d8dab5ea876c72b0fd321b`, and MBPP `4bb6404fdc6cacfda99d4ac4205087b89d32030c`; `:114` passes these pins. The phase-0b Italian test file is pinned separately at `363d87617cd417b731dc860194a6935fd5ff49ae` (`eval/build_gsm8kit_holdout.py:25-30`) but omitted from the ban sets.

The declared dataset labels are consistent with the reviewed cards: [FineWeb-2 (ODC-By)](https://huggingface.co/datasets/HuggingFaceFW/fineweb-2), [FineWeb (ODC-By, pinned README)](https://huggingface.co/datasets/HuggingFaceFW/fineweb/blob/9bb295ddab0e05d785b879661af7260fed5140fc/README.md), [GSM8K (MIT)](https://huggingface.co/datasets/openai/gsm8k/tree/main), [Hermes function-calling (Apache-2.0)](https://huggingface.co/datasets/NousResearch/hermes-function-calling-v1), the [Glaive function-calling card (Apache-2.0)](https://huggingface.co/datasets/glaiveai/glaive-function-calling-v2), and [MBPP (CC-BY-4.0)](https://huggingface.co/datasets/google-research-datasets/mbpp). The FineWeb label is the dataset license; it does not independently establish rights in every crawled web page. The rows retain only a dataset/config label (`sources_v2.py:49-65`), not the originating page URL or author, so the adequacy of attribution for redistributed web text remains **PLAUSIBLE**.

### P2 — Italian GSM8K holdout is absent from the ban sets

**Evidence:** `eval/build_gsm8kit_holdout.py:4-8` says “the TEST split of GSM8K translated to Italian.” `calib-v2/evalsets.py:29-34` has no `Eurolingua/gsm8kx` revision, and `:130-141` never loads `gsm8k_IT_test.jsonl` as a ban set. The Italian calibration is reused Aya data (`counts.json:5-18`).

**Failure scenario:** if an Aya row contains a translated or paraphrased GSM8K-IT test question, the v2 gate may evaluate memorized calibration content. No actual duplicate was established, so contamination is **PLAUSIBLE**; omission of the holdout from the ban list is **CONFIRMED**.

### P2 — The calibration is equal by raw-text token count, not by profiler input tokens

**Evidence:** `build_calib_v2.py:85-86` counts `tok(text, add_special_tokens=False)` on joined message content. The pinned profiler instead calls `tok.apply_chat_template(...)` in `src/moep/data.py:152-170`, then adds EOS after each row and packs the concatenated token stream (`src/moep/profiler.py:132-141`).

**Failure scenario:** template markers and EOS are absent from `counts.json`, so the advertised 450k per domain is not the number or cost of tokens profiled. Per-row overhead differs with row count and message structure, making actual domain exposure unequal even when raw content counts match. Packing also allows one row to attend to preceding rows through the causal context; EOS is a separator, not an attention reset. **CONFIRMED** for the count mismatch; the importance of cross-row context leakage is **PLAUSIBLE**.

The profiler does apply the Qwen chat template; the concern that it profiles raw text is **REFUTED**. Long rows are not individually discarded or cut at `seq_len`: they are split in the concatenated stream, and only the final remainder shorter than one sequence is dropped by `flat[: n * seq_len]` (`profiler.py:136-141`). The specific per-row truncation concern is **REFUTED**.

### P2 — Reasoning and language-use mix is narrow and not demonstrated representative

**Evidence:** `counts.json:48-56` records `"rows": 951`, `"tokens": 450238`, and `"HuggingFaceFW/fineweb": 313786`; the other language domains have 1,969–2,351 rows. A scan found 533 English FineWeb rows are single user-message web documents, 300 Aya rows, and 118 Hermes multiturn rows. `counts.json:92-103` records `"openai/gsm8k": 450002`; `sources_v2.py:68-74` reads its train split and full solutions only. There are 2,433 math rows; 174 contain literal `<think>` tags. Aya translated chain-of-thought rows also appear in IT/FR/ES/ZH, so reasoning is not absent. `data.py:152-170` wraps rows in the model's chat template, but a web page placed in a `user` message does not become a user/assistant conversation.

**Failure scenario:** the equal-language-domain design gives each domain one seventh of the merged additive mass regardless of actual Kalsa traffic. English is mostly long web content; Italian is all Aya; Chinese is nearly all reused Aya; “math” is one English arithmetic dataset. This may underrepresent assistant responses, multilingual reasoning traces, and varied math/tool workflows. It is not possible to call the mix unrepresentative without a measured product-use distribution. **PLAUSIBLE.**

### P2 — Code data is dominated by one project's source and mislabeled dialogue, not benchmark-like Python

**Evidence:** `counts.json:79-84` records `"kalsallama-engine": 104859`, `"kalsallama-python": 97818`, `"cpython-stdlib": 98345`, `"google-research-datasets/mbpp": 11797`, and `"NousResearch/hermes-function-calling-v1": 137315`. That is 2.6% MBPP and 30.5% ordinary Hermes dialogue in the 450,134-token code domain. `PHASE0-CALIB.md:26-28` says local source fills “~300k,” which is accurate, but does not make that source representative of user code.

**Failure scenario:** pruning can favor the conventions of kalsallama and CPython rather than diverse application code. Python benchmark/task patterns are very lightly represented, while the nominal tool-call portion is largely not tool use. The counts do **not** support calling the domain C-heavy: C/C++ is about 23.3% of the total code domain, with similar amounts of engine Python and stdlib. Bias toward a small set of codebases is **PLAUSIBLE**; a specifically C-heavy skew is **REFUTED**.

### P2 — The overlap gate does not cover translation or paraphrase leakage, and its “independent” pass shares the same matcher

**Evidence:** `evalsets.py:8-12` says “A 13-gram is 13 consecutive tokens”; its CJK tokenizer splits one character per token. `:88-97` implements exact normalized equality plus 13-gram matching. `eval_overlap_check.py:27,40-42` reloads `evalsets` and calls the same `bans.hits(text)` function as the builder. `evalsets.py:19-23,119-141` loads local FLORES/corpus files but does not pin their hashes or reject an empty/missing corpus directory.

**Failure scenario:** semantically equivalent translated or paraphrased eval content with fewer than 13 shared normalized characters passes. A wrong or empty local FLORES copy also produces a clean-looking zero. The coordinator's zero-hit result establishes zero under this particular matcher and the loaded files; it does not establish semantic non-contamination. **CONFIRMED** as a method limitation; an actual hidden overlap is **PLAUSIBLE**.

### P2 — Pod input hashes and exact domain set are not enforced

**Evidence:** `pod/20_observe.sh:23-25` runs `test -f "$CALIB_DIR/$d.jsonl"` for each supplied domain; it never checks `CALIB-V2-MANIFEST.sha256`. `:20,34-35` accepts arbitrary `CALIB_V2_DOMAINS`, pairs whatever names are supplied, and `:51-58` checks only those names plus the merged summary.

> `pod/20_observe.sh:20`: `DOMAINS="${CALIB_V2_DOMAINS:-it fr es en zh code math}"`
>
> `pod/20_observe.sh:23`: `for d in $DOMAINS; do`
>
> `pod/20_observe.sh:24`: `test -f "$CALIB_DIR/$d.jsonl" || { echo "20: missing $CALIB_DIR/$d.jsonl" >&2; exit 1; }`

**Failure scenario:** a truncated or replaced JSONL passes preflight, or `CALIB_V2_DOMAINS="it fr"` produces a two-domain merged file and `.ok` that looks successful despite the required seven-domain design. A duplicate name can profile and merge the same file twice. **CONFIRMED.**

### P2 — The failure cleanup promised in the script is absent

**Evidence:** `pod/20_observe.sh:9-11` says “delete partial stats on failure”; `:26-27` only removes old stats at startup. There is no `trap`. `30_score.sh:16` is `test -f "$RUN/profile.stats.pt" ...`; it checks file existence, not `20_observe.ok`.

**Failure scenario:** profiling writes a merged file, a later summary assertion fails, and the partial output remains; an operator or orchestration error can then run `30_score.sh` against it. The next normal observe retry does clean these files at startup, but that does not fulfill the stated failure cleanup guarantee. **CONFIRMED.**

### P2 — The stated total is inconsistent, and ban counters are hits rather than unique dropped rows

**Evidence:** `calib-v2/SOURCES.md:3-4` says `3,152,546 total`; `counts.json:106` is `"total_tokens": 3151990`, and `PHASE0-CALIB.md:24` says **3,151,990**, a 556-token discrepancy. The per-domain counts in `counts.json` match the phase table: IT 450,046 (`:5-7`), FR 450,609 (`:20-22`), ES 450,405 (`:34-36`), EN 450,238 (`:48-50`), ZH 450,556 (`:63-65`), code 450,134 (`:74-76`), math 450,002 (`:92-94`).

`PHASE0-CALIB.md:47-49` reports 26 MBPP, 5 GSM8K, 2 HumanEval, and 4 HumanEval+ hits. The 25 code-domain MBPP hits are confirmed (`counts.json:86-90`), plus one IT-domain hit (`counts.json:14-18`). But `build_calib_v2.py:76-80` counts each matching set before rejecting a candidate. A row hitting multiple sets increments multiple counters.

> `build_calib_v2.py:78-79`: `self.skips[f"ban:{name}"] = self.skips.get(f"ban:{name}", 0) + 1`

**Failure scenario:** adding 26+5+2+4 to claim “37 rows dropped” overstates unique rows unless the hit sets are disjoint. No unique dropped-row counter is emitted. **CONFIRMED** that these values are hit events, not a verified unique-row total. The reported 25 code MBPP-train hits are **CONFIRMED**.

### P2 — “Byte-identical” single-file compatibility is false; smoke does not exercise it

**Evidence:** `PHASE0-CALIB.md:84` says a single calibration behaves “byte-identically to v1.” The patch adds `"norm_max"` to `STAT_KEYS` (`patches/moep-domain-normmax.patch:131-135`) and `"max_norm_max"` to every summary (`patches/moep-domain-normmax.patch:213-217`), so output files and summary shape necessarily change. The committed smoke driver builds seven files and passes seven `--calib/--domain` pairs only (`verify/smoke_domain_profile.py:71-74`); it has no single-file invocation.

**Failure scenario:** a consumer that compares output bytes or expects the old exact stats keys sees a changed artifact. The committed smoke cannot substantiate the separate single-file/backward-compatibility assertion. **CONFIRMED** that “byte-identical” is false and that the harness does not test the claim; whether a manual out-of-band single run succeeded is **PLAUSIBLE**, not independently evidenced here.

### P2 — The smoke's exact `norm_max` number is not reproducible

**Evidence:** `PHASE0-CALIB.md:88-95` records max `15,588.8`. `verify/make_synth_checkpoint.py:56-58` calls `torch.randn(*shape, ...)` without setting a seed. Rerunning the committed smoke exited 0, profiled 1,792 tokens, and reported max `18,880.461`.

**Failure scenario:** treating `15,588.8` as a stable regression value will fail across generated synth checkpoints; only finiteness, positivity, and merge consistency are checked. The claimed smoke EXIT=0 is **CONFIRMED**; the exact maximum is **CONFIRMED** to be unstable by the rerun.

### P2 — Repeatable `--calib` silently ignores extra files when `--domain` is omitted

**Evidence:** `patches/moep-domain-normmax.patch:43-49` says `domains = a.domain or [""]` and `for dom, calib in zip(domains, a.calib)`; its length check runs only when `a.domain` is truthy (`:15-18`).

**Failure scenario:** `--calib a.jsonl --calib b.jsonl` without domains profiles only `a.jsonl` and exits without warning. The pod currently supplies domains, so this is a CLI edge case rather than a campaign-path defect. **CONFIRMED.**

### P3 — CUDA accumulation is not shown to be bitwise deterministic

**Evidence:** The pinned `src/moep/profiler.py:82` says `st["gate_sum"][row].scatter_add_(0, idx, w)`, and neither the patch nor the observe script sets deterministic-kernel controls. The smoke only checks one run and uses random synthetic weights.

**Failure scenario:** repeated GPU profiles could differ slightly from floating-point atomic accumulation order even with identical files and model. No repeated real-GPU profile was performed, so this is **PLAUSIBLE**, not a confirmed material ranking change. The implementation does create fresh `ExpertStats` for each domain and removes hooks in a `finally` block (`src/moep/profiler.py:147,163-166`); no cross-domain accumulator or hook leak was found. The merge correctly sums additive tensors and takes elementwise max for `norm_max` (`patches/moep-domain-normmax.patch:159-174`), and norm computations are promoted to float32 before accumulation (`src/moep/profiler.py:100-105`).

## Checks that held up

- No explicit HF token pattern (`hf_...`) or `/Users/` path was found in the committed phase-0a tree. HF dataset calls use pinned revisions and do not pass a token argument. This says nothing about environment-provided credentials outside the committed files.
- FineWeb-2/FineWeb ODC-By, GSM8K MIT, Hermes Apache-2.0, and MBPP CC-BY-4.0 labels match the reviewed dataset cards linked above. The concrete license defect found is the included ISC `flatted` chunk, not those source labels.
- The profiler computes the down-projection output before route-weight multiplication (`src/moep/profiler.py:100-105`); `norm_max` is float32 and the union merge uses elementwise max while additive sums and token totals are summed. No erroneous averaging of means during merge was found.
- `20_observe.sh` uses `set -euo pipefail` (`:12`) and contains no command pipeline whose status can be masked. The observed diff changes calibration invocation and assertions, not budget/termination logic. The missing trap and marker behavior above remain defects.

## Dead code (last)

- `calib-v2/sources_v2.py:17` defines `LAB = HOME / "Projects/kalsa-moe-experiments"`; `sources_v2.py` does not use it. (The separate `evalsets.py` `LAB` is live because it builds local corpus paths.)
