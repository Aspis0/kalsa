#!/usr/bin/env python3
"""Build start_f5_4_resume.sh from start_f5_4.sh with resume-safe patches."""
from pathlib import Path

src = Path("scripts/start_f5_4.sh").read_text(encoding="utf-8")

src = src.replace(
"""# start_f5_4.sh — F5.4 IN CARICA, METRICA INVARIANTE
# ORDER: C (cache curve) → D1 (ubatch output equiv) → B (Q4_0 vs K) → D2 (ubatch sweep)
# All rows tagged "F5.4 IN-CARICA". work = compute_s_tok * cur_freq_prime.
# Battery floor DISABLED while PLUGGED_AC (this mandate is charging by design).
# STOP only on die > 98C.""",
"""# start_f5_4_resume.sh — F5.4 RESUME IN CARICA (after crash mid C@2500)
# ORDER remaining: C (2500/3000/3500) → D1 → B → D2
# Skips cells that already have .done. APPENDS master/CSV (no wipe).
# OOM at high cache IS a result (continue). STOP only on die > 98C.
# Stronger detach: nohup setsid + stdin closed; survives ssh drop.""")

src = src.replace('C_CACHES="2000 2500 3000 3500"', 'C_CACHES="2500 3000 3500"')

src = src.replace(
"""if [ "${1:-}" = "--detach" ]; then
  shift
  nohup setsid bash "$0" --run "$@" >"$OUTDIR/nohup_launch.log" 2>&1 &
  echo $! > "$OUTDIR/launcher.pid"
  echo "LAUNCHED pid=$(cat "$OUTDIR/launcher.pid") log=$OUTDIR/nohup_launch.log"
  exit 0
fi""",
"""if [ "${1:-}" = "--detach" ]; then
  shift
  # Strong detach: setsid + nohup + stdin from /dev/null; log append
  cd "$HOME" || true
  nohup setsid bash "$0" --run "$@" < /dev/null >>"$OUTDIR/nohup_launch.log" 2>&1 &
  echo $! > "$OUTDIR/launcher.pid"
  disown 2>/dev/null || true
  sleep 1
  echo "LAUNCHED pid=$(cat "$OUTDIR/launcher.pid") log=$OUTDIR/nohup_launch.log"
  if kill -0 "$(cat "$OUTDIR/launcher.pid")" 2>/dev/null; then
    echo "DETACH_OK pid=$(cat "$OUTDIR/launcher.pid")"
  else
    echo "DETACH_FAIL"; exit 1
  fi
  exit 0
fi""")

src = src.replace(
"""if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f5_4.sh --detach"
  exit 2
fi""",
"""if [ "${1:-}" != "--run" ]; then
  echo "Uso: start_f5_4_resume.sh --detach"
  exit 2
fi""")

old_init = '''echo $$ > "$PIDFILE"
: > "$MASTER"
: > "$SAFETY_LOG"
echo "RUNNING $(ts)" > "$STATUS"
echo "cell,tag,phase,mark,wall_start,wall_end,elapsed_s,n_prompt,n_past,tokens,tok_s,prefill_s,prefill_tps,cache_hit_pct,compute_s_tok,io_s_tok,stall_s_tok,read_mib,mib_tok,rss_peak_kb,die_start_c,die_end_c,die_max_c,batt_start,batt_end,cur_freq0_avg,cur_freq3_avg,cur_freq5_avg,cur_freq7_avg,cur_freq_prime_avg,work,sched_reserve_mib,extra,stopped_reason,notes" > "$CSV_ALL"

log "=== F5.4 START pid=$$ MARK='$MARK' ==="'''

new_init = '''echo $$ > "$PIDFILE"
# RESUME: do NOT wipe MASTER/CSV/safety — append only
if [ ! -f "$CSV_ALL" ] || [ ! -s "$CSV_ALL" ]; then
  echo "cell,tag,phase,mark,wall_start,wall_end,elapsed_s,n_prompt,n_past,tokens,tok_s,prefill_s,prefill_tps,cache_hit_pct,compute_s_tok,io_s_tok,stall_s_tok,read_mib,mib_tok,rss_peak_kb,die_start_c,die_end_c,die_max_c,batt_start,batt_end,cur_freq0_avg,cur_freq3_avg,cur_freq5_avg,cur_freq7_avg,cur_freq_prime_avg,work,sched_reserve_mib,extra,stopped_reason,notes" > "$CSV_ALL"
fi
echo "RUNNING_RESUME $(ts)" > "$STATUS"
(
  while [ -f "$PIDFILE" ] && [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ]; do
    echo "HB $(ts) pid=$$ cell=$(cat "$STATUS" 2>/dev/null | head -1)" > "$OUTDIR/WATCH.txt"
    sleep 15
  done
) &
HB_PID=$!

log "=== F5.4 RESUME START pid=$$ MARK='$MARK' ==="'''

