#!/usr/bin/env bash
# =============================================================================
# run_fio_bench.sh — random-read UFS characterization for MoE campaign (F2.1)
#
# Measures random read bandwidth on a large file under Termux home (never /sdcard).
# Writes ONE CSV row per (bs, iodepth, rep) to a dedicated fio results file.
# Does NOT invent llama timing fields.
#
# Uso (Termux):
#   bash scripts/run_fio_bench.sh
#   bash scripts/run_fio_bench.sh --size 2G --reps 3
#   bash scripts/run_fio_bench.sh --dry-run
#
# Env:
#   FIO_CSV=path        default: $HOME/experiments/results/fio_runs.csv
#   FIO_DATA=path       default: $HOME/experiments/fio/fio_randread.bin
#   FIO_BIN=fio         path to fio
#   SKIP_BATTERY=1      only for dry tooling (never scientific)
#
# Exit: 0=ok · 3=usage · 4=charging · 5=too hot · 6=fio missing · 7=battery gate
# =============================================================================

set -euo pipefail
export LC_ALL=C

SIZE="2G"
REPS=3
RUNTIME_S=20
DRY_RUN=0
ALLOW_NO_BATTERY=0
PHASE="F2.1"
NOTES_USER=""
CSV_PATH="${FIO_CSV:-$HOME/experiments/results/fio_runs.csv}"
DATA_PATH="${FIO_DATA:-$HOME/experiments/fio/fio_randread.bin}"
FIO_BIN="${FIO_BIN:-fio}"
MAX_START_TEMP="32.0"

# block sizes and iodepths (PLAN F2.1)
BS_LIST="4k 16k 64k 256k 1m"
IODEPTH_LIST="1 4"

usage() {
    cat <<'EOF' >&2
Uso: run_fio_bench.sh [opzioni]

  --size SIZE         file di test (default 2G)
  --reps N            ripetizioni per (bs,iodepth) (default 3)
  --runtime SEC       durata per job fio (default 20)
  --csv PATH          output CSV
  --data PATH         path file di test
  --fio PATH          binario fio
  --notes TEXT
  --dry-run           crea file se manca, stampa job, non misura
  --allow-no-battery  solo smoke
  -h, --help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --size) SIZE="${2:-}"; shift 2 ;;
        --reps) REPS="${2:-}"; shift 2 ;;
        --runtime) RUNTIME_S="${2:-}"; shift 2 ;;
        --csv) CSV_PATH="${2:-}"; shift 2 ;;
        --data) DATA_PATH="${2:-}"; shift 2 ;;
        --fio) FIO_BIN="${2:-}"; shift 2 ;;
        --notes) NOTES_USER="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --allow-no-battery) ALLOW_NO_BATTERY=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "arg sconosciuto: $1" >&2; usage; exit 3 ;;
    esac
done

read_battery() {
    if ! command -v termux-battery-status >/dev/null 2>&1; then
        echo ""
        return 1
    fi
    _json="$(termux-battery-status 2>/dev/null)" || { echo ""; return 1; }
    [ -n "$_json" ] || { echo ""; return 1; }
    if command -v jq >/dev/null 2>&1; then
        _plugged="$(printf '%s\n' "$_json" | jq -r '.plugged // empty' 2>/dev/null)"
        _temp_raw="$(printf '%s\n' "$_json" | jq -r '.temperature // empty' 2>/dev/null)"
    else
        _plugged="$(printf '%s\n' "$_json" | sed -n 's/.*"plugged"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
        _temp_raw="$(printf '%s\n' "$_json" | sed -n 's/.*"temperature"[[:space:]]*:[[:space:]]*\([0-9.][0-9.]*\).*/\1/p' | head -n1)"
    fi
    if [ -z "$_temp_raw" ]; then
        _temp_c=""
    else
        _temp_c="$(awk -v t="$_temp_raw" 'BEGIN{
            if (t+0 > 100) printf "%.1f", t/10.0;
            else printf "%.1f", t+0;
        }')"
    fi
    echo "${_plugged} ${_temp_c}"
    return 0
}

