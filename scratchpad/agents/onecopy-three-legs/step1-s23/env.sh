# step-1 env: device-side paths, arm definitions and guard-rail gates.
# Source on the phone in ONE adb shell: . /data/local/tmp/govhtp/step1-s23/env.sh
# Gate functions (st, session_gates, waitcool) copied from the proven gate-g/env.sh, same phone,
# same constants; only the report file name and the arm table are step-1 specific.

R=/data/local/tmp/govhtp
D=$R/step1-s23                     # this build: bin/ + dsp/ pushed as a PAIR by push-and-check.sh
M=/data/local/tmp/heat3way/ship.gguf
FIXT=$R/input/kld_english_fixture.txt
BASELOGITS=$R/input/cause-cpu-base.logits
export LD_LIBRARY_PATH=$R/lib
REPORT=$D/step1_report.txt

# NPU A: today's two-copy NPU - HTP0 device buffer, mmap as shipped, no env, no -ot.
# NPU T: one copy in the extra non-host TILE32 buft. GGML_HEXAGON_HOSTBUF_REPACK=1 is the only
# switch needed: it exposes HTP0-TILE32 through ggml_backend_dev_get_extra_bufts
# (ggml-hexagon.cpp:7194-7202) and llama's placement probe then puts every 2-D Q4_0 MUL_MAT
# weight there by itself. GGML_HEXAGON_HOSTBUF is NOT needed: it only enables the device HOST
# buft (ggml-hexagon.cpp:6584-6588), which the probe never selects - HOST is reachable only
# through a `-ot ...=HTP0-HOST` override. `-lm none` is NOT needed: TILE32 is not the device
# default buft, so llama_model::load_tensors allocates it for real (llama-model.cpp:1771,1778)
# and load_all_data takes the ggml_backend_tensor_set branch (llama-model-loader.cpp:1650-1664)
# under mmap too; with the HTP device present and load mode AUTO, mmap is off anyway
# (props.caps.mmap_support = false, ggml-hexagon.cpp:6574; llama-model.cpp:1446-1452).
#
# C-tile: the same Q4_0 matrices in TILE32, but placed by an explicit -ot override and computed
# on the CPU. GGML_HEXAGON_OPFILTER='.*' makes the HTP decline every op, which (a) sends norms,
# conv and token_embd to the CPU (and -nkvo in the flags keeps the KV leaf there too) and (b) lets
# backend_from_buffer pick the CPU for a MUL_MAT whose weight sits in the TILE32 buffer
# (ggml-backend.cpp:897-910; ggml-cpu.cpp:441,490).
# The -ot override is mandatory: the placement probe calls the same HTP supports_op that OPFILTER
# short-circuits (llama-model-loader.cpp:1049-1052, ggml-hexagon.cpp:6722), while an override
# assigns overrides->buft directly and skips the probe (llama-model-loader.cpp:1243).
#
# Arm environments are command prefixes, not assignment strings: the OPFILTER value is the regex
# .*. A value kept in a variable would arrive at env either still wearing the quotes that were
# typed inside the variable, or with its * pathname-expanded where the variable is expanded
# unquoted. Quoting the value in these functions keeps both out of the shell's hands.
arm_env_repack() { env GGML_HEXAGON_HOSTBUF_REPACK=1 "$@"; }
arm_env_tile()   { env GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_OPFILTER='.*' "$@"; }

ARM_A_ENV="env"                 # two-copy NPU: no env at all
ARM_A_LOAD=""
ARM_T_ENV="arm_env_repack"      # one-copy NPU: TILE32 by the probe, REPACK only
ARM_T_LOAD=""
ARM_CT_ENV="arm_env_tile"       # C-tile: TILE32 by -ot, every HTP op declined

# C-tile load flags. The -ot pattern is gate G's (gate-g/env.sh ARM_B_LOAD; 166 Q4_0 matrices =
# 1369571328 B in onecopy-three-legs/REPORT.md), only the buft changes HOST -> TILE32. It holds no
# shell glob character, so the unquoted expansion of these variables is safe (gate G passed the
# same pattern the same way). HTP0-TILE32 parses because the -ot buft map now enumerates each
# device's extra bufts (common/arg.cpp:266-280, llama-bench.cpp:957-972).
CTILE_OT="-ot proj.weight|ffn_gate|ffn_up|ffn_down|attn_q.weight|attn_k.weight|attn_v.weight|attn_output=HTP0-TILE32"
# llama-bench's own parser consumes a value for -nkvo (llama-bench.cpp:842-848); the common
# parser takes -nkvo as a negated flag (common/arg.cpp:2428-2435), so the two families differ there.
CTILE_BENCH_FLAGS="-ngl 99 -dev HTP0 -nkvo 1 $CTILE_OT"
CTILE_KLD_FLAGS="-ngl 99 -dev HTP0 -nkvo $CTILE_OT"

