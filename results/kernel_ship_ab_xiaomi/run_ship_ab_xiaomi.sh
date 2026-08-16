#!/system/bin/sh
# run_ship_ab_xiaomi.sh -- kernel-ship A/B REPLICATION on Xiaomi 14 (houji).
# Device-side POSIX sh (mksh). Port of results/kernel_ship_ab_s23/run_ship_ab_s23.sh.
# PREREG: results/kernel_ship_ab_xiaomi/PREREG.md -- arms, flags, floors, 12 ABBA
# pairs, exclusions and analysis are fixed. This file only executes that protocol.
#
# mksh: no bash arrays, no [[ ]], no ${var^^}, no local, no local -n, no pipefail
# assumed. Prefix helper vars. dumpsys battery (no termux-api).
#
# Fresh-reboot gate: uptime must be <= 1800 s (30 min) on a NEW session.
# Resume after a battery-floor stop does not re-require reboot (PREREG continuation).
set -u
export LC_ALL=C

OUTDIR="${OUTDIR:-/data/local/tmp/ship_ab}"
BIN="${BINARY:-$OUTDIR/bin/bmoe-cli}"
CAMPAIGN_BIN="${CAMPAIGN_BIN:-$OUTDIR/bin/bmoe-cli}"
MODEL="${MODEL:-$OUTDIR/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf}"
P_FACT="${P_FACT:-$OUTDIR/prompts/p_fact.txt}"
export LD_LIBRARY_PATH="$(dirname "$BIN")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

EXPECTED_CAMPAIGN_SHA="0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c"
EXPECTED_LIB_CPLUSPLUS_SHA="e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6"
EXPECTED_LIB_GGML_BASE_SHA="cfed1b4e511511a28ca4f6bc9d3976976ff2fcf67f22919a875d9454a39b0dc1"
EXPECTED_LIB_GGML_CPU_SHA="b164d48a955329964a08248d1c2a26576c3b654eda17b6727d396fd5de901052"
EXPECTED_LIB_GGML_SHA="af29c01eeafcba1bb981bb336ea9f231e62fafdb0203fa9884f776b7f06a1939"
EXPECTED_LIB_LLAMA_COMMON_SHA="09d54baac36407f2c1197f8f65bba32a5c84f8ed2c381dc2bfc914838f2d86c1"
EXPECTED_LIB_LLAMA_SHA="4d505d3c403a60c0f617fe52512cbc5be38b31e314e571b31c5548e4ecda7288"
EXPECTED_MODEL_SHA="b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7"
EXPECTED_MODEL_SIZE="8071293600"
EXPECTED_FACT_SHA="b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd"

MEMAVAIL_ABORT_KIB=307200
MEMAVAIL_STREAK_NEED=12
BATT_FLOOR=45
# PREREG abort 43 C. Match S23: abort when temp > 43.0 (TEMP10 > 430).
TEMP_ABORT_TENTHS=430
N_GEN=200
# Completion floor: usage dumps finish in ~1-2 s. A real n=200 Mellum2 decode
# on this SoC cannot. 12 s is a garbage floor, not a performance claim.
MIN_WALL_S=12
MIN_LOG_BYTES=20480
# New-session fresh-reboot gate. 30 min covers wireless-adb reconnect + start.
UPTIME_MAX_S=1800
# PREREG amendment 2: drop energy if |ΔQ| < 2000 uAh (unreliable).
DQ_MIN_UAH=2000

BINDIR="$(dirname "$BIN")"

mkdir -p "$OUTDIR/logs" "$OUTDIR/prompts" "$OUTDIR/mem" "$OUTDIR/gen" "$OUTDIR/power"
CSV="$OUTDIR/runs.csv"
MASTER="$OUTDIR/SHIP.master.log"
STATUS="$OUTDIR/STATUS.txt"
RESUME_AT="$OUTDIR/RESUME_AT.txt"
SESSION="$OUTDIR/SESSION_START.txt"
METRIC6="$OUTDIR/metric6.csv"
CSV_HEADER="ts,pair,arm,label,excluded,decode_tps,wall_s_tok,compute,mgmt,stall,tokens_generated,joules,j_per_tok,ttft_s,batt_start,batt_end,temp_start,temp_max,screen,plugged,memavail_start_kib,power_source,j_window"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }

log() { echo "[$(ts)] $*" | tee -a "$MASTER"; }

sha_of() { sha256sum "$1" | awk '{print $1}'; }

is_num() {
  case "${1:-}" in
    ''|*[!0-9.]*|.*) return 1 ;;
  esac
  case "$1" in
    *.*.*) return 1 ;;
  esac
  return 0
}

