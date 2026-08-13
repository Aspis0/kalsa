# Hostile audit — `results/s23_idle_ideas` scripts

Scope: `run_typeahead.sh`, `run_phase2b.sh`, `push_and_run.ps1` (and the `run_all.sh` wrapper that the ps1 bakes).  
Method: line-by-line, removed-behavior, cross-file, then the mandated attack list.  
Verdicts: CONFIRMED / PLAUSIBLE only. REFUTED attacks are at the bottom.

Sources used on disk (no fabricated device numbers): scripts themselves; `tools/kvdiag_patch.py` (quotes `session.cpp`); `reports/moe-kv-reuse-fix.md`; `reports/moe-adopt-dropcold.md`; `reports/moe-calaqwen-xiaomi.md`; `reports/moe-k4-split.md`; `results/marco_phase1/speed_s23/prompts/p_fact.txt`. `session.cpp` is **not** in this repo; `chat_on` gating is taken from the campaign's own quoted copy.

---

## BLOCKER / CONFIRMED

### 1. Typeahead cannot measure incremental prefix prefill with this session protocol
**`run_typeahead.sh:235-237,384-398,475-481`** + `tools/kvdiag_patch.py:18-27`

What is wrong: steps 1–5 send the **entire** growing document as `cmd=generate` / `prompt=Pn` / `n_predict=1`. Session KV reuse is explicitly **chat-mode only**:

```text
// Reuse the KV prefix already decoded from earlier turns (chat mode only)
if (chat_on && !im.kv_tokens.empty()) { ... n_common ... }
```

Two exhaustive branches, both fatal to the typeahead claim:

- **`chat_on=0`** (likely: FLAGS omit `--chatml`; every working KV-reuse cell in this repo used `--chatml --session` together; KVDIAG logs show `chat_on=1` only on those runs). Then `n_common` stays 0 and every step is a full re-prefill. `clear_kv=false` is a no-op. Step 5 vs step 6 (control) will look the same. GROW2's own criterion (“if `n_prompt` jumps to the full document, the KV prefix did not match”) will fire even if the byte prefixes are perfect.
- **`chat_on=1`** (if `--session` implies chat, or the binary defaults it on). Then each `generate` **appends a new user turn** whose body is the whole `Pn`, not “the newly typed suffix”. After the KV-reuse fix, `n_common = |kv_tokens|` and `n_prompt ≈ tokens(Pn)` plus template, **not** `tokens(GROWn)`. That is multi-turn chat, not typeahead. Product typeahead needs *replace the current typed prefix and prefill only the delta*.

Failure scenario: P0⊂P1⊂…⊂P5 on disk, `clear_kv` correctly false on steps 1–5, control present — and the CSV still shows full-document `n_prompt` every row. Author concludes “typeahead is not worth wiring”. That conclusion is about the **wrong API**, not about incremental prefill.

Required fix:
- Do not use chat-append `generate` for this idea.
- Need a raw prompt-replace / prefill path that prefix-matches `tokenize(prompt)` against `kv_tokens` even when `!chat_on`, **or** a dedicated session command that *replaces* the current user text.
- Acceptance: `n_prompt` on `growN` stays near `tokens(GROWn)` (plus at most a BPE-boundary token), not near `tokens(Pn)`.
- Do not interpret “full `n_prompt`” as “prefix compare failed” until `n_common` / first-divergence is logged (the KVDIAG fields already exist for this).

---

### 2. `n_predict=1` forces a non-prefix KV and `seq_rm` on a hybrid SSM model
**`run_typeahead.sh:393,475-481`** + `reports/moe-kv-reuse-fix.md:84-93`

What is wrong: after step 0, KV is `tokenize(P0) + [optional `<think>` span] + T_gen`. Step 1's tokens are `tokenize(P0+GROW1)`. Those sequences **diverge after P0**. Qwen3.6-35B-A3B is hybrid attention+SSM (`qwen35moe`). Campaign already documented: `llama_memory_seq_rm` at an intermediate position can refuse; fallback **zeros the whole KV**. The only path that avoided `seq_rm` was append-only chat where `n_common = |kv_tokens|`.

Qwen3.6 also emits an empty think span even with `--no-think` (`reports/moe-kv-reuse-diagnosis.md`). Those tokens sit in KV and are not in the next raw prompt.

