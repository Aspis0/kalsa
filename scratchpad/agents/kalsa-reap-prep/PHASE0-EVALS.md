# Phase 0, item 3 — the missing evals are in the gate (2026-10-01)

Implements DESIGN.md §4 item 3: HumanEval+ pass@1 with execution, FLORES-200
devtest EN→{IT,FR,ES,ZH} chrF++ + wrong-language rate, GSM8K-Italian 100
items; plus the two known-bug fixes (`30_gate.sh` bpb overrides, GSM8K cap
4096→8192) and the S1 stop-rule check. Everything proven end to end on this
Mac with `~/kalsa-models/LFM2.5-1.2B-Instruct-Q4_K_M.gguf` on 10-item slices
— real server, real outputs, real exit codes. No pod, no cloud, no spend.

## Files (all in `eval/` unless noted)

| file | what |
|---|---|
| `build_humaneval_holdout.py` | downloads evalplus/humanevalplus @ `d32357cf` (164 problems, tests = base+plus merged), drops `canonical_solution`, writes `humaneval-164.jsonl` — **11.4 MB, NOT committed** (> 5 MB rule; `eval/.gitignore`), rebuild with one command |
| `build_flores_holdout.py` | first 100 devtest sentences × {eng,ita,fra,spa,zho_Hans}, sha256-verified against the v3 corpus pins before writing; `flores-devtest-100.jsonl` (107 KB, committed) |
| `build_gsm8kit_holdout.py` | seed-42 sample of 100 from Eurolingua/gsm8kx `gsm8k_IT_test.jsonl` (test split); `gsm8kit-100.jsonl` (45 KB, committed) |
| `fetch_lid176.sh` | downloads fastText lid.176.bin (131,266,198 B) to `~/kalsa-models`, sha256-pinned, skips itself when the hash matches |
| `run_humaneval.py` | greedy pass@1, sandboxed execution (see below), JSON in run_gen_eval shape |
| `run_flores.py` | greedy translation; chrF++ (sacrebleu, word_order=2) + wrong-language (lid top-1 ≠ target); LID self-check on gold refs (≥ 90 %) else the run fails; writes `<prefix>-chrf.json` and `<prefix>-wronglang.json`, both bpb-shaped so the EXISTING `bootstrap_ci.py --bpb` pairs them |
| `check_stop_rule.py` | S1 stop rule, fail-closed; prints the numbers, exit 0 = GO / 1 = STOP |
| `rescore_gsm8k_raw.py` | re-applies the `run_gen_eval` scorer to stored A40 raws (see below) |
| `run_gen_eval.py` (edit) | `--dataset gsm8kit` alias (same last-number scorer); transformers import deferred to the CLI path (server path needs no torch stack); CLI context `-c` now `n + 2048` so 8192-token generations fit |
| `run_bpb_eval.py` (edit) | `--override-kv KEY=VALUE` passthrough to llama-perplexity (fixes the A40 bpb bug) |
| `podprobe/30_gate.sh` (edit) | runs gsm8k + gsm8kit + tools + humaneval + flores while the server is up, bpb with the arm's `--override-kv` replayed; marker withheld unless ALL steps exit 0; `GSM8K_MAX_TOKENS` default 8192 |
| `podprobe/00_env.sh` (edit) | venv gains sacrebleu, fasttext, numpy<2 (fasttext 0.9.3 breaks on numpy 2); apt build-essential before pip; fetches lid.176.bin |

## Sources, licences, pins (no datasets > 5 MB or binaries in git)

- **HumanEval+**: `evalplus/humanevalplus` test.jsonl @ `d32357cf319e50e9c8d8dab5ea876c72b0fd321b`,
  file sha256 `908377f1daf28dcb36846db73a5662b2e05a9907407c2696c89ad9d3b0b04492`.
  Problems MIT (OpenAI HumanEval), plus-tests Apache-2.0 (EvalPlus).
