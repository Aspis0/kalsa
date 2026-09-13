#!/usr/bin/env bash
# Curl checks for the Kalsa Mac brain: /health, non-stream chat, SSE stream.
# Usage: test-sse.sh [BASE_URL]
# BASE_URL default: http://127.0.0.1:8080
# Reads the first line of ~/.kalsa/api-keys. Never prints the key.
set -euo pipefail

BASE="${1:-http://127.0.0.1:8080}"
BASE="${BASE%/}"
KEYFILE="${HOME}/.kalsa/api-keys"

if [[ ! -s "$KEYFILE" ]]; then
  echo "FAIL: missing API key file ${KEYFILE}" >&2
  exit 1
fi

KEY="$(head -n1 "$KEYFILE" | tr -d '\r\n')"
if [[ -z "$KEY" ]]; then
  echo "FAIL: empty API key file ${KEYFILE}" >&2
  exit 1
fi

AUTH=( -H "Authorization: Bearer ${KEY}" )
JSON=( -H "Content-Type: application/json" )
fail=0

echo "== GET ${BASE}/health =="
health_body="$(mktemp)"
health_code="$(curl -sS -o "$health_body" -w "%{http_code}" "${AUTH[@]}" "${BASE}/health" || true)"
echo "HTTP ${health_code}"
sed -e 's/./&/g' "$health_body" | head -c 400
echo
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
nonstream_code="$(curl -sS -o "$nonstream_body" -w "%{http_code}" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"model":"ornith","messages":[{"role":"user","content":"Reply with exactly the word pong and nothing else."}],"stream":false,"max_tokens":32,"temperature":0}' \
  "${BASE}/v1/chat/completions" || true)"
echo "HTTP ${nonstream_code}"
python3 - "$nonstream_body" <<'PY' || true
import json, sys
path = sys.argv[1]
raw = open(path, encoding="utf-8", errors="replace").read()
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
print("role:", msg.get("role"))
print("content:", content[:500])
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
stream_code="$(curl -sS -N -o "$stream_body" -w "%{http_code}" "${AUTH[@]}" "${JSON[@]}" \
  -d '{"model":"ornith","messages":[{"role":"user","content":"Count from 1 to 8, digits only, spaces between."}],"stream":true,"max_tokens":64,"temperature":0}' \
  "${BASE}/v1/chat/completions" || true)"
echo "HTTP ${stream_code}"
echo "-- SSE lines (data:) --"
grep -E '^data:' "$stream_body" || true
echo "-- end SSE dump --"
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
