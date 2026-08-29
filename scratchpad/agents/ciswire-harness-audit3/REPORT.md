# CisWire campaign harness — hostile audit

Audit date: 2026-08-27. Audited the working tree, including the uncommitted resilient.sh and supervisor.sh hotfixes. No harness, npm, or node command was run; the checkout was not modified. Live-state observations are read-only snapshots.

## Findings

### 1. A skip row is executed as a new conversation

Verdict: CONFIRMED  
Severity: CRITICAL  
File: scripts/campaign/resume.mjs:107-111; scripts/campaign/supervisor.sh:259-285

Exact lines:

    resume.mjs:109:        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "skip", startTurn: 0 });
    supervisor.sh:259:    if [ "$action" = "resume" ]; then
    supervisor.sh:262:    elif [ "$action" = "invalid" ]; then
    supervisor.sh:271:    else
    supervisor.sh:272:      campaign_arm_begin
    supervisor.sh:273:      start_turn=1
    supervisor.sh:284:    if campaign_run_script_turns "$SCRIPT" "$nturns" "$start_turn"; then

There is no skip branch. Every skip row falls into else, wipes/relaunches the arm, and runs turns 1–24. Once a cell is complete, the next pass duplicates that whole cell instead of advancing past it. A fully complete plan is also rerun before the launcher can notice completion.

### 2. Resume-from-hole replays the real suffix

Verdict: CONFIRMED — FIX-INCOMPLETE  
Severity: CRITICAL  
File: scripts/campaign/resume.mjs:104-111; scripts/campaign/supervisor.sh:154-165

Exact lines:

    resume.mjs:107:      const startTurn = hole !== null ? hole : Number(checkpoint.turn) + 1;
    supervisor.sh:157:  for i in $(seq "$start" "$n"); do
    supervisor.sh:164:    campaign_one_turn "$i" "$user" || return 1

resume.mjs starts at the first hole, but campaign_run_script_turns sends every turn from that hole through 24. It never skips turns that already have real records. The live plan showed R4 A c1-A resume 2 while that JSONL already contained a real turn 3; the next pass therefore replays turn 3 and its suffix. This directly contradicts the 74531a8 guarantee.

### 3. Failed turns return success without a turn record

Verdict: CONFIRMED — FIX-INCOMPLETE  
Severity: CRITICAL  
File: scripts/campaign/oneTurn.sh:107-156; scripts/campaign/supervisor.sh:284-288

Exact lines:

    oneTurn.sh:114:        log "WARN: share-send retry failed turn $i — skip"
    oneTurn.sh:115:        return 0
    oneTurn.sh:132:      log "turn $i user+assistant already landed — skip retry send (no duplicate share)"
    oneTurn.sh:133:      return 0
    oneTurn.sh:141:    campaign_abort_turn "failed-missing-post-crash-resume-$CAMPAIGN_TURN_STATUS"
    oneTurn.sh:143:    return 0
    oneTurn.sh:149:  campaign_send_turn "$user" || { log "turn $i retry send failed — skip"; return 0; }
    oneTurn.sh:154:  campaign_abort_turn "$CAMPAIGN_TURN_STATUS"
    oneTurn.sh:156:  return 0
    supervisor.sh:284:    if campaign_run_script_turns "$SCRIPT" "$nturns" "$start_turn"; then
    supervisor.sh:287:      log "WARN: conversation $CAMPAIGN_ARM_ID/$CAMPAIGN_CONV_ID did not complete cleanly — stopping pass (retry same cell next pass)"

The hotfix only reacts to nonzero return. These branches return zero after send/recovery failure, sometimes after writing only RECOVERY, so the supervisor proceeds to later turns. The live log already recorded FAILED/missing with the same user not resent; the live R4 JSONL had recovery rows for turn 2 and a later real turn.

### 4. The resend race can duplicate a user message

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/oneTurn.sh:107-116; scripts/campaign/turn.sh:15-21,104-163

