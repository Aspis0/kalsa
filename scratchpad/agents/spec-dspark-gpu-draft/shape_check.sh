#!/usr/bin/env bash
# shape_check.sh [calib-dir] — AUDIT5 item-4: compare every line shape the
# cell's parsers depend on against the REAL f25f0c1c5 S23 logs (same ship
# model, cell qdc-heat-3way raw/s23-calib-3/calib), prove the parsers survive
# their non-UTF-8 bytes, and diff the fake's emitted shapes against the real
# ones. Prints MATCH / MISMATCH / NOT-IN-LOGS / ABSENT-HEALTHY / INFO per
# pattern; exits 1 on any MISMATCH, 0 otherwise. Read-only on the given dir.
set -euo pipefail
export LC_ALL=C
CELL="$(cd "$(dirname "$0")" && pwd)"
DIR="${1:-/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-heat-3way/raw/s23-calib-3/calib}"
CPU_L="$DIR/s23-calib-3-calcpu.load.log"   # -lv 5: DEBUG placement exists
GPU_L="$DIR/s23-calib-3-calgpu.load.log"   # -lv 5 + env kernels
CPU_T="$DIR/s23-calib-3-calcpu.log"        # -lv 4: turn verbosity
GPU_T="$DIR/s23-calib-3-calgpu.log"        # -lv 4
for f in "$CPU_L" "$GPU_L" "$CPU_T" "$GPU_T"; do
  [ -f "$f" ] || { echo "MISSING $f" >&2; exit 2; }
done
FAILS=0
row() { printf '%-50s %s\n' "$1" "$2"; }
ok()   { row "$1" "$2"; }
bad()  { row "$1" "MISMATCH — $2"; FAILS=$((FAILS + 1)); }
cnt()  { grep -a -E -c "$1" "$2" 2>/dev/null || true; }   # -a: binary bytes; -E: ERE (BSD grep BRE has no +)

echo "== shapes the parsers depend on, vs the real S23 logs =="

# 1. draft-load marker (arm_parse_proof/measure): spec-simple only.
if [ "$(cnt 'common_speculative_init_result: loading draft model' "$CPU_T")" = 0 ]; then
  row "draft-load marker" "NOT-IN-LOGS (llama-speculative-simple only; host-verified in raw/calib_armA127.log)"
fi

# 2. placement DEBUG lines: must exist at -lv 5 and be ABSENT at -lv 4.
n5l=$(cnt 'load_tensors: layer .* assigned to device' "$CPU_L")
n5g=$(cnt 'load_tensors: layer .* assigned to device' "$GPU_L")
n4l=$(cnt 'load_tensors: layer .* assigned to device' "$CPU_T")
n4g=$(cnt 'load_tensors: layer .* assigned to device' "$GPU_T")
if [ "$n5l" -ge 1 ] && [ "$n5g" -ge 1 ] && [ "$n4l" = 0 ] && [ "$n4g" = 0 ]; then
  ok "assigned-to-device (proof -lv5 / turn -lv4)" "MATCH ($n5l/$n5g present at -lv 5, 0 at -lv 4)"
else bad "assigned-to-device" "lv5=$n5l,$n5g lv4=$n4l,$n4g"; fi
if [ "$(cnt 'assigned to device CPU' "$CPU_L")" -ge 1 ] && [ "$(cnt 'assigned to device GPUOpenCL' "$GPU_L")" -ge 1 ]; then
  ok "assigned variants CPU/GPUOpenCL" "MATCH"
else bad "assigned variants" "missing in -lv 5 load logs"; fi

# 3. INFO placement lines: must be ADMITTED at -lv 4 (the N-C2 question).
nb=$(cnt 'model buffer size' "$CPU_T")
nbg=$(cnt 'model buffer size' "$GPU_T")
if [ "$nb" -ge 1 ] && [ "$nbg" -ge 1 ]; then
  ok "model buffer size at -lv 4 (turns)" "MATCH ($nb cpu, $nbg gpu — -lv 4 admits INFO on the S23)"
else bad "model buffer size at -lv 4" "cpu=$nb gpu=$nbg"; fi

# 4. offload lines: 0/N excluded by the parser regex, N>=1 accepted.
no0=$(cnt 'offloaded 0/31 layers to GPU' "$CPU_T")
nNN=$(cnt 'offloaded [1-9][0-9]*/[0-9]+ layers to GPU' "$GPU_T")
if [ "$no0" -ge 1 ] && [ "$nNN" -ge 1 ] && [ "$(cnt 'offloaded [1-9][0-9]*/[0-9]+ layers to GPU' "$CPU_T")" = 0 ]; then
  ok "offloaded N/M regex vs real (31-layer ship)" "MATCH (0/31 excluded, 31/31 accepted, cpu turn has none)"
