import csv
from pathlib import Path

p = Path(__file__).resolve().parent / "machine_checks.csv"
rows = list(csv.DictReader(p.open(encoding="utf-8")))
print("=== LOOPS ===")
for r in rows:
    if r["loop"] == "1":
        print(r["arm"], r["id"], r["cat"], r["lang"], "chars", r["chars"])
print("=== LANG FAIL ===")
for r in rows:
    if r["lang_ok"] == "0":
        print(r["arm"], r["id"], r["cat"], "want", r["lang"], "got", r["lang_detected"])
print("=== FORMAT FAIL ===")
for r in rows:
    if r["format_ok"] == "0":
        print(r["arm"], r["id"], r["format_id"])
print("=== FORMAT PASS ===")
for r in rows:
    if r["format_ok"] == "1":
        print(r["arm"], r["id"], r["format_id"])
print("n_ids", len({r["id"] for r in rows}))
