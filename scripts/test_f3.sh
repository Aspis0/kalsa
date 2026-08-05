#!/usr/bin/env bash
# Offline tests for F3 harness (no phone, no model load).
# Covers: safety gates, phase/flags, timeout floor, classic-perf/ttft fixtures,
# cold+warm pair guard, compact vs classic timing parse.
set -o pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F3="$SCRIPT_DIR/run_f3.sh"
START="$SCRIPT_DIR/start_f3.sh"
BENCH="$SCRIPT_DIR/run_bench.sh"
PASS_N=0
FAIL_N=0
pass() { echo "PASS  $1"; PASS_N=$((PASS_N + 1)); }
fail() { echo "FAIL  $1"; [ -n "${2:-}" ] && echo "      $2"; FAIL_N=$((FAIL_N + 1)); }

echo "=== 1) bash -n ==="
for f in run_f3.sh start_f3.sh run_bench.sh; do
  if bash -n "$SCRIPT_DIR/$f" 2>/tmp/tf3_syn.err; then
    pass "bash -n $f"
  else
    fail "bash -n $f" "$(cat /tmp/tf3_syn.err 2>/dev/null | head -5)"
  fi
done

echo "=== 2) safety rejects ==="
TMP="$(mktemp -d "${TMPDIR:-/tmp}/test_f3.XXXXXX")"
mkdir -p "$TMP/build-safe/bin" "$TMP/build/bin" "$TMP/models"
# wrong size fake model
echo fake >"$TMP/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf"
# exact-size fake model (pad to EXPECTED_SIZE is huge — use sparse truncate if possible)
# For size gate: create file of exact size via truncate if available
if command -v truncate >/dev/null 2>&1; then
  truncate -s 11522702304 "$TMP/models/good.gguf" 2>/dev/null || \
    dd if=/dev/zero of="$TMP/models/good.gguf" bs=1 count=0 seek=11522702304 2>/dev/null || \
    echo small >"$TMP/models/good.gguf"
else
  # Windows/Git Bash: skip exact-size positive path; still test wrong-size
  echo small >"$TMP/models/good.gguf"
fi
: >"$TMP/build-safe/bin/llama-cli"; chmod +x "$TMP/build-safe/bin/llama-cli" 2>/dev/null || true
: >"$TMP/build/bin/llama-cli"; chmod +x "$TMP/build/bin/llama-cli" 2>/dev/null || true
echo '#!/usr/bin/env bash' >"$TMP/run_bench.sh"; echo 'exit 0' >>"$TMP/run_bench.sh"; chmod +x "$TMP/run_bench.sh"
echo short >"$TMP/short.txt"

run_f3() {
  RUN_BENCH="$TMP/run_bench.sh" HOME="$TMP" bash "$F3" "$@" 2>"$TMP/err" >/dev/null
}

# wrong variant
run_f3 --variant nope --model "$TMP/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf" --binary "$TMP/build-safe/bin/llama-cli"
ec=$?
if [ "$ec" -eq 3 ] && grep -qi 'variant' "$TMP/err"; then pass "reject bad variant"; else fail "reject bad variant" "ec=$ec $(head -3 "$TMP/err")"; fi

# wrong size
run_f3 --variant default --model "$TMP/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf" --binary "$TMP/build-safe/bin/llama-cli"
ec=$?
if [ "$ec" -eq 3 ] && grep -qi 'size\|11522702304' "$TMP/err"; then pass "reject wrong model size"; else fail "reject wrong model size" "ec=$ec $(head -3 "$TMP/err")"; fi

