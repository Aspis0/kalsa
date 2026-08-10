# Hostile review — post-crash resume scripts (1c + scala N2)

**Reviewer stance:** attack-first. Goal: prevent (a) corrupt 37GB Q8, (b) quantize on a bad file, (c) another unattended thrash crash.  
**Scope:** read-only review of the 9 listed paths. No project files modified.  
**Date:** 2026-08-10  
**Prior bug under regression test:** waiter declared COMPLETE on oversize corrupt (~49GB, wrong sha) and started quantize.

---

## Executive risk rating: **HIGH**

| Dimension | Rating | Why |
|---|---|---|
| False gate PASS on oversize / wrong size | **LOW** (fixed) | Watch breaks on `sz >= target` then **requires exact** `sz == 36903140320` + full SHA256. Prior oversize COMPLETE path is closed. |
| Quantize on wrong Q8 content | **HIGH** | Gate string + size recheck in orch; **no re-hash of Q8** before quantize. Stale/forged `q8_gate.txt` + same-size different bytes → quantize. Bat trusts gate file only. |
| Double-start quantize | **MED–HIGH** | Watch does **not** start quantize (good). Two orch instances / double-launch race bat `if exist OUT` before first process creates OUT → two `llama-quantize` on same path. No lock/mutex. |
| Campaign stuck / false DONE | **HIGH** | Orch marks `A_QUANTIZE_DONE` / `ORCH=DONE` **without checking `verify_kexp.py` exit**. Disk free only logged, never refused. Power keep-awake **not** enforced by any script. |
| N2 measurement validity / load risk | **MED** | IQ1_M reloaded many times; fixed port; tokenizer mismatch does not abort offline acceptance. |

**Run-as-is verdict:** acceptable for a **single carefully supervised** run of watch → one orch, after human confirms powercfg and free disk, and after ensuring no stale `q8_gate.txt` / partial KEXP. **Not safe for unsupervised multi-launcher / re-run** without the “must fix” items.

---

## Explicit answers (required)

### Can watch + orch double-fire quantize?

**No for the intended pair (one watch + one orch).**  
- `watch_q8_gate.ps1` L1 comment and body: **NO quantize** — only writes `q8_gate.txt` and updates `status_A.txt`.  
- Only `orchestrate_after_q8.ps1` L33 starts `run_quantize_1c_safe.bat`.

**Yes for two orch (or orch + manual bat) instances.**  
- No PID lock, no single-instance mutex, no check for already-running `llama-quantize` before start (only kill leftovers, then start).  
- Bat L20–23 refuses if `KEXP` **already exists**, but if both bats pass that check before either creates OUT → concurrent quantize writers.  
**Verdict: CONFIRMED separation watch≠quantize; PLAUSIBLE double-fire under multi-orch.**

### Can gate PASS on a wrong file?

| Wrong-file scenario | PASS? | Verdict |
|---|---|---|
| Oversize corrupt (49GB) | **No** — final `sz -ne $target` → `FAIL_SIZE` | CONFIRMED fixed |
| Undersize, curl dead | **No** — `FAIL_EARLY_EXIT` | CONFIRMED |
| Exact size, wrong content | **No** — SHA256 must equal expected | CONFIRMED (happy path) |
| Exact size + correct hash, then bytes swapped before quantize | **Orch will still quantize** — no re-sha | CONFIRMED TOCTOU |
| Stale `Q8_GATE=PASS` on disk + current file size ≠ target | Orch `exit 11` | CONFIRMED fail-closed on size |
| Stale/forged PASS + file exact size, wrong content | **Quantize runs** | CONFIRMED (orch/bat trust gate string) |

**Bottom line:** live watch gate cannot PASS a wrong file if hash runs on that file. **Pipeline as a whole can still quantize a wrong file** if the gate artifact is trusted without re-hashing Q8 at quantize time.

---

## Findings table

