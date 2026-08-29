# Hostile audit — P0 patch in /Users/marco/Projects/kalsa-harness-fix/campaign/

Audit date: 2026-08-28. Read-only hostile audit of the 4-file patch vs `.orig`:
supervisor.sh, datastore.mjs, recovery.sh, resilient.sh.
Covers prior findings #1,#2,#6,#7,#15,#23,#27. All quotes verbatim from files as read.

## Findings

### F1. caffeinate wrapper: `SUPERVISOR_PID` is caffeinate's PID — orchestrator's consequences REFUTED empirically, but design is fragile

Verdict: REFUTED (as suspicion) — with 3 residual defects worth fixing
Severity: n/a as-written; residuals MEDIUM
File: campaign/resilient.sh:193

Exact line (resilient.sh:193):

    caffeinate -s bash "$HERE/supervisor.sh" --config "$CONFIG" --script "$SCRIPT" --run &

`$!` at resilient.sh:194 (`SUPERVISOR_PID=$!`) is caffeinate's PID, not the bash supervisor's. Suspicion confirmed. But the three feared consequences:

(a) `wait` propagation — resilient.sh:197-198:

    wait "$SUPERVISOR_PID"
    ec=$?

EMPIRICAL T1 (this host, macOS darwin25 / bash 3.2.57): `caffeinate -s bash -c 'exit 7'; echo $?` → `ec=7`. T2: a SIGTERM'd caffeinate propagated 143. caffeinate propagates the child's exit status — crash-streak logic (resilient.sh:200-214) works. CONFIRMED OK.

(b) release_lock kill orphaning — resilient.sh:94-96:

    log "killing child supervisor $SUPERVISOR_PID before releasing lock (no orphan writes)"
    kill "$SUPERVISOR_PID" 2>/dev/null || true
    sleep 1

