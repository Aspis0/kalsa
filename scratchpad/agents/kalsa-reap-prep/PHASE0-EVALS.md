# Phase 0, item 3 — the missing evals are in the gate (2026-10-01)

Implements DESIGN.md §4 item 3: HumanEval+ pass@1 with execution, FLORES-200
devtest EN→{IT,FR,ES,ZH} chrF++ + wrong-language rate, GSM8K-Italian 100
items; plus the two known-bug fixes (`30_gate.sh` bpb overrides, GSM8K cap
4096→8192) and the S1 stop-rule check. **Fix round 2026-10-01 (same day)**:
everything flagged by `AUDIT-PHASE0-EVALS.md` is corrected here — the stop
rule is fail-closed in fact (not just in print), the HumanEval scorer
executes in EvalPlus order behind a sentinel, FLORES separates truncation
from wrong-language, the probe budgets match the new workload, and the
sandbox wording says what the sandbox actually does.

## Files (all in `eval/` unless noted)

| file | what |
|---|---|
| `build_humaneval_holdout.py` | downloads evalplus/humanevalplus @ `d32357cf` (164 problems, tests = base+plus merged), **refuses to build unless the source sha256 matches the pin**, drops `canonical_solution`, writes `humaneval-164.jsonl` — **11.4 MB, NOT committed** (> 5 MB rule; `eval/.gitignore`) |
| `build_flores_holdout.py` | first 100 devtest sentences × {eng,ita,fra,spa,zho_Hans}, sha256-verified against the v3 corpus pins before writing; `flores-devtest-100.jsonl` (107 KB, committed) |
| `build_gsm8kit_holdout.py` | seed-42 sample of 100 from Eurolingua/gsm8kx `gsm8k_IT_test.jsonl` (test split); **enforces the source sha256 pin**; `gsm8kit-100.jsonl` (45 KB, committed) |
| `fetch_lid176.sh` | downloads fastText lid.176.bin (131,266,198 B) to `~/kalsa-models`, sha256-pinned, works with `sha256sum` (Linux pod) and `shasum` (macOS), skips itself when the hash matches |
| `run_humaneval.py` | greedy pass@1, EvalPlus-order sandboxed execution (see below), JSON items keyed by id; **refuses to run on macOS unless `--allow-host`** |
| `run_flores.py` | greedy translation at `--max-tokens 4096` (a thinking model needs headroom for `<think>`); chrF++ (sacrebleu, word_order=2) + wrong-language (lid top-1 ≠ target) **over non-truncated items**; truncation reported per pair and the run FAILS above 2 %; LID self-check on gold refs (≥ 90 %) else the run fails; writes `<prefix>-chrf.json` and `<prefix>-wronglang.json`, both bpb-shaped with a `metric` field so `bootstrap_ci.py --bpb` prints the right label |
| `check_stop_rule.py` | S1 stop rule, fail-closed **by construction**: a missing/unparsable file, a missing key, or n = 0 is a STOP and every rule is evaluated — no code path prints GO over unreadable data |
| `journal.py` | append-only per-item journal (header pins the item-list hash); the three generation runners append per item and skip done ids on rerun, so a killed arm resumes instead of restarting (audit B3/H4) |
| `server.py` | the one HTTP client for the runners: greedy, seeded, thinking ON via `chat_template_kwargs`, reads `reasoning_content` as well as `content` (audit M10), 2 retries on transient errors |
| `test_stop_rule.py` | exit-code contract: missing dir/file, partial JSON, n = 0 → exit 1; green arm → exit 0; **the 15 pp clause decided both ways on two DIFFERENT arms** (90/164 vs 100/164 → GO, 60/164 → STOP) |
| `test_humaneval_runner.py` | the audit's two exploits (redefined `check`, `sys.exit(0)`) must FAIL; honest code PASSes; a forking program times out and its grandchild is killed with the group; truncation rules on canned replies |
| `test_flores_logic.py` | think-stripping + the truncation shapes on canned replies (the 1.2B smoke never emits `<think>`); truncated item excluded from the wrong-language denominator; `metric` labels |
| `rescore_gsm8k_raw.py` | re-applies the `run_gen_eval` scorer to stored A40 raws (see below) |
| `run_gen_eval.py` (edit) | journal + `--concurrency` + shared client; CLI context `-c` = n + 2048 |
| `podprobe/30_gate.sh` (edit) | **deletes nothing on re-entry**: each eval stage is skipped when its final JSON exists, otherwise it reruns and the runner resumes from its journal; server starts with `-np $PROBE_SLOTS` (16384-token context per slot) and the runners match `--concurrency`; `bench.txt` is built in a temp file and `mv`'d only when both benches exited 0 non-empty; marker withheld unless ALL steps exit 0 |
| `podprobe/env.sh` (edit) | budget knobs sized for the new workload (next section) |
| `podprobe/run_probe.sh` (edit) | runs `check_stop_rule.py` after the arm loop for the k=4 128-expert arms vs `qwen36-k4`; per-arm est hours updated |
| `podprobe/00_env.sh` (edit) | verifies `humaneval-164.jsonl` sha256 before any GPU hour; rebuilds from the pinned evalplus revision if absent (audit H3) |