else bad "offloaded N/M regex" "cpu0=$no0 gpuN=$nNN cpuN=$(cnt 'offloaded [1-9][0-9]*/[0-9]+ layers to GPU' "$CPU_T")"; fi
if [ "$(cnt 'offloading output layer to GPU' "$GPU_T")" -ge 1 ]; then
  ok "offloading output/repeating lines" "MATCH"
else bad "offloading lines" "absent in gpu turn"; fi

# 5. device-selection INFO line (informational in our parse).
nud=$(cnt 'llama_prepare_model_devices: using device GPUOpenCL' "$GPU_T")
if [ "$nud" -ge 1 ]; then ok "using device GPUOpenCL (turn -lv 4)" "MATCH ($nud)"; else bad "using device" "absent"; fi

# 6. kernel dispatch lines (proof env): present with env in the load log, absent in turns.
nk=$(cnt '^GGML_OPENCL_LOG_KERNELS:' "$GPU_L")
nkt=$(cnt '^GGML_OPENCL_LOG_KERNELS:' "$GPU_T")
if [ "$nk" -ge 1 ] && [ "$nkt" = 0 ] && [ "$(grep -a -m1 '^GGML_OPENCL_LOG_KERNELS:' "$GPU_L" | LC_ALL=C grep -acv '^[0-9]')" = 1 ]; then
  ok "GGML_OPENCL_LOG_KERNELS unprefixed" "MATCH ($nk with env in load, 0 in turns, line bare)"
else bad "GGML_OPENCL_LOG_KERNELS" "load=$nk turn=$nkt"; fi

# 7. disabled-backend WARN: never in healthy logs -> shape comes from source.
if [ "$(cnt 'kernel set failed to build|device disabled' "$GPU_L")" = 0 ]; then
  row "kernel set failed | device disabled" "ABSENT-HEALTHY (shape from ggml-opencl.cpp:7255 source)"
fi

# 8. n_predict: the completion logs carry ONLY `generate: … n_predict = 16,
# n_keep = 1` — the unanchored pattern would take $NF=1; the hardened
# end-anchored pattern must take nothing, and the stats shape is host-only.
ngen=$(cnt 'n_predict = ' "$CPU_T")
nhard=$(cnt 'n_predict = [0-9]+$' "$CPU_T")
if [ "$ngen" -ge 1 ] && [ "$nhard" = 0 ]; then
  ok "n_predict hardening vs generate: line" "MATCH (unanchored=$ngen would misparse, hardened=0)"
else bad "n_predict hardening" "unanchored=$ngen hardened=$nhard"; fi
nh=$(cnt 'n_predict = [0-9]+$' "$CELL/raw/calib_armA127.log")
if [ "$nh" -ge 1 ]; then
  row "stats-block n_predict = <N>\$" "MATCH on host engine log (NOT-IN-S23: spec-simple only)"
else bad "stats-block n_predict" "absent in host calib log"; fi

# 9. decoded line: host-only.
if grep -a -q ' decoded .* tokens in .* speed: ' "$CELL/raw/calib_armA127.log"; then
  row "decoded <N> tokens … speed:" "MATCH on host engine log (NOT-IN-S23: llama-completion does not print it)"
else bad "decoded line" "absent even on host"; fi

# 10. EXIT= and prefix shapes.
if [ "$(cnt '^EXIT=0$' "$CPU_T")" = 1 ]; then ok "EXIT=<rc> bare line" "MATCH"; else bad "EXIT line" "count=$(cnt '^EXIT=0$' "$CPU_T")"; fi
npref=$(grep -a -E -c '^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+ [DIWE] ' "$CPU_T" || true)
if [ "${npref:-0}" -ge 1 ]; then ok "logger prefix <h>.<m>.<s>.<ms> <L>" "MATCH ($npref lines)"; else bad "logger prefix" "none found"; fi

# 11. INFO B does not parse (recorded, not gated).
row "n_threads / common_perf_print lines" "INFO — present ($(cnt 'n_threads = ' "$CPU_T")/$(cnt 'common_perf_print:' "$CPU_T")); B parses neither (n_threads=5 confirms -t 5 on device)"

# 12. non-UTF-8 survival: run the REAL arm.sh parsers on the real files.
high=$(grep -a -c $'[\200-\377]' "$CPU_L" || true)
row "non-UTF-8 lines in source logs" "$high (parsers run on these files below)"
TMPR=$(mktemp -d)
cp "$CPU_L" "$TMPR/A-p.log"
cp "$CPU_T" "$TMPR/A.log"
D=/data/local/tmp/dspark-spec
RAW=$TMPR
# shellcheck source=arm.sh
source "$CELL/arm.sh"
arm_parse_proof "A" cpu >/dev/null 2>&1 && p_rc=0 || p_rc=$?
pvoid=$ARM_VOID
arm_parse_measure "A" cpu 127 >/dev/null 2>&1 && m_rc=0 || m_rc=$?
mvoid=$ARM_VOID
if [ "${p_rc:-1}" = 0 ] && [ "${m_rc:-1}" = 0 ] && [ "$pvoid" = no_draft_marker ] && [ "$mvoid" = no_stats ]; then
  ok "parsers survive binary logs" "MATCH (proof -> $pvoid, measure -> $mvoid; both expected for a non-spec log)"
