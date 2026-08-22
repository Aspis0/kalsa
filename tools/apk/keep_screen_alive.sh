#!/system/bin/sh
# keep_screen_alive.sh — poke user activity so screen never blanks
while true; do
  input keyevent KEYCODE_WAKEUP
  # tiny no-op swipe = user activity without changing UI much
  input swipe 5 5 6 6 50
  sleep 90
done