## Sources, licences, pins (no datasets > 5 MB or binaries in git)

Every pin below is ENFORCED (compared, exit on mismatch), not just recorded:

- **HumanEval+**: `evalplus/humanevalplus` test.jsonl @ `d32357cf319e50e9c8d8dab5ea876c72b0fd321b`,
  source sha256 `908377f1daf28dcb36846db73a5662b2e05a9907407c2696c89ad9d3b0b04492`
  (compared by `build_humaneval_holdout.py`). Problems MIT (OpenAI HumanEval),
  plus-tests Apache-2.0 (EvalPlus). The BUILT `humaneval-164.jsonl` is itself
  pinned: sha256 `945a42273172b60a627cb2958ca1cefddfd398f41dfc9535781beb665c29e10f`
  (11,464,324 B; the builder is byte-deterministic) — `podprobe/00_env.sh`
  verifies it on the pod and rebuilds+re-verifies if missing (audit H3).
- **GSM8K-IT**: `Eurolingua/gsm8kx` `gsm8k_IT_test.jsonl` @ `363d87617cd417b731dc860194a6935fd5ff49ae`,
  source sha256 `5c846d406f59675f209d6581770e203296954b3201cc95507413fd840ba5b17d`
  (826,166 B, measured by the audit; compared by `build_gsm8kit_holdout.py`),
  MIT (card tag; GSM8K is MIT). Chosen over `sapienzanlp/gsm8k_italian`
  because that one is reported as a multiple-choice reformulation of the
  TRAIN split — that rejection reason is third-party and UNVERIFIED; the
  decision does not depend on it (gsm8kx is the real test split, 1319 rows).
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

## Probe budgets (audit B3 — the arithmetic the old knobs ignored)

Per-arm generation workload of the fixed gate, full size (no
`PROBE_GEN_LIMIT`): gsm8k 200 @ 8192 + gsm8kit 100 @ 8192 + tools 100 @ 4096
+ humaneval 164 @ 8192 + flores 4×100 @ 4096 = **964 requests/arm**.

Token demand per 35B arm (thinking ON), from the A40 evidence — 25–46 % of
math items hit the 4096 cap at the old setting, so at 8192 we plan 40 % of
math items to the cap / 60 % averaging 2,200 tok; humaneval 30 %/1,800;
tools 10 %/500; flores 15 %/1,200:

| stage | decode tokens (plan) |
|---|---:|
| gsm8k 200 | 0.92 M |
| gsm8kit 100 | 0.46 M |
| humaneval 164 | 0.61 M |
| tools 100 | 0.09 M |
| flores 400 | 0.65 M |
| **total per 35B arm** | **≈ 2.7 M** |

Throughput: NOTHING is measured for the 35B on a pod GPU — every 35B arm of
the A40 probe died before finishing (that is audit B3). The documented
anchors: the audit's conservative 15–30 tok/s single-stream for the 35B
class, and the A40-measured 263 tok/s tg128 for the dense 2.6B
(RUN-2026-09-30-A40.md). MoE decode is bandwidth-bound, so the gate runs the
evals CONCURRENTLY: `llama-server -np 4` slots × 16384-token contexts (8192
generation + prompt headroom), runners at `--concurrency 4` → ~3× aggregate
(conservative vs 4×). All arms share the batched-decode condition, so the
paired comparison is intact; per-request HTTP timeout is 1800 s (covers 8192
tok at the 15 tok/s floor 3× over).

