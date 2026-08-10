#!/usr/bin/env python3
"""Rewrite campaign MODEL defaults from IQ2_M to KEXP. Historical A/B stay parametric via $MODEL."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OLD = "$HOME/models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf"
NEW = "$HOME/experiments/models/Qwen3.6-35B-A3B-KEXP.gguf"

pairs = [
    (f"${{MODEL:-{OLD}}}", f"${{MODEL:-{NEW}}}"),
    (f"${{MODEL35:-{OLD}}}", f"${{MODEL35:-{NEW}}}"),
    (f'MODEL="{OLD}"', f'MODEL="${{MODEL:-{NEW}}}"'),
    (f"MODEL={OLD}", f"MODEL=${{MODEL:-{NEW}}}"),
    (f'MODEL35="{OLD}"', f'MODEL35="${{MODEL35:-{NEW}}}"'),
    (f"MODEL35={OLD}", f"MODEL35=${{MODEL35:-{NEW}}}"),
    (
        "HOME / 'models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf'",
        "HOME / 'experiments/models/Qwen3.6-35B-A3B-KEXP.gguf'",
    ),
    (
        'os.environ.get(\'MODEL\', str(HOME / \'models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf\'))',
        'os.environ.get(\'MODEL\', str(HOME / \'experiments/models/Qwen3.6-35B-A3B-KEXP.gguf\'))',
    ),
]

dirs = [
    ROOT / "scripts",
    ROOT / "results" / "dropcold",
    ROOT / "results" / "buchi",
    ROOT / "results" / "spec_ladder",
    ROOT / "results" / "requant1c",
]
skip_parts = {"third_party", "from_phone", "node_modules", "__pycache__", "kexp_baseline"}
changed = []
for d in dirs:
    if not d.exists():
        continue
    for p in d.rglob("*"):
        if not p.is_file():
            continue
        if any(s in p.parts for s in skip_parts):
            continue
        if p.suffix not in {".sh", ".py", ".bat", ".ps1"} and p.name != "n1_driver.py":
            continue
        # leave pure historical size-gate scripts (F3) alone if they hard-check IQ2 size
        if p.name in {"run_f3.sh", "test_f3.sh"}:
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        orig = text
        for a, b in pairs:
            text = text.replace(a, b)
        if text != orig:
            p.write_text(text, encoding="utf-8", newline="\n")
            changed.append(str(p.relative_to(ROOT)))

out = ROOT / "results" / "kexp_baseline" / "path_rewrite_list.txt"
out.write_text("\n".join(changed) + "\n", encoding="utf-8")
print(f"CHANGED {len(changed)}")
for c in changed:
    print(c)
