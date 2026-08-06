#!/data/data/com.termux/files/usr/bin/sh
# MoE campaign — bring up the remote control channel at every boot.
# Installed at ~/.termux/boot/start-sshd.sh (Termux:Boot).
#
# Order matters. sshd starts FIRST and unconditionally: a boot script that
# blocks before sshd leaves the phone unreachable until someone touches it,
# and two things here can block for minutes — termux-api calls while the
# Termux:API app is still starting, and any probe of the Wi-Fi interface
# (`ip addr show wlan0` is denied to untrusted app uids and just burns its
# whole timeout returning nothing).
LOG="$HOME/boot.log"
exec >>"$LOG" 2>&1
echo "=== boot $(date -Iseconds) ==="

rm -f "$HOME/.boot_ready"

pgrep -x sshd >/dev/null 2>&1 || sshd
sleep 2
if pgrep -x sshd >/dev/null 2>&1; then
  echo "sshd UP pid=$(pgrep -x sshd | tr '\n' ' ')"
else
  echo "sshd FAILED, retrying once"
  sleep 5
  sshd
  pgrep -x sshd >/dev/null 2>&1 && echo "sshd UP (retry)" || echo "sshd DEAD"
fi
echo "$(date -Iseconds)" > "$HOME/.boot_ready"

# Best-effort from here on; nothing below may delay the control channel.
timeout 60 termux-wake-lock && echo "wake-lock ok" || echo "wake-lock skipped/failed"
echo "wifi: $(timeout 30 termux-wifi-connectioninfo 2>/dev/null | tr -d '\n ' | cut -c1-200)"
echo "battery: $(timeout 30 termux-battery-status 2>/dev/null | tr -d '\n ')"
echo "=== boot script done $(date -Iseconds) ==="