is_int() {
  case "${1:-}" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

fmt_temp_c() {
  # TEMP10 (tenths of C, integer) -> one decimal Celsius, S23-style.
  awk -v t="${1:-0}" 'BEGIN{printf "%.1f", t/10.0}'
}

LAST_EXCLUDED=0
LAST_RC=0
LAST_COMPLETE=0
POWER_SOURCE=""
CHARGE_UAH=""
VOLTAGE_MV=""
CAMP_SHA=""
LEVEL=""
AC=""
USB=""
WL=""
DOCK=""
TEMP10=""
TEMP_C=""
PLUGGED=""
PLUG_LABEL=""

# --- pins ---
verify_one_sha() {
  _vs_path="$1"
  _vs_want="$2"
  _vs_tag="$3"
  if [ ! -f "$_vs_path" ]; then
    log "PIN FAIL missing $_vs_tag path=$_vs_path"
    echo "FAIL_PIN" > "$STATUS"
    exit 6
  fi
  _vs_got=$(sha_of "$_vs_path")
  log "PIN $_vs_tag sha=$_vs_got path=$_vs_path"
  if [ "$_vs_got" != "$_vs_want" ]; then
    log "PIN FAIL $_vs_tag expected $_vs_want got $_vs_got"
    echo "FAIL_PIN" > "$STATUS"
    exit 6
  fi
}

camp_sha=$(sha_of "$CAMPAIGN_BIN")
CAMP_SHA="$camp_sha"
log "CAMPAIGN_SHA=$camp_sha path=$CAMPAIGN_BIN"
if [ "$camp_sha" != "$EXPECTED_CAMPAIGN_SHA" ]; then
  log "CAMPAIGN PIN FAIL expected $EXPECTED_CAMPAIGN_SHA got $camp_sha"
  echo "FAIL_PIN" > "$STATUS"
  exit 6
fi
verify_one_sha "$BINDIR/libc++_shared.so" "$EXPECTED_LIB_CPLUSPLUS_SHA" "libc++_shared.so"
verify_one_sha "$BINDIR/libggml-base.so" "$EXPECTED_LIB_GGML_BASE_SHA" "libggml-base.so"
verify_one_sha "$BINDIR/libggml-cpu.so" "$EXPECTED_LIB_GGML_CPU_SHA" "libggml-cpu.so"
verify_one_sha "$BINDIR/libggml.so" "$EXPECTED_LIB_GGML_SHA" "libggml.so"
verify_one_sha "$BINDIR/libllama-common.so" "$EXPECTED_LIB_LLAMA_COMMON_SHA" "libllama-common.so"
verify_one_sha "$BINDIR/libllama.so" "$EXPECTED_LIB_LLAMA_SHA" "libllama.so"
log "RUNTIME PIN OK 7/7"
echo "$camp_sha  bmoe-cli" > "$OUTDIR/campaign.sha256"
if [ ! -x "$BIN" ]; then
  log "BIN not executable, chmod 755 (content untouched): $BIN"
  chmod 755 "$BIN" || true
fi
if [ ! -x "$BIN" ]; then
  log "BIN missing or not executable: $BIN"
  echo "FAIL_BIN" > "$STATUS"
  exit 7
fi
if [ "$BIN" != "$CAMPAIGN_BIN" ]; then
  bin_sha=$(sha_of "$BIN")
  if [ "$bin_sha" != "$camp_sha" ]; then
    log "BIN sha != campaign pin -- config-only A/B must use the campaign ELF"
    echo "FAIL_BIN_NOT_PIN" > "$STATUS"
    exit 7
  fi
fi

msize=$(stat -c%s "$MODEL" 2>/dev/null || echo 0)
log "MODEL path=$MODEL size=$msize"
if [ "$msize" != "$EXPECTED_MODEL_SIZE" ]; then
  log "MODEL size unexpected: $msize want $EXPECTED_MODEL_SIZE"
  echo "FAIL_MODEL_SIZE" > "$STATUS"
  exit 8
fi
if [ -f "$OUTDIR/model.sha256" ]; then
  msha=$(awk 'NF{print $1; exit}' "$OUTDIR/model.sha256")
  log "MODEL_SHA (cached)=$msha"
else
  log "computing MODEL sha256 (8 GiB, may take a minute)..."
  msha=$(sha_of "$MODEL")
  echo "$msha  Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf" > "$OUTDIR/model.sha256"
  log "MODEL_SHA=$msha"
fi
if [ "$msha" != "$EXPECTED_MODEL_SHA" ]; then
  log "MODEL sha mismatch want $EXPECTED_MODEL_SHA got $msha"
  echo "FAIL_MODEL_SHA" > "$STATUS"
  exit 8
fi

if [ ! -f "$P_FACT" ]; then
  log "prompt missing $P_FACT"
  echo "FAIL_PROMPTS" > "$STATUS"
  exit 9
fi
fact_sha=$(sha_of "$P_FACT")
log "prompt_fact_sha=$fact_sha"
if [ "$fact_sha" != "$EXPECTED_FACT_SHA" ]; then
  log "fact prompt sha mismatch"
  echo "FAIL_PROMPT_SHA" > "$STATUS"
  exit 9
fi

# --- sensors ---
memavail_kib() { awk '/^MemAvailable:/{print $2; exit}' /proc/meminfo; }
memfree_kib() { awk '/^MemFree:/{print $2; exit}' /proc/meminfo; }
swapfree_kib() { awk '/^SwapFree:/{print $2; exit}' /proc/meminfo; }
swaptotal_kib() { awk '/^SwapTotal:/{print $2; exit}' /proc/meminfo; }
memtotal_kib() { awk '/^MemTotal:/{print $2; exit}' /proc/meminfo; }
uptime_s() { awk '{print int($1)}' /proc/uptime; }

screen_state() {
  dumpsys power 2>/dev/null | awk -F= '/mWakefulness=/{gsub(/[ \r]/,"",$2); print $2; exit}'
  :
}

read_batt() {
  _rb=$(dumpsys battery 2>/dev/null | tr -d '\r')
  LEVEL=$(echo "$_rb" | awk -F': ' '/^[ ]*level:/{print $2; exit}')
  AC=$(echo "$_rb" | awk -F': ' '/AC powered:/{print $2; exit}')
  USB=$(echo "$_rb" | awk -F': ' '/USB powered:/{print $2; exit}')
  WL=$(echo "$_rb" | awk -F': ' '/Wireless powered:/{print $2; exit}')
  DOCK=$(echo "$_rb" | awk -F': ' '/Dock powered:/{print $2; exit}')
  TEMP10=$(echo "$_rb" | awk -F': ' '/^[ ]*temperature:/{print $2; exit}')
  [ -n "$LEVEL" ] || LEVEL=-1
  [ -n "$TEMP10" ] || TEMP10=9990
  TEMP_C=$(fmt_temp_c "$TEMP10")
  # Fail closed: unparseable plug flags count as plugged (do not measure).
  PLUGGED=1
  PLUG_LABEL="UNKNOWN"
  if [ -n "$AC" ] && [ -n "$USB" ] && [ -n "$WL" ]; then
    [ -n "$DOCK" ] || DOCK="false"
    if [ "$AC" = "false" ] && [ "$USB" = "false" ] && [ "$WL" = "false" ] && [ "$DOCK" = "false" ]; then
      PLUGGED=0
      PLUG_LABEL="UNPLUGGED"
    else
      PLUGGED=1
      PLUG_LABEL="PLUGGED"
    fi
  fi
}

batt_plugged() {
  read_batt
  echo "$PLUG_LABEL"
}

batt_pct() {
  read_batt
  echo "$LEVEL"
}

batt_temp10() {
  read_batt
  echo "$TEMP10"
}

probe_power_source() {
  # PREREG amendment 2: metric 3 is the coulomb counter, two dumpsys
  # reads per run. sysfs current_now is unreachable (uid 2000). Do not
  # start a 1 Hz sampler and do not read mid-decode.
  POWER_SOURCE="COULOMB_COUNTER"
  log "POWER_SOURCE=COULOMB_COUNTER estimator=dQ_uAh*3.6e-3*Vbar_V (two dumpsys reads bracketing the CLI). Absolute J/token is NOT comparable to S23. Guard: dQ < ${DQ_MIN_UAH} uAh -> energy fields empty, run stays valid."
}

# Charge counter (uAh) + voltage (mV) from one dumpsys. Voltage line is
# "  voltage: NNNN" -- do not match the "last voltage value" broadcast line.
read_coulomb() {
  _rcb=$(dumpsys battery 2>/dev/null | tr -d '\r')
  CHARGE_UAH=$(echo "$_rcb" | awk -F': ' '/Charge counter:/{gsub(/[ \t]/,"",$2); print $2; exit}')
  VOLTAGE_MV=$(echo "$_rcb" | awk -F': ' '/^[ ]*voltage:/{gsub(/[ \t]/,"",$2); print $2; exit}')
}

# stdout: joules or empty. Args: q0 v0 q1 v1.
# dQ = |q0-q1|. Empty if unparseable or dQ < DQ_MIN_UAH.
# joules = dQ[uAh] * 0.0036 * Vbar[V], Vbar = mean(v0,v1)/1000.
coulomb_joules() {
  _cj_q0="$1"
  _cj_v0="$2"
  _cj_q1="$3"
  _cj_v1="$4"
  if ! is_int "$_cj_q0" || ! is_int "$_cj_v0" || ! is_int "$_cj_q1" || ! is_int "$_cj_v1"; then
    echo ""
    return
  fi
  if [ "$_cj_q0" -ge "$_cj_q1" ]; then
    _cj_dq=$((_cj_q0 - _cj_q1))
  else
    _cj_dq=$((_cj_q1 - _cj_q0))
  fi
  if [ "$_cj_dq" -lt "$DQ_MIN_UAH" ]; then
    echo ""
    return
  fi
  awk -v dq="$_cj_dq" -v v0="$_cj_v0" -v v1="$_cj_v1" 'BEGIN{
    vbar = (v0 + v1) / 2000.0
    printf "%.6f", dq * 0.0036 * vbar
  }'
}

