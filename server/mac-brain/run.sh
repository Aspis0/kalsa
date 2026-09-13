#!/usr/bin/env bash
# Start (or attach to) the Kalsa Mac brain. Default backend is the already-running
# mtplx OpenAI server on 127.0.0.1:8000. llama-server is a GGUF fallback.
# Never prints the API key. Never passes --download to mtplx.
set -euo pipefail

BACKEND="${KALSA_BRAIN_BACKEND:-mtplx}"
HOST="${KALSA_BRAIN_HOST:-127.0.0.1}"
KALSA_DIR="${HOME}/.kalsa"
KEYFILE="${KALSA_DIR}/api-keys"
PIDFILE="${KALSA_DIR}/macbrain.pid"
LOGFILE="${KALSA_DIR}/macbrain.log"
MTPLX_MODEL_DEFAULT="${HOME}/.mtplx/models/philipjohnbasile--ornith-ai-Ornith-1.5-35B-A3B-V2-MTPLX"
LLAMA_MODEL_DEFAULT="${KALSA_DIR}/models/ornith-1.5-35b-a3b/Ornith-1.5-35B-Q4_K_M.gguf"
MODEL_ARG=""

usage() {
  cat <<'EOF'
Usage: run.sh [--backend mtplx|llama-server] [MODEL]

mtplx (default): attach to 127.0.0.1:8000 if Ornith is already served by the
  MTPLX app; otherwise start `mtplx serve` on that port. MODEL is a directory.
llama-server: GGUF on 127.0.0.1:8080; refuses a second listener.

Env: KALSA_BRAIN_BACKEND, KALSA_BRAIN_MODEL, KALSA_BRAIN_HOST, KALSA_BRAIN_PORT,
     KALSA_BRAIN_CTX, KALSA_BRAIN_THREADS, KALSA_BRAIN_NGL
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --backend)
      BACKEND="${2:-}"
      shift 2
      ;;
    --backend=*)
      BACKEND="${1#--backend=}"
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "error: unknown flag $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      MODEL_ARG="$1"
      shift
      ;;
  esac
done

if [[ "$BACKEND" != "mtplx" && "$BACKEND" != "llama-server" ]]; then
  echo "error: --backend must be mtplx or llama-server (got ${BACKEND})" >&2
  exit 1
fi

if [[ "$BACKEND" == "mtplx" ]]; then
  PORT="${KALSA_BRAIN_PORT:-8000}"
  DEFAULT_MODEL="$MTPLX_MODEL_DEFAULT"
else
  PORT="${KALSA_BRAIN_PORT:-8080}"
  DEFAULT_MODEL="$LLAMA_MODEL_DEFAULT"
fi
CTX="${KALSA_BRAIN_CTX:-32768}"
THREADS="${KALSA_BRAIN_THREADS:-8}"
NGL="${KALSA_BRAIN_NGL:-all}"

if [[ -n "$MODEL_ARG" ]]; then
  MODEL="$MODEL_ARG"
else
  MODEL="${KALSA_BRAIN_MODEL:-$DEFAULT_MODEL}"
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

find_mtplx() {
  if command -v mtplx >/dev/null 2>&1; then
    command -v mtplx
    return
  fi
  if [[ -x "${HOME}/.mtplx/bin/mtplx" ]]; then
    echo "${HOME}/.mtplx/bin/mtplx"
    return
  fi
  echo "error: mtplx not found (~/.mtplx/bin/mtplx)" >&2
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
  fi
}

print_urls() {
  echo "backend: ${BACKEND}"
  echo "local:  http://${HOST}:${PORT}"
  local ts dns
  ts="$(find_tailscale || true)"
  if [[ -n "${ts:-}" ]]; then
    dns="$("$ts" status --json 2>/dev/null | python3 -c 'import json,sys
d=json.load(sys.stdin)
name=(d.get("Self") or {}).get("DNSName") or ""
print(name.rstrip("."))' 2>/dev/null || true)"
    if [[ -n "${dns:-}" ]]; then
      echo "tailnet: https://${dns}  (Serve must be enabled on the tailnet first)"
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

health_ok() {
  curl -sf -o /dev/null --max-time 3 "http://${HOST}:${PORT}/health"
}

mkdir -p "$KALSA_DIR"
if [[ ! -s "$KEYFILE" ]]; then
  umask 077
  openssl rand -hex 32 > "$KEYFILE"
  chmod 600 "$KEYFILE"
  echo "generated API key file at ${KEYFILE} (contents not printed)"
fi
chmod 600 "$KEYFILE" 2>/dev/null || true

if [[ -f "$PIDFILE" ]] && ! kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  rm -f "$PIDFILE"
fi

wait_health() {
  local pid="${1:-}"
  local ok=0
  local i
  for i in $(seq 1 180); do
    if health_ok; then
      ok=1
      break
    fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      echo "error: server exited during startup; see ${LOGFILE}" >&2
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
}

start_mtplx() {
  if [[ ! -d "$MODEL" ]]; then
    echo "error: mtplx model directory not found: $MODEL" >&2
    echo "this backend does not download. see NOTES.md" >&2
    exit 1
  fi
  if port_busy; then
    if health_ok; then
      echo "mtplx already serving on ${HOST}:${PORT} — attached (not starting a second copy)"
      print_urls
      exit 0
    fi
    echo "error: ${HOST}:${PORT} is busy but /health failed" >&2
    print_urls
    exit 1
  fi
  local bin
  bin="$(find_mtplx)"
  echo "mtplx: $("$bin" --version 2>&1 | head -n 1)"
  echo "model: ${MODEL}"
  echo "bind: ${HOST}:${PORT}  (no --download; --no-auth for localhost)"
  nohup "$bin" serve \
    --host "$HOST" \
    --port "$PORT" \
    --model "$MODEL" \
    --yes \
    --no-auth \
    >>"$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  echo "pid $(cat "$PIDFILE")  log ${LOGFILE}"
  echo "waiting for /health ..."
  wait_health "$(cat "$PIDFILE")"
  echo "ready"
  print_urls
}

start_llama() {
  if [[ ! -f "$MODEL" ]]; then
    echo "error: GGUF not found: $MODEL" >&2
    echo "llama-server backend needs a local GGUF; this run does not download" >&2
    exit 1
  fi
  if port_busy; then
    echo "error: refusing double-start — already listening on ${HOST}:${PORT}" >&2
    print_urls
    exit 1
  fi
  local bin
  bin="$(find_llama_server)"
  echo "llama-server: $("$bin" --version 2>&1 | head -n 2)"
  echo "model: ${MODEL}"
  echo "bind: ${HOST}:${PORT}  ctx=${CTX}  threads=${THREADS}  ngl=${NGL}"
  nohup "$bin" \
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
  wait_health "$(cat "$PIDFILE")"
  echo "ready"
  print_urls
}

if [[ "$BACKEND" == "mtplx" ]]; then
  start_mtplx
else
  start_llama
fi