| id | severity | verdict | file:line | one-line fix |
|---|---|---|---|---|
| F01 | **CRITICAL** (integrity) | **CONFIRMED** | `orchestrate_after_q8.ps1:19-21` (+ bat trusts gate only) | Before quantize: recompute SHA256 of Q8 and require match to expected; refuse on mismatch (do not trust gate file alone). |
| F02 | **HIGH** | **CONFIRMED** | `orchestrate_after_q8.ps1:48-62` | Abort if `verify_kexp.py` exit ≠ 0; do not write `phase=A_QUANTIZE_DONE` / `ORCH=DONE` on verify fail. |
| F03 | **HIGH** | **PLAUSIBLE** | `orchestrate_after_q8.ps1:32-33` + `run_quantize_1c_safe.bat:20-23` | Single-instance lock (e.g. `quantize.lock` + exclusive create); refuse start if `llama-quantize` already running; create OUT via temp+rename or pre-create exclusive handle. |
| F04 | **HIGH** | **CONFIRMED** | all `.ps1`/`.bat` under review; mandate `ripresa-post-crash.md:46-50` | Scripts must apply `powercfg` keep-awake at start and restore from `powercfg_mitigation.txt` on exit (trap/finally); or hard-fail if monitor-timeout-ac ≠ 0. |
| F05 | **HIGH** | **CONFIRMED** | `orchestrate_after_q8.ps1:24-25` | If free disk (and preferably free on OUT volume) &lt; ~20–25 GB (14 GB out + temp + margin), **ABORT** before quantize — logging is not a gate. |
| F06 | **MED** | **CONFIRMED** | `run_quantize_1c_safe.bat:20-23` | Document + handle partial KEXP: refuse is correct, but orch should detect partial/corrupt leftover and exit with explicit “delete only after human OK” message (mandate: no silent delete). |
| F07 | **MED** | **PLAUSIBLE** | `watch_q8_gate.ps1:61-64` + `run_quantize_1c_safe.bat:5-9` | Write gate with `utf8NoBOM` (`Set-Content -Encoding utf8NoBOM` / .NET API). WinPS 5.1 default UTF-16 can make `findstr` miss PASS → fail-closed (safe but stuck). |
| F08 | **MED** | **CONFIRMED** | `watch_q8_gate.ps1:24-26` | Validate pid file (non-empty, parseable int); on parse failure write `FAIL_PID` and exit — do not throw with empty gate. |
| F09 | **MED** | **PLAUSIBLE** | `watch_q8_gate.ps1:24-27` + external curl launcher | Stale `dl-q8.pid` / PID reuse: false alive → hang forever; false dead → `FAIL_EARLY_EXIT` while a new curl writes. Prefer process name+command-line check or lockfile with start time. |
| F10 | **MED** | **CONFIRMED** | `orchestrate_after_q8.ps1:28-29` | Dead/broken “heavy process” detection (`$heavy` unused; filter always-true). Either enforce “no other heavy jobs” or delete. |
| F11 | **MED** | **CONFIRMED** | `orchestrate_after_q8.ps1:30` | Blind `Stop-Process` on `llama-server`/`llama-quantize` can murder a concurrent N2/legit job; gate on “we own this campaign” lock or refuse if foreign server is up. |
| F12 | **MED** | **PLAUSIBLE** | `wait_orch_done.ps1:2,30-31` | 6 h wall clock may be tight for remainder download + 37 GB hash + full 35B quantize. Raise deadline or make it configurable; treat timeout as “unknown” not pipeline success. |
| F13 | **MED** | **CONFIRMED** | `wait_orch_done.ps1:19-22` | `watch-q8.pid` / `orch.pid` are **never written** by the scripts under review. Health “pipeline dead” only works if an external launcher writes them — document or write PIDs from watch/orch themselves. |
| F14 | **LOW–MED** | **CONFIRMED** | `wait_orch_done.ps1:10` | `-match "FAIL"` is broad (any FAIL substring). Prefer `Q8_GATE=FAIL` anchor. |
| F15 | **MED** | **CONFIRMED** | `run_n2_measures.py:128-171` | Loads ~10 GB IQ1_M once per variant (ngram + mtp + dflash + up to 3 drafts = **up to 6 cold loads**). Reuse one long-lived server process or keep model resident; serialize and never overlap with quantize. |
| F16 | **MED** | **PLAUSIBLE** | `run_n2_measures.py:29-34,55-63` | Fixed port `18080`; no pre-bind check; 120×2s ready wait may be short for CPU load of IQ1_M (`-ngl 0`). Probe free port; increase ready budget; fail if bind error in stderr. |
| F17 | **MED** | **CONFIRMED** | `n2_acceptance.py:88-93,93+` | Computes `TOKENIZER_MATCH` but **does not exit** on false — continues and can emit VERDE/GIALLO/ROSSO on wrong tokenizer (Qwen3 0.6/1.7B class mistakes). `sys.exit(3)` unless match (and assert `n=248320`). |
| F18 | **MED** | **CONFIRMED** | `n2_acceptance.py:83-92` | Target checks sha16 + `pre=qwen35` but **not** explicit `n=248320` from mandate context. Parse `tokenizer.ggml.tokens` `n=` and require 248320. |
| F19 | **LOW–MED** | **PLAUSIBLE** | `n2_acceptance.py:130-177` | Offline alpha uses draft-only teacher forcing on gen text; never loads target IQ1_M. Valid only if gens are target outputs **and** tokenizer matches — document; do not treat as live draft acceptance without that assumption. |
| F20 | **LOW** | **CONFIRMED** | `n2_acceptance.py:146-157` vs `e_accept` | `all_runs` stores only completed non-zero runs; mean_run / e_accept biased (misses as zero-length runs omitted). Fix metric definition if used for go/no-go. |
| F21 | **LOW** | **CONFIRMED** | `run_n2_measures.py:14-16,44-45` | Dead: empty `PROMPTS`; empty `args += []` branch for draft-mtp. Remove or use. |
| F22 | **LOW** | **CONFIRMED** | `run_n2_measures.py:89` | Redundant `data.get("content") or data.get("content")`. |
| F23 | **LOW** | **CONFIRMED** | `run_quantize_1c_safe.bat` | No existence checks for imatrix / recipe / Q8 before start (fails late inside quantize). Preflight `if not exist` with clear exit codes. |
| F24 | **LOW** | **REFUTED** as quantize corruption vector | `watch_q8_gate.ps1:29` uses `-ge` then L41 `-ne` | Oversize no longer PASS. Keep both stages; do not “optimize” to only `-ge`. |
| F25 | **INFO** | **CONFIRMED** | `powercfg_mitigation.txt:37-44` | RESTORE docs exist; **no script calls restore**. Human-only → forgotten restore is likely (battery/display policy drift). |
| F26 | **INFO** | **CONFIRMED** | Privacy | No secrets/PII exfil paths in reviewed scripts. |
| F27 | **LOW** | **PLAUSIBLE** | `watch_q8_gate.ps1:29` + curl still open for final flush | Mitigated by requiring `-not $curlAlive` and 2s settle + re-size + sha. Residual: OS write-back not fsync’d — sha of stable length is still strong for completed curl. Accept residual. |
| F28 | **MED** | **CONFIRMED** | mandate vs code | Mandate requires size **and** sha (`ripresa-post-crash.md:20-23`). Watch implements both; **orch implements size only** — mandate incomplete at quantize boundary. |

