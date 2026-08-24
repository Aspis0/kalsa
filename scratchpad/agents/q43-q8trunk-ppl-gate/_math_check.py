#!/usr/bin/env python3
"""q43 gate arithmetic: per-corpus d and verdicts from the JSON logs. PREREG thresholds."""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).parent
LOGS = HERE / "logs"
# Control-wiki REUSED from q41 per PREREG.md (same gguf/binary/settings).
CTRL_WIKI = {"ppl": 9.5915, "ppl_err": 0.07116, "n_chunks": 584, "source": "q41 ppl-control-wiki.json (reused per prereg)"}
CORPORA = ["wiki", "it", "es", "fr", "zh"]


def load(arm: str, corpus: str) -> dict:
    return json.loads((LOGS / f"ppl-{arm}-{corpus}.json").read_text(encoding="utf-8"))


def verdict(d: float) -> str:
    if d <= 0.5:
        return "PASS"
    if d <= 1.0:
        return "GREY"
    return "FAIL"


def main() -> int:
    lines = []
    verdicts = []
    for c in CORPORA:
        ctrl = CTRL_WIKI if c == "wiki" else load("control", c)
        q8 = load("q8_0", c)
        assert q8["rc"] == 0, (c, q8["rc"])
        if c != "wiki":
            assert ctrl["rc"] == 0, (c, ctrl["rc"])
        assert q8["n_chunks"] >= 100 and ctrl["n_chunks"] >= 100, (c, ctrl["n_chunks"], q8["n_chunks"])
        d = 100.0 * (q8["ppl"] - ctrl["ppl"]) / ctrl["ppl"]
        v = verdict(d)
        verdicts.append(v)
        lines.append(
            f"{c}: control={ctrl['ppl']}+/-{ctrl.get('ppl_err')} (n={ctrl['n_chunks']}) "
            f"q8_0={q8['ppl']}+/-{q8.get('ppl_err')} (n={q8['n_chunks']}) d={d:+.3f}% -> {v}"
        )
    if all(v == "PASS" for v in verdicts):
        overall = "PASS"
    elif any(v == "FAIL" for v in verdicts):
        overall = "FAIL"
    else:
        overall = "GREY"
    lines.append(f"OVERALL: {overall} (prereg: PASS iff all five PASS)")
    out = "\n".join(lines) + "\n"
    (HERE / "_math_check.txt").write_text(out, encoding="utf-8")
    print(out, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
