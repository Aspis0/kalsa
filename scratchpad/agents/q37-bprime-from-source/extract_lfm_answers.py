#!/usr/bin/env python3
import json
from pathlib import Path

HERE = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q37-bprime-from-source")
ARMS = ["control", "q8_0", "iq4_nl", "q4_0"]
SUITES = {
    "sanity": ["q1_f1_spa2000", "q2_tabellina9", "q3_regalo", "q4_vocali"],
    "long": [
        "f45_1_esplicativo",
        "f45_3_istruzioni",
        "f45_4_codice",
        "f45_5_ragionamento",
        "f45_2_scrittura",
        "long_conversational_it",
    ],
}


def main() -> int:
    for suite, names in SUITES.items():
        gen = HERE / "ab" / "lfm" / suite / "gen"
        lines = [
            f"# LFM A/B {suite} — visible text, else reasoning",
            "",
            "LFM2.5-8B-A1B often fills `reasoning` and leaves `text` empty even with `--no-think`.",
            "Score the extracted body, not the empty .txt files.",
            "",
        ]
        for name in names:
            lines += ["---", f"## {name}", ""]
            for arm in ARMS:
                p = gen / f"{name}__{arm}.json"
                if not p.exists():
                    lines += [f"### {arm}", "", "(mancante json)", ""]
                    continue
                d = json.loads(p.read_text(encoding="utf-8"))
                text = (d.get("text") or "").strip()
                reas = (d.get("reasoning") or "").strip()
                body = text if text else reas
                src = "text" if text else ("reasoning" if reas else "empty")
                tok = d.get("tokens")
                lines += [
                    f"### {arm}  [{src} tokens={tok}]",
                    "",
                    "```",
                    body or "(vuoto)",
                    "```",
                    "",
                ]
        out = HERE / "ab" / "lfm" / suite / "ANSWERS_EXTRACTED.md"
        out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