---

## Attack checklist (detail)

### 1. Bugs — wrong gate, race curl vs size, false PASS, quantize without gate

| Claim | Verdict | Evidence |
|---|---|---|
| Oversize false COMPLETE (prior bug) | **REFUTED** on current watch | L29 break on `>=`, L41–45 exact size fail, L51–55 sha fail |
| Size==target incomplete last page | **Mostly REFUTED** | Curl dead + exact size + full SHA256; incomplete content fails sha |
| Quantize without gate | **REFUTED** for bat alone | `run_quantize_1c_safe.bat:5-9` findstr PASS required |
| Quantize without **fresh** size+sha proof | **CONFIRMED** | Orch L10–14 string match; L20 size only; no sha |
| Curl dies mid-file | **Handled** | Watch L30–34 `FAIL_EARLY_EXIT` |
| Orch proceeds on gate FAIL | **REFUTED** | L14 `Q8_GATE=FAIL` → exit 10 |

### 2. Race conditions

| Claim | Verdict | Evidence |
|---|---|---|
| Watch vs orch double-start quantize | **REFUTED** (watch never starts quantize) | watch has no Start-Process quantize |
| Two orch / two bat | **PLAUSIBLE** | No lock; bat exist-check not atomic with create |
| Concurrent curl writers | **Not prevented in these scripts** | Only one pid file watched; launcher not in set |
| Gate PASS while curl still writing | **REFUTED** | L29 requires `-not $curlAlive` |
| Orch kills N2 server mid-measure | **PLAUSIBLE** | L30 Stop-Process llama-server |

