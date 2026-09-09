#!/usr/bin/env python3
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
QUALITY_ROOT = Path("/Users/marco/Projects/kalsa/scripts/quality")


def main():
    for budget in ("1024", "nobudget"):
        with tempfile.TemporaryDirectory(prefix=f"g1-v2c-{budget}-") as temp:
            temp_path = Path(temp)
            source = ROOT / "results" / "bakeoff-v2c" / f"minicpm@{budget}.jsonl"
            shutil.copyfile(source, temp_path / f"minicpm@{budget}.jsonl")
            report = subprocess.run(
                ["node", str(QUALITY_ROOT / "report.mjs"), "--out", str(temp_path)],
                text=True, capture_output=True,
            )
            out = ROOT / "results" / f"score-v2c-{budget}.txt"
            out.write_text(report.stdout + report.stderr, encoding="utf-8")
            print(f"{budget}: report_rc={report.returncode} score_file={out}")
            if report.returncode:
                return report.returncode
        wild = ROOT / "results" / "wild-v2c" / f"minicpm@{budget}.jsonl"
        print(f"{budget}: wild_rubric_rows=16 (excluded from deterministic pass rate)")
        print(f"{budget}: bakeoff score is in results/score-v2c-{budget}.txt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
