# Hostile re-review pass 2 — FIXED resume scripts

**Stance:** attack-first. Trust nothing claimed in `review_fixes_applied.md` until proven on disk.  
**Scope:** read-only verification of claimed F01–F05, F07, F08, F17 fixes + residual paths that still (a) start quantize on bad Q8, or (b) mark DONE on bad KEXP.  
**Date:** 2026-08-10  
**Sources on disk:**
- `results/requant1c/watch_q8_gate.ps1`
- `results/requant1c/orchestrate_after_q8.ps1`
- `results/requant1c/run_quantize_1c_safe.bat`
- `results/spec_ladder/n2/n2_acceptance.py`
- `results/requant1c/hostile_review_resume_scripts.md` (prior)
- `results/requant1c/review_fixes_applied.md` (claims)
- Also read `results/requant1c/verify_kexp.py` (required to judge F02 DONE semantics)

---

## 1. Executive summary

Pass-1 **must-fix for “do not quantize wrong Q8 bytes” is real on disk**: both orchestrator and bat recompute full SHA256 and exact size against hard-coded expected values, and no longer treat `q8_gate.txt` as sole authority. Gate encoding, pid validation, disk free &lt; 25GB, mkdir lock, keep-awake AC apply, and n2 tokenizer hard-exit are also present. **However, “mark DONE only on good KEXP” is only PARTIAL**: `verify_kexp.py` almost never returns non-zero on logical failure (only crashes), and orch only soft-scans stdout for `EXP_BAD` / expert bad counts — **`dens_bad` and `missing_in_kexp` can still yield `ORCH=DONE` / `phase=A_QUANTIZE_DONE`**. Unsupervised quantize of Q8 is no longer the primary suicide path; unsupervised *trust of DONE* still is, for dense-type / missing-tensor failures.

---

## 2. Executive risk rating for unsupervised quantize NOW

### **MEDIUM**

**Why:** Bad-Q8 → quantize is closed for practical attacks (dual size+sha, fail-closed bat preflight). Residual unsupervised risk is (1) **false DONE** when KEXP has dense mismatches or missing tensors but experts look OK, (2) power keep-awake only partially enforced/rechecked, (3) ops foot-guns (stale `quantize.lock`, multi-orch noise, no power restore). Safe enough for **one supervised** quantize after human preflight; **not** safe to walk away and treat `ORCH=DONE` as proof of a fully good KEXP.

| Dimension | Was (pass 1) | Now (pass 2) |
|---|---|---|
| Quantize on wrong Q8 content | HIGH | **LOW** (dual re-sha + size) |
| Gate oversize false PASS | LOW | **LOW** (unchanged good) |
| Double-start quantize | MED–HIGH | **LOW–MED** (mkdir lock; residual stale lock / race fails closed) |
| False DONE on bad KEXP | HIGH | **MED–HIGH** (EXP_BAD gated; dens/missing not) |
| Power thrash | HIGH | **MED** (orch applies AC timeouts; no restore; watch/bat silent) |
| N2 tokenizer false acceptance | MED | **LOW** for F17 (exit 3) |

---

## 3. Verdict table — prior findings F01–F08, F17

