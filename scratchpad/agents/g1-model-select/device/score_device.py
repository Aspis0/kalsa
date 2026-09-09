#!/usr/bin/env python3
"""Score on-device G1 runs produced by run_device_subset.sh.

Applies checks.py (the Mac grader) to the DEVICE replies of each case row:
the raw reply (modelEmittedText, think included) is fed through
checks.strip_reasoning exactly like the Mac runner feeds raw_response content,
then the corpus check runs on it. Differences, all declared:

- tool cases (subset-24.cases.jsonl `check == "device_toolcall"`) are scored
  from the turn's KALSA_TOOLCALL evidence: PASS iff the expected app tool name
  appears with executed >= 1 in this case's last turn. Argument equality is
  not verifiable on-device (telemetry is privacy-safe by design).
- interrupted/timeout/send-failed turns keep their row and score ERROR with
  the reason (never dropped).

usage: score_device.py <out.jsonl>... --cases <cases-file>
"""

import argparse
import json
import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")
from checks import check_response, strip_reasoning  # noqa: E402

ORDER = {"ok": 0, "reply_timeout": 1, "send_failed": 2, "not_run": 3}


def build_response(raw_text):
    return {"choices": [{"message": {"content": raw_text if isinstance(raw_text, str) else ""}}]}


def score_row(row, cases):
    case = cases.get(row.get("id"))
    scored = row.get("turns") or []
    last = scored[-1] if scored else {}
    reply_raw = last.get("reply_raw") or last.get("reply")
    cleaned = strip_reasoning(reply_raw if isinstance(reply_raw, str) else "")

    if not case:
        return {"status": "ERROR", "detail": "case not in cases file"}
    if row.get("status") != "ok":
        return {"status": "ERROR", "detail": row.get("status", "unknown") + " (never dropped)"}
    if not scored or last.get("status") != "ok":
        return {"status": "ERROR", "detail": "scored turn missing or not ok"}
    if not reply_raw:
        return {"status": "ERROR", "detail": "empty reply persisted"}

    if case.get("check") == "device_toolcall":
        expected = (case.get("check_payload") or {}).get("tool")
        executed = set(last.get("tool_names_executed") or [])
        requested = set(last.get("tools_requested") or [])
        if expected in executed:
            return {"status": "PASS", "detail": f"tool {expected} executed"}
        return {
            "status": "FAIL",
            "detail": f"expected tool {expected}; executed={sorted(executed)} requested={sorted(requested)}",
        }
    return check_response(case, build_response(reply_raw))


def timing(row):
    """(promptMs, predictedPerSecond) of the scored turn, or (None, None)."""
    turns = row.get("turns") or []
    last = turns[-1] if turns else {}
    tel = last.get("telemetry") or {}
    return tel.get("promptMs"), tel.get("predictedPerSecond")


def phone_label(serial):
    # Protocol phones: Jelly Star over USB; the S23 over wireless ADB.
    if "JELLY" in (serial or "").upper():
        return "Jelly"
    return "S23"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("results", nargs="+", help="run_device_subset.sh out.jsonl files")
    parser.add_argument("--cases", required=True, help="subset-24.cases.jsonl (checks source)")
    args = parser.parse_args()

    cases = {}
    for line in open(args.cases, encoding="utf-8"):
        if line.strip():
            c = json.loads(line)
            cases[c["id"]] = c

    rows = []
    for path in args.results:
        for line in open(path, encoding="utf-8"):
            if line.strip():
                rows.append(json.loads(line))

    counts = defaultdict(lambda: defaultdict(int))
    failures = []
    timings = defaultdict(list)
    for row in rows:
        model = row.get("model", "?")
        phone = phone_label(row.get("phone", "?"))
        key = (model, phone, row.get("lang", "?"), row.get("category", "?"))
        verdict = score_row(row, cases)
        counts[key][verdict["status"]] += 1
        if verdict["status"] in ("FAIL", "ERROR"):
            failures.append((model, phone, row.get("id", "?"), verdict["status"], verdict["detail"]))
        prompt_ms, tok_s = timing(row)
        if prompt_ms is not None and isinstance(prompt_ms, (int, float)) and prompt_ms > 0:
            timings[(model, phone)].append(("promptMs", prompt_ms))
        if tok_s is not None and isinstance(tok_s, (int, float)) and tok_s > 0:
            timings[(model, phone)].append(("tok_s", tok_s))

    print(f"rows={len(rows)} cases={len(cases)}")
    print("model\tphone\tlang\tcategory\tpass\tfail\trubric\terror")
    for key in sorted(counts):
        c = counts[key]
        print(f"{key[0]}\t{key[1]}\t{key[2]}\t{key[3]}\t{c['PASS']}\t{c['FAIL']}\t{c['RUBRIC']}\t{c['ERROR']}")

    print("model\tphone\tmetric\tmedian\tmax\tn")
    for (model, phone), pairs in sorted(timings.items()):
        by_metric = defaultdict(list)
        for metric, value in pairs:
            by_metric[metric].append(value)
        for metric in ("promptMs", "tok_s"):
            values = sorted(by_metric.get(metric, []))
            if values:
                print(f"{model}\t{phone}\t{metric}\t{statistics.median(values):.1f}\t{max(values):.1f}\t{len(values)}")
            else:
                print(f"{model}\t{phone}\t{metric}\t-\t-\t0")

    print("failures")
    if failures:
        for model, phone, case_id, status, detail in failures:
            print(f"{model}\t{phone}\t{case_id}\t{status}\t{detail}")
    else:
        print("none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
