#!/usr/bin/env bash
# Offline tests for F3 harness (no phone, no model load).
set -o pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F3="$SCRIPT_DIR/run_f3.sh"
START="$SCRIPT_DIR/start_f3.sh"
PASS_N=0
FAIL_N=0
pass() { echo "PASS  $1"; PASS_N=$((PASS_N + 1)); }
fail() { echo "FAIL  $1"; [ -n "${2:-}" ] && echo "      $2"; FAIL_N=$((FAIL_N + 1)); }

echo "=== 1) bash -n ==="
for f in run_f3.sh start_f3.sh; do
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

rm -rf "$TMP"
echo
echo "=== summary: PASS=$PASS_N FAIL=$FAIL_N ==="
if [ "$FAIL_N" -gt 0 ]; then exit 1; fi
exit 0
