#!/usr/bin/env python3
"""Delete OUR source download and non-winning variants for one model.

Never touches models/, q36 artifacts, or other pre-existing files.
Keep at most the winning GGUF (+ recipes/logs/ab texts).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

HERE = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q37-bprime-from-source")
SOURCES = {
    "marco": [
        HERE / "src" / "Marco-Mini-Instruct.Q8_0.gguf",
        HERE / "src" / "Marco-Mini-Instruct.imatrix.gguf",
    ],
    "olmoe": [
        HERE / "src" / "olmoe-1b-7b-0924-instruct-q8_0.gguf",
    ],
    "lfm": [
        HERE / "src" / "LFM2.5-8B-A1B-Q8_0.gguf",
        HERE / "src" / "LFM2.5-8B-A1B-F16.gguf",
    ],
}
PREFIX = {
    "marco": "Marco-Mini-Instruct-KEXP-fromsrc",
    "olmoe": "OLMoE-1B-7B-0924-Instruct-KEXP-fromsrc",
    "lfm": "LFM2.5-8B-A1B-KEXP-fromsrc",
}
ARMS = ("control", "q8_0", "iq4_nl", "q4_0")


def say(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%S')}] {msg}"
    log = HERE / "CLEANUP_LOG.md"
    if not log.exists():
        log.write_text("# q37 cleanup log\n\n", encoding="utf-8")
    with log.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def unlink(p: Path) -> int:
    if not p.exists():
        say(f"skip missing {p}")
        return 0
    n = p.stat().st_size
    # refuse to delete anything outside this cell
    try:
        p.resolve().relative_to(HERE.resolve())
    except ValueError:
        say(f"REFUSE delete outside cell: {p}")
        return 0
    p.unlink()
    say(f"deleted {p} bytes={n}")
    return n


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: cleanup_model.py marco|olmoe|lfm WINNER_ARM", file=sys.stderr)
        return 2
    model, winner = sys.argv[1], sys.argv[2]
    if model not in PREFIX or winner not in ARMS:
        print("bad model/winner", file=sys.stderr)
        return 2
    say(f"CLEANUP model={model} keep={winner}")
    freed = 0
    for p in SOURCES[model]:
        freed += unlink(p)
    gguf_dir = HERE / "gguf" / model
    for arm in ARMS:
        p = gguf_dir / f"{PREFIX[model]}-trunk-{arm}.gguf"
        if arm == winner:
            say(f"keep {p} bytes={p.stat().st_size if p.exists() else 0}")
            continue
        freed += unlink(p)
    rec = {"model": model, "winner": winner, "freed_bytes": freed}
    (HERE / f"CLEANUP_{model.upper()}.json").write_text(json.dumps(rec, indent=2), encoding="utf-8")
    say(f"DONE freed_bytes={freed} freed_GB={freed/(1024**3):.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
