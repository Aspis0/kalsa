# AUDIT — Campaign Harness Fix Round (Round 2)

**Auditor:** Direct re-audit (no delegation)
**Date:** 2026-08-25
**Scope:** scripts/campaign/*, scripts/responseProfile.mjs, campaigns/ciswire.json
**Spec:** AUDIT_HARNESS_BUILD.md required fixes F1–F11

---

## Summary

**12 of 12 fix points CONFIRMED landed.**
**6 NEW bugs found (2 HIGH, 2 MEDIUM, 2 LOW).**
**1 pre-existing structural issue noted (source set -uo overrides supervisor set -euo).**

The fix round addressed all 11 original must-fixes plus the parent REFUTED suspect. Every point quotes current code lines. Below I verify each, then hunt for regressions.

---

## Fix-Point Verification

### F1: conversationsPerVariant = conversations/len(variants); mode_run uses 3 per cell (48 total)

**CONFIRMED.**

`config.mjs:138-149`:
```js
export function conversationsPerVariant(cfg) {
  const nVar = (cfg.variants || []).length;
  const n = Number(cfg.conversations);
  ...
  return n / nVar;
}
```
6 / 2 = 3 per variant.

`supervisor.sh:196`: `nconv=$(node "$CAMPAIGN_ROOT/config.mjs" --n-per-variant "$CONFIG")` → nconv=3.

`selftest.mjs` asserts:
```
check(nPer === 3, `conversationsPerVariant=${nPer} (want 3)`);
check(cfg.arms.length * cfg.variants.length * nPer === 48, "8×2×3=48 conv");
```

`resume.mjs:67-70`: iterates `for (let n = 1; n <= nPerVariant; n++)` — generates 3 rows per cell. Mode_run reads these rows, not seq 1..6.

### F2: mode_run uses process substitution `< <(...)`, not `python3 | while`

**CONFIRMED.**

`supervisor.sh:219-223`:
```sh
  done < <(node "$CAMPAIGN_ROOT/resume.mjs" --root "$OUT" --cells "$cells_file" --nconv "$nconv" --nturns "$nturns")
```

Process substitution, not pipe. `FLAG_PARAMS` set by `campaign_load_variant_params` (line 210) is in the parent shell, visible to `campaign_arm_begin` and `campaign_write_flags`.

### F3: Hang/timeout does NOT die the supervisor; abort writes jsonl RECOVERY; retry once then skip

**CONFIRMED.**

`oneTurn.sh:53-86` — `campaign_one_turn`:
```sh
  campaign_abort_turn "$CAMPAIGN_TURN_STATUS"
  if campaign_recover_status "$CAMPAIGN_TURN_STATUS"; then
    :
  else
    log "turn $i $CAMPAIGN_TURN_STATUS — retry once then skip"
  fi
  CAMPAIGN_RETRIED=1
  ...
  campaign_send_turn "$user" || { log "turn $i retry send failed — skip"; return 0; }
  if campaign_wait_turn "$prev" "$slice" "$offset"; then
    campaign_finish_turn "$slice"
    return 0
  fi
  campaign_abort_turn "$CAMPAIGN_TURN_STATUS"
  log "turn $i skipped after retry status=$CAMPAIGN_TURN_STATUS"
  return 0
```

`watchdog.sh:18-46` — `campaign_abort_turn`:
```sh
  python3 -c '...' "${CAMPAIGN_TURN_I:-0}" ... "$rec"
  node "$CAMPAIGN_ROOT/datastore.mjs" --append "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_CONV_ID" "$rec"
  node "$CAMPAIGN_ROOT/datastore.mjs" --checkpoint ...
```

Writes RECOVERY record to jsonl via `--append`. Always returns 0 from `campaign_one_turn`. Supervisor never dies on hang/timeout.

### F4: runScorers invoked (scoring.mjs --score-turn) before append

**CONFIRMED.**

`oneTurn.sh:6-9`:
```sh
campaign_score_record() {
  local rec="${1:?}"
  node "$CAMPAIGN_ROOT/scoring.mjs" --score-turn "$rec" --config "$CONFIG" --repo "$REPO" \
    || die "scorer failed turn ${CAMPAIGN_TURN_I:-?}"
}
```

`oneTurn.sh:48-51` (`campaign_finish_turn`):
```sh
  campaign_collect_file "$slice" "$OUT/.messages.json" "$charging" "$rec"
  campaign_score_record "$rec"
  campaign_store_turn "$rec"
```

Order: collect → score → store. Scores are written to the jsonl record before append.

### F5: responseProfile.mjs --lexicon actually loads lexicon

**CONFIRMED.**

`responseProfile.mjs:159-163`:
```js
  if (opts.lexicon) {
    if (!existsSync(opts.lexicon)) throw new Error(`missing lexicon ${opts.lexicon}`);
    lexicon = JSON.parse(readFileSync(opts.lexicon, "utf8"));
  }
```

`supervisor.sh:122-124`:
```sh
campaign_profile_jsonl() {
  node "$REPO/scripts/responseProfile.mjs" --lexicon "$LEXICON_PATH" "$1"
}
```

`LEXICON_PATH` resolved from config at supervisor.sh:99-105. Lexicon is loaded and passed to `profileJsonl`.

### F6: resume.mjs + readCheckpoint used; skip completed cells; same cell from turn+1 without wipe

**CONFIRMED.**

`resume.mjs:13`: `import { readCheckpoint } from "./datastore.mjs";`

`resume.mjs:87`: `const checkpoint = existsSync(root + "/checkpoint.json") ? readCheckpoint(root) : null;`

`resume.mjs:38-65` — `resumePlan` logic:
- Cells before checkpoint: `action: "skip"`
- Same cell, completed conv: `action: "skip"`
- Same cell, incomplete conv: `action: "resume", startTurn: checkpoint.turn + 1`
- Later cells: `action: "new", startTurn: 1`

`supervisor.sh:211-216`:
```sh
    if [ "$action" = "resume" ]; then
      log "resume $arm_id $v $conv_id from turn $start_turn"
      campaign_restore_same_conv
    else
      campaign_arm_begin
      start_turn=1
    fi
```

`campaign_restore_same_conv` (`conversation.sh:68-73`): force-stop → write flags → launch → wait ready. No wipe.

Selftest (`selftest.mjs`) asserts resume plan correctness:
```
check(plan.some((r) => r.conv === "c2-B" && r.action === "resume" && r.startTurn === 11), "resume c2-B turn 11");
```

### F7: campaign_find_apk: env, config.apk, debug, release; die if install -r needed and missing

**CONFIRMED.**

`recovery.sh:84-100`:
```sh
campaign_find_apk() {
  local f tried="" cands=()
  [ -n "${CAMPAIGN_APK:-}" ] && cands+=("$CAMPAIGN_APK")
  [ -n "${CAMPAIGN_CONFIG_APK:-}" ] && cands+=("$CAMPAIGN_CONFIG_APK")
  cands+=("${REPO:-.}/android/app/build/outputs/apk/debug/app-debug.apk")
  cands+=("${REPO:-.}/android/app/build/outputs/apk/release/app-release.apk")
  ...
}
```

`supervisor.sh:95`: `CAMPAIGN_CONFIG_APK=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("apk") or "")' "$CONFIG")`

`recovery.sh:103-104`:
```sh
campaign_reinstall_r() {
  local apk
  apk=$(campaign_find_apk) || die "install -r needed but no apk (tried $CAMPAIGN_APK, config.apk, debug, release)"
```

### F8: phase0_floors writes $OUT/floors.json from R1 jsonl; no `|| true`

**CONFIRMED.**

`phase0.sh:73-78`:
```sh
campaign_phase0_floors() {
  log "phase0: per-axis σ from R1 convs → detection floors"
  local prereg="$REPO/campaigns/ciswire/prereg.json"
  node "$CAMPAIGN_ROOT/prereg.mjs" --floors \
    --r1-dir "$OUT/R1" \
    --prereg "$prereg" \
    --out "$OUT/floors.json" \
    || die "phase0 floors failed"
}
```

No `|| true`. Dies on failure. `prereg.mjs --floors` CLI (`prereg.mjs:136-146`) reads R1 jsonl files, computes per-axis SD, writes `$OUT/floors.json`.

### F9: collector `node … || die`

**CONFIRMED.**

`turn.sh:194-207`:
```sh
  node "$CAMPAIGN_ROOT/collector.mjs" \
    --logcat "$slice" \
    ...
    || die "collector failed turn ${CAMPAIGN_TURN_I:-?}"
```

### F10: evictionTurn first corpusSize>0 sidecar

**CONFIRMED.**

`datastore.mjs:76-93`:
```js
export function stampEviction(root, armId, convId, rec) {
  const rows = rec?.telemetry?.KALSA_DIGEST || [];
  const hit = rows.some((d) => (d.corpusSize || 0) > 0);
  const file = evictionPath(root, armId, convId);
  if (existsSync(file)) {
    const prev = JSON.parse(readFileSync(file, "utf8"));
    return { ...rec, evictionTurn: prev.evictionTurn };
  }
  if (!hit) return rec;
  const evictionTurn = rec.i ?? rec.turn;
  writeJson(file, { evictionTurn, conv: convId, arm: armId });
  return { ...rec, evictionTurn };
}
```

Sidecar `*.eviction.json` written on first corpusSize>0. Subsequent turns read sidecar. `campaign_store_turn` calls stamp-eviction before append.

### F11: campaign_watch_turn gone

**CONFIRMED.**

`grep -rn 'campaign_watch_turn' scripts/campaign/` → zero hits. Dead code removed from watchdog.sh.

---

## Selftest Assertions (item 12)

**CONFIRMED.** All assertions present in `selftest.mjs`:

```
check(nPer === 3, ...)                    // 3 per variant
check(cfg.arms.length * cfg.variants.length * nPer === 48, "8×2×3=48 conv")
check(Z80_HOLM_FIRST === 3.777, ...)
check(Math.abs(delta80(1, 24, Z80_HOLM_FIRST) - 1.09) < 0.005, "holm pooled 1.09σ")
check(Math.abs(delta80(1, 12, Z80_HOLM_FIRST) - 1.54) < 0.005, "holm variant 1.54σ")
check((scores.response_profile?.hedgeCount || 0) > 0, `hedgeCount=...`)
```

---

## NEW Bugs Found

### NB1 — `set -uo pipefail` in sourced files overrides supervisor's `set -euo pipefail`

**HIGH.**

`supervisor.sh:8`: `set -euo pipefail`
`oneTurn.sh:3`: `set -uo pipefail` (no `-e`)
`flags.sh:7`: `set -uo pipefail` (no `-e`)
`conversation.sh:8`: `set -uo pipefail` (no `-e`)
`logcat.sh:6`: `set -uo pipefail` (no `-e`)
`watchdog.sh:4`: `set -uo pipefail` (no `-e`)
`recovery.sh:7`: `set -uo pipefail` (no `-e`)
`turn.sh:3`: `set -uo pipefail` (no `-e`)
`phase0.sh:6`: `set -uo pipefail` (no `-e`)

Every sourced file runs `set -uo pipefail` in the current shell context, overriding the supervisor's `set -euo pipefail`. After all sourcing completes, `-e` is gone. Consequences:
- `campaign_run_script_turns`: if python3 fails parsing the script JSON, `user` is empty and the turn proceeds silently with garbage
- `campaign_store_turn`: if any of the three node calls (stamp-eviction, append, checkpoint) fails, the error is swallowed
- Any unguarded command failure between `|| die` patterns is silently ignored

The flags.sh selftest block (`flags.sh:126`) sets `set -euo pipefail` but only when run directly, not when sourced.

**Fix:** All sourced files should use `set -uo pipefail` and the supervisor should re-assert `set -euo pipefail` after all sourcing, OR sourced files should omit `set` entirely and inherit from the parent.

### NB2 — resume.mjs failure in process substitution is silent

**HIGH.**

`supervisor.sh:219-223`:
```sh
  done < <(node "$CAMPAIGN_ROOT/resume.mjs" --root "$OUT" --cells "$cells_file" --nconv "$nconv" --nturns "$nturns")
```

If `resume.mjs` crashes (e.g., corrupt `run-order.json`, missing checkpoint file, invalid JSON), the process substitution produces empty output. The while loop iterates zero times. The supervisor exits silently with no work done and no error. Neither `set -e` nor `set -o pipefail` captures the exit code of `< <(...)`.

**Fix:** Redirect to a temp file and check exit code:
```sh
node "$CAMPAIGN_ROOT/resume.mjs" ... > "$OUT/.resume-plan.txt" || die "resume plan failed"
while read -r arm_id v conv_id action start_turn; do
  ...
done < "$OUT/.resume-plan.txt"
```

### NB3 — Duplicate user message on retry after successful send but failed wait

**MEDIUM.**

`oneTurn.sh:68-86`:
```sh
  campaign_send_turn "$user" || die "share-send failed turn $i (user never landed in SQL)"
  if campaign_wait_turn "$prev" "$slice" "$offset"; then
    campaign_finish_turn "$slice"
    return 0
  fi
  campaign_abort_turn "$CAMPAIGN_TURN_STATUS"
  ...recovery...
  CAMPAIGN_RETRIED=1
  ...
  campaign_send_turn "$user" || { log "turn $i retry send failed — skip"; return 0; }
```

If the first `campaign_send_turn` succeeds (user message lands in SQL) but `campaign_wait_turn` times out or hangs, recovery restores the conversation and the retry sends the **same user message again**. The conversation now has two identical user messages. The assistant responds to the second one; the first is orphaned. The jsonl turn record captures only the second response.

### NB4 — `campaign_recover_status` calls `die` on restore failure for timeout/hang

**MEDIUM.**

`oneTurn.sh:22-26`:
```sh
    timeout|hang)
      campaign_restore_same_conv || die "restore after $status failed turn $CAMPAIGN_TURN_I"
      return 1
```

If `campaign_restore_same_conv` fails (app won't reach Pronto/Ready), `die` kills the entire supervisor. The spec requires "abort that turn, log it, and resume/skip cleanly." For timeout/hang, restore failure should skip the turn (or skip the conversation), not kill the supervisor.

Same pattern for thermal (line 29), adb-drop (line 35), and pid-death (lines 39-41).

**Note:** For pid-death, `die` after reinstall/relaunch failure is arguably correct — if the app can't be reinstalled, the campaign is dead. But for timeout/hang where the app was working before, a single restore failure shouldn't kill everything.

### NB5 — `campaign_score_record` die kills supervisor on scorer crash

**LOW.**

`oneTurn.sh:6-9`:
```sh
campaign_score_record() {
  local rec="${1:?}"
  node "$CAMPAIGN_ROOT/scoring.mjs" --score-turn "$rec" --config "$CONFIG" --repo "$REPO" \
    || die "scorer failed turn ${CAMPAIGN_TURN_I:-?}"
}
```

If `scoring.mjs` crashes (e.g., malformed jsonl record, missing config field), `die` kills the entire supervisor. The turn data was already collected but not scored. The fix should skip scoring and continue, or at minimum write a partial record with null scores.

### NB6 — `campaign_send_turn` die on send failure contradicts skip/resume spec

**LOW.**

`oneTurn.sh:74`:
```sh
  campaign_send_turn "$user" || die "share-send failed turn $i (user never landed in SQL)"
```

After the first send fails all 3 internal retries, `die` kills the supervisor. The fix spec says "abort that turn, log it, and resume/skip cleanly." Send failure should return 1 (skip) rather than die.

Counter-argument: if the user message never landed, the conversation is in an indeterminate state and skipping to the next turn would produce garbage. But the supervisor still dies, which violates the "never block a 2-4h conversation" requirement.

---

## Pre-existing Issue (Not Introduced by Fix Round)

### PES1 — `set -uo pipefail` in all sourced files drops `-e` from supervisor

See NB1 above. This predates the fix round — all sourced files have always used `set -uo pipefail`. The fix round should have either (a) removed `set` from sourced files or (b) re-asserted `set -euo` after sourcing. This is the highest-impact remaining issue.

---

## Checklist

| # | Fix Point | Status | Evidence |
|---|---|---|---|
| F1 | conversationsPerVariant; 3 per cell, 48 total | **CONFIRMED** | config.mjs:138, selftest.mjs asserts nPer===3 and 48 |
| F2 | Process substitution `< <(...)` | **CONFIRMED** | supervisor.sh:219-223 |
| F3 | Abort→RECOVERY jsonl; retry once; skip | **CONFIRMED** | oneTurn.sh:53-86, watchdog.sh:18-46 |
| F4 | runScorers invoked before append | **CONFIRMED** | oneTurn.sh:6-9, 48-51 |
| F5 | responseProfile --lexicon loads lexicon | **CONFIRMED** | responseProfile.mjs:159-163, supervisor.sh:122-124 |
| F6 | resume.mjs + readCheckpoint; skip/resume | **CONFIRMED** | resume.mjs:13,38-65,87, selftest asserts |
| F7 | campaign_find_apk: env,config,debug,release; die | **CONFIRMED** | recovery.sh:84-100,103-104 |
| F8 | phase0_floors writes floors.json; no \|\| true | **CONFIRMED** | phase0.sh:73-78 |
| F9 | collector `node … \|\| die` | **CONFIRMED** | turn.sh:194-207 |
| F10 | evictionTurn sidecar | **CONFIRMED** | datastore.mjs:76-93 |
| F11 | campaign_watch_turn gone | **CONFIRMED** | grep: zero hits |
| 12 | Selftest assertions | **CONFIRMED** | selftest.mjs: all present |

---

## Verdict

**All 12 fix points CONFIRMED landed.** The core structural bugs (pipeline subshell, 96→48 conv, die→skip, scorers invocation, lexicon loading, resume, APK lookup, floors, collector guard, eviction sidecar, dead code) are all fixed.

**6 new bugs found:** 2 HIGH (set -e dropped by sourcing; silent resume.mjs failure), 2 MEDIUM (duplicate user message on retry; die on restore failure), 2 LOW (scorer die kills supervisor; send die contradicts skip spec).

**Recommended priority fixes:**
1. NB1/PES1: Re-assert `set -euo pipefail` after all sourcing in supervisor.sh
2. NB2: Check resume.mjs exit code before reading its output
3. NB4: Replace `die` with skip+log in `campaign_recover_status` for timeout/hang/thermal/adb-drop restore failures
4. NB5/NB6: Replace `die` with skip+log in `campaign_score_record` and `campaign_send_turn` failure paths