if old_init not in src:
    raise SystemExit("init block not found")
src = src.replace(old_init, new_init)

old_rm = '''  local meta="$odir/${cell}.meta.txt"
  rm -f "$donef"

  log "==== CELL $cell model=$(basename "$model") cache=$cache_mb ubatch=$ubatch n_ctx=$n_ctx n_pred=$n_pred extra=[$extra] ===="'''

new_rm = '''  local meta="$odir/${cell}.meta.txt"
  # RESUME skip: if .done exists and meta has tokens>0 or reason=ok, skip
  if [ -f "$donef" ] && [ -f "$meta" ]; then
    local prev_reason prev_tokens
    prev_reason=$(grep '^reason=' "$meta" 2>/dev/null | head -1 | cut -d= -f2-)
    prev_tokens=$(grep '^tokens=' "$meta" 2>/dev/null | head -1 | cut -d= -f2-)
    if [ "${prev_tokens:-0}" != "0" ] || [ "$prev_reason" = "ok" ]; then
      log "SKIP already done $cell tokens=$prev_tokens reason=$prev_reason"
      return 0
    fi
  fi
  rm -f "$donef"

  log "==== CELL $cell model=$(basename "$model") cache=$cache_mb ubatch=$ubatch n_ctx=$n_ctx n_pred=$n_pred extra=[$extra] ===="'''

if old_rm not in src:
    raise SystemExit("run_oneshot start not found")
src = src.replace(old_rm, new_rm)

old_parse = r"""  tokens=$(grep -oE 'generation: [0-9]+ tokens' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  tokens=${tokens:-0}
  tok_s=$(grep -oE '\([0-9.]+ tok/s\)' "$slog" "$serr" 2>/dev/null | head -1 | tr -dc '0-9.')
  tok_s=${tok_s:-0}
  compute_s_tok=$(grep -oE 'compute [0-9.]+ \+ cache' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  compute_s_tok=${compute_s_tok:-0}
  io_s_tok=$(grep -oE 'flash I/O [0-9.]+ s/token' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $3}')
  io_s_tok=${io_s_tok:-0}
  stall_s_tok=$(grep -oE 'stall [0-9.]+ s/token' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  stall_s_tok=${stall_s_tok:-0}
  read_mib=$(grep -oE 'read [0-9.]+ MiB' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}')
  read_mib=${read_mib:-0}
  mib_tok=$(grep -oE '\([0-9.]+ MiB/token\)' "$slog" "$serr" 2>/dev/null | head -1 | tr -dc '0-9.')
  mib_tok=${mib_tok:-0}
  cache_hit=$(grep -oE 'moe-cache: [0-9.]+% hit' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '%')
  cache_hit=${cache_hit:--1}
  if [ "$tok_s" = "0" ] || [ -z "$tok_s" ]; then
    tok_s=$(grep -oE '[0-9.]+ tok/s' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $1}')
    tok_s=${tok_s:-0}
  fi
  prefill_s=$(grep -oE 'prompt eval time =[[:space:]]*[0-9.]+' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $NF}')
  prefill_s=${prefill_s:-0}
  prefill_s=$(awk -v p="$prefill_s" 'BEGIN{ if(p>1000) printf "%.3f", p/1000; else printf "%.3f", p+0 }')
  prefill_tps=$(grep -oE '[0-9.]+ tokens per second' "$slog" "$serr" 2>/dev/null | head -1 | awk '{print $1}')
  prefill_tps=${prefill_tps:-0}"""

new_parse = r"""  # Prefer stdout/stderr blob; avoid multi-file grep (filename: prefix corrupts numbers)
  local _blob
  _blob=$(cat "$slog" 2>/dev/null; echo; cat "$serr" 2>/dev/null)
  tokens=$(printf '%s' "$_blob" | grep -oE 'generation: [0-9]+ tokens' | head -1 | awk '{print $2}')
  tokens=${tokens:-0}
  tok_s=$(printf '%s' "$_blob" | grep -oE '\([0-9.]+ tok/s\)' | head -1 | tr -dc '0-9.')
  tok_s=${tok_s:-0}
  compute_s_tok=$(printf '%s' "$_blob" | grep -oE 'compute [0-9.]+ \+ cache' | head -1 | awk '{print $2}')
  compute_s_tok=${compute_s_tok:-0}
  io_s_tok=$(printf '%s' "$_blob" | grep -oE 'flash I/O [0-9.]+ s/token' | head -1 | awk '{print $3}')
  io_s_tok=${io_s_tok:-0}
  stall_s_tok=$(printf '%s' "$_blob" | grep -oE 'stall [0-9.]+ s/token' | head -1 | awk '{print $2}')
  stall_s_tok=${stall_s_tok:-0}
  read_mib=$(printf '%s' "$_blob" | grep -oE 'read [0-9.]+ MiB' | head -1 | awk '{print $2}')
  read_mib=${read_mib:-0}
  mib_tok=$(printf '%s' "$_blob" | grep -oE '\([0-9.]+ MiB/token\)' | head -1 | tr -dc '0-9.')
  mib_tok=${mib_tok:-0}
  cache_hit=$(printf '%s' "$_blob" | grep -oE 'moe-cache: [0-9.]+% hit' | head -1 | awk '{print $2}' | tr -d '%')
  cache_hit=${cache_hit:--1}
  if [ "$tok_s" = "0" ] || [ -z "$tok_s" ]; then
    tok_s=$(printf '%s' "$_blob" | grep -oE '[0-9.]+ tok/s' | head -1 | awk '{print $1}')
    tok_s=${tok_s:-0}
  fi
  prefill_s=$(printf '%s' "$_blob" | grep -oE 'prompt eval time =[[:space:]]*[0-9.]+' | head -1 | awk '{print $NF}')
  prefill_s=${prefill_s:-0}
  prefill_s=$(awk -v p="$prefill_s" 'BEGIN{ if(p>1000) printf "%.3f", p/1000; else printf "%.3f", p+0 }')
  prefill_tps=$(printf '%s' "$_blob" | grep -oE '[0-9.]+ tokens per second' | head -1 | awk '{print $1}')
  prefill_tps=${prefill_tps:-0}
  if [ "$prefill_tps" = "0" ] || [ -z "$prefill_tps" ]; then
    prefill_tps=$(printf '%s' "$_blob" | grep -oE 'prefill:.*\([0-9.]+ tok/s\)' | head -1 | grep -oE '[0-9.]+ tok/s' | head -1 | awk '{print $1}')
    prefill_tps=${prefill_tps:-0}
  fi"""

if old_parse not in src:
    raise SystemExit("parse block not found")
src = src.replace(old_parse, new_parse)

old_c = '''run_phase_c() {
  log "==== PHASE C start cache sweep ${C_CACHES} ubatch=$C_UBATCH ===="
  echo "PHASE_C $(ts)" > "$STATUS"
  local pfile="$OUTDIR/prompts/long_it.txt"
  local c rep cell
  for c in $C_CACHES; do
    for rep in $(seq 1 "$C_N_REP"); do
      saf=$(safety_check) || { log "STOP C mid: $saf"; echo "STOPPED C $saf $(ts)" > "$STATUS"; return 1; }
      cell="F5.4-C-cache${c}-r${rep}"
      run_oneshot "$cell" "$MODEL35" "c" "" "$C_N_CTX" "$C_N_PRED" "$pfile" 1 "$c" "$C_UBATCH" "F5.4-C" || return 1
      wait_cool 55 90
    done
  done
  log "PHASE C done"
  echo "PHASE_C_DONE $(ts)" > "$OUTDIR/c/STATUS.txt"
  return 0
}'''

