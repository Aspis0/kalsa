#!/bin/bash
# Helper + arm-phase functions for the QDC heat run driver.
# Reused from qdc-governor-s5b (typing, cooldown, wake, run-as, logcat); the
# oracle, mmproj and per-arm reinstall paths were removed, route/new-chat
# phases were added for the /bench route heat protocol.

EMPTY_TEXT="${EMPTY_TEXT:-}"

device_tag() {
  case "$1" in
    QRD8650|SM8650) printf '8-Gen-3\n' ;;
    QRD8750|SM8750) printf '8-Elite\n' ;;
    *) printf '%s\n' "$(printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '-')" ;;
  esac
}

configure_screen() {
  local previous
  previous=$(adbT 60 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r') || return 1
  [ -n "$previous" ] || return 1
  SCREEN_OFF_TIMEOUT="$previous"
  SCREEN_OFF_TIMEOUT_SAVED=1
  printf 'screen_off_timeout_previous=%s\n' "$SCREEN_OFF_TIMEOUT" >> "$RAW/recon.txt"
  adbT 60 -s "$SER" shell svc power stayon true >> "$RAW/recon.txt" 2>&1 || return 1
  adbT 60 -s "$SER" shell settings put system screen_off_timeout 1800000 >> "$RAW/recon.txt" 2>&1 || return 1
}

run_as_retry() {
  local mode="$1"
  local record="$2"
  local output="$3"
  local timeout_s="$4"
  local attempt chmod_rc rc
  local err_file="${output}.runas.err"
  shift 4
  : >> "$record"
  : > "$output"
  for attempt in 1 2 3; do
    : > "$err_file"
    adbT 60 -s "$SER" shell chmod 771 /data >> "$record" 2>&1
    chmod_rc=$?
    if [ "$chmod_rc" -ne 0 ]; then rm -f "$err_file"; return "$chmod_rc"; fi
    if [ "$mode" = shell ]; then
      if [ "$#" -ne 1 ]; then rm -f "$err_file"; return 2; fi
      adbT "$timeout_s" -s "$SER" shell "run-as $PKG $1" > "$output" 2> "$err_file"
    else
      adbT "$timeout_s" -s "$SER" exec-out run-as "$PKG" "$@" > "$output" 2> "$err_file"
    fi
    rc=$?
    cat "$err_file" >> "$record"
    printf 'run_as_attempt=%s chmod_rc=%s run_rc=%s\n' "$attempt" "$chmod_rc" "$rc" >> "$record"
    if [ "$rc" -eq 0 ]; then rm -f "$err_file"; return 0; fi
    if grep -qi 'readable or writable by others' "$output" "$err_file" 2>/dev/null; then
      [ "$attempt" -lt 3 ] && sleep 2
      continue
    fi
    rm -f "$err_file"
    return "$rc"
  done
  rm -f "$err_file"
  return "$rc"
}

model_setup() {
  local local_sha device_sha size run_rc stat_out
  local copy_out stat_out_file
  [ -f "$MODEL" ] || { log "MODEL_MISSING=$MODEL"; return 1; }
  local_sha=$(/usr/bin/shasum -a 256 "$MODEL" | awk '{print $1}')
  size=$(wc -c < "$MODEL" | tr -d '[:space:]')
  if [ "$local_sha" != "$MODEL_SHA" ] || [ "$size" != "$MODEL_SIZE" ]; then
    log "LOCAL_MODEL_IDENTITY_FAIL sha=$local_sha size=$size"
    return 1
  fi
  adbT 60 -s "$SER" shell "mkdir -p $DEVICE_TMP" >/dev/null 2>&1 || return 1
  device_sha=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_REMOTE 2>/dev/null" | awk '{print $1}' | tr -d '\r')
  if [ "$device_sha" != "$MODEL_SHA" ]; then
    adbT 900 -s "$SER" push "$MODEL" "$MODEL_REMOTE" > "$RAW/model_push.txt" 2>&1
    rc=$?; [ "$rc" -eq 0 ] || { log "MODEL_PUSH_FAIL rc=$rc"; return 1; }
    device_sha=$(adbT 300 -s "$SER" shell "sha256sum $MODEL_REMOTE" | awk '{print $1}' | tr -d '\r')
  fi
  [ "$device_sha" = "$MODEL_SHA" ] || { log "DEVICE_MODEL_SHA_FAIL=$device_sha"; return 1; }
  adbT 60 -s "$SER" shell "chmod 644 $MODEL_REMOTE" >> "$RAW/model_push.txt" 2>&1
  : > "$RAW/model_copy.txt"
  copy_out="$RAW/model_copy.runas"; stat_out_file="$RAW/model_stat.runas"
  run_as_retry shell "$RAW/model_copy.txt" "$copy_out" 600 "sh -c 'mkdir -p files/models/$MODEL_DIR && cp $MODEL_REMOTE files/models/$MODEL_DIR/$MODEL_FILE'"
  run_rc=$?; cat "$copy_out" >> "$RAW/model_copy.txt"; rm -f "$copy_out"
  [ "$run_rc" -eq 0 ] || { log "MODEL_COPY_FAIL"; return 1; }
  run_as_retry shell "$RAW/model_copy.txt" "$stat_out_file" 60 "stat -c %s files/models/$MODEL_DIR/$MODEL_FILE"
  run_rc=$?; stat_out=$(cat "$stat_out_file"); cat "$stat_out_file" >> "$RAW/model_copy.txt"; rm -f "$stat_out_file"
  [ "$run_rc" -eq 0 ] || return 1
  size=$(printf '%s' "$stat_out" | tr -d '[:space:]')
  [ "$size" = "$MODEL_SIZE" ] || { log "MODEL_COPY_SIZE_FAIL size=$size"; return 1; }
  mmproj_setup
}

# The registry entry declares an mmproj; isModelBundleDownloaded() refuses the
# whole bundle (Send stays disabled, "Held: the model has to be loaded again")
# unless it is present at the exact registry size. Cost session 844629 and the
# first attempt of sa849155.
mmproj_setup() {
  local size stat_out run_rc remote="$DEVICE_TMP/$MMPROJ_FILE" out="$RAW/mmproj_stat.runas"
  size=$(wc -c < "$MMPROJ" | tr -d '[:space:]')
  [ "$size" = "$MMPROJ_SIZE" ] || { log "LOCAL_MMPROJ_SIZE_FAIL size=$size"; return 1; }
  size=$(adbT 60 -s "$SER" shell "stat -c %s $remote 2>/dev/null" | tr -d '\r[:space:]')
  if [ "$size" != "$MMPROJ_SIZE" ]; then
    adbT 600 -s "$SER" push "$MMPROJ" "$remote" > "$RAW/mmproj_push.txt" 2>&1 || { log "MMPROJ_PUSH_FAIL"; return 1; }
  fi
  adbT 60 -s "$SER" shell "chmod 644 $remote" >> "$RAW/mmproj_push.txt" 2>&1
  run_as_retry shell "$RAW/mmproj_copy.txt" "$out" 300 "sh -c 'mkdir -p files/models/$MODEL_DIR && cp $remote files/models/$MODEL_DIR/$MMPROJ_FILE'"
  run_rc=$?; rm -f "$out"
  [ "$run_rc" -eq 0 ] || { log "MMPROJ_COPY_FAIL"; return 1; }
  run_as_retry shell "$RAW/mmproj_copy.txt" "$out" 60 "stat -c %s files/models/$MODEL_DIR/$MMPROJ_FILE"
  run_rc=$?; stat_out=$(tr -d '[:space:]' < "$out"); rm -f "$out"
  [ "$run_rc" -eq 0 ] && [ "$stat_out" = "$MMPROJ_SIZE" ] || { log "MMPROJ_COPY_SIZE_FAIL size=$stat_out"; return 1; }
}

pull_rkstorage() {
  local dir="$1"
  local check_out run_rc
  : > "$dir/pull.err"
  run_as_retry exec "$dir/pull.err" "$dir/RKStorage" 300 cat databases/RKStorage || return 1
  check_out="$dir/RKStorage-wal.check"
  run_as_retry shell "$dir/pull.err" "$check_out" 60 "test -f databases/RKStorage-wal"; run_rc=$?; rm -f "$check_out"
  if [ "$run_rc" -eq 0 ]; then run_as_retry exec "$dir/pull.err" "$dir/RKStorage-wal" 300 cat databases/RKStorage-wal || return 1; fi
  check_out="$dir/RKStorage-shm.check"
  run_as_retry shell "$dir/pull.err" "$check_out" 60 "test -f databases/RKStorage-shm"; run_rc=$?; rm -f "$check_out"
  if [ "$run_rc" -eq 0 ]; then run_as_retry exec "$dir/pull.err" "$dir/RKStorage-shm" 300 cat databases/RKStorage-shm || return 1; fi
}

fresh_install() {
  local prefix="$1" uninstall_rc adb_list_rc package_count package_output rc flags
  adbT 120 -s "$SER" shell "pm uninstall $PKG" > "${prefix}_uninstall_old.txt" 2>&1
  uninstall_rc=$?
  package_output=$(adbT 60 -s "$SER" shell "pm list packages | grep -c com.kalsa.app; list_rc=\$?; printf 'list_rc=%s\\n' \"\$list_rc\"" 2> "${prefix}_package_check.txt")
  adb_list_rc=$?; printf '%s\n' "$package_output" > "${prefix}_package_count.txt"
  package_count=$(printf '%s\n' "$package_output" | sed -n '1p' | tr -d '\r[:space:]'); list_rc=$(printf '%s\n' "$package_output" | sed -n 's/.*list_rc=//p' | tr -d '\r[:space:]')
  printf 'uninstall_rc=%s package_count=%s list_rc=%s adb_list_rc=%s\n' "$uninstall_rc" "$package_count" "$list_rc" "$adb_list_rc" >> "${prefix}_uninstall_old.txt"
  # On a fresh board uninstall_rc=1 (nothing to delete) and grep -c exits 1 on zero matches.
  [ "$adb_list_rc" -eq 0 ] && [ "${package_count:-1}" = 0 ] || return 1
  /usr/bin/shasum -a 256 "$APK" > "${prefix}_apk_sha.txt" 2>&1
  adbT 300 -s "$SER" install -r "$APK" > "${prefix}_install.txt" 2>&1
  rc=$?; [ "$rc" -eq 0 ] || return 1
  adbT 60 -s "$SER" shell "dumpsys package $PKG | grep -i flags" > "${prefix}_flags.txt" 2>&1
  flags=$(cat "${prefix}_flags.txt")
  printf 'application-debuggable required; flags=%s\n' "$flags" >> "${prefix}_apk_sha.txt"
  printf '%s' "$flags" | grep -qi DEBUGGABLE
}

bootstrap_db() {
  local prefix="$1" i
  device_wake
  adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" > "${prefix}_bootstrap.txt" 2>&1 || true
  sleep 25
  adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_bootstrap.txt" 2>&1 || true
  for i in 1 2; do
    local check_out="${prefix}_bootstrap.runas"
    run_as_retry shell "${prefix}_bootstrap.txt" "$check_out" 60 "test -f databases/RKStorage"; local run_rc=$?; rm -f "$check_out"
    if [ "$run_rc" -eq 0 ]; then return 0; fi
    if [ "$i" -eq 1 ]; then
      device_wake; adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" >> "${prefix}_bootstrap.txt" 2>&1 || true
      sleep 25; adbT 60 -s "$SER" shell "am force-stop $PKG" >> "${prefix}_bootstrap.txt" 2>&1 || true
    fi
  done
  return 1
}

make_thermo() {
  local skin="$1" now trend
  now=$(date +%s)
  if [ "$PREV_TIME" -gt 0 ]; then
    trend=$(awk -v a="$skin" -v b="$PREV_SKIN" -v d="$((now-PREV_TIME))" 'BEGIN{if(d>0)printf "%.3f",(a-b)/(d/60);else print "0.000"}')
  else
    trend=0.000
  fi
  THERMO_JSON=$(printf '{"batt_temp_tenths_c":%s,"batt_level_pct":100,"plugged":false,"sensor_valid":true,"t_idle_valid":true,"t_idle_c":%s,"trend_c_per_min":%s}' "$(awk -v v="$skin" 'BEGIN{printf "%.0f",v*10}')" "$FIRST_SKIN_C" "$trend")
  PREV_SKIN="$skin"; PREV_TIME="$now"
}

set_prefs() {
  local prefix="$1"
  local prefs_sql dir remote run_rc
  prefs_sql="INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR'),('kalsa.governor.enabled','1'),('kalsa.bench.governor_force','0'),('kalsa.bench.thermo','$THERMO_JSON'),('kalsa.bench.sampling','greedy'),('kalsa.web.enabled','0'),('kalsa.bench.toolchoice','none'),('kalsa.tools.device','0'),('kalsa.tools.calendar','0');"
  dir=$(mktemp -d /tmp/kalsa-heat-rkstorage.XXXXXX) || return 1
  : > "$prefix"_prefs.txt
  pull_rkstorage "$dir" || { rm -rf "$dir"; return 1; }
  /usr/bin/sqlite3 -bail "$dir/RKStorage" "$prefs_sql" >/dev/null || { rm -rf "$dir"; return 1; }
  /usr/bin/sqlite3 -bail "$dir/RKStorage" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null || { rm -rf "$dir"; return 1; }
  remote="$DEVICE_TMP/rkstorage-$JOB-$$"
  adbT 300 -s "$SER" push "$dir/RKStorage" "$remote" >> "${prefix}_prefs.txt" 2>&1; run_rc=$?
  if [ "$run_rc" -eq 0 ]; then
    run_as_retry shell "${prefix}_prefs.txt" "${prefix}_prefs.copy" 120 "cp $remote databases/RKStorage"; run_rc=$?; cat "${prefix}_prefs.copy" >> "${prefix}_prefs.txt"; rm -f "${prefix}_prefs.copy"
  fi
  if [ "$run_rc" -eq 0 ]; then
    run_as_retry shell "${prefix}_prefs.txt" "${prefix}_prefs.remove" 60 "rm -f databases/RKStorage-wal databases/RKStorage-shm"; run_rc=$?; cat "${prefix}_prefs.remove" >> "${prefix}_prefs.txt"; rm -f "${prefix}_prefs.remove"
  fi
  adbT 60 -s "$SER" shell "rm -f $remote" >/dev/null 2>&1 || true
  rm -rf "$dir"
  return "$run_rc"
}

count_after() { awk -v a="$ANCHOR_EPOCH" -v m="$1" '$1+0>=a&&index($0,m)>0{n++}END{print n+0}' "$2"; }
count_lmkd_after() { awk -v a="$ANCHOR_EPOCH" -v p="$APP_PID" '$1+0>=a&&$0~/(lmkd|am_kill|lowmemorykiller)/&&(index($0,"com.kalsa.app")>0||(p!=""&&index($0,p)>0)){n++}END{print n+0}' "$1"; }
last_json_after() { awk -v a="$ANCHOR_EPOCH" -v m="$1" '$1+0>=a&&index($0,m)>0{x=$0}END{sub(".*"m,"",x);sub(/^[[:space:]]+/,"",x);print x}' "$2"; }
last_kvprefix_after() { awk -v a="$SEND_ANCHOR_EPOCH" '$1+0>=a&&/KALSA_KVPREFIX embd=[0-9]+ text_tokens=[0-9]+ n_common=[0-9]+/{x=$0}END{print x}' "$1"; }
last_reuse_after() { awk -v a="$SEND_ANCHOR_EPOCH" '$1+0>=a&&/reusing [0-9]+\/[0-9]+/{x=$0}END{print x}' "$1"; }
json_field() { local json="$1"; local key="$2"; [ -n "$json" ] || return 0; printf '%s' "$json" | /usr/bin/perl -MJSON::PP -e '$k=shift;$t=do{local $/;<STDIN>};eval{$v=decode_json($t)->{$k};print defined($v)?$v:""}' "$key"; }
# Sum of route_chunks[].tokens + per-chunk requested/actual audit for one arm.
route_chunks_audit() {
  # args: <gov-json> <key=route_chunks> <backend>; perl receives (key, backend) on argv.
  local json="$1" key="$2" backend="$3"
  printf '%s' "$json" | /usr/bin/perl -MJSON::PP -e '
    my $k = shift; my $backend = shift; my $t = do { local $/; <STDIN> };
    my $v = eval { decode_json($t)->{$k} };
    if (!defined $v || ref($v) ne "ARRAY") { print "sum= chunks= ok=0\n"; exit 0; }
    my ($sum, $parts, $ok) = (0, [], 1);
    for my $c (@$v) {
      $sum += $c->{tokens} // 0;
      push @$parts, ($c->{tokens} // 0);
      my $req = $c->{requested} // ""; my $act = $c->{actual} // "";
      $ok = 0 unless $act eq $backend;
      $ok = 0 unless $req eq $backend || $req eq "auto";
    }
    print "sum=$sum chunks=" . join("+", @$parts) . " ok=$ok\n";
  ' "$key" "$backend"
}
last_epoch() {
  local file="$1" value
  [ -s "$file" ] || { printf '0'; return 0; }
  value=$(tail -n 1 "$file" | awk 'NF { print $1; exit }')
  awk -v value="$value" 'BEGIN { if (value ~ /^[0-9]+([.][0-9]+)?$/) printf "%.3f\n", value; else print 0 }'
}
complete_logcat() {
  local file="$1" last_byte
  [ -s "$file" ] || return 1
  last_byte=$(tail -c 1 "$file" | od -An -t x1 | tr -d '[:space:]')
  [ "$last_byte" = 0a ]
}
logcat_all() {
  local requested_timeout="$1" timeout_s
  local file="$2"
  local tmp="${file}.tmp"
  local existing_epoch tmp_epoch attempt rc complete
  existing_epoch=$(last_epoch "$file")
  timeout_s=$(( requested_timeout > 120 ? requested_timeout : 120 ))
  for attempt in 1 2 3; do
    : > "$tmp"
    adbT "$timeout_s" -s "$SER" logcat -v epoch -d -b all > "$tmp" 2>&1
    rc=$?; tmp_epoch=$(last_epoch "$tmp"); complete=0; complete_logcat "$tmp" && complete=1
    if [ "$rc" -eq 0 ] && [ "$complete" -eq 1 ] && awk -v newer="$tmp_epoch" -v older="$existing_epoch" 'BEGIN { exit !(newer + 0 >= older + 0) }' >/dev/null 2>&1 && mv "$tmp" "$file"; then return 0; fi
    printf 'logcat_attempt=%s rc=%s tmp_epoch=%s existing_epoch=%s complete=%s\n' "$attempt" "$rc" "$tmp_epoch" "$existing_epoch" "$complete" >> "${file}.failures"
    rm -f "$tmp"
    [ "$attempt" -lt 3 ] && sleep 3
  done
  return 1
}
telemetry_complete() {
  local file="$1"
  local j n
  j=$(last_json_after KALSA_TELEMETRY "$file")
  n=$(json_field "$j" tokensPredicted)
  awk -v n="$n" 'BEGIN{exit !(n ~ /^[0-9]+([.][0-9]+)?$/&&n>=1)}' >/dev/null 2>&1
}
lmkd_all_after() { local file="$1"; local out="$2"; awk -v a="$ANCHOR_EPOCH" '($1+0)>=a&&tolower($0)~/lmkd|lowmemorykiller/&&tolower($0)~/kill/{print}' "$file" > "$out"; }

battery_read() {
  local out
  out=$(adbT 60 -s "$SER" shell dumpsys battery 2>/dev/null | sed -n 's/.*temperature: *\([0-9][0-9]*\).*/\1/p' | head -1 | tr -d '\r')
  [ -n "$out" ] || out=na
  printf '%s' "$out"
}

# One-per-board token calibration: short READY turn in a fresh chat after a
# route command; returns sum(route_chunks.tokens) = template+message overhead.
calibrate_turn() {
  local prefix="$1" backend="$2"
  local logcat="${prefix}_logcat_all.txt" gov bench_chunks n0 rc
  clear_anchor "$prefix" || return 1
  app_foreground "$prefix" || return 1
  route_send "$prefix" "$backend"; rc=$?
  [ "$rc" -eq 0 ] || { printf 'calib	ROUTE_SEND_RC=%s\n' "$rc"; return 1; }
  # bench:route is intercepted by runBenchTurn (host/benchTurn.ts): no model
  # call, no telemetry. The READY turn's KALSA_GOVERNOR route fields validate it.
  sleep 3
  new_chat "$prefix" || { printf 'calib	NEWCHAT_FAIL\n'; return 1; }
  TYPE_TEXT="Reply with exactly READY."
  ui_send "$prefix" cal; rc=$?
  [ "$rc" -eq 0 ] || { printf 'calib	READY_SEND_RC=%s\n' "$rc"; return 1; }
  poll_until_telemetry "$logcat" 300 || { printf 'calib	READY_NO_TELEMETRY\n'; return 1; }
  sleep 2; logcat_all 120 "$logcat" || true
  gov=$(last_json_after 'KALSA_GOVERNOR ' "$logcat")
  bench_chunks=$(route_chunks_audit "$gov" route_chunks "$backend")
  n0=$(printf '%s' "$bench_chunks" | sed -n 's/.*sum=\([0-9]*\).*/\1/p')
  printf 'calib	backend=%s\troute_push=%s\tchunks_sum=%s\ttool_calls=%s\n' \
    "$backend" "$(json_field "$gov" route_push)" "${n0:-na}" "$(count_after KALSA_TOOLCALL "$logcat")"
  [ -n "$n0" ] && [ "$n0" -gt 0 ] 2>/dev/null
}

thermal_record() {
  local name
  name=$(basename "$1")
  local file="$RAW/${name}_thermal.txt"
  local gate="${file%.txt}_gate.txt"
  local attempt rc skin max_temp skin_valid
  rc=1; skin=""; skin_valid=0
  for attempt in 1 2 3; do
    adbT 90 -s "$SER" shell dumpsys thermalservice > "$file" 2>&1
    rc=$?
    awk '/Current temperatures from HAL/{f=1} f{print} /Current cooling devices from HAL/{f=0}' "$file" > "$gate"
    skin=$(sed -n 's/.*mValue=\([0-9][0-9.]*\), mType=3, mName=skin.*/\1/p' "$gate" | head -1 | tr -d '\r')
    skin_valid=0
    awk -v v="$skin" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/) }' >/dev/null 2>&1 && skin_valid=1
    [ "$rc" -eq 0 ] && [ "$skin_valid" -eq 1 ] && break
    [ "$attempt" -lt 3 ] && sleep 2
  done
  [ "$rc" -eq 0 ] && [ "$skin_valid" -eq 1 ] || { printf 'void_reason=thermal\n' >> "$gate"; return 1; }
  printf '%s' "$skin"
}

