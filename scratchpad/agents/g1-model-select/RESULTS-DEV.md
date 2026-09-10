<!-- System prompts extracted verbatim from /Users/marco/Projects/kalsa/src/i18n/en.ts:1087-1106 and /Users/marco/Projects/kalsa/src/i18n/it.ts:1047-1066 (base systemPrompt, not systemPromptWithSearch; current on-disk key lines). -->
# G1 dev run

The corpus has 80 cases: conversation 20, instructions 20, tools 16, documents 12, memory 12; 40 Italian and 40 English; 60 dev and 20 holdout. The dev run has 60 cases per model, including 12 rubric cases. Rubric cases were recorded but not judged or included in deterministic pass rates.

## Commands

```sh
/Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-server -m /Users/marco/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf -c 8192 -b 512 -ub 256 -t 8 -ctk q8_0 -ctv q4_0 -fa auto --jinja --reasoning on --reasoning-format deepseek --reasoning-preserve --mlock --port 8080 >results/server-lfm.stdout.log 2>results/server-lfm.log
python3 run_corpus.py --base-url http://127.0.0.1:8080 --model-label lfm --split dev --sampler samplers/lfm.json --system-prompt-en-file system-prompt-en.txt --system-prompt-it-file system-prompt-it.txt --out results/lfm-dev.jsonl | tail -5

/Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-server -m /Users/marco/kalsa-qdc/models/MiniCPM5-2B-Q4_K_M.gguf -c 8192 -b 512 -ub 256 -t 8 -ctk q8_0 -ctv q4_0 -fa auto --jinja --reasoning on --reasoning-format deepseek --reasoning-preserve --mlock --port 8080 >results/server-minicpm.stdout.log 2>results/server-minicpm.log
python3 run_corpus.py --base-url http://127.0.0.1:8080 --model-label minicpm --split dev --sampler samplers/minicpm.json --system-prompt-en-file system-prompt-en.txt --system-prompt-it-file system-prompt-it.txt --out results/minicpm-dev.jsonl | tail -5
```

Both servers passed `/health`, both runner commands returned 0, and each processed 60/60 requests. Server stderr is in `results/server-lfm.log` and `results/server-minicpm.log`.

`validate.py` output: `VALIDATION OK`; cases=80; category={conversation:20, instructions:20, tools:16, documents:12, memory:12}; lang={it:40, en:40}; split={dev:60, holdout:20}.

## Deterministic scores

Pass rate is `PASS / (PASS + FAIL)`; `RUBRIC` and `ERROR` are excluded from the denominator.

| LFM category | lang | split | pass rate | pass | fail | rubric | error |
|---|---:|---:|---:|---:|---:|---:|---:|
| conversation | en | dev | 0.750 | 3 | 1 | 3 | 0 |
| conversation | it | dev | 1.000 | 4 | 0 | 4 | 0 |
| documents | en | dev | 1.000 | 4 | 0 | 0 | 0 |
| documents | it | dev | 1.000 | 5 | 0 | 0 | 0 |
| instructions | en | dev | 1.000 | 7 | 0 | 1 | 0 |
| instructions | it | dev | 0.833 | 5 | 1 | 1 | 0 |
| memory | en | dev | 1.000 | 3 | 0 | 2 | 0 |
| memory | it | dev | 1.000 | 3 | 0 | 1 | 0 |
| tools | en | dev | 1.000 | 6 | 0 | 0 | 0 |
| tools | it | dev | 1.000 | 6 | 0 | 0 | 0 |

| MiniCPM category | lang | split | pass rate | pass | fail | rubric | error |
|---|---:|---:|---:|---:|---:|---:|---:|
| conversation | en | dev | 0.750 | 3 | 1 | 3 | 0 |
| conversation | it | dev | 1.000 | 4 | 0 | 4 | 0 |
| documents | en | dev | 1.000 | 4 | 0 | 0 | 0 |
| documents | it | dev | 1.000 | 5 | 0 | 0 | 0 |
| instructions | en | dev | 0.857 | 6 | 1 | 1 | 0 |
| instructions | it | dev | 0.833 | 5 | 1 | 1 | 0 |
| memory | en | dev | 1.000 | 3 | 0 | 2 | 0 |
| memory | it | dev | 1.000 | 3 | 0 | 1 | 0 |
| tools | en | dev | 1.000 | 6 | 0 | 0 | 0 |
| tools | it | dev | 1.000 | 6 | 0 | 0 | 0 |

## Failures

LFM: C14 — emitted unsupported textual `web_search` markup instead of the numeric answer; I11 — returned “1 ore” instead of singular “1 ora”.

MiniCPM5: C14 — returned a reasoning marker and duplicate `15` instead of the required number; I06 — returned only `- [ ]`; I11 — returned “1 ore” instead of singular “1 ora”.

| model | case | category | lang | failed check | answer excerpt |
|---|---|---|---|---|---|
| lfm | C14 | conversation | en | exact / mismatch | `<|tool_call_start|>[web_search(query='pasta cooking time 9 minutes serve in 15 minutes when to start cooking', source='n` |
| lfm | I11 | instructions | it | exact / mismatch | `1 ore e 30 minuti` |
| minicpm | C14 | conversation | en | exact / mismatch | `15` |
| minicpm | I06 | instructions | en | regex / mismatch | `- [ ]` |
| minicpm | I11 | instructions | it | exact / mismatch | `1 ore e 30 minuti` |

## Tools and performance

Both models returned structured `tool_calls` for all 12 dev tool cases; neither returned a tool call as ordinary/XML text. Tool cases were checked across every returned call and against required arguments. No post-tool execution was performed. The schemas are intentionally invented offline schemas because the product `web_search` cannot be simulated offline; this is a declared deviation.

| model | median prompt tok/s | median decode tok/s | median completion tokens |
|---|---:|---:|---:|
| lfm | 297.515 | 45.034 | 155.0 |
| minicpm | 161.644 | 41.757 | 99.5 |

HTTP errors: 0. Timeouts: 0. Runner `ERROR` rows: 0 for both models.

## Deviations from the app

- Pass 1 deliberately uses `thinking_budget_tokens=256` for both models, including MiniCPM5, to compare the product’s short budget; 512-token extended sampler files are provided for the later hard-case pass but were not run here.
- The runner uses the exact locale-specific base `systemPrompt` files selected per case language. Tool cases receive that same base prompt plus their invented OpenAI function schemas; the product’s tools variant is not hand-built.
- MiniCPM5 used the requested app-mirroring `q8_0`/`q4_0` KV-cache flags; no model-specific KV-cache tuning was introduced.
- No real external tools or network calls were made by the runner; it only calls the local llama-server endpoint. Open-ended cases remain `RUBRIC` for the blind pass.
- `run_wild.sh` was minimally changed so stage 1 uses the dev server flags on port 8081; `run_corpus.py` now maps only `it` to Italian and every other locale to English, records `system_lang`, and supports the written extended-ID selection.

## Wild / bake-off / extended

Wild deterministic tallies (`PASS/(PASS+FAIL)`, rubric excluded): LFM multilingual 6/6, absurd en 3/4 and it 2/4; MiniCPM5 multilingual 4/6 (de/es/fr/ja 1/1, pt/zh 0/1), absurd en 2/4 and it 0/4. Per-language wild rows are in `results/score-wild.log`; bake-off detail is in `results/bakeoff-report.log`.

Executed commands: `bash run_wild.sh lfm-dev samplers/lfm.json` rc=0; `bash run_wild.sh minicpm-dev samplers/minicpm.json` rc=0. Extended commands used the same one-server-at-a-time flags and runner: `python3 run_corpus.py --base-url http://127.0.0.1:8080 --model-label lfm --split dev --ids-file extended-ids.txt --sampler samplers/lfm-extended.json --out results/lfm-dev-ext.jsonl` rc=0; the corresponding MiniCPM5 command with `--model-label minicpm`, `samplers/minicpm-extended.json`, and `results/minicpm-dev-ext.jsonl` rc=0. `score.py` rc=0 for both later blocks.

| bake-off cell | overall | en | it | es | fr |
|---|---:|---:|---:|---:|---:|
| lfm@256 | 25/44 | 5/11 | 7/11 | 7/11 | 6/11 |
| lfm@512 | 23/44 | 5/11 | 6/11 | 7/11 | 5/11 |
| minicpm@256 | 30/44 | 9/11 | 7/11 | 7/11 | 7/11 |
| minicpm@512 | 29/44 | 9/11 | 7/11 | 7/11 | 6/11 |

Bake-off question-block counts, in order `absurd_gift, fact_spa2000, count_vowels, arith_change, false_premise, local_knowledge, format_obedience, honesty_unknown, ambiguous, fermi_estimate, genuine_refusal`: lfm@256=`2/4,0/4,4/4,4/4,3/4,1/4,4/4,0/4,2/4,1/4,4/4`; lfm@512=`1/4,0/4,4/4,4/4,3/4,1/4,4/4,0/4,2/4,0/4,4/4`; minicpm@256=`1/4,0/4,4/4,4/4,4/4,3/4,3/4,0/4,3/4,4/4,4/4`; minicpm@512=`1/4,0/4,4/4,4/4,4/4,3/4,3/4,0/4,3/4,3/4,4/4`.

Extended set: `C07 C08 C09 C10 C11 C12 C15 I06 I11 I13 I14 M01 M05 M06 M09 C14`. Both models: 3/4 deterministic, 12 rubric, 0 errors; per language EN 2/2 and IT 1/2. Extended deterministic failure: I11 for both.

Blind judge still needed for 12 dev rubric rows, 16 wild rubric rows, and 44 short-budget bake-off rows; the pack is 72 rows in `results/judge-pack.jsonl` and `results/judge-pack.md`, with model order only in `results/judge-key.json`. The 12 extended rubric answers are not mixed into that pack and remain for a separate budget comparison.