kill_our_cli() { pkill -f "$BINDIR/bmoe-cli" 2>/dev/null || true; }

start_mem_sampler() {
  _sms_csv="$1"
  echo "iso,memfree_kib,memavail_kib" > "$_sms_csv"
  rm -f "$OUTDIR/ABORT_RAM.txt"
  (
    _sms_bad=0
    while :; do
      _sms_mf=$(memfree_kib)
      _sms_ma=$(memavail_kib)
      echo "$(ts),${_sms_mf},${_sms_ma}" >> "$_sms_csv"
      if [ -n "${_sms_ma}" ] && [ "${_sms_ma}" -lt "${MEMAVAIL_ABORT_KIB}" ] 2>/dev/null; then
        _sms_bad=$((_sms_bad + 1))
        if [ "${_sms_bad}" -ge "${MEMAVAIL_STREAK_NEED}" ]; then
          echo "ABORT MemAvailable=${_sms_ma} KiB < 300 MiB sustained 60s" | tee -a "$_sms_csv"
          echo "ABORT_RAM ma=${_sms_ma}" > "$OUTDIR/ABORT_RAM.txt"
          kill_our_cli
          exit 0
        fi
      else
        _sms_bad=0
      fi
      sleep 5
    done
  ) >/dev/null 2>&1 &
  echo $! > "$OUTDIR/mem_sampler.pid"
}

stop_mem_sampler() {
  if [ -f "$OUTDIR/mem_sampler.pid" ]; then
    _sms_pid="$(cat "$OUTDIR/mem_sampler.pid")"
    kill "$_sms_pid" 2>/dev/null || true
    wait "$_sms_pid" 2>/dev/null || true
    rm -f "$OUTDIR/mem_sampler.pid"
  fi
}

stop_power_sampler() {
  if [ -f "$OUTDIR/power_sampler.pid" ]; then
    _sps_pid="$(cat "$OUTDIR/power_sampler.pid")"
    kill "$_sps_pid" 2>/dev/null || true
    wait "$_sps_pid" 2>/dev/null || true
    rm -f "$OUTDIR/power_sampler.pid"
  fi
}

temp_over_abort() {
  # $1 = TEMP10
  _toa="$1"
  is_int "$_toa" || return 0
  [ "$_toa" -gt "$TEMP_ABORT_TENTHS" ]
}

preflight_block() {
  _pf_floor="${1:-$BATT_FLOOR}"
  _pf_i=1
  while [ "$_pf_i" -le 720 ]; do
    read_batt
    _pf_ma=$(memavail_kib)
    _pf_scr=$(screen_state)
    [ -n "$_pf_scr" ] || _pf_scr="?"
    log "preflight i=$_pf_i plugged=$PLUG_LABEL batt=$LEVEL temp=$TEMP_C memavail_kib=$_pf_ma floor=$_pf_floor screen=$_pf_scr power=$POWER_SOURCE"
    if [ "$PLUGGED" -ne 0 ]; then
      log "WAIT unplugged (now $PLUG_LABEL)"
      sleep 20
      _pf_i=$((_pf_i + 1))
      continue
    fi
    if ! is_int "$LEVEL" || [ "$LEVEL" -lt 0 ]; then
      log "WAIT battery unreadable (level=$LEVEL)"
      sleep 20
      _pf_i=$((_pf_i + 1))
      continue
    fi
    if [ "$LEVEL" -lt "$_pf_floor" ]; then
      log "STOP batt $LEVEL < $_pf_floor needs charge"
      echo "STOP_BATT" > "$STATUS"
      return 3
    fi
    if temp_over_abort "$TEMP10"; then
      log "WAIT battery temp $TEMP_C > 43C"
      sleep 30
      _pf_i=$((_pf_i + 1))
      continue
    fi
    return 0
  done
  log "STOP preflight timeout"
  echo "STOP_PLUGGED" > "$STATUS"
  return 2
}