cooldown_to_target() {
  local prefix="$1"
  local sample_file="${prefix}_cooldown.txt"
  local sample rc elapsed
  : > "$sample_file"
  elapsed=0; COOLDOWN_SECONDS=na; WARM_START=0
  while [ "$elapsed" -le "$COOL_MAX_S" ]; do
    deadline_check
    sample=$(thermal_record "${prefix}_cooldown")
    rc=$?
    [ "$rc" -eq 0 ] || return 1
    printf 'wait_s=%s skin=%s target_c=%s\n' "$elapsed" "$sample" "$COOL_TARGET_C" >> "$sample_file"
    if awk -v v="$sample" -v target="$COOL_TARGET_C" 'BEGIN { exit !(v <= target) }' >/dev/null 2>&1; then
      COOLDOWN_SECONDS="$elapsed"
      return 0
    fi
    [ "$elapsed" -lt "$COOL_MAX_S" ] || break
    sleep "$COOL_POLL_S"
    elapsed=$((elapsed + COOL_POLL_S))
  done
  COOLDOWN_SECONDS="$COOL_MAX_S"
  WARM_START=1
  return 0
}

settle_to_target() {
  local prefix="$1"
  local sample_file="${prefix}_settle.txt"
  local sample rc elapsed
  : > "$sample_file"
  elapsed=0; SETTLE_SECONDS=na
  while [ "$elapsed" -le "$SETTLE_MAX_S" ]; do
    deadline_check
    sample=$(thermal_record "${prefix}_settle")
    rc=$?
    [ "$rc" -eq 0 ] || return 1
    printf 'wait_s=%s skin=%s target_c=%s\n' "$elapsed" "$sample" "$SETTLE_TARGET_C" >> "$sample_file"
    if awk -v v="$sample" -v target="$SETTLE_TARGET_C" 'BEGIN { exit !(v <= target) }' >/dev/null 2>&1; then
      SETTLE_SECONDS="$elapsed"
      return 0
    fi
    [ "$elapsed" -lt "$SETTLE_MAX_S" ] || break
    sleep "$COOL_POLL_S"
    elapsed=$((elapsed + COOL_POLL_S))
  done
  SETTLE_SECONDS="$SETTLE_MAX_S"
  return 2
}

