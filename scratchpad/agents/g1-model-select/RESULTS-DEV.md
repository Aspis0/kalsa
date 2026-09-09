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