Failure scenario: prefix compare finds `n_common = |P0|`, `seq_rm` of the 1-token (plus think) tail fails, KV reset, `n_prompt = |P1|`. Same CSV shape as “reuse broken”. GROW2 mis-diagnoses it as “prefix did not match”.

Required fix:
- Prefill-only (`n_predict=0` if the engine allows a non-no-op) or a `prefill` command that does not commit generated tokens.
- If one probe token is mandatory, it must be rolled back *and* that rollback must be proven on this hybrid memory (log `seq_rm` rc). Until then this is not a typeahead measurement.

---

### 3. `MemFree < 300 MiB` abort will kill the 35B typeahead run during legitimate residency
**`run_typeahead.sh:18,130-140,259-288`** + `reports/moe-adopt-dropcold.md:67,102-109,154`

What is wrong: watchdog aborts after 3×2 s of `MemFree < 300000 kB`. On this exact 35B / `--cache-mb 2000` / S23 8 GB workload, cited `memfree_min` is **13–52 MiB**. A 100 MiB MemFree guard already produced three **ABORT_MEM false-positives**; they had to retry with kill-on-mem disabled. This script's floor is **300 MiB**, i.e. stricter.

Campaign lesson elsewhere: `reports/moe-calaqwen-xiaomi.md:59` — “MemAvailable guard 300 MiB / 60 s **(never MemFree)**”.

