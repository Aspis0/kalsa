#!/usr/bin/env python3
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
QUALITY_ROOT = Path("/Users/marco/Projects/kalsa/scripts/quality")


def main():
    source = ROOT / "results/bakeoff-v2d/minicpm-q8@nobudget.jsonl"
    with tempfile.TemporaryDirectory(prefix="g1-v2d-") as temp:
        temp_path = Path(temp)
        shutil.copyfile(source, temp_path / "minicpm-q8@nobudget.jsonl")
        report = subprocess.run(
            ["node", str(QUALITY_ROOT / "report.mjs"), "--out", str(temp_path)],
            text=True, capture_output=True,
        )
        output = ROOT / "results/score-v2d-q8-nobudget.txt"
        output.write_text(report.stdout + report.stderr, encoding="utf-8")
        print(f"report_rc={report.returncode} score_file={output}")
        if report.returncode:
            return report.returncode
    print("wild_rubric_rows=16 (excluded from deterministic pass rate)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
