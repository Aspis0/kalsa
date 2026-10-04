# gate-G env: device-side paths, arm definitions and guard-rail gates.
# Source on the phone in ONE adb shell: . /data/local/tmp/govhtp/gate-g/env.sh
# Gate functions copied from s23-onecopy-abba-df538c50c/raw/env.sh and
# onecopy-hmx-numerics/raw/vtcm-relayout/device/env.sh (both proven on this phone).

R=/data/local/tmp/govhtp
D=$R/gate-g                     # this build: bin/ + dsp/ pushed as a PAIR by push-and-check.sh
M=/data/local/tmp/heat3way/ship.gguf
FIXT=$R/input/kld_english_fixture.txt
BASELOGITS=$R/input/cause-cpu-base.logits
export LD_LIBRARY_PATH=$R/lib

# Arm A: today's two-copy NPU - HTP device buffer, mmap as shipped (no env, no -lm flag).
# Arm B: tiled HOST one-copy - weights packed into tiles in the HTP0-HOST buffer by
# host set_tensor (GGML_HEXAGON_HOSTBUF_REPACK), which requires no-mmap loading (-lm none):
# with mmap the loader moves host-buft weights to CPU memory, and without the loader fix the
# file is read_raw'ed into the host buffer, bypassing set_tensor entirely. With -ngl 99 the
# loader puts layer weights in the HTP0 device buft; -ot moves the Q4_0 matrices to HTP0-HOST. Small f32
# norm/conv weights stay in the device buft: in a host buft their batch-1 ops fall to the CPU (198 splits).
ARM_A_ENV=""
ARM_B_ENV="GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1"
ARM_B_LOAD="-lm none -ot proj.weight|ffn_gate|ffn_up|ffn_down|attn_q.weight|attn_k.weight|attn_v.weight|attn_output=HTP0-HOST"

# Proof runs need the per-op kernel tag (profile-op line, kparams column) and the DSP FARF
# stream; the farf mask file gates FARF(HIGH) at runtime and is removed after the proof passes
# so the timed arms run without it.
PROF_ENV="GGML_HEXAGON_PROFILE=1 GGML_HEXAGON_VERBOSE=1"
FARF_FILE=$D/dsp/llama-bench.farf
# Timed arms load a release skel: the debug skel (HTP_DEBUG=1, no NDEBUG) measured both arms at
# pp512 503 / tg128 9.1 vs the 876 / 22.1 two-copy reference (session 2).
DSP_REL=$D/dsp-rel

# Bench arms: -t 5 like the two-copy reference (876 / 22.1, s23-onecopy-abba-df538c50c); at -t 1 the CPU
# lm_head dominates decode and would hide an NPU slowdown (first session: A 9.09, B 9.08 tg128).
BENCH_ARGS="-m $M -p 512 -n 128 -ub 512 -r 3 -t 5 -ngl 99 -dev HTP0"
# KLD arms byte-for-byte from s23-onecopy-abba-df538c50c/raw/kld.sh, only the arm env varies.
KLD_ARGS="-f $FIXT -c 512 -b 512 -ub 1 -ngl 99 -dev HTP0 --no-warmup --chunks 2 --kl-divergence-base $BASELOGITS --kl-divergence -lv 5"

COOL_MAX_TEMP=330     # tenths of a degree C: never start an arm above 33.0 C
COOL_TRIES=20         # give up after COOL_TRIES * COOL_SLEEP = 10 min, never run hot
COOL_SLEEP=30
BATT_MIN=30           # % battery: session preflight and every arm gate
MAX_SPLITS=4         # arm A has 2; more means ops on tiled weights left the NPU
ERRPAT='dsp-error|NO-SUPPORT|CRASH|GGML_ABORT|Segmentation'

st() { dumpsys battery | grep 'Sending ACTION_BATTERY_CHANGED' | tail -1 | sed -nE 's/.*level:([0-9]+),.*ac:([a-z]+),.*usb:([a-z]+),.*wireless:([a-z]+),.*temperature:([0-9]+),.*/lvl=\1 ac=\2 usb=\3 wl=\4 batT=\5/p' | tr -d '\n'; sk=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'); echo -n " skin=$sk wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2) thermal=$(dumpsys thermalservice | grep '^Thermal Status' | tail -1 | sed -nE 's/.*: ([0-9]+).*/\1/p') traced=$(getprop persist.traced.enable)"; }

# session gates: battery >= BATT_MIN, unplugged, screen on (awake), thermal 0, no traced.
# Returns 1 (caller aborts) instead of falling through.
session_gates() {
  st_full=$(dumpsys battery | grep 'Sending ACTION_BATTERY_CHANGED' | tail -1)
  lvl=$(printf '%s' "$st_full" | sed -nE 's/.*level:([0-9]+),.*/\1/p')
  ac=$(printf '%s' "$st_full"  | sed -nE 's/.*ac:([a-z]+),.*/\1/p')
  usb=$(printf '%s' "$st_full" | sed -nE 's/.*usb:([a-z]+),.*/\1/p')
  wl=$(printf '%s' "$st_full"  | sed -nE 's/.*wireless:([a-z]+),.*/\1/p')
  wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2)
  thermal=$(dumpsys thermalservice | grep '^Thermal Status' | tail -1 | sed -nE 's/.*: ([0-9]+).*/\1/p')
  traced=$(getprop persist.traced.enable)
  why=
  [ "${lvl:-0}" -ge $BATT_MIN ] || why="$why battery=${lvl:-?}<$BATT_MIN"
  [ "$ac" = false ] && [ "$usb" = false ] && [ "$wl" = false ] || why="$why plugged(ac=$ac usb=$usb wl=$wl)"
  [ "$wake" = Awake ] || why="$why not-awake=$wake"
  [ "${thermal:-9}" = 0 ] || why="$why thermal=$thermal"
  [ "$traced" = 0 ] || why="$why traced=$traced"
  if [ -n "$why" ]; then
    echo "GATE-FAIL: $why" | tee -a $D/gateg_report.txt
    return 1
  fi
  return 0
}

# waitcool: block until battery temp <= COOL_MAX_TEMP tenths; FAIL after the budget
# (a hot arm is never run - the df538c50c ABBA had to rerun three arms that overshot).
waitcool() {
  i=0
  while [ $i -lt $COOL_TRIES ]; do
    t=$(dumpsys battery | grep -m1 'temperature' | sed -nE 's/.*temperature: ([0-9]+).*/\1/p')
    [ "${t:-999}" -le $COOL_MAX_TEMP ] && return 0
    input keyevent 224   # the session runs with the screen on, including during the wait
    sleep $COOL_SLEEP; i=$((i + 1))
  done
  echo "waitcool: battery ${t:-unknown} tenths > $COOL_MAX_TEMP after $((COOL_TRIES * COOL_SLEEP / 60)) min - refusing to start the arm" | tee -a $D/gateg_report.txt
  return 1
}