gate_battery() {
    _bat="$(read_battery || true)"
    if [ -z "$_bat" ]; then
        if [ "$ALLOW_NO_BATTERY" = "1" ] || [ "$DRY_RUN" = "1" ]; then
            echo "WARN: battery gate unavailable (allow/dry)" >&2
            BATT_PLUGGED="UNKNOWN"
            BATT_TEMP=""
            return 0
        fi
        echo "ERROR: gate batteria non disponibile" >&2
        exit 7
    fi
    BATT_PLUGGED="$(printf '%s' "$_bat" | awk '{print $1}')"
    BATT_TEMP="$(printf '%s' "$_bat" | awk '{print $2}')"
    case "$BATT_PLUGGED" in
        UNPLUGGED) ;;
        *)
            if [ "$ALLOW_NO_BATTERY" = "1" ] || [ "$DRY_RUN" = "1" ]; then
                echo "WARN: plugged=$BATT_PLUGGED (allow/dry)" >&2
            else
                echo "ERROR: misure invalide in carica (plugged=$BATT_PLUGGED)" >&2
                exit 4
            fi
            ;;
    esac
    if [ -n "$BATT_TEMP" ]; then
        _hot="$(awk -v t="$BATT_TEMP" -v m="$MAX_START_TEMP" 'BEGIN{print (t+0 > m+0) ? 1 : 0}')"
        if [ "$_hot" = "1" ]; then
            echo "ERROR: temperatura iniziale ${BATT_TEMP}°C > ${MAX_START_TEMP}°C" >&2
            exit 5
        fi
    fi
}

ensure_header() {
    mkdir -p "$(dirname "$CSV_PATH")"
    if [ ! -f "$CSV_PATH" ]; then
        printf '%s\n' \
"run_id,date,phase,bs,iodepth,rep,size,runtime_s,bw_kib_s,bw_mib_s,iops,lat_mean_us,lat_p99_us,batt_temp_start,batt_temp_end,plugged,data_path,notes" \
            >"$CSV_PATH"
    fi
}

size_to_bytes() {
    # 2G / 2048M / 2147483648
    awk -v s="$1" 'BEGIN{
        n=s+0; u=s; gsub(/[0-9.]/,"",u);
        if (u=="" || u=="B" || u=="b") { printf "%.0f", n; exit }
        if (u=="K" || u=="k" || u=="KiB") { printf "%.0f", n*1024; exit }
        if (u=="M" || u=="m" || u=="MiB") { printf "%.0f", n*1024*1024; exit }
        if (u=="G" || u=="g" || u=="GiB") { printf "%.0f", n*1024*1024*1024; exit }
        printf "%.0f", n;
    }'
}

ensure_data_file() {
    mkdir -p "$(dirname "$DATA_PATH")"
    _need="$(size_to_bytes "$SIZE")"
    _have=0
    _marker="${DATA_PATH}.materialized"
    if [ -f "$DATA_PATH" ]; then
        _have="$(stat -c %s "$DATA_PATH" 2>/dev/null || wc -c <"$DATA_PATH" | tr -d ' ')"
    fi
    # fallocate/sparse zeros on Android give fake multi-GB/s (zero pages).
    # Require full non-sparse write (marker) so random reads hit UFS.
    if [ "$_have" -ge "$_need" ] 2>/dev/null && [ -f "$_marker" ]; then
        echo "data file OK (materialized): $DATA_PATH ($_have bytes)" >&2
        return 0
    fi
    echo "creating NON-SPARSE data file $DATA_PATH size=$SIZE (need $_need bytes)..." >&2
    _mib=$((_need / 1024 / 1024))
    if [ "$_mib" -lt 1 ]; then _mib=1; fi
    dd if=/dev/zero of="$DATA_PATH" bs=1M count="$_mib" conv=fsync status=progress 2>&1 || \
      dd if=/dev/zero of="$DATA_PATH" bs=1048576 count="$_mib" conv=fsync 2>&1
    _have="$(stat -c %s "$DATA_PATH" 2>/dev/null || echo 0)"
    if [ "$_have" -lt "$_need" ] 2>/dev/null; then
        echo "ERROR: data file troppo piccolo ($_have < $_need)" >&2
        exit 1
    fi
    date -Iseconds 2>/dev/null >"$_marker" || date >"$_marker"
    echo "data file ready (materialized): $_have bytes" >&2
}