# cooldown too low (need good size first if we have it)
_gsz="$(stat -c '%s' "$TMP/models/good.gguf" 2>/dev/null || stat -f '%z' "$TMP/models/good.gguf" 2>/dev/null || echo 0)"
if [ "$_gsz" = "11522702304" ]; then
  run_f3 --variant default --model "$TMP/models/good.gguf" --binary "$TMP/build-safe/bin/llama-cli" --cooldown 20
  ec=$?
  if [ "$ec" -eq 3 ] && grep -qi 'cooldown' "$TMP/err"; then pass "reject cooldown 20"; else fail "reject cooldown 20" "ec=$ec $(head -3 "$TMP/err")"; fi

  run_f3 --variant default --model "$TMP/models/good.gguf" --binary "$TMP/build-safe/bin/llama-cli" --cooldown 180 --max-cool-temp 32
  ec=$?
  if [ "$ec" -eq 3 ] && grep -qi 'cool-temp\|30.0' "$TMP/err"; then pass "reject max-cool-temp 32"; else fail "reject max-cool-temp 32" "ec=$ec $(head -3 "$TMP/err")"; fi

  run_f3 --variant default --model "$TMP/models/good.gguf" --binary "$TMP/build/bin/llama-cli" --cooldown 180
  ec=$?
  if [ "$ec" -eq 6 ] && grep -qi 'build' "$TMP/err"; then pass "reject binary build/bin"; else fail "reject binary build/bin" "ec=$ec $(head -3 "$TMP/err")"; fi
else
  echo "SKIP  exact-size positive safety (truncate unavailable / size=$_gsz)"
fi

echo "=== 3) no pkill / no network ==="
live_pkill() {
  sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$1" | grep -nE '(^|[[:space:]])(pkill|killall)([[:space:]]|$)' || true
}
for f in run_f3.sh start_f3.sh; do
  hits="$(live_pkill "$SCRIPT_DIR/$f")"
  if [ -n "$hits" ]; then fail "$f live pkill" "$hits"; else pass "$f no live pkill"; fi
done
if grep -nE 'curl |wget |huggingface|hf download|git clone' "$F3" "$START" >/tmp/tf3_net.err 2>/dev/null; then
  fail "network pattern" "$(cat /tmp/tf3_net.err)"
else
  pass "no network download in F3 scripts"
fi

echo "=== 4) phase tags + flags wiring ==="
if grep -q 'PHASE="F3"' "$F3" && grep -q 'PHASE="F3-numa"' "$F3" && grep -q 'PHASE="F3-nowarmup"' "$F3"; then
  pass "phase tags F3 / F3-numa / F3-nowarmup"
else
  fail "phase tags missing"
fi
if grep -q -- '--numa distribute' "$F3" && grep -q -- '--no-warmup' "$F3"; then
  pass "flags --numa distribute and --no-warmup"
else
  fail "variant flags missing"
fi
if grep -q 'CHARGE_NEEDED' "$F3" && grep -q 'exit 92' "$F3"; then
  pass "battery floor CHARGE_NEEDED exit 92"
else
  fail "CHARGE_NEEDED missing"
fi
if grep -q '11522702304' "$F3" && grep -q 'N_GEN=32' "$F3" && grep -q 'N_CTX=512' "$F3"; then
  pass "size gate + n_gen=32 + ctx=512"
else
  fail "F3 constants missing"
fi
if grep -q 'build-safe' "$START" && grep -q 'nohup bash' "$START"; then
  pass "start_f3 detached + build-safe"
else
  fail "start_f3 wrapper incomplete"
fi

echo "=== 5) run-timeout floor (≥2700) + classic-perf wiring ==="
# Source helpers for parse_timings fixtures
# shellcheck disable=SC1090
RUN_BENCH_LIB_ONLY=1 source "$BENCH"

if grep -q 'RUN_TIMEOUT_S' "$BENCH" && grep -q 'run-timeout' "$BENCH" && grep -q 'exit 8' "$BENCH"; then
  pass "run_bench has --run-timeout + exit 8 path"
else
  fail "run_bench timeout plumbing missing"
fi
if grep -q 'CLASSIC_PERF' "$BENCH" && grep -q 'classic-perf' "$BENCH"; then
  pass "run_bench has --classic-perf"
