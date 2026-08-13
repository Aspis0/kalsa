# moe-selfspec-f0

**Mandate:** `mandates/selfspec-f0-acceptance.md`  
**Method plan:** `results/selfspec_f0/METHOD_PLAN.md` (chosen: **EXACT-RESTART**; fallback **WINDOWED-W16** only if cost explodes)  
**Host:** PC only. No phones. No SSH.  
**STATUS:** `BLOCKED_PC` (`results/selfspec_f0/STATUS.txt`)  
**VERDICT:** **not PASS.** Not `SELFSPEC_DEAD` either. The gate number was never measured.

This report is written from the on-disk inventory the mandate asked for
(streams + acceptance CSV + summary + audit + mandate). Three of those
five artifacts **do not exist**. Inventing an acceptance rate would be a
lie. The lane is **blocked**, not open, not dead.

K4 on-device is the reason this PC lane is next. It is **not** a
substitute measurement.

---

## 0. Why this lane exists (K4 on-device FAIL)

K4-split N3 on S23 unplugged failed the speed gate. Split is correct
with the router pin and slower on every axis:

| median | ARM_CPU | ARM_SPLIT | ratio | source |
| --- | ---: | ---: | ---: | --- |
| decode tok/s | 2.901 | 2.025 | 0.698× | `reports/moe-k4-split.md:311` |
| TTFT s | 17.8 | 30.4 | 0.59× (worse) | `reports/moe-k4-split.md:312` |

Machine gate file:

```
N3_GATE=FAIL decode_ok=0 ttft_ok=0 decode_x=0.6979
```

(`results/k4split/n3_final/gate.txt:9`; STATUS
`results/k4split/n3_final/STATUS.txt:1` = `N3_FAIL_SKIP_N4`).

Mandate text: do not re-open GEMV kernels. This report does not.

---

## 1. Artifact inventory (what the writer actually had)

| required | path | present? | evidence |
| --- | --- | --- | --- |
| mandate | `mandates/selfspec-f0-acceptance.md` | yes | read this session |
| method notes | `results/selfspec_f0/METHOD_PLAN.md` | yes | status `PLANNED` at line 3 |
| assets | `results/selfspec_f0/ASSETS.md` | yes | setup 2026-08-13 |
| streams | `results/selfspec_f0/streams/*_target.*` | **NO** | `fact_target.pieces.json` does not exist |
| acceptance CSV | `results/selfspec_f0/acceptance.csv` and `acceptance/*.csv` | **NO** | file does not exist |
| summary | `results/selfspec_f0/summary.json` | **NO** | file does not exist |
| VERDICT | `results/selfspec_f0/VERDICT.txt` | **NO** | file does not exist |
| run master log | `results/selfspec_f0/run.master.log` | **NO** | file does not exist |
| RUN_META | `results/selfspec_f0/RUN_META.json` | **NO** | not written |
| audit of a completed run | `results/selfspec_f0/audit.md` or `reports/audit-selfspec-f0.md` | **NO** | neither path exists |
| waiter | `results/selfspec_f0/WAITER.txt`, `waiter.log`, `waiter.pid` | yes | armed, still `BLOCKED_PC` |
| PC busy snapshot | `results/selfspec_f0/PC_BUSY.txt` | yes | last write `2026-08-13T11:25:15` |

`list_dir` of `results/selfspec_f0/` this session: `ASSETS.md`,
`METHOD_PLAN.md`, `PC_BUSY.txt`, `STATUS.txt`, `WAITER.txt`,
`waiter.log`, `waiter.pid`, `waiter.stderr.log`, `waiter.stdout.log`,
`prompts/p_longfact.txt`, `prompts/p_code.txt`. No `streams/`, no
`acceptance/`, no `logs/`.

---

## 2. Audit of the run that was supposed to exist

Hostile read. Verdicts are CONFIRMED / PLAUSIBLE / REFUTED.