Failure scenario: preflight passes (35B not loaded, MemFree high) → bmoe mmap+cache-2000 → MemFree collapses to tens of MiB → watchdog writes `ABORT_MEM` and SIGTERM → no typeahead rows. Wrapper then starts phase2b (see #4).

Required fix:
- Do not use a 300 MiB **MemFree** floor on 35B cache-2000. Use MemAvailable (300 MiB sustained) or a MemFree floor that matches LMKD-imminent (tens of MiB), per prior campaign evidence.
- If the mandate text really wants MemFree 300 MiB, the 35B typeahead cell is **unrunnable** and must be dropped or resized — do not ship a harness that can only abort.

---

### 4. Wrapper order typeahead → phase2b + MemFree 300 MiB makes phase2b abort after 35B
**`push_and_run.ps1:83-92`** + `run_phase2b.sh:112-123`

What is wrong: `run_all.sh` always runs typeahead then phase2b. After 35B exits, the KEXP GGUF (~11 GiB) stays in page cache. MemFree stays depressed; MemAvailable would recover. Phase2b `guardrail preflight` uses MemFree and will `ABORT_MEM`.

Failure scenario: typeahead dies in #3 (or even completes and unmaps) → phase2b preflight sees MemFree < 300000 kB for two samples → `ABORT_MEM` → no 2B cells. The only experiment that might have fit in RAM never runs.

Required fix:
- Run **phase2b first**, then typeahead.
- Or wait on **MemAvailable** (not MemFree) before phase2b.
- Wrapper must not treat a child `ABORT_*` as a green light to start the next heavy job without a memory reclaim check.

---

### 5. Wrapper reports ALL=DONE / host exit 0 when both children failed
**`push_and_run.ps1:83-92,170,201-202`**

What is wrong: `run_all.sh` writes `DONE` after both scripts regardless of `ec1`/`ec2`. Host poll breaks on `ALL:DONE` and exits 0.

Failure scenario: typeahead `ABORT_MEM`, phase2b `ABORT_MEM` (or `FAIL_CLI`) → `ALL.exit` has non-zero ECs, per-script `STATUS.txt` is `ABORT_*`, but `HOST_STATUS.txt=DONE` and `push_and_run.ps1` exit 0. Easy to file as a completed campaign.

Required fix:
- Wrapper writes `FAIL` (or `DONE_WITH_FAIL`) unless both ECs are 0.
- Host must read `typeahead/STATUS.txt`, `phase2b/STATUS.txt`, and `ALL.exit`; exit non-zero if any is not `DONE`.

---

## WARNING / CONFIRMED

### 6. Phase2b can record speed numbers while plugged / hot / under 300 MiB
**`run_phase2b.sh:236-291,287-291,298-322`**

What is wrong: guardrail is **only before** a cell. `run_cell` snapshots battery after the cell and **always returns 0**. No watchdog. No post-cell abort on plug / temp / MemFree. HANDOFF runs `HANDOFF_GPU_PP` then `HANDOFF_CPU_TG` with **no** guardrail between them. After the last cell, `STATUS=DONE`.

Failure scenario: charger connected mid-`GPU_PP` (or mid-HANDOFF) → cell timings land in `cells.csv` with `plugged=PLUGGED_AC` → next guardrail may abort later cells, but the plugged row is already in the CSV and the run can still end `DONE` if it was the last cell. Mandate: speed only while `plugged=UNPLUGGED`, temp≤45 °C, MemFree (or Available) not in the abort band.

Required fix:
- Mid-cell watchdog (same as typeahead) for plug / temp / MemAvailable.
- After every cell: abort (do not `DONE`) if plug ≠ UNPLUGGED or temp>45 or mem floor breached.
- Do not write a citabile row for a cell that finished off-mandate; mark the CSV `rc` / a `valid` column.
- Guardrail between HANDOFF_GPU_PP and HANDOFF_CPU_TG.

---

### 7. Typeahead watchdog fail-open on battery API + no thermal + can hang
**`run_typeahead.sh:259-307,460-472`**

What is wrong:
- Watchdog calls `termux-battery-status` **without** the 5 s `timeout` that `batt_json()` uses (`:265` vs `:70-76`).
- `plug=?` or empty → ignored (`:291-292`).
- `pct=0` (parse fail) → batt abort skipped (`:301`, requires `pct>0`).
- **Temperature is never checked** in the watchdog. Post-step checks plug / batt / mem, **not temp** (`:460-472`).
- A step may run up to `STEP_TIMEOUT_S=1800`.

Failure scenario: `termux-battery-status` hangs → watchdog stuck → no MemFree abort, no plug abort, for up to 30 min per step, while the main loop keeps sending generates. Or battery JSON fails (`plug=?`, `pct=0`) while the user plugs in → measuring plugged. Or die/batt temp 50 °C during a long prefill → no abort until (maybe) the next pre-step guardrail.

Required fix:
- Watchdog must use `timeout 5 termux-battery-status`.
- Treat missing/bad JSON as abort (fail-closed), same as `guardrail`.
- Abort on temp>45 °C in watchdog **and** post-step.
- Post-step thermal check.

---

### 8. `exec 3>"$REQ_FIFO"` can hang forever before any watchdog exists
**`run_typeahead.sh:248-257`**

What is wrong: writer-open on a FIFO blocks until the reader opens. Watchdog starts **after** this line. If `bmoe-cli` dies before opening stdin (missing `.so`, bad `LD_LIBRARY_PATH`), the script hangs with `STATUS=RUNNING`. Host waits up to 240 min, then pulls.

Failure scenario: wrong lib path → bmoe exits immediately → `exec 3>` blocks → no `BMOE_READY`, no `ABORT_*`, wrapper never reaches phase2b until host timeout.

Required fix: open the FIFO with a timeout (`timeout 30 bash -c 'exec 3>fifo'`) or start a load-watchdog before the open; if `BMOE_PID` is dead, fail `FAIL_LOAD`.

---

### 9. Host preflight MemFree fail-open if parse is 0
**`push_and_run.ps1:126-133`**

What is wrong: `$mf` defaults to 0; abort only if `$mf -gt 0 -and $mf -lt 300000`. Unparsed `/proc/meminfo` (or awk print missing) → launch anyway.

Failure scenario: preflight ssh output wrapping breaks the `--- mem ---\s+(\d+)` regex → `MemFree_kB=0` logged → device starts into a low-RAM condition. Device scripts may still abort; host should not.

Required fix: if MemFree cannot be parsed, `Die ABORT_MEM` (fail-closed), same as unknown `plugged`.

---

### 10. Phase2b `STATUS=DONE` even if every llama-cli cell failed
**`run_phase2b.sh:263-291,322-324`**

What is wrong: `run_cell` swallows `rc` into the CSV and returns 0. Empty timing fields + `STATUS=DONE`.

Failure scenario: OpenCL `ngl 99` crashes, CPU cells get `prompt eval` parse miss → `cells.csv` full of blanks → host sees DONE.

Required fix: fail the script (or write `PARTIAL`) if any required cell has empty `prompt_eval_ms` / non-zero `rc`. GPU cells that fail OpenCL must not be silent.

---

### 11. Cross-binary busy check is one-sided — two models can be loaded
**`run_typeahead.sh:228-231`**, **`run_phase2b.sh:173-176`**, **`push_and_run.ps1:138-145`**

What is wrong: typeahead only refuses `bmoe-cli`; phase2b only refuses `llama-cli`. Wrapper starts phase2b even if typeahead cleanup left a live 35B. Host checks both **only at launch**.

Failure scenario: typeahead `cleanup` TERM/KILL races (child threads, DSO still mapped) or `BMOE_PID` empty after a partial fail → phase2b starts 2B OpenCL while 35B is still resident → OOM / reboot (mandate: abort if MemFree < 300 MiB **or phone reboots**).

Required fix: both scripts `pgrep` **both** binaries (and refuse). Wrapper must wait until `bmoe-cli` is gone before phase2b. Do not start phase2b if typeahead's `bmoe.pid` is still alive.

---

## WARNING / PLAUSIBLE

### 12. `pgrep -f 'bmoe-cli'` / `pgrep -f '/llama-cli '` may self-match
**`run_typeahead.sh:228`**, **`run_phase2b.sh:173`**

`push_and_run.ps1:138-145` already filters lines matching `pgrep` because **this device's** `pgrep -af` lists itself. Typeahead's `pgrep -f 'bmoe-cli'` does not exclude self. Phase2b's second clause is `pgrep -f '/llama-cli '` (pattern appears on the pgrep cmdline).

Failure scenario: script aborts `FAIL_BUSY` on a quiet phone and never measures. Not confirmed without a Termux `pgrep` self-match trial; host-side filter is evidence the author already hit this.

Required fix if confirmed: `pgrep -x` / `pgrep -f '[b]moe-cli'` / `pgrep -f '/llama-cli -'` and exclude `$`.

---

### 13. BMOE_READY / BMOE_DONE may sit in fully-buffered stdout
**`run_typeahead.sh:252,312-329,345`**

Stdout is a file. libc full-buffers. If `bmoe-cli` does not `fflush` after `BMOE_READY`/`BMOE_DONE`, the harness waits until `READY_TIMEOUT_S=900` / `STEP_TIMEOUT_S=1800` or process exit. Prior harnesses worked, so the binary likely flushes — not proven from these files.

---

### 14. First GPU cell includes OpenCL compile / warmup
**`run_phase2b.sh:246-248,302-303`**

No discard run, no `--no-warmup`. `GPU_PP` (first `ngl 99` process) can include kernel JIT. `HANDOFF_GPU_PP` is cleaner. Do not cite `GPU_PP` wall/`prompt_eval` as steady-state without a discarded prime.

---

### 15. Host 240 min budget vs worst-case typeahead timeouts
**`push_and_run.ps1:7,176-179`** + `run_typeahead.sh:21-22,475-481`

7 × 1800 s + 900 s ready ≈ 225 min before phase2b. A hung first step plus phase2b overruns. Host then `TIMEOUT` and pulls partial — it does **not** kill remote (good). PLAUSIBLE incomplete pull interpretation if someone treats `TIMEOUT_PULLED` as a full matrix.

---

## NITPICK / CONFIRMED (cleanup)

### 16. Duplicated battery / mem helpers
`batt_json` / `batt_fields` / `guardrail` copied between the two `.sh` files. One sourced helper. Lower priority than the blockers.

### 17. Typeahead skips `lib_campaign_pin.sh`
Campaign process required a pinned sha on `bmoe-cli.CAMPAIGN`. This harness logs sha after the fact but does not `assert_campaign_pin`. Not a measurement lie; it is how silent binary drift happened before (`PLAN.md` around the CAMPAIGN pin).

---

## Mandated attack list — verdicts

| Attack | Verdict | Where |
|---|---|---|
| Measuring plugged | **CONFIRMED** for phase2b (no mid-cell / no post abort / HANDOFF gap). **PLAUSIBLE** for typeahead if battery API hangs or returns `?`. Host preflight is fail-closed on plug. | #6, #7 |
| No MemFree abort | **REFUTED** as “missing”: typeahead has preflight + per-step + 3-sample watchdog; phase2b has preflight + pre-cell 2-sample; host has preflight. **CONFIRMED** that phase2b has **no in-cell** abort, host fail-opens on `mf=0`, and the 300 MiB **MemFree** floor is the wrong metric and self-kills 35B (#3–#4, #6, #9). | #3, #4, #6, #9 |
| Typeahead `clear_kv` always true (fake reuse) | **REFUTED**. `:475-481` is `true,false,false,false,false,false,true`. `emit_req` (`:395`) sets `"clear_kv": sys.argv[2] == "true"`. Reuse is faked by **chat_on / protocol / n_predict=1**, not by the flag. | #1, #2 |
| 35B `-ngl 99` sneaking back | **REFUTED**. Typeahead: 35B via `bmoe-cli.CAMPAIGN`, no `-ngl`. Phase2b: `Qwen3.5-2B-Q4_K_M.gguf` only (`:137-149`), `ngl 0/99`. K4 35B GPU-prefill stays closed (`reports/moe-k4-split.md:311-326`). | — |
| Two models loaded at once | **PLAUSIBLE**, not on the happy path. Wrapper is sequential; missing cross-`pgrep` and no wait-for-bmoe-dead before phase2b. | #11 |
| Killing bmoe on PC | **REFUTED**. Only `ssh u0_a344@192.168.1.152`. No `Stop-Process`, no localhost ssh, no PC pgrep. | `push_and_run.ps1:14-27` |
| Xiaomi host | **REFUTED**. Hardcoded `192.168.1.152`. No `192.168.1.193` / `192.168.1.82`. | `push_and_run.ps1:14` |
| Prompt growth that is not a prefix | **REFUTED** for the **strings**: `P0⊂P1⊂…⊂P5` (`:194-199`), CHUNK0 matches `p_fact.txt`. **CONFIRMED** for the **KV sequence**: `n_predict=1` (+ think) makes KV not a prefix of the next prompt; chat-append makes each `Pn` a new turn, not a typed prefix. | #1, #2 |
| Missing control full-prefill | **REFUTED**. `run_step 6 7 control true "$P5"` (`:481`). Useless as a typeahead control if every prior step was already a full prefill (#1). | — |
| Using GPU TG as if KV were handed off from GPU PP | **REFUTED**. Separate `llama-cli` processes, different prompts (`prompt_pp.txt` vs `prompt_tg.txt`). Comment at `:314` is honest: “Thermal only; KV not shared.” CSV keeps `prompt_eval_*` and `eval_*` apart. Do not later interpret `GPU_TG.eval_tps` as decode-after-`GPU_PP`. | — |

---

## Required fixes (CONFIRMED only)

1. **Typeahead protocol:** raw prompt-replace / prefill API with prefix match on `!chat_on`; do not send full `Pn` as a new chat turn. Log `n_common` / first divergence. Acceptance = `n_prompt ≈ tokens(GROWn)`.
2. **Stop `n_predict=1`** (or prove `seq_rm` of the probe+think tail on this hybrid SSM). Prefill-only.
3. **Replace MemFree 300 MiB** with MemAvailable 300 MiB sustained (or a MemFree floor that 35B can actually live under). Otherwise delete the 35B cell — it cannot finish.
4. **Run phase2b before typeahead**, and wait on MemAvailable + `!pgrep bmoe-cli` before the second job.
5. **Wrapper/host must not report DONE** unless both child `STATUS.txt` are `DONE` and ECs are 0.
6. **Phase2b watchdog + post-cell abort** on plug / temp>45 / mem floor; guardrail between HANDOFF cells; do not `DONE` on empty/failed timings.
7. **Typeahead watchdog:** `timeout` on battery, fail-closed on bad JSON, check temp, check temp post-step.
8. **Timeout the FIFO open**; fail if bmoe is already dead.
9. **Host:** fail-closed if MemFree cannot be parsed.
10. **Both scripts pgrep both binaries** before load.

Until 1–3 are fixed, a green CSV from typeahead is not evidence about typeahead. Until 4–5 are fixed, a green `HOST_STATUS=DONE` is not evidence that anything citabile ran.