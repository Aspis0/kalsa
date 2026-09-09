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
