#!/bin/bash

count_after() { awk -v a="$ANCHOR_EPOCH" -v m="$1" '$1+0>=a&&index($0,m)>0{n++}END{print n+0}' "$2"; }
count_lmkd_after() { awk -v a="$ANCHOR_EPOCH" -v p="$APP_PID" '$1+0>=a&&$0~/(lmkd|am_kill|lowmemorykiller)/&&(index($0,"com.kalsa.app")>0||(p!=""&&index($0,p)>0)){n++}END{print n+0}' "$1"; }
last_json_after() { awk -v a="$ANCHOR_EPOCH" -v m="$1" '$1+0>=a&&index($0,m)>0{x=$0}END{sub(".*"m,"",x);sub(/^[[:space:]]+/,"",x);print x}' "$2"; }
last_reuse_after() { awk -v a="$SEND_ANCHOR_EPOCH" '$1+0>=a&&/reusing [0-9]+\/[0-9]+/{x=$0}END{print x}' "$1"; }
json_field() { local json="$1"; local key="$2"; [ -n "$json" ] || return 0; printf '%s' "$json" | /usr/bin/perl -MJSON::PP -e '$k=shift;$t=do{local $/;<STDIN>};eval{$v=decode_json($t)->{$k};print defined($v)?$v:""}' "$key"; }
parse_tokens() { local json="$1"; local out="$2"; printf '%s' "$json" | /usr/bin/perl -MJSON::PP -e '$o=decode_json(do{local $/;<STDIN>});die unless ref($o->{ids}) eq "ARRAY"&&defined($o->{n})&&$o->{n}>=32&&@{$o->{ids}}>=32;for $i(0..31){$v=$o->{ids}[$i];die unless defined($v)&&"$v"=~/^-?[0-9]+$/;print "$v\n"}' > "$out" 2>/dev/null; }
telemetry_complete() {
  local file="$1"
  local j
  local n
  j=$(last_json_after KALSA_TELEMETRY "$file")
  n=$(json_field "$j" tokensPredicted)
  awk -v n="$n" 'BEGIN{exit !(n ~ /^[0-9]+([.][0-9]+)?$/&&n>=1)}' >/dev/null 2>&1
}
lmkd_all_after() { local file="$1"; local out="$2"; awk -v a="$ANCHOR_EPOCH" '($1+0)>=a&&tolower($0)~/lmkd|lowmemorykiller/&&tolower($0)~/kill/{print}' "$file" > "$out"; }
dump_ui() {
  local out="$1"
  adbT 60 -s "$SER" shell "uiautomator dump $DEVICE_TMP/ui.xml >/dev/null 2>&1" || return 1
  adbT 60 -s "$SER" shell "cat $DEVICE_TMP/ui.xml" > "$out" 2>&1 || return 1
  tr -d '\r' < "$out" > "$out.tmp" && mv "$out.tmp" "$out"
  [ -s "$out" ]
}
bounds_edit() { tr '>' '\n' < "$1" | grep 'class="android.widget.EditText"' | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1; }
bounds_send() { tr '>' '\n' < "$1" | grep -E 'content-desc="Send"|text="Send"' | sed -n 's/.*bounds="\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]\[\([0-9][0-9]*\),\([0-9][0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1; }
tap_bounds() {
  local b="$1"
  local x1 y1 x2 y2
  read -r x1 y1 x2 y2 <<< "$b"
  adbT 60 -s "$SER" shell input tap "$(((x1 + x2) / 2))" "$(((y1 + y2) / 2))"
}

composer_text_len() {
  local file="$1"
  local text
  text=""
  if [ -s "$file" ]; then
    text=$(tr '>' '\n' < "$file" | grep 'class="android.widget.EditText"' | sed -n 's/.*text="\([^"]*\)".*/\1/p' | head -1)
  fi
  printf '%s' "$text" | wc -m | tr -d '[:space:]'
}

composer_check() {
  local prefix="$1"
  local file="$2"
  local attempt="$3"
  local actual expected minimum
  expected="$PROMPT_EXPECTED_CHARS"
  actual=$(composer_text_len "$file")
  [ -n "$actual" ] || actual=0
  minimum=$((expected * 90 / 100))
  printf 'attempt=%s actual=%s expected=%s minimum=%s\n' "$attempt" "$actual" "$expected" "$minimum" >> "${prefix}_composer_len.txt"
  [ "$actual" -ge "$minimum" ]
}

clear_composer() {
  adbT 60 -s "$SER" shell input keycombination KEYCODE_CTRL_LEFT KEYCODE_A || return 1
  adbT 60 -s "$SER" shell input keyevent KEYCODE_DEL
}

chunk_sum() {
  local chunks="$1"
  printf '%s\n' "$chunks" | awk -F+ '{total=0; for (i=1; i<=NF; i++) {part=$i; sub(/^[^0-9]*/, "", part); if (part !~ /^[0-9]+$/) exit 1; total+=part} print total}'
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
  local type_start type_end type_rc type_elapsed typing_total
  local composer_ok cleared_len
  : > "$attempts_file"
  : > "${prefix}_composer_len.txt"
  : > "${prefix}_type_prompt.txt"
  previous_send=""
  typing_total=0

  dump_ui "$edit_file" || true
  edit_bounds=""
  [ -s "$edit_file" ] && edit_bounds=$(bounds_edit "$edit_file") || edit_bounds=""
  [ -n "$edit_bounds" ] || return 1
  tap_bounds "$edit_bounds" || return 1
  type_start=$(date +%s)
  type_prompt
  type_rc=$?
  type_end=$(date +%s)
  type_elapsed=$((type_end - type_start))
  typing_total=$type_elapsed
  printf 'initial_seconds=%s rc=%s total_seconds=%s\n' "$type_elapsed" "$type_rc" "$typing_total" >> "${prefix}_type_prompt.txt"
  if [ "$turn" -eq 1 ] && [ "$typing_total" -gt 150 ]; then
    return 1
  fi

  dump_ui "$send_file" || true
  composer_ok=1
  if [ "$type_rc" -ne 0 ] || ! [ -s "$send_file" ] || ! composer_check "$prefix" "$send_file" initial; then
    composer_ok=0
  fi
  if [ "$composer_ok" -eq 0 ]; then
    clear_composer || return 2
    dump_ui "$cleared_file" || return 2
    cleared_len=$(composer_text_len "$cleared_file")
    [ -n "$cleared_len" ] || cleared_len=0
    printf 'attempt=cleared actual=%s expected=%s minimum=0\n' "$cleared_len" "$PROMPT_EXPECTED_CHARS" >> "${prefix}_composer_len.txt"
    [ "$cleared_len" -le 3 ] || return 2
    type_start=$(date +%s)
    type_prompt
    type_rc=$?
    type_end=$(date +%s)
    type_elapsed=$((type_end - type_start))
    typing_total=$((typing_total + type_elapsed))
    printf 'retype_seconds=%s rc=%s total_seconds=%s\n' "$type_elapsed" "$type_rc" "$typing_total" >> "${prefix}_type_prompt.txt"
    if [ "$turn" -eq 1 ] && [ "$typing_total" -gt 150 ]; then
      return 1
    fi
    dump_ui "$retry_file" || true
    [ "$type_rc" -eq 0 ] || return 2
    composer_check "$prefix" "$retry_file" retype || return 2
    send_file="$retry_file"
  fi

  send_bounds=""
  [ -s "$send_file" ] && send_bounds=$(bounds_send "$send_file") || send_bounds=""
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
  return 1
}