| claim | verdict | evidence |
| --- | --- | --- |
| A completed teacher-forced acceptance grid exists | **REFUTED** | no streams, no CSV, no summary, no `VERDICT.txt` |
| Pooled α ≥ 0.60 was measured → PASS | **REFUTED** | nothing to pool; `summarize_rows` never ran on real rows |
| Pooled α < 0.60 was measured → SELFSPEC_DEAD | **REFUTED** | same; epitaph would require a curve (`mandates/selfspec-f0-acceptance.md:30`) |
| The runner is allowed to start while LFM PPL is live | **REFUTED** | `mandates/selfspec-f0-acceptance.md:8-10`; `METHOD_PLAN.md:189-193`; waiter `scripts/run_selfspec_f0_when_idle.ps1:23-39` treats any `bmoe-cli.exe` as busy |
| PC is busy with a job we must not kill | **CONFIRMED** | `results/lfm25_kexp/PIPELINE_STATUS.txt:1` = `RUNNING_A0-Q4KM-k4`; `PC_BUSY.txt:3` `31872:pwsh.exe, 3888:python.exe, 35948:bmoe-cli.exe` |
| Live job is the KEXP 35B (same GGUF fight) | **REFUTED** | live model is `LFM2.5-8B-A1B-Q4_K_M.gguf` (`results/lfm25_kexp/A0-Q4KM-k4/A0-Q4KM-k4_multi5.json:5`) |
| RAM fight is still real | **CONFIRMED** | free RAM `FreePhysicalMemory_KB=13551532` (`PC_BUSY.txt:4`) = 13551532/2^20 ≈ 12.92 GiB; KEXP file is 13416430592 B = 12.495 GiB (`results/selfspec_f0/ASSETS.md:11-12`) plus `--cache-mb 2000` |
| Grid started then crashed | **REFUTED** | no `run.master.log`, no `STATUS=RUNNING` residue, no partial `streams/` |
| Waiter is still polling | **PLAUSIBLE / stale** | `waiter.pid` = `29680`; `waiter.log` last line is `2026-08-13T11:25:15` (`waiter.log:13-14`). Poll interval is 600 s (`run_selfspec_f0_when_idle.ps1:63`). No later line on disk. This session cannot see the process table. |
| `--ppl-csv` gold logprob recovers greedy acceptance | **REFUTED** (method) | `METHOD_PLAN.md:60-63`: CSV is `pos,token_id,logprob` of the gold token only; logprob is never 0 even when gold is argmax |
| Using `--mtp` / `--ngram` would answer this mandate | **REFUTED** | `METHOD_PLAN.md:18-22`: those draft from MTP head / n-gram table, not from `k=2` on the same weights |
| Heterogeneous scala-spec N2 numbers are this gate | **REFUTED** | `reports/moe-scala-spec.md` is draft-simple / draft-mtp vs a *different* target. Mandate is same-GGUF low-k vs full-k |

**Audit conclusion (CONFIRMED):** there is **no valid SELFSPEC F0 run**.
A missing run is invalid for PASS. It is also invalid for DEAD. Status
stays `BLOCKED_PC`.

---

## 3. Method (exact vs windowed)

**Chosen, not executed:** **EXACT-RESTART** (`METHOD_PLAN.md:78-158`).

What that means when the PC is free:

1. Target: one `--session` process, k=6, `--drop-cold-experts 0.65`,
   campaign flags, `--temp 0`, **no `--chatml`**, 4 prompts, `n_predict=300`,
   `clear_kv=true`, `think=false` (`METHOD_PLAN.md:95-125`;
   `scripts/run_selfspec_f0.py:101-133,569-590`).
2. Gold = ordered `BMOE_PROGRESS.delta_text` pieces, not retokenized
   full strings (`METHOD_PLAN.md:160-161`).
3. Draft: new process (k is process-level, `METHOD_PLAN.md:47-49`).
   For each mismatch, restart from `prompt + join(gold[:t])` and compare
   pieces. Match prefix = accept; first mismatch = reject; force that
   gold piece and continue. This is per-position teacher-forcing via
   restart-after-mismatch, not a windowed approximation
   (`METHOD_PLAN.md:136-158`).
4. Fallback **WINDOWED-W16** only if restarts explode
   (`METHOD_PLAN.md:171-183`; trigger in
   `scripts/selfspec_f0_lib.py:240-248`: `restart_id >= 24` and
   running exact α < 0.45 with ≥32 tokens left). Windowed rows must be
   labeled; mixing unlabeled EXACT and WINDOWED in the pooled gate is
   forbidden (`METHOD_PLAN.md:183`).

**What was actually run:** neither EXACT nor WINDOWED. Zero generate()
calls from `scripts/run_selfspec_f0.py --execute`. The waiter never
printed `PC idle` (`waiter.log` has only `START` / `still busy` /
`STATUS BLOCKED_PC`).

`--ppl-decode` is the right *compute* path inside the engine
(`METHOD_PLAN.md:51-53` cites `BigMoeOnEdge/core/src/engine/session.cpp:1911-2014`)
and the wrong *record* (no argmax / greedy-hit bit). Not used.

---

## 4. Prompts (armed, unused)