else
  fail "run_bench classic-perf missing"
fi
if grep -q 'load_s' "$BENCH"; then
  pass "run_bench records load_s in notes"
else
  fail "run_bench load_s missing"
fi
if grep -q 'classic-perf' "$F3" && grep -q 'run-timeout' "$F3" && grep -q 'RUN_TIMEOUT_S' "$F3"; then
  pass "run_f3 passes --classic-perf + --run-timeout to run_bench"
else
  fail "run_f3 does not wire classic-perf/timeout"
fi
if grep -q 'PAIR cold+warm same boot' "$F3"; then
  pass "run_f3 logs PAIR cold+warm same boot"
else
  fail "run_f3 missing PAIR cold+warm guard log"
fi
if grep -q 'Exact operator sequence' "$START" || grep -q 'PAIR cold+warm same boot' "$START"; then
  pass "start_f3 documents cold+warm operator sequence"
else
  fail "start_f3 missing sequence docs"
fi

# Floor reject: --run-timeout 60 must exit 3
if [ "$_gsz" = "11522702304" ]; then
  run_f3 --variant default --model "$TMP/models/good.gguf" --binary "$TMP/build-safe/bin/llama-cli" --cooldown 180 --run-timeout 60
  ec=$?
  if [ "$ec" -eq 3 ] && grep -qi 'run-timeout\|2700' "$TMP/err"; then
    pass "reject run-timeout 60 (<2700 floor)"
  else
    fail "reject run-timeout 60" "ec=$ec $(head -3 "$TMP/err")"
  fi
else
  # Still unit-test run_bench floor without full model
  _to_out="$(bash "$BENCH" -m /tmp/fake.gguf -p /tmp/fake.txt --print-cmd --allow-no-battery --run-timeout 60 2>&1)" || _to_ec=$?
  _to_ec="${_to_ec:-0}"
  if [ "${_to_ec:-0}" -eq 3 ] || printf '%s' "$_to_out" | grep -qi '2700\|run-timeout'; then
    pass "run_bench rejects --run-timeout 60 (floor 2700)"
  else
    fail "run_bench timeout floor" "ec=$_to_ec out=$(printf '%s' "$_to_out" | head -c 200)"
  fi
fi

# Default timeout ≥2700 accepted by print-cmd path
_ok_to="$(bash "$BENCH" -m /tmp/fake.gguf -p /tmp/fake.txt --print-cmd --allow-no-battery --run-timeout 2700 2>/dev/null)" && _ok_ec=0 || _ok_ec=$?
if [ "$_ok_ec" -eq 0 ] && printf '%s' "$_ok_to" | grep -q 'llama-cli'; then
  pass "run_bench accepts --run-timeout 2700"
else
  fail "run_bench accept 2700" "ec=$_ok_ec"
fi

# classic-perf drops --simple-io; default keeps it
_cmd_def="$(bash "$BENCH" -m /tmp/fake.gguf -p /tmp/fake.txt --runtime mainline --print-cmd --allow-no-battery 2>/dev/null)"
_cmd_cl="$(bash "$BENCH" -m /tmp/fake.gguf -p /tmp/fake.txt --runtime mainline --print-cmd --allow-no-battery --classic-perf 2>/dev/null)"
if printf '%s' "$_cmd_def" | grep -q -- '--simple-io'; then
  pass "default mainline keeps --simple-io"
else
  fail "default must keep --simple-io" "cmd=$_cmd_def"
fi
if printf '%s' "$_cmd_cl" | grep -q -- '--simple-io'; then
  fail "--classic-perf must drop --simple-io" "cmd=$_cmd_cl"
else
  pass "--classic-perf drops --simple-io"
fi
if printf '%s' "$_cmd_cl" | grep -q -- '--no-conversation' && printf '%s' "$_cmd_cl" | grep -q -- '--single-turn'; then
  pass "--classic-perf keeps no-conversation + single-turn"
