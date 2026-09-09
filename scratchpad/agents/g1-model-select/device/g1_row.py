#!/usr/bin/env python3
"""Row builder for run_device_subset.sh (pure python, no adb).

Two subcommands, both append one JSON line to stdout:

  g1_row.py turn <user_text> <status> <ev_file> <messages_json>
      -> one turn record. <status> is ok|reply_timeout|send_failed.
      <ev_file> holds the turn's logcat evidence (KALSA_TELEMETRY /
      KALSA_TOOLCALL lines). <messages_json> is the RKStorage messages array
      pulled right after the wait: the reply is the last assistant message
      that follows the last user message whose text equals <user_text>.

  g1_row.py case <case_id> <model> <phone> <lang> <category>
             <epoch_started> <epoch_ended> <pre_file> <ready_file> <end_file>
             <turns_jsonl> <conversation_id>
      -> one case record merging the per-turn records with device state
      (thermal/RSS/battery from the key=value snapshot files).

Timeouts and send failures are recorded, never dropped.
"""

import json
import os
import re
import sys


def load_messages(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def parse_state_file(path):
    """key=value or proc-status 'Key:\tvalue' lines -> dict of strings."""
    state = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                for sep in ("=", ":"):
                    if sep in line:
                        key, value = line.split(sep, 1)
                        state[key.strip()] = value.strip()
                        break
    except Exception:
        pass
    return state


def last_telemetry(ev_path):
    """Last parseable KALSA_TELEMETRY JSON of the turn (the synthesis round)."""
    found = None
    try:
        with open(ev_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                marker = "KALSA_TELEMETRY "
                idx = line.find(marker)
                if idx < 0:
                    continue
                try:
                    found = json.loads(line[idx + len(marker):].strip())
                except Exception:
                    continue
    except Exception:
        pass
    return found


def tool_rounds(ev_path):
    """KALSA_TOOLCALL lines -> [{round, executed, failed, toolNames, ...}]."""
    rounds = []
    try:
        with open(ev_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                marker = "KALSA_TOOLCALL "
                idx = line.find(marker)
                if idx < 0:
                    continue
                try:
                    payload = json.loads(line[idx + len(marker):].strip())
                except Exception:
                    continue
                if isinstance(payload, dict):
                    rounds.append(payload)
    except Exception:
        pass
    return rounds


def turn_row(user_text, status, ev_path, messages_path):
    messages = load_messages(messages_path)
    reply = None
    reply_raw = None
    # Reply = assistant messages stored after the last user message whose text
    # is the delivered turn (a partial reply may survive an interrupt).
    last_user = -1
    for i, msg in enumerate(messages):
        if isinstance(msg, dict) and msg.get("role") == "user" and msg.get("text") == user_text:
            last_user = i
    tail = messages[last_user + 1:] if last_user >= 0 else []
    for msg in reversed(tail):
        if isinstance(msg, dict) and msg.get("role") == "assistant":
            if isinstance(msg.get("text"), str) and msg["text"].strip():
                reply = msg["text"]
                reply_raw = msg.get("modelEmittedText")
                break
            break
    telemetry = last_telemetry(ev_path)
    rounds = tool_rounds(ev_path)
    tool_names = []
    for r in rounds:
        names = r.get("toolNames") or []
        if r.get("executed", 0) >= 1:
            tool_names.extend(names)
    executed_names = sorted(set(tool_names))
    return {
        "user": user_text,
        "status": status,
        "reply": reply,
        "reply_raw": reply_raw,
        "telemetry": telemetry,
        "toolcall_rounds": rounds,
        "tool_names_executed": executed_names,
        "tools_requested": sorted({n for r in rounds for n in (r.get("toolNames") or [])}),
    }


def parse_engine_evidence(path):
    """KALSA_NATIVE_VARIANT + llama_model_loader lines -> dict."""
    info = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if "KALSA_NATIVE_VARIANT" in line and "androidLib" not in info:
                    try:
                        payload = json.loads(line.split("KALSA_NATIVE_VARIANT ", 1)[1].strip())
                        if isinstance(payload, dict):
                            info.update(payload)
                    except Exception:
                        pass
                if "llama_model_loader: loaded meta data" in line and "model_path" not in info:
                    tail = line.split(" from ", 1)[1].strip() if " from " in line else ""
                    info["model_path"] = tail
    except Exception:
        pass
    return info


def case_row(case_id, model, phone, lang, category, epoch_started, epoch_ended,
             pre_path, ready_path, end_path, turns_path, conversation_id, engine_ev_path=""):
    pre = parse_state_file(pre_path)
    ready = parse_state_file(ready_path)
    end = parse_state_file(end_path)
    turns = []
    try:
        with open(turns_path, encoding="utf-8") as f:
            turns = [json.loads(line) for line in f if line.strip()]
    except Exception:
        pass
    for t in turns:
        if isinstance(t.get("reply_raw"), str):
            t["reply_raw"] = t["reply_raw"][:20000]
        if isinstance(t.get("reply"), str):
            t["reply"] = t["reply"][:20000]
    # Case status: worst turn outcome wins (ok < reply_timeout < send_failed < not_run).
    order = {"ok": 0, "reply_timeout": 1, "send_failed": 2, "not_run": 3}
    worst = max((order.get(t.get("status"), 4) for t in turns), default=4) if turns else 4
    status = {0: "ok", 1: "reply_timeout", 2: "send_failed", 3: "not_run", 4: "no_turns"}[worst]
    return {
        "id": case_id,
        "model": model,
        "phone": phone,
        "lang": lang,
        "category": category,
        "split": "dev",
        "conversation_id": conversation_id,
        "engine": parse_engine_evidence(engine_ev_path),
        "status": status,
        "duration_s": int(epoch_ended or 0) - int(epoch_started or 0),
        "state": {
            "pre": {"thermal_status": pre.get("thermal_status"),
                    "battery_deci": pre.get("battery_deci"),
                    "battery_c": pre.get("battery_c"),
                    "battery_level": pre.get("battery_level")},
            "ready": {"rss_kb": ready.get("VmRSS"),
                      "vmhwm_kb": ready.get("VmHWM"),
                      "vmswap_kb": ready.get("VmSwap"),
                      "cpuset": ready.get("cpuset"),
                      "wakefulness": ready.get("wakefulness"),
                      "thermal_status": ready.get("thermal_status"),
                      "battery_deci": ready.get("battery_deci")},
            "end": {"rss_kb": end.get("VmRSS"),
                    "thermal_status": end.get("thermal_status"),
                    "battery_deci": end.get("battery_deci")},
        },
        "turns": turns,
    }


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "turn" and len(sys.argv) == 6:
        _, _, user_text, status, ev_path, messages_path = sys.argv
        row = turn_row(user_text, status, ev_path, messages_path)
    elif cmd == "case" and len(sys.argv) in (14, 15):
        args = sys.argv[2:]
        engine_ev = args.pop() if len(args) == 13 else ""
        (case_id, model, phone, lang, category, epoch_started,
         epoch_ended, pre_path, ready_path, end_path, turns_path, conversation_id) = args
        row = case_row(case_id, model, phone, lang, category, epoch_started,
                       epoch_ended, pre_path, ready_path, end_path,
                       turns_path, conversation_id, engine_ev)
    else:
        print("g1_row.py: bad arguments", file=sys.stderr)
        return 2
    print(json.dumps(row, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
