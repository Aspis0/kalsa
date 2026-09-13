#!/usr/bin/env bash
# Start llama-server for the Kalsa Mac brain. Idempotent: refuses a second
# listener on 127.0.0.1:8080. Does not print the API key.
set -euo pipefail

PORT="${KALSA_BRAIN_PORT:-8080}"
HOST="${KALSA_BRAIN_HOST:-127.0.0.1}"
CTX="${KALSA_BRAIN_CTX:-32768}"
THREADS="${KALSA_BRAIN_THREADS:-8}"
NGL="${KALSA_BRAIN_NGL:-all}"
KALSA_DIR="${HOME}/.kalsa"
KEYFILE="${KALSA_DIR}/api-keys"
PIDFILE="${KALSA_DIR}/macbrain.pid"
LOGFILE="${KALSA_DIR}/macbrain.log"
DEFAULT_MODEL="${KALSA_DIR}/models/ornith-1.5-35b-a3b/Ornith-1.5-35B-Q4_K_M.gguf"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: run.sh [MODEL.gguf]

Starts llama-server on 127.0.0.1:8080 (refuses if the port is already taken).

Model path: $1, else $KALSA_BRAIN_MODEL, else
  ~/.kalsa/models/ornith-1.5-35b-a3b/Ornith-1.5-35B-Q4_K_M.gguf

Optional env: KALSA_BRAIN_HOST, KALSA_BRAIN_PORT, KALSA_BRAIN_CTX,
  KALSA_BRAIN_THREADS, KALSA_BRAIN_NGL
EOF
  exit 0
fi

if [[ -n "${1:-}" ]]; then
  MODEL="$1"
else
  MODEL="${KALSA_BRAIN_MODEL:-$DEFAULT_MODEL}"
fi

if [[ ! -f "$MODEL" ]]; then
  echo "error: model not found: $MODEL" >&2
  echo "set KALSA_BRAIN_MODEL or pass the GGUF path as \$1 (see README.md)" >&2
  exit 1
fi

find_llama_server() {
  if command -v llama-server >/dev/null 2>&1; then
    command -v llama-server
    return
  fi
  if [[ -x /opt/homebrew/bin/llama-server ]]; then
    echo /opt/homebrew/bin/llama-server
    return
  fi
  echo "error: llama-server not on PATH. brew install llama.cpp" >&2
  exit 1
}

find_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then
    command -v tailscale
    return
  fi
  local app="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  if [[ -x "$app" ]]; then
    echo "$app"
    return
  fi
}

print_urls() {
  echo "local:  http://${HOST}:${PORT}"
  local ts
  ts="$(find_tailscale || true)"
  if [[ -n "${ts:-}" ]]; then
    local dns
    dns="$("$ts" status --json 2>/dev/null | python3 -c 'import json,sys
d=json.load(sys.stdin)
name=(d.get("Self") or {}).get("DNSName") or ""
print(name.rstrip("."))' 2>/dev/null || true)"
    if [[ -n "${dns:-}" ]]; then
      echo "tailnet: https://${dns}"
    else
      echo "tailnet: (Tailscale logged out or MagicDNS unavailable)"
    fi
  else
    echo "tailnet: (tailscale CLI not found)"
  fi
}

port_busy() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

mkdir -p "$KALSA_DIR"

if [[ ! -s "$KEYFILE" ]]; then
  umask 077
  openssl rand -hex 32 > "$KEYFILE"
  chmod 600 "$KEYFILE"
  echo "generated API key file at ${KEYFILE} (contents not printed)"
fi
chmod 600 "$KEYFILE" 2>/dev/null || true

if port_busy; then
  echo "error: refusing double-start — already listening on ${HOST}:${PORT}" >&2
  print_urls
  exit 1
fi

LLAMA_SERVER="$(find_llama_server)"

# Drop a stale pidfile from a previous crash.
if [[ -f "$PIDFILE" ]] && ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  rm -f "$PIDFILE"
fi

echo "llama-server: $("$LLAMA_SERVER" --version 2>&1 | head -n 2)"
echo "model: ${MODEL}"
echo "bind: ${HOST}:${PORT}  ctx=${CTX}  threads=${THREADS}  ngl=${NGL}"

nohup "$LLAMA_SERVER" \
  --model "$MODEL" \
  --host "$HOST" \
  --port "$PORT" \
  --ctx-size "$CTX" \
  --threads "$THREADS" \
  --n-gpu-layers "$NGL" \
  --flash-attn auto \
  --api-key-file "$KEYFILE" \
  --sse-ping-interval 30 \
  >>"$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"

echo "pid $(cat "$PIDFILE")  log ${LOGFILE}"
echo "waiting for /health ..."

ok=0
for _ in $(seq 1 180); do
  if curl -sf -o /dev/null \
      -H "Authorization: Bearer $(head -n1 "$KEYFILE" | tr -d '\r\n')" \
      "http://${HOST}:${PORT}/health"; then
    ok=1
    break
  fi
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "error: llama-server exited during startup; see ${LOGFILE}" >&2
    tail -n 40 "$LOGFILE" >&2 || true
    rm -f "$PIDFILE"
    exit 1
  fi
  sleep 1
done

if [[ "$ok" -ne 1 ]]; then
  echo "error: /health not ready after 180s; see ${LOGFILE}" >&2
  tail -n 40 "$LOGFILE" >&2 || true
  exit 1
fi

echo "ready"
print_urls