| ID | Severity (orig) | Verdict | On-disk evidence | Notes |
|---|---|---|---|---|
| **F01** | CRITICAL | **FIXED** | `orchestrate_after_q8.ps1:54-61` re-size + fresh SHA256 vs `expectedSha`; `run_quantize_1c_safe.bat:55-70` independent size + fresh SHA before `llama-quantize`; expected `ba84af0f…bbc5` / `36903140320` hard-coded in both | Gate string alone is no longer sufficient. Bat refuses with exit 91/92. Orch aborts exit 11/12. Residual micro-TOCTOU after last hash → process open is theoretical only. |
| **F02** | HIGH | **PARTIAL** | `orchestrate_after_q8.ps1:99-117` checks `$vp.ExitCode -ne 0` → `ORCH=VERIFY_FAIL` exit 18; soft-match `EXP_BAD` / `experts ok/bad \d+ [1-9]` → `ORCH=VERIFY_CONTENT_FAIL` exit 19; DONE only at `:119-127` | **Hole:** `verify_kexp.py` has **no `sys.exit(nonzero)`** on `exp_bad`, `dens_bad`, or `missing` — only prints (script ends 0 on success path). Orch content gate **does not** match `dense ok/bad` or `missing_in_kexp`. Dense-type wrong KEXP can still get `ORCH=DONE`. |
| **F03** | HIGH | **FIXED** (ops residual) | `run_quantize_1c_safe.bat:22-27` `mkdir quantize.lock` atomic refuse exit 96; unlock `rmdir` at `:97` and failure paths; `orchestrate_after_q8.ps1:73-77` refuse if `llama-quantize` process already running exit 16 | Concurrent double-writer closed for normal races. **Residual (fail-closed):** crash after `mkdir` before `rmdir` leaves stale lock forever until human deletes dir. Not a bad-Q8 path. |
| **F04** | HIGH | **PARTIAL** | `orchestrate_after_q8.ps1:21-42` queries AC video/standby; applies `standby/monitor/hibernate-timeout-ac 0`; **hard-aborts only if post-check `VIDEOIDLE != 0`** (exit 15) | Watch/bat still do **not** enforce keep-awake. Post-apply **standby is not re-asserted** (only video). No finally-restore (claims correctly defer). Modern Standby edge cases still depend on scheme coverage of `powercfg /change`. |
| **F05** | HIGH | **FIXED** | `orchestrate_after_q8.ps1:63-66` free C: &lt; 25GB → exit 13; `run_quantize_1c_safe.bat:72-79` same → exit 90 | Logging-only hole closed. Residual: checks `Get-PSDrive C` only (paths are on C: in this layout — OK for this campaign). |
| **F06** | MED | **PARTIAL** (deferred OK) | `run_quantize_1c_safe.bat:29-32` refuse existing OUT exit 98 + human message; orch `:68-71` abort if KEXP exists exit 14 | No silent delete. Explicit human message present. Still no automated partial-vs-complete classification beyond existence. Acceptable per mandate. |
| **F07** | MED | **FIXED** | `watch_q8_gate.ps1:18-21` `UTF8Encoding($false)` + `WriteAllLines`; gate write `:77-82` uses it; orch pid/done writers use same helper | `findstr /B /C:"Q8_GATE=PASS"` no longer blocked by UTF-16 default from WinPS `Set-Content`. |
| **F08** | MED | **FIXED** | `watch_q8_gate.ps1:30-36` non-empty + `^\d+$` else `Q8_GATE=FAIL_PID` exit 5; `:38-43` require `ProcessName -match 'curl'` else treat not alive | Empty/garbage pid no longer throws into empty-gate limbo. PID-reuse false-alive residual (F09) still PLAUSIBLE, out of claimed-fix set. |
| **F17** | MED | **FIXED** | `n2_acceptance.py:88-97` `match` on tokens/merges sha16 + `pre=qwen35`; if `not match` or `"n=248320" not in str(ntok)` → print FATAL + `sys.exit(3)` **before** Llama load / VERDE path | F18 vocab size also enforced via `n=248320` string in tokens field. Cannot emit VERDE on wrong family anymore via this script’s main path. |

### Claim audit vs `review_fixes_applied.md`

| Claim | Accurate? |
|---|---|
| F01 bat + orch recompute SHA256 | **Yes** |
| F02 abort without DONE if verify exit ≠ 0 or EXP_BAD | **Mostly** — code present, but verify **rarely** non-zeros; dens/missing not covered |
| F03 quantize.lock + refuse if llama-quantize running | **Yes** |
| F04 orch enforces monitor/standby AC 0 | **Partial** — applies both; hard-fails only monitor post-check |
| F05 free disk &lt; 25GB aborts | **Yes** |
| F07 gate UTF-8 no BOM | **Yes** |
| F08 pid validation + curl name check | **Yes** |
| F17/F18 exit 3 on tokenizer / n≠248320 | **Yes** |

---

## 4. New findings (CONFIRMED / PLAUSIBLE only)

### N01 — **CONFIRMED** — HIGH (false DONE / KEXP quality)

**`verify_kexp.py` never fails the process on logical inventory failures.**

Evidence (`verify_kexp.py:44-80`): counts `exp_bad`, `dens_bad`, `missing`, prints `EXP_BAD` lines and `experts ok/bad` / `dense ok/bad`, then **ends without `sys.exit`**. Any non-exception path returns exit code **0**.

