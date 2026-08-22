#!/data/data/com.termux/files/usr/bin/bash
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
OUT="$HOME/experiments/results/ttft_f0_jelly/.batt.json"
echo "=== BATTERY FILE ==="
: > "$OUT"
timeout 8 termux-battery-status > "$OUT" 2>"$HOME/experiments/results/ttft_f0_jelly/.batt.err"
echo "batt_rc=$?"
echo "--- json ---"
cat "$OUT"
echo
echo "--- err ---"
cat "$HOME/experiments/results/ttft_f0_jelly/.batt.err"
echo
echo "=== GIT ON SRC ==="
git -C "$HOME/src/BigMoeOnEdge" rev-parse HEAD
git -C "$HOME/src/BigMoeOnEdge" log --oneline -5
echo "=== EMPTY-THINK ==="
grep -n -A12 'reasoning_content.empty' "$HOME/src/BigMoeOnEdge/core/src/engine/session.cpp" | head -50
echo "=== PRESERVE ==="
grep -n 'preserve_thinking' "$HOME/src/BigMoeOnEdge/core/src/engine/session.cpp"
echo "=== LIBS ==="
ls -lh "$HOME/src/BigMoeOnEdge/build-jelly/bin/"
echo "=== CMAKE HOME ==="
grep CMAKE_HOME_DIRECTORY "$HOME/src/BigMoeOnEdge/build-jelly/CMakeCache.txt"
