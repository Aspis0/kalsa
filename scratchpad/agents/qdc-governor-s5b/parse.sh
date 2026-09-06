#!/bin/bash

EMPTY_TEXT="${EMPTY_TEXT:-}"

device_tag() {
  local product_name="$1"
  local soc="${2:-}"
  local tag
  case "$product_name:$soc" in
    QRD8650:*|SM8650:*|*:SM8650|*:QRD8650) tag=8-Gen-3 ;;
    QRD7675:*|SM7675:*|*:SM7675|*:QRD7675) tag=7p-Gen-3 ;;
    HDK8550:*|SM8550:*|*:SM8550|*:HDK8550) tag=8-Gen-2 ;;
    QRD8635:*|SM8635:*|*:SM8635|*:QRD8635) tag=8s-Gen-3 ;;
    QRD8750:*|SM8750:*|*:SM8750|*:QRD8750) tag=8-Elite ;;
    *)
      tag=$(printf '%s' "$product_name" | sed 's/[^A-Za-z0-9_.-]/-/g;s/^[.-]*//;s/[.-]*$//')
      [ -n "$tag" ] || tag=unknown
      ;;
  esac
  printf '%s\n' "$tag"
}

configure_screen() {
  local previous
  previous=$(adbT 60 -s "$SER" shell settings get system screen_off_timeout | tr -d '\r') || return 1
  [ -n "$previous" ] || return 1
  SCREEN_OFF_TIMEOUT="$previous"
  SCREEN_OFF_TIMEOUT_SAVED=1
  printf 'screen_off_timeout_previous=%s\n' "$SCREEN_OFF_TIMEOUT" >> "$RAW/recon.txt"
  printf 'screen_stayon=true screen_off_timeout_set=1800000\n' >> "$RAW/recon.txt"
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

copy_model() {
  local prefix="$1" stat_out size run_rc
  local copy_out="${prefix}_model_copy.runas"
  local stat_out_file="${prefix}_model_stat.runas"
  : > "${prefix}_model_copy.txt"
  run_as_retry shell "${prefix}_model_copy.txt" "$copy_out" 300 "sh -c 'mkdir -p files/models/$MODEL_DIR && cp $MODEL_REMOTE files/models/$MODEL_DIR/$MODEL_FILE'"
  run_rc=$?; cat "$copy_out" >> "${prefix}_model_copy.txt"; rm -f "$copy_out"
  [ "$run_rc" -eq 0 ] || return 1
  run_as_retry shell "${prefix}_model_copy.txt" "$stat_out_file" 60 "stat -c %s files/models/$MODEL_DIR/$MODEL_FILE"
  run_rc=$?; stat_out=$(cat "$stat_out_file"); cat "$stat_out_file" >> "${prefix}_model_copy.txt"; rm -f "$stat_out_file"
  [ "$run_rc" -eq 0 ] || return 1
  size=$(printf '%s' "$stat_out" | tr -d '[:space:]')
  [ "$size" = "$MODEL_SIZE" ]
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

count_after() { awk -v a="$ANCHOR_EPOCH" -v m="$1" '$1+0>=a&&index($0,m)>0{n++}END{print n+0}' "$2"; }
count_lmkd_after() { awk -v a="$ANCHOR_EPOCH" -v p="$APP_PID" '$1+0>=a&&$0~/(lmkd|am_kill|lowmemorykiller)/&&(index($0,"com.kalsa.app")>0||(p!=""&&index($0,p)>0)){n++}END{print n+0}' "$1"; }
last_json_after() { awk -v a="$ANCHOR_EPOCH" -v m="$1" '$1+0>=a&&index($0,m)>0{x=$0}END{sub(".*"m,"",x);sub(/^[[:space:]]+/,"",x);print x}' "$2"; }
last_kvprefix_after() { awk -v a="$SEND_ANCHOR_EPOCH" '$1+0>=a&&/KALSA_KVPREFIX embd=[0-9]+ text_tokens=[0-9]+ n_common=[0-9]+/{x=$0}END{print x}' "$1"; }
last_reuse_after() { awk -v a="$SEND_ANCHOR_EPOCH" '$1+0>=a&&/reusing [0-9]+\/[0-9]+/{x=$0}END{print x}' "$1"; }
extract_probs_after() {
  local file="$1"
  local out="$2"
  local anchor="${SEND_ANCHOR_EPOCH:-0}"
  : > "$out"
  case "$anchor" in ''|*[!0-9]*) return 0;; esac
  [ "$anchor" -gt 0 ] || return 0
  awk -v a="$anchor" '($1+0)>=a&&index($0,"KALSA_BENCH_PROBS ")>0{line=$0;sub(/^.*KALSA_BENCH_PROBS[[:space:]]+/,"",line);print line}' "$file" |
    sed $'s/\033\\[[0-9;]*[[:alpha:]]//g;s/\r$//' > "$out"
}
oracle_logit_eval() {
  local a_file="$1"
  local b_file="$2"
  local mode="$3"
  local result
  result=$(python3 "${ORACLE_HELPER:-}" "$a_file" "$b_file" "$mode" 0.03 0.02 0.10 2>/dev/null) || result='oracle=DESCRIPTIVE rule=R4 steps=0 max_dlogp=0.0000 max_dp1=0.0000 divergences=0 first_div=-1'
  printf '%s\n' "$result"
}
json_field() { local json="$1"; local key="$2"; [ -n "$json" ] || return 0; printf '%s' "$json" | /usr/bin/perl -MJSON::PP -e '$k=shift;$t=do{local $/;<STDIN>};eval{$v=decode_json($t)->{$k};print defined($v)?$v:""}' "$key"; }
parse_tokens() { local json="$1"; local out="$2"; printf '%s' "$json" | /usr/bin/perl -MJSON::PP -e '$o=decode_json(do{local $/;<STDIN>});die unless ref($o->{ids}) eq "ARRAY"&&defined($o->{n})&&$o->{n}>=32&&@{$o->{ids}}>=32;for $i(0..31){$v=$o->{ids}[$i];die unless defined($v)&&"$v"=~/^-?[0-9]+$/;print "$v\n"}' > "$out" 2>/dev/null; }
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
  LOGCAT_RC=1; LOGCAT_RETRIES=0
  for attempt in 1 2 3; do
    : > "$tmp"
    adbT "$timeout_s" -s "$SER" logcat -v epoch -d -b all > "$tmp" 2>&1
    rc=$?; tmp_epoch=$(last_epoch "$tmp"); complete=0; complete_logcat "$tmp" && complete=1
    LOGCAT_RC="$rc"; LOGCAT_RETRIES="$attempt"
    if [ "$rc" -eq 0 ] && [ "$complete" -eq 1 ] && awk -v newer="$tmp_epoch" -v older="$existing_epoch" 'BEGIN { exit !(newer + 0 >= older + 0) }' >/dev/null 2>&1 && mv "$tmp" "$file"; then return 0; fi
    printf 'logcat_attempt=%s rc=%s tmp_epoch=%s existing_epoch=%s complete=%s\n' "$attempt" "$rc" "$tmp_epoch" "$existing_epoch" "$complete" >> "${file}.failures"
    rm -f "$tmp"
    [ "$attempt" -lt 3 ] && sleep 3
  done
  return 1
}
telemetry_complete() {
  local file="$1"
  local j
  local n
  j=$(last_json_after KALSA_TELEMETRY "$file")
  n=$(json_field "$j" tokensPredicted)
  awk -v n="$n" 'BEGIN{exit !(n ~ /^[0-9]+([.][0-9]+)?$/&&n>=1)}' >/dev/null 2>&1
}
lmkd_all_after() { local file="$1"; local out="$2"; awk -v a="$ANCHOR_EPOCH" '($1+0)>=a&&tolower($0)~/lmkd|lowmemorykiller/&&tolower($0)~/kill/{print}' "$file" > "$out"; }
thermal_record() {
  local name="$1"
  local file="$RAW/${name}_thermal.txt"
  local gate="${file%.txt}_gate.txt"
  local attempt rc skin max_temp thermal_status skin_valid
  rc=1; skin=""; skin_valid=0
  for attempt in 1 2 3; do
    adbT 90 -s "$SER" shell dumpsys thermalservice > "$file" 2>&1
    rc=$?
    awk '/Current temperatures from HAL/{f=1} f{print} /Current cooling devices from HAL/{f=0}' "$file" > "$gate"
    grep 'Thermal Status:' "$file" | head -1 >> "$gate"
    skin=$(sed -n 's/.*mValue=\([0-9][0-9.]*\), mType=3, mName=skin.*/\1/p' "$gate" | head -1 | tr -d '\r')
    skin_valid=0
    awk -v v="$skin" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/) }' >/dev/null 2>&1 && skin_valid=1
    [ "$rc" -eq 0 ] && [ "$skin_valid" -eq 1 ] && break
    [ "$attempt" -lt 3 ] && sleep 2
  done
  max_temp=$(grep -o 'mValue=[0-9.]*' "$gate" | cut -d= -f2 | sort -n | tail -1)
  thermal_status=$(grep 'Thermal Status:' "$file" | head -1 | grep -o '[0-9]*' | head -1)
  printf 'max_hal_temp=%s status=%s attempts=%s rc=%s\n' "$max_temp" "$thermal_status" "$attempt" "$rc" >> "$gate"
  if [ "$rc" -ne 0 ] || [ "$skin_valid" -ne 1 ]; then
    printf 'void_reason=thermal\n' >> "$gate"
    return 1
  fi
  printf '%s' "$skin"
}
cooldown_to_target() {
  local prefix="$1"
  local sample_file="${prefix}_cooldown.txt"
  local sample skin rc elapsed
  : > "$sample_file"
  elapsed=0; COOLDOWN_SECONDS=na
  while [ "$elapsed" -le "$COOL_MAX_S" ]; do
    deadline_check
    sample=$(thermal_record "$(basename "$prefix")_cooldown")
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
  return 2
}
cool_target_for_arm() {
  case "$1" in
    A) printf '38.5\n' ;;
    B) printf '37.0\n' ;;
    *) return 1 ;;
  esac
}
dump_ui() {
  local out="$1"
  local dump_log="${out}.dump.log"
  local attempt rc rm_rc cat_rc power_file power_rc wake_rc wake_status
  DUMP_UI_TRANSPORT=0
  : > "$dump_log"
  : > "$out"
  for attempt in 1 2 3 4 5; do
    power_file="${out}.power_attempt${attempt}.txt"
    POWER_CHECK_CONTEXT=dump
    power_capture "$power_file"
    power_rc=$?
    POWER_CHECK_CONTEXT=""
    wake_status=$(wake_state "$power_file")
    cat "$power_file" >> "$dump_log"
    cat "${power_file}.log" >> "$dump_log"
    printf 'attempt=%s power_rc=%s wake=%s\n' "$attempt" "$power_rc" "${wake_status:-missing}" >> "$dump_log"
    if [ "$power_rc" -ne 0 ]; then
      [ "${POWER_CAPTURE_TRANSPORT:-0}" -eq 1 ] && DUMP_UI_TRANSPORT=1
      [ "$attempt" -lt 5 ] && sleep 3
      continue
    fi
    if [ "${wake_status:-missing}" != Awake ]; then
      printf 'attempt=%s wake_action=sequence\n' "$attempt" >> "$dump_log"
      wake_sequence "$dump_log"
      wake_rc=$?
      [ "${WAKE_SEQUENCE_TRANSPORT:-0}" -eq 1 ] && DUMP_UI_TRANSPORT=1
      if [ "$wake_rc" -ne 0 ]; then
        [ "$attempt" -lt 5 ] && sleep 3
        continue
      fi
    fi
    adbT 60 -s "$SER" shell "rm -f $DEVICE_TMP/ui.xml" >> "$dump_log" 2>&1
    rm_rc=$?
    adbT 60 -s "$SER" shell "uiautomator dump $DEVICE_TMP/ui.xml" >> "$dump_log" 2>&1
    rc=$?
    case "$rm_rc:$rc" in *:124|*:255|124:*|255:*) DUMP_UI_TRANSPORT=1 ;; esac
    printf 'attempt=%s rm_rc=%s rc=%s\n' "$attempt" "$rm_rc" "$rc" >> "$dump_log"
    if [ "$rm_rc" -eq 0 ] && [ "$rc" -eq 0 ]; then
      adbT 60 -s "$SER" shell "cat $DEVICE_TMP/ui.xml" > "$out" 2>> "$dump_log"
      cat_rc=$?
      case "$cat_rc" in 124|255) DUMP_UI_TRANSPORT=1 ;; esac
      printf 'attempt=%s cat_rc=%s\n' "$attempt" "$cat_rc" >> "$dump_log"
      if [ "$cat_rc" -eq 0 ] && [ -s "$out" ]; then
        tr -d '\r' < "$out" > "$out.tmp" && mv "$out.tmp" "$out"
        if [ -s "$out" ]; then
          if ! grep -q 'package="com.kalsa.app"' "$out"; then
            printf 'attempt=%s aod\n' "$attempt" >> "$dump_log"
            wake_sequence "$dump_log"
            wake_rc=$?
            [ "${WAKE_SEQUENCE_TRANSPORT:-0}" -eq 1 ] && DUMP_UI_TRANSPORT=1
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
bounds_send() { tr '>' '\n' < "$1" | grep -E 'content-desc="Send"|text="Send"' | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1; }
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
  local text hint actual hint_len
  local empty_text_len
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
  local actual expected minimum metrics hint_len empty_text_len
  expected="$PROMPT_EXPECTED_CHARS"
  metrics=$(composer_text_len "$file")
  actual=${metrics%% *}
  metrics=${metrics#* }
  hint_len=${metrics%% *}
  empty_text_len=${metrics##* }
  [ -n "$actual" ] || actual=0
  [ -n "$hint_len" ] || hint_len=0
  [ -n "$empty_text_len" ] || empty_text_len=0
  minimum=$((expected * 90 / 100))
  printf 'attempt=%s actual=%s expected=%s minimum=%s hint_len=%s empty_text_len=%s\n' "$attempt" "$actual" "$expected" "$minimum" "$hint_len" "$empty_text_len" >> "${prefix}_composer_len.txt"
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
  TYPE_VERIFY_ATTEMPT="$attempt"
  TYPE_VERIFY_CHUNK="$chunk_no"
  TYPE_VERIFY_EXPECTED_LEN="$expected_len"
  TYPE_VERIFY_ACTIVE=1
  dump_ui "$file"
  dump_rc=$?
  TYPE_VERIFY_ACTIVE=0
  actual=$(composer_text_attr "$file" text)
  expected="${PROMPT_TEXT:0:expected_len}"
  actual_len=$(printf '%s' "$actual" | wc -m | tr -d '[:space:]')
  if [ "$dump_rc" -eq 0 ] && [ "$actual" = "$expected" ]; then
    result=exact
  elif [ "$actual_len" -lt "$expected_len" ] && [ "${PROMPT_TEXT:0:actual_len}" = "$actual" ]; then
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
  chunk="${PROMPT_TEXT:$offset:$chunk_size}"
  [ -n "$chunk" ] || return 1
  typing_awake "$prefix" "$chunk_no" || return 2
  encoded=$(printf '%s' "$chunk" | sed 's/ /%s/g')
  escaped=$(printf '%s' "$encoded" | sed "s/'/'\\\\''/g")
  adbT 300 -s "$SER" shell "input text '$escaped'"
  rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
}

clear_for_retry() {
  clear_composer || return 1
  sleep 2
}

typing_awake() {
  local prefix="$1"
  local chunk="$2"
  local before_file="${prefix}_typing_wake_${chunk}_before.txt"
  local after_file="${prefix}_typing_wake_${chunk}_after.txt"
  local before after wake_rc
  power_capture "$before_file" || return 1
  if grep -q 'mWakefulness=Awake' "$before_file"; then
    before=Awake
    after=Awake
  else
    before=$(wake_state "$before_file")
    printf 'typing_chunk=%s wake_before=%s action=wake\n' "$chunk" "${before:-missing}" >> "${prefix}_ui_attempts.txt"
    wake_sequence "${prefix}_typing_wake.log"
    wake_rc=$?
    [ "$wake_rc" -eq 0 ] || return 1
    power_capture "$after_file" || return 1
    after=$(wake_state "$after_file")
  fi
  printf 'typing_chunk=%s wake_before=%s wake_after=%s\n' "$chunk" "${before:-missing}" "${after:-missing}" >> "${prefix}_ui_attempts.txt"
  [ "${after:-missing}" = Awake ]
}

chunk_sum() {
  local chunks="$1"
  printf '%s\n' "$chunks" | awk -F+ '{total=0; for (i=1; i<=NF; i++) {part=$i; sub(/^[^0-9]*/, "", part); if (part !~ /^[0-9]+$/) exit 1; total+=part} print total}'
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
  TYPE_LADDER=${TYPE_LADDER:-"200 100"}
  [ -n "$PROMPT_TEXT" ] || return 1
  text_len=${#PROMPT_TEXT}
  first_rung=1
  # TYPE_LADDER is a launch parameter, not adaptive state: on a board where the
  # 200-char rung is known to lose characters (QRD8650 with the APKs from
  # 19b67b6 on: 3/3 turns, ~300 s burned each) the run is started with
  # TYPE_LADDER=100. The typed text is verified identical either way.
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
      chunk="${PROMPT_TEXT:$offset:$chunk_size}"
      expected_len=$((offset + ${#chunk}))
      send_prompt_chunk "$prefix" "$chunk_no" "$offset" "$chunk_size"
      rc=$?
      if [ "$rc" -ne 0 ]; then
        now=$(date +%s); elapsed=$((now - attempt_start))
        printf 'attempt=%s chunk_size=%s seconds=%s rc=%s\n' "$attempt" "$chunk_size" "$elapsed" "$rc" >> "${prefix}_type_prompt.txt"
        return 2
      fi
      verify_typed_chunk "$prefix" "$attempt" "$chunk_no" "$expected_len" "$attempt_start"
      rc=$?
      result="$TYPE_VERIFY_RESULT"
      first_loss_expected="${PROMPT_TEXT:1:TYPE_VERIFY_LEN}"
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
      TYPE_COUNTS="${TYPE_COUNTS}${chunks},"
      return 0
    fi
    first_rung=0
  done
  return 2
}

ui_send() {
  local prefix="$1"
  local turn="$2"
  local attempts_file="${prefix}_ui_attempts.txt"
  local edit_file="${prefix}_edit.xml"
  local send_file="${prefix}_send.xml"
  local retry_file="${prefix}_composer_retry.xml"
  local cleared_file="${prefix}_composer_cleared.xml"
  local attempt edit_bounds send_bounds previous_send awake_rc send_anchor
  local edit_dump_rc send_dump_rc send_dump_transport
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
  DUMP_UI_TRANSPORT=0
  dump_ui "$edit_file"
  edit_dump_rc=$?
  edit_bounds=""
  [ "$edit_dump_rc" -eq 0 ] && [ -s "$edit_file" ] && edit_bounds=$(bounds_edit "$edit_file") || edit_bounds=""
  if [ -z "$edit_bounds" ]; then
    printf 'dump_fail stage=edit rc=%s transport=%s\n' "$edit_dump_rc" "${DUMP_UI_TRANSPORT:-0}" >> "$attempts_file"
    [ "${DUMP_UI_TRANSPORT:-0}" -eq 1 ] && return 1
    void_reason=composer
    return 2
  fi
  LAST_EDIT_BOUNDS="$edit_bounds"
  EMPTY_TEXT=$(composer_text_attr "$edit_file" text)
  tap_bounds "$edit_bounds" || return 1
  type_start=$(date +%s)
  type_prompt "$prefix"
  type_rc=$?
  type_end=$(date +%s)
  type_elapsed=$((type_end - type_start))
  typing_total=$type_elapsed
  printf 'initial_seconds=%s rc=%s total_seconds=%s\n' "$type_elapsed" "$type_rc" "$typing_total" >> "${prefix}_type_prompt.txt"
  [ "$type_rc" -ne 2 ] || { void_reason=composer; return 2; }

  DUMP_UI_TRANSPORT=0
  dump_ui "$send_file"
  send_dump_rc=$?
  send_dump_transport="${DUMP_UI_TRANSPORT:-0}"
  if [ "$send_dump_rc" -ne 0 ]; then
    printf 'dump_fail stage=send attempt=0 rc=%s transport=%s\n' "$send_dump_rc" "$send_dump_transport" >> "$attempts_file"
    [ "$send_dump_transport" -eq 1 ] && return 1
    void_reason=composer
    return 2
  fi
  composer_ok=1
  if [ "$type_rc" -ne 0 ] || ! [ -s "$send_file" ] || ! composer_check "$prefix" "$send_file" initial; then
    composer_ok=0
  fi
  if [ "$composer_ok" -eq 0 ]; then
    clear_composer || { void_reason=composer; return 2; }
    dump_ui "$cleared_file" || { void_reason=composer; return 2; }
    metrics=$(composer_text_len "$cleared_file")
    cleared_len=${metrics%% *}
    metrics=${metrics#* }
    hint_len=${metrics%% *}
    empty_text_len=${metrics##* }
    [ -n "$cleared_len" ] || cleared_len=0
    [ -n "$hint_len" ] || hint_len=0
    [ -n "$empty_text_len" ] || empty_text_len=0
    printf 'attempt=cleared actual=%s expected=%s minimum=0 hint_len=%s empty_text_len=%s\n' "$cleared_len" "$PROMPT_EXPECTED_CHARS" "$hint_len" "$empty_text_len" >> "${prefix}_composer_len.txt"
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
    composer_check "$prefix" "$retry_file" retype || { void_reason=composer; return 2; }
    send_file="$retry_file"
  fi

  send_bounds=""
  [ "$send_dump_rc" -eq 0 ] && [ -s "$send_file" ] && send_bounds=$(bounds_send "$send_file") || send_bounds=""
  [ -n "$send_bounds" ] || printf 'dump_fail stage=send attempt=0 rc=%s transport=%s\n' "$send_dump_rc" "$send_dump_transport" >> "$attempts_file"
  for attempt in 1 2 3; do
    if [ "$attempt" -gt 1 ]; then
      sleep 3
      ensure_awake "${prefix}_ui_attempt${attempt}" || true
      if [ -z "$previous_send" ]; then
        adbT 60 -s "$SER" shell input keyevent 4 > "${prefix}_ime_dismiss_${attempt}.txt" 2>&1 || true
      fi
      send_file="${prefix}_send_attempt${attempt}.xml"
      DUMP_UI_TRANSPORT=0
      dump_ui "$send_file"
      send_dump_rc=$?
      [ "${DUMP_UI_TRANSPORT:-0}" -eq 1 ] && send_dump_transport=1
      send_bounds=""
      [ "$send_dump_rc" -eq 0 ] && [ -s "$send_file" ] && send_bounds=$(bounds_send "$send_file") || send_bounds=""
      [ -n "$send_bounds" ] || printf 'dump_fail stage=send attempt=%s rc=%s transport=%s\n' "$attempt" "$send_dump_rc" "${DUMP_UI_TRANSPORT:-0}" >> "$attempts_file"
    fi
    printf 'attempt=%s edit_bounds=%s send_bounds=%s\n' "$attempt" "${edit_bounds:-na}" "${send_bounds:-na}" >> "$attempts_file"
    awake_rc=0
    ensure_awake "${prefix}_ui_send${attempt}" || awake_rc=$?
    if [ "$awake_rc" -eq 0 ] && [ -n "$send_bounds" ]; then
      adbT 60 -s "$SER" shell "date +%s" > "${prefix}_send_anchor_epoch.txt" 2>&1
      send_anchor=$(cat "${prefix}_send_anchor_epoch.txt" | tr -d '\r[:space:]')
      if awk -v a="$send_anchor" 'BEGIN{exit !(a ~ /^[0-9]+$/)}' >/dev/null 2>&1; then
        SEND_ANCHOR_EPOCH="$send_anchor"
        tap_bounds "$send_bounds" && return 0
      fi
    fi
    previous_send="$send_bounds"
  done
  [ "$send_dump_transport" -eq 1 ] && return 1
  void_reason=composer
  return 2
}