Impact: Orch’s “exit ≠ 0” branch (`orchestrate_after_q8.ps1:106-110`) is **dead for content failures**. Safety depends entirely on stdout soft-regex.

### N02 — **CONFIRMED** — HIGH (false DONE)

**Orch soft gate misses dense failures and missing tensors.**

Evidence:
- Soft check only: `orchestrate_after_q8.ps1:112-117`  
  `$vout -match 'EXP_BAD' -or $vout -match 'experts ok/bad \d+ [1-9]'`
- Verify prints dense problems as `dense ok/bad … dens_bad` and `missing_in_kexp N …` (`verify_kexp.py:40-42,70-71`) with **no** matching orch abort.

Attack / failure mode: quantize succeeds (exit 0), experts mostly/all Q2_K/Q3_K, but dense tensors diverge from IQ2_M reference or tensors missing → **still `ORCH=DONE` + `phase=A_QUANTIZE_DONE` + kexp.sha256 written**.

### N03 — **PLAUSIBLE** — MED (power / thrash)

**Standby not hard-gated after apply; only VIDEOIDLE rechecked.**

Evidence: `orchestrate_after_q8.ps1:29-42` sets standby+monitor+hibernate, then aborts only if `$vid2 -ne 0`. If standby apply silently fails / different subgroup, quantize still starts.

### N04 — **PLAUSIBLE** — LOW–MED (availability, fail-closed)

**Stale `quantize.lock` directory after crash blocks all future quantize** until human `rmdir`.

Evidence: `run_quantize_1c_safe.bat:22-27` mkdir; unlock only on clean paths. Cannot start *bad* quantize; can soft-brick campaign unattended recovery.

### N05 — **PLAUSIBLE** — LOW (integrity residual)

**TOCTOU window after bat’s last SHA and `llama-quantize` open.** Dual hash (orch + bat) shrinks the window; still no continuous integrity / open-by-handle hash. Practical exploit requires local write of exact-size collision or race replace — not realistic for 37GB without operator malice.

### N06 — **PLAUSIBLE** — LOW (status consistency)

**`status_A.txt` update before DONE is not hardened.**

Evidence: `orchestrate_after_q8.ps1:123-127` `Get-Content status_A.txt` with `$ErrorActionPreference = "Continue"` — missing/locked file can error non-terminating while `orch_done.txt` still written `ORCH=DONE`. Observer scripts that only trust `status_A` phase vs only `orch_done.txt` can disagree.

### N07 — **PLAUSIBLE** — LOW (F02 regex edge)

Expert-bad regex `experts ok/bad \d+ [1-9]` relies on verify’s exact print format (`verify_kexp.py:70`). Format drift / alternate messaging would re-open content-fail → DONE. Currently matches live printer. Prefer parsing `exp_bad` / forcing non-zero exit in verify.

---

## 5. Remaining attack paths

### A) Start quantize on a bad Q8?

| Path | Status |
|---|---|
| Oversize corrupt (49GB) → watch PASS | **Closed** — `watch_q8_gate.ps1:59-62` FAIL_SIZE |
| Undersize + curl dead | **Closed** — FAIL_EARLY_EXIT |
| Exact size, wrong bytes, live watch | **Closed** — FAIL_SHA |
| Stale/forged `Q8_GATE=PASS` + wrong bytes same size | **Closed** — orch re-sha exit 12; bat re-sha exit 91 |
| Stale PASS + wrong size | **Closed** — orch exit 11; bat exit 92 |
| Skip orch, run bat alone with forged PASS + wrong file | **Closed** if size/sha wrong (bat independent checks) |
| Two quantize writers | **Closed** for normal race — lock mkdir |
| Watch starts quantize | **Still impossible** — no quantize start in watch |

**Bottom line:** pipeline cannot start quantize on a **bad Q8** without either matching the expected SHA (i.e. it is the right file) or defeating filesystem integrity under the operator’s account. Pass-1 F01 critical path is **FIXED**.

### B) Mark DONE on a bad KEXP?