write_resume_at() {
  echo "$1" > "$RESUME_AT"
  log "RESUME_AT=$1"
}

recheck_campaign_pin() {
  _rcp=$(sha_of "$CAMPAIGN_BIN")
  log "CAMPAIGN_SHA_AFTER=$_rcp"
  echo "$_rcp  bmoe-cli" > "$OUTDIR/campaign.sha256.after"
  if [ "$_rcp" != "$CAMP_SHA" ]; then
    log "CAMPAIGN PIN CHANGED during cell (was $CAMP_SHA)"
    echo "FAIL_PIN_AFTER" > "$STATUS"
    return 1
  fi
  return 0
}

record_session_start() {
  _rss_up=$(uptime_s)
  _rss_ma=$(memavail_kib)
  _rss_sf=$(swapfree_kib)
  _rss_st=$(swaptotal_kib)
  _rss_mt=$(memtotal_kib)
  _rss_fresh="no"
  if [ "$_rss_up" -le "$UPTIME_MAX_S" ]; then
    _rss_fresh="yes"
  fi
  {
    echo "ts=$(ts)"
    echo "uptime_s=$_rss_up"
    echo "uptime_threshold_s=$UPTIME_MAX_S"
    echo "fresh_reboot=$_rss_fresh"
    echo "MemAvailable_kib=$_rss_ma"
    echo "SwapFree_kib=$_rss_sf"
    echo "SwapTotal_kib=$_rss_st"
    echo "MemTotal_kib=$_rss_mt"
    echo "POWER_SOURCE=$POWER_SOURCE"
    echo "resume_mode=$RESUME_MODE"
  } | tee "$SESSION" | tee -a "$MASTER"
  log "SESSION_START uptime_s=$_rss_up fresh_reboot=$_rss_fresh MemAvailable=$_rss_ma SwapFree=$_rss_sf SwapTotal=$_rss_st"
}

refuse_if_not_fresh() {
  _rif_up=$(uptime_s)
  if [ "$_rif_up" -gt "$UPTIME_MAX_S" ]; then
    log "REFUSE start: uptime ${_rif_up}s > ${UPTIME_MAX_S}s (30 min). PREREG requires a fresh reboot. Reboot, reconnect wireless adb, re-run push_and_start_xiaomi.ps1."
    echo "FAIL_NOT_FRESH_REBOOT" > "$STATUS"
    record_session_start
    exit 13
  fi
}

parse_metrics() {
  # stdin unused; $1 = combo.txt. Prints tok_s|wall|comp|mgmt|stall|n_gen|ttft|mib
  _pmf="$1"
  _pm_tok=$(sed -n 's/.*generation: .*(\([0-9.]*\) tok\/s).*/\1/p' "$_pmf" | tail -1)
  if [ -z "$_pm_tok" ]; then
    _pm_tok=$(sed -n 's/.*(\([0-9.]*\) tok\/s).*/\1/p' "$_pmf" | tail -1)
  fi
  _pm_wall=$(sed -n 's/.*decode \([0-9.]*\) s\/token.*/\1/p' "$_pmf" | tail -1)
  _pm_comp=$(sed -n 's/.*decode [0-9.]* s\/token (compute \([0-9.]*\).*/\1/p' "$_pmf" | tail -1)
  _pm_mgmt=$(sed -n 's/.*cache mgmt \([0-9.]*\).*/\1/p' "$_pmf" | tail -1)
  _pm_stall=$(sed -n 's/.*moe-overlap: stall \([0-9.]*\) s\/token.*/\1/p' "$_pmf" | tail -1)
  _pm_ngen=$(sed -n 's/.*generation: \([0-9]*\) tokens.*/\1/p' "$_pmf" | tail -1)
  _pm_ttft=$(sed -n 's/.*TTFT \([0-9.]*\) s.*/\1/p' "$_pmf" | tail -1)
  if [ -z "$_pm_ttft" ]; then
    _pm_ttft=$(sed -n 's/.*prefill: [0-9]* tokens, \([0-9.]*\) s.*/\1/p' "$_pmf" | tail -1)
  fi
  _pm_mib=$(sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p' "$_pmf" | tail -1)
  if grep -q BMOE_DONE "$_pmf" 2>/dev/null; then
    _pm_bd=$(grep BMOE_DONE "$_pmf" | tail -1)
    _pm_jt=$(echo "$_pm_bd" | sed -n 's/.*"tok_s": *\([0-9.]*\).*/\1/p')
    _pm_jn=$(echo "$_pm_bd" | sed -n 's/.*"tokens": *\([0-9]*\).*/\1/p')
    _pm_jf=$(echo "$_pm_bd" | sed -n 's/.*"ttft": *\([0-9.]*\).*/\1/p')
    [ -n "$_pm_jt" ] && _pm_tok=$_pm_jt
    [ -n "$_pm_jn" ] && _pm_ngen=$_pm_jn
    [ -n "$_pm_jf" ] && _pm_ttft=$_pm_jf
  fi
  printf '%s|%s|%s|%s|%s|%s|%s|%s' "$_pm_tok" "$_pm_wall" "$_pm_comp" "$_pm_mgmt" "$_pm_stall" "$_pm_ngen" "$_pm_ttft" "$_pm_mib"
}

extract_gen() {
  _eg_src="$1"
  _eg_dst="$2"
  awk '
    BEGIN { cut = -1 }
    {
      lines[NR] = $0
      if ($0 ~ /^generation:/ && cut < 0) cut = NR
    }
    END {
      n = NR
      if (cut > 0) n = cut - 1
      body = ""
      for (i = 1; i <= n; i++) body = body lines[i] "\n"
      idx = 0
      for (i = n; i >= 1; i--) {
        if (lines[i] ~ /Assistant:/) { idx = i; break }
      }
      if (idx > 0) {
        out = lines[idx]
        sub(/.*Assistant:/, "", out)
        for (i = idx + 1; i <= n; i++) out = out "\n" lines[i]
      } else {
        out = body
      }
      gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "", out)
      print out
    }
  ' "$_eg_src" > "$_eg_dst"
}