EMPIRICAL T2/T7: `caffeinate -s bash /tmp/fake_sup.sh &` (script-file child, real shape), `kill` caffeinate → child died with it (forwarded SIGTERM; child's output stopped growing). caffeinate forwards TERM to its child on this macOS — no orphan. CONFIRMED OK on this host.

(c) supervisor_orphan_alive — resilient.sh:86-89:

    supervisor_orphan_alive() {
      local sp
      sp=$(cat "$SUP_PIDFILE" 2>/dev/null || echo "")
      [ -n "$sp" ] && kill -0 "$sp" 2>/dev/null

The pidfile now holds caffeinate's PID. `kill -0` is a sound proxy because caffeinate's lifetime strictly brackets the supervisor's (it exits when the child exits — T1/T2/T7). The takeover kill at resilient.sh:162-164 (`kill "$sp"`) TERMs caffeinate → forwarded → supervisor dies (T7). Functionally REFUTED; cosmetically the log at :163 `log "orphan supervisor $sp still alive — killing before takeover (prevents double supervisor)"` names the wrong process.

RESIDUAL DEFECTS:
- R1: signal forwarding by caffeinate is UNDOCUMENTED behavior. It is what stands between this patch and the orphan regression the launcher was hardened against (N5b/N5c). On any macOS where caffeinate does not forward, release_lock's kill (resilient.sh:95) orphans the live supervisor and the pidfile tracks a dead caffeinate → double-supervisor risk returns.
- R2: assertion GAP between passes. The wrapper holds the sleep assertion only while a supervisor runs. The launcher spends passes in `sleep 5` (:215, :220), crash backoffs up to 600s (:207), and device-loss backoffs up to 300s (:179) with NO assertion — the host can idle-sleep mid-backoff, dropping adb/wifi and spiraling. The orchestrator's suggested minimal alternative is strictly better and should replace this: at launcher startup (after acquire_lock), `caffeinate -s -w "$$" 2>/dev/null & || true` — assertion covers the launcher's whole life (including backoffs), auto-exits when the launcher dies, and leaves `SUPERVISOR_PID=$!` pointing at the REAL supervisor so every existing consumer (:86-89, :94-96, :197) keeps .orig semantics with zero forwarding assumptions.
- R3: if the LAUNCHER is SIGKILLed, caffeinate+supervisor both survive and the stale pidfile points at caffeinate; takeover's `kill "$sp"` still works (forwarded). Equal exposure to .orig's SIGKILL case — not a regression, noted for completeness.

### F2. skip branch placement in mode_run: CORRECT; one lost side effect (profile regeneration) downgraded to minor

Verdict: CONFIRMED correct for all traced consumers; PLAUSIBLE minor gap
File: campaign/supervisor.sh:266-269

Exact lines:

    if [ "$action" = "skip" ]; then
      log "skip $arm_id $v $conv_id"
      continue
    fi

- Placement BEFORE `CAMPAIGN_ARM_ID=...` (supervisor.sh:270-272) is safe: mode_run has NO post-loop consumer of CAMPAIGN_* (the function ends at the loop's `done`), so stale values from the previous cell are never used. The next non-skip row always reassigns via :270-274 (`CAMPAIGN_ARM_ID="$arm_id"` etc.) plus campaign_load_arm/campaign_load_variant_params.
- Logging: `log "skip $arm_id $v $conv_id"` goes through ci-lib.sh's log() to stderr; nothing downstream greps supervisor logs (resilient.sh parses no logs; campaign_finished at resilient.sh:117-127 reads only .resume-plan.txt).
- Profile-sweep expectations: skip rows never reach `campaign_run_script_turns` or the per-cell `campaign_profile_jsonl` call (supervisor.sh:285-291), and they must not: a skip cell is complete; wiping/relaunching it was finding #1's bug. The only side effect a skip row can no longer produce: regeneration of a MISSING/FAILED `.profile.json` for an already-complete conversation. Before the patch, the buggy skip execution re-ran the cell and incidentally rewrote the profile; now a profile whose write failed during the completing pass is never repaired by the supervisor (phase0.sh regenerates R1 profiles only when explicitly invoked). Profiles are derived from the JSONL (responseProfile.mjs; prereg.mjs reads JSONL directly, prereg.mjs:122), so impact is analysis-convenience only. PLAUSIBLE, low — not a blocker.

### F3. idempotent-turn node one-liner: sound under set -euo pipefail; agrees with firstMissingTurn; two residuals

Verdict: CONFIRMED correct as-written; 1 cheap hardening recommended
File: campaign/supervisor.sh:158-163

Exact lines:

    if node -e 'const fs=require("fs"), p=process.argv[1], i=Number(process.argv[2]); let lines=[]; try { lines=fs.readFileSync(p,"utf8").split("\n"); } catch {} process.exit(lines.some((line) => { try { const r=JSON.parse(line); return Number.isFinite(r?.i) && r.i === i && r.event !== "RECOVERY"; } catch { return false; } }) ? 0 : 1);' \
      "$OUT/$CAMPAIGN_ARM_ID/${CAMPAIGN_CONV_ID}.jsonl" "$i"; then
      log "skip turn $i (real record exists)"
      continue
    fi

- set -e safety: node's nonzero exit inside an `if` condition never triggers errexit. Verified T8 context (bash 3.2.57).
- argv indexing: `node -e '...' arg1 arg2` → process.argv[1]=arg1 (T3: `["firstarg","secondarg"]`). Correct.
- Quoting: path passed as single quoted argv (T6: spaced dir works, ec=0).
- Torn final line: JSON.parse catch → treated as no-record → torn turn re-executed (T5: ec=1). Exactly the intended #2/#7 semantics.
- `i` type parity: all record writers emit numeric `i` — collector.mjs:98 `else if (a === "--turn") o.i = Number(argv[++i]);` and turn.sh:275 `  "i": int(sys.argv[2] or 0),` — so strict `r.i === i` works today. firstMissingTurn (resume.mjs:32-35):

    for (const r of readTurns(file)) {
      if (r && r.event !== "RECOVERY" && Number.isFinite(r.i)) turns.add(Number(r.i));
    }

  — same real-record predicate (non-RECOVERY + finite i), and it CoERCES (`Number(r.i)`), while the one-liner does strict `===`. T4: a `"i":"3"` string record is skipped by resume.mjs's Set but NOT by the one-liner (`ec=1` → re-send). Today no writer emits string `i`, so no live divergence; this is a latent resume-vs-loop fight. HARDENING: change `r.i === i` to `Number(r.i) === i` in the one-liner.
- Cost: one node spawn/turn (~30-80ms); ~1-2 min across 1152 turns over 10 days. Negligible.
- Fail-open on node crash/absence: exit 127/134/137 → treated as "no record" → turn re-executed → possible duplicate row (finding #5's class). Mitigated: node absence dies earlier at resume.mjs (die in mode_run), and campaign_one_turn's campaign_user_landed guards prevent duplicate shares. Acceptable but undocumented; fail-open is the wrong polarity for the very bug class being fixed.

### F4. Atomic plan write: `local resume_ec=$?` captures node's exit code correctly; stale .tmp harmless; BUT finding #15 is only half-fixed

Verdict: CONFIRMED correct mechanism; prior finding #15 FIX-INCOMPLETE (pre-existing residual)
File: campaign/supervisor.sh:246-253

Exact lines:

    local plan_tmp="$plan.tmp"
    if node "$CAMPAIGN_ROOT/resume.mjs" --root "$OUT" --cells "$cells_file" --nconv "$nconv" --nturns "$nturns" \
      >"$plan_tmp"; then
      mv "$plan_tmp" "$plan"
    else
      local resume_ec=$?
      rm -f "$plan_tmp"
      die "resume.mjs exit $resume_ec"

- `local resume_ec=$?` inside mode_run (a function — `local` valid) captures the if-condition's exit status, i.e. node's code. Verified on macOS bash 3.2.57 (T8: `captured ec=1 (expect 1)`; T8b with the exact block shape: `would die: resume.mjs exit 1`). CONFIRMED.
- die() always exits 1 (ci-lib.sh:500-506, `die() { log "FATAL: $*"; ... exit 1 }`), so the launcher only ever sees 1 — same as .orig's `|| die "resume.mjs exit $?"`; the real code lives in the message. Cosmetic.
- Stale `plan.tmp` (supervisor SIGKILLed between node success and mv): harmless — no reader globs `.resume-plan.*`; campaign_finished reads the EXACT name, resilient.sh:121 `plan_file = os.path.join(out, ".resume-plan.txt")`, and the next pass's `>"$plan_tmp"` (supervisor.sh:248) truncates it before node runs; `rm -f` covers the node-failure path. Verified: only 3 references to `.resume-plan` exist (grep).
- CRITICAL residual — the #15/#7 "empty plan = complete" hazard is NOT fixed: a node run that SUCCEEDS but emits zero rows still publishes an empty plan, and campaign_finished still treats it as complete (resilient.sh:122-126):

      if not os.path.exists(plan_file):
          sys.exit(1)
      plan = [l.split() for l in open(plan_file) if l.strip()]
      remaining = [p for p in plan if len(p) >= 4 and p[3] != "skip"]
      sys.exit(1 if remaining else 0)

  Zero rows → `remaining` empty → exit 0 → launcher touches STOP_FILE → permanent stop. Reachable with a corrupt run-order.json (`cells: []`) or nconv=0 misconfig. The patch fixes the truncate-on-failure mechanism; it does NOT add cell-count validation. (Stale published plans are always conservative — an old plan over-estimates remaining work, never under-estimates — so staleness itself is safe.)

### F5. Tolerant readTurns: single caller, stderr cannot pollute stdout captures; behavior change = torn lines become holes (intended), with a quarantine-amplification note

Verdict: CONFIRMED as intended; one amplification worth knowing
File: campaign/datastore.mjs:32-44

Exact lines:

    const turns = [];
      let skipped = 0;
      for (const line of readFileSync(file, "utf8").split(/\n/)) {
        if (!line.trim()) continue;
        try {
          turns.push(JSON.parse(line));
        } catch {
          skipped += 1;
        }
      }
      if (skipped) console.error(`readTurns: skipped ${skipped} invalid JSON line(s) in ${file}`);

- Callers: grep across the repo shows readTurns is imported ONLY by resume.mjs:15 (`import { readCheckpoint, readTurns } from "./datastore.mjs";`). prereg.mjs has its own `readJsonl` (prereg.mjs:112) — unaffected.
- stderr pollution: resume.mjs is invoked ONLY at supervisor.sh:247-248 with stdout redirected to $plan_tmp (`>"$plan_tmp"`) — stderr goes to the supervisor's/launcher's stderr (the log). No `2>&1` anywhere near it (grep-verified). The one-liner in campaign_run_script_turns produces no stdout. CONFIRMED: no capture can be polluted.
- Behavior change beyond "torn turn becomes a hole": for a NON-checkpoint cell, a torn line now classifies the cell "invalid" (resume.mjs:88-97) → campaign_quarantine_conv (conversation.sh:41-54, mv's the JSONL to quarantine) + full 24-turn re-run of that conversation — vs BEFORE: readTurns threw → resume.mjs exit 2 → supervisor died every pass = permanently stuck campaign. The rerun costs ~24 turns of device time and archives the old data; that is the designed N2/N3 path, but the audit must state it: a single torn line in any completed-behind-checkpoint cell now costs a full conversation rerun plus a device chat wipe. Net improvement over "campaign bricked until human", at real time cost.
- readCheckpoint (datastore.mjs:63-68) is UNTOUCHED: `return JSON.parse(readFileSync(p, "utf8"));` — a torn checkpoint.json is still fatal (resume.mjs catch → exit 2 → die every pass, crash-loop backoff forever, effectively hung until human). Prior finding #7 remains partially open.

### F6. Atomic writeCheckpoint: strictly better single-writer; two-supervisor case keeps a torn-read window and adds an ENOENT crash for the loser

Verdict: CONFIRMED improvement; residuals noted
File: campaign/datastore.mjs:52-60

Exact lines:

    writeFileSync(
      `${target}.tmp`,
      JSON.stringify({ arm, variant, conv, turn, at: new Date().toISOString() }, null, 2),
    );
    renameSync(`${target}.tmp`, target);

- Single writer: torn checkpoint.json reads impossible (rename atomic, same dir — fine on APFS). Stale `checkpoint.json.tmp` from a killed supervisor: nothing reads it; the next `writeFileSync` truncates it via "w". Harmless. No reader touches `.tmp` (readCheckpoint reads `checkpointPath(root)` only).
- Two-supervisor (known finding #14 risk) — WORSE-or-BETTER answer: BETTER, not fixed. Fixed name `checkpoint.json.tmp` means two writers collide: (a) the loser's `renameSync` can throw ENOENT after the winner renamed — node exits 1, and oneTurn.sh's campaign_store_turn calls `node "$CAMPAIGN_ROOT/datastore.mjs" --checkpoint ...` with no `||` guard under `set -uo pipefail` (NO errexit in oneTurn.sh:2), so the failed checkpoint is silently skipped → stale checkpoint → resend duplicate; (b) the write-after-open window (B opened tmp before A renamed) still lets B truncate the published checkpoint.json, so a concurrent reader can still see a torn file. Versus before: direct concurrent writes could tear AND crash readers. Net better, residual race remains — the real fix remains single-supervisor enforcement (finding #14), not this patch.
- Durability: no fsync of the tmp file or directory before rename — atomicity fixed, durability not. A power loss can lose the rename (checkpoint reverts → last turn re-sent = duplicate). Same gap as before the patch (prior finding #6 residual); APFS journaling makes empty-or-old (not torn) outcomes likely, which resume handles as a re-send. Note only.

### F7. Thermal fail-closed: a permanently dead probe converts the launcher's entire give-up machinery into an infinite SILENT hang — the worst defect in this patch

Verdict: CONFIRMED (new regression interaction; trigger probability moderate over 10 unattended days; cost = entire run)
File: campaign/recovery.sh:140,148 (+ 162 dead-code sibling); traced through turn.sh, oneTurn.sh, resilient.sh

Exact patched lines:

    recovery.sh:140:    ''|unknown|*[!0-9]*) return 0 ;;
    recovery.sh:148:    ''|unknown|*[!0-9.]*) return 0 ;;   (was: return 1)

The patched function is campaign_thermal_should_pause (recovery.sh:136-151). Return 0 means PAUSE at every call site:

1. turn.sh:121-123 (inside campaign_send_turn composer wait loop):
       if campaign_thermal_should_pause; then
         CAMPAIGN_TURN_STATUS="thermal"
         return 1
2. turn.sh:133-135 (inside campaign_send_turn post-tap loop): identical three lines.
3. turn.sh:232-235 (campaign_wait_turn 120s health check):
       if campaign_thermal_should_pause; then
         CAMPAIGN_TURN_STATUS="thermal"
         return 1
       fi
4. recovery.sh:180 (the cooldown loop itself):
       campaign_thermal_should_pause || { log "thermal cool after ${waited}s (battery <= ${CAMPAIGN_THERMAL_MAX_C}°C, status < $CAMPAIGN_THERMAL_PAUSE)"; return 0; }

The probe feeds `unknown` on ANY adb/parse failure — device-env.sh:72 (device_thermal_status) and :80 (device_battery_temp_c) both end with:

    case "$v" in ''|*[!0-9]*) printf '%s\n' unknown ;; *) printf '%s\n' "$v" ;; esac

THE CHAIN (all steps quoted): probe permanently returns `unknown` (dumpsys thermalservice format change, battery-temp parse regression, wedged-but-state-"device" transport) → should_pause returns 0 → any of turn.sh:121/133/232 sets status=thermal and returns 1 → oneTurn.sh:94:

      campaign_thermal_cooldown || return 0

→ campaign_thermal_cooldown (recovery.sh:173-187):

    while [ "$waited" -lt "$cap" ]; do            # cap=7200 (recovery.sh:174)
      sleep 60
      waited=$((waited + 60))
      campaign_thermal_should_pause || { log "thermal cool after ..."; return 0; }
      log "thermal still hot (${waited}s)"
    done
    log "thermal still paused after ${cap}s — waiting again, safer than resuming hot (owner: slow but safe)"
    campaign_thermal_cooldown                     # recovery.sh:186 — UNBOUNDED recursion

With a dead probe, `campaign_thermal_should_pause` NEVER returns 1, so the loop never exits, and after each 7200s cap it recurses into itself — forever. The supervisor NEVER exits. Therefore, in resilient.sh, `wait "$SUPERVISOR_PID"` (:197) never returns, so:
- the no-progress detector — which is PASS-BASED, evaluated only between supervisor launches (:181-185: `if [ "$no_progress_streak" -ge "$NO_PROGRESS_CAP" ]; then log "no progress for $NO_PROGRESS_CAP passes (livelock?) — give up (need human)"; exit 5`) — NEVER runs. Exit 5 is unreachable.
- the device_lost check (:172-193) and campaign_finished (:150-158) also run only between passes — never.
- Worse: the cooldown's first action is campaign_force_stop (flags.sh:44-47), `adb shell am force-stop "$PKG" </dev/null >/dev/null 2>&1 || true` — adb with NO timeout can itself hang forever on a wedged transport, freezing the supervisor even before the first sleep 60.

NET: the run hangs silently forever (only "thermal still hot (Ns)" log noise), defeating BOTH the launcher's device-loss give-up (exit 2, 6h) and the no-progress cap (exit 5) — in a 10-day unattended run.

BEFORE the patch: `''|unknown|*[!0-9]*) return 1 ;;` → probe-dead meant NOT-paused → cooldown "cooled" after ≤60s (lying), the send still failed, the turn aborted, and the adb-dead case escaped via the adb-drop path (turn.sh:211-214: `if [ "$state" != "device" ]; then CAMPAIGN_TURN_STATUS="adb-drop"; return 1`) → oneTurn.sh:53-56 `campaign_ensure_device || die "device lost turn $CAMPAIGN_TURN_I"` → supervisor exit → launcher's device_lost give-up at :188-190 (`log "device lost ${device_lost_total}s total — give up (need human)"; exit 2`). Defective (kept working through unknown heat — prior finding #23), but it FAILED FORWARD and reached a human-visible exit. The patch removes every path to an exit.

Triggers realistic over 10 days: OEM dumpsys output change, thermal service hiccups returning non-numeric, or adb transport wedge where get-state still answers "device". One occurrence = total loss of the remainder of the campaign window.

REQUIRED CORRECTION (minimal, preserves #23's fail-closed intent but bounds it):
1. recovery.sh — bound the pause. In campaign_thermal_cooldown, replace the unbounded tail recursion (:185-186) with a round counter:
       log "thermal still paused after ${cap}s — waiting again, safer than resuming hot (owner: slow but safe)"
       campaign_thermal_cooldown
   becomes:
       paused_rounds=$((paused_rounds + 1))
       if [ "$paused_rounds" -ge "${CAMPAIGN_THERMAL_MAX_ROUNDS:-8}" ]; then
         log "thermal pause exceeded $paused_rounds×${cap}s (probe dead or phone never cools) — aborting pass so launcher re-checks device/probe"
         return 3
       fi
       waited=0
   (with `local paused_rounds="${paused_rounds:-0}"`; recursion gone).
2. oneTurn.sh:94 — the failure path must STOP the pass, not skip the turn forward (returning 0 here would burn the remaining turns of the cell):
       campaign_thermal_cooldown || return 0
   becomes:
       campaign_thermal_cooldown || return 1
   (oneTurn.sh:45's `|| die "thermal cooldown failed turn $CAMPAIGN_TURN_I"` already handles its site correctly — die exits the supervisor.)
   With both edits, a dead probe aborts the pass within ≤8×2h, the launcher relaunches with backoffs, re-checks device_lost and a FRESH probe each pass (self-healing if the probe recovers), and the failure is visible in launcher logs — restoring exactly the fail-forward property the .orig had, while keeping fail-closed pauses short-term.
3. Optional hardening: resilient.sh could treat a specific supervisor exit code (e.g. 3) as "probe dead — keep backing off but alert"; not required.

Adjacent (pre-existing, NOT introduced by this patch — diff touches only should_pause):
- campaign_thermal_still_hot (recovery.sh:158-169) has NO callers anywhere in campaign/ (dead code) and a pattern typo at :167:
      ''|*[!0-9.]) return 0 ;;
  (missing trailing `*` — `4a2`-style mid-string garbage falls through to `python3 -c "exit(0 if float('$bt') > ...)"` which crashes → exit 1 = "not hot"). Latent only; .orig identical.
- The unconditional fail-closed also widens reachability of the pre-existing un-timed `adb shell` hang inside cooldown (force-stop), noted above.

### F8. bash 3.2 / set -e / quoting sweep of everything the patch touched

Verdict: CONFIRMED clean
- `local resume_ec=$?` is inside mode_run (a function) — valid; capture verified on /bin/bash 3.2.57 (T8/T8b).
- The node one-liner inside an `if` condition: errexit-safe under `set -euo pipefail` (supervisor.sh:16). Single-quoted node code with embedded double quotes — no shell expansion issues; no bash-3.2-incompatible syntax anywhere in the 8 hunks (no assoc arrays, no `${var,,}`, `<<<` and `read -r a b c d e` are 3.2-fine and pre-existing).
- JSONL path with spaces: passed as ONE quoted argv (supervisor.sh:159) — T6 proved skip works with a spaced path.
- Empty `plan_lines` under `set -u` in bash 3.2 (`"${plan_lines[@]}"` unbound) — pre-existing (loop shape unchanged), reachable only via the empty-plan case in F4's residual.
- Cosmetic: `die` swallows the real exit code (always exit 1, ci-lib.sh:506) so `resume_ec` reaches the launcher only as log text; behavior identical to .orig.

### F9. Regression sweep: hunks are additive; sandbox path artifact noted

Verdict: CONFIRMED no accidental deletions
- supervisor.sh: 3 hunks (one-liner after the user-extraction line; plan tmp block replacing the `|| die` form; skip branch before CAMPAIGN_* assignments). All original lines present (full-file read).
- datastore.mjs: 3 hunks (renameSync import; readTurns body; writeCheckpoint body). Note: the one-liner's skip check is placed AFTER the per-turn python user extraction (supervisor.sh:157-163) — harmless (extraction has no side effects), and python failure there dies the supervisor under set -e exactly as .orig.
- recovery.sh: exactly 2 tokens changed (`return 1` → `return 0` twice). Nothing else.
- resilient.sh: exactly 1 line changed.
- NOTE (not a patch defect, but for the hand-applier): this kalsa-harness-fix checkout is not runnable as-is — supervisor.sh sources `"$REPO/scripts/device-share-send.sh"` and campaign_profile_jsonl calls `node "$REPO/scripts/responseProfile.mjs"`, but in this sandbox those files sit at repo ROOT, not under scripts/. The patch introduces no path changes; when hand-applying to the live repo, keep the patch text verbatim and let the live scripts/ layout supply the paths.

### F10. Failure-mode ledger for the 4 files (what the patch fixes vs leaves)

- #1 (skip executed as new conversation): FIXED (supervisor.sh:266-269 + plan publication now atomic).
- #2 (resume-from-hole replays real suffix): FIXED (one-liner skips real-record turns; semantics match firstMissingTurn — F3).
- #6 (append/checkpoint not one durable commit): PARTIALLY FIXED (checkpoint atomicity yes; fsync durability no; append/stamp-eviction untouched — F6).
- #7 (torn state fatal / false completion): PARTIALLY FIXED (torn JSONL lines → holes via readTurns; torn checkpoint still fatal; empty-plan-looks-complete STILL OPEN — F4/F5).
- #15 (empty plan → stop file): PARTIALLY FIXED (truncate-on-failure eliminated; zero-row success still publishes an empty plan and campaign_finished still accepts it — F4).
- #23 (unknown thermal readings treated as safe): FIXED as fail-closed — but WITHOUT a bound, creating F7's infinite hang. Fix #23 must ship WITH F7's correction.
- #27 (host sleep not prevented): PARTIALLY FIXED (assertion only while a supervisor runs; backoff gaps unprotected; undocumented signal-forwarding dependency — F1 R1/R2).

### VERDICT: APPLY-with-corrections

The four hunks are mechanically sound (all six suspected defects in the orchestrator's angles REFUTED or bounded — F1, F2, F3, F4, F6), the skip/idempotency logic genuinely fixes #1 and #2 with correct resume.mjs parity, and no hunk deletes anything. But as written the patch will hang the campaign forever the first time the thermal probe dies while adb still answers "device" (F7), and it introduces an undocumented caffeinate signal-forwarding dependency plus assertion gaps (F1 R1/R2). Corrections, in priority order — all minimal:

1. REQUIRED — recovery.sh: bound the fail-closed thermal pause (F7 correction 1: round counter in campaign_thermal_cooldown, `return 3` after N rounds, recursion removed).
2. REQUIRED — oneTurn.sh:94: `campaign_thermal_cooldown || return 0` → `|| return 1` so a failed/aborted cooldown stops the pass instead of burning the cell's remaining turns (F7 correction 2). (oneTurn.sh:45 already dies the supervisor — correct.)
3. RECOMMENDED — resilient.sh:193: replace the per-supervisor `caffeinate -s bash ... &` wrapper with a launcher-lifetime guard started after acquire_lock: `caffeinate -s -w "$$" 2>/dev/null & || true` and restore `bash "$HERE/supervisor.sh" ... &`. Restores true SUPERVISOR_PID semantics for :86-89/:94-96/:197, removes the undocumented forwarding dependency, and covers backoff windows. (If the team insists on keeping the wrapper, it works on this host — T1/T2/T7 — but accept R1/R3.)
4. RECOMMENDED — supervisor.sh:159: `r.i === i` → `Number(r.i) === i` for exact parity with resume.mjs firstMissingTurn (T4 proved the latent divergence).
5. OPTIONAL — supervisor.sh mode_run: after mv, `[ "${#plan_lines[@]}" -gt 0 ] || die "resume plan empty — refusing (cells corrupt?)"` (closes F4's empty-plan-completes residual at the publisher side; campaign_finished's exact-144-row validation remains the owner's longer-term fix).
6. OPTIONAL — datastore.mjs writeCheckpoint: fsync tmp + dir before renameSync (durability residual of #6).

With corrections 1+2 applied the patch is safe to hand-apply to the live campaign; corrections 3+4 should ride along (single-line/one-line each); 5+6 at the owner's discretion.

## Evidence appendix (commands run, all read-only on the target repos)
- `diff -u X.orig X` for supervisor.sh, datastore.mjs, recovery.sh, resilient.sh (campaign/).
- Full reads: resilient.sh, supervisor.sh, recovery.sh, datastore.mjs, resume.mjs, oneTurn.sh, turn.sh, device-env.sh (+ targeted reads: collector.mjs, prereg.mjs, phase0.sh, conversation.sh, flags.sh, ci-lib.sh die()).
- grep proofs: readTurns importers (only resume.mjs), `.resume-plan` references (3, exact-name only), `2>&1` near resume invocation (none), campaign_thermal_should_pause call sites (5 listed), readCheckpoint body untouched.
- Empirical (on this audit host, macOS darwin25, bash 3.2.57): T1 caffeinate exit propagation (ec=7); T2/T7 caffeinate SIGTERM forwarding to `-c` and script-file children (both children died with it); T3 node -e argv indexing; T4 one-liner vs string-i record (ec=1 — divergence proven); T5 torn final line (ec=1 — re-run, correct); T6 spaced JSONL path (ec=0 — quoting OK); T8/T8b `local resume_ec=$?` under bash 3.2 with the exact patched block shape. Temp files removed; target repos untouched.

---

## Re-audit of the correction hunks (targeted diff vs .orig, 2nd pass)

### F11. Bounded cooldown: 3×7200s rounds → return 3, recursion removed — CONFIRMED, closes F7 with no new defect

Verdict: CONFIRMED (fast-mock proven)
File: campaign/recovery.sh:173-192

Exact new lines:

    campaign_thermal_cooldown() {
      local waited=0 cap=7200 paused_rounds=0
      log "RECOVERY reason=thermal — pause (battery > ${CAMPAIGN_THERMAL_MAX_C}°C or status >= $CAMPAIGN_THERMAL_PAUSE; resume when cool — Jelly's charging equilibrium 41-43°C is fine to work through)"
      campaign_force_stop
      while :; do
        while [ "$waited" -lt "$cap" ]; do
          sleep 60
          waited=$((waited + 60))
          campaign_thermal_should_pause || { log "thermal cool after ${waited}s (battery <= ${CAMPAIGN_THERMAL_MAX_C}°C, status < $CAMPAIGN_THERMAL_PAUSE)"; return 0; }
          log "thermal still hot (${waited}s)"
        done
        log "thermal still paused after ${cap}s — waiting again, safer than resuming hot (owner: slow but safe)"
        paused_rounds=$((paused_rounds + 1))
        if [ "$paused_rounds" -ge 3 ]; then
          log "thermal pause exceeded ${paused_rounds}×${cap}s (probe dead or phone never cools) — aborting pass"
          return 3
        fi
        waited=0
      done
    }

- Recursion GONE (the .orig tail call `campaign_thermal_cooldown` is deleted). The fail-closed `return 0` on unknown probe (recovery.sh:140,148) is retained, now bounded at 3 full rounds = 6h per cooldown call.
- Fast-mock proof (E3): PATH-shimmed `sleep` + always-unknown probe → `cooldown ec=3 (expect 3)` after exactly 3 rounds; recovered probe (status 2, temp 41.5) → `cooldown-when-cool ec=0 (expect 0)`. Both exit paths verified.
- bash 3.2: `/bin/bash -n` parse OK on all four files (E1); `local waited=0 cap=7200 paused_rounds=0` initializes under set -u.
- Semantics check vs owner directive ("cooldown may take hours, never die"): the campaign still never dies — a pass abort (return 3 → supervisor exit 1) is followed by launcher relaunch; a genuinely hot phone re-enters cooldown every pass (~6h + backoff), fully visible in logs. 3 rounds (6h) instead of my suggested 8 (16h) is tighter but still "hours" — acceptable.
- Residual (pre-existing, unchanged): `campaign_force_stop` (recovery.sh:177) fires once per cooldown invocation before the loop and can still hang on a wedged transport (untimed adb). Not worsened by this hunk; the round counter now bounds everything AFTER force_stop returns.
- `campaign_force_stop` is no longer re-fired per round (recursion used to re-call it): correct — after 6h the pass aborts anyway; no behavioral loss.
- Note: `campaign_run_script_intents` (supervisor.sh) calls campaign_one_turn without `||` — a return-3-driven `return 1` from campaign_one_turn would die by errexit there. That path is phase-0-only and "die beats hang". Not a defect.

### F12. oneTurn.sh:94 `|| return 0` → `|| return 1` — CONFIRMED; full F7 exit chain traced end-to-end, exits 1/2/4/5 all reachable again

Verdict: CONFIRMED (E5 proven)
File: campaign/oneTurn.sh:94

Exact line:

          campaign_thermal_cooldown || return 1

Full chain, verified link by link: probe dead (`device_thermal_status` → `unknown`, device-env.sh:72) → should_pause `return 0` (recovery.sh:140) → turn.sh:121-123/133-135/232-235 `CAMPAIGN_TURN_STATUS="thermal"; return 1` → cooldown burns 3×7200s → `return 3` (recovery.sh:189) → oneTurn.sh:94 `|| return 1` → campaign_run_script_turns `campaign_one_turn "$i" "$user" || return 1` (supervisor.sh:286) → mode_run else-branch `log "WARN: ..."; return 1` (supervisor.sh:295-296) → `run) mode_run ;;` under `set -euo pipefail` → supervisor exits 1 (E5: simulated chain exits ec=1). Launcher: resilient.sh `wait "$SUPERVISOR_PID"` → ec=1 → crash_streak++ → backoff/relaunch. oneTurn.sh:45's `campaign_thermal_cooldown || die "thermal cooldown failed turn $CAMPAIGN_TURN_I"` (recover_status path) → die → exit 1 — same reachability.
- Exit 2 (device-loss give-up): reachable — device_lost is re-evaluated between passes, which now occur every ≤6h+backoff instead of never.
- Exit 5 (no-progress): reachable — progress_snapshot is re-evaluated per pass; zero-progress passes now increment the streak (200-pass cap) instead of freezing in one infinite pass.
- Exit 4 (crash-loop): reachable — streak 10000, with 600s crash backoffs between 6h thermal passes.
- `|| return 1` also stops the pass when the phone is genuinely hot for 6h — the cell's remaining turns are NOT burned forward (the old `return 0` would have skipped every remaining turn of the conversation); checkpoint unchanged, same cell retried next pass. Correct.
- `CAMPAIGN_TURN_STATUS=""` (oneTurn.sh:95) is now only reached on cooldown success (return 0) — the M5 landing-check/retry flow below it is untouched for that path. No regression.

### F13. Empty-plan refusal (supervisor grep-gate) + campaign_finished `if not plan: sys.exit(1)` — CONFIRMED; closes F4's residual; livelock-with-visibility trade is acceptable

Verdict: CONFIRMED
File: campaign/supervisor.sh:249-252; campaign/resilient.sh:129-130

Exact new lines:

    supervisor.sh:249-252:
        if ! grep -q '[^[:space:]]' "$plan_tmp"; then
          rm -f "$plan_tmp"
          die "resume plan empty — refusing to publish"
        fi
    resilient.sh:129-130 (inside campaign_finished python):
        if not plan:
            sys.exit(1)

- Gate is placed BETWEEN node success and mv — an empty/whitespace-only resume output is never published, and the previously-published plan (always conservative: over-estimates remaining work) stays on disk. E2 (bash 3.2, set -euo pipefail): empty file → REFUSED, whitespace-only → REFUSED, real rows → PUBLISHED. `grep -q '[^[:space:]]'` inside an `if !` condition is errexit-safe.
- campaign_finished: `if not plan: sys.exit(1)` sits after the strip-filter, before the `remaining` computation — a whitespace-only or zero-byte plan file is no longer "complete". Verified placement in diff. Belt-and-suspenders with the supervisor gate: a stale empty plan published by the OLD code self-heals (launcher sees not-complete → relaunch → supervisor regenerates a real plan and overwrites).
- Corrupt-cells livelock trade: resume.mjs exiting 0 with zero rows (e.g. `cells: []` in a corrupt run-order.json) now means the supervisor dies ("refusing to publish") every pass → crash backoffs, VISIBLE in logs, no false stop-file, no data loss. This is the accepted trade from my F4 recommendation; the root cause (non-atomic run-order write) is out of this patch's scope and unchanged.
- bash 3.2 / set -e: E1 parse OK; `rm -f` before die cleans the tmp; die still exits 1 with message (cosmetic, unchanged).

### F14. Launcher-startup caffeinate guard + supervisor reverted to plain bash — CONFIRMED; F1 R1/R2 closed; plus the one-liner `Number(r.i)` hardening

Verdict: CONFIRMED (E4/E-test proven)
File: campaign/resilient.sh:38,111-115,200; campaign/supervisor.sh:159

Exact new lines:

    resilient.sh:38:    CAFFEINATE_GUARD_PID=""
    resilient.sh:111-115:
    trap release_lock EXIT
    acquire_lock
    if [ -z "$CAFFEINATE_GUARD_PID" ] || ! kill -0 "$CAFFEINATE_GUARD_PID" 2>/dev/null; then
      caffeinate -s -w "$$" >/dev/null 2>&1 &
      CAFFEINATE_GUARD_PID=$!
    fi
    resilient.sh:200:    bash "$HERE/supervisor.sh" --config "$CONFIG" --script "$SCRIPT" --run &

- Per-supervisor wrapper is FULLY reverted: diff vs .orig shows no hunk at the launch site; SUPERVISOR_PID is the true supervisor PID again, so :86-89 (supervisor_orphan_alive), :94-96 (release_lock kill), and the wait/ec block need no caffeinate signal-forwarding assumption. F1-R1 CLOSED.
- Guard starts after acquire_lock (a lock-refused exit 3 never starts it), holds the assertion for the LAUNCHER's whole life including 5s/300s/600s backoffs, and self-exits when the watched PID dies. E4: `caffeinate -s -w "$$"` guard alive while launcher alive; exited after launcher death (within ~2.5s). F1-R2 CLOSED. No explicit kill in release_lock — the ~1-2s lingering assertion after a normal exit is cosmetic.
- If caffeinate is absent (non-macOS): the backgrounded command fails 127 immediately, guard PID points at a dead process, launcher proceeds unprotected exactly like .orig. The `! kill -0` second clause of the if is dead code at startup (var is always "") — harmless.
- SIGKILLed launcher: guard exits (watched-pid death), orphan supervisor runs without assertion — identical to .orig exposure (F1-R3, unchanged, accepted).
- supervisor.sh:159 one-liner hardened to `Number.isFinite(Number(r?.i)) && Number(r.i) === i && r.event !== "RECOVERY"` — verified: string-`i` record now skipped (ec=0, parity with resume.mjs firstMissingTurn's Set of Number(r.i)); RECOVERY-only record still a hole (ec=1, re-sent). `null` line → undefined → NaN → false. F3 residual CLOSED.

### Re-audit residual ledger (unchanged from first pass, none blocking)
- campaign_force_stop's untimed `adb shell am force-stop` can still freeze a pass on a wedged transport (pre-existing; bounded only before it, not by it).
- Torn checkpoint.json is still fatal (readCheckpoint untouched); two-supervisor checkpoint tmp race remains (finding #14 — the real fix is single-supervisor enforcement).
- Corrupt run-order.json (`cells: []`) now produces a visible die-and-backoff loop instead of a silent stop-file — improved, root cause open.
- Prior-audit findings #4 (resend race), #5 (duplicates accepted), #8, #10, etc. are untouched by this patch set — unchanged scope.
- Exit 5's 200-pass cap is effectively unreachable for a pure 6h-thermal-pass cadence (200×6h >> 10 days) — by design; exits 1→backoff, 2 (device loss), 4 (crash streak) remain the operative give-up paths and are all reachable again.

## FINAL VERDICT: APPLY

All four required corrections verified against their F-findings: (1) bounded cooldown closes F7's infinite hang — recursion removed, return 3 after 3×7200s, proven by fast-mock; (2) `|| return 1` stops the pass instead of burning the cell, full chain to supervisor exit 1 proven; (3) empty-plan refusal + `if not plan: sys.exit(1)` close F4's false-completion residual with a visible-backoff trade; (4) the `-w "$$"` guard closes F1-R1/R2 with .orig-identical supervisor PID semantics and proven assertion lifetime. The F3 one-liner hardening (`Number(r.i) === i`) also landed. No new defects introduced: bash 3.2 parse-clean on all four files, set -u safe, no exit-code swallowing, no regressions vs .orig outside the four hunks. Safe to hand-apply to the live 10-day campaign.
