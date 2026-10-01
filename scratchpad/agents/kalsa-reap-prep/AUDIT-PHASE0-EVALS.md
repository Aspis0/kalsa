# Hostile audit — commit 59394305 (Phase 0 item 3 evals)

Subject: `feat(eval): add HumanEval+, FLORES chrF++/wrong-language, GSM8K-IT to the gate`
Scope: everything under `scratchpad/agents/kalsa-reap-prep/` added or edited by that commit.
Gate stakes: S1 decides whether the pruned Qwen3.6-35B-A3B (256→128 experts/layer) ships.
Supported languages: exactly IT, FR, ES, ZH.
Date of audit: 2026-10-01. Audited commit `59394305` = HEAD, working tree clean
except this report.

## Method (what I actually did)

Read every added/edited file at the commit. Ran read-only probes plus experiments in
`/tmp` only:

- reproduced the stop rule on synthetic dirs (`/tmp/audit-sr`) — empty dir, partial files;
- re-ran `rescore_gsm8k_raw.py` on the real A40 results and re-derived per-item agreement;
- executed the sandbox runner prefix verbatim (`/tmp/sbx`) with escape probes;
- executed `run_humaneval.run_sandboxed()` from the committed code with a `check`-hijack
  program, a `sys.exit(0)` program and an honest-wrong program;
- loaded the real `~/kalsa-models/lid.176.bin` (labels + 100-sentence gold self-check per
  language + short-string behaviour) and `sacrebleu 2.6.0` chrF++ on CJK/empty/preamble inputs;
- verified the three "pinned" datasets against the HF API / the local v3 FLORES copy;
- verified every number quoted in `PHASE0-EVALS.md` against the still-present
  `/tmp/smoke-eval/*` artifacts;
- replayed `30_gate.sh`'s `--override-kv` parsing and empty-array idiom under bash 3.2.57.

No model was downloaded. No device was touched. No file was modified except this report.

## Verdict summary (ranked)