| id | path | size | sha256 | source |
| --- | --- | ---: | --- | --- |
| fact | `results/marco_phase1/speed_s23/prompts/p_fact.txt` | 361 | `b5301c32…dcbd` | `METHOD_PLAN.md:202`; `ASSETS.md:70` |
| creative | `results/marco_phase1/speed_s23/prompts/p_creative.txt` | 268 | `761db0d0…c871` | `METHOD_PLAN.md:203`; `ASSETS.md:71` |
| longfact | `results/selfspec_f0/prompts/p_longfact.txt` | 1202 | `24694e05…4f37` | `METHOD_PLAN.md:204`; `ASSETS.md:72` |
| code | `results/selfspec_f0/prompts/p_code.txt` | 1628 | `fc9467a3…baa8` | `METHOD_PLAN.md:205`; `ASSETS.md:73` |

No target `.txt` / `.jsonl` / `.pieces.json` exists for any id.

---

## 5. Per-prompt table

Primary draft config that the gate cares about: **k=2 drop 0.65**.
Secondary (if the runner had started): k=2 drop off. k=3 only if primary
pooled α < 0.60 (`mandates/selfspec-f0-acceptance.md:24`;
`METHOD_PLAN.md:243-244`; `scripts/run_selfspec_f0.py:831-841`).

| prompt | method | n_gold | n_eligible | n_accepted | α | join/reset excluded | k=3 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| fact | — | — | — | — | **not measured** | — | not run |
| creative | — | — | — | — | **not measured** | — | not run |
| longfact | — | — | — | — | **not measured** | — | not run |
| code | — | — | — | — | **not measured** | — | not run |

Pooled α is defined as `sum accepted / sum positions`, not the mean of
per-prompt rates (`METHOD_PLAN.md:221`; `scripts/selfspec_f0_lib.py:511-520`).

---

## 6. Pooled rate

| draft | n_positions | n_accepted | pooled α | MTP-style accept_rate at γ=4 |
| --- | ---: | ---: | ---: | --- |
| k=2 d0.65 (**primary / gate**) | — | — | **not measured** | **not measured** |
| k=2 drop off | — | — | **not measured** | — |
| k=3 d0.65 | — | — | **not measured** (not triggered) | — |

Gate (`mandates/selfspec-f0-acceptance.md:29-30`;
`scripts/selfspec_f0_lib.py:605-608`):

> pooled teacher-forced token acceptance (k=2 drop 0.65) ≥ 0.60
> at γ ≤ 4.

Primary implementation: `primary_alpha = n_accepted / n_eligible` on
`k2_d0.65` (`selfspec_f0_lib.py:519-527`). Stricter full-window
P(all 4 drafts accepted) ≥ 0.60 would need α ≳ 0.88 under independence
(`METHOD_PLAN.md:239-241`). That is **not** the primary gate.

---

## 7. Acceptance vs position

Required buckets: 0–49, 50–99, … (`METHOD_PLAN.md:222`;
`selfspec_f0_lib.py:494` → `position_buckets`).

| bucket | n | accepted | α |
| --- | ---: | ---: | --- |
| 0–49 | — | — | **not measured** |
| 50–99 | — | — | **not measured** |
| 100–149 | — | — | **not measured** |
| 150–199 | — | — | **not measured** |
| 200–249 | — | — | **not measured** |
| 250–299 | — | — | **not measured** |

No curve. No plot. No CSV column `pos`.

---

## 8. k=3

**Not run.** Trigger is k=2 d0.65 pooled α < 0.60
(`mandates/selfspec-f0-acceptance.md:24`). That α does not exist, so the
branch in `scripts/run_selfspec_f0.py:831-841` never executed. There is
no `acceptance/*_k3_*.csv` and no `logs/draft_k3_d065.*`.

---

## 9. Speedup model (STAND-IN only; no PC k2/k6 cell)

Independence model, labeled **MODEL not measured**
(`METHOD_PLAN.md:228-230`; `selfspec_f0_lib.py:91-98`):

```
E[tokens/step] = (1 − α^{γ+1}) / (1 − α)    for α < 1, else γ+1
t_step(γ)      = t_draft(γ) + t_verify(γ+1)
```

Stand-in used by the runner if speeds exist
(`selfspec_f0_lib.py:561-568`; `METHOD_PLAN.md:260-272`):

```
t_step = γ · t_k2 + (γ+1) · t_k6
```

`t_verify` as a **batched** k=6 verify of γ+1 positions is **not
implemented**. Arithmetic that pretends sequential k=6 decode is verify
must stay labeled STAND-IN.

**PC k=2 vs k=6 tok/s:** not measured. Files
`results/selfspec_f0/streams/speed_k2_n128.json` and
`speed_k6_n128.json` do not exist (`scripts/run_selfspec_f0.py:593-612`).
No PC tok/s is invented (`METHOD_PLAN.md:256-258`).

Device k=6 numbers already on disk — **not PC**, **not this run**:

| claim | value | source |
| --- | ---: | --- |
| S23 CPU k6d065 cache-2000 median tok/s | 5.861 | `reports/moe-adopt-kexp.md:59` |
| S23 CPU k6 cache-1000 N3 median tok/s | 2.901 | `reports/moe-k4-split.md:311` |
| S23 GPU-split k6 cache-1000 median tok/s | 2.025 | `reports/moe-k4-split.md:311` |

Without α and without a PC k2/k6 ratio, `E[tok/s]` and `speedup_vs_k6`
are undefined. Device k2 estimated from a PC ratio would be wrong anyway
(`mandates/selfspec-f0-acceptance.md:27-28`).

γ ∈ {2,3,4,5,6} table: **empty**. No empirical P(full γ accepted), no
mean accepted prefix length.

---

## 10. Assets the runner would have used (setup only)

| item | value | source |
| --- | --- | --- |
| binary | `build-pc/cli/bmoe-cli.exe` 332800 B | `ASSETS.md:29-30` |
| sha256 | `42cd907c38fb223d1b04c7070a0c9a6e3b200e186afc19439189651dcac74f69` | `ASSETS.md:32` |
| `--version` | 0.19.0 | `ASSETS.md:33` |
| model | `models/Qwen3.6-35B-A3B-KEXP.gguf` 13416430592 B | `ASSETS.md:10-11` |
| model sha this session | **not** recomputed (12.5 GiB read vs live PPL) | `ASSETS.md:14` |
| published model sha | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` | `quality/ppl_baseline.json:111` |
| runner threads | `-t 8` once PC idle | `scripts/run_selfspec_f0.py:59`; METHOD_PLAN used `-t 4` only while LFM held `-t 8` (`METHOD_PLAN.md:103`) |

Same binary sha is what the live LFM PPL is executing
(`A0-Q4KM-k4_multi5.json:3`). Do not kill it.

---

## 11. Why the grid has not started

Mandate: if MarcoKEXP / LFM2.5 PPL jobs are running, **wait**
(`mandates/selfspec-f0-acceptance.md:8-10`).

Last waiter snapshot (`results/selfspec_f0/PC_BUSY.txt`):

- time `2026-08-13T11:25:15`
- still busy: `31872:pwsh.exe, 3888:python.exe, 35948:bmoe-cli.exe`
- `FreePhysicalMemory_KB=13551532`
- `Grid NOT started.`

LFM cell in progress:

- `PIPELINE_STATUS.txt` = `RUNNING_A0-Q4KM-k4`
- cell started `2026-08-13T10:32:03-0400` (`A0-Q4KM-k4_multi5.json:65`)
- `en` finished rc=0, n_tokens=10816, ppl=27.639565
  (`A0-Q4KM-k4_multi5.json:45-50`)
- `es/` exists (`per_token.csv` present); not yet in the JSON `langs` map

Waiter: `scripts/run_selfspec_f0_when_idle.ps1`, pid file `29680`
(`waiter.pid:1`, `WAITER.txt:5`). It will call
`python scripts/run_selfspec_f0.py --execute` only after idle. This
report does not launch a competing grid and does not kill those PIDs.

---

## 12. Gate verdict

| question | answer |
| --- | --- |
| Pre-declared gate | pooled α ≥ 0.60 at γ ≤ 4 (`mandates/selfspec-f0-acceptance.md:29`) |
| Measured primary α | **none** |
| `VERDICT.txt` | **absent** (runner writes it only after real rows, `run_selfspec_f0.py:492`) |
| PASS_LANE_OPEN | **no** |
| SELFSPEC_DEAD | **no** (would require a measured α < 0.60 plus the curve) |
| Honest status | **`BLOCKED_PC`** |

Do not read scala-spec draft-mtp α=0.60 (`reports/moe-scala-spec.md:10`)
as this gate. Different draft, different target, different question.

---

## 13. Epitaph

**Not written.** The mandate says: below 60%, SELFSPEC is dead, write
the epitaph **with the curve** (`mandates/selfspec-f0-acceptance.md:30`).
There is no curve. Declaring the lane dead without α would be as false
as declaring PASS.

When the waiter sees an idle PC, the order is still
`METHOD_PLAN.md:274-285`: target streams → EXACT-RESTART k=2 d0.65 →
k=2 drop-off → k=3 only if needed → PC speed cells → CSV / summary /
this report / `STATUS=DONE` or `DEAD`.

---

## 14. What this report is not

- Not a phone measurement.
- Not a GEMV / k4-split kernel reopening.
- Not a `--mtp` / `--ngram` acceptance.
- Not a reuse of `results/spec_ladder/n2/` heterogeneous drafts.
- Not a PASS.

DONE