new_c = '''run_phase_c() {
  log "==== PHASE C RESUME cache sweep ${C_CACHES} ubatch=$C_UBATCH (skip done; OOM=result) ===="
  echo "PHASE_C $(ts)" > "$STATUS"
  local pfile="$OUTDIR/prompts/long_it.txt"
  local c rep cell last_ok_cache=2000
  if [ -f "$OUTDIR/c/F5.4-C-cache2000-r1.done" ]; then last_ok_cache=2000; fi
  for c in $C_CACHES; do
    # 3500 only if 3000 survived at least one rep with tokens>0
    if [ "$c" = "3500" ] && [ "$last_ok_cache" -lt 3000 ]; then
      log "SKIP cache 3500: last surviving cache=$last_ok_cache (<3000)"
      for rep in $(seq 1 "$C_N_REP"); do
        cell="F5.4-C-cache${c}-r${rep}"
        {
          echo "cell=$cell"
          echo "reason=SKIP_NO_HEADROOM last_ok=$last_ok_cache"
          echo "mark=$MARK"
          echo "tokens=0"
        } > "$OUTDIR/c/${cell}.meta.txt"
        echo "$cell,F5.4-C,c,$MARK,$(ts),$(ts),0,,,,,,,,,,,,,,,,,,,,,,,,,,SKIP_NO_HEADROOM,last_ok=$last_ok_cache;$MARK" >> "$CSV_ALL"
      done
      continue
    fi
    local survived_any=0
    for rep in $(seq 1 "$C_N_REP"); do
      saf=$(safety_check) || { log "STOP C mid: $saf"; echo "STOPPED C $saf $(ts)" > "$STATUS"; return 1; }
      cell="F5.4-C-cache${c}-r${rep}"
      # OOM is a result — run_oneshot returns 1 only on STOP_DIE
      if ! run_oneshot "$cell" "$MODEL35" "c" "" "$C_N_CTX" "$C_N_PRED" "$pfile" 1 "$c" "$C_UBATCH" "F5.4-C"; then
        log "HARD stop in C at $cell"
        return 1
      fi
      local tok rsn
      tok=$(grep '^tokens=' "$OUTDIR/c/${cell}.meta.txt" 2>/dev/null | head -1 | cut -d= -f2)
      rsn=$(grep '^reason=' "$OUTDIR/c/${cell}.meta.txt" 2>/dev/null | head -1 | cut -d= -f2-)
      if [ "${tok:-0}" != "0" ] && [ -n "${tok:-}" ]; then
        survived_any=1
        last_ok_cache=$c
      else
        log "C cell $cell did not produce tokens reason=$rsn (RAM limit candidate)"
      fi
      wait_cool 55 90
    done
    if [ "$survived_any" = "0" ]; then
      log "cache $c: zero surviving reps — further larger caches may be skipped by headroom rule"
    fi
  done
  log "PHASE C done last_ok_cache=$last_ok_cache"
  echo "PHASE_C_DONE $(ts) last_ok=$last_ok_cache" > "$OUTDIR/c/STATUS.txt"
  return 0
}'''

if old_c not in src:
    raise SystemExit("run_phase_c not found")
src = src.replace(old_c, new_c)

src = src.replace(
    'log "=== F5.4 COMPLETE phase=$PHASE_REACHED ==="',
    'log "=== F5.4 RESUME COMPLETE phase=$PHASE_REACHED ==="; rm -f "$PIDFILE" 2>/dev/null || true'
)

old_prompt = '''# Prompt files — same source file; deterministic expansion; never rewrite mid-run
python3 - <<'PY' > "$OUTDIR/prompts/long_it.txt"'''

new_prompt = '''# Prompt files — reuse existing if present (byte-identical across resume); else regenerate
if [ -f "$OUTDIR/prompts/long_it.txt" ] && [ -f "$OUTDIR/prompts/d1_prompt.txt" ] && [ -f "$OUTDIR/prompts/b_prompt.txt" ] && [ -f "$OUTDIR/prompts/hashes.txt" ]; then
  log "REUSING existing prompts (sha):"
  cat "$OUTDIR/prompts/hashes.txt" | tee -a "$MASTER"
else
log "Generating prompts"
python3 - <<'PY' > "$OUTDIR/prompts/long_it.txt"'''

if old_prompt not in src:
    raise SystemExit("prompt block not found")
src = src.replace(old_prompt, new_prompt)

old_hash_end = '''} | tee -a "$MASTER" > "$OUTDIR/prompts/hashes.txt"

# ── oneshot runner with cur_freq sampler + work metric ──'''

new_hash_end = '''} | tee -a "$MASTER" > "$OUTDIR/prompts/hashes.txt"
fi

# ── oneshot runner with cur_freq sampler + work metric ──'''

if old_hash_end not in src:
    raise SystemExit("hash end not found")
src = src.replace(old_hash_end, new_hash_end)

# Clean incomplete crash cell artifacts so 2500-r1 will re-run
# (done in shell push, not here)

out = Path("scripts/start_f5_4_resume.sh")
out.write_bytes(src.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))
print("Wrote", out, "lines", len(src.splitlines()))
for needle in [
    'C_CACHES="2500 3000 3500"',
    "RUNNING_RESUME",
    "SKIP already done",
    "start_f5_4_resume",
    "SKIP_NO_HEADROOM",
    "REUSING existing",
    "DETACH_OK",
    "RESUME COMPLETE",
]:
    print(needle, "OK" if needle in src else "MISSING")
