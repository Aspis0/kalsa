#!/bin/bash

ui_send() {
  local prefix="$1"
  local attempts_file="${prefix}_ui_attempts.txt"
  local edit_file send_file
  local attempt edit_bounds send_bounds previous_send awake_rc composer_rc
  local send_anchor
  : > "$attempts_file"
  previous_send=""
  for attempt in 1 2 3; do
    if [ "$attempt" -eq 1 ]; then
      edit_file="${prefix}_edit.xml"
      send_file="${prefix}_send.xml"
    else
      edit_file="${prefix}_edit_attempt${attempt}.xml"
      send_file="${prefix}_send_attempt${attempt}.xml"
    fi
    if [ "$attempt" -gt 1 ]; then
      sleep 3
      ensure_awake "${prefix}_ui_attempt${attempt}" || true
      if [ -z "$previous_send" ]; then
        adbT 60 -s "$SER" shell input keyevent 4 > "${prefix}_ime_dismiss_${attempt}.txt" 2>&1 || true
      fi
    fi
    edit_bounds=""
    send_bounds=""
    composer_rc=1
    dump_ui "$edit_file" || true
    [ -s "$edit_file" ] && edit_bounds=$(bounds_edit "$edit_file") || edit_bounds=""
    if [ -n "$edit_bounds" ]; then
      tap_bounds "$edit_bounds" && type_prompt && composer_rc=0 || true
    fi
    awake_rc=0
    ensure_awake "${prefix}_ui_send${attempt}" || awake_rc=$?
    dump_ui "$send_file" || true
    [ -s "$send_file" ] && send_bounds=$(bounds_send "$send_file") || send_bounds=""
    printf 'attempt=%s edit_bounds=%s send_bounds=%s\n' "$attempt" "${edit_bounds:-na}" "${send_bounds:-na}" >> "$attempts_file"
    if [ "$awake_rc" -eq 0 ] && [ "$composer_rc" -eq 0 ] && [ -n "$send_bounds" ]; then
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
