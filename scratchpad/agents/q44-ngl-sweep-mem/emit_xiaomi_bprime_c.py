"""Emit LF-only Xiaomi v75 B-prime CPU same-harness cell (c)."""
from pathlib import Path

HERE = Path(__file__).resolve().parent

DRIVER = r'''#!/system/bin/sh
# Xiaomi houji v75 B-prime CPU same-harness (c) -ngl 0. REGISTRA+DICHIARA.
# LF-only. Does not overwrite (a)/(b) artifacts.

BASE=/data/local/tmp/kalsa_bprime_x
BINDIR=/data/local/tmp/kalsahtp
MODEL=/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf
PIN_STUB=5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507
PIN_MODEL=bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419

mkdir -p "$BASE"
echo $$ > "$BASE/c_driver.pid"

log() {
    line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
    echo "$line" >> "$BASE/c_driver.log"
    echo "$line"
}

status() {
    echo "$*" > "$BASE/C_STATUS"
    log "STATUS $*"
}

as_int() {
    v="$1"
    def="$2"
    case "$v" in
        ''|*[!0-9]*) echo "$def" ;;
        *) echo "$v" ;;
    esac
}

batt_temp10() {
    dumpsys battery | awk -F': ' '/^[ ]*temperature:/{print $2; exit}'
}

batt_level() {
    dumpsys battery | awk -F': ' '/^[ ]*level:/{print $2; exit}'
}

dump_header() {
    dest="$1"
    {
        echo "phase=xiaomi_v75_bprime CPU same-harness (c) -ngl 0 REGISTRA+DICHIARA"
        echo "device=houji 23127PN0CG serial=adb-625689a2-9xEOfw._adb-tls-connect._tcp"
        echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "power_declared_below=yes (unplugged required this cell; t/s exploratory)"
        dumpsys battery | grep -E "powered|^  level:|^  temperature:|^  status:|^  plugged:"
        echo "cmd=llama-bench -m MODEL -ngl 0 -p 512 -n 128 -r 2 -o jsonl --load-mode none -fa on --ubatch-size 1024"
        echo "no -dev HTP0, no --no-host (v75 cell1 CPU convention / S23 q46 (c))"
        echo "binary=$BINDIR/llama-bench stub=$PIN_STUB"
        echo "model=$MODEL pin=$PIN_MODEL"
        echo "speed_label=exploratory"
        echo "(d) skipped: -ngl 99 without HTP device is ambiguous on this HTP-linked stub"
    } > "$dest"
}

status "STARTING"
dump_header "$BASE/header_c.txt"

# Cool-start: batt temp <= 35.0 C, poll 60s. Never skip.
while true; do
    level=$(as_int "$(batt_level)" 0)
    temp10=$(as_int "$(batt_temp10)" 9999)
    echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) level=$level temp10=$temp10" >> "$BASE/c_battery_gate.log"
    log "gate (c) level=$level temp10=$temp10"
    if [ "$temp10" -le 350 ]; then
        log "cool-start PASS temp10=$temp10"
        break
    fi
    log "cool-start WAIT temp10=$temp10 > 350; sleep 60"
    sleep 60
done

dump_header "$BASE/header_c_pre.txt"
dumpsys battery > "$BASE/battery_c_pre.txt"

got=$(sha256sum "$BINDIR/llama-bench" | awk '{print $1}')
echo "stub=$got" > "$BASE/c_binary_sha.txt"
if [ "$got" != "$PIN_STUB" ]; then
    status "STOP binary_sha_mismatch"
    exit 10
fi

cd "$BINDIR" || exit 90
export LD_LIBRARY_PATH="$BINDIR:/vendor/lib64:/system/vendor/lib64:/system/lib64"
export ADSP_LIBRARY_PATH="$BINDIR"
export CDSP_LIBRARY_PATH="$BINDIR"
export GGML_HEXAGON_NDEV=1
export GGML_HEXAGON_HOSTBUF=1
unset GGML_HEXAGON_VERBOSE
unset GGML_OPENCL_LOG_ALLOC

log "launch (c) -ngl 0 pp512 tg128 -r 2 (no -dev HTP0, no --no-host)"
./llama-bench -m "$MODEL" -ngl 0 -p 512 -n 128 -r 2 -o jsonl --load-mode none -fa on --ubatch-size 1024 > "$BASE/c_stdout.jsonl" 2> "$BASE/c_stderr.txt"
echo $? > "$BASE/c_rc.txt"
rc=$(as_int "$(cat "$BASE/c_rc.txt")" 99)
dumpsys battery > "$BASE/battery_c_post.txt"
dump_header "$BASE/header_c_post.txt"
log "c rc=$rc"
status "DONE c_rc=$rc"
exit 0
'''

LAUNCH = r'''#!/system/bin/sh
cd /data/local/tmp/kalsa_bprime_x || exit 90
setsid sh -c 'nohup sh /data/local/tmp/kalsa_bprime_x/c_driver.sh </dev/null >/data/local/tmp/kalsa_bprime_x/c_driver.out 2>&1 & echo $! > /data/local/tmp/kalsa_bprime_x/c_setsid.pid'
cat /data/local/tmp/kalsa_bprime_x/c_setsid.pid
'''

def emit(name: str, text: str) -> None:
    data = text.replace("\r\n", "\n").replace("\r", "\n")
    if not data.endswith("\n"):
        data += "\n"
    raw = data.encode("utf-8")
    if b"\r" in raw:
        raise SystemExit(f"CR survived in {name}")
    (HERE / name).write_bytes(raw)
    print(f"wrote {name} bytes={len(raw)}")

emit("xiaomi_bprime_c_driver.sh", DRIVER)
emit("xiaomi_bprime_c_launch.sh", LAUNCH)