Wall per 35B arm at 2.7 M tokens: **45 tok/s agg (15×3) → 16.7 h** |
**90 tok/s agg (30×3) → 8.3 h** | **~300 tok/s agg (realistic, anchored on
the A40 dense measurement) → 2.5 h**.

Knobs (`podprobe/env.sh`), and what each one buys:

- `PROBE_SLOTS=4` — the concurrency above.
- `PROBE_ARM_TIMEOUT_H=10.0` — above the mid planning case (8.3 h); an arm
  killed by it keeps every finished eval (journals) and its marker is
  withheld, so a relaunch costs only the missing stages.
- `PROBE_BUDGET_H=24.0` — admits the core arm set (lfm + three 35B k-arms +
  4B control + extras) at the realistic rate (~14 h) and most of it at the
  mid rate (~30 h → the guard starts skipping); at the conservative floor
  the probe does NOT fit any budget — the guard skips 35B arms by design and
  the coordinator re-books. That is the honest cost of the new workload on a
  ~$2/h A100: roughly $28–45 for the full core set at realistic rates, over
  the original $10 owner cap (README carries the trade-off).
- `PROBE_HARD_STOP_H=26.0` — budget + setup/upload/stop-rule margin.

Per-arm `est` hours in `run_probe.sh` are set from the same table (35B-class
arms 3.0 h, LFM 1.2 h, 4B 1.5 h, 2B 0.6 h, 28B 4.0 h); the admission guard
skips an arm whose est exceeds the budget left. First 35B `bench.txt` gives
the REAL single-stream tg128 — the coordinator should re-read this table
against it before letting the tail arms run.

## Bug fixes

1. **bpb ran without the arm's overrides** (`30_gate.sh:59` of the A40
   probe): the arm flags are snapshotted (`EXTRA`), parsed
   (`--override-kv` pairs → `ARM_KV`), passed to the server AND replayed to
   `run_bpb_eval.py --override-kv`. Consequence for the A40 REPORT: the
   razor19-k4 / k4+k2 / qwen36-k4 bpb cells were measured at DEFAULT expert
   count — they stay as-is with that label, no re-run happened (pod deleted).
   Caveat (audit M8, open): the replay carries ONLY `--override-kv`; any
   future arm mechanism that ships as a different flag or a modified GGUF
   silently measures bpb at defaults — the note in the log is the only trace.
2. **GSM8K cap 4096 → 8192**: `GSM8K_MAX_TOKENS` in `30_gate.sh` for gsm8k +
   gsm8kit. Tools stay at the 4096 default (short answers, product parity).
3. **Fix round (audit)**: stop rule fail-closed (B1/M9) and wired into the
   pod flow (H2); HumanEval scorer in EvalPlus order behind a sentinel
   (B2); FLORES truncation separated from wrong-language at a 4096 cap
   (B4); probe budgets + journals + no-delete re-entry (B3/H4); honest
   sandbox + Darwin refusal (H1/M6/M7); holdout provisioning on the pod
   (H3); enforced sha pins (M1); `sha256sum`/`shasum` (M2); bench marker
   only over green benches (M4); `finish_reason=length` = FAIL implemented
   (M5); clean STOP messages instead of tracebacks, n = 0 is a STOP (M9);
   `reasoning_content` stored per item in every runner (M10); honest output
   shape + metric labels (M11); real transcript below (M12).

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

Raw generations are on disk only for items that FINISHED inside 4096 tokens.
The honest reason (corrected per the audit — the earlier draft blamed the
server's reasoning handling, which was wrong): the probe never archived the
raw HTTP responses, and stored only the final `content` string — the
truncated text itself was carried in that string and then dropped by the
harness's storage choice, so `trunc_no_raw` items have nothing to score. An
uncapped re-score of THOSE arms is impossible from disk and stays impossible;
the runners now store `reasoning` per item, so future truncated runs CAN be
re-scored uncapped from their JSONs. Re-scoring the stored raws reproduces
the stored counts exactly on all 9 arms (0/1400 per-item disagreements) —
that proves the JSONs were not edited after scoring; it cannot detect a
defect present in both the stored text and the stored count, and it does not
touch the 4096-cap confound, which stands until the arms are regenerated at
8192.

## Sandbox (HumanEval+) — what it actually is

Best-effort isolation for the disposable pod, NOT a containment boundary.
The harness process never runs model code (one `python -I` subprocess per
problem, fresh temp cwd, stdin devnull). The child gets: a REPLACED
environment (no HF token, no proxy variables — verified: the token reaches
the server via the harness process only), `PATH=/nonexistent` (PATH-based
lookup of curl/git/ssh fails), rlimits at runner start where the OS supports
them (CPU timeout+10 s, AS 2 GB, FSIZE 16 MB, NPROC 16 — soft limits; a root
child can raise its own soft limits), and the per-problem timeout kills the
whole process GROUP (`start_new_session` + `killpg`), so a fork cannot leak
grandchildren. `check(candidate)` runs once per problem with a 60 s timeout;
PASS requires exit 0 AND the `__EVALPLUS_TESTS_RAN__` sentinel that only a
run reaching the end of the tests can print.

KNOWN BYPASSES (all verified by the audit against the previous prefix, and
none of them are closed by software here): `import _socket` creates real
sockets; absolute-path binaries (`/usr/bin/curl`) run; absolute-path writes
work. That is why `run_humaneval.py` REFUSES to run on macOS unless
`--allow-host` is passed, and why it must only ever run on the disposable
pod. Negative test on this Mac (previous round, unchanged mechanism):
`python -I runner.py` (urlopen + benign assert) → `BLOCKED-CLEANLY` /
`SANDBOX_TEST_EXIT=0` — the socket-subclass monkeypatch still blocks the
accidental `urlopen` path; it was never a boundary and is no longer
described as one.

## Stop rule (S1) — wired and fail-closed

`check_stop_rule.py --arm <dir> --base <dir>` exits 0 = GO / 1 = STOP; a
missing dir, a missing or unparsable JSON, a missing key, or n = 0 is a STOP
with the reason printed — every rule is evaluated, so no failure mode can
print GO. In the probe flow it runs in `run_probe.sh` AFTER the arm loop for
`razor19-k4-q4km` and `razor19-k4-k2` with
`--base "$RESULTS/qwen36-k4"` (the exact unpruned control at k=4), writing
`results/stop-rule.log` which the final upload carries. The k=8 razor arms
have no unpruned-k8 control arm in the probe, so the rule is not run for
them — comparing a k8 arm against the k4 base would confound the HumanEval
clause. The verdict does not change the probe's exit code (that tracks the
upload); STOP is the coordinator's no-ship signal.

Real captured transcript (the audit rejected the previous one as edited —
this one is verbatim from `check_stop_rule.py --arm /tmp/smoke-eval --base
/tmp/smoke-eval`, EXIT=1):

```
IT bpb        0.972 (rule: <= 0.75)     -> STOP
HumanEval+    5/10 = 50.0% vs base 5/10 = 50.0% (rule: >= base - 15 pp) -> ok
wrong-language en-es: 0/10 = 0.0% (rule: <= 5%)   -> ok
wrong-language en-fr: 0/10 = 0.0% (rule: <= 5%)   -> ok
wrong-language en-it: 0/10 = 0.0% (rule: <= 5%)   -> ok
wrong-language en-zh: 0/10 = 0.0% (rule: <= 5%)   -> ok
  STOP reason: IT bpb 0.972 > 0.75
VERDICT arm=/tmp/smoke-eval: STOP
```

This transcript is the self-pair (`--arm == --base`), so the HumanEval
clause proves nothing here — that clause is covered against two DIFFERENT
arms by `test_stop_rule.py`: 90/164 vs base 100/164 (5.5 pp drop) exits 0,
60/164 (24.4 pp drop) exits 1.

## End-to-end smoke — LFM2.5-1.2B-Instruct-Q4_K_M, 10-item slices (fix round)

