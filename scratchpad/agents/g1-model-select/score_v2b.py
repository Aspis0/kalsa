#!/usr/bin/env python3
import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
KALSA = Path("/Users/marco/Projects/kalsa")


def read(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def merge(base_path, replacement_path, bakeoff=False):
    replacement = {}
    for row in read(replacement_path):
        key = f"{row['qid']}|{row['lang']}" if bakeoff else row["id"]
        replacement[key] = row
    out = []
    for row in read(base_path):
        key = f"{row['qid']}|{row['lang']}" if bakeoff else row["id"]
        out.append(replacement.get(key, row))
    return out


def write(path, rows):
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def main():
    with tempfile.TemporaryDirectory(prefix="kalsa-v2b-score-") as temp:
        temp = Path(temp)
        bakeoff_dir = temp / "bakeoff"
        bakeoff_dir.mkdir()
        wild_paths = []
        for model in ("lfm", "minicpm"):
            path = temp / f"{model}-wild.jsonl"
            write(path, merge(ROOT / "results" / "wild-v2" / f"{model}.jsonl", ROOT / "results" / "wild-v2b" / f"{model}.jsonl"))
            wild_paths.append(path)
        wild = subprocess.run(["python3", str(ROOT / "score.py"), *(str(path) for path in wild_paths)], text=True, capture_output=True)
        print("## Wild v2b merged score")
        print(wild.stdout, end="")
        if wild.stderr:
            print(wild.stderr, end="")
        if wild.returncode:
            return wild.returncode
        for model in ("lfm", "minicpm"):
            for budget in (256, 512):
                path = bakeoff_dir / f"{model}@{budget}.jsonl"
                write(path, merge(ROOT / "results" / "bakeoff-v2" / f"{model}@{budget}.jsonl", ROOT / "results" / "bakeoff-v2b" / f"{model}@{budget}.jsonl", bakeoff=True))
        report = subprocess.run(["node", str(KALSA / "scripts/quality/report.mjs"), "--out", str(bakeoff_dir)], text=True, capture_output=True)
        print("## Bake-off v2b merged score")
        print(report.stdout, end="")
        if report.stderr:
            print(report.stderr, end="")
        return report.returncode


if __name__ == "__main__":
    raise SystemExit(main())