clear_anchor() {
  local prefix="$1"
  adbT 60 -s "$SER" logcat -b all -c > "${prefix}_clear.txt" 2>&1 || return 1
  adbT 60 -s "$SER" shell "date +%s" > "${prefix}_anchor_epoch.txt" 2>&1 || return 1
  ANCHOR_EPOCH=$(cat "${prefix}_anchor_epoch.txt" | tr -d '\r[:space:]')
  ANCHOR_STAMP=$(adbT 60 -s "$SER" shell "date '+%m-%d %H:%M:%S.000'" | tr -d '\r')
  awk -v a="$ANCHOR_EPOCH" 'BEGIN{exit !(a ~ /^[0-9]+$/)}' >/dev/null 2>&1
}
app_foreground() {
  local prefix="$1" top attempt
  for attempt in 1 2; do
    top=$(adbT 60 -s "$SER" shell dumpsys activity activities 2>/dev/null | sed -n 's/.*topResumedActivity.*ActivityRecord{[^ ]* [^ ]* \([^ }]*\).*/\1/p' | head -1 | tr -d '\r')
    printf 'attempt=%s top=%s\n' "$attempt" "$top" >> "${prefix}_foreground.txt"
    case "$top" in *"$PKG"*) return 0 ;; esac
    adbT 60 -s "$SER" shell "am start -n $PKG/.MainActivity" >> "${prefix}_foreground.txt" 2>&1 || true
    sleep 3
  done
  return 1
}
poll_until_telemetry() {
  local file="$1" cap_s="$2" elapsed=0
  while [ "$elapsed" -lt "$cap_s" ]; do
    deadline_check; logcat_all 60 "$file" || true
    telemetry_complete "$file" && return 0
    sleep 5; elapsed=$((elapsed + 5))
  done
  logcat_all 60 "$file" || true; telemetry_complete "$file"
}
MODEL_LOAD_PATTERN="llama_model_loader: loaded meta data with .* from /data/user/0/com.kalsa.app/files/models/$MODEL_DIR/$MODEL_FILE"
PREWARM_PATTERN='KALSA_PREWARM.*"op":"done"'
has_load_proof() { grep -E "$MODEL_LOAD_PATTERN" "$1" >/dev/null 2>&1 && grep -E "$PREWARM_PATTERN" "$1" >/dev/null 2>&1; }
poll_load() {
  local file="$1"
  local elapsed=0
  : > "$file"
  while [ "$elapsed" -lt 300 ]; do
    deadline_check
    logcat_all 60 "$file" || true
    has_load_proof "$file" && return 0
    sleep 5; elapsed=$((elapsed + 5))
  done
  logcat_all 60 "$file" || true; has_load_proof "$file"
}