Server: `~/Projects/kalsallama/build/bin/llama-server -m
~/kalsa-models/LFM2.5-1.2B-Instruct-Q4_K_M.gguf -ngl 99 -c 32768 -np 2
--port 8765` → `HEALTH=ok`; runners at `--concurrency 2` (exercises the slot
path the pod uses at 4). Artifacts under `/tmp/smoke-eval-r2/` (ephemeral;
the numbers below are the record).

```
run_gen_eval.py --dataset gsm8kit ... --max-tokens 8192 --concurrency 2 --limit 10
  → GSM8KIT_EXIT=0; gsm8kit: 6/10 = 0.600, 0/10 hit the 8192 cap
run_humaneval.py ... --concurrency 2 --limit 10 --allow-host
  → HUMANEVAL_EXIT=0; humanevalplus: 5/10 = 0.500, truncated 0
run_flores.py ... --out-prefix ... --concurrency 2 --limit 10
  → FLORES_EXIT=0; chrF++ en-it 51.53, en-fr 69.90, en-es 50.24, en-zh 22.75;
    wrong-language 0/10 in every pair; truncated 0/10 in every pair
run_bpb_eval.py --langs it
  → BPB_EXIT=0; it: 55 docs, 338060 bytes, 92369 tokens → bpb 0.9721 (90 chunks)
```

Resume/journal behaviour, exercised for real:

```
rerun of the SAME gsm8kit command → "journal: resuming with 10 done item(s)
from gsm8kit.json.journal", zero HTTP requests, RESUME_EXIT=0
same command at --limit 5 → "journal: ... different item list — discarding",
fresh run from item 1, LIMIT5_EXIT=0
```

New targeted tests (all exit 0):

```
python3 eval/test_stop_rule.py         → EXIT=0 (11 cases incl. the two-arm 15 pp clause)
python3 eval/test_humaneval_runner.py  → EXIT=0 (15 cases incl. both audit exploits,
                                        the group-kill orphan check, the Darwin refusal)
venv-eval python eval/test_flores_logic.py → EXIT=0 (18 canned-reply cases)
```

What this smoke CANNOT show (audit H5, still true): the 1.2B emits ZERO
`<think>` blocks, so the thinking paths (unclosed block, reasoning_content
move, cap-vs-truncation interplay) were not exercised against a live model —
they are covered by the canned-reply unit tests above and remain unproven
against a real reasoning model until the pod.

CI-tool compatibility (existing `bootstrap_ci.py`, self-pairs on the smoke
arm, EXIT=0 each): humaneval per-item (n=10), gsm8kit per-item,
flores-chrf via `--bpb --langs en-it,en-zh`, flores-wronglang via
`--bpb --langs en-fr` (now printed as `wrong_language en-fr`, not `bpb`),
bpb via `--bpb --langs it`.

## Not done here (deliberately) / open

- Full evals (164/100/100 × arms × base) run on the pod — `30_gate.sh`
  invokes all of them per arm; holdouts + lid model + `humaneval-164.jsonl`
  (sha-verified, rebuilt if missing) reach the pod via rsync + `00_env.sh`.
- The real Qwen3.6-35B-A3B behaviours the budgets and B4 turn on — actual
  A100 single-stream tok/s, whether its template moves reasoning into
  `reasoning_content`, whether 8192 is enough for its math thinks — are
  UNMEASURED; the first 35B `bench.txt` and the per-arm truncation counts
  are the instruments.
- The IT-bpb threshold 0.75 has no recorded provenance and no base-arm
  value on record (only data point in the tree: the 1.2B at 0.972) — the
  base arm's bpb should go into the report before any verdict.
- FLORES design limits (audit M3, accepted): EN→X only, four pairs share one
  source set, n = 100 gives the 5 % rule ±1 item granularity. A future
  round should widen the slice and add an in-language instruction set.
- `bootstrap_ci.py --resamples/--seed` are never tuned by any caller; the
  per-flag "server-only" note in `30_gate.sh` is still log noise (audit L5).
- Think-handling still exists in per-runner dialects (`run_gen_eval`
  regexes, `run_flores` string ops); consolidating them further is cleanup,
  not a fix (audit L3).
