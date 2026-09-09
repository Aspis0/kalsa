#!/usr/bin/env python3
"""Deterministic 24-case subset for the on-device G1 protocol.

WRITTEN RULE (this file is the rule; SUBSET-24.md documents it):

Pool: corpus/cases.jsonl, split == "dev" only. Documents are excluded by
declaration (library import is tested separately). No holdout.

1. conversation  -> the first 4 IT and the first 3 EN dev ids in corpus order.
2. instructions  -> the first 4 IT and the first 7 EN dev ids in corpus order.
   (EN quota exceeds 3 on purpose: tool-slot ids that cannot exist are
   re-allocated here -- see note 4. Every EN instruction slot is a
   deterministic 1-turn format case.)
3. tools         -> dev ids whose DECLARED tool is offline-capable in the app
   catalog (tools-app-default.json): calculator.calculate -> device_calc
   (T09), notes.save -> write_note (T11). These are the ONLY two: the corpus
   audit (CORPUS.AUDIT.md T01-T16) shows every other dev tool case declares
   tools the app does not expose (weather.*, calendar.*, reminder.*,
   shipping.*, finance.*, web.search, music.*). device_info and
   create_miniapp have no corpus case at all. No EN offline tool case exists.
4. memory         -> the first 2 IT and the first 2 EN dev ids in corpus
   order. All four are 4-user-turn regex cases (deterministic, unattended).

Arithmetic: IT = 4 + 4 + 2 + 2 = 12, EN = 3 + 7 + 0 + 2 = 12, total 24.
The declared 7/7/6/4 quota cannot be met from the dev split under the
offline-tool restriction (tools would need 6 ids; only 2 exist and both are
IT). The 4 missing EN tool ids are re-allocated to deterministic EN
instructions (I08, I10, I12, I14), documented in SUBSET-24.md.

For each tool id the generated case file carries an `app_tool` contract:
the tool the device model must call. The corpus check_payload (fictional
tool_name const) is NOT applicable on-device; scoring uses KALSA_TOOLCALL
toolNames evidence instead (score_device.py).
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(ROOT, "..", "corpus", "cases.jsonl")
TOOLS_APP = os.path.join(ROOT, "..", "tools-app-default.json")
OUT_IDS = os.path.join(ROOT, "subset-24.txt")
OUT_CASES = os.path.join(ROOT, "subset-24.cases.jsonl")

# Declared tool name (corpus) -> offline-capable app tool it maps to.
OFFLINE_TOOL_MAP = {
    "calculator.calculate": "device_calc",
    "notes.save": "write_note",
}

QUOTAS = {
    "conversation": {"it": 4, "en": 3},
    "instructions": {"it": 4, "en": 7},
    "memory": {"it": 2, "en": 2},
}


def load_corpus(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def main():
    cases = load_corpus(CORPUS)
    dev = [c for c in cases if c["split"] == "dev"]
    by_cat = {}
    for c in dev:
        by_cat.setdefault(c["category"], []).append(c)

    selected = []
    for cat, quota in QUOTAS.items():
        for lang, want in quota.items():
            picked = [c for c in by_cat[cat] if c["lang"] == lang][:want]
            if len(picked) != want:
                print(f"ERROR: category={cat} lang={lang} needs {want}, found {len(picked)}", file=sys.stderr)
                sys.exit(1)
            selected.extend(picked)

    tool_ids = []
    for c in by_cat["tools"]:
        declared = {t["function"]["name"] for t in c.get("tools", [])}
        mapped = [OFFLINE_TOOL_MAP[d] for d in declared if d in OFFLINE_TOOL_MAP]
        if mapped and c["lang"] == "it":  # the only offline tool cases are IT
            tool_ids.append(c)
    selected.extend(tool_ids)

    selected.sort(key=lambda c: c["id"])
    ids = [c["id"] for c in selected]
    if len(ids) != 24:
        print(f"ERROR: selected {len(ids)} ids, want 24", file=sys.stderr)
        sys.exit(1)
    langs = [c["lang"] for c in selected]
    if langs.count("it") != 12 or langs.count("en") != 12:
        print(f"ERROR: language balance {langs.count('it')}/{langs.count('en')}", file=sys.stderr)
        sys.exit(1)

    app_tools = json.load(open(TOOLS_APP, encoding="utf-8"))
    by_name = {t["function"]["name"]: t for t in app_tools}
    rows = []
    for c in selected:
        row = dict(c)  # shallow copy; turns/check untouched for non-tools
        if c["category"] == "tools":
            declared = {t["function"]["name"] for t in c.get("tools", [])}
            app = [OFFLINE_TOOL_MAP[d] for d in declared if d in OFFLINE_TOOL_MAP]
            row["tools"] = [by_name[app[0]]]
            row["app_tool"] = app[0]
            row["check"] = "device_toolcall"  # scored from KALSA_TOOLCALL
            row["check_payload"] = {"tool": app[0]}
            row["adaptation"] = (
                f"corpus tool {sorted(declared)} has no app equivalent; device contract is "
                f"the app tool {app[0]} (tools-app-default.json). Arguments are not "
                "verifiable on-device: tool telemetry is privacy-safe (names only)."
            )
        rows.append(row)

    with open(OUT_IDS, "w", encoding="utf-8") as f:
        f.write("\n".join(ids) + "\n")
    with open(OUT_CASES, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    from collections import Counter
    print(f"ids   : {','.join(ids)}")
    print(f"counts: {dict(Counter((c['category'], c['lang']) for c in rows))}")
    print(f"wrote : {OUT_IDS}")
    print(f"wrote : {OUT_CASES}")


if __name__ == "__main__":
    raise SystemExit(main())
