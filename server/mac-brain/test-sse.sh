#!/usr/bin/env bash
# Curl checks: /health, non-stream chat, SSE stream ending in data: [DONE].
# Usage: test-sse.sh [BASE_URL]
# Default BASE_URL: http://127.0.0.1:8000 (mtplx). llama-server is :8080.
# Sends Bearer from ~/.kalsa/api-keys when that file exists; mtplx localhost
# currently does not require a key. Never prints the key.
set -euo pipefail

BASE="${1:-http://127.0.0.1:8000}"
BASE="${BASE%/}"
KEYFILE="${HOME}/.kalsa/api-keys"
AUTH=()
if [[ -s "$KEYFILE" ]]; then
  KEY="$(head -n1 "$KEYFILE" | tr -d '\r\n')"
  if [[ -n "$KEY" ]]; then
    AUTH=( -H "Authorization: Bearer ${KEY}" )
  fi
else
  echo "note: no ${KEYFILE}; probing without Authorization"
fi
JSON=( -H "Content-Type: application/json" )
fail=0

MODEL="ornith"
models_json="$(mktemp)"
if curl -sS --max-time 5 -o "$models_json" "${AUTH[@]}" "${BASE}/v1/models"; then
  got="$(python3 - "$models_json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1], encoding="utf-8"))
data=d.get("data") or []
print((data[0].get("id") if data else "") or "")
PY
)"
  if [[ -n "$got" ]]; then
    MODEL="$got"
  fi
fi
rm -f "$models_json"
echo "using model id: ${MODEL}"

echo "== GET ${BASE}/health =="
health_body="$(mktemp)"
health_code="$(curl -sS --max-time 10 -o "$health_body" -w "%{http_code}" "${AUTH[@]}" "${BASE}/health" || true)"
echo "HTTP ${health_code}"
python3 - "$health_body" <<'PY' || true
import json,sys
raw=open(sys.argv[1], encoding="utf-8", errors="replace").read()
print(raw[:400])
try:
    d=json.loads(raw)
    print("ok:", d.get("ok") or d.get("status"), "model:", d.get("model"))
except Exception:
    pass
PY
if [[ "$health_code" == "200" ]]; then
  echo "PASS /health"
else
  echo "FAIL /health (expected HTTP 200)"
  fail=1
fi
rm -f "$health_body"

echo
echo "== POST ${BASE}/v1/chat/completions (stream=false) =="
nonstream_body="$(mktemp)"
nonstream_code="$(curl -sS --max-time 180 -o "$nonstream_body" -w "%{http_code}" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly the word pong and nothing else.\"}],\"stream\":false,\"max_tokens\":256,\"temperature\":0}" \
  "${BASE}/v1/chat/completions" || true)"
echo "HTTP ${nonstream_code}"
python3 - "$nonstream_body" <<'PY' || true
import json, sys
raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()
try:
    d = json.loads(raw)
except Exception as e:
    print("not JSON:", e)
    print(raw[:800])
    sys.exit(0)
choices = d.get("choices") or []
if not choices:
    print("no choices:", json.dumps(d, ensure_ascii=False)[:800])
    sys.exit(0)
msg = (choices[0].get("message") or {})
content = msg.get("content") or ""
reason = msg.get("reasoning_content") or msg.get("reasoning") or ""
print("role:", msg.get("role"))
print("content:", content[:500])
print("reasoning_chars:", len(reason))
print("finish_reason:", choices[0].get("finish_reason"))
print("model:", d.get("model"))
PY
if [[ "$nonstream_code" == "200" ]] && grep -q '"choices"' "$nonstream_body"; then
  echo "PASS non-stream /v1/chat/completions"
else
  echo "FAIL non-stream /v1/chat/completions"
  fail=1
fi
rm -f "$nonstream_body"

echo
echo "== POST ${BASE}/v1/chat/completions (stream=true) =="
stream_body="$(mktemp)"
stream_code="$(curl -sS -N --max-time 180 -o "$stream_body" -w "%{http_code}" "${AUTH[@]}" "${JSON[@]}" \
  -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Count from 1 to 8, digits only, spaces between.\"}],\"stream\":true,\"max_tokens\":256,\"temperature\":0}" \
  "${BASE}/v1/chat/completions" || true)"
echo "HTTP ${stream_code}"
echo "-- SSE data: (first 8, last 4; lines truncated) --"
python3 - "$stream_body" <<'PY'
import sys
lines=[ln.rstrip("\n") for ln in open(sys.argv[1], encoding="utf-8", errors="replace") if ln.startswith("data:")]
def show(ln):
    print(ln[:180] + ("…" if len(ln)>180 else ""))
for ln in lines[:8]:
    show(ln)
if len(lines)>12:
    print("...")
for ln in lines[-4:]:
    show(ln)
print("data_lines", len(lines), "done", sum(1 for ln in lines if ln.strip()=="data: [DONE]"))
PY
data_count="$(grep -cE '^data:' "$stream_body" || true)"
done_count="$(grep -cE '^data: \[DONE\]' "$stream_body" || true)"
echo "data: lines=${data_count}  [DONE] lines=${done_count}"
if [[ "$stream_code" == "200" && "$data_count" -ge 2 && "$done_count" -ge 1 ]]; then
  echo "PASS stream /v1/chat/completions"
else
  echo "FAIL stream /v1/chat/completions (need HTTP 200, incremental data: chunks, and data: [DONE])"
  fail=1
fi
rm -f "$stream_body"

echo
if [[ "$fail" -eq 0 ]]; then
  echo "ALL PASS against ${BASE}"
  exit 0
fi
echo "SOME CHECKS FAILED against ${BASE}"
exit 1