completion_reasons() {
  # args: wall_s_tok wall_s bytes
  _cr_dec="$1"
  _cr_wall="$2"
  _cr_bytes="$3"
  _cr=""
  if ! is_num "$_cr_dec"; then
    _cr="${_cr}no_decode_s_tok "
  elif ! awk -v x="$_cr_dec" 'BEGIN{ if (x+0 > 0) exit 0; exit 1 }'; then
    _cr="${_cr}decode_s_tok_not_positive "
  fi
  if ! is_int "$_cr_wall" || [ "$_cr_wall" -lt "$MIN_WALL_S" ]; then
    _cr="${_cr}wall=${_cr_wall}<${MIN_WALL_S} "
  fi
  if ! is_int "$_cr_bytes" || [ "$_cr_bytes" -le "$MIN_LOG_BYTES" ]; then
    _cr="${_cr}bytes=${_cr_bytes}<=${MIN_LOG_BYTES} "
  fi
  echo "$_cr"
}

invoke_cli() {
  # $1=arm $2=prompt $3=stdout $4=stderr
  _ic_arm="$1"
  _ic_p="$2"
  _ic_out="$3"
  _ic_err="$4"
  if [ "$_ic_arm" = "A" ]; then
    "$BIN" -m "$MODEL" -p "$_ic_p" -n "$N_GEN" \
      --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
      --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think \
      -t 4 --n-expert-used 8 \
      >"$_ic_out" 2>"$_ic_err"
    return $?
  fi
  "$BIN" -m "$MODEL" -p "$_ic_p" -n "$N_GEN" \
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think \
    -t 2 --n-expert-used 6 --drop-cold-experts 1.0 \
    >"$_ic_out" 2>"$_ic_err"
  return $?
}

write_cmdline() {
  _wc_arm="$1"
  _wc_dst="$2"
  if [ "$_wc_arm" = "A" ]; then
    printf '%s\n' \
      "$BIN" -m "$MODEL" -p "<p_fact>" -n "$N_GEN" \
      --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
      --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think \
      -t 4 --n-expert-used 8 \
      >"$_wc_dst"
    return
  fi
  printf '%s\n' \
    "$BIN" -m "$MODEL" -p "<p_fact>" -n "$N_GEN" \
    --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
    --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think \
    -t 2 --n-expert-used 6 --drop-cold-experts 1.0 \
    >"$_wc_dst"
}

