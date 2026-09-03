#!/bin/sh
# Run AFTER you click Connect on the QDC job page.
# Usage:
#   ./connect.sh 'ssh -i <KEY> -L 5037:saXXXX.sa.svc.cluster.local:5037 -N sshtunnel@ssh.qdc.qualcomm.com'
#   ./connect.sh saXXXX.sa.svc.cluster.local
# No args: read the ssh line from the clipboard (pbpaste).
set -eu
DIR="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-8g2-oclpicks-53"
KEY="/Users/marco/.ssh/qdc_ed25519"
LOGDIR="$HOME/kalsa-qdc"
mkdir -p "$LOGDIR"

if [ "$#" -eq 0 ]; then
  LINE=$(pbpaste 2>/dev/null || true)
else
  LINE="$*"
fi
HOST=$(printf '%s\n' "$LINE" | sed -n 's/.*-L [0-9]*:\([^:]*\):5037.*/\1/p')
if [ -z "$HOST" ]; then
  HOST=$(printf '%s\n' "$LINE" | sed -n 's/.*\(sa[0-9a-z]*\.sa\.svc\.cluster\.local\).*/\1/p')
fi
if [ -z "$HOST" ] && printf '%s\n' "$LINE" | grep -q '^sa.*cluster.local'; then
  HOST=$LINE
fi
if [ -z "$HOST" ]; then
  echo "NO_HOST: paste the QDC ssh line or saXXXX.sa.svc.cluster.local" >&2
  echo "got: $LINE" >&2
  exit 2
fi
JOB=$(printf '%s\n' "$HOST" | sed 's/\..*//')
echo "host=$HOST"

# Never touch Jelly on 5037. Bind 6037 only.
if lsof -nP -iTCP:6037 -sTCP:LISTEN >/dev/null 2>&1; then
  if [ -f "$LOGDIR/tunnel-current.pid" ]; then
    kill "$(cat "$LOGDIR/tunnel-current.pid")" 2>/dev/null || true
    sleep 0.4
  fi
fi
if lsof -nP -iTCP:6037 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "6037 still busy; not killing a foreign listener" >&2
  lsof -nP -iTCP:6037 -sTCP:LISTEN >&2
  exit 3
fi

nohup ssh -i "$KEY" -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes \
  -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 \
  -L "6037:${HOST}:5037" -N sshtunnel@ssh.qdc.qualcomm.com \
  > "$LOGDIR/tunnel-${JOB}.log" 2>&1 &
echo $! > "$LOGDIR/tunnel-current.pid"
echo $! > "$LOGDIR/tunnel-${JOB}.pid"
sleep 2
if ! lsof -nP -iTCP:6037 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "TUNNEL_FAIL" >&2
  cat "$LOGDIR/tunnel-${JOB}.log" >&2
  exit 4
fi
export ANDROID_ADB_SERVER_PORT=6037
# do not start a local adb daemon on 6037; the tunnel IS the remote server
i=0
while [ "$i" -lt 20 ]; do
  SER=$(adb devices | awk '/\tdevice$/{print $1; exit}')
  if [ -n "$SER" ]; then
    echo "serial=$SER"
    exec "$DIR/d_run.sh" "$JOB"
  fi
  i=$((i + 1))
  sleep 1
done
echo "NO_DEVICE after tunnel" >&2
adb devices >&2
exit 5