## v2: app prompt and default tools

The v2 snapshots are exactly one line each: `system-prompt-en.v2.txt` contains “in the language the user writes in”; `system-prompt-it.v2.txt` contains “nella lingua in cui scrive l'utente”. `tools-app-default.json` has the seven default-on `TOOL_ENTRIES` from `toolRegistry.ts:85-142` and the exact definitions named in `export_tools_app_default.mjs`; every wild and bake-off request sent `tools` plus `tool_choice: "auto"`. Tool execution stayed offline: web tools return the canned unavailable message, device_calc uses the safe arithmetic evaluator, and the other five tools use the requested canned results. v1 scripts/results were not modified.

Commands: `bash run_v2.sh lfm samplers/lfm.json` rc=0; `bash run_v2.sh minicpm samplers/minicpm.json` rc=0. `python3 score.py results/wild-v2/lfm.jsonl results/wild-v2/minicpm.jsonl` rc=0; `node /Users/marco/Projects/kalsa/scripts/quality/report.mjs --out "$PWD/results/bakeoff-v2"` rc=0; `python3 make_judge_pack_v2.py` rc=0. The v2 bake-off kept matrix-g1's same models, KV layout, prompts, cells, sampling defaults, and score.mjs/report.mjs; only the locale snapshots, seven schemas, tool loop, and final-answer source changed.

| block | v1 LFM | v2 LFM | v1 MiniCPM5 | v2 MiniCPM5 |
|---|---:|---:|---:|---:|
| wild deterministic | 11/14 | 11/14 | 6/14 | 9/14 |
| bake-off @256 | 25/44 | 25/44 | 30/44 | 32/44 |
| bake-off @512 | 23/44 | 20/44 | 29/44 | 33/44 |

Wild v2 by language: LFM multilingual `6/6`, absurd EN `3/4`, IT `2/4`; MiniCPM5 multilingual `6/6`, absurd EN `3/4`, IT `0/4`. Bake-off v2 by language: LFM @256 `7/11,7/11,6/11,5/11` and @512 `6/11,4/11,5/11,5/11`; MiniCPM5 @256 `9/11,8/11,8/11,7/11` and @512 `9/11,8/11,10/11,6/11` (EN, IT, ES, FR).

Tool rounds / rows with a tool call / final raw syntax: LFM wild `19/15/0`, @256 `53/30/0`, @512 `50/29/0`; MiniCPM5 wild `2/2/0`, @256 `27/19/0`, @512 `24/18/0`. Across all 118 v2 rows per model, final answers containing raw tool syntax: LFM `0`, MiniCPM5 `0`; HTTP/timeouts/errors: `0`.

The v2 blind pack has 60 rows (16 wild rubric + 44 open bake-off @256), with fresh per-row A/B randomization and mapping only in `results/judge-key-v2.json`: `results/judge-pack-v2.jsonl` and `results/judge-pack-v2.md`. The 12 dev rubric rows remain exclusively in the untouched v1 pack.

## v2b: app tool-loop repair

Selection was literal: original final `finish_reason == "tool_calls"` OR empty content. Affected rows: LFM wild `1`, @256 `18`, @512 `19`; MiniCPM5 wild `0`, @256 `1`, @512 `0`. The known 14 empty LFM @256 judge-pack rows are included; the extra selected rows are non-empty finals that still ended with `tool_calls`. v2b used three loop rounds, round index 2 text-only (`tool_choice: "none"`, no `tools`), repeated failed-key and two-successful-search text-only guards, and one extra text-only fallback completion after exhaustion.

| block | v1 LFM | v2 LFM | v2b LFM | v1 MiniCPM5 | v2 MiniCPM5 | v2b MiniCPM5 |
|---|---:|---:|---:|---:|---:|---:|
| wild deterministic | 11/14 | 11/14 | 11/14 | 6/14 | 9/14 | 9/14 |
| bake-off @256 | 25/44 | 25/44 | 34/44 | 30/44 | 32/44 | 32/44 |
| bake-off @512 | 23/44 | 20/44 | 34/44 | 29/44 | 33/44 | 33/44 |

v2b tool-call rounds (selected rows): LFM wild `1`, @256 `38`, @512 `36`; MiniCPM5 wild `0`, @256 `2`, @512 `0`. Tool-call counts by round (tuple is round 0, 1, 2, fallback): LFM wild `{(1,0):1}`; @256 `{(1,1,0):13,(1,1,1):2,(2,0):1,(2,2,0):1,(2,2,1):1}`; @512 `{(1,1,0):14,(2,2,0):3,(2,0):1,(1,0):1}`; MiniCPM5 @256 `{(1,1,0):1}`. Still-empty finals after v2b: LFM `0/38`, MiniCPM5 `0/1`.

Commands completed: `bash run_v2b.sh lfm samplers/lfm.json` rc=0; `bash run_v2b.sh minicpm samplers/minicpm.json` rc=0; `python3 score_v2b.py` rc=0; `python3 make_judge_pack_v2b.py` rc=0. The affected-only pack has 18 rows, preserves the exact v2 A/B mapping, and uses original v2 answers for the unselected model side; mapping subset is in `results/judge-key-v2b.json`.

## v2b corrected visible-answer pass

The first v2b subsection above predates the final-answer cleanup. This append-only correction supersedes its stale v2b tallies: the app-style loop now removes raw tool syntax from the visible answer and uses the app fallback after the extra text-only completion. v2 files were not modified.

| block | LFM v1 | LFM v2 | LFM v2b | MiniCPM5 v1 | MiniCPM5 v2 | MiniCPM5 v2b |
|---|---:|---:|---:|---:|---:|---:|
| wild | 11/14 | 11/14 | 11/14 | 6/14 | 9/14 | 9/14 |
| bake-off @256 | 25/44 | 25/44 | 33/44 | 30/44 | 32/44 | 32/44 |
| bake-off @512 | 23/44 | 20/44 | 34/44 | 29/44 | 33/44 | 33/44 |

Affected rows rerun: LFM wild 1, @256 18, @512 19; MiniCPM5 wild 0, @256 1, @512 0. Still-empty finals: LFM 0/38, MiniCPM5 0/1. Selected-row finals containing raw tool syntax: 0 for both models.

Corrected tool-call distributions (calls per response round, including fallback where present): LFM wild `{(2,0):1}`; @256 `{(2,2,0):1,(1,1,0):13,(2,0):1,(2,2,1,1):1,(1,1,1,1):1,(1,1,1,0):1}`; @512 `{(1,1,0):14,(2,2,0):3,(1,0):1,(2,0):1}`. MiniCPM5 @256 `{(1,1,0):1}`; no selected rows in the other blocks. The 18-row `results/judge-pack-v2b.jsonl` keeps the v2 A/B mapping via `results/judge-key-v2b.json`.

Corrected commands: `bash run_v2b.sh lfm samplers/lfm.json` rc=0; `bash run_v2b.sh minicpm samplers/minicpm.json` rc=0; `python3 score_v2b.py` rc=0; `python3 make_judge_pack_v2b.py` rc=0; final pack/output validation rc=0.

## v2c: MiniCPM5 thinking-budget cell

MiniCPM5 only, same Q4_K_M model, v2 prompt snapshots, `tools-app-default.json`, and app loop. The 1024 cell sent `thinking_budget_tokens: 1024`. The `nobudget` cell omitted `thinking_budget_tokens`; this fork documents omission/default `-1` as unrestricted. Both retained `samplers/minicpm.json` sampling and `max_tokens: 1024`.

| budget | bake-off deterministic | en | it | es | fr | wild |
|---|---:|---:|---:|---:|---:|---:|
| 1024 | 33/44 (75%) | 9/11 | 8/11 | 8/11 | 8/11 | 16 rubric |
| nobudget | 33/44 (75%) | 9/11 | 8/11 | 8/11 | 8/11 | 16 rubric |

Wild rows are excluded from deterministic pass rates and remain for blind judging. Empty model answers: 1024 `0`; nobudget `0`. Bare-`>` model answers: 1024 `0`; nobudget `0`. Reasoning tokens use `sum(timings.predicted_n)` minus exact visible-answer token count from the server `/tokenize` endpoint; p90 is inclusive interpolation: 1024 median `157.5`, p90 `717.1`, max `3751`; nobudget median `186.5`, p90 `717.1`, max `3751`.

Phone cost estimate from reasoning tokens: 1024 S23 median/p90 `24.23/110.32 s` at 6.5 tok/s, Jelly `35.00/159.36 s` at 4.5 tok/s; nobudget S23 `28.69/110.32 s`, Jelly `41.44/159.36 s`.

Both cells completed 60 rows with zero HTTP errors; median row wall time was 7297 ms at 1024 and 8255 ms unbounded. Blind packs (fresh per-row A/B mappings) are `results/judge-pack-v2c-1024.jsonl` with `results/judge-key-v2c-1024.json`, and `results/judge-pack-v2c-nobudget.jsonl` with `results/judge-key-v2c-nobudget.json`. Scores are in `results/score-v2c-1024.txt` and `results/score-v2c-nobudget.txt`.

## v2b blind judging, merged into v2 (2026-09-09 ~15:40 EDT)

The 18 affected rows (`results/judge-pack-v2b.jsonl`, same per-row A/B mapping as v2 — `judge-key-v2b.json` agrees with `judge-key-v2.json` on all 18) were re-judged fresh by the same two judges (`judge-A-deepseek-v2b.jsonl`, `judge-B-mimo-v2b.jsonl`, 18/18 each). Unblinded by the orchestrator; the 18 v2b verdicts replace the v2 verdicts for those rows, the other 42 rows keep their v2 verdicts.

| judge | rows | LFM wins | MiniCPM5 wins | tie | mean LFM | mean MiniCPM5 |
|---|---|---|---|---|---|---|
| deepseek, v2 (60) | 60 | 25 | 22 | 13 | 2.78 | 3.13 |
| deepseek, the 18 rows at v2 | 18 | 0 | 15 | 3 | 0.39 | 2.83 |
| deepseek, the 18 rows at v2b | 18 | 9 | 6 | 3 | 3.00 | 3.00 |
| **deepseek, v2 merged with v2b** | 60 | **34** | **13** | 13 | 3.57 | 3.18 |
| mimo, v2 (60) | 60 | 23 | 24 | 13 | 2.77 | 3.17 |
| mimo, the 18 rows at v2 | 18 | 2 | 13 | 3 | 0.39 | 3.06 |
| mimo, the 18 rows at v2b | 18 | 9 | 4 | 5 | 3.56 | 3.22 |
| **mimo, v2 merged with v2b** | 60 | **30** | **15** | 15 | 3.72 | 3.22 |

Per block, merged: bakeoff (44) deepseek 23/8/13, mimo 23/7/14; wild (16) deepseek 11/5/0, mimo 8/7/1.

Caveats, all real: the 18 rows were judged in a separate session from the other 42 (a session effect is possible; both judges move the same way); 17 of the 18 are LFM-side repairs, so the flip measures what the harness round-cap had been costing LFM, not new MiniCPM5 weakness; wild rows are single-language and few.

Artefact still in the pack, MiniCPM5 side: `bakeoff/fact_spa2000/fr` and `bakeoff/honesty_unknown/en` at `@256` have a bare `>` as the whole answer (`results/bakeoff-v2/minicpm@256.jsonl`, `finish=stop`, `predicted_n=258`, reasoning present): the 256-token thinking budget cut the reasoning and the forced close left `>` as content. 2/44 at `@256`, 0/44 at `@512`, 0 for LFM. This is a product risk for MiniCPM5 on the app's short budget (256), and a budget-enforcement/parser question for the fork, not a judging error.

## v2c final appended record

MiniCPM5 v2c deterministic table: 1024 = bake-off `33/44 (75%)`, en `9/11`, it `8/11`, es `8/11`, fr `8/11`; nobudget = bake-off `33/44 (75%)`, en `9/11`, it `8/11`, es `8/11`, fr `8/11`. The 16 wild rows per cell are rubric-only and excluded from deterministic rates.

Budget semantics: 1024 sent `thinking_budget_tokens: 1024`; nobudget omitted it, using the fork's documented default `-1` unrestricted. Both used the app prompt, seven default tools, v2b app loop, MiniCPM5 Q4_K_M, and sampler `samplers/minicpm.json` with `max_tokens: 1024`.

Model-visible empty/bare-`>` answers: 1024 `0/60` empty, `0/60` bare `>`; nobudget `0/60`, `0/60`. Reasoning tokens were `sum(timings.predicted_n)` minus exact `/tokenize` visible-answer tokens: 1024 median `157.5`, p90 `717.1`, max `3751`; nobudget median `186.5`, p90 `717.1`, max `3751`.

Phone cost at 6.5 tok/s S23 / 4.5 tok/s Jelly: 1024 median/p90 `24.23/110.32 s` / `35.00/159.36 s`; nobudget `28.69/110.32 s` / `41.44/159.36 s`.

Outputs: `results/wild-v2c/`, `results/bakeoff-v2c/`; scores: `results/score-v2c-1024.txt`, `results/score-v2c-nobudget.txt`; blind packs and fresh keys: `results/judge-pack-v2c-1024.jsonl` + `results/judge-key-v2c-1024.json`, and `results/judge-pack-v2c-nobudget.jsonl` + `results/judge-key-v2c-nobudget.json`. No blind judging was performed.

## v2d: MiniCPM5 Q8_0 quantisation control

Model: `/Users/marco/kalsa-qdc/models/MiniCPM5-2B-Q8_0.gguf`; SHA-256 `c5415f8989bf88a8288f1b55a3cc371af53c07b0faa220a63bd7a990cfaba078`. Same v2c nobudget setup: `thinking_budget_tokens` omitted, v2 prompt snapshots, seven default tools, app loop, sampler, server flags, and 60 judged rows. Q8 deterministic bake-off score is `31/44 (70%)`, versus Q4_K_M v2c nobudget `33/44 (75%)`; by language Q8 `en 10/11, it 8/11, es 8/11, fr 5/11`, versus Q4 `en 9/11, it/es/fr 8/11`. Wild `16` rows are rubric-only.

Token distributions, computed as total `timings.predicted_n` minus exact `/tokenize` visible-answer tokens: Q8 median/p90/max `156.5/528.0/1540`; Q4_K_M v2c nobudget `186.5/717.1/3751`. Q8 model-visible empty answers `0/60`, bare `>` `0/60`; median wall time `8742 ms`. No blind judging was performed.

Q8 outputs: `results/wild-v2d/minicpm-q8@nobudget.jsonl` and `results/bakeoff-v2d/minicpm-q8@nobudget.jsonl`; score `results/score-v2d-q8-nobudget.txt`; blind pack `results/judge-pack-v2d-q8.jsonl`; fresh key `results/judge-key-v2d-q8.json`. Runner completed rc=0, scoring rc=0, pack/validation rc=0, and the server was stopped.

## v2c blind judging (2026-09-09 ~17:30 EDT)

Two packs, 60 rows each, fresh per-row A/B (`results/judge-key-v2c-{1024,nobudget}.json`), MiniCPM5 v2c vs LFM v2b-merged. Unblinded by the orchestrator. Judge files: `judge-A-deepseek-v2c-*.jsonl`, `judge-B-mimo-v2c-*.jsonl`.

| cell | judge | LFM | MiniCPM5 | tie | mean LFM | mean MiniCPM5 | bake-off (44) | wild (16) |
|---|---|---|---|---|---|---|---|---|
| MiniCPM5 @1024 vs LFM | deepseek | 28 | 15 | 17 | 3.53 | 3.15 | 19/10/15 | 9/5/2 |
| MiniCPM5 @1024 vs LFM | mimo | 27 | 13 | 20 | 3.63 | 3.18 | 16/9/19 | 11/4/1 |
| MiniCPM5 unbounded vs LFM | deepseek | 26 | 17 | 17 | 3.53 | 3.27 | 20/10/14 | 6/7/3 |
| MiniCPM5 unbounded vs LFM | mimo | 24 | 15 | 21 | 3.62 | 3.30 | 16/9/19 | 8/6/2 |

Judge agreement on the winner: 43/60 (1024), 38/60 (unbounded). Compared with v2b-merged (LFM 34/13/13 and 30/15/15 at budget 256/512), lifting MiniCPM5's thinking budget moves it by two to four rows, all on the wild block; the bake-off gap (fabricated facts, language drift) does not move. The budget hypothesis is REFUTED as the cause of the loss. Failure classes named by both judges on the MiniCPM5 side: confabulated places/dates/names (Lirinda, Vichy, Mairzac, "Sahara Solar", Villeneuve, invented fruit varieties), answers in English or garbled to non-English prompts, a Chinese character leak in a Spanish answer, one counting error. Next cell (v2d): same at Q8_0 to separate quantisation from model behaviour.

## v2d final appended record

MiniCPM5 Q8_0: `/Users/marco/kalsa-qdc/models/MiniCPM5-2B-Q8_0.gguf`; SHA-256 `c5415f8989bf88a8288f1b55a3cc371af53c07b0faa220a63bd7a990cfaba078`. Nobudget omitted `thinking_budget_tokens`, with the v2c prompt/tools/app-loop/sampler/server setup, over 60 rows.

| cell | bake-off deterministic | en | it | es | fr | wild |
|---|---:|---:|---:|---:|---:|---:|
| Q8_0 nobudget | 31/44 (70%) | 10/11 | 8/11 | 8/11 | 5/11 | 16 rubric |
| Q4_K_M v2c nobudget | 33/44 (75%) | 9/11 | 8/11 | 8/11 | 8/11 | 16 rubric |

Reasoning tokens (total `timings.predicted_n` minus exact `/tokenize` visible tokens): Q8 median/p90/max `156.5/528.0/1540`; Q4 v2c `186.5/717.1/3751`. Q8 empty/bare-`>` model answers `0/60` and `0/60`; median wall `8742 ms`. Outputs: `results/wild-v2d/`, `results/bakeoff-v2d/`; score `results/score-v2d-q8-nobudget.txt`; blind pack/key `results/judge-pack-v2d-q8.jsonl` and `results/judge-key-v2d-q8.json`. No judging; run/score/pack/validation rc=0; server stopped.

## v2d blind judging (2026-09-09 ~18:00 EDT)

MiniCPM5 **Q8_0**, unbounded thinking, vs LFM v2b-merged (Q4_0, budget 256/512), 60 rows, fresh A/B (`results/judge-key-v2d-q8.json`). Judge files `judge-A-deepseek-v2d-q8.jsonl`, `judge-B-mimo-v2d-q8.jsonl`.

| judge | LFM | MiniCPM5-Q8 | tie | mean LFM | mean MiniCPM5 | bake-off (44) | wild (16) |
|---|---|---|---|---|---|---|---|
| deepseek | 24 | 16 | 20 | 3.53 | 3.35 | 15/13/16 | 9/3/4 |
| mimo | 26 | 13 | 21 | 3.62 | 3.27 | 17/9/18 | 9/4/3 |

Against the Q4_K_M unbounded cell (26/17/17, 24/15/21) the 8-bit model moves nothing outside noise; deterministic is 31/44 vs 33/44. Quantisation is REFUTED as the cause of MiniCPM5's loss; the same failure classes recur at Q8 (Lirinda, "Sahara Solar", Lorenzo de' Medici, garbled German in W08). Conclusion of the v2b→v2d chain: on this corpus, with the app's prompt and tool loop, LFM2.5-2.6B beats MiniCPM5-2B on assistant behaviour (honesty, language fidelity, offline-tool handling) independently of thinking budget and of quantisation. What remains model-side for MiniCPM5 is post-training, i.e. fine-tuning (Apache 2.0), which the owner has placed after G1.

## Thinking budget per model (data)

## Budget mechanism
- The v2 clients send `thinking_budget_tokens` per completion: `run_bakeoff_v2.py:37`; wild uses the sampler unchanged in `run_corpus_v2.py:27-31`. There is no client-side truncation.
- The tool loop may issue three completions (`v2_tools.py:191-216`) and concatenates their reasoning, so a row total can exceed the request budget.
- The fork reads the field at `tools/server/server-common.cpp:1119`, but installs the sampler only when `thinking_end_tag` is non-empty (`:1124-1129`); `common/sampling.cpp:298-305` makes that budget the maximum reasoning-block count and forces the end tag when exhausted.
- Both models returned `reasoning_content`/`reasoning_text` in every effective v2 row; the server logs contain timings and slot releases but no request-body or budget-state trace. Per-round outputs therefore show the channel was parsed; the stored row totals are not hard caps.
- Tokenizing each raw v2 round showed per-request maxima of 257/513 for LFM @256/@512 and 255/511 for MiniCPM5 @256/@512: the sampler is active per request. Row totals exceed those values only because tool rounds are summed; v2@512 has no direct judge rows (the v2 pack judged @256 plus wild).
- `results/run-v2-lfm.log:4-5` and `results/run-v2-minicpm.log:4-5` show both 44-row cells completed with zero errors; `results/server-lfm.log` has no budget-state/request-body trace.
- For the later Mini cell, raw-round maxima were 1023/request and 3745/row at v2c @1024, versus stored-row max 3748: that apparent cap is a three-round total, not a 1024-token row cap.

## Per-model/cell distributions (model-tokenized reasoning)
| model | cell | n | median | p75 | p90 | p95 | max | >=256 | >=512 | >=1024 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| LFM | v2@256 | 44 | 326 | 483.5 | 599.9 | 648.6 | 848 | 64% | 20% | 0% |
| LFM | v2@512 | 44 | 331.5 | 519.5 | 681.0 | 787.0 | 1097 | 66% | 30% | 2% |
| LFM | v2-wild | 30 | 242 | 328.8 | 515.7 | 562.3 | 611 | 43% | 13% | 0% |
| MiniCPM5 | v2@256 | 44 | 213 | 295.2 | 441.3 | 474.7 | 743 | 34% | 2% | 0% |
| MiniCPM5 | v2@512 | 44 | 213 | 366.5 | 536.9 | 641.8 | 748 | 43% | 11% | 0% |
| MiniCPM5 | v2-wild | 30 | 171 | 255 | 255 | 292.4 | 374 | 7% | 0% | 0% |
| MiniCPM5 | v2c-1024 | 60 | 155.5 | 424 | 661.7 | 708.1 | 3748 | 32% | 20% | 2% |
| MiniCPM5 | v2c-nobudget | 60 | 175 | 428.5 | 661.7 | 708.1 | 3751 | 37% | 20% | 2% |
| MiniCPM5 | v2d | 60 | 145.5 | 335.5 | 494.7 | 608.2 | 1506 | 33% | 10% | 3% |

Cut shares use total stored reasoning tokens; `>=` is the threshold.