run_one() {
  _ro_pair="$1"
  _ro_arm="$2"
  _ro_label="$3"
  _ro_excl_forced="$4"
  _ro_out="$OUTDIR/logs/$_ro_label"
  mkdir -p "$_ro_out"
  LAST_EXCLUDED=0
  LAST_RC=0
  LAST_COMPLETE=0

  read_batt
  _ro_plug="$PLUG_LABEL"
  _ro_pct_s="$LEVEL"
  _ro_temp10_s="$TEMP10"
  _ro_temp_s="$TEMP_C"
  _ro_ma_s=$(memavail_kib)
  _ro_screen_s=$(screen_state)
  [ -n "$_ro_screen_s" ] || _ro_screen_s="?"
  log "RUN $_ro_label pair=$_ro_pair arm=$_ro_arm batt=$_ro_pct_s plugged=$_ro_plug temp=$_ro_temp_s screen=$_ro_screen_s memavail_kib=$_ro_ma_s power=$POWER_SOURCE"
  if [ "$PLUGGED" -ne 0 ]; then
    log "STOP $_ro_label plugged=$_ro_plug"
    echo "STOP_PLUGGED" > "$STATUS"
    return 2
  fi
  if ! is_int "$_ro_pct_s" || [ "$_ro_pct_s" -lt "$BATT_FLOOR" ]; then
    log "STOP $_ro_label batt=$_ro_pct_s"
    echo "STOP_BATT" > "$STATUS"
    return 3
  fi
  if temp_over_abort "$_ro_temp10_s"; then
    log "WAIT thermal before $_ro_label temp=$_ro_temp_s"
    sleep 45
    read_batt
    _ro_plug="$PLUG_LABEL"
    _ro_pct_s="$LEVEL"
    _ro_temp10_s="$TEMP10"
    _ro_temp_s="$TEMP_C"
    _ro_ma_s=$(memavail_kib)
    _ro_screen_s=$(screen_state)
    [ -n "$_ro_screen_s" ] || _ro_screen_s="?"
    if temp_over_abort "$_ro_temp10_s"; then
      log "STOP thermal $_ro_label temp=$_ro_temp_s"
      echo "STOP_THERMAL" > "$STATUS"
      return 4
    fi
  fi

  _ro_old=$(pgrep -f "$BINDIR/bmoe-cli" 2>/dev/null || true)
  if [ -n "$_ro_old" ]; then
    log "KILL leftover bmoe-cli: $_ro_old"
    kill_our_cli
    sleep 2
    pkill -9 -f "$BINDIR/bmoe-cli" 2>/dev/null || true
  fi

  _ro_ptext=$(cat "$P_FACT")
  _ro_try=1
  _ro_reasons="not_run"
  _ro_wall=0
  _ro_bytes=0
  decode_tps=""
  wall_s_tok=""
  compute=""
  mgmt=""
  stall=""
  n_gen=""
  ttft_s=""
  mib_per_tok=""
  rc=1
  _ro_q0=""
  _ro_v0=""
  _ro_q1=""
  _ro_v1=""

  while [ "$_ro_try" -le 3 ]; do
    read_batt
    if [ "$PLUGGED" -ne 0 ]; then
      log "STOP $_ro_label plugged=$PLUG_LABEL on try=$_ro_try"
      echo "STOP_PLUGGED" > "$STATUS"
      return 2
    fi
    if ! is_int "$LEVEL" || [ "$LEVEL" -lt "$BATT_FLOOR" ]; then
      log "STOP $_ro_label batt=$LEVEL on try=$_ro_try"
      echo "STOP_BATT" > "$STATUS"
      return 3
    fi
    if temp_over_abort "$TEMP10"; then
      log "STOP thermal $_ro_label temp=$TEMP_C on try=$_ro_try"
      echo "STOP_THERMAL" > "$STATUS"
      return 4
    fi

    start_mem_sampler "$OUTDIR/mem/${_ro_label}.csv"
    read_coulomb
    _ro_q0="$CHARGE_UAH"
    _ro_v0="$VOLTAGE_MV"
    _ro_cts0=$(ts)
    log "COULOMB_START $_ro_label try=$_ro_try Q_uAh=$_ro_q0 V_mV=$_ro_v0"
    _ro_t0=$(date +%s)
    invoke_cli "$_ro_arm" "$_ro_ptext" "$_ro_out/stdout.txt" "$_ro_out/stderr.txt"
    rc=$?
    LAST_RC=$rc
    _ro_t1=$(date +%s)
    _ro_wall=$((_ro_t1 - _ro_t0))
    read_coulomb
    _ro_q1="$CHARGE_UAH"
    _ro_v1="$VOLTAGE_MV"
    _ro_cts1=$(ts)
    log "COULOMB_END $_ro_label try=$_ro_try Q_uAh=$_ro_q1 V_mV=$_ro_v1"
    stop_mem_sampler
    mkdir -p "$OUTDIR/power"
    {
      echo "ts,charge_uah,voltage_mv"
      echo "${_ro_cts0},${_ro_q0},${_ro_v0}"
      echo "${_ro_cts1},${_ro_q1},${_ro_v1}"
    } > "$OUTDIR/power/${_ro_label}.csv"
    cat "$_ro_out/stdout.txt" "$_ro_out/stderr.txt" > "$_ro_out/combo.txt" 2>/dev/null || true
    cp "$_ro_out/stdout.txt" "$_ro_out/stdout.try${_ro_try}.txt" 2>/dev/null || true
    cp "$_ro_out/stderr.txt" "$_ro_out/stderr.try${_ro_try}.txt" 2>/dev/null || true
    cp "$_ro_out/combo.txt" "$_ro_out/combo.try${_ro_try}.txt" 2>/dev/null || true

    if [ -f "$OUTDIR/ABORT_RAM.txt" ]; then
      log "STOP $_ro_label $(cat "$OUTDIR/ABORT_RAM.txt")"
      echo "STOP_RAM" > "$STATUS"
      return 5
    fi

    _pm=$(parse_metrics "$_ro_out/combo.txt")
    # mksh extglob treats | as alternation, so ${var%%|*} empties every field.
    decode_tps=$(printf '%s\n' "$_pm" | awk -F'|' '{print $1}')
    wall_s_tok=$(printf '%s\n' "$_pm" | awk -F'|' '{print $2}')
    compute=$(printf '%s\n' "$_pm" | awk -F'|' '{print $3}')
    mgmt=$(printf '%s\n' "$_pm" | awk -F'|' '{print $4}')
    stall=$(printf '%s\n' "$_pm" | awk -F'|' '{print $5}')
    n_gen=$(printf '%s\n' "$_pm" | awk -F'|' '{print $6}')
    ttft_s=$(printf '%s\n' "$_pm" | awk -F'|' '{print $7}')
    mib_per_tok=$(printf '%s\n' "$_pm" | awk -F'|' '{print $8}')

    _ro_bytes=$(wc -c < "$_ro_out/combo.txt" 2>/dev/null | tr -d ' \t\r')
    [ -n "$_ro_bytes" ] || _ro_bytes=0
    _ro_reasons=$(completion_reasons "$wall_s_tok" "$_ro_wall" "$_ro_bytes")
    if [ -z "$_ro_reasons" ]; then
      LAST_COMPLETE=1
      log "COMPLETE $_ro_label try=$_ro_try decode_s_tok=$wall_s_tok wall=${_ro_wall}s bytes=$_ro_bytes"
      break
    fi
    log "RETRY $_ro_label try=$_ro_try FAIL[$_ro_reasons] decode_s_tok=${wall_s_tok:-none} wall=${_ro_wall}s bytes=$_ro_bytes rc=$rc"
    _ro_try=$((_ro_try + 1))
    if [ "$_ro_try" -le 3 ]; then
      sleep 10
    fi
  done

  if [ "$LAST_COMPLETE" != "1" ]; then
    log "FAIL $_ro_label after 3 tries -- last FAIL[$_ro_reasons] decode_s_tok=${wall_s_tok:-none} wall=${_ro_wall}s bytes=$_ro_bytes rc=$rc -- writing excluded row, not accepting as a measurement"
  fi

  read_batt
  _ro_pct_e="$LEVEL"
  _ro_temp10_e="$TEMP10"
  _ro_temp_e="$TEMP_C"
  if [ "$_ro_temp10_s" -gt "$_ro_temp10_e" ] 2>/dev/null; then
    _ro_temp10_max=$_ro_temp10_s
  else
    _ro_temp10_max=$_ro_temp10_e
  fi
  _ro_temp_max=$(fmt_temp_c "$_ro_temp10_max")
  _ro_screen_e=$(screen_state)
  [ -n "$_ro_screen_e" ] || _ro_screen_e="$_ro_screen_s"
  _ro_plug_e="$PLUG_LABEL"

  extract_gen "$_ro_out/stdout.txt" "$OUTDIR/gen/${_ro_label}.txt"

  joules=""
  j_per_tok=""
  # The two coulomb reads bracket the WHOLE CLI invocation (load + prefill +
  # decode), because isolating the post-TTFT window would need a third dumpsys
  # mid-run. Label it for what it is: the S23 cell measured the decode window
  # only, so these two energy figures are different quantities and only the
  # within-cell A-vs-B ratio is reported (PREREG amendment 2).
  j_window="full_invocation"
  _ro_dq=""
  if is_int "${_ro_q0:-}" && is_int "${_ro_q1:-}"; then
    if [ "$_ro_q0" -ge "$_ro_q1" ]; then
      _ro_dq=$((_ro_q0 - _ro_q1))
    else
      _ro_dq=$((_ro_q1 - _ro_q0))
    fi
  fi
  if [ -z "$_ro_dq" ]; then
    log "ENERGY $_ro_label dropped: Charge counter unparseable Q0=${_ro_q0:-} Q1=${_ro_q1:-} V0=${_ro_v0:-} V1=${_ro_v1:-}"
    joules=""
    j_per_tok=""
  elif [ "$_ro_dq" -lt "$DQ_MIN_UAH" ]; then
    log "ENERGY $_ro_label dropped: dQ=${_ro_dq} uAh < ${DQ_MIN_UAH} (unreliable). Q0=$_ro_q0 Q1=$_ro_q1 V0=${_ro_v0} V1=${_ro_v1}. Run stays valid; energy fields empty."
    joules=""
    j_per_tok=""
  else
    joules=$(coulomb_joules "$_ro_q0" "$_ro_v0" "$_ro_q1" "$_ro_v1")
    if [ -n "$joules" ] && [ -n "$n_gen" ] && [ "$n_gen" != "0" ]; then
      j_per_tok=$(awk -v j="$joules" -v n="$n_gen" 'BEGIN{if (n+0>0) printf "%.8f", j/n}')
    fi
    log "ENERGY $_ro_label dQ_uAh=$_ro_dq Q0=$_ro_q0 Q1=$_ro_q1 V0=$_ro_v0 V1=$_ro_v1 joules=$joules j/tok=$j_per_tok j_window=$j_window"
  fi

  excluded="$_ro_excl_forced"
  if [ "$rc" -ne 0 ]; then
    excluded=1
    log "EXCLUDE $_ro_label harness error cli rc=$rc"
  fi
  if [ "$LAST_COMPLETE" != "1" ]; then
    excluded=1
    log "EXCLUDE $_ro_label completion check failed after 3 tries [$_ro_reasons]"
  fi
  if [ -z "$wall_s_tok" ] && [ "$_ro_excl_forced" != "1" ]; then
    excluded=1
    log "EXCLUDE $_ro_label missing decode s/token"
  fi
  if [ "$_ro_plug_e" != "UNPLUGGED" ]; then
    excluded=1
    log "EXCLUDE $_ro_label plugged at end ($_ro_plug_e)"
  fi
  if temp_over_abort "$_ro_temp10_max"; then
    excluded=1
    log "EXCLUDE $_ro_label thermal mid-run temp_max=$_ro_temp_max"
  fi
  LAST_EXCLUDED=$excluded

  _ro_row="$(ts),${_ro_pair},${_ro_arm},${_ro_label},${excluded},${decode_tps},${wall_s_tok},${compute},${mgmt},${stall},${n_gen},${joules},${j_per_tok},${ttft_s},${_ro_pct_s},${_ro_pct_e},${_ro_temp_s},${_ro_temp_max},${_ro_screen_e},${_ro_plug},${_ro_ma_s},${POWER_SOURCE},${j_window}"
  echo "$_ro_row" >> "$CSV"
  if [ ! -f "$METRIC6" ]; then
    echo "ts,pair,arm,label,excluded,mib_per_tok" > "$METRIC6"
  fi
  echo "$(ts),${_ro_pair},${_ro_arm},${_ro_label},${excluded},${mib_per_tok}" >> "$METRIC6"
  log "DONE $_ro_label rc=$rc wall=${_ro_wall}s tps=$decode_tps s/tok=$wall_s_tok mib/tok=$mib_per_tok joules=$joules j/tok=$j_per_tok ttft=$ttft_s j_window=$j_window batt=${_ro_pct_s}->${_ro_pct_e} temp_max=$_ro_temp_max screen=$_ro_screen_e excluded=$excluded complete=$LAST_COMPLETE"
  tail -120 "$_ro_out/combo.txt" > "$_ro_out/tail.txt" 2>/dev/null || true
  write_cmdline "$_ro_arm" "$_ro_out/cmdline.txt"
  return 0
}