| Path | Status |
|---|---|
| `llama-quantize` non-zero exit | **Closed** — orch exit, no DONE (`:87-92`) |
| Exit 0 but KEXP missing | **Closed** — exit 17 (`:95`) |
| Exit 0, KEXP present, verify process crash | **Closed** — exit 18 |
| Exit 0, experts wrong types (`EXP_BAD`) | **Closed** — content soft gate exit 19 |
| Exit 0, experts OK, **dense wrong / tensors missing** | **OPEN** — N01+N02 |
| Exit 0, verify empty stdout, silent pass | **OPEN-ish** — empty `$vout` skips soft matches; exit 0 → DONE. Unlikely if verify runs, but no “must see experts ok/bad  … 0” positive proof required |

**Bottom line:** DONE is **not** a full certificate of KEXP structural quality. Expert-type failures are gated; dense/missing are not.

---

## 6. What would still block safe unsupervised run

Before treating this as walk-away-safe:

1. **Harden `verify_kexp.py` to non-zero exit** on any of: `exp_bad > 0`, `dens_bad > 0`, `missing` non-empty, `extra` unexpected, size bounds if mandated. Prefer exit codes over string scraping.
2. **Orch positive proof before DONE:** require stdout contains e.g. `experts ok/bad … 0` and `dense ok/bad … 0` and `missing_in_kexp 0` (or only trust verify exit after #1).
3. **F04 completeness:** re-check standby AC after apply; optionally hard-fail if either ≠ 0; document restore (`powercfg_restore.bat`) as mandatory post-campaign step (still not automated).
4. **Ops preflight (unchanged discipline):** one orch, no concurrent N2, free disk already gated in code, delete stale `quantize.lock` only if no quantize process, inspect any leftover KEXP before delete.
5. **Do not treat `ORCH=DONE` alone as promotion criteria** until N01/N02 closed — re-run verify manually and inspect `dense ok/bad` / missing lines.

Optional / lower:
- Watch keep-awake if watch runs long unattended before orch.
- Positive PID file health already improved (watch/orch write `watch-q8.pid` / `orch.pid` — F13 partially addressed outside original F01–F17 claim set: `watch_q8_gate.ps1:24-25`, `orchestrate_after_q8.ps1:18`).

---

## 7. Per-file hostile notes (delta from pass 1)

### `watch_q8_gate.ps1` — still the strongest file

- F07/F08 fixed as claimed.
- Still no quantize start (good).
- Still size+sha gate (good).
- Residual: F09 PID reuse; no keep-awake (watch can sit for hours).

### `orchestrate_after_q8.ps1` — integrity fixed; DONE semantics incomplete

- F01 size+sha recheck: **real**.
- F02 exit + EXP_BAD: **real but insufficient** given verify’s always-0 design.
- F04/F05: **real with noted partials**.
- Removed prior blind `Stop-Process` kill-all and broken `$heavy` gate from pass-1 snippets — reduces F11 collateral damage; tradeoff is no auto-clear of foreign quantize (now refuse — better).

### `run_quantize_1c_safe.bat` — much thicker proof layer

- Gate + lock + OUT exist + binary/imatrix/recipe + size + sha + disk: fail-closed stack.
- Trustworthy even if orch were compromised to only pass gate string (bat re-proves Q8).
- Stale lock is the main operational gotcha.

### `n2_acceptance.py` — F17 closed

- `sys.exit(3)` before model load on tokenizer/vocab failure.
- Remaining N2 issues (F15 multi-load, F19 offline metric assumptions, F20 run bias) out of this fix set — deferred correctly.

### `verify_kexp.py` — the silent hole under F02

- Good inventory diagnostics.
- **Not a gate.** Orch thinks exit codes mean quality; they don’t.

---

## 8. Summary judgment

| Question | Answer |
|---|---|
| Are claimed F01/F03/F05/F07/F08/F17 real on disk? | **Yes — FIXED** |
| F04? | **PARTIAL** (apply + monitor hard-fail; standby soft) |
| F02? | **PARTIAL** — DONE blocked for EXP_BAD / process fail; **not** for dens/missing |
| Can unsupervised run still quantize a bad Q8? | **No** (practical) |
| Can unsupervised run still mark DONE on bad KEXP? | **Yes**, for dense/missing structural fails |
| Unsupervised quantize NOW? | **MEDIUM** — OK for careful single run; fix N01/N02 before trusting DONE unattended |

**Do not trust `ORCH=DONE` as full KEXP certification until verify fails hard on dens_bad/missing. Q8 re-hash at quantize boundary is fixed — that was the campaign-killer.**

DONE