Exact lines:

    oneTurn.sh:108:      log "WARN: share-send failed turn $i (user never landed in SQL)"
    oneTurn.sh:113:      if ! campaign_send_turn "$user"; then
    oneTurn.sh:115:        return 0
    turn.sh:20:  sql "SELECT value FROM catalystLocalStorage WHERE key='$key';" > "$dest" 2>/dev/null || : > "$dest"
    turn.sh:143:          if campaign_user_landed "$OUT/.messages.json" "$user"; then

The first non-thermal send can land while its observer fails. This retry path does not call campaign_user_landed before resending; the landing guard shown is in the separate retry logic. The live message snapshot contained the same user text repeated three times.

### 5. Duplicate records are accepted and hidden

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/resume.mjs:28-38; scripts/responseProfile.mjs:129-139

Exact lines:

    resume.mjs:31:  const turns = new Set();
    resume.mjs:33:    if (r && r.event !== "RECOVERY" && Number.isFinite(r.i)) turns.add(Number(r.i));
    responseProfile.mjs:132:  const byTurn = new Map();
    responseProfile.mjs:137:    byTurn.set(i, rec);

No duplicate or conflicting i is rejected. Resume treats duplicates as complete, and profiling last-wins. Retry races, skip execution, and concurrent writers therefore become apparently valid data. The live quarantine contains repeated recovery indices.

### 6. Append and checkpoint are not one durable commit

Verdict: CONFIRMED  
Severity: CRITICAL  
File: scripts/campaign/oneTurn.sh:21-26; scripts/campaign/datastore.mjs:44-50