| # | Sev | Finding | Verdict |
|---|-----|---------|---------|
| B1 | blocker | `check_stop_rule.py` is **fail-open**: every missing JSON prints "-> STOP (fail-closed)" and the tool then exits **0 = GO** | CONFIRMED |
| B2 | blocker | HumanEval+ scorer is trivially gameable: model code is concatenated **after** the tests, so `def check(...)` or `sys.exit(0)` ⇒ exit 0 ⇒ **PASS** | CONFIRMED |
| B3 | blocker | `30_gate.sh` now does ~3.6× the per-arm work while `PROBE_ARM_TIMEOUT_H=2.5`, `PROBE_BUDGET_H=12`, `HARD_STOP=13` are untouched ⇒ every 35B arm is killed and loses **everything** (JSONs are `rm -f`'d at entry) | CONFIRMED |
| B4 | blocker | FLORES keeps `--max-tokens 1024` with thinking on; truncation ⇒ `""` ⇒ counted as **wrong-language**, i.e. the 5 % rule can be tripped by a token cap — the exact bug this commit fixed for GSM8K | CONFIRMED |
| H1 | high | Sandbox marketing ≠ sandbox: network egress is fully open (`curl` via `PATH`, `import _socket`), no FS confinement, no rlimits; claims "sockets disabled" | CONFIRMED |
| H2 | high | `check_stop_rule.py` has **zero callers**; nothing in the repo ever computes GO/STOP; `--base` has no default and the only proof passed `--arm == --base` (HumanEval clause vacuous) | CONFIRMED |
| H3 | high | `humaneval-164.jsonl` is gitignored, 11.4 MB, required by `30_gate.sh`, and **no pod script builds or checks it**; one rsync of a specific Mac checkout is the only reason it exists on the pod | CONFIRMED |
| H4 | high | Both new eval scripts write their JSON **only at the very end**; one HTTP error / one 1800 s timeout discards the whole stage, and the cap doubling (4096→8192) raised the per-request time without raising the client timeout | CONFIRMED |
| H5 | high | The thinking paths were never exercised by the "end to end" proof: LFM2.5 emitted **zero** `<think>` in all three runners (grep on the artifacts) | CONFIRMED |
| M1 | medium | sha256 "pins" are decorative: HumanEval+ hash is computed-and-recorded, never compared; gsm8kit has **no** hash at all (real value supplied below) | CONFIRMED |
| M2 | medium | `fetch_lid176.sh` uses `shasum` where every other pod script uses `sha256sum`; a missing `shasum` = bare `set -e` abort inside `00_env.sh` ⇒ whole probe aborts | PLAUSIBLE |
| M3 | medium | FLORES validity: EN→X only (no X→EN, no in-language instruction-following); the 4 pairs share the same 100 sources (not independent); 100 items = ±1 item = ±1 pp on a 5 % rule; 912 devtest sentences unused for free | CONFIRMED (design) |
| M4 | medium | `bench.txt` (the resume marker) is created by `llama-bench … \|\| true` **before** the all-green test ⇒ a dead bench + green evals yields a "done" marker whose content is garbage, which then drives the resume skip and the speed floor | CONFIRMED |
| M5 | medium | `run_humaneval.py:17` documents `finish_reason "length" … = FAIL`; the code never implements it | CONFIRMED |
| M6 | medium | `subprocess.run(timeout=)` kills only the direct child ⇒ **orphaned grandchildren** (verified: PPID 1) | CONFIRMED |
| M7 | medium | `"the harness never runs model code"` / `sockets disabled` phrasing overstates a containment that was never tested beyond `urlopen` | CONFIRMED |
| M8 | medium | The `--override-kv` replay is correct, but "server-only (not replayed on bpb)" is a **silent no-op** for any other expert-count mechanism ⇒ the A40 bpb bug can return unnoticed | PLAUSIBLE |
| M9 | medium | Partial JSON ⇒ `KeyError` traceback, exit 1 (accidentally "STOP", no numbers); `n=0` on both sides ⇒ GO | CONFIRMED |
| M10 | medium | `reply_content`-only reads; `reasoning_content` is discarded in all three runners (harmless today, fragile if the chat template changes) | PLAUSIBLE |
| M11 | medium | Docstring "same shape as run_gen_eval" is wrong (adds `task_id`, `code`, `error`, top-level keys); `bootstrap_ci.py --bpb` prints "bpb en-fr" for a wrong-language **rate** | CONFIRMED |
| M12 | medium | `PHASE0-EVALS.md`'s stop-rule transcript is **edited**, not captured (one composite wrong-language line vs the four real lines in `stop_rule.log`) | CONFIRMED |
| L1 | low | "Re-scoring reproduces the stored counts exactly" is literally true (I reproduced all 9 arms) but near-vacuous as evidence — see §5 | CONFIRMED (claim) / weak (inference) |
| L2 | low | "uncapped re-score impossible from disk" is true of the A40 data, but the stated cause ("the probe never saved the reasoning text") is a misdiagnosis | CONFIRMED (fact) / REFUTED (cause) |
| L3 | low | Thinking-handling logic triplicated in three different dialects (`THINK_RE` ×2, string ops ×1) | CONFIRMED |
| L4 | low | `run_humaneval.py:144` `truncated` is stored, never printed, never read by anyone | CONFIRMED |
| L5 | low | Dead/no-op: per-flag "note:" echo in `30_gate.sh`; `bootstrap_ci --resamples` never tuned; `run_gen_eval --max-tokens` help text still says 4096 default | CONFIRMED |

---

## 1. Security / secrets — `run_humaneval.py` executes model-generated code

### H1/M7 — the "sandbox" is a socket monkeypatch, not a sandbox (CONFIRMED)

`eval/run_humaneval.py:41-56` (the entire `RUNNER_PREFIX`) patches exactly three
attributes in the child process:

```
RUNNER_PREFIX = """\
import socket

class _NoSocket(socket.socket):
    def __init__(self, *_a, **_k):
        raise OSError("network disabled (eval sandbox)")

socket.socket = _NoSocket
...
socket.create_connection = _no_net
socket.getaddrinfo = _no_net
"""
```

`eval/run_humaneval.py:95-100` gives the child:

```
                env={"PATH": "/usr/bin:/bin", "HOME": tmp, "TMPDIR": tmp,
                     "PYTHONDONTWRITEBYTECODE": "1"},
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
```

Verified escapes (executed with the committed `RUNNER_PREFIX`, `/tmp/sbx`):

| probe | result |
|---|---|
| `import _socket; _socket.socket(AF_INET, SOCK_STREAM)` | **BYPASS — real socket created** (`<socket object, fd=3, family=2 …>`) |
| `subprocess.run(["/usr/bin/curl","-s","https://example.com"])` | **BYPASS — rc=0, 713 bytes returned** (`/usr/bin/curl` is inside the pinned `PATH`) |
| `pathlib.Path("/tmp/sbx/ESCAPED_WRITE.txt").write_text(...)` | **BYPASS — file written** (cwd/HOME are the temp dir; absolute paths are unrestricted) |
| `socket.socketpair()` | blocked (goes through the patched class) |

Failure scenario: the shipped model is a *third-party pruned checkpoint* (RAZOR-19B,
`Nickyang/…-RAZOR-19B-A3B-E128of256`) whose GGUF is converted on the pod by
`20_convert.sh`. Generated code can `import _socket`, open a socket, and exfiltrate. On
the pod the harness runs as **root inside the container** with `HOME=/tmp/humaneval-*`,
so `/root/.cache/huggingface/token` is readable by absolute path even though `HOME` is
redirected, and `/usr/bin/curl` is on the pinned `PATH`. The child's env is *replaced*
(so `HF_TOKEN` from the parent is **not** inherited — that part is genuinely fine, and no
token appears in argv or logs anywhere in this commit, which I checked: `run_probe.sh`
passes `HF_TOKEN="$(token_cat)"` through the environment only and uses `-H @hdr` for the
pod key), but a file-readable absolute path is enough.

Also unaddressed: no `resource.setrlimit` (memory/CPU/file-size), no seccomp, no
`unshare`, no uid drop, no read-only bind mount. `capture_output=True` buffers
unbounded stdout in the harness's RAM. `PATH=/usr/bin:/bin` hands the model `curl`,
`ssh`, `git`, `python3`, `dd`.

Mitigating facts, stated for fairness: the process is `python -I` (no user site, no
`PYTHONPATH`), cwd/HOME/TMPDIR are a fresh temp dir, and the harness process itself never
`exec`s model code — that part of `PHASE0-EVALS.md:80` (`docs/EVAL-GATE.md:80`) is
literally true. It is the *containment* claim that is false.

Fix, cheap: `start_new_session=True` + `os.killpg` on timeout, `resource.setrlimit`
(RLIMIT_AS ~2 GB, RLIMIT_CPU, RLIMIT_NPROC=0-ish, RLIMIT_FSIZE), `PATH=/nonexistent`,
and either drop `--allow-*` privileges for the child or run the child under
`unshare -n` (one command: `["unshare","-n",sys.executable,"-I",runner]`), which makes
the network claim true instead of decorative.

### M6 — timeout kill leaves orphans (CONFIRMED)

`subprocess.run(..., timeout=timeout)` sends SIGKILL to the **direct child only**.
Reproduced: a runner that does `subprocess.Popen([sys.executable,'-c','time.sleep(600)'])`
then sleeps → `TimeoutExpired` raised at 5.0 s (no hang, because CPython's POSIX timeout
path uses `wait()`, not `communicate()`), and the grandchild survives with **PPID 1**:

```
PID    PPID  COMMAND
77738  1     …/Python -c import time;time.sleep(600)
```

Failure scenario: 164 problems × a model that emits a `Popen`/`os.fork` leaves up to 164
orphan processes on the pod after the HumanEval stage "finishes". Fix: `start_new_session=True`
plus `os.killpg(os.getpgid(p.pid), SIGKILL)` in an `except` block.

### Token handling (CLEAN)

No token in argv, no token in a log line, no token written to a result file.
`40_upload.sh` refuses a non-private destination before any byte leaves and verifies the
remote tree. `run_probe.sh:96` uses a 0600 header file for the RunPod key. Nothing to fix here.

---

## 2. Correctness of the stop rule — `check_stop_rule.py`

### B1 — it is fail-OPEN (CONFIRMED, demonstrated)

`eval/check_stop_rule.py:24-28`:

```
def load(path: pathlib.Path) -> dict:
    if not path.exists():
        print(f"  MISSING {path} -> STOP (fail-closed)")
        return {}
```

and the three consumers, `eval/check_stop_rule.py:40`, `:48`, `:58`:

```
40:    if bpb:
41:        it = bpb["it"]["overall_bpb"]
48:    if he_arm and he_base:
58:    if wl:
```

`{}` is falsy ⇒ each block is **skipped** ⇒ `stop` stays `False` ⇒ line 65-66 prints
`VERDICT … GO` and returns 0. The tool prints "STOP (fail-closed)" on the line directly
above a GO verdict. Live runs:

```
$ python3 check_stop_rule.py --arm empty --base empty
  MISSING empty/bpb.json -> STOP (fail-closed)
  MISSING empty/humaneval.json -> STOP (fail-closed)
  MISSING empty/humaneval.json -> STOP (fail-closed)
  MISSING empty/flores-wronglang.json -> STOP (fail-closed)
VERDICT arm=empty: GO
EXIT=0
```

This is the whole stop rule returning GO for an arm with **no data at all**. The chain that
makes it reachable in production: `run_bpb_eval.py:55-60` `sys.exit`s on any
`llama-perplexity` failure, `30_gate.sh` withholds `bench.txt`, `40_upload.sh` still
uploads whatever exists, and the coordinator then runs `check_stop_rule.py` by hand on the
uploaded dir → GO. Three documents assert the opposite (`PHASE0-EVALS.md:20`,
`PHASE0-EVALS.md:147`, `docs/EVAL-GATE.md:96-99`, plus `README.md:109`).

Fix (2 lines): make `load()` raise / return `None` and set `stop = True` on absence:

```python
def load(path): ... return None            # or raise FileNotFoundError
bpb = load(arm/"bpb.json")
if bpb is None: stop = True
elif not (isinstance(bpb, dict) and "it" in bpb and "overall_bpb" in bpb["it"]):
    stop = True                            # partial file is also a STOP
```

### M9 — partial files crash instead of deciding (CONFIRMED)

`check_stop_rule.py:49` with `humaneval.json = {"ok":90}` (no `n`):

```
File ".../check_stop_rule.py", line 49, in main
    rate = 100.0 * he_arm["ok"] / max(1, he_arm["n"])
KeyError: 'n'
EXIT=1
```

Exit 1 *is* "STOP", so the outcome is accidentally right, but the tool dies with a
traceback, prints none of the numbers, and no one can tell "STOP because the arm failed"
from "STOP because the arm regressed". Also `max(1, n)`: `n=0` on **both** sides ⇒
`0.0 < -15.0` is False ⇒ GO.

### Units and field selection — all CORRECT (checked, no finding)

- IT bpb: `it > 0.75` at `:42` matches "IT bpb > 0.75" (boundary 0.75 passes) ✓;
- HumanEval: `rate < base_rate - 15.0` at `:51`, rates in **percent** (`100.0 * ok / n`)
  ⇒ pp on both sides ✓, boundary `== base-15` passes ✓;
- wrong-language: `d["rate"] > 0.05` at `:60` compares a **fraction** against a fraction
  (`run_flores.py:107` writes `round(sum(wrong)/len(wrong), 4)`), printed as `%` ✓;
- the bpb key read is `"it"`, i.e. the IT cell from `run_bpb_eval.py:110`
  (`report[lang] = {… "overall_bpb": …}`) ✓ — the right one, **provided** `--langs`
  includes `it`; `PROBE_BPB_LANGS` can remove it and turn the rule into a KeyError STOP;
- `run_bpb_eval.py` fails closed on a perplexity failure (`:55-60`, `:57`), so a bogus
  `0.0` bpb can never reach the rule ✓.

### H2 — the rule is never invoked, and its one proof was vacuous (CONFIRMED)

`grep -rn check_stop_rule` over the whole tree returns only docs (`README.md:109`,
`docs/EVAL-GATE.md:96`, `PHASE0-EVALS.md:20,136`) and the script itself. No shell script,
no CI step, no `pod/` stage calls it. `--base` is `required=True` with no default and no
per-arm mapping (the only sensible base for a k4-vs-k4 comparison is `qwen36-k4`, and
nothing says so anywhere).

And the smoke proof used the **same directory for arm and base**:

`PHASE0-EVALS.md:136` → `python check_stop_rule.py --arm /tmp/smoke-eval --base /tmp/smoke-eval`

so the HumanEval clause compared 50.0 % against 50.0 % — provably always "ok"
(`/tmp/smoke-eval/stop_rule.log` line 2). The 15 pp drop rule has never been executed
against two different models, in either direction. A regression test that feeds
`arm=90/164`, `base=100/164` (drop 6.1 pp) and `arm=60/164`, `base=100/164` (drop 24.4 pp)
would cost 20 lines and is the only thing standing between B1 and a silent ship.

---

## 3. `30_gate.sh`

### B3 — the probe budgets were not updated for the new work (CONFIRMED, arithmetic)

`podprobe/30_gate.sh:47-60` now runs, per arm, **while the server is up**:
gsm8k 200 @ ≤8192, gsm8kit 100 @ ≤8192, tools 100 @ 4096, humaneval 164 @ ≤8192,
flores 4×100 @ ≤1024 — i.e. 664 new generations per arm, 264 of which may run to 8192
tokens. `podprobe/env.sh:57-61` is untouched:

```
PROBE_BUDGET_H="${PROBE_BUDGET_H:-12.0}"  # guard: skip arms that cannot fit
PROBE_HARD_STOP_H="${PROBE_HARD_STOP_H:-13}"
PROBE_ARM_TIMEOUT_H="${PROBE_ARM_TIMEOUT_H:-2.5}"  # per-arm kill switch
```

and `podprobe/run_probe.sh:79-81` wraps each arm in `timeout -k 120 9000`.

Failure scenario: the A40 probe already needed ~2.5 h for gsm8k-200 + tools + bpb +
benches on a 35B-A3B. Adding 664 generations (264 up to 8192 tokens ≈ 5-9 min each at
15-30 tok/s) puts a 35B arm at roughly 15-25 h. `timeout` fires at 2.5 h →
`30_gate.sh` is TERMed → `bench.txt` never written → and because
`podprobe/30_gate.sh:18-21` `rm -f`s all seven result JSONs **on entry**, a rerun starts
from zero. Result: an infinite rerun loop, `PROBE_BUDGET_H` exhausting, arms 4-9
`SKIPPED — <left>h left < <est>h`, pod self-stop at 13 h, **no arm data at all**, ~$8-11
burned. The doc's "rerun resumes here" (`run_probe.sh:84`) is true only at *arm*
granularity, and only for an arm that reached its final line.

Fix: raise `PROBE_ARM_TIMEOUT_H`/`PROBE_BUDGET_H` to match the new cost, **or** keep the
probe at `PROBE_GEN_LIMIT` (the mechanism already exists, `:37-38`) and run the new evals
once on the two arms that matter (base + shipped candidate) in a dedicated stage. Add
`gsm8kit`/`humaneval`/`flores` to the per-arm `est` argument.

### `GSM8K_MAX_TOKENS` reaches both (CONFIRMED OK)

`podprobe/30_gate.sh:52` `GSM8K_MAX_TOKENS="${GSM8K_MAX_TOKENS:-8192}"`, passed as
`--max-tokens "$GSM8K_MAX_TOKENS"` to the gsm8k call (`:56`) **and** the gsm8kit call
(`:63`). Tools (`:70`) correctly keeps the 4096 default. `-c 16384` on the server
(`:42`) leaves room for 8192 + prompt ✓.

### Bash 3.2 / `set -u` / array handling — CORRECT (checked, no finding)

Under `/bin/bash 3.2.57` with `set -uo pipefail`:

```
EXTRA count=7  ARM_KV=4
server argv: [--override-kv] [k=int:4] [--override-kv] [k2=int:16] [-c] [4096] [--jinja]
bpb argv:     [--override-kv] [k=int:4] [--override-kv] [k2=int:16]
empty-array case: server [] bpb [] limit [] ok
```

`EXTRA=("$@")` after `shift 3` (`:24`) is taken before the parse loop (`:26-34`), so the
server still receives the overrides *and* bpb gets them. The `"${ARR[@]+${ARR[@]}}"`
form is used consistently (`:43`, `:101`, `:46`) — safe on 3.2 and on bash 5.

### `--override-kv` really reaches `llama-perplexity` (CONFIRMED OK)

`~/Projects/kalsallama/common/arg.cpp:2940` defines `{"--override-kv"}, "KEY=TYPE:VALUE,…"`
in **common** arg parsing, i.e. every tool in the build accepts it; the values
`run_probe.sh:115-117` passes (`qwen35moe.expert_used_count=int:4`) match the documented
`KEY=TYPE:VALUE` syntax. `run_bpb_eval.py:47-50` expands them correctly.
(I could not *execute* the binary: the local `build/bin/libllama-perplexity-impl.dylib`
no longer matches `libllama-common.0.5.0.dylib` — the tree was rebuilt at HEAD
`4dc4592b` after the smoke run. Unrelated to this commit, but it means "proven on the
Mac" is currently not re-verifiable without a rebuild.)

### M8 — the replay is silent for anything that is not `--override-kv` (PLAUSIBLE)

`podprobe/30_gate.sh:30-32` prints `arm flag '$1' is server-only (not replayed on bpb)`
and moves on. Today every k-arm uses `--override-kv` (`run_probe.sh:115-117`), so the fix
is complete; but if anyone adds an arm via `-ot`/a modified GGUF, bpb silently reverts to
the A40 bug with only a chatty note in the log. Suggest: fail (or set a warning flag
consumed by `notes.txt`) when the arm tag matches `*k4*`/`*k8*` and `ARM_KV` is empty.

### M4 — the resume marker is not a reliable "done" marker (CONFIRMED)

`podprobe/30_gate.sh:124-127`:

```
"$LLAMA_BIN/llama-bench" -m "$GGUF" -ngl 99 -p 512 -n 128 -r 2 \
  > "$OUT/bench.txt" 2>&1 || true
```

`|| true` plus `>` means **`bench.txt` is created even if `llama-bench` dies** (OOM on the
`-ngl 0` CPU run for a 35B is the realistic case). If all six eval stages then exit 0 the
marker says "done" over an empty or truncated bench, and `run_probe.sh:68` will skip that
arm forever while the speed floor (`docs/EVAL-GATE.md:60-63`) reads garbage. Suggest: write
to `bench.txt.tmp` and `mv` only when both benches exited 0 and the file is non-empty.

### Pipes, exit codes, traps — no finding

`set -uo pipefail` is set at `:15`, before `env.sh` is sourced. No `cmd | tail` in
`30_gate.sh`; the eval stages use `( … ) > log 2>&1 || rc=$?` which is correct.
`run_probe.sh:81` uses `|| rc=${PIPESTATUS[0]}` — the right idiom. The EXIT trap kills the
server, and `timeout` signals the whole process group, so a killed arm does not leave a
GPU-hogging server (this refutes the orphan worry at the arm level; it is only the
per-problem HumanEval child that leaks, M6). Adjacent pre-existing smell, untouched by
this commit: `podprobe/20_convert.sh:23,27` and `pod/10_fetch_model.sh:25` pipe into
`tail` — harmless there only because those files set `pipefail` (`set -euo pipefail`,
`20_convert.sh:10`), which makes the pipeline propagate the real failure.

---

## 4. Eval validity

### B2 — HumanEval+ pass/fail is gameable in three lines (CONFIRMED, executed)

`eval/run_humaneval.py:91-93`:

```
        runner.write_text(
            RUNNER_PREFIX + test_src + "\n" + program +
            f"\ncheck({entry_point})\n", encoding="utf-8")
```

The untrusted `program` is concatenated **after** `test_src`, so in the shared module
namespace the model's definitions shadow the test's helpers and its `check`. Executed
through the committed `run_sandboxed()` on `HumanEval/0`:

```
honest-wrong code  -> rc 1 | AssertionError: wrong      (correct)
CHECK-HIJACK       -> rc 0 |                            (recorded as PASS)
SYS-EXIT(0)        -> rc 0 |                            (recorded as PASS)
```

where CHECK-HIJACK is `def check(candidate): return None` + a stub entry point, and
SYS-EXIT is a correct-looking function followed by `import sys; sys.exit(0)`. Neither
runs a single assertion; both are `hit = rc == 0` at `:135` ⇒ **PASS**.

EvalPlus's own `untrusted_check` puts the candidate **first** and the test **after** it,
which is precisely what closes this hole; this harness inverted that order. The
`if rc == 0` convention also has no "tests actually ran" sentinel.

Failure scenario: a pruned checkpoint that has learned to emit a defensive
`def check(candidate): ...` guard, or simply a `sys.exit(0)`/`raise SystemExit` in a
`__main__`-style tail, gets 164/164. Since the stop rule only looks at the *drop* relative
to base, an inflated arm score hides a regression instead of exposing it.

Fix: `RUNNER_PREFIX + program + "\n" + test_src + f"\ncheck({entry_point})\n"`, wrap the
call so `check` cannot be shadowed (e.g. capture the test's `check` before exec:
`_check = check; del check` then call `_check(...)`), and require a sentinel — append
`print("__TESTS_RAN__")` after `check(...)` and treat its absence as FAIL.

### B4 — FLORES keeps a 1024-token cap on a thinking model (CONFIRMED)

`eval/run_flores.py:80`: `ap.add_argument("--max-tokens", type=int, default=1024)` — and
`30_gate.sh:81-84` never passes `--max-tokens`, so 1024 is what the pod runs. With
`chat_template_kwargs: {"enable_thinking": true}` (the product condition,
`run_gen_eval.py:60`) a 35B reasoning model routinely spends >1024 tokens thinking about a
one-sentence translation. `eval/run_flores.py:59-63`:

```
    if "<think>" in reply and "</think>" not in reply:
        return ""
    if "</think>" in reply:
        reply = reply.split("</think>", 1)[1]
    return reply.strip()
```

⇒ empty hypothesis ⇒ `lid_top("")` returns `""` (`:67-68`) ⇒ `int("" != label)` = 1 ⇒
**counted wrong-language**, and chrF++ 0 (verified: `corpus_chrf([""]*30, [zh]) == 0.0`).

Failure scenario: the base arm finishes its thinking inside 1024 and the pruned arm does
not ⇒ wrong-language rate for that pair jumps above 5 % ⇒ **STOP for a token-budget
artifact**, which is precisely the confound the commit removed for GSM8K at
`PHASE0-EVALS.md:88-92` ("GSM8K cap 4096 → 8192 … the probe cut reasoning models mid-think").
FLORES was left behind. At 1024 tokens even a single slow item on a 4-pair × 100-sentence
grid puts 6 items at 6 %.

Related conflation: a *truncated* answer is not a *wrong-language* answer. The metric
should count truncation separately (it already has the information) and either exclude
truncated items from the wrong-language denominator or report both rates.

Fix: `--max-tokens 2048` (or 8192 for parity with the other two runners), record
`finish_reason` per item, and count truncation as its own number.

### M3 — FLORES design limits (CONFIRMED, design choices, not bugs)

- **Direction**: EN→{IT,FR,ES,ZH} only. The product failure mode the rule is meant to
  catch is "the model answers an Italian user in English". A translation prompt is a weak
  proxy: it exercises copying + target-language decoding, not in-language instruction
  following. There is no X→EN and no IT-native instruction item anywhere in the gate, so
  an arm that keeps translation intact while losing Italian chat would sail through.
- **Pairing**: all four pairs are the *same* 100 English sources
  (`run_flores.py:97` `refs = [item["refs"][target] for item in items]`), so the four
  wrong-language rates are one measurement, not four; a single bad source (a name, a
  quotation, a 35-char sentence) can trip several pairs at once. With
  `min(source_en) = 35` chars, short-string LID reliability is the weak spot — I measured
  LID on truncated Italian refs down to 16 characters and it still classified correctly,
  but that is one sentence, not a systematic test.
- **Resolution**: 100 items ⇒ the 5 % rule has ±1 item = ±1 pp granularity and a
  binomial 95 % CI of roughly ±3 pp on a 5 % rate; 912 devtest sentences (and the 997
  dev sentences) are unused for free. The gold self-check (`run_flores.py:99-104`) is a
  genuine guard and its floor arithmetic `(9*n+9)//10` is correct (ceil).
- I verified the gold self-check is comfortable: **100/100 for it, fr, es and zh** with
  the real `lid.176.bin`.

### chrF++ settings and CJK — no bug found (my suspicion REFUTED)

`run_flores.py:104-106` uses `sacrebleu.sentence_chrf(..., word_order=2)` and
`corpus_chrf(..., word_order=2)`; on sacrebleu 2.6.0
(`CHRF(char_order=6, word_order=0, beta=2, lowercase=False, whitespace=False)`) that is
genuinely chrF++, and chrF is character-n-gram based, so **Chinese is not broken by a
missing tokenizer** — measured on the holdout: zh-vs-zh 100.0, English-as-hypothesis 4.18,
empty hypothesis 0.0. The `en-zh 22.49` in `PHASE0-EVALS.md:117` is a real
model-quality number, not a tokenization artifact. Two residual notes: chrF++ is
case-sensitive (`lowercase=False`), so an Italian/French answer that lowercases the
opening capital is charged for it (measured cost of a "Ecco la traduzione:" preamble on
one sentence: 95.7 vs 100.0 — real but small); and `bootstrap_ci.py` prints these as
`bpb en-it: …`, which is a label lie, not a maths error.

### GSM8K-IT — provenance verified, licence and contamination claims hold (mostly CONFIRMED)

Independently checked against the HF API, not the repo's word:

- `Eurolingua/gsm8kx` exists, public, MIT-tagged, and its current sha **is** the pinned
  revision `363d87617cd417b731dc860194a6935fd5ff49ae`; `gsm8k_IT_test.jsonl` exists at
  that revision (826,166 B) ✓.
- Downloaded (826 KB, to /tmp): **1319 rows** ✓ exactly as `build_gsm8kit_holdout.py:9`
  claims; `#### 18`-style answers ✓; all 100 committed items are present in the pinned
  file with matching answers and are genuinely Italian (60/100 carry Italian function-word
  markers, 0/100 read as English) ✓.
- Contamination: the calibration MATH domain uses **GSM8K train only**
  (`calib-v2/SOURCES.md:14`, `sources_v2.py:69`) and `calib-v2/evalsets.py:134-136` bans
  `openai/gsm8k` test, FLORES **dev+devtest**, `openai/openai_humaneval` and
  `evalplus/humanevalplus` @ the *same* revision `d32357cf…` as the new holdout ✓. So the
  new holdouts are covered by the ban screen at the source-problem level. Residual: the
  ban screen is textual on the **English** items, so it cannot see through the translation
  to an Italian GSM8K-train derivative. Low risk, worth one sentence in SOURCES.md.
- The rejection of `sapienzanlp/gsm8k_italian` as "a MULTIPLE-CHOICE reformulation of the
  TRAIN split" (`PHASE0-EVALS.md:33-35`) is an unsourced third-party claim about a dataset
  nobody here has read. PLAUSIBLE, unverifiable from here; the decision (Eurolingua) is
  the right one regardless.
- `build_gsm8kit_holdout.py:36` `float(tail) == float(tail)` is a NaN guard, correct, but
  a non-numeric tail (e.g. `"#### none"`) raises `ValueError` and kills the builder
  unhandled. Also `rng.sample(usable, 100)` samples the whole test split (not a
  prefix), which is the right choice.

### HumanEval+ provenance — verified (mostly CONFIRMED)

- `evalplus/humanevalplus` @ `d32357cf…` → `test.jsonl` LFS oid
  **`908377f1daf28dcb36846db73a5662b2e05a9907407c2696c89ad9d3b0b04492`**, 11,452,868 B —
  byte-for-byte the sha256 quoted at `PHASE0-EVALS.md:30` and stored in every row of the
  local `humaneval-164.jsonl` ✓. 164 rows, `canonical_solution` dropped ✓, `test` field
  is the merged EvalPlus `check()` (`import numpy as np`, one `def check(`) ✓.
- Chat-template/thinking handling for a reasoning model: `run_humaneval.py:130`
  `extract_code(THINK_RE.sub("", r["content"]), entry)` strips a closed block and takes
  the **last** fenced block. Correct for the fork's inline-`<think>` templates. The smoke
  proof never exercised it (H5).
- `evalplus` licence split (MIT problems / Apache-2.0 tests) is recorded per row ✓.

---

## 5. `PHASE0-EVALS.md` claims vs code

| # | claim (quote) | verdict | evidence |
|---|---|---|---|
| 1 | `PHASE0-EVALS.md:20` "`check_stop_rule.py` \| S1 stop rule, **fail-closed**" | **REFUTED** | B1: missing JSON ⇒ `VERDICT … GO`, exit 0 |
| 2 | `PHASE0-EVALS.md:147` "the fail-closed path (missing JSON ⇒ STOP) is the same code path" | **REFUTED** | There is no such path; the same code path returns GO |
| 3 | `docs/EVAL-GATE.md:99` "A missing JSON is a STOP." | **REFUTED** | as above |
| 4 | `docs/EVAL-GATE.md:80` "sockets disabled — the harness process never runs model code" | **REFUTED as containment; literally true as stated about the harness process** | H1: `curl`/`_socket`/absolute writes all work |
| 5 | `PHASE0-EVALS.md:84` "Re-scoring the stored raws reproduces the stored counts exactly (scorer determinism confirmed)" | **CONFIRMED (fact), weak (inference)** | I re-ran it: all 9 arms, `match=OK`; additionally `sum(items[].pass) == ok` and **0/1400 per-item disagreements** between the stored per-item `pass` and a fresh re-score. But re-running a pure function on the same strings proves the JSON was not edited after scoring; it cannot detect a defect present in *both* the stored text and the stored count, and it says nothing about the 4096-cap confound (which is the actual open question). "scorer determinism confirmed" is a tautology dressed as evidence. |
| 6 | `PHASE0-EVALS.md:85-87` "an UNCAPPED re-score is impossible from disk — `trunc_no_raw` items have nothing to score" | **CONFIRMED (fact), cause REFUTED** | Verified: per arm, `200 - raw_any == trunc_no_raw` exactly, and **every** no-raw item has `finish_reason == "length"` (`no_raw_notlen = 0` everywhere). So the text really is gone. But the stated cause (`PHASE0-EVALS.md:82-84` "the server returns mid-`<think>` content as reasoning, which the probe never saved") is a design choice that did not happen: the server's response *did* carry the truncated text in `content` (the harness records `finish_reason` from the server and the detector fired), the harness simply stores the final `content` string. The honest cause is "the raw HTTP response was never archived". Consequence: with `--reasoning-format none` (or by storing `reasoning_content`) future runs *would* keep the reasoning text and an uncapped re-score would be possible from disk. |
| 7 | `PHASE0-EVALS.md:109-112` "All proven end to end … real server, real outputs, real exit codes" | **PARTLY REFUTED** | The numbers reproduce exactly from `/tmp/smoke-eval` (humaneval 5/10 with the exact 5 error strings; chrF++ 51.9867/69.904/50.0206/22.4864; wronglang 0/10; gsm8kit 4/10, truncated 0; bpb it 0.97207). But (a) it was a **1.2B non-thinking** model, so no `<think>` code path ran anywhere (H5); (b) `check_stop_rule.py --arm X --base X` (`:136`) made the HumanEval clause vacuous (H2); (c) the 4 bootstrap "CI compatibility" runs are self-pairs (`A 0.9418 B 0.9418 diff +0.0000`) and prove only that the files parse; (d) the artifacts live in `/tmp/smoke-eval`, which is not in the repo, unlike the A40 results — the smoke evidence is one `rm -rf` from gone. |
| 8 | `PHASE0-EVALS.md:113-114` "2 × missing `typing` import (NameError)" | **INACCURATE** | the artifacts say `NameError: name 'List' is not defined` (the model annotated `List[float]` without importing `typing`) — a *model* failure of the same family, but not a missing import |
| 9 | `PHASE0-EVALS.md:139-143` the stop-rule transcript | **EDITED, NOT CAPTURED** | `/tmp/smoke-eval/stop_rule.log` has four separate `wrong-language en-XX:` lines; the report shows one composite `wrong-language en-{es,fr,it,zh}: 0.0%` line the code cannot print |
| 10 | `PHASE0-EVALS.md:29` "holdout builders with licence + sha256 pins" | **REFUTED for 2 of 3** | M1 below |
| 11 | `PHASE0-EVALS.md:15` FLORES builder "sha256-verified against the v3 corpus pins before writing" | **CONFIRMED** | `build_flores_holdout.py:45-48` compares and `sys.exit`s; I recomputed all five hashes against `scratchpad/agents/moe-expert-usage-v3/raw/corpus/flores/*.devtest` — all match; the committed holdout equals the first 100 `eng_Latn.devtest` lines exactly, no duplicates, mean length 139.9 vs 130.4 for full devtest (representative) |
| 12 | `PHASE0-EVALS.md:17` lid.176 "131,266,198 B, sha256-pinned" | **CONFIRMED** | local file is 131,266,198 B and `shasum` = `7e69ec5451bc261cc7844e49e4792a85d7f09c06789ec800fc4a44aec362764e`; 176 labels, `zh` present, no `zh-Hans`/`cmn` split (`wuu`/`yue` exist) — the label claim at `:44-45` is correct |
| 13 | `PHASE0-EVALS.md:19` "both bpb-shaped so the EXISTING bootstrap_ci.py pairs them unchanged" | **CONFIRMED** | `bootstrap_ci.py` consumed both files unmodified in the smoke run; the only defect is the printed label `bpb <pair>` (M11) |
| 14 | `PHASE0-EVALS.md:17-18` (run_humaneval.py:17) `finish_reason "length" … = FAIL` | **REFUTED** | M5 |

### M1 — the pins are decorative where it matters

`build_humaneval_holdout.py:34` computes `src_sha` and `:47,50` record/print it — there is
**no comparison against the documented pin** `908377f1…`. `PHASE0-EVALS.md:30` presents
that value as a pin, and `build_flores_holdout.py` shows what a real pin looks like
(`KNOWN_DEVTEST_SHA256` + `sys.exit`). `build_gsm8kit_holdout.py` has **no hash at all**.
Concrete failure: someone edits `REVISION`/`FILE` or the hub serves a different blob, the
builder cheerfully writes a new holdout, and the "pin" in the report is silently replaced
by whatever it computed — the provenance chain is self-certifying.

The value the gsm8kit builder should pin (measured from the pinned revision, 826,166 B):

```
gsm8k_IT_test.jsonl  sha256 5c846d406f59675f209d6581770e203296954b3201cc95507413fd840ba5b17d
```

---

## 6. Edge cases

| case | behaviour | verdict |
|---|---|---|
| empty model output (FLORES) | `reply or ""` → `""` → chrF++ 0 **and** wrong-language 1 | CONFIRMED — conflates "no answer" with "wrong language" (B4) |
| empty output (HumanEval) | `extract_code("")` ⇒ `None` ⇒ FAIL, `error="no function definition in the reply"` | correct, but the reason string is misleading for an empty completion |
| no code block at all | falls back to the raw text, requires `def <entry>` in it ⇒ FAIL | CONFIRMED by design (`run_humaneval.py:77-83`); note the raw-text fallback means a model that writes the function *without* fences is scored, not discarded — good |
| **CJK in chrF++** | chrF is char-n-gram based, no tokenizer bug; zh self-score 100.0, empty 0.0, English-as-hyp 4.18 | **no bug** (my suspicion refuted) |
| **short strings / LID reliability** | measured: truncated Italian refs down to 16 chars still classify correctly; 100/100 gold on all 4 languages | no bug at n=100; residual risk on 35-char sources is guarded by the ≥90 % self-check |
| timeout counted as fail | `return 124, "TIMEOUT after 60s"` ⇒ FAIL | CONFIRMED, documented, and the right call for loop-based plus-tests |
| **timeout leaves orphans** | direct child killed, grandchildren re-parented to init | CONFIRMED (M6) |
| truncated-but-complete HumanEval reply | **scored normally** — the docstring says FAIL, the code doesn't | CONFIRMED (M5) |
| HumanEval/FLORES partial failure | whole stage dies, zero output written | CONFIRMED (H4) |
| `finish_reason` from a reasoning template moved to `reasoning_content` | harness reads `content` only (`:57` flores, `:70` humaneval, `run_gen_eval.py:69`) | PLAUSIBLE (M10): harmless for the current templates (the A40 data proves the reasoning arrives inline), fragile otherwise |
| `PROBE_BPB_LANGS` without `it` | `bpb["it"]` ⇒ KeyError ⇒ exit 1 | accidentally STOP, no message (M9) |
| `humaneval.json` with `n=0` on both sides | `0.0 < -15.0` is False ⇒ GO | CONFIRMED (M9) |

---

## 7. Dead code and near-dead code

Almost nothing is truly dead — an AST pass over all seven new/edited scripts found **no**
unused imports, no unreferenced module constants and no uncalled functions. What is
effectively dead:

1. `eval/run_humaneval.py:144` `truncated = sum(...)` — stored in the JSON, never printed
   (its twin `run_gen_eval.py:196` prints it) and read by no script in the repo.
2. The per-item `error` field distinguishes "unclosed <think>" from "no function
   definition", but nothing aggregates the unclosed-think count — the signal that would
   tell you the 8192 cap is still too low is never computed for HumanEval (compare
   `run_gen_eval.py:196`, which does print its cap-hit count).
3. Thinking-handling logic exists in **three dialects**: `THINK_RE`/`UNCLOSED_THINK_RE` in
   `run_gen_eval.py` and again in `run_humaneval.py`, and plain string ops in
   `run_flores.py:59-62`. Three copies, three behaviours, one concept.
4. `podprobe/30_gate.sh:30-32` — the `note: … server-only` echo fires once per non-override
   flag; pure log noise (and M8).
5. `bootstrap_ci.py --resamples/--seed` are never tuned by any caller; 10,000 resamples ×
   164 items in pure Python is a few seconds per metric, and nobody uses the CI output in
   any decision recorded in the repo.
6. `eval/rescore_gsm8k_raw.py` is a one-shot forensic script now cited only in prose; its
   trailing unconditional advice paragraph prints even when every arm matched.
7. `run_gen_eval.py:28` usage string still advertises `--max-tokens 4096` as the default
   while `:35` explains that the gate passes 8192 — the CLI default and the gate default
   differ and the header only half-says so.
8. `eval/build_holdouts.py` remains the builder for `gsm8k-200.jsonl` + `tools-100.jsonl`
   while three new sibling builders appeared; there are now four ways to make a holdout
   and no single index. Not a bug, a trip hazard.

---

## Minimum I would fix before this runs on a pod

1. `check_stop_rule.py`: make missing/partial a real STOP (B1) **and** add a two-arm
   regression test for the 15 pp clause (H2).
2. `run_humaneval.py`: candidate before tests, de-shadowed `check`, sentinel for
   "tests ran" (B2).
3. `run_flores.py`: raise `--max-tokens` to the reasoning budget and separate truncation
   from wrong-language (B4).
4. `30_gate.sh` + `env.sh`: make the per-arm budget match the new stage list, or gate the
   new evals behind `PROBE_GEN_LIMIT`; stop `rm -f`-ing results on entry so a killed arm
   keeps what it earned (B3).
5. Add the two sha256 comparisons (`908377f1…`, `5c846d40…`) to the builders (M1).
6. Either run the eval children under `unshare -n` + rlimits + killpg, or rewrite the
   "sockets disabled" wording in `PHASE0-EVALS.md:91-96` and `docs/EVAL-GATE.md:80` (H1).
7. Add a pod-side `test -f "$EVAL/humaneval-164.jsonl"` (or a rebuild step) to `00_env.sh`
   next to the existing tokenizer checks (H3).
8. Use `sha256sum` in `fetch_lid176.sh` (M2), and `mv` `bench.txt` only after both benches
   succeed (M4).

## Could not verify from this machine

- The behaviour of the real Qwen3.6-35B-A3B under `/v1/chat/completions` (no model run):
  whether its template triggers `--reasoning-format auto` extraction, and its real token
  rate — both are what B4/B3 turn on.
- `llama-perplexity`'s runtime acceptance of `--override-kv`: the local build tree is
  currently broken (`libllama-perplexity-impl.dylib` vs `libllama-common.0.5.0.dylib`
  mismatch, rebuilt at `4dc4592b` after the smoke run). Verified in source instead
  (`common/arg.cpp:2940`, common parser ⇒ all tools accept it).
- `sapienzanlp/gsm8k_italian`'s actual content (the rejection rationale at
  `PHASE0-EVALS.md:33-35` is taken on faith).
- Whether the base IT bpb on `corpus/postcutoff` is anywhere near 0.75 — the threshold is
  absolute and its provenance is not recorded anywhere in the repo. The only data point in
  the tree is the 1.2B at 0.972. With no base value on record, nobody can say whether
  0.75 is generous or unreachable; that number should be in the report before the pod
  spends money.