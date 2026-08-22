#!/data/data/com.termux/files/usr/bin/bash
export HOME="${HOME:-/data/data/com.termux/files/home}"
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
echo "=== PATH ==="
echo "$PATH"
echo "=== which termux-battery ==="
command -v termux-battery-status
command -v python3
command -v git
echo "=== BATTERY ==="
termux-battery-status
echo "=== BATT ERR $? ==="
echo "=== GIT ON SRC ==="
git -C "$HOME/src/BigMoeOnEdge" rev-parse HEAD
git -C "$HOME/src/BigMoeOnEdge" log --oneline -3
git -C "$HOME/src/BigMoeOnEdge" status -sb | head
echo "=== EMPTY-THINK HUNK ==="
grep -n -A8 'reasoning_content.empty' "$HOME/src/BigMoeOnEdge/core/src/engine/session.cpp" | head -40
echo "=== PRESERVE ==="
grep -n 'preserve_thinking' "$HOME/src/BigMoeOnEdge/core/src/engine/session.cpp"
echo "=== LIBS ==="
ls -lh "$HOME/src/BigMoeOnEdge/build-jelly/bin/"
echo "=== CMAKE SRC DIR ==="
grep -E 'CMAKE_HOME|BigMoeOnEdge' "$HOME/src/BigMoeOnEdge/build-jelly/CMakeCache.txt" | head
