#!/usr/bin/env bash
set +e

root="$(cd "$(dirname "$0")/.." && pwd)"
tmpdir="$(mktemp -d)"
port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
python3 "$root/tests/stub_server.py" --port "$port" >/dev/null 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null; find "$tmpdir" -depth -delete 2>/dev/null' EXIT
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then break; fi
  sleep 0.1
done

python3 "$root/run_corpus.py" \
  --base-url "http://127.0.0.1:$port" \
  --model-label stub \
  --split dev \
  --sampler "$root/samplers/lfm.json" \
  --system-prompt-en-file "$root/system-prompt-en.txt" \
  --system-prompt-it-file "$root/system-prompt-it.txt" \
  --corpus "$root/tests/fixture.jsonl" \
  --out "$tmpdir/runner.jsonl" \
  --retry-delay 0 | tail -5
runner_code=${PIPESTATUS[0]}
python3 - "$tmpdir/runner.jsonl" <<'PY'
import json
import sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf-8")]
assert len(rows) == 6
assert all(row["check"]["status"] == "PASS" for row in rows)
assert rows[4]["tool_call_mode"] == "structured"
assert rows[5]["assistant_text"] == "4"
assert "hidden arithmetic" not in rows[5]["assistant_text"]
PY
assert_code=$?
python3 "$root/validate.py" "$root/corpus/cases.jsonl" >/dev/null
validate_code=$?
python3 "$root/score.py" "$tmpdir/runner.jsonl" >"$tmpdir/score.txt"
score_code=$?
grep -q $'stub\t' "$tmpdir/score.txt"
score_assert_code=$?
echo "runner_exit_code=$runner_code"
echo "assert_exit_code=$assert_code"
echo "validate_exit_code=$validate_code"
echo "score_exit_code=$score_code"
echo "score_assert_exit_code=$score_assert_code"
exit $((runner_code || assert_code || validate_code || score_code || score_assert_code))
