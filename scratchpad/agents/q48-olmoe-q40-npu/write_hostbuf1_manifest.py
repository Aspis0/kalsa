#!/usr/bin/env python3
import hashlib
from pathlib import Path

DEST = Path(r"results/htp_probe/s23_v73_olmoe_q40/hostbuf1")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(8 * 1024 * 1024)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def main() -> None:
    rows = []
    for p in sorted(DEST.rglob("*")):
        if not p.is_file() or p.name == "MANIFEST.md":
            continue
        rel = p.relative_to(DEST).as_posix()
        rows.append((rel, p.stat().st_size, sha256_file(p)))
    lines = [
        "# S23 v73 OLMoE HOSTBUF=1 confound-closer — MANIFEST",
        "",
        "REGISTRA+DICHIARA. Mirrors houji: GGML_HEXAGON_HOSTBUF=1, --no-host 1, NDEV=1, VERBOSE=1.",
        "llama-bench @3f545be / stub 5db18906. HTP lib remains v73 c8f9d14a.",
        "SHA256 Python hashlib.",
        "",
        "| path | bytes | sha256 |",
        "|---|---:|---|",
    ]
    for rel, n, d in rows:
        lines.append(f"| {rel} | {n} | {d} |")
    lines.append("")
    (DEST / "MANIFEST.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote MANIFEST n_files={len(rows)}")


if __name__ == "__main__":
    main()