# CPU arms at -ngl 0, the shipped S23 CPU decode path (n_gpu_layers = 0, no_extra_bufts;
# llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp). C-native disables the repack buft with
# llama-bench's -nr (params.no_repack -> mparams.use_extra_bufts = !no_repack,
# llama-bench.cpp:912-914,1270); C-repack is the engine default (the CPU_REPACK extra buft is
# added to the CPU buft list only when use_extra_bufts, llama-model.cpp:1092-1110). C-tile is the
# same bench with the Q4_0 weights in HTP0-TILE32 and every HTP op refused; its remaining CPU
# tensors (f32 norms/conv, Q6_K token_embd) are declined by CPU_REPACK too (that buft supports
# only 2-D MUL_MAT weights in its own buffer, ggml-cpu/repack.cpp:5408-5439), so they stay native.
CPU_BENCH_ARGS="-m $M -p 128 -n 128 -ub 128 -r 3"
CPU_C_NATIVE_FLAGS="-ngl 0 -nr"
CPU_C_REPACK_FLAGS="-ngl 0"
CPU_T1=1
CPU_T5=5

# Proof runs need the per-op kernel tag (profile-op line, kparams column) and the DSP FARF
# stream; the farf mask file gates FARF(HIGH) at runtime and is removed after the proof passes
# so the timed arms run without it.
PROF_ENV="GGML_HEXAGON_PROFILE=1 GGML_HEXAGON_VERBOSE=1"
FARF_FILE=$D/dsp/llama-bench.farf
# Timed arms load a release skel: the debug skel (HTP_DEBUG=1, no NDEBUG) measured both arms at
# pp512 503 / tg128 9.1 vs the 876 / 22.1 two-copy reference (session 2); the two skel hashes
# are gate-G's 61c8d6f5 (release) and d40e98c6 (debug).
DSP_REL=$D/dsp-rel

# NPU bench arms: -t 5 like the two-copy reference (876 / 22.1, s23-onecopy-abba-df538c50c); at
# -t 1 the CPU lm_head dominates decode and would hide an NPU slowdown.
BENCH_ARGS="-m $M -p 512 -n 128 -ub 512 -r 3 -t 5 -ngl 99 -dev HTP0"
# NPU KLD arms byte-for-byte from s23-onecopy-abba-df538c50c/raw/kld.sh, only the arm env varies.
KLD_ARGS="-f $FIXT -c 512 -b 512 -ub 1 -ngl 99 -dev HTP0 --no-warmup --chunks 2 --kl-divergence-base $BASELOGITS --kl-divergence -lv 5"
# CPU KLD: same flags without the device; -t 5 because KLD is a correctness gate, not a timing
# (gate G ran one KLD per timed leg; here C-native, C-repack and C-tile are compared). The arm's
# device flags (-ngl 0 / the C-tile flags) are passed by the caller.
KLD_ARGS_CPU="-f $FIXT -c 512 -b 512 -ub 1 -t 5 --no-warmup --chunks 2 --kl-divergence-base $BASELOGITS --kl-divergence -lv 5"

COOL_MAX_TEMP=330     # tenths of a degree C: never start an arm above 33.0 C battery
COOL_TRIES=20         # give up after COOL_TRIES * COOL_SLEEP = 10 min, never run hot
COOL_SLEEP=30
BATT_MIN=30           # % battery: session preflight and every arm gate
MAX_SPLITS=4          # arm A has 2; more means ops on tiled weights left the NPU
# Arm T places the 166 Q4_0 MUL_MAT matrices of ship.gguf; gate G packed the same set at
# 1369571328 B = 1306.1 MiB. A floor, not an equality: the bytes are the coordinator's cross-check.
TILE_MIN_MIB=1000
# gate G's HOST-REPACK tensor count for the same -ot pattern; the C-tile proof reports the count
# of weight tensors it saw, this is the expected one (a mismatch is a coordinator question).
TILE_REF_TENSORS=166
ERRPAT='dsp-error|NO-SUPPORT|CRASH|GGML_ABORT|Segmentation'

st() { dumpsys battery | grep 'Sending ACTION_BATTERY_CHANGED' | tail -1 | sed -nE 's/.*level:([0-9]+),.*ac:([a-z]+),.*usb:([a-z]+),.*wireless:([a-z]+),.*temperature:([0-9]+),.*/lvl=\1 ac=\2 usb=\3 wl=\4 batT=\5/p' | tr -d '\n'; sk=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'); echo -n " skin=$sk wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2) thermal=$(dumpsys thermalservice | grep '^Thermal Status' | tail -1 | sed -nE 's/.*: ([0-9]+).*/\1/p') traced=$(getprop persist.traced.enable)"; }

# session gates: battery >= BATT_MIN, unplugged, screen on (awake), no traced.
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
  # thermal status is waited out in waitcool (step-1 session 1 aborted on a transient status 1)
  [ "$traced" = 0 ] || why="$why traced=$traced"
  if [ -n "$why" ]; then
    echo "GATE-FAIL: $why" | tee -a $REPORT
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
    th=$(dumpsys thermalservice | grep '^Thermal Status' | tail -1 | sed -nE 's/.*: ([0-9]+).*/\1/p')
    [ "${t:-999}" -le $COOL_MAX_TEMP ] && [ "${th:-9}" = 0 ] && return 0
    input keyevent 224   # the session runs with the screen on, including during the wait
    sleep $COOL_SLEEP; i=$((i + 1))
  done
  echo "waitcool: battery ${t:-unknown} tenths (max $COOL_MAX_TEMP), thermal ${th:-unknown} (need 0) after $((COOL_TRIES * COOL_SLEEP / 60)) min - refusing to start the arm" | tee -a $REPORT
  return 1
}
