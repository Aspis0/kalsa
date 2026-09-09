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