else
  bad "parser survival" "proof_rc=$p_rc/$pvoid measure_rc=$m_rc/$mvoid"
fi
rm -rf "$TMPR"

# 13. fake-vs-real shape diff: the fake must never invent a line shape.
# Generate fake proof+measure logs through the real arm_cmd + fake-adb.
D=/data/local/tmp/dspark-spec
source "$CELL/arm.sh"
FST=$(mktemp -d)
env FAKE_ADB_STATE="$FST" "$CELL/fake-adb.sh" -s fake shell "$(arm_cmd A A 127 measure)" >/dev/null 2>&1 || true
env FAKE_ADB_STATE="$FST" "$CELL/fake-adb.sh" -s fake shell "$(arm_cmd C4-p C4 8 proof)" >/dev/null 2>&1 || true
env FAKE_ADB_STATE="$FST" "$CELL/fake-adb.sh" -s fake shell "$(arm_cmd C4 C4 127 measure)" >/dev/null 2>&1 || true
FA="$FST/dev/A.log"; FP="$FST/dev/C4-p.log"; FG="$FST/dev/C4.log"
norm() { sed -E 's/^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+ [A-Z] //; s/[0-9]+/N/g; s/ +/ /g' | sort -u; }
subset() { # every normalized line of $1 must appear in $2
  local miss
  miss=$(comm -23 <(norm < "$1") <(norm < "$2") | head -5)
  if [ -z "$miss" ]; then return 0; fi
  printf '%s\n' "$miss"
  return 1
}
if sub=$(cat "$FA" "$FG" | grep -a 'load_tensors: \(offloading\|offloaded\)' | norm > "$FST/fake.off" && cat "$CPU_T" "$GPU_T" | grep -a 'load_tensors: \(offloading\|offloaded\)' | norm > "$FST/real.off" && subset "$FST/fake.off" "$FST/real.off"); then
  ok "fake offload shapes ⊆ real" "MATCH ($(wc -l < "$FST/fake.off") normalized shapes)"
else
  bad "fake offload shapes" "not in real logs: $sub"
fi
if sub=$(cat "$FA" "$FG" | grep -a 'model buffer size' | norm > "$FST/fake.buf" && cat "$CPU_T" "$GPU_T" | grep -a 'model buffer size' | norm > "$FST/real.buf" && subset "$FST/fake.buf" "$FST/real.buf"); then
  ok "fake buffer shapes ⊆ real" "MATCH ($(wc -l < "$FST/fake.buf") normalized shapes)"
else
  bad "fake buffer shapes" "not in real logs: $sub"
fi
if sub=$(cat "$FA" "$FP" | grep -a 'assigned to device' | norm > "$FST/fake.asg" && cat "$CPU_L" "$GPU_L" | grep -a 'assigned to device' | norm > "$FST/real.asg" && subset "$FST/fake.asg" "$FST/real.asg"); then
  ok "fake assigned shapes ⊆ real" "MATCH"
else
  bad "fake assigned shapes" "not in real logs: $sub"
fi
if sub=$(cat "$FA" "$FG" | grep -a 'using device GPUOpenCL' | norm > "$FST/fake.dev" && cat "$GPU_T" | grep -a 'using device GPUOpenCL' | norm > "$FST/real.dev" && subset "$FST/fake.dev" "$FST/real.dev"); then
  ok "fake using-device shape ⊆ real" "MATCH"
else
  bad "fake using-device shape" "not in real: $sub"
fi
if [ "$(grep -a -c '^GGML_OPENCL_LOG_KERNELS: ' "$FP")" -ge 1 ] && grep -a -q '^GGML_OPENCL_LOG_KERNELS: ' "$GPU_L"; then
  ok "fake kernel-line prefix == real" "MATCH (both bare, unprefixed)"
else
  bad "kernel-line prefix" "fake=$(grep -a -c '^GGML_OPENCL_LOG_KERNELS: ' "$FP" || true) real=$(grep -a -c '^GGML_OPENCL_LOG_KERNELS: ' "$GPU_L" || true)"
fi
rm -rf "$FST"

echo
if [ "$FAILS" -eq 0 ]; then echo "SHAPE_CHECK pass=0-failures"; exit 0; fi
echo "SHAPE_CHECK failures=$FAILS"
exit 1