pair_order() {
  # odd pairs AB, even pairs BA
  _po="$1"
  if [ $((_po % 2)) -eq 1 ]; then echo "A B"; else echo "B A"; fi
}

pair_label() {
  printf 'p%02d_%s' "$1" "$2"
}

run_pair() {
  _rp="$1"
  set -- $(pair_order "$_rp")
  _rp_a1="$1"
  _rp_a2="$2"
  LAST_EXCLUDED=0
  run_one "$_rp" "$_rp_a1" "$(pair_label "$_rp" "$_rp_a1")" 0 || return $?
  if [ "$LAST_EXCLUDED" = "1" ]; then
    log "VOID pair=$_rp after $_rp_a1"
    return 0
  fi
  run_one "$_rp" "$_rp_a2" "$(pair_label "$_rp" "$_rp_a2")" 0 || return $?
  if [ "$LAST_EXCLUDED" = "1" ]; then
    log "VOID pair=$_rp after $_rp_a2"
    return 0
  fi
  log "PAIR_OK pair=$_rp order=${_rp_a1}${_rp_a2}"
  return 0
}

pair_complete() {
  _pc="$1"
  [ -f "$CSV" ] || return 1
  awk -F, -v want="$_pc" '
    NR == 1 {
      for (i = 1; i <= NF; i++) {
        if ($i == "pair") p = i
        else if ($i == "arm") a = i
        else if ($i == "excluded") e = i
      }
      next
    }
    p && a && e && ($p + 0) == (want + 0) && $e == "0" {
      if ($a == "A" || $a == "B") have[$a] = 1
    }
    END {
      if (("A" in have) && ("B" in have)) exit 0
      exit 1
    }
  ' "$CSV"
}

csv_void_pairs() {
  if [ ! -f "$CSV" ]; then
    echo "1 2 3 4 5 6 7 8 9 10 11 12"
    return
  fi
  awk -F, '
    NR == 1 {
      for (i = 1; i <= NF; i++) {
        if ($i == "pair") p = i
        else if ($i == "arm") a = i
        else if ($i == "excluded") e = i
      }
      next
    }
    p && a && e {
      pair = $p + 0
      if (pair >= 1 && pair <= 12 && $e == "0") {
        if ($a == "A" || $a == "B") have[pair, $a] = 1
      }
    }
    END {
      out = ""
      for (i = 1; i <= 12; i++) {
        if (!(have[i, "A"] && have[i, "B"])) {
          if (out != "") out = out " "
          out = out i
        }
      }
      print out
    }
  ' "$CSV"
}

# --- start / resume ---
if [ -f "$STATUS" ]; then
  _st=$(tr -d ' \r\n' < "$STATUS")
  if [ "$_st" = "DONE" ] && [ -z "${RESUME_FROM:-}" ] && [ -z "${FORCE:-}" ]; then
    log "already DONE; set FORCE=1 to start a new campaign"
    exit 0
  fi
fi

RESUME_MODE=0
START_PAIR=1
if [ -n "${RESUME_FROM:-}" ]; then
  START_PAIR="$RESUME_FROM"
  RESUME_MODE=1
elif [ -f "$RESUME_AT" ]; then
  START_PAIR="$(tr -d ' \r\n' < "$RESUME_AT")"
  RESUME_MODE=1
  log "auto-resume from RESUME_AT=$START_PAIR"
elif [ -f "$CSV" ] && [ -s "$CSV" ] && [ -f "$STATUS" ]; then
  prev_st="$(tr -d ' \r\n' < "$STATUS")"
  if [ "$prev_st" != "DONE" ]; then
    RESUME_MODE=1
    START_PAIR=1
    log "auto-resume from existing CSV (STATUS=$prev_st); complete pairs will be skipped"
  fi
fi
if ! echo "$START_PAIR" | grep -qE '^[0-9]+$' || [ "$START_PAIR" -lt 1 ] || [ "$START_PAIR" -gt 12 ]; then
  log "bad START_PAIR=$START_PAIR"
  echo "FAIL_RESUME" > "$STATUS"
  exit 10
fi

if [ ! -f "$CSV" ] || [ ! -s "$CSV" ]; then
  echo "$CSV_HEADER" > "$CSV"
elif [ "$RESUME_MODE" = "1" ]; then
  log "=== RESUME append mode START_PAIR=$START_PAIR ==="
else
  echo "$CSV_HEADER" > "$CSV"
fi

echo "RUNNING" > "$STATUS"
rm -f "$OUTDIR/ABORT_RAM.txt"

SCREEN_PREV=$(settings get system screen_off_timeout 2>/dev/null | tr -d '\r' || echo "")
settings put system screen_off_timeout 7200000 2>/dev/null || true
svc power stayon true 2>/dev/null || true
input keyevent KEYCODE_WAKEUP 2>/dev/null || true

restore() {
  stop_power_sampler
  stop_mem_sampler
  if [ -n "${SCREEN_PREV:-}" ] && [ "$SCREEN_PREV" != "null" ]; then
    settings put system screen_off_timeout "$SCREEN_PREV" 2>/dev/null || true
  fi
  svc power stayon false 2>/dev/null || true
}
trap 'restore; log "trap cleanup"' EXIT

probe_power_source
log "=== SHIP A/B XIAOMI START resume=$RESUME_MODE start_pair=$START_PAIR ==="
log "ARM A: $BIN -m $MODEL -p <p_fact> -n $N_GEN --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think -t 4 --n-expert-used 8"
log "ARM B: $BIN -m $MODEL -p <p_fact> -n $N_GEN --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think -t 2 --n-expert-used 6 --drop-cold-experts 1.0"
log "FLOORS unplugged batt>=${BATT_FLOOR} thermal_abort>43C uptime_max=${UPTIME_MAX_S}s min_wall=${MIN_WALL_S}s min_log=${MIN_LOG_BYTES}B"

if [ "$RESUME_MODE" = "0" ]; then
  refuse_if_not_fresh
fi
record_session_start

preflight_block "$BATT_FLOOR" || { _rc=$?; write_resume_at "$START_PAIR"; recheck_campaign_pin || true; exit "$_rc"; }

if [ "$RESUME_MODE" = "0" ]; then
  run_one 0 B warmup 1 || { _rc=$?; write_resume_at 1; recheck_campaign_pin || true; exit "$_rc"; }
  if [ "$LAST_COMPLETE" != "1" ]; then
    log "FAIL warmup completion -- runtime is not producing measurements; stop before the 24-run sequence"
    echo "FAIL_WARMUP" > "$STATUS"
    recheck_campaign_pin || true
    exit 12
  fi
elif grep -q ',warmup,' "$CSV" 2>/dev/null; then
  log "warmup already in csv, skip"
else
  log "resume without warmup row -- running excluded warmup once"
  run_one 0 B warmup 1 || { _rc=$?; write_resume_at "$START_PAIR"; recheck_campaign_pin || true; exit "$_rc"; }
  if [ "$LAST_COMPLETE" != "1" ]; then
    log "FAIL warmup completion on resume -- runtime is not producing measurements"
    echo "FAIL_WARMUP" > "$STATUS"
    recheck_campaign_pin || true
    exit 12
  fi
fi

VOID_LIST=""
pair=$START_PAIR
while [ "$pair" -le 12 ]; do
  if pair_complete "$pair"; then
    log "skip complete pair=$pair"
    pair=$((pair + 1))
    continue
  fi
  preflight_block "$BATT_FLOOR" || { _rc=$?; write_resume_at "$pair"; recheck_campaign_pin || true; exit "$_rc"; }
  LAST_EXCLUDED=0
  if ! run_pair "$pair"; then
    _rc=$?
    write_resume_at "$pair"
    recheck_campaign_pin || true
    exit "$_rc"
  fi
  if [ "$LAST_EXCLUDED" = "1" ]; then
    VOID_LIST="$VOID_LIST $pair"
  fi
  pair=$((pair + 1))
done

PRIOR_VOID=$(csv_void_pairs)
log "void_scan=$PRIOR_VOID this_cycle_void=$VOID_LIST"
for pair in $PRIOR_VOID; do
  if pair_complete "$pair"; then
    log "skip complete void-scan pair=$pair"
    continue
  fi
  preflight_block "$BATT_FLOOR" || { _rc=$?; write_resume_at "$pair"; recheck_campaign_pin || true; exit "$_rc"; }
  LAST_EXCLUDED=0
  if ! run_pair "$pair"; then
    _rc=$?
    write_resume_at "$pair"
    recheck_campaign_pin || true
    exit "$_rc"
  fi
  if [ "$LAST_EXCLUDED" = "1" ]; then
    log "VOID pair=$pair persisted after append retry"
    write_resume_at "$pair"
    echo "STOP_VOID" > "$STATUS"
    recheck_campaign_pin || true
    exit 11
  fi
done

rm -f "$RESUME_AT"
if ! recheck_campaign_pin; then
  exit 6
fi
echo "DONE" > "$STATUS"
log "=== SHIP A/B XIAOMI COMPLETE ==="
tee -a "$MASTER" < "$CSV"