### 3. Edge cases

| Case | Verdict | Notes |
|---|---|---|
| Curl dies mid-file | **CONFIRMED handled** | FAIL_EARLY_EXIT |
| size==target wrong bytes | **Handled at watch** | sha; **not rechecked at orch** |
| Sha mismatch path | **CONFIRMED good** | FAIL_SHA, exit 4, log says do not quantize |
| Partial KEXP left | **Bat refuses** | exit 98; orch does not auto-clean (correct per mandate) but no explicit operator message |
| Empty/corrupt pid file | **PLAUSIBLE crash/empty fail path** | `[int]` cast L25 |
| Stale PASS gate + incomplete Q8 | **Size abort in orch** | exit 11 |
| Stale PASS + exact-size wrong file | **CONFIRMED bad quantize path** | F01 |

### 4. Performance (N2)

| Claim | Verdict |
|---|---|
| Loading ~10 GB IQ1_M thrice+ | **CONFIRMED** (up to 6×) |
| No / tight timeouts | **PLAUSIBLE** — completion 600s OK; server ready 240s may be tight for CPU IQ1_M |
| Port conflicts | **PLAUSIBLE** fixed 18080 |

### 5. Memory / crash risk

| Claim | Verdict |
|---|---|
| Parallel heavies (download+quantize+N2) | **Not enforced by code** — serialization is human/protocol only; orch kills some leftovers but does not check curl/build/pip |
| No disk space gate before quantize | **CONFIRMED** F05 |
| Power thrash 0x19C | **Scripts ignore keep-awake** F04 |

### 6. Privacy

**None expected / none found.** REFUTED as a concern for this set.

### 7. Power

| Claim | Verdict |
|---|---|
| Scripts ignore keep-awake | **CONFIRMED** |
| Restore forgotten | **CONFIRMED risk** — only txt notes; no finally-restore |

### 8. Dead code (last)

- `orchestrate_after_q8.ps1:28-29` — `$heavy` computed, never used; filter logic nonsense.  
- `run_n2_measures.py:14-16` empty `PROMPTS`.  
- `run_n2_measures.py:44-45` no-op `args += []`.  
- `run_n2_measures.py:89` duplicate `.get("content")`.

---

## Must fix before quantize

1. **F01 — Re-verify Q8 SHA256 in orch (and ideally bat) immediately before quantize**  
   Expected: `ba84af0f062c9f452e7d3bf8e3da4469cd4a9e3d26cdc56661e8b7aa04fcbbc5`  
   Size: `36903140320`  
   Do not treat `q8_gate.txt` as sole authority.

2. **F05 — Hard disk free threshold** before starting quantize (~20–25 GB free on output volume).

3. **F04 — Keep-awake**  
   Confirm (or set) `monitor-timeout-ac=0` and standby-ac=0 **before** unattended quantize; do not rely on a previous shell session’s memory. Restore after campaign per `powercfg_mitigation.txt`.

4. **F03 / ops — Single orch instance**  
   Do not launch two orchestrators. Prefer adding a lock before next unattended run.

5. **F06 — Inspect for partial `Qwen3.6-35B-A3B-KEXP.gguf`**  
   If present, bat will refuse (good). Human decides delete per mandate “non cancellare nulla senza ok”.

6. **F07 — If bat prints REFUSED after watch PASS**  
   Suspect UTF-16 gate file; rewrite gate UTF-8 no BOM or fix bat read.