if ! command -v "$FIO_BIN" >/dev/null 2>&1; then
    echo "ERROR: fio non trovato (FIO_BIN=$FIO_BIN)" >&2
    exit 6
fi

ensure_header
ensure_data_file

if [ "$DRY_RUN" = "1" ]; then
    echo "DRY-RUN: would run bs={$BS_LIST} iodepth={$IODEPTH_LIST} reps=$REPS runtime=${RUNTIME_S}s" >&2
    echo "fio=$("$FIO_BIN" --version 2>&1 | head -1)" >&2
    echo "csv=$CSV_PATH data=$DATA_PATH" >&2
    exit 0
fi

echo "=== F2.1 fio random-read ===" >&2
echo "fio=$("$FIO_BIN" --version 2>&1 | head -1)" >&2
echo "csv=$CSV_PATH data=$DATA_PATH" >&2

for bs in $BS_LIST; do
    for qd in $IODEPTH_LIST; do
        for rep in $(seq 1 "$REPS"); do
            gate_battery
            _t0="$BATT_TEMP"
            _pl0="$BATT_PLUGGED"
            _ts="$(date +%Y%m%d-%H%M%S 2>/dev/null || date +%s)"
            _rid="fio-${bs}-qd${qd}-r${rep}-${_ts}"
            _jobdir="$(dirname "$DATA_PATH")/jobs"
            mkdir -p "$_jobdir"
            _outj="$_jobdir/${_rid}.json"
            _outlog="$_jobdir/${_rid}.log"
            echo "RUN $_rid bs=$bs iodepth=$qd rep=$rep temp=${_t0} plugged=${_pl0}" >&2
            _run_notes="$NOTES_USER"

            # iodepth>1 needs async engine; psync is always depth 1.
            # Prefer io_uring on Android; fallback psync.
            _eng="psync"
            if [ "$qd" -gt 1 ] 2>/dev/null; then
                _eng="io_uring"
            fi
            set +e
            "$FIO_BIN" \
                --name="randread_${bs}_qd${qd}" \
                --filename="$DATA_PATH" \
                --rw=randread \
                --bs="$bs" \
                --iodepth="$qd" \
                --ioengine="$_eng" \
                --direct=1 \
                --invalidate=1 \
                --numjobs=1 \
                --runtime="$RUNTIME_S" \
                --time_based=1 \
                --group_reporting=1 \
                --output-format=json \
                --output="$_outj" \
                >"$_outlog" 2>&1
            _ec=$?
            if [ "$_ec" -ne 0 ] && [ "$_eng" = "io_uring" ]; then
                echo "WARN: io_uring failed, fallback psync" >&2
                "$FIO_BIN" \
                    --name="randread_${bs}_qd${qd}_psync" \
                    --filename="$DATA_PATH" \
                    --rw=randread \
                    --bs="$bs" \
                    --iodepth=1 \
                    --ioengine=psync \
                    --direct=1 \
                    --invalidate=1 \
                    --numjobs=1 \
                    --runtime="$RUNTIME_S" \
                    --time_based=1 \
                    --group_reporting=1 \
                    --output-format=json \
                    --output="$_outj" \
                    >"$_outlog" 2>&1
                _ec=$?
                _run_notes="${_run_notes:+$_run_notes;}io_uring_fallback_psync"
            fi
            set -e

            _bat_end="$(read_battery || true)"
            _t1="$(printf '%s' "$_bat_end" | awk '{print $2}')"
            _pl1="$(printf '%s' "$_bat_end" | awk '{print $1}')"

            _bw_kib=""; _iops=""; _lat=""; _p99=""
            if [ -f "$_outj" ] && command -v python3 >/dev/null 2>&1; then
                # shellcheck disable=SC2016
                _parsed="$(python3 - "$_outj" <<'PY'
