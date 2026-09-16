#!/usr/bin/env python3
"""UI helpers: coords, widest label, empty-chat check."""
import re
import sys


def nodes(xml: str, needle: str):
    pats = [
        re.compile(
            r'<node [^>]*?(?:content-desc|text)="[^"]*%s[^"]*"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
            % re.escape(needle)
        ),
        re.compile(
            r'<node [^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?(?:content-desc|text)="[^"]*%s[^"]*"'
            % re.escape(needle)
        ),
    ]
    seen = set()
    out = []
    for pat in pats:
        for m in pat.finditer(xml):
            g = tuple(map(int, m.groups()))
            if g in seen:
                continue
            seen.add(g)
            x1, y1, x2, y2 = g
            out.append((x1, y1, x2, y2, (x1 + x2) // 2, (y1 + y2) // 2, x2 - x1, y2 - y1))
    return out


def main() -> int:
    cmd = sys.argv[1]
    path = sys.argv[2]
    xml = open(path, encoding="utf-8", errors="replace").read()
    if cmd == "coords":
        ns = nodes(xml, sys.argv[3])
        if not ns:
            return 1
        print(f"{ns[0][4]} {ns[0][5]}")
        return 0
    if cmd == "widest":
        needle = sys.argv[3]
        min_w = int(sys.argv[4]) if len(sys.argv) > 4 else 200
        ns = [n for n in nodes(xml, needle) if n[6] >= min_w] or nodes(xml, needle)
        if not ns:
            return 1
        ns.sort(key=lambda n: n[6] * n[7], reverse=True)
        _x1, _y1, _x2, _y2, cx, cy, w, h = ns[0]
        print(f"{cx} {cy} {w} {h}")
        return 0
    if cmd == "empty":
        bad = any(
            s in xml
            for s in (
                "Interrompi generazione",
                "Quanto fa 3847",
                "3847 più 291",
                "Cerco sul web",
                "Quanti giorni ha settembre",
                "capitale del Giappone",
            )
        )
        return 0 if ("Fai una domanda" in xml and not bad) else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