else
  fail "classic-perf lost conversation guards" "cmd=$_cmd_cl"
fi

echo "=== 6) timing fixtures: compact vs classic (ttft_ms) ==="
if ! declare -f parse_timings >/dev/null 2>&1; then
  fail "parse_timings available" "not defined after RUN_BENCH_LIB_ONLY=1"
else
  # (i) compact-format log still yields prompt/eval tok/s (ttft empty — expected for F2)
  _COMPACT="$TMP/compact.log"
  cat > "$_COMPACT" <<'EOF'
[Start thinking]
[ Prompt: 18.1 t/s | Generation: 6.0 t/s ]
EOF
  parse_timings "$_COMPACT" "mainline" "llama-cli"
  if [ "$PROMPT_TOK_S" = "18.10" ] && [ "$EVAL_TOK_S" = "6.00" ]; then
    pass "compact log → prompt/eval tok/s (18.10/6.00)"
  else
    fail "compact log parse" "prompt=$PROMPT_TOK_S eval=$EVAL_TOK_S"
  fi
  if [ -z "${TTFT_MS:-}" ]; then
    pass "compact log → ttft_ms empty (expected; need classic-perf for F3)"
  else
    fail "compact log should not invent ttft_ms" "ttft=$TTFT_MS"
  fi

  # (ii) classic-perf-format log yields ttft_ms + prompt/eval tok/s
  _CLASSIC="$TMP/classic.log"
  cat > "$_CLASSIC" <<'EOF'
llama_perf_context_print:        load time =   12345.67 ms
llama_perf_context_print: prompt eval time =    2345.67 ms /   128 tokens (   18.32 ms per token,    54.57 tokens per second)
llama_perf_context_print:        eval time =    3456.78 ms /    32 runs   (  108.02 ms per token,     9.26 tokens per second)
EOF
  parse_timings "$_CLASSIC" "mainline" "llama-cli"
  if [ "$PROMPT_TOK_S" = "54.57" ] && [ "$EVAL_TOK_S" = "9.26" ] && [ "$TTFT_MS" = "2346" ]; then
    pass "classic perf log → prompt=54.57 eval=9.26 ttft_ms=2346"
  else
    fail "classic perf parse" "prompt=$PROMPT_TOK_S eval=$EVAL_TOK_S ttft=$TTFT_MS"
  fi

  # load_s extraction from classic log (ms → s)
  _load_line="$(grep -E 'load time[[:space:]]*=' "$_CLASSIC" | tail -n1)"
  _load_ms="$(printf '%s\n' "$_load_line" | sed -n -E 's/.*load time[[:space:]]*=[[:space:]]*([0-9.]+).*/\1/p')"
  _load_s="$(awk -v ms="$_load_ms" 'BEGIN{printf "%d", (ms+0)/1000 + 0.5}')"
  if [ "$_load_s" = "12" ]; then
    pass "load_s from classic load time 12345.67 ms → 12 s"
  else
    fail "load_s extract" "got $_load_s from ms=$_load_ms"
  fi
fi

echo "=== 7) exit-8 distinct from exit-1 (static) ==="
if grep -q 'HARNESS_TIMEOUT' "$BENCH" && grep -q 'BLOCKED/timeout' "$BENCH" && grep -q 'exit 8' "$BENCH"; then
  pass "harness timeout path distinct (BLOCKED/timeout + exit 8)"
else
  fail "harness timeout path incomplete"
fi
if grep -q 'exit 8' "$F3" || grep -q 'BLOCKED/timeout' "$F3"; then
  pass "run_f3 handles exit 8 as BLOCKED/timeout (not valid data)"
else
  fail "run_f3 missing exit 8 handling"
fi

rm -rf "$TMP"
echo
echo "=== summary: PASS=$PASS_N FAIL=$FAIL_N ==="
if [ "$FAIL_N" -gt 0 ]; then exit 1; fi
exit 0
