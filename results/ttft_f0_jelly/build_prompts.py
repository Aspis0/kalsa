#!/usr/bin/env python3
"""Build fixed C1/C2/C3/C4 prompt files from repo text. No model load."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "prompts"

# ~3.75 chars/token on this Qwen3.5 tokenizer (short.txt 454 B -> ~121 tok).
# Targets are approximate; the run records actual n_prompt from BMOE_DONE.
TARGETS = {
    "c2_256": 960,
    "c2_1024": 3840,
    "c2_2048": 7680,
    "c2_4000": 15000,
}

SOURCES = [
    ROOT / "prompts" / "d1_long.txt",
    ROOT / "prompts" / "f45_1_esplicativo.txt",
    ROOT / "prompts" / "f45_2_scrittura.txt",
    ROOT / "prompts" / "f45_3_istruzioni.txt",
    ROOT / "prompts" / "f45_4_codice.txt",
    ROOT / "prompts" / "f45_5_ragionamento.txt",
    ROOT / "prompts" / "long_conversational_it.txt",
    ROOT / "BigMoeOnEdge" / "docs" / "session.md",
    ROOT / "reports" / "moe-g99-freetier.md",
]


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def load_source() -> str:
    chunks: list[str] = []
    for p in SOURCES:
        text = p.read_text(encoding="utf-8", errors="replace").strip()
        chunks.append(f"### source {p.name}\n{text}\n")
    body = "\n".join(chunks)
    # Conversation-shaped wrapper so C2 looks like a dumped chat log.
    header = (
        "You are continuing a long technical support chat on a phone.\n"
        "The transcript below is the conversation so far.\n\n"
    )
    # Repeat the body until we cover the longest target with margin.
    need = max(TARGETS.values()) + 512
    parts = [header]
    n = 0
    turn = 1
    while n < need:
        block = (
            f"User (turn {turn}): please continue from this material.\n"
            f"{body}\n"
            f"Assistant (turn {turn}): acknowledged, continuing.\n\n"
        )
        parts.append(block)
        n += len(block)
        turn += 1
    return "".join(parts)


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    src = load_source()

    c1 = "Reply with the single word: hello."
    write(OUT / "c1_trivial.txt", c1)

    slices: dict[str, str] = {}
    for name, nchar in TARGETS.items():
        text = src[:nchar]
        # Keep a stable ending so slices are prefixes of each other
        # except for the wrapper length; c2_256 is a prefix of c2_1024, etc.
        write(OUT / f"{name}.txt", text)
        slices[name] = text

    prefix = slices["c2_2048"]
    write(OUT / "c3_prefix.txt", prefix)

    t2_new = (
        "Follow-up only: in two short sentences, name the last concrete "
        "detail you were given and say whether the night train is still "
        "the working example. Do not repeat the transcript."
    )
    write(OUT / "c3_t2_new.txt", t2_new)

    # C3 turn-2 payload if someone wants the literal "prefix + 64 new tokens"
    # as a single string (used as the NEW user message only in the harness).
    write(OUT / "c3_t2_append.txt", t2_new)

    # C4: flip 8 bytes early in the prefix (after the short header), simulating
    # a timestamp / memory injection that lands near the start of the transcript.
    mutated = bytearray(prefix.encode("utf-8"))
    # Skip the first 40 bytes (stable header) then overwrite 8 ASCII bytes.
    pos = 48
    stamp = b"TS=99:99"
    if pos + len(stamp) > len(mutated):
        raise SystemExit("prefix too short to mutate")
    mutated[pos : pos + len(stamp)] = stamp
    mutated_text = mutated.decode("utf-8")
    write(OUT / "c4_prefix_flipped.txt", mutated_text)
    write(OUT / "c4_t2_mutated.txt", mutated_text + "\n\n" + t2_new)

    # JSONL helpers (prompts embedded) for the session harness.
    def gen_line(i: int, prompt: str, clear_kv: bool) -> str:
        return json.dumps(
            {
                "cmd": "generate",
                "id": i,
                "prompt": prompt,
                "n_predict": 8,
                "think": False,
                "clear_kv": clear_kv,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )

    close = json.dumps({"cmd": "close"}, separators=(",", ":"))

    oneshots = {
        "c1_trivial.jsonl": c1,
        "c2_256.jsonl": slices["c2_256"],
        "c2_1024.jsonl": slices["c2_1024"],
        "c2_2048.jsonl": slices["c2_2048"],
        "c2_4000.jsonl": slices["c2_4000"],
    }
    for name, prompt in oneshots.items():
        write(OUT / name, gen_line(1, prompt, True) + "\n" + close + "\n")

    c3 = gen_line(1, prefix, True) + "\n" + gen_line(2, t2_new, False) + "\n" + close + "\n"
    write(OUT / "c3_reuse.jsonl", c3)

    # C4: T1 identical to C3; T2 sends the mutated FULL prefix + 64-token
    # follow-up as the new user message (app resubmits a rewritten transcript).
    c4 = (
        gen_line(1, prefix, True)
        + "\n"
        + gen_line(2, mutated_text + "\n\n" + t2_new, False)
        + "\n"
        + close
        + "\n"
    )
    write(OUT / "c4_broken.jsonl", c4)

    sha_path = OUT / "SHA256SUMS.txt"
    lines = []
    for p in sorted(OUT.iterdir()):
        if p.name == "SHA256SUMS.txt":
            continue
        lines.append(f"{sha256_file(p)}  {p.name}")
    sha_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(sha_path.read_text(encoding="utf-8"))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