7. **Human preflight**  
   - One curl, one watch, one orch.  
   - No concurrent N2 / llama-server.  
   - Confirm no stale PASS with a freshly replaced Q8 (when in doubt: delete gate, re-run watch only).

## Fix after phase A (quantize done)

1. **F02 — Honor verify_kexp exit** before `ORCH=DONE` (if not fixed pre-run, re-run verify manually before trusting KEXP).  
2. **F15–F16 — N2 driver**: model reuse, port hygiene, ready timeout.  
3. **F17–F18 — n2_acceptance**: hard-fail on tokenizer mismatch; assert `n=248320` + sha16 `49930cc8a75188cf`.  
4. **F13 — PID files** written by watch/orch for waiter health.  
5. **F10 — Remove or implement** heavy-process gate.  
6. **F12 — Waiter deadline** after measuring real quantize duration.  
7. **F25 — Restore powercfg** after campaign.  
8. Dead code cleanup (F21–F22, F10).

---

## Per-file notes (hostile)

### `watch_q8_gate.ps1` — **best file in the set**

- Correctly separates monitoring from quantize.  
- Exact size + full SHA closes the 49 GB false-COMPLETE bug.  
- Residual: pid handling, encoding of gate file, no fsync assumption (acceptable).  
- Status rewrite only patches `phase=` lines — OK.

### `orchestrate_after_q8.ps1` — **highest residual risk**

- Gate is a **string side-channel**, not a re-proof of bytes.  
- Size check is necessary but **insufficient** vs mandate.  
- Verify exit ignored → false phase complete.  
- Disk logged not gated.  
- Kill-all llama-* is aggressive.  
- Dead `$heavy` block shows unfinished safety intent.

### `run_quantize_1c_safe.bat` — **good refuse posture, thin proof**

- Gate findstr + refuse existing OUT = fail-closed instincts.  
- Does not independently prove Q8 size/sha, imatrix, recipe, or free disk.  
- BELOWNORMAL is appropriate for thrash reduction (not a substitute for powercfg).

### `wait_orch_done.ps1` — **observer only**

- Cannot start quantize (good).  
- Depends on external pid files that scripts don’t write.  
- 6 h timeout may strand operators with false “FAILED timeout” while quantize still runs.

### `run_n2_measures.py` — **serialize after A; expensive**

- Correctly documented “AFTER 1c phase A”.  
- No code barrier against running during quantize.  
- Multi-load IQ1_M is the dominant cost/risk for RAM/disk thrash.  
- Does not validate draft tokenizer vs n=248320 / sha16.

### `n2_acceptance.py` — **tokenizer check toothless**

- Has the right target sha16 for tokens (`49930cc8a75188cf`) and merges + `qwen35` pre.  
- **Continues on mismatch** — exactly how wrong Qwen3 small drafts poison results.  
- Offline metric ≠ live server acceptance without clear gens provenance.

### `powercfg_mitigation.txt` / mandates / crash note

- Root cause and mitigation narrative are coherent and match each other.  
- Gap: **automation does not implement the mandatory mitigation** written in the mandate. That is an operational foot-gun, not a doc error.

---

## Residual residual (accepted / out of scope)

- SHA256 collision for a forged 37 GB stand-in: practical risk ~0.  
- Bit-rot after hash and before quantize without swap: rare; re-hash at orch fixes.  
- External curl launcher / how `dl-q8.pid` is written: not in file set — assume operator discipline.  
- `verify_kexp.py` body not in review set — orch must still check its exit code.

---

## Summary judgment

The **watch gate is a real fix** for the bug that almost wrecked the campaign (oversize COMPLETE → quantize).  
The **orchestrator is still one stale PASS file away from quantizing the wrong bytes of the right length**, and it will celebrate phase A even if KEXP verification fails.  
Power and disk are **policy, not code**.  
N2 will hammer the machine with repeated 10 GB loads and will not hard-stop on wrong tokenizers.

**Do not multi-launch. Re-hash Q8 at quantize boundary. Keep-awake on. Disk free gated. Then quantize once.**

DONE
