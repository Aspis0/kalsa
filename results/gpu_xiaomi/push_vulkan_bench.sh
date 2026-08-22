#!/usr/bin/env bash
# Ready-to-push: PC → Xiaomi 14 (Termux home). USER runs this tonight.
# Do NOT smoke here — smoke is the user's job after push.
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN="$ROOT/bin/llama-bench"
SUMS="$ROOT/bin/SHA256SUMS.txt"
# adb serial from S0_REPORT (port rotates after reboot — re-pair if needed)
ADB_SERIAL="${ADB_SERIAL:-adb-625689a2-9xEOfw._adb-tls-connect._tcp}"
# Termux app data path (run-as). Alternative: /data/local/tmp then cp via run-as.
REMOTE_TMP="${REMOTE_TMP:-/data/local/tmp/llama-bench-vulkan}"
REMOTE_TERMUX="${REMOTE_TERMUX:-/data/data/com.termux/files/home/llama.cpp/build-vulkan-ndk/bin}"

if [ ! -f "$BIN" ]; then
  echo "ERRORE: missing $BIN" >&2
  exit 1
fi

echo "=== local sha ==="
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$BIN"
  cat "$SUMS"
else
  # Windows git-bash fallback
  powershell.exe -NoProfile -Command "(Get-FileHash -Algorithm SHA256 '$BIN').Hash.ToLower()"
fi

echo "=== adb device ==="
adb devices -l
adb -s "$ADB_SERIAL" get-state

echo "=== push to $REMOTE_TMP ==="
adb -s "$ADB_SERIAL" push "$BIN" "$REMOTE_TMP"
adb -s "$ADB_SERIAL" shell "chmod 755 $REMOTE_TMP && ls -la $REMOTE_TMP"

echo "=== install into Termux home (run-as) ==="
adb -s "$ADB_SERIAL" shell "run-as com.termux sh -c 'mkdir -p $REMOTE_TERMUX && cat > $REMOTE_TERMUX/llama-bench' < $REMOTE_TMP" \
  || {
    echo "NOTE: run-as cat redirect may fail under some shells."
    echo "Fallback (run interactively in real Termux):"
    echo "  cp $REMOTE_TMP \$HOME/bin/llama-bench-vulkan && chmod 755 \$HOME/bin/llama-bench-vulkan"
  }

echo "=== remote sha (tmp) ==="
adb -s "$ADB_SERIAL" shell "sha256sum $REMOTE_TMP 2>/dev/null || toybox sha256sum $REMOTE_TMP 2>/dev/null || echo 'sha tool missing on device; verify later in Termux'"

echo "EXPECTED sha256: ba433a7de586547c015e194f92f80dab182bdf1301e686f9875c8488a124b6f2"
echo "READY for smoke: \$HOME/.../llama-bench -m <gguf> -ngl 1 -p 0 -n 16 -t 6"
echo "Do NOT trust BUILD_EXIT alone; binary presence + smoke is the gate."