- **GSM8K-IT**: `Eurolingua/gsm8kx` `gsm8k_IT_test.jsonl` @ `363d87617cd417b731dc860194a6935fd5ff49ae`,
  MIT (card tag; GSM8K is MIT). Chosen over `sapienzanlp/gsm8k_italian` (also
  MIT-tagged) because that one is a MULTIPLE-CHOICE reformulation of the
  TRAIN split — phase 0 adds GSM8K train to the calibration, so it would be
  contaminated. gsm8kx is the real test split (1319 rows, same `#### answer`
  format).
- **FLORES-200 devtest**: CC-BY-SA-4.0, official tarball
  `https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz`
  sha256 `b8b0b76783024b85797e5cc75064eb83fc5288b41e9654dabc7be6ae944011f6`
  (25,585,843 B). The five devtest files were verified byte-for-byte against
  the moe-expert-usage-v3 `source_hashes.txt` pins at build time. devtest is
  EVAL ONLY — the calibration rebuild (phase 0a) must keep it out (DESIGN §5.9).
- **fastText lid.176**: CC-BY-SA-3.0,
  `https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin`
  sha256 `7e69ec5451bc261cc7844e49e4792a85d7f09c06789ec800fc4a44aec362764e`.
  Labels are plain ISO-639-1 codes (`__label__zh`, no zh_cn/zh_tw split).
- Local eval venv (Mac only): `python3.12 -m venv ~/kalsa-models/venv-eval`
  with sacrebleu, fasttext, huggingface_hub, pyarrow, numpy<2, transformers.

## Bug fixes

1. **bpb ran without the arm's overrides** (`30_gate.sh:59` of the A40
   probe): the arm flags are now snapshotted (`EXTRA`), parsed
   (`--override-kv` pairs → `ARM_KV`), passed to the server AND replayed to
   `run_bpb_eval.py --override-kv`. Consequence for the A40 REPORT: the
   razor19-k4 / k4+k2 / qwen36-k4 bpb cells were measured at DEFAULT expert
   count — they stay as-is with that label, no re-run happened (pod deleted).
2. **GSM8K cap 4096 → 8192**: `GSM8K_MAX_TOKENS` in `30_gate.sh` for gsm8k +
   gsm8kit. Tools stay at the 4096 default (short answers, product parity).

## A40 GSM8K re-score on stored raws (`rescore_gsm8k_raw.py`)

`~/kalsa-models/venv-eval/bin/python rescore_gsm8k_raw.py
results/gate_probe_a40_2026-10-01/*/ > /tmp/rescore_a40.log 2>&1; echo "EXIT=$?"` → **EXIT=0**

```
arm                    stored rescored match raw_any trunc_no_raw
lfm                       180      180    OK     192            8
qwen35-2b-q4_0             29       29    OK      32          168
qwen35-2b-q4km             36       36    OK      39          161
qwen35-4b                 109      109    OK     125           75
qwen36-k4                 117      117    OK     139           61
razor19-k4-k2             127      127    OK     149           51
razor19-k4-q4km            90       90    OK     108           92
razor19-k8-q4_0           129      129    OK     150           50
razor19-k8-q4km           142      142    OK     169           31
```

Raw generations ARE on disk but only for items that FINISHED inside 4096
tokens (and 2-4 truncated items per arm that produced some content before
the cut): the 28-168 REMAINING truncated items per arm stored NO text (the
server returns mid-`<think>` content as reasoning, which the probe never
saved). Re-scoring the stored raws reproduces the stored counts exactly
(scorer determinism confirmed), but an UNCAPPED re-score is impossible from
disk — `trunc_no_raw` items have nothing to score. The confound stands until
the arms are regenerated at 8192 (the fixed gate's default).

## Sandbox (HumanEval+)

One subprocess per problem: `sys.executable -I runner.py`, fresh temp cwd,
`stdin=DEVNULL`, minimal env (`PATH=/usr/bin:/bin`, temp `HOME`/`TMPDIR`).
The runner replaces `socket.socket` with a subclass whose `__init__` raises
(so `ssl.py`'s `class SSLSocket(socket)` still imports) and stubs
`create_connection`/`getaddrinfo`; `check(candidate)` runs once per problem
with a 60 s timeout (plus-tests are loop-based; a hang is a kill = FAIL).
Negative test on this Mac:

`python -I runner.py` (urlopen + benign assert in one runner) →
`BLOCKED-CLEANLY: <urlopen error network disabled (eval sandbox)>` /
`BENIGN-OK`, `SANDBOX_TEST_EXIT=0`

## End-to-end smoke — LFM2.5-1.2B-Instruct-Q4_K_M, 10-item slices

Server: `~/Projects/kalsallama/build/bin/llama-server -m
~/kalsa-models/LFM2.5-1.2B-Instruct-Q4_K_M.gguf -ngl 99 -c 8192 --port 8765`
→ `HEALTH=ok`.

```
run_humaneval.py --holdout humaneval-164.jsonl --server http://127.0.0.1:8765 \
  --out /tmp/smoke-eval/humaneval.json --limit 10 > log 2>&1;  → HUMANEVAL_EXIT=0
  humanevalplus: 5/10 = 0.500 (fails: 2 × missing `typing` import (NameError),
  2 × wrong answer (AssertionError), 1 × IndexError — small-model failures,
  the pipeline scores them correctly)
run_flores.py   --holdout flores-devtest-100.jsonl --server ... \
  --out-prefix /tmp/smoke-eval/flores --limit 10 > log 2>&1;   → FLORES_EXIT=0
  en-it chrF++ 51.99, en-fr 69.90, en-es 50.02, en-zh 22.49
  wrong-language 0/10 in every pair (gold-ref self-check passed 10/10 × 4)
run_gen_eval.py --dataset gsm8kit --holdout gsm8kit-100.jsonl --server ... \
  --max-tokens 8192 --out /tmp/smoke-eval/gsm8kit.json --limit 10 > log 2>&1;
                                                               → GSM8KIT_EXIT=0
  gsm8kit: 4/10 = 0.400, 0/10 hit the 8192 cap
run_bpb_eval.py --llama ~/Projects/kalsallama/build/bin --model <lfm 1.2B> \
  --tokenizer ~/kalsa-models/lfm2.5-tokenizer \
  --corpus ~/Projects/kalsa-moe-experiments/corpus/postcutoff \
  --langs it --out /tmp/smoke-eval/bpb.json > log 2>&1;        → BPB_EXIT=0
  it: 55 docs, 338060 bytes, 92369 tokens → bpb 0.9721 (90 chunks)
```

CI-tool compatibility (existing `bootstrap_ci.py`, no changes, self-pairs on
the smoke arm, `EXIT=0` each): humaneval per-item (n=10), gsm8kit per-item,
flores-chrf via `--bpb --langs en-it,en-zh` (per-sentence units),
flores-wronglang via `--bpb --langs en-fr` (0/1 units), bpb via `--bpb --langs it`.

Stop rule on the real smoke results:
`python check_stop_rule.py --arm /tmp/smoke-eval --base /tmp/smoke-eval`
→ `STOP_RULE_EXIT=1`:

```
IT bpb        0.972 (rule: <= 0.75)     -> STOP
HumanEval+    5/10 = 50.0% vs base 50.0% (rule: >= base - 15 pp) -> ok
wrong-language en-{es,fr,it,zh}: 0.0% (rule: <= 5%)   -> ok
VERDICT arm=/tmp/smoke-eval: STOP
```

The 1.2B correctly trips the IT-bpb rule — the numbers are real and the
fail-closed path (missing JSON ⇒ STOP) is the same code path.

## Not done here (deliberately)

- Full evals (164/100/100 × arms × base) run on the pod's phase-1 step 5 —
  `30_gate.sh` now invokes all of them per arm; holdouts + lid model reach
  the pod via the usual rsync + `00_env.sh` fetch.
- The A40 k4-arm bpb cells stay mislabeled-but-annotated; re-measuring needs
  a GPU and is phase-1 work.
- Calibration rebuild without FLORES devtest = phase 0a (other agent).
