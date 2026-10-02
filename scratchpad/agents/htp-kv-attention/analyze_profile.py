#!/usr/bin/env python3
"""Summarise a profiled llama-bench log (GGML_HEXAGON_PROFILE=1,
GGML_SCHED_DEBUG=2, -v): HTP microseconds per op from `profile-op` lines and
the scheduler's per-op backend placement from `node #N (OP): ... [ BACKEND ]`
lines. Usage: analyze_profile.py <log> [<log> ...]"""

import collections
import re
import sys

PROFILE_OP = re.compile(r"ggml-hex: HTP0 profile-op (\w+)\|.*\|usec (\d+) ")
NODE = re.compile(r"^node #\s*\d+ \(\s*(\w+)\):\s+.*?\[\s*(\w+)\s*\]")


def summarise(path):
    usec = collections.Counter()
    calls = collections.Counter()
    placement = collections.Counter()
    with open(path, errors="replace") as f:
        for line in f:
            if m := PROFILE_OP.search(line):
                usec[m.group(1)] += int(m.group(2))
                calls[m.group(1)] += 1
            elif m := NODE.match(line):
                placement[(m.group(1), m.group(2))] += 1
    total = sum(usec.values()) or 1
    print(f"== {path}")
    print("htp_op\tcalls\tusec_total\tshare_of_htp_time")
    for op, us in usec.most_common():
        print(f"{op}\t{calls[op]}\t{us}\t{us / total:.1%}")
    print(f"HTP_TOTAL_USEC\t{total}")
    print("sched_op\tbackend\tnodes")
    for (op, be), n in sorted(placement.items()):
        print(f"{op}\t{be}\t{n}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        summarise(p)