dump_ui() {
  local out="$1"
  local dump_log="${out}.dump.log"
  local attempt rc rm_rc cat_rc wake_status
  : > "$dump_log"
  : > "$out"
  for attempt in 1 2 3 4 5; do
    adbT 60 -s "$SER" shell dumpsys power > "${out}.power_attempt${attempt}.txt" 2>&1 || true
    wake_status=$(wake_state "${out}.power_attempt${attempt}.txt")
    if [ "${wake_status:-missing}" != Awake ]; then
      printf 'attempt=%s wake_action=sequence\n' "$attempt" >> "$dump_log"
      wake_sequence "$dump_log" || { [ "$attempt" -lt 5 ] && sleep 3; continue; }
    fi
    adbT 60 -s "$SER" shell "rm -f $DEVICE_TMP/ui.xml" >> "$dump_log" 2>&1
    rm_rc=$?
    adbT 60 -s "$SER" shell "uiautomator dump $DEVICE_TMP/ui.xml" >> "$dump_log" 2>&1
    rc=$?
    printf 'attempt=%s rm_rc=%s rc=%s\n' "$attempt" "$rm_rc" "$rc" >> "$dump_log"
    if [ "$rm_rc" -eq 0 ] && [ "$rc" -eq 0 ]; then
      adbT 60 -s "$SER" shell "cat $DEVICE_TMP/ui.xml" > "$out" 2>> "$dump_log"
      cat_rc=$?
      printf 'attempt=%s cat_rc=%s\n' "$attempt" "$cat_rc" >> "$dump_log"
      if [ "$cat_rc" -eq 0 ] && [ -s "$out" ]; then
        tr -d '\r' < "$out" > "$out.tmp" && mv "$out.tmp" "$out"
        if [ -s "$out" ]; then
          if ! grep -q 'package="com.kalsa.app"' "$out"; then
            printf 'attempt=%s aod\n' "$attempt" >> "$dump_log"
            wake_sequence "$dump_log" || true
            [ "$attempt" -lt 5 ] && sleep 3
            continue
          fi
          return 0
        fi
      fi
    fi
    [ "$attempt" -lt 5 ] && sleep 3
  done
  return 1
}
bounds_edit() { tr '>' '\n' < "$1" | grep 'class="android.widget.EditText"' | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1; }
bounds_send() { tr '>' '\n' < "$1" | grep -E 'content-desc="Send"|content-desc="Invia"|text="Send"' | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1; }
bounds_by_desc() {
  local file="$1" desc="$2"
  tr '>' '\n' < "$file" | grep -E "content-desc=\"$desc\"" | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1
}
tap_bounds() {
  local b="$1"
  local x1 y1 x2 y2
  read -r x1 y1 x2 y2 <<< "$b"
  adbT 60 -s "$SER" shell input tap "$(((x1 + x2) / 2))" "$(((y1 + y2) / 2))"
}
composer_text_attr() {
  local file="$1"
  local attr="$2"
  local node
  node=""
  [ -s "$file" ] && node=$(tr '>' '\n' < "$file" | grep 'class="android.widget.EditText"' | head -1)
  printf '%s' "$node" | sed -n "s/.*${attr}=\"\([^\"]*\)\".*/\1/p"
}
composer_text_len() {
  local file="$1"
  local text hint actual hint_len empty_text_len
  text=$(composer_text_attr "$file" text)
  hint=$(composer_text_attr "$file" hint)
  hint_len=$(printf '%s' "$hint" | wc -m | tr -d '[:space:]')
  empty_text_len=$(printf '%s' "$EMPTY_TEXT" | wc -m | tr -d '[:space:]')
  if [ -z "$text" ] || [ "$text" = "$hint" ] || [ "$text" = "$EMPTY_TEXT" ]; then
    actual=0
  else
    actual=$(printf '%s' "$text" | wc -m | tr -d '[:space:]')
  fi
  printf '%s %s %s' "$actual" "$hint_len" "$empty_text_len"
}
composer_check() {
  local prefix="$1"
  local file="$2"
  local attempt="$3"
  local expected="$4"
  local actual metrics hint_len empty_text_len
  metrics=$(composer_text_len "$file")
  actual=${metrics%% *}
  metrics=${metrics#* }
  hint_len=${metrics%% *}
  empty_text_len=${metrics##* }
  [ -n "$actual" ] || actual=0
  [ -n "$hint_len" ] || hint_len=0
  [ -n "$empty_text_len" ] || empty_text_len=0
  printf 'attempt=%s actual=%s expected=%s hint_len=%s empty_text_len=%s\n' "$attempt" "$actual" "$expected" "$hint_len" "$empty_text_len" >> "${prefix}_composer_len.txt"
  [ "$actual" -eq "$expected" ]
}
clear_composer() {
  adbT 60 -s "$SER" shell input keycombination KEYCODE_CTRL_LEFT KEYCODE_A || return 1
  adbT 60 -s "$SER" shell input keyevent KEYCODE_DEL
}
verify_typed_chunk() {
  local prefix="$1"
  local attempt="$2"
  local chunk_no="$3"
  local expected_len="$4"
  local started="$5"
  local file="${prefix}_typing_chunk_a${attempt}_c${chunk_no}.xml"
  local actual expected actual_len result now elapsed dump_rc
  dump_ui "$file"
  dump_rc=$?
  actual=$(composer_text_attr "$file" text)
  expected="${TYPE_TEXT:0:expected_len}"
  actual_len=$(printf '%s' "$actual" | wc -m | tr -d '[:space:]')
  if [ "$dump_rc" -eq 0 ] && [ "$actual" = "$expected" ]; then
    result=exact
  elif [ "$actual_len" -lt "$expected_len" ] && [ "${TYPE_TEXT:0:actual_len}" = "$actual" ]; then
    result=short
  else
    result=mismatch
  fi
  now=$(date +%s)
  elapsed=$((now - started))
  printf 'attempt=%s chunk=%s len=%s expected=%s result=%s t=%ss\n' "$attempt" "$chunk_no" "$actual_len" "$expected_len" "$result" "$elapsed" >> "${prefix}_typing_chunks.txt"
  TYPE_VERIFY_RESULT="$result"
  TYPE_VERIFY_TEXT="$actual"
  TYPE_VERIFY_LEN="$actual_len"
  [ "$result" = exact ]
}
send_prompt_chunk() {
  local prefix="$1"
  local chunk_no="$2"
  local offset="$3"
  local chunk_size="$4"
  local chunk encoded escaped rc
  chunk="${TYPE_TEXT:$offset:$chunk_size}"
  [ -n "$chunk" ] || return 1
  typing_awake "$prefix" "$chunk_no" || return 2
  encoded=$(printf '%s' "$chunk" | sed 's/ /%s/g')
  escaped=$(printf '%s' "$encoded" | sed "s/'/'\\\\''/g")
  adbT 300 -s "$SER" shell "input text '$escaped'"
  rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
}
typing_awake() {
  local prefix="$1"
  local chunk="$2"
  local before_file="${prefix}_typing_wake_${chunk}_before.txt"
  local after_file="${prefix}_typing_wake_${chunk}_after.txt"
  local before after
  power_capture "$before_file" || return 1
  if grep -q 'mWakefulness=Awake' "$before_file"; then
    before=Awake; after=Awake
  else
    before=$(wake_state "$before_file")
    printf 'typing_chunk=%s wake_before=%s action=wake\n' "$chunk" "${before:-missing}" >> "${prefix}_ui_attempts.txt"
    wake_sequence "${prefix}_typing_wake.log" || return 1
    power_capture "$after_file" || return 1
    after=$(wake_state "$after_file")
  fi
  printf 'typing_chunk=%s wake_before=%s wake_after=%s\n' "$chunk" "${before:-missing}" "${after:-missing}" >> "${prefix}_ui_attempts.txt"
  [ "${after:-missing}" = Awake ]
}
clear_for_retry() {
  clear_composer || return 1
  sleep 2
}
type_cap_for_chunk() {
  case "$1" in
    200) printf '400\n' ;;
    100) printf '700\n' ;;
    *) return 1 ;;
  esac
}
type_prompt() {
  local prefix="$1"
  local text_len offset chunk chunks chunk_size chunk_no expected_len
  local attempt attempt_start now elapsed cap rc result first_loss_expected first_rung
  TYPE_ATTEMPT_NO=${TYPE_ATTEMPT_NO:-0}
  [ -n "$TYPE_TEXT" ] || return 1
  text_len=${#TYPE_TEXT}
  first_rung=1
  for chunk_size in $TYPE_LADDER; do
    TYPE_ATTEMPT_NO=$((TYPE_ATTEMPT_NO + 1))
    attempt="$TYPE_ATTEMPT_NO"
    cap=$(type_cap_for_chunk "$chunk_size") || return 1
    attempt_start=$(date +%s)
    deadline_check
    sleep 2
    offset=0
    chunks=0
    while [ "$offset" -lt "$text_len" ]; do
      now=$(date +%s)
      elapsed=$((now - attempt_start))
      if [ "$elapsed" -ge "$cap" ]; then
        printf 'attempt=%s chunk_size=%s seconds=%s rc=2\n' "$attempt" "$chunk_size" "$elapsed" >> "${prefix}_type_prompt.txt"
        return 2
      fi
      chunk_no=$((chunks + 1))
      chunk="${TYPE_TEXT:$offset:$chunk_size}"
      expected_len=$((offset + ${#chunk}))
      send_prompt_chunk "$prefix" "$chunk_no" "$offset" "$chunk_size"
      rc=$?
      if [ "$rc" -ne 0 ]; then
        now=$(date +%s); elapsed=$((now - attempt_start))
        printf 'attempt=%s chunk_size=%s seconds=%s rc=%s\n' "$attempt" "$chunk_size" "$elapsed" "$rc" >> "${prefix}_type_prompt.txt"
        return 2
      fi
      offset="$expected_len"
      chunks=$((chunks + 1))
      if [ "${TYPE_FAST:-0}" = "1" ]; then continue; fi
      verify_typed_chunk "$prefix" "$attempt" "$chunk_no" "$expected_len" "$attempt_start"
      rc=$?
      result="$TYPE_VERIFY_RESULT"
      first_loss_expected="${TYPE_TEXT:1:TYPE_VERIFY_LEN}"
      if [ "$rc" -eq 0 ]; then
        offset="$expected_len"
        chunks=$((chunks + 1))
        continue
      fi
      if [ "$chunk_no" -eq 1 ] && [ "$first_rung" -eq 1 ] && [ "$TYPE_VERIFY_TEXT" = "$first_loss_expected" ]; then
        clear_for_retry || { printf 'attempt=%s chunk_size=%s seconds=%s rc=2\n' "$attempt" "$chunk_size" "$(( $(date +%s) - attempt_start ))" >> "${prefix}_type_prompt.txt"; return 2; }
        send_prompt_chunk "$prefix" "$chunk_no" 0 "$chunk_size"
        rc=$?
        if [ "$rc" -eq 0 ]; then
          expected_len=${#chunk}
          verify_typed_chunk "$prefix" "$attempt" "$chunk_no" "$expected_len" "$attempt_start"
          rc=$?
          result="$TYPE_VERIFY_RESULT"
          if [ "$rc" -eq 0 ]; then
            offset="$expected_len"
            chunks=$((chunks + 1))
            continue
          fi
        fi
      fi
      clear_for_retry || { printf 'attempt=%s chunk_size=%s seconds=%s rc=2\n' "$attempt" "$chunk_size" "$(( $(date +%s) - attempt_start ))" >> "${prefix}_type_prompt.txt"; return 2; }
      now=$(date +%s); elapsed=$((now - attempt_start))
      printf 'attempt=%s chunk_size=%s seconds=%s rc=1\n' "$attempt" "$chunk_size" "$elapsed" >> "${prefix}_type_prompt.txt"
      break
    done
    if [ "$offset" -eq "$text_len" ]; then
      now=$(date +%s); elapsed=$((now - attempt_start))
      if [ "$elapsed" -ge "$cap" ]; then
        printf 'attempt=%s chunk_size=%s seconds=%s rc=2\n' "$attempt" "$chunk_size" "$elapsed" >> "${prefix}_type_prompt.txt"
        return 2
      fi
      printf 'attempt=%s chunk_size=%s seconds=%s rc=0\n' "$attempt" "$chunk_size" "$elapsed" >> "${prefix}_type_prompt.txt"
      TYPE_PROMPT_CALLS=$((TYPE_PROMPT_CALLS + 1))
      return 0
    fi
    first_rung=0
  done
  return 2
}

# ui_send: focus the composer, TYPE_TEXT is typed, verified and sent.
ui_send() {
  local prefix="$1"
  local attempts_file="${prefix}_ui_attempts.txt"
  local edit_file="${prefix}_edit.xml"
  local send_file="${prefix}_send.xml"
  local retry_file="${prefix}_composer_retry.xml"
  local cleared_file="${prefix}_composer_cleared.xml"
  local attempt edit_bounds send_bounds previous_send send_anchor
  local edit_dump_rc send_dump_rc
  local type_start type_end type_rc type_elapsed typing_total
  local composer_ok cleared_len metrics hint_len empty_text_len
  : > "$attempts_file"
  : > "${prefix}_composer_len.txt"
  : > "${prefix}_type_prompt.txt"
  : > "${prefix}_typing_chunks.txt"
  previous_send=""
  typing_total=0
  EMPTY_TEXT=""
  LAST_EDIT_BOUNDS=""
  TYPE_ATTEMPT_NO=0

  sleep 3
  dump_ui "$edit_file"
  edit_dump_rc=$?
  edit_bounds=""
  [ "$edit_dump_rc" -eq 0 ] && [ -s "$edit_file" ] && edit_bounds=$(bounds_edit "$edit_file") || edit_bounds=""
  if [ -z "$edit_bounds" ]; then
    printf 'dump_fail stage=edit rc=%s\n' "$edit_dump_rc" >> "$attempts_file"
    void_reason=composer
    return 2
  fi
  LAST_EDIT_BOUNDS="$edit_bounds"
  EMPTY_TEXT=$(composer_text_attr "$edit_file" text)
  local leftover_len metrics_left
  metrics_left=$(composer_text_len "$edit_file")
  leftover_len=${metrics_left%% *}
  [ -n "$leftover_len" ] || leftover_len=0
  if [ "$leftover_len" -gt 3 ]; then
    printf 'pre_clear leftover=%s\n' "$leftover_len" >> "${prefix}_composer_len.txt"
    clear_composer || { void_reason=composer; return 2; }
    sleep 1
    dump_ui "$edit_file" || { void_reason=composer; return 2; }
    EMPTY_TEXT=$(composer_text_attr "$edit_file" text)
  fi
  tap_bounds "$edit_bounds" || return 1
  type_start=$(date +%s)
  type_prompt "$prefix"
  type_rc=$?
  type_end=$(date +%s)
  type_elapsed=$((type_end - type_start))
  typing_total=$type_elapsed
  printf 'initial_seconds=%s rc=%s total_seconds=%s\n' "$type_elapsed" "$type_rc" "$typing_total" >> "${prefix}_type_prompt.txt"
  [ "$type_rc" -ne 2 ] || { void_reason=composer; return 2; }

  dump_ui "$send_file"
  send_dump_rc=$?
  if [ "$send_dump_rc" -ne 0 ]; then
    printf 'dump_fail stage=send attempt=0 rc=%s\n' "$send_dump_rc" >> "$attempts_file"
    void_reason=composer
    return 2
  fi
  composer_ok=1
  if [ "$type_rc" -ne 0 ] || ! [ -s "$send_file" ] || ! composer_check "$prefix" "$send_file" initial "${#TYPE_TEXT}"; then
    composer_ok=0
  fi
  if [ "$composer_ok" -eq 0 ]; then
    clear_composer || { void_reason=composer; return 2; }
    dump_ui "$cleared_file" || { void_reason=composer; return 2; }
    metrics=$(composer_text_len "$cleared_file")
    cleared_len=${metrics%% *}
    [ -n "$cleared_len" ] || cleared_len=0
    printf 'attempt=cleared actual=%s expected_len=%s\n' "$cleared_len" "${#TYPE_TEXT}" >> "${prefix}_composer_len.txt"
    [ "$cleared_len" -le 3 ] || { void_reason=composer; return 2; }
    type_start=$(date +%s)
    type_prompt "$prefix"
    type_rc=$?
    type_end=$(date +%s)
    type_elapsed=$((type_end - type_start))
    typing_total=$((typing_total + type_elapsed))
    printf 'retype_seconds=%s rc=%s total_seconds=%s\n' "$type_elapsed" "$type_rc" "$typing_total" >> "${prefix}_type_prompt.txt"
    [ "$type_rc" -ne 2 ] || { void_reason=composer; return 2; }
    dump_ui "$retry_file" || true
    [ "$type_rc" -eq 0 ] || { void_reason=composer; return 2; }
    composer_check "$prefix" "$retry_file" retype "${#TYPE_TEXT}" || { void_reason=composer; return 2; }
    send_file="$retry_file"
  fi

  send_bounds=""
  [ -s "$send_file" ] && send_bounds=$(bounds_send "$send_file") || send_bounds=""
  [ -n "$send_bounds" ] || printf 'dump_fail stage=send bounds-missing\n' >> "$attempts_file"
  for attempt in 1 2 3; do
    if [ "$attempt" -gt 1 ]; then
      sleep 3
      ensure_awake "${prefix}_ui_attempt${attempt}" || true
      if [ -z "$previous_send" ]; then
        adbT 60 -s "$SER" shell input keyevent 4 > "${prefix}_ime_dismiss_${attempt}.txt" 2>&1 || true
      fi
      send_file="${prefix}_send_attempt${attempt}.xml"
      dump_ui "$send_file" || true
      send_bounds=""
      [ -s "$send_file" ] && send_bounds=$(bounds_send "$send_file") || send_bounds=""
      [ -n "$send_bounds" ] || printf 'dump_fail stage=send attempt=%s\n' "$attempt" >> "$attempts_file"
    fi
    printf 'attempt=%s edit_bounds=%s send_bounds=%s\n' "$attempt" "${edit_bounds:-na}" "${send_bounds:-na}" >> "$attempts_file"
    ensure_awake "${prefix}_ui_send${attempt}" || true
    if [ -n "$send_bounds" ]; then
      adbT 60 -s "$SER" shell "date +%s" > "${prefix}_send_anchor_epoch.txt" 2>&1
      send_anchor=$(cat "${prefix}_send_anchor_epoch.txt" | tr -d '\r[:space:]')
      if awk -v a="$send_anchor" 'BEGIN{exit !(a ~ /^[0-9]+$/)}' >/dev/null 2>&1; then
        SEND_ANCHOR_EPOCH="$send_anchor"
        if tap_bounds "$send_bounds"; then return 0; fi
      fi
    fi
    previous_send="$send_bounds"
  done
  void_reason=composer
  return 2
}

# route_send: type `bench:route <mode>` and send it.
route_send() {
  local prefix="$1"
  local mode="$2"
  TYPE_TEXT="bench:route $mode"
  ui_send "$prefix"
  local rc=$?
  return "$rc"
}

# new_chat: drawer -> "New chat" -> composer empty.
new_chat() {
  local prefix="$1"
  local d1="${prefix}_drawer.xml" d2="${prefix}_drawer_newchat.xml" d3="${prefix}_after_newchat.xml"
  local b b2 attempt
  for attempt in 1 2; do
    dump_ui "$d1" || { sleep 3; continue; }
    # This APK's hamburger a11y label is "Open menu" (QRD8650 dump, same build);
    # keep the other locales/labels as fallbacks.
    b=$(bounds_by_desc "$d1" "Open menu")
    [ -z "$b" ] && b=$(bounds_by_desc "$d1" "Menu")
    [ -z "$b" ] && b=$(bounds_by_desc "$d1" "Apri il menu")
    if [ -z "$b" ]; then
      printf 'new_chat attempt=%s menu-button-missing\n' "$attempt" >> "${prefix}_new_chat.txt"
      adbT 60 -s "$SER" shell input keyevent 4 >/dev/null 2>&1 || true
      sleep 2
      continue
    fi
    tap_bounds "$b" || { sleep 2; continue; }
    sleep 2
    dump_ui "$d2" || { adbT 60 -s "$SER" shell input keyevent 4 >/dev/null 2>&1 || true; sleep 2; continue; }
    b2=$(bounds_by_desc "$d2" "New chat")
    [ -z "$b2" ] && b2=$(bounds_by_desc "$d2" "Nuova chat")
    if [ -z "$b2" ]; then
      printf 'new_chat attempt=%s newchat-missing\n' "$attempt" >> "${prefix}_new_chat.txt"
      adbT 60 -s "$SER" shell input keyevent 4 >/dev/null 2>&1 || true
      sleep 2
      continue
    fi
    tap_bounds "$b2" || { sleep 2; continue; }
    sleep 3
    if dump_ui "$d3"; then
      EMPTY_TEXT=$(composer_text_attr "$d3" text)
      local metrics actual
      metrics=$(composer_text_len "$d3")
      actual=${metrics%% *}
      [ -n "$actual" ] || actual=0
      printf 'new_chat attempt=%s composer_actual=%s\n' "$attempt" "$actual" >> "${prefix}_new_chat.txt"
      [ "$actual" -le 3 ] && return 0
    fi
  done
  return 2
}

# smoke_one: one tiny READY turn after a route command; returns prompt_n.
smoke_turn() {
  local prefix="$1" backend="$2"
  local logcat="${prefix}_logcat_all.txt"
  local row_void=0 route_push=na route_mismatch=na chunks_sum=na prompt_n=na tokens_predicted=na gov tel rc
  clear_anchor "$prefix" || return 1
  app_foreground "$prefix" || { printf 'smoke\t%s\tFOREGROUND_FAIL\n' "$backend" >> "$SMOKE_TSV"; return 1; }
  route_send "$prefix" "$backend"; rc=$?
  if [ "$rc" -ne 0 ]; then printf 'smoke\t%s\tROUTE_SEND_RC=%s\n' "$backend" "$rc" >> "$SMOKE_TSV"; return 1; fi
  sleep 3  # bench:route never calls the model (runBenchTurn): nothing to poll
  new_chat "$prefix" || { printf 'smoke\t%s\tNEWCHAT_FAIL\n' "$backend" >> "$SMOKE_TSV"; return 1; }
  TYPE_TEXT="Reply with exactly READY."
  ui_send "$prefix" sm; rc=$?
  if [ "$rc" -ne 0 ]; then printf 'smoke\t%s\tREADY_SEND_RC=%s\n' "$backend" "$rc" >> "$SMOKE_TSV"; return 1; fi
  poll_until_telemetry "$logcat" 300 || { printf 'smoke\t%s\tREADY_NOCOMPLETE\n' "$backend" >> "$SMOKE_TSV"; return 1; }
  sleep 2; logcat_all 120 "$logcat" || true
  tel=$(last_json_after KALSA_TELEMETRY "$logcat")
  gov=$(last_json_after 'KALSA_GOVERNOR ' "$logcat")
  prompt_n=$(json_field "$tel" prompt_n); tokens_predicted=$(json_field "$tel" tokensPredicted)
  route_push=$(json_field "$gov" route_push); route_mismatch=$(json_field "$gov" route_mismatch)
  local bench_chunks
  bench_chunks=$(route_chunks_audit "$gov" route_chunks "$backend")
  chunks_sum=$(printf '%s\n' "$bench_chunks" | sed -n 's/.*sum=\([0-9]*\).*/\1/p')
  printf 'smoke\t%s\troute_push=%s\troute_mismatch=%s\tchunks_sum=%s\tprompt_n=%s\ttokens_predicted=%s\n' \
    "$backend" "${route_push:-na}" "${route_mismatch:-na}" "${chunks_sum:-na}" "${prompt_n:-na}" "${tokens_predicted:-na}" >> "$SMOKE_TSV"
  [ "${route_push:-}" = "applied" ] && [ "${chunks_sum:-0}" -gt 0 ] 2>/dev/null
}

run_smoke() {
  # CPU -> GPU -> CPU tiny-turn smoke (S23 protocol gate), plus template-overhead readout.
  : > "$SMOKE_TSV"
  device_wake || true
  app_foreground "$RAW/smoke" || { log "SMOKE_FOREGROUND_FAIL"; return 1; }
  poll_load "$RAW/smoke_load.txt" || { log "SMOKE_LOAD_FAIL"; return 1; }
  smoke_turn "$RAW/smoke_t_cpu1" cpu || true
  smoke_turn "$RAW/smoke_t_gpu" gpu || true
  smoke_turn "$RAW/smoke_t_cpu2" cpu || true
  log "SMOKE_TSV:"
  cat "$SMOKE_TSV" >> "$DRIVER_LOG"
  return 0
}

# run_arm: one measured arm (backend=cpu|gpu).
run_arm() {
  local backend="$1" pair="$2" turn="$3"
  local prefix="$RAW/${BOARD}_${backend}_p${pair}t${turn}"
  local logcat="${prefix}_logcat_all.txt"
  local status=0 row_void=0 void_reason=na
  local cooldown_rc settle_rc skin_before=na skin_after=na
  local warm_start=0 battery_before=na battery_after=na tool_calls=0
  local tel gov bench_chunks chunks_sum chunks_str chunks_ok
  local ttft=na prefill_ms=na engine_prefill=na engine_decode=na route_requested=na route_push=na route_mismatch=na
  local prompt_n=na tokens_predicted=na decode_tps=na thermal=na failed=na fallback=0 lmkd=0
  local reuse_line kvprefix
  deadline_check
  LAST_EDIT_BOUNDS=""
  void_reason=na
  # 1) cooldown as a CAP only (owner decision: no cool-start gate) — start the
  # arm after at most 720 s even if the board is warm; record wait + flag.
  cooldown_to_target "$prefix"; cooldown_rc=$?
  if [ "$cooldown_rc" -ne 0 ]; then
    log "COOLDOWN_THERMAL_FAIL backend=$backend pair=$pair"
    return 1
  fi
  [ "$WARM_START" = "1" ] && warm_start=1
  # 2) route command turn (also triggers model load when idle-unloaded)
  clear_anchor "$prefix" || return 1
  device_wake || true
  app_foreground "$prefix" || { row_void=1; void_reason=foreground; }
  if [ "$row_void" -eq 0 ]; then
    APP_PID=$(adbT 60 -s "$SER" shell pidof "$PKG" | awk 'NR==1{print $1;exit}' | tr -d '\r')
    route_send "$prefix" "$backend"; rc=$?
    case "$rc" in
      0) : ;;
      2) row_void=1; void_reason=composer ;;
      *) return 1 ;;
    esac
  fi
  if [ "$row_void" -eq 0 ]; then
    sleep 3  # bench:route never calls the model (runBenchTurn); route_requested validates the arm
  fi
  # 3) fresh chat so the measured prefill is uncached
  if [ "$row_void" -eq 0 ]; then
    app_foreground "$prefix" || true
    new_chat "$prefix" || { row_void=1; void_reason=newchat; }
  fi
  # 4) settle back to target after the reload/ack activity (recorded, not gated)
  if [ "$row_void" -eq 0 ]; then
    settle_to_target "$prefix"; settle_rc=$?
    [ "$settle_rc" -eq 1 ] && { log "SETTLE_THERMAL_FAIL backend=$backend pair=$pair"; return 1; }
  fi
  # 5) type + send the measured prompt
  if [ "$row_void" -eq 0 ]; then
    TYPE_TEXT="$PROMPT_TEXT"
    skin_before=$(thermal_record "${prefix}_before") || skin_before=na
    battery_before=$(battery_read)
    ui_send "$prefix" "$turn"; rc=$?
    case "$rc" in
      0) : ;;
      2) row_void=1; [ "$void_reason" = "na" ] && void_reason=composer ;;
      *) return 1 ;;
    esac
  fi
  # 6) wait for completion + 60 s tail (sampler keeps recording)
  if [ "$row_void" -eq 0 ]; then
    poll_until_telemetry "$logcat" 600 || { row_void=1; void_reason=telemetry; }
    sleep 2; logcat_all 120 "$logcat" || true
    sleep 60
  fi
  [ -f "$logcat" ] || : > "$logcat"
  lmkd_all_after "$logcat" "${prefix}_lmkd_all.txt" || true
  skin_after=$(thermal_record "${prefix}_after") || skin_after=na
  battery_after=$(battery_read)
  tool_calls=$(count_after KALSA_TOOLCALL "$logcat")
  grep -E 'KALSA_|llama_model_loader|reusing [0-9]+/[0-9]+|KVPREFIX' "$logcat" > "${prefix}_filtered.txt" 2>/dev/null || true
  fallback=$(count_after 'KALSA_GOVERNOR_FALLBACK' "$logcat")
  lmkd=$(count_lmkd_after "$logcat")
  tel=$(last_json_after KALSA_TELEMETRY "$logcat")
  gov=$(last_json_after 'KALSA_GOVERNOR ' "$logcat")
  ttft=$(json_field "$tel" promptMs); prompt_n=$(json_field "$tel" prompt_n); tokens_predicted=$(json_field "$tel" tokensPredicted); decode_tps=$(json_field "$tel" predictedPerSecond)
  if [ -n "$gov" ]; then
    prefill_ms=$(json_field "$gov" prefill_ms); engine_prefill=$(json_field "$gov" engine_prefill); engine_decode=$(json_field "$gov" engine_decode)
    route_requested=$(json_field "$gov" route_requested); route_push=$(json_field "$gov" route_push); route_mismatch=$(json_field "$gov" route_mismatch)
    thermal=$(json_field "$gov" thermal_state); failed=$(json_field "$gov" failed)
    bench_chunks=$(route_chunks_audit "$gov" route_chunks "$backend")
    chunks_sum=$(printf '%s\n' "$bench_chunks" | sed -n 's/.*sum=\([0-9]*\).*/\1/p'); [ -n "$chunks_sum" ] || chunks_sum=na
    chunks_str=$(printf '%s\n' "$bench_chunks" | sed -n 's/.*chunks=\([^ ]*\) ok=.*/\1/p'); [ -n "$chunks_str" ] || chunks_str=na
    chunks_ok=$(printf '%s\n' "$bench_chunks" | sed -n 's/.*ok=\([01]\).*/\1/p'); [ -n "$chunks_ok" ] || chunks_ok=0
  else
    chunks_sum=na; chunks_str=na; chunks_ok=0
  fi
  reuse_line=$(last_reuse_after "$logcat"); kvprefix=$(last_kvprefix_after "$logcat")
  { printf 'reuse=%s\nkvprefix=%s\n' "${reuse_line:-na}" "${kvprefix:-na}"; } >> "${prefix}_filtered.txt"
  for v in ttft prefill_ms engine_prefill engine_decode route_requested route_push route_mismatch prompt_n tokens_predicted decode_tps thermal failed; do
    eval "[ -n \"\$$v\" ] || $v=na"
  done
  # validity gate (task: route_mismatch or route_push != applied -> INVALID)
  # JSON booleans arrive as 0/1 from JSON::PP (occasionally "false"/"true" raw).
  if [ "$row_void" -eq 0 ]; then
    [ "$route_push" = "applied" ] || { row_void=1; void_reason=route_push; }
    { [ "$route_mismatch" = "0" ] || [ "$route_mismatch" = "false" ]; } || { row_void=1; void_reason=route_mismatch; }
    [ "$route_requested" = "$backend" ] || { row_void=1; void_reason=route_requested; }
    { [ "$failed" = "0" ] || [ "$failed" = "false" ] || [ "$failed" = "na" ]; } || { row_void=1; void_reason=governor_failed; }
    [ "$fallback" -eq 0 ] 2>/dev/null || { row_void=1; void_reason=fallback; }
    [ "${tool_calls:-0}" -eq 0 ] 2>/dev/null || { row_void=1; void_reason=tool_round; }
    [ "$chunks_ok" = "1" ] || { row_void=1; void_reason=chunks_backend; }
    awk -v n="$chunks_sum" 'BEGIN{exit !(n ~ /^[0-9]+$/ && n>=973 && n<=1126)}' >/dev/null 2>&1 || { row_void=1; void_reason=token_band; }
    [ -n "$prefill_ms" ] && [ "$prefill_ms" != "na" ] || { row_void=1; void_reason=no_prefill_ms; }
  fi
  local row_status=OK; [ "$row_void" -eq 0 ] || row_status=INVALID
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$pair" "$backend" "$turn" "$row_status" "$void_reason" "$warm_start" "$COOLDOWN_SECONDS" "$SETTLE_SECONDS" \
    "$skin_before" "$skin_after" "$battery_before" "$battery_after" "$prefill_ms" "$engine_prefill" "$engine_decode" \
    "$route_requested" "$route_push" "$route_mismatch" "$chunks_sum" "$chunks_str" \
    "$prompt_n" "$tokens_predicted" "$decode_tps" "$thermal" "$failed" "$fallback" "$tool_calls" "$lmkd" | tee -a "$RESULTS"
  [ "$lmkd" -eq 0 ] || status=1
  return "$status"
}