Exact lines:

    oneTurn.sh:23:  node "$CAMPAIGN_ROOT/datastore.mjs" --stamp-eviction "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_CONV_ID" "$rec"
    oneTurn.sh:24:  node "$CAMPAIGN_ROOT/datastore.mjs" --append "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_CONV_ID" "$rec"
    oneTurn.sh:25:  node "$CAMPAIGN_ROOT/datastore.mjs" --checkpoint "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_VARIANT_ID" \
    datastore.mjs:46:  writeFileSync(
    datastore.mjs:48:    JSON.stringify({ arm, variant, conv, turn, at: new Date().toISOString() }, null, 2),

There is no temporary-file/rename, fsync, transaction, compare-and-swap, or duplicate key check. A kill between append and checkpoint leaves a stale checkpoint and causes a resend; a torn write leaves unreadable state. stamp-eviction is another write before append.

### 7. Torn state is fatal and can trigger false completion

Verdict: CONFIRMED  
Severity: CRITICAL  
File: scripts/campaign/datastore.mjs:32-37,52-55; scripts/campaign/resume.mjs:127-141; scripts/campaign/resilient.sh:113-126

Exact lines:

    datastore.mjs:37:    .map((l) => JSON.parse(l));
    datastore.mjs:55:  return JSON.parse(readFileSync(p, "utf8"));
    resume.mjs:139:  } catch (e) {
    resume.mjs:141:    process.exit(2);
    resilient.sh:124:plan = [l.split() for l in open(plan_file) if l.strip()]
    resilient.sh:125:remaining = [p for p in plan if len(p) >= 4 and p[3] != "skip"]
    resilient.sh:126:sys.exit(1 if remaining else 0)

There is no salvage of valid JSONL before a torn line and no quarantine of corrupt state. An empty/partial plan has no qualifying remaining rows, so campaign_finished returns true. The launcher can then create the stop sentinel after resume failed.

### 8. The collector fallback checkpoints incomplete data as a real turn

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/turn.sh:264-291; scripts/campaign/resume.mjs:22-26; scripts/campaign/prereg.mjs:121-124

Exact lines:

    turn.sh:279:  "event": "COLLECT_FAIL",
    turn.sh:282:  "telemetry": {},
    resume.mjs:25: *   COLLECT_FAIL is a turn with a partial record — treat as real so the turn is
    prereg.mjs:122:    const turns = readJsonl(f).filter((t) => !t.retried && t.event !== "RECOVERY");

The fallback can store empty telemetry, empty/stale assistant text, and null scores. Resume counts it as real, while preregulation does not exclude it. A collection failure therefore enters analysis and phase-0 calibration instead of being an excluded failure.

### 9. Collector does not prove the transcript belongs to this turn

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/collector.mjs:16-25,52-63

Exact lines:

    collector.mjs:22:    if (m.role === "user") user = m.text || m.content || "";
    collector.mjs:23:    if (m.role === "assistant") assistant = m.text || m.content || "";
    collector.mjs:52:  const { user, assistant } = lastUserAssistant(opts.messages || []);
    collector.mjs:60:    user,
    collector.mjs:62:    transcript: { user, assistant },

It independently chooses the last user and last assistant in the entire snapshot and never compares the user to the script prompt or checks response identity. Wrong-chat restore, stale reads, duplicate shares, and concurrent supervisors can produce a valid-looking record under the wrong i.

### 10. Telemetry acceptance is neither valid-JSON nor turn-correlated

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/watchdog.sh:14-18; scripts/campaign/telemetryParse.mjs:9-23,63-76

Exact lines:

    watchdog.sh:17:  LC_ALL=C grep -qF "KALSA_TELEMETRY " "$slice"
    telemetryParse.mjs:18:      const obj = JSON.parse(payload);
    telemetryParse.mjs:20:    } catch {
    telemetryParse.mjs:21:      /* malformed: skip */
    telemetryParse.mjs:74:  const rows = byPrefix.KALSA_TELEMETRY || [];
    telemetryParse.mjs:76:  return rows.length ? rows[rows.length - 1] : null;

The watchdog accepts a substring. The parser skips malformed lines and chooses the last parseable record without checking turn ID, timestamp, or response identity. On an off arm, an assistant count increase plus an unparseable telemetry line can pass the wait gate and produce a record with empty telemetry.

### 11. Interrupted responses cannot use the documented no-telemetry path

Verdict: CONFIRMED — FIX-INCOMPLETE  
Severity: MAJOR  
File: scripts/campaign/turn.sh:165-167,207-217; scripts/campaign/collector.mjs:46-50

Exact lines:

    turn.sh:165:# Wait until assistant count increases AND KALSA_TELEMETRY lands, or abort.
    turn.sh:166:# An interrupted bubble completes the turn without requiring count/telemetry.
    turn.sh:207:    if campaign_slice_has_telemetry "$dest"; then
    turn.sh:209:      if [ "$count" -gt "$prev" ]; then
    collector.mjs:48:  else if (declaredBit === 1 && !interrupted) {

The actual outer condition requires telemetry before checking the increased assistant count. Collector permits missing telemetry for interrupted turns, but campaign_wait_turn cannot return interrupted without telemetry. The advertised interrupted-success path is unreachable when telemetry is absent.

### 12. Checkpoint schema validation is inadequate

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/resume.mjs:58-62,71-82,107

Exact lines:

    resume.mjs:59:  const checkpointConv = String(checkpoint?.conv || "");
    resume.mjs:60:  if (checkpoint && (checkpointConv.startsWith("dry-") || !/^c\d+-/.test(checkpointConv))) {
    resume.mjs:61:    checkpoint = null;
    resume.mjs:72:      const cpi = cellIndex(cells, checkpoint.arm, checkpoint.variant);
    resume.mjs:82:      const sameCell = cpi === ci && cn === n;
    resume.mjs:107:      const startTurn = hole !== null ? hole : Number(checkpoint.turn) + 1;

Only the conv spelling is screened. Unknown arm/variant, wrong conversation number, negative/noninteger turn, and nonnumeric turn values survive. They can classify all cells as new, produce an unusable plan, or cause a full rerun.

### 13. The 74531a8 self-test omits the new root argument

Verdict: CONFIRMED — FIX-INCOMPLETE  
Severity: MAJOR  
File: scripts/campaign/selftest.mjs:220-228; scripts/campaign/resume.mjs:76-78

Exact lines:

    selftest.mjs:220:const plan = resumePlan({
    selftest.mjs:225:});
    selftest.mjs:226:check(plan.filter((r) => r.action === "skip" && r.conv === "c1-B").length === 1, "resume skips c1-B");
    selftest.mjs:227:check(plan.some((r) => r.conv === "c2-B" && r.action === "resume" && r.startTurn === 11), "resume c2-B turn 11");
    resume.mjs:76:      if (!convStarted(root, cell.arm, id)) {
    resume.mjs:77:        rows.push({ arm: cell.arm, variant: cell.variant, conv: id, action: "new", startTurn: 1 });

The self-test calls resumePlan without root. Every convStarted lookup uses an undefined root and sees a nonexistent path, so the expected skip/resume assertions cannot be true. The core regression test is not a valid guard for the current implementation.

### 14. Orphan takeover is not process-safe

Verdict: CONFIRMED  
Severity: CRITICAL  
File: scripts/campaign/resilient.sh:85-109

Exact lines:

    resilient.sh:88:  sp=$(cat "$SUP_PIDFILE" 2>/dev/null || echo "")
    resilient.sh:89:  [ -n "$sp" ] && kill -0 "$sp" 2>/dev/null
    resilient.sh:93:  if [ -n "$SUPERVISOR_PID" ] && kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    resilient.sh:95:    kill "$SUPERVISOR_PID" 2>/dev/null || true
    resilient.sh:96:    sleep 1
    resilient.sh:107:trap 'exit 130' TERM

The lock records only a PID, checks only kill -0, does not verify command identity/start time, does not wait for termination, and does not kill the process group or adb children. SIGKILL leaves the lock and children alive. A takeover can overlap the old supervisor while both write the same scratch files and global checkpoint; PID reuse can identify an unrelated process as the owner.

### 15. campaign_finished trusts an empty plan and permanently stops

Verdict: CONFIRMED  
Severity: CRITICAL  
File: scripts/campaign/supervisor.sh:240-242; scripts/campaign/resilient.sh:151-158

Exact lines:

    supervisor.sh:240:  local plan="$OUT/.resume-plan.txt"
    supervisor.sh:242:    >"$plan" || die "resume.mjs exit $?"
    resilient.sh:151:  if [ -f "$STOP_FILE" ]; then
    resilient.sh:155:  if campaign_finished; then
    resilient.sh:157:    touch "$STOP_FILE"
    resilient.sh:158:    exit 0

The supervisor truncates the plan before invoking resume. If resume dies or is killed, the next pass sees the existing empty, malformed, or skip-only plan; finding 7 makes that look complete. The stop file then suppresses all future restarts.

### 16. Thermal recovery is an unbounded silent livelock

Verdict: CONFIRMED  
Severity: CRITICAL  
File: scripts/campaign/oneTurn.sh:91-105; scripts/campaign/recovery.sh:172-186; working-tree diff scripts/campaign/resilient.sh

Exact lines:

    oneTurn.sh:94:      campaign_thermal_cooldown || return 0
    recovery.sh:177:  while [ "$waited" -lt "$cap" ]; do
    recovery.sh:183:  log "thermal still paused after ${cap}s — waiting again, safer than resuming hot (owner: slow but safe)"
    recovery.sh:186:  campaign_thermal_cooldown
    resilient.sh:185:      log "no progress for $NO_PROGRESS_CAP passes (livelock?) — give up (need human)"

Thermal recovery recursively waits forever inside the supervisor. The launcher cannot independently alert or enforce a wall-clock policy. The hotfix raises the default no-progress cap but still contains an eventual exit path. The live run is already cycling at the configured 45°C boundary.

### 17. No-progress detection measures file churn, not completed turns

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/resilient.sh:140-148,181-190

Exact lines:

    resilient.sh:147:progress_snapshot() {
    resilient.sh:148:  ls -l "$OUT"/*/*.jsonl 2>/dev/null | md5 2>/dev/null || find "$OUT" -name '*.jsonl' -newer "$OUT/checkpoint.json" 2>/dev/null | md5 2>/dev/null || echo "none"
    resilient.sh:181:  nowsnap=$(progress_snapshot)
    resilient.sh:182:  if [ "$nowsnap" = "$last_snapshot" ]; then
    resilient.sh:184:    if [ "$no_progress_streak" -ge "$NO_PROGRESS_CAP" ]; then

Appending RECOVERY changes JSONL metadata while no valid turn completes, resetting the detector. Conversely, repeated failures before any write eventually hit the configured/default cap and exit 5. Neither outcome is a trustworthy completed-turn signal.

### 18. Date rollover can split one run across directories

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/resilient.sh:11-15; scripts/campaign/supervisor.sh:81-86

Exact lines:

    supervisor.sh:81:DATE_STAMP=$(date +%Y-%m-%d)
    supervisor.sh:86:OUT="${CAMPAIGN_OUT:-$REPO/$RESULTS_REL/$DATE_STAMP}"

The parent chooses its default date directory once, while every child recomputes local date. A run crossing midnight can have the launcher checking one checkpoint/stop file while the child writes another. The checkpoint at field is UTC while directory selection is local. The live run is pinned to 2026-08-26, but the default is unsafe for a multi-day run.

### 19. Logcat is unbounded and arm starts erase history

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/logcat.sh:22-32,35-40

Exact lines:

    logcat.sh:30:  adb logcat -v threadtime $_CAMPAIGN_LOGCAT_FILTER </dev/null >>"$file" 2>/dev/null &
    logcat.sh:35:campaign_logcat_clear_arm() {
    logcat.sh:39:    : > "$CAMPAIGN_LOGCAT_FILE"
    logcat.sh:40:    campaign_logcat_start "$CAMPAIGN_LOGCAT_FILE"

There is no rotation, cap, free-space check, or write-failure policy. The live logcat was already about 4.4 MB and continues growing. A full host disk can break JSONL/checkpoint writes, while arm clears destroy cross-arm forensic evidence.

### 20. Wi-Fi recovery is pinned to one IP range and the parent keeps a stale serial

Verdict: CONFIRMED  
Severity: MAJOR  
File: campaigns/ciswire.json:3; scripts/campaign/recovery.sh:35-45,68-73; scripts/campaign/resilient.sh:130-135

Exact lines:

    ciswire.json:3:  "device": "192.168.1.82:34037",
    recovery.sh:42:      192.168.1.82:*) printf '%s\n' "$ip"; return 0 ;;
    recovery.sh:71:        export ANDROID_SERIAL="$found"
    recovery.sh:72:        CAMPAIGN_SERIAL="$found"
    resilient.sh:134:  adb devices 2>/dev/null | grep -q "$SERIAL.*device"

Only mDNS endpoints beginning 192.168.1.82: are accepted. A DHCP change to another address is rejected. A child’s updated serial does not update the parent’s fixed SERIAL, so the launcher can classify a recovered device as missing and eventually give up.

### 21. ADB stdin hardening is incomplete

Verdict: CONFIRMED — FIX-INCOMPLETE  
Severity: MAJOR  
File: scripts/device-env.sh:59-71,100-103; scripts/device-share-send.sh:123-129; scripts/ci-lib.sh:36,82-85,185-197

Exact lines:

    device-env.sh:59:  v=$(adb shell dumpsys battery 2>/dev/null | tr -d '\r' | device_battery_temp_from_dump || true)
    device-env.sh:100:  adb shell cmd statusbar collapse >/dev/null 2>&1 || true
    device-share-send.sh:127:  adb shell am start -a android.intent.action.VIEW \
    ci-lib.sh:36:dump_ui() { adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1; adb shell cat /data/local/tmp/ui.xml 2>/dev/null; }
    ci-lib.sh:84:    adb shell "sqlite3 $DB \"$1\"" 2>&1 | tr -d '\r'
    ci-lib.sh:196:  adb shell input tap "$cx" "$cy"

The plan-reader hotfix removes the original plan-file stdin hazard, but the sourced active helpers still invoke adb without null stdin or an isolated descriptor. These calls can consume/block inherited input; many also suppress errors and turn device failure into empty state.

### 22. Stale UI XML can drive wrong taps

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/ci-lib.sh:36-37; scripts/device-env.sh:106-117

Exact lines:

    ci-lib.sh:36:dump_ui() { adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1; adb shell cat /data/local/tmp/ui.xml 2>/dev/null; }
    device-env.sh:109:    out=$(dump_ui 2>/dev/null || true)
    device-env.sh:110:    if printf '%s' "$out" | grep -q '<hierarchy'; then

dump_ui ignores the dump status and cats the old remote XML. Any old file containing hierarchy is accepted. A stale composer/Send screen can pass readiness and cause the following tap to be attributed to the wrong turn.

### 23. Unknown thermal readings are treated as safe

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/recovery.sh:136-150

Exact lines:

    recovery.sh:138:  st=$(device_thermal_status)
    recovery.sh:140:    ''|unknown|*[!0-9]*) return 1 ;;
    recovery.sh:148:    ''|unknown|*[!0-9.]*) return 1 ;;
    recovery.sh:150:  python3 -c "exit(0 if float('$bt') > $CAMPAIGN_THERMAL_MAX_C else 1)"

The caller treats return 0 as pause. Unreadable status or temperature returns 1, so the run continues when its safety probe is silent. This contradicts the broader ci-lib thermal policy that says unreadable should keep waiting.

### 24. Phase-0 calibration fabricates zero axes and includes COLLECT_FAIL

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/prereg.mjs:86-109,119-136

Exact lines:

    prereg.mjs:95:    if (typeof p.echoRate === "number") echo.push(p.echoRate);
    prereg.mjs:104:    "echo-rate": echo.length ? mean(echo) : 0,
    prereg.mjs:108:    recall: recall.length ? mean(recall) : 0,
    prereg.mjs:122:    const turns = readJsonl(f).filter((t) => !t.retried && t.event !== "RECOVERY");
    prereg.mjs:129:  let status = n >= 2 ? "FROM_R1" : "PENDING_PHASE0";
    prereg.mjs:136:      sigma[axis] = { sigma: sd, status: "FROM_R1" };

An axis with no valid observations becomes exactly zero, without a missingness flag. COLLECT_FAIL is not filtered, so failed collection can contribute a zero-filled conversation. The live floors.json says FROM_R1 with nConversations 2 and zero sigma for tool-call-rate and recall despite the R1 files not supplying normal observations for those axes.

### 25. Telemetry coercion fabricates flag/tool observations

Verdict: CONFIRMED  
Severity: MAJOR  
File: scripts/campaign/telemetryParse.mjs:27-40; scripts/campaign/scoring.mjs:29-37

Exact lines:

    telemetryParse.mjs:29:  for (const k of schema.absentZero || []) {
    telemetryParse.mjs:30:    if (next[k] === undefined || next[k] === null) next[k] = 0;
    telemetryParse.mjs:38:  const n = Number(v);
    telemetryParse.mjs:39:  return Number.isFinite(n) ? n : 0;
    scoring.mjs:32:  const called = Boolean(last.tool || last.toolName || last.toolCalled);

An empty string becomes numeric zero; malformed/nonfinite flags also become zero; a string such as false is truthy for toolCalled. No error/missing state distinguishes malformed from observed zero.

### 26. Quarantine can overwrite derived artifacts

Verdict: PLAUSIBLE  
Severity: MAJOR  
File: scripts/campaign/conversation.sh:40-52

Exact lines:

    conversation.sh:45:    local dest="$qdir/$CAMPAIGN_ARM_ID-$CAMPAIGN_CONV_ID-$(date +%Y%m%d-%H%M%S).jsonl"
    conversation.sh:46:    mv "$src" "$dest"
    conversation.sh:50:  [ -f "$prof" ] && mv "$prof" "$qdir/" 2>/dev/null || true
    conversation.sh:52:  [ -f "$ev" ] && mv "$ev" "$qdir/" 2>/dev/null || true

The primary JSONL is namespaced, but profile and eviction sidecars are moved into one flat directory by basename. Re-quarantining the same cell can replace/collide with an earlier derived artifact, and the error is swallowed. The live quarantine contains repeated profile basenames.

### 27. Host sleep is not prevented

Verdict: PLAUSIBLE  
Severity: MAJOR  
File: scripts/ci-lib.sh:1101-1135; scripts/device-env.sh:94-98

Exact lines:

    ci-lib.sh:1118:  if adb shell "settings put system screen_off_timeout $KA_SCREEN_TIMEOUT_MS" >/dev/null 2>&1; then
    ci-lib.sh:1124:  if adb shell "dumpsys deviceidle whitelist +$PKG" >/dev/null 2>&1; then
    ci-lib.sh:1134:  adb shell "input keyevent KEYCODE_WAKEUP" >/dev/null 2>&1 || true
    device-env.sh:97:  trap 'device_termux_wakelock_restore; device_keepawake_restore' EXIT

These are device-side measures. There is no host caffeinate, pmset, sleepwatcher, or equivalent in the audited paths. Mac sleep can suspend the launcher, adb/logcat, and timers; no host-wake recovery or independent alert exists.

## Refuted-candidate checks

- The original plan-file stdin-consumption bug is not present in the current supervisor loop: scripts/campaign/supervisor.sh:247-250 reads the plan into an array before processing it.
- The old check-interrupted-before-count ordering is not present: scripts/campaign/turn.sh:207-216 checks count > prev before the interrupted test.
- The campaign send needle is no longer the old byte-oriented awk test: scripts/campaign/turn.sh:104-112 constructs it with Python character slicing. The legacy helper has separate awk code, but the campaign path uses campaign_send_turn.

## Top five risks for the next 10 unattended days

1. **CRITICAL — skip rows and hole resumes resend already recorded conversations.** Custodian: do not trust further JSONL; preserve a read-only copy and alert the owner. Owner fix required: explicit skip handling plus per-turn idempotent resume/dedup; a launcher setting cannot repair this.

2. **CRITICAL — append/checkpoint/torn-file failure can lose, duplicate, or strand data.** Custodian: monitor disk and retain live/quarantine files; do not hand-edit or delete them. Owner fix required: atomic durable records, validated commit ordering, and corrupt-tail recovery.

3. **CRITICAL — orphan/two-supervisor races corrupt shared scratch state and attribution.** Custodian: if duplicate PIDs appear, stop/alert rather than permit both to write. Owner fix required: process-group cleanup, PID identity/start-time validation, and isolated scratch files.

4. **CRITICAL — thermal cooldown can livelock without an independent alert, while the launcher has contradictory eventual exits.** Custodian: treat sustained thermal logs as a failed run and notify the owner. Owner fix required: explicit thermal timeout/alert policy and progress based on completed valid turns.

5. **CRITICAL — empty/truncated resume plan can create .campaign-done and stop all future work.** Custodian: verify every expected plan row before accepting a stop-file exit. Owner fix required: atomic plan publication plus exact 48-cell/144-conversation completion validation.