## Category/language distributions
| model | cell | category | lang | n | median | p75 | p90 | p95 | max | >=256 | >=512 | >=1024 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| LFM | v2-wild | absurd | en | 6 | 238.5 | 284 | 396.5 | 448.2 | 500 | 50% | 0% | 0% |
| LFM | v2-wild | absurd | it | 6 | 257 | 449.8 | 522.5 | 526.8 | 531 | 67% | 33% | 0% |
| LFM | v2-wild | multilingual | de | 3 | 167 | 377.5 | 503.8 | 545.9 | 588 | 33% | 33% | 0% |
| LFM | v2-wild | multilingual | es | 3 | 255 | 331.5 | 377.4 | 392.7 | 408 | 33% | 0% | 0% |
| LFM | v2-wild | multilingual | fr | 3 | 117 | 175.5 | 210.6 | 222.3 | 234 | 0% | 0% | 0% |
| LFM | v2-wild | multilingual | ja | 3 | 229 | 420 | 534.6 | 572.8 | 611 | 33% | 33% | 0% |
| LFM | v2-wild | multilingual | pt | 3 | 161 | 327.5 | 427.4 | 460.7 | 494 | 33% | 0% | 0% |
| LFM | v2-wild | multilingual | zh | 3 | 316 | 324.5 | 329.6 | 331.3 | 333 | 67% | 0% | 0% |
| LFM | v2@256 | absurd_innocuous | en | 1 | 368 | 368 | 368 | 368 | 368 | 100% | 0% | 0% |
| LFM | v2@256 | absurd_innocuous | es | 1 | 239 | 239 | 239 | 239 | 239 | 0% | 0% | 0% |
| LFM | v2@256 | absurd_innocuous | fr | 1 | 293 | 293 | 293 | 293 | 293 | 100% | 0% | 0% |
| LFM | v2@256 | absurd_innocuous | it | 1 | 581 | 581 | 581 | 581 | 581 | 100% | 100% | 0% |
| LFM | v2@256 | arithmetic | en | 1 | 221 | 221 | 221 | 221 | 221 | 0% | 0% | 0% |
| LFM | v2@256 | arithmetic | es | 1 | 362 | 362 | 362 | 362 | 362 | 100% | 0% | 0% |
| LFM | v2@256 | arithmetic | fr | 1 | 232 | 232 | 232 | 232 | 232 | 0% | 0% | 0% |
| LFM | v2@256 | arithmetic | it | 1 | 276 | 276 | 276 | 276 | 276 | 100% | 0% | 0% |
| LFM | v2@256 | clarification | en | 1 | 421 | 421 | 421 | 421 | 421 | 100% | 0% | 0% |
| LFM | v2@256 | clarification | es | 1 | 771 | 771 | 771 | 771 | 771 | 100% | 100% | 0% |
| LFM | v2@256 | clarification | fr | 1 | 137 | 137 | 137 | 137 | 137 | 0% | 0% | 0% |
| LFM | v2@256 | clarification | it | 1 | 91 | 91 | 91 | 91 | 91 | 0% | 0% | 0% |
| LFM | v2@256 | counting | en | 1 | 228 | 228 | 228 | 228 | 228 | 0% | 0% | 0% |
| LFM | v2@256 | counting | es | 1 | 257 | 257 | 257 | 257 | 257 | 100% | 0% | 0% |
| LFM | v2@256 | counting | fr | 1 | 257 | 257 | 257 | 257 | 257 | 100% | 0% | 0% |
| LFM | v2@256 | counting | it | 1 | 514 | 514 | 514 | 514 | 514 | 100% | 100% | 0% |
| LFM | v2@256 | estimation | en | 1 | 848 | 848 | 848 | 848 | 848 | 100% | 100% | 0% |
| LFM | v2@256 | estimation | es | 1 | 629 | 629 | 629 | 629 | 629 | 100% | 100% | 0% |
| LFM | v2@256 | estimation | fr | 1 | 652 | 652 | 652 | 652 | 652 | 100% | 100% | 0% |
| LFM | v2@256 | estimation | it | 1 | 473 | 473 | 473 | 473 | 473 | 100% | 0% | 0% |
| LFM | v2@256 | factual | en | 2 | 243.5 | 248.8 | 251.9 | 252.9 | 254 | 0% | 0% | 0% |
| LFM | v2@256 | factual | es | 2 | 381.5 | 424.2 | 449.9 | 458.4 | 467 | 100% | 0% | 0% |
| LFM | v2@256 | factual | fr | 2 | 371.5 | 374.8 | 376.7 | 377.4 | 378 | 100% | 0% | 0% |
| LFM | v2@256 | factual | it | 2 | 396.5 | 417.8 | 430.5 | 434.8 | 439 | 100% | 0% | 0% |
| LFM | v2@256 | false_premise | en | 1 | 307 | 307 | 307 | 307 | 307 | 100% | 0% | 0% |
| LFM | v2@256 | false_premise | es | 1 | 506 | 506 | 506 | 506 | 506 | 100% | 0% | 0% |
| LFM | v2@256 | false_premise | fr | 1 | 494 | 494 | 494 | 494 | 494 | 100% | 0% | 0% |
| LFM | v2@256 | false_premise | it | 1 | 608 | 608 | 608 | 608 | 608 | 100% | 100% | 0% |
| LFM | v2@256 | format | en | 1 | 79 | 79 | 79 | 79 | 79 | 0% | 0% | 0% |
| LFM | v2@256 | format | es | 1 | 169 | 169 | 169 | 169 | 169 | 0% | 0% | 0% |
| LFM | v2@256 | format | fr | 1 | 121 | 121 | 121 | 121 | 121 | 0% | 0% | 0% |
| LFM | v2@256 | format | it | 1 | 180 | 180 | 180 | 180 | 180 | 0% | 0% | 0% |
| LFM | v2@256 | honesty | en | 1 | 556 | 556 | 556 | 556 | 556 | 100% | 100% | 0% |
| LFM | v2@256 | honesty | es | 1 | 345 | 345 | 345 | 345 | 345 | 100% | 0% | 0% |
| LFM | v2@256 | honesty | fr | 1 | 480 | 480 | 480 | 480 | 480 | 100% | 0% | 0% |
| LFM | v2@256 | honesty | it | 1 | 522 | 522 | 522 | 522 | 522 | 100% | 100% | 0% |
| LFM | v2@256 | safety_true | en | 1 | 141 | 141 | 141 | 141 | 141 | 0% | 0% | 0% |
| LFM | v2@256 | safety_true | es | 1 | 125 | 125 | 125 | 125 | 125 | 0% | 0% | 0% |
| LFM | v2@256 | safety_true | fr | 1 | 126 | 126 | 126 | 126 | 126 | 0% | 0% | 0% |
| LFM | v2@256 | safety_true | it | 1 | 135 | 135 | 135 | 135 | 135 | 0% | 0% | 0% |
| LFM | v2@512 | absurd_innocuous | en | 1 | 368 | 368 | 368 | 368 | 368 | 100% | 0% | 0% |
| LFM | v2@512 | absurd_innocuous | es | 1 | 239 | 239 | 239 | 239 | 239 | 0% | 0% | 0% |
| LFM | v2@512 | absurd_innocuous | fr | 1 | 293 | 293 | 293 | 293 | 293 | 100% | 0% | 0% |
| LFM | v2@512 | absurd_innocuous | it | 1 | 573 | 573 | 573 | 573 | 573 | 100% | 100% | 0% |
| LFM | v2@512 | arithmetic | en | 1 | 221 | 221 | 221 | 221 | 221 | 0% | 0% | 0% |
| LFM | v2@512 | arithmetic | es | 1 | 618 | 618 | 618 | 618 | 618 | 100% | 100% | 0% |
| LFM | v2@512 | arithmetic | fr | 1 | 232 | 232 | 232 | 232 | 232 | 0% | 0% | 0% |
| LFM | v2@512 | arithmetic | it | 1 | 276 | 276 | 276 | 276 | 276 | 100% | 0% | 0% |
| LFM | v2@512 | clarification | en | 1 | 708 | 708 | 708 | 708 | 708 | 100% | 100% | 0% |
| LFM | v2@512 | clarification | es | 1 | 859 | 859 | 859 | 859 | 859 | 100% | 100% | 0% |
| LFM | v2@512 | clarification | fr | 1 | 137 | 137 | 137 | 137 | 137 | 0% | 0% | 0% |
| LFM | v2@512 | clarification | it | 1 | 91 | 91 | 91 | 91 | 91 | 0% | 0% | 0% |
| LFM | v2@512 | counting | en | 1 | 228 | 228 | 228 | 228 | 228 | 0% | 0% | 0% |
| LFM | v2@512 | counting | es | 1 | 351 | 351 | 351 | 351 | 351 | 100% | 0% | 0% |
| LFM | v2@512 | counting | fr | 1 | 293 | 293 | 293 | 293 | 293 | 100% | 0% | 0% |
| LFM | v2@512 | counting | it | 1 | 437 | 437 | 437 | 437 | 437 | 100% | 0% | 0% |
| LFM | v2@512 | estimation | en | 1 | 1097 | 1097 | 1097 | 1097 | 1097 | 100% | 100% | 100% |
| LFM | v2@512 | estimation | es | 1 | 468 | 468 | 468 | 468 | 468 | 100% | 0% | 0% |
| LFM | v2@512 | estimation | fr | 1 | 516 | 516 | 516 | 516 | 516 | 100% | 100% | 0% |
| LFM | v2@512 | estimation | it | 1 | 593 | 593 | 593 | 593 | 593 | 100% | 100% | 0% |
| LFM | v2@512 | factual | en | 2 | 263.5 | 268.2 | 271.1 | 272.1 | 273 | 50% | 0% | 0% |
| LFM | v2@512 | factual | es | 2 | 365 | 399.5 | 420.2 | 427.1 | 434 | 100% | 0% | 0% |
| LFM | v2@512 | factual | fr | 2 | 571 | 667.5 | 725.4 | 744.7 | 764 | 100% | 50% | 0% |
| LFM | v2@512 | factual | it | 2 | 294 | 312.5 | 323.6 | 327.3 | 331 | 100% | 0% | 0% |
| LFM | v2@512 | false_premise | en | 1 | 590 | 590 | 590 | 590 | 590 | 100% | 100% | 0% |
| LFM | v2@512 | false_premise | es | 1 | 537 | 537 | 537 | 537 | 537 | 100% | 100% | 0% |
| LFM | v2@512 | false_premise | fr | 1 | 518 | 518 | 518 | 518 | 518 | 100% | 100% | 0% |
| LFM | v2@512 | false_premise | it | 1 | 524 | 524 | 524 | 524 | 524 | 100% | 100% | 0% |
| LFM | v2@512 | format | en | 1 | 79 | 79 | 79 | 79 | 79 | 0% | 0% | 0% |
| LFM | v2@512 | format | es | 1 | 169 | 169 | 169 | 169 | 169 | 0% | 0% | 0% |
| LFM | v2@512 | format | fr | 1 | 121 | 121 | 121 | 121 | 121 | 0% | 0% | 0% |
| LFM | v2@512 | format | it | 1 | 180 | 180 | 180 | 180 | 180 | 0% | 0% | 0% |
| LFM | v2@512 | honesty | en | 1 | 791 | 791 | 791 | 791 | 791 | 100% | 100% | 0% |
| LFM | v2@512 | honesty | es | 1 | 345 | 345 | 345 | 345 | 345 | 100% | 0% | 0% |
| LFM | v2@512 | honesty | fr | 1 | 480 | 480 | 480 | 480 | 480 | 100% | 0% | 0% |
| LFM | v2@512 | honesty | it | 1 | 332 | 332 | 332 | 332 | 332 | 100% | 0% | 0% |
| LFM | v2@512 | safety_true | en | 1 | 141 | 141 | 141 | 141 | 141 | 0% | 0% | 0% |
| LFM | v2@512 | safety_true | es | 1 | 125 | 125 | 125 | 125 | 125 | 0% | 0% | 0% |
| LFM | v2@512 | safety_true | fr | 1 | 126 | 126 | 126 | 126 | 126 | 0% | 0% | 0% |
| LFM | v2@512 | safety_true | it | 1 | 135 | 135 | 135 | 135 | 135 | 0% | 0% | 0% |
| MiniCPM5 | v2-wild | absurd | en | 6 | 219 | 255 | 314.5 | 344.2 | 374 | 17% | 0% | 0% |
| MiniCPM5 | v2-wild | absurd | it | 6 | 228.5 | 252.5 | 255 | 255 | 255 | 0% | 0% | 0% |
| MiniCPM5 | v2-wild | multilingual | de | 3 | 196 | 225.5 | 243.2 | 249.1 | 255 | 0% | 0% | 0% |
| MiniCPM5 | v2-wild | multilingual | es | 3 | 67 | 161 | 217.4 | 236.2 | 255 | 0% | 0% | 0% |
| MiniCPM5 | v2-wild | multilingual | fr | 3 | 62 | 63.5 | 64.4 | 64.7 | 65 | 0% | 0% | 0% |
| MiniCPM5 | v2-wild | multilingual | ja | 3 | 58 | 190.5 | 270 | 296.5 | 323 | 33% | 0% | 0% |
| MiniCPM5 | v2-wild | multilingual | pt | 3 | 133 | 177 | 203.4 | 212.2 | 221 | 0% | 0% | 0% |
| MiniCPM5 | v2-wild | multilingual | zh | 3 | 255 | 255 | 255 | 255 | 255 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | absurd_innocuous | en | 1 | 467 | 467 | 467 | 467 | 467 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | absurd_innocuous | es | 1 | 492 | 492 | 492 | 492 | 492 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | absurd_innocuous | fr | 1 | 743 | 743 | 743 | 743 | 743 | 100% | 100% | 0% |
| MiniCPM5 | v2@256 | absurd_innocuous | it | 1 | 131 | 131 | 131 | 131 | 131 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | arithmetic | en | 1 | 106 | 106 | 106 | 106 | 106 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | arithmetic | es | 1 | 129 | 129 | 129 | 129 | 129 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | arithmetic | fr | 1 | 55 | 55 | 55 | 55 | 55 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | arithmetic | it | 1 | 175 | 175 | 175 | 175 | 175 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | clarification | en | 1 | 155 | 155 | 155 | 155 | 155 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | clarification | es | 1 | 336 | 336 | 336 | 336 | 336 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | clarification | fr | 1 | 55 | 55 | 55 | 55 | 55 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | clarification | it | 1 | 59 | 59 | 59 | 59 | 59 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | counting | en | 1 | 87 | 87 | 87 | 87 | 87 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | counting | es | 1 | 134 | 134 | 134 | 134 | 134 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | counting | fr | 1 | 150 | 150 | 150 | 150 | 150 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | counting | it | 1 | 107 | 107 | 107 | 107 | 107 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | estimation | en | 1 | 255 | 255 | 255 | 255 | 255 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | estimation | es | 1 | 293 | 293 | 293 | 293 | 293 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | estimation | fr | 1 | 110 | 110 | 110 | 110 | 110 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | estimation | it | 1 | 114 | 114 | 114 | 114 | 114 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | factual | en | 2 | 243 | 346.5 | 408.6 | 429.3 | 450 | 50% | 0% | 0% |
| MiniCPM5 | v2@256 | factual | es | 2 | 287 | 296 | 301.4 | 303.2 | 305 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | factual | fr | 2 | 271 | 286.5 | 295.8 | 298.9 | 302 | 50% | 0% | 0% |
| MiniCPM5 | v2@256 | factual | it | 2 | 274.5 | 295.8 | 308.5 | 312.8 | 317 | 50% | 0% | 0% |
| MiniCPM5 | v2@256 | false_premise | en | 1 | 366 | 366 | 366 | 366 | 366 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | false_premise | es | 1 | 421 | 421 | 421 | 421 | 421 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | false_premise | fr | 1 | 255 | 255 | 255 | 255 | 255 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | false_premise | it | 1 | 255 | 255 | 255 | 255 | 255 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | format | en | 1 | 33 | 33 | 33 | 33 | 33 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | format | es | 1 | 38 | 38 | 38 | 38 | 38 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | format | fr | 1 | 35 | 35 | 35 | 35 | 35 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | format | it | 1 | 66 | 66 | 66 | 66 | 66 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | honesty | en | 1 | 279 | 279 | 279 | 279 | 279 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | honesty | es | 1 | 283 | 283 | 283 | 283 | 283 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | honesty | fr | 1 | 476 | 476 | 476 | 476 | 476 | 100% | 0% | 0% |
| MiniCPM5 | v2@256 | honesty | it | 1 | 241 | 241 | 241 | 241 | 241 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | safety_true | en | 1 | 255 | 255 | 255 | 255 | 255 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | safety_true | es | 1 | 123 | 123 | 123 | 123 | 123 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | safety_true | fr | 1 | 188 | 188 | 188 | 188 | 188 | 0% | 0% | 0% |
| MiniCPM5 | v2@256 | safety_true | it | 1 | 194 | 194 | 194 | 194 | 194 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | absurd_innocuous | en | 1 | 629 | 629 | 629 | 629 | 629 | 100% | 100% | 0% |
| MiniCPM5 | v2@512 | absurd_innocuous | es | 1 | 748 | 748 | 748 | 748 | 748 | 100% | 100% | 0% |
| MiniCPM5 | v2@512 | absurd_innocuous | fr | 1 | 681 | 681 | 681 | 681 | 681 | 100% | 100% | 0% |
| MiniCPM5 | v2@512 | absurd_innocuous | it | 1 | 131 | 131 | 131 | 131 | 131 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | arithmetic | en | 1 | 106 | 106 | 106 | 106 | 106 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | arithmetic | es | 1 | 129 | 129 | 129 | 129 | 129 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | arithmetic | fr | 1 | 55 | 55 | 55 | 55 | 55 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | arithmetic | it | 1 | 175 | 175 | 175 | 175 | 175 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | clarification | en | 1 | 155 | 155 | 155 | 155 | 155 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | clarification | es | 1 | 336 | 336 | 336 | 336 | 336 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | clarification | fr | 1 | 55 | 55 | 55 | 55 | 55 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | clarification | it | 1 | 59 | 59 | 59 | 59 | 59 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | counting | en | 1 | 87 | 87 | 87 | 87 | 87 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | counting | es | 1 | 134 | 134 | 134 | 134 | 134 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | counting | fr | 1 | 150 | 150 | 150 | 150 | 150 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | counting | it | 1 | 107 | 107 | 107 | 107 | 107 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | estimation | en | 1 | 511 | 511 | 511 | 511 | 511 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | estimation | es | 1 | 364 | 364 | 364 | 364 | 364 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | estimation | fr | 1 | 110 | 110 | 110 | 110 | 110 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | estimation | it | 1 | 114 | 114 | 114 | 114 | 114 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | factual | en | 2 | 179 | 250.5 | 293.4 | 307.7 | 322 | 50% | 0% | 0% |
| MiniCPM5 | v2@512 | factual | es | 2 | 318.5 | 343.2 | 358.1 | 363.1 | 368 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | factual | fr | 2 | 334.5 | 381.8 | 410.1 | 419.5 | 429 | 50% | 0% | 0% |
| MiniCPM5 | v2@512 | factual | it | 2 | 260 | 274 | 282.4 | 285.2 | 288 | 50% | 0% | 0% |
| MiniCPM5 | v2@512 | false_premise | en | 1 | 366 | 366 | 366 | 366 | 366 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | false_premise | es | 1 | 421 | 421 | 421 | 421 | 421 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | false_premise | fr | 1 | 361 | 361 | 361 | 361 | 361 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | false_premise | it | 1 | 349 | 349 | 349 | 349 | 349 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | format | en | 1 | 33 | 33 | 33 | 33 | 33 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | format | es | 1 | 38 | 38 | 38 | 38 | 38 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | format | fr | 1 | 35 | 35 | 35 | 35 | 35 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | format | it | 1 | 66 | 66 | 66 | 66 | 66 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | honesty | en | 1 | 644 | 644 | 644 | 644 | 644 | 100% | 100% | 0% |
| MiniCPM5 | v2@512 | honesty | es | 1 | 380 | 380 | 380 | 380 | 380 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | honesty | fr | 1 | 548 | 548 | 548 | 548 | 548 | 100% | 100% | 0% |
| MiniCPM5 | v2@512 | honesty | it | 1 | 241 | 241 | 241 | 241 | 241 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | safety_true | en | 1 | 511 | 511 | 511 | 511 | 511 | 100% | 0% | 0% |
| MiniCPM5 | v2@512 | safety_true | es | 1 | 123 | 123 | 123 | 123 | 123 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | safety_true | fr | 1 | 188 | 188 | 188 | 188 | 188 | 0% | 0% | 0% |
| MiniCPM5 | v2@512 | safety_true | it | 1 | 194 | 194 | 194 | 194 | 194 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | absurd | en | 2 | 139.5 | 148.2 | 153.5 | 155.2 | 157 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | absurd | it | 2 | 167.5 | 197.8 | 215.9 | 221.9 | 228 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | absurd_innocuous | en | 1 | 528 | 528 | 528 | 528 | 528 | 100% | 100% | 0% |
| MiniCPM5 | v2c-1024 | absurd_innocuous | es | 1 | 535 | 535 | 535 | 535 | 535 | 100% | 100% | 0% |
| MiniCPM5 | v2c-1024 | absurd_innocuous | fr | 1 | 686 | 686 | 686 | 686 | 686 | 100% | 100% | 0% |
| MiniCPM5 | v2c-1024 | absurd_innocuous | it | 1 | 91 | 91 | 91 | 91 | 91 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | arithmetic | en | 1 | 151 | 151 | 151 | 151 | 151 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | arithmetic | es | 1 | 85 | 85 | 85 | 85 | 85 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | arithmetic | fr | 1 | 55 | 55 | 55 | 55 | 55 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | arithmetic | it | 1 | 115 | 115 | 115 | 115 | 115 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | clarification | en | 1 | 176 | 176 | 176 | 176 | 176 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | clarification | es | 1 | 53 | 53 | 53 | 53 | 53 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | clarification | fr | 1 | 560 | 560 | 560 | 560 | 560 | 100% | 100% | 0% |
| MiniCPM5 | v2c-1024 | clarification | it | 1 | 154 | 154 | 154 | 154 | 154 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | counting | en | 1 | 90 | 90 | 90 | 90 | 90 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | counting | es | 1 | 150 | 150 | 150 | 150 | 150 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | counting | fr | 1 | 84 | 84 | 84 | 84 | 84 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | counting | it | 1 | 234 | 234 | 234 | 234 | 234 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | estimation | en | 1 | 3748 | 3748 | 3748 | 3748 | 3748 | 100% | 100% | 100% |
| MiniCPM5 | v2c-1024 | estimation | es | 1 | 703 | 703 | 703 | 703 | 703 | 100% | 100% | 0% |
| MiniCPM5 | v2c-1024 | estimation | fr | 1 | 430 | 430 | 430 | 430 | 430 | 100% | 0% | 0% |
| MiniCPM5 | v2c-1024 | estimation | it | 1 | 111 | 111 | 111 | 111 | 111 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | factual | en | 2 | 497.5 | 731.2 | 871.5 | 918.2 | 965 | 50% | 50% | 0% |
| MiniCPM5 | v2c-1024 | factual | es | 2 | 484.5 | 644.8 | 740.9 | 772.9 | 805 | 50% | 50% | 0% |
| MiniCPM5 | v2c-1024 | factual | fr | 2 | 614 | 636.5 | 650 | 654.5 | 659 | 100% | 100% | 0% |
| MiniCPM5 | v2c-1024 | factual | it | 2 | 292.5 | 343.8 | 374.5 | 384.8 | 395 | 50% | 0% | 0% |
| MiniCPM5 | v2c-1024 | false_premise | en | 1 | 509 | 509 | 509 | 509 | 509 | 100% | 0% | 0% |
| MiniCPM5 | v2c-1024 | false_premise | es | 1 | 641 | 641 | 641 | 641 | 641 | 100% | 100% | 0% |
| MiniCPM5 | v2c-1024 | false_premise | fr | 1 | 463 | 463 | 463 | 463 | 463 | 100% | 0% | 0% |
| MiniCPM5 | v2c-1024 | false_premise | it | 1 | 695 | 695 | 695 | 695 | 695 | 100% | 100% | 0% |
| MiniCPM5 | v2c-1024 | format | en | 1 | 26 | 26 | 26 | 26 | 26 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | format | es | 1 | 38 | 38 | 38 | 38 | 38 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | format | fr | 1 | 43 | 43 | 43 | 43 | 43 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | format | it | 1 | 63 | 63 | 63 | 63 | 63 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | honesty | en | 1 | 422 | 422 | 422 | 422 | 422 | 100% | 0% | 0% |
| MiniCPM5 | v2c-1024 | honesty | es | 1 | 91 | 91 | 91 | 91 | 91 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | honesty | fr | 1 | 309 | 309 | 309 | 309 | 309 | 100% | 0% | 0% |
| MiniCPM5 | v2c-1024 | honesty | it | 1 | 244 | 244 | 244 | 244 | 244 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | multilingual | de | 2 | 139.5 | 161.2 | 174.3 | 178.6 | 183 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | multilingual | es | 2 | 85 | 101 | 110.6 | 113.8 | 117 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | multilingual | fr | 2 | 248 | 334.5 | 386.4 | 403.7 | 421 | 50% | 0% | 0% |
| MiniCPM5 | v2c-1024 | multilingual | ja | 2 | 49.5 | 59.2 | 65.1 | 67.0 | 69 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | multilingual | pt | 2 | 81.5 | 106.2 | 121.1 | 126.0 | 131 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | multilingual | zh | 2 | 79 | 97.5 | 108.6 | 112.3 | 116 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | safety_true | en | 1 | 159 | 159 | 159 | 159 | 159 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | safety_true | es | 1 | 173 | 173 | 173 | 173 | 173 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | safety_true | fr | 1 | 174 | 174 | 174 | 174 | 174 | 0% | 0% | 0% |
| MiniCPM5 | v2c-1024 | safety_true | it | 1 | 125 | 125 | 125 | 125 | 125 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | absurd | en | 2 | 172 | 193.5 | 206.4 | 210.7 | 215 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | absurd | it | 2 | 196 | 225 | 242.4 | 248.2 | 254 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | absurd_innocuous | en | 1 | 528 | 528 | 528 | 528 | 528 | 100% | 100% | 0% |
| MiniCPM5 | v2c-nobudget | absurd_innocuous | es | 1 | 535 | 535 | 535 | 535 | 535 | 100% | 100% | 0% |
| MiniCPM5 | v2c-nobudget | absurd_innocuous | fr | 1 | 686 | 686 | 686 | 686 | 686 | 100% | 100% | 0% |
| MiniCPM5 | v2c-nobudget | absurd_innocuous | it | 1 | 91 | 91 | 91 | 91 | 91 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | arithmetic | en | 1 | 151 | 151 | 151 | 151 | 151 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | arithmetic | es | 1 | 85 | 85 | 85 | 85 | 85 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | arithmetic | fr | 1 | 55 | 55 | 55 | 55 | 55 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | arithmetic | it | 1 | 115 | 115 | 115 | 115 | 115 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | clarification | en | 1 | 176 | 176 | 176 | 176 | 176 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | clarification | es | 1 | 53 | 53 | 53 | 53 | 53 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | clarification | fr | 1 | 560 | 560 | 560 | 560 | 560 | 100% | 100% | 0% |
| MiniCPM5 | v2c-nobudget | clarification | it | 1 | 154 | 154 | 154 | 154 | 154 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | counting | en | 1 | 90 | 90 | 90 | 90 | 90 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | counting | es | 1 | 150 | 150 | 150 | 150 | 150 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | counting | fr | 1 | 84 | 84 | 84 | 84 | 84 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | counting | it | 1 | 234 | 234 | 234 | 234 | 234 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | estimation | en | 1 | 3751 | 3751 | 3751 | 3751 | 3751 | 100% | 100% | 100% |
| MiniCPM5 | v2c-nobudget | estimation | es | 1 | 703 | 703 | 703 | 703 | 703 | 100% | 100% | 0% |
| MiniCPM5 | v2c-nobudget | estimation | fr | 1 | 430 | 430 | 430 | 430 | 430 | 100% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | estimation | it | 1 | 111 | 111 | 111 | 111 | 111 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | factual | en | 2 | 497.5 | 731.2 | 871.5 | 918.2 | 965 | 50% | 50% | 0% |
| MiniCPM5 | v2c-nobudget | factual | es | 2 | 484.5 | 644.8 | 740.9 | 772.9 | 805 | 50% | 50% | 0% |
| MiniCPM5 | v2c-nobudget | factual | fr | 2 | 614 | 636.5 | 650 | 654.5 | 659 | 100% | 100% | 0% |
| MiniCPM5 | v2c-nobudget | factual | it | 2 | 292.5 | 343.8 | 374.5 | 384.8 | 395 | 50% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | false_premise | en | 1 | 509 | 509 | 509 | 509 | 509 | 100% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | false_premise | es | 1 | 641 | 641 | 641 | 641 | 641 | 100% | 100% | 0% |
| MiniCPM5 | v2c-nobudget | false_premise | fr | 1 | 463 | 463 | 463 | 463 | 463 | 100% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | false_premise | it | 1 | 695 | 695 | 695 | 695 | 695 | 100% | 100% | 0% |
| MiniCPM5 | v2c-nobudget | format | en | 1 | 26 | 26 | 26 | 26 | 26 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | format | es | 1 | 38 | 38 | 38 | 38 | 38 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | format | fr | 1 | 43 | 43 | 43 | 43 | 43 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | format | it | 1 | 63 | 63 | 63 | 63 | 63 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | honesty | en | 1 | 422 | 422 | 422 | 422 | 422 | 100% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | honesty | es | 1 | 91 | 91 | 91 | 91 | 91 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | honesty | fr | 1 | 309 | 309 | 309 | 309 | 309 | 100% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | honesty | it | 1 | 244 | 244 | 244 | 244 | 244 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | multilingual | de | 2 | 109 | 122 | 129.8 | 132.4 | 135 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | multilingual | es | 2 | 166 | 210.5 | 237.2 | 246.1 | 255 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | multilingual | fr | 2 | 104 | 140.5 | 162.4 | 169.7 | 177 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | multilingual | ja | 2 | 404.5 | 416.2 | 423.3 | 425.6 | 428 | 100% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | multilingual | pt | 2 | 162 | 219 | 253.2 | 264.6 | 276 | 50% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | multilingual | zh | 2 | 233.5 | 315.2 | 364.3 | 380.6 | 397 | 50% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | safety_true | en | 1 | 159 | 159 | 159 | 159 | 159 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | safety_true | es | 1 | 173 | 173 | 173 | 173 | 173 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | safety_true | fr | 1 | 174 | 174 | 174 | 174 | 174 | 0% | 0% | 0% |
| MiniCPM5 | v2c-nobudget | safety_true | it | 1 | 125 | 125 | 125 | 125 | 125 | 0% | 0% | 0% |
| MiniCPM5 | v2d | absurd | en | 2 | 190 | 219 | 236.4 | 242.2 | 248 | 0% | 0% | 0% |
| MiniCPM5 | v2d | absurd | it | 2 | 156 | 169.5 | 177.6 | 180.3 | 183 | 0% | 0% | 0% |
| MiniCPM5 | v2d | absurd_innocuous | en | 1 | 395 | 395 | 395 | 395 | 395 | 100% | 0% | 0% |
| MiniCPM5 | v2d | absurd_innocuous | es | 1 | 229 | 229 | 229 | 229 | 229 | 0% | 0% | 0% |
| MiniCPM5 | v2d | absurd_innocuous | fr | 1 | 381 | 381 | 381 | 381 | 381 | 100% | 0% | 0% |
| MiniCPM5 | v2d | absurd_innocuous | it | 1 | 117 | 117 | 117 | 117 | 117 | 0% | 0% | 0% |
| MiniCPM5 | v2d | arithmetic | en | 1 | 80 | 80 | 80 | 80 | 80 | 0% | 0% | 0% |
| MiniCPM5 | v2d | arithmetic | es | 1 | 103 | 103 | 103 | 103 | 103 | 0% | 0% | 0% |
| MiniCPM5 | v2d | arithmetic | fr | 1 | 88 | 88 | 88 | 88 | 88 | 0% | 0% | 0% |
| MiniCPM5 | v2d | arithmetic | it | 1 | 291 | 291 | 291 | 291 | 291 | 100% | 0% | 0% |
| MiniCPM5 | v2d | clarification | en | 1 | 48 | 48 | 48 | 48 | 48 | 0% | 0% | 0% |
| MiniCPM5 | v2d | clarification | es | 1 | 188 | 188 | 188 | 188 | 188 | 0% | 0% | 0% |
| MiniCPM5 | v2d | clarification | fr | 1 | 139 | 139 | 139 | 139 | 139 | 0% | 0% | 0% |
| MiniCPM5 | v2d | clarification | it | 1 | 165 | 165 | 165 | 165 | 165 | 0% | 0% | 0% |
| MiniCPM5 | v2d | counting | en | 1 | 48 | 48 | 48 | 48 | 48 | 0% | 0% | 0% |
| MiniCPM5 | v2d | counting | es | 1 | 114 | 114 | 114 | 114 | 114 | 0% | 0% | 0% |
| MiniCPM5 | v2d | counting | fr | 1 | 84 | 84 | 84 | 84 | 84 | 0% | 0% | 0% |
| MiniCPM5 | v2d | counting | it | 1 | 132 | 132 | 132 | 132 | 132 | 0% | 0% | 0% |
| MiniCPM5 | v2d | estimation | en | 1 | 355 | 355 | 355 | 355 | 355 | 100% | 0% | 0% |
| MiniCPM5 | v2d | estimation | es | 1 | 1120 | 1120 | 1120 | 1120 | 1120 | 100% | 100% | 100% |
| MiniCPM5 | v2d | estimation | fr | 1 | 1506 | 1506 | 1506 | 1506 | 1506 | 100% | 100% | 100% |
| MiniCPM5 | v2d | estimation | it | 1 | 123 | 123 | 123 | 123 | 123 | 0% | 0% | 0% |
| MiniCPM5 | v2d | factual | en | 2 | 323 | 464.5 | 549.4 | 577.7 | 606 | 50% | 50% | 0% |
| MiniCPM5 | v2d | factual | es | 2 | 571.5 | 611.2 | 635.1 | 643.0 | 651 | 100% | 50% | 0% |
| MiniCPM5 | v2d | factual | fr | 2 | 429.5 | 477.2 | 505.9 | 515.5 | 525 | 100% | 50% | 0% |
| MiniCPM5 | v2d | factual | it | 2 | 360.5 | 425.8 | 464.9 | 477.9 | 491 | 50% | 0% | 0% |
| MiniCPM5 | v2d | false_premise | en | 1 | 275 | 275 | 275 | 275 | 275 | 100% | 0% | 0% |
| MiniCPM5 | v2d | false_premise | es | 1 | 307 | 307 | 307 | 307 | 307 | 100% | 0% | 0% |
| MiniCPM5 | v2d | false_premise | fr | 1 | 248 | 248 | 248 | 248 | 248 | 0% | 0% | 0% |
| MiniCPM5 | v2d | false_premise | it | 1 | 367 | 367 | 367 | 367 | 367 | 100% | 0% | 0% |
| MiniCPM5 | v2d | format | en | 1 | 38 | 38 | 38 | 38 | 38 | 0% | 0% | 0% |
| MiniCPM5 | v2d | format | es | 1 | 32 | 32 | 32 | 32 | 32 | 0% | 0% | 0% |
| MiniCPM5 | v2d | format | fr | 1 | 41 | 41 | 41 | 41 | 41 | 0% | 0% | 0% |
| MiniCPM5 | v2d | format | it | 1 | 70 | 70 | 70 | 70 | 70 | 0% | 0% | 0% |
| MiniCPM5 | v2d | honesty | en | 1 | 340 | 340 | 340 | 340 | 340 | 100% | 0% | 0% |
| MiniCPM5 | v2d | honesty | es | 1 | 188 | 188 | 188 | 188 | 188 | 0% | 0% | 0% |
| MiniCPM5 | v2d | honesty | fr | 1 | 296 | 296 | 296 | 296 | 296 | 100% | 0% | 0% |
| MiniCPM5 | v2d | honesty | it | 1 | 393 | 393 | 393 | 393 | 393 | 100% | 0% | 0% |
| MiniCPM5 | v2d | multilingual | de | 2 | 301 | 410 | 475.4 | 497.2 | 519 | 50% | 50% | 0% |
| MiniCPM5 | v2d | multilingual | es | 2 | 101.5 | 126.2 | 141.1 | 146.1 | 151 | 0% | 0% | 0% |
| MiniCPM5 | v2d | multilingual | fr | 2 | 84.5 | 96.2 | 103.3 | 105.7 | 108 | 0% | 0% | 0% |
| MiniCPM5 | v2d | multilingual | ja | 2 | 51 | 55.5 | 58.2 | 59.1 | 60 | 0% | 0% | 0% |
| MiniCPM5 | v2d | multilingual | pt | 2 | 86.5 | 113.2 | 129.3 | 134.6 | 140 | 0% | 0% | 0% |
| MiniCPM5 | v2d | multilingual | zh | 2 | 228 | 315.5 | 368 | 385.5 | 403 | 50% | 0% | 0% |
| MiniCPM5 | v2d | safety_true | en | 1 | 192 | 192 | 192 | 192 | 192 | 0% | 0% | 0% |
| MiniCPM5 | v2d | safety_true | es | 1 | 65 | 65 | 65 | 65 | 65 | 0% | 0% | 0% |
| MiniCPM5 | v2d | safety_true | fr | 1 | 131 | 131 | 131 | 131 | 131 | 0% | 0% | 0% |
| MiniCPM5 | v2d | safety_true | it | 1 | 99 | 99 | 99 | 99 | 99 | 0% | 0% | 0% |

## Tokenizer versus reasoning_tokens field
| model | cell | rows | field_n | exact | median delta | max abs delta |
|---|---|---:|---:|---:|---:|---:|
| LFM | v2@256 | 44 | 0 | 0 | — | — |
| LFM | v2@512 | 44 | 0 | 0 | — | — |
| LFM | v2-wild | 30 | 0 | 0 | — | — |
| LFM | v2c-1024 | 0 | 0 | 0 | — | — |
| LFM | v2c-nobudget | 0 | 0 | 0 | — | — |
| LFM | v2d | 0 | 0 | 0 | — | — |
| MiniCPM5 | v2@256 | 44 | 0 | 0 | — | — |
| MiniCPM5 | v2@512 | 44 | 0 | 0 | — | — |
| MiniCPM5 | v2-wild | 30 | 0 | 0 | — | — |
| MiniCPM5 | v2c-1024 | 60 | 60 | 0 | -3 | 73 |
| MiniCPM5 | v2c-nobudget | 60 | 60 | 1 | -3 | 73 |
| MiniCPM5 | v2d | 60 | 60 | 0 | -3 | 101 |

## Judged loss rate by threshold bucket (n is judge verdicts)
| model | cell | threshold | above n/loss | below n/loss |
|---|---|---:|---:|---:|
| LFM | v2@256 | 256 | 56/32% | 32/10% |
| LFM | v2@256 | 512 | 18/46% | 70/19% |
| LFM | v2@256 | 1024 | 0/— | 88/25% |
| LFM | v2-wild | 256 | 16/27% | 16/56% |
| LFM | v2-wild | 512 | 6/33% | 26/44% |
| LFM | v2-wild | 1024 | 0/— | 32/42% |
| MiniCPM5 | v2@256 | 256 | 30/69% | 58/80% |
| MiniCPM5 | v2@256 | 512 | 2/50% | 86/76% |
| MiniCPM5 | v2@256 | 1024 | 0/— | 88/75% |
| MiniCPM5 | v2-wild | 256 | 2/100% | 30/55% |
| MiniCPM5 | v2-wild | 512 | 0/— | 32/58% |
| MiniCPM5 | v2-wild | 1024 | 0/— | 32/58% |
| MiniCPM5 | v2c-1024 | 256 | 38/62% | 82/69% |
| MiniCPM5 | v2c-1024 | 512 | 24/74% | 96/64% |
| MiniCPM5 | v2c-1024 | 1024 | 2/0% | 118/67% |
| MiniCPM5 | v2c-nobudget | 256 | 44/63% | 76/60% |
| MiniCPM5 | v2c-nobudget | 512 | 24/74% | 96/57% |
| MiniCPM5 | v2c-nobudget | 1024 | 2/0% | 118/62% |
| MiniCPM5 | v2d | 256 | 40/52% | 80/70% |
| MiniCPM5 | v2d | 512 | 12/64% | 108/63% |
| MiniCPM5 | v2d | 1024 | 4/50% | 116/64% |

### Recommendations

LFM: the effective v2 distribution is observed total reasoning across tool rounds, not a hard per-row cap. The per-request sampler is active, but the observed p90 is 600 tokens at @256 and 681 at @512 (v2@256/v2@512), so a product cap should be at least about 700 tokens for this workload or must be enforced app-side. The data does not support preferring 256.

MiniCPM5: the effective v2 p90 is 441 tokens at @256 and 537 at @512; v2c reaches 662 at both 1024 and unbounded, while Q8 v2d is 495. The sampler is active per request, but no single budget is validated by a paired 256-versus-512 judge; use no fixed recommendation until that comparison is run.

## v2e: LFM thinking budget 1024 / unbounded

The parameterized `run_v2e.sh` reused `run_v2c.py`, with the LFM QAD-Q4_0 model path and separate output directories. Each cell has the same 60 judged rows: 44 bake-off plus 16 wild. The runner's `reasoning_tokens` is derived from summed server `timings.predicted_n` minus visible-answer tokens across tool rounds.

| cell | rows | reasoning median/p75/p90/p95/max | wall ms median/p90/max |
|---|---:|---|---|
| LFM @1024 | 60 | 317/552.8/780.3/918.6/2294 | 14708/32753/57806 |
| LFM unbounded | 60 | 318/552.8/870.2/1251.7/2294 | 14029/31820/55781 |

For the effective LFM v2 baseline selection (v2 @256 with v2b substitutions plus the same 16 wild rows), 36/60 rows reached the 256-token total-reasoning threshold. At v2e @1024, 2/60 reached the 1024-token threshold; unbounded reached 4/60, but has no cap. These are row totals, not per-round hard caps.

Deterministic bake-off scores were 36/44 (82%) for both @1024 and unbounded; the 16 wild rows are rubric-only and excluded. Combined wall-time and reasoning distributions above use all 60 rows. No judging was performed here.

Blind packs: `results/judge-pack-v2e-1024.jsonl` with `results/judge-key-v2e-1024.json`; `results/judge-pack-v2e-nobudget.jsonl` with `results/judge-key-v2e-nobudget.json`. Raw runs are in `results/bakeoff-v2e-{1024,nobudget}/` and `results/wild-v2e-{1024,nobudget}/`.

## v2e blind judging (LFM budget 256 vs 1024 / unbounded)

Judges: A = GLM 5.3 flash (openrouter), B = GPT-5.6 Luna (codex); deepseek/mimo out of quota. Per-row randomised
A/B, keys `judge-key-v2e-{1024,nobudget}.json`, outputs `judge-{A-glm,B-luna}-v2e-*.jsonl`, unblinded 10/09 00:05.

| cell | judge | wins 256 (v2b-merged) | wins v2e | ties | mean 256 / v2e |
|---|---|---:|---:|---:|---|
| 1024 | GLM | 11 | 17 | 32 | 3.57 / 3.77 |
| 1024 | Luna | 14 | 22 | 24 | 3.45 / 3.68 |
| unbounded | GLM | 12 | 16 | 32 | 3.55 / 3.73 |
| unbounded | Luna | 13 | 21 | 26 | 3.47 / 3.68 |

Deterministic: 36/44 at 1024 and unbounded vs 34/44 at 256. Reasoning tokens per row at 1024: median 317, p90 780,
max 2294 (2/60 rows reach 1024); at 256 (per-request cap, multi-round rows sum): median 326, p90 600. Reading: a
larger budget helps LFM modestly and consistently (+6 to +8 net wins of 60 per judge, +0.2 mean); the cost is decode
time on the phone (~+180 reasoning tokens at p90 ≈ +60 s on the Jelly at 3 tok/s, +20 s on the S23). Decision for
the owner (PLAN "Aperti"): budget per model chosen on this trade-off, not inherited from Qwen.
