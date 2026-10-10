#!/usr/bin/env python3
"""Count distinct completed T20C turns and their non-completion markers."""

import json
import sys


def main(path):
    turns = set()
    toolcaps = set()
    no_answer = set()
    recoveries = 0
    unparseable = 0
    try:
        stream = open(path, encoding="utf-8")
    except OSError:
        print("0 0 0 0 0")
        return
    with stream:
        for line in stream:
            try:
                record = json.loads(line)
            except (TypeError, ValueError):
                unparseable += 1
                continue
            if not isinstance(record, dict):
                unparseable += 1
            elif "event" in record:
                recoveries += 1
            elif isinstance(record.get("i"), int) and not isinstance(record.get("i"), bool):
                turn = record["i"]
                if record.get("toolcap") is True:
                    toolcaps.add(turn)
                if record.get("toolcapNoAnswer") is True:
                    no_answer.add(turn)
                else:
                    turns.add(turn)
            else:
                unparseable += 1
    turns.difference_update(no_answer)
    print(len(turns), len(toolcaps), len(no_answer), recoveries, unparseable)


if __name__ == "__main__":
    main(sys.argv[1])