import json,sys
p=sys.argv[1]
try:
    raw=open(p,errors="replace").read()
    i=raw.find("{")
    d=json.loads(raw[i:] if i>=0 else raw)
    j=d["jobs"][0]
    r=j.get("read",{})
    bw=r.get("bw")  # KiB/s in fio
    iops=r.get("iops")
    lat=r.get("lat_ns",{}).get("mean")
    if lat is None:
        lat=r.get("clat_ns",{}).get("mean")
    p99=None
    pct=r.get("clat_ns",{}).get("percentile") or r.get("lat_ns",{}).get("percentile") or {}
    for k in ("99.000000","99.0","99"):
        if k in pct:
            p99=pct[k]; break
    def f(x):
        if x is None: return ""
        try: return f"{float(x):.3f}".rstrip("0").rstrip(".") if abs(float(x))>=1 else f"{float(x):.6f}"
        except: return str(x)
    lat_us = (float(lat)/1000.0) if lat is not None else None
    p99_us = (float(p99)/1000.0) if p99 is not None else None
    print(f"{bw if bw is not None else ''}|{iops if iops is not None else ''}|{lat_us if lat_us is not None else ''}|{p99_us if p99_us is not None else ''}")
except Exception as e:
    print("|||")
    sys.stderr.write(f"parse fail: {e}\n")
PY
)"
                _bw_kib="$(printf '%s' "$_parsed" | cut -d'|' -f1)"
                _iops="$(printf '%s' "$_parsed" | cut -d'|' -f2)"
                _lat="$(printf '%s' "$_parsed" | cut -d'|' -f3)"
                _p99="$(printf '%s' "$_parsed" | cut -d'|' -f4)"
            fi

            _bw_mib=""
            if [ -n "$_bw_kib" ]; then
                _bw_mib="$(awk -v k="$_bw_kib" 'BEGIN{printf "%.3f", (k+0)/1024.0}')"
            fi

            _notes="$_run_notes"
            if [ "$_ec" -ne 0 ]; then
                _notes="${_notes:+$_notes;}FAIL rc=$_ec"
            fi
            # sanitize notes for CSV
            _notes="$(printf '%s' "$_notes" | tr ',\n' '; ')"

            _date="$(date -Iseconds 2>/dev/null || date)"
            printf '%s\n' \
"${_rid},${_date},${PHASE},${bs},${qd},${rep},${SIZE},${RUNTIME_S},${_bw_kib},${_bw_mib},${_iops},${_lat},${_p99},${_t0},${_t1},${_pl0},${DATA_PATH},${_notes}" \
                >>"$CSV_PATH"

            echo "  -> bw_mib_s=${_bw_mib} iops=${_iops} lat_us=${_lat} ec=${_ec} temp=${_t0}->${_t1}" >&2
            if [ "$_ec" -ne 0 ]; then
                echo "WARN: fio exit $_ec for $_rid (row written)" >&2
            fi
            # brief cool-down between jobs
            sleep 2
        done
    done
done

echo "=== F2.1 complete → $CSV_PATH ===" >&2
# print medians summary if python available
if command -v python3 >/dev/null 2>&1; then
    python3 - "$CSV_PATH" <<'PY'
import csv,sys,statistics
from collections import defaultdict
path=sys.argv[1]
rows=[]
with open(path,newline='') as f:
    for r in csv.DictReader(f):
        if r.get('phase')!='F2.1':
            continue
        try:
            r['_bw']=float(r['bw_mib_s']) if r.get('bw_mib_s') else None
        except: r['_bw']=None
        rows.append(r)
g=defaultdict(list)
for r in rows:
    if r['_bw'] is not None:
        g[(r['bs'],r['iodepth'])].append(r['_bw'])
print("median bw_mib_s by (bs,iodepth):")
for k in sorted(g.keys(), key=lambda x:(['4k','16k','64k','256k','1m'].index(x[0]) if x[0] in ['4k','16k','64k','256k','1m'] else 99, int(x[1]))):
    vals=sorted(g[k])
    med=statistics.median(vals)
    print(f"  bs={k[0]:4s} qd={k[1]}  n={len(vals)}  median={med:.3f} MiB/s  vals={','.join(f'{v:.3f}' for v in vals)}")
PY
fi
exit 0
