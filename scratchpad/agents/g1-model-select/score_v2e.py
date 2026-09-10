#!/usr/bin/env python3
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
QUALITY = Path("/Users/marco/Projects/kalsa/scripts/quality")


def main():
    for budget in ("1024", "nobudget"):
        source = ROOT / "results" / f"bakeoff-v2e-{budget}" / f"lfm@{budget}.jsonl"
        with tempfile.TemporaryDirectory(prefix=f"g1-v2e-{budget}-") as temp:
            temp = Path(temp)
            shutil.copyfile(source, temp / f"lfm@{budget}.jsonl")
            result = subprocess.run(
                ["node", str(QUALITY / "report.mjs"), "--out", str(temp)],
                text=True, capture_output=True,
            )
            output = ROOT / "results" / f"score-v2e-{budget}.txt"
            output.write_text(result.stdout + result.stderr, encoding="utf-8")
            print(f"{budget}: report_rc={result.returncode} score={output}")
            if result.returncode:
                return result.returncode
        wild = ROOT / "results" / f"wild-v2e-{budget}" / f"lfm@{budget}.jsonl"
        print(f"{budget}: wild_rubric_rows={sum(1 for line in wild.open() if line.strip())} excluded from deterministic pass rate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
