#!/data/data/com.termux/files/usr/bin/bash
set +e
echo "=== SYSFS BATT ==="
ls /sys/class/power_supply/
for d in /sys/class/power_supply/*; do
  echo "## $d"
  cat "$d/type" 2>/dev/null
  cat "$d/status" 2>/dev/null
  cat "$d/capacity" 2>/dev/null
  cat "$d/temp" 2>/dev/null
  cat "$d/online" 2>/dev/null
  echo
done
echo "=== CMD BATTERY ==="
cmd battery 2>/dev/null | head -30
echo "=== DUMPSYS ==="
/system/bin/dumpsys battery 2>/dev/null | head -30
echo "=== CMAKE ARM ==="
grep -E 'ARM|ARCH|GIT|CMAKE_CXX_FLAGS' "$HOME/src/BigMoeOnEdge/build-jelly/CMakeCache.txt" | head -50
echo "=== SESSION KVFIX ==="
grep -n 'preserve_thinking' "$HOME/src/BigMoeOnEdge/core/src/engine/session.cpp" | head
echo "=== SESSION DATE ==="
ls -l "$HOME/src/BigMoeOnEdge/core/src/engine/session.cpp"
echo "=== VERSION ==="
"$HOME/bin/run-bmoe" --version 2>&1 | head -20
echo "=== LIST ARCH ==="
"$HOME/bin/run-bmoe" --list-archs 2>&1 | head
echo "=== PROMPTS SHA ==="
sha256sum "$HOME/experiments/results/ttft_f0_jelly/prompts/"* 2>/dev/null
echo "=== COLD SCRIPT ==="
ls -l "$HOME/bin/cold_model.sh"
echo "=== DISK ==="
df -h "$HOME"
