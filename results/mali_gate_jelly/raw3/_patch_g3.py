#!/usr/bin/env python3
"""Gate 3: portable #else SIMD macros + vload_half. Worktree only."""
from __future__ import annotations

import re
from pathlib import Path

KDIR = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\worktree-mali-probe\ggml\src\ggml-opencl\kernels")

IFDEF_INTEL = re.compile(r"^#ifdef\s+INTEL_GPU\s*$")
ELIF_ADRENO = re.compile(r"^#elif\s+defined\s*\(\s*ADRENO_GPU\s*\)\s*$")
DEFINE_N = re.compile(r"^#define\s+N_")


def add_else_portable(text: str) -> tuple[str, int]:
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    n_ins = 0
    while i < len(lines):
        if not IFDEF_INTEL.match(lines[i]):
            out.append(lines[i])
            i += 1
            continue
        ifdef_i = i
        i += 1
        intel: list[str] = []
        while i < len(lines) and not ELIF_ADRENO.match(lines[i]):
            if IFDEF_INTEL.match(lines[i]) or lines[i].startswith("#if"):
                break
            intel.append(lines[i])
            i += 1
        if i >= len(lines) or not ELIF_ADRENO.match(lines[i]):
            out.append(lines[ifdef_i])
            out.extend(intel)
            continue
        elif_i = i
        i += 1
        adreno: list[str] = []
        while i < len(lines) and lines[i].strip() not in ("#endif", "#else"):
            adreno.append(lines[i])
            i += 1
        if i >= len(lines) or lines[i].strip() != "#endif":
            out.append(lines[ifdef_i])
            out.extend(intel)
            out.append(lines[elif_i])
            out.extend(adreno)
            continue
        intel_n = [ln for ln in intel if DEFINE_N.match(ln.strip())]
        if not intel_n:
            out.append(lines[ifdef_i])
            out.extend(intel)
            out.append(lines[elif_i])
            out.extend(adreno)
            out.append(lines[i])
            i += 1
            continue
        # already has else? (we only accept #endif above)
        out.append(lines[ifdef_i])
        out.extend(intel)
        out.append(lines[elif_i])
        out.extend(adreno)
        out.append("#else")
        out.append("/* portable: Mali/UNKNOWN — warp 16, Intel-like. correctness not speed. */")
        out.extend(intel_n)
        out.append(lines[i])  # #endif
        i += 1
        n_ins += 1
    return "\n".join(out), n_ins


def patch_half_loads(text: str) -> tuple[str, int]:
    n = 0
    orig = text

    def sub(pat: str, repl: str, s: str, flags=0) -> str:
        nonlocal n
        s2, c = re.subn(pat, repl, s, flags=flags)
        n += c
        return s2

    # Pointer deref of named half* (must precede generic *d)
    s = text
    s = sub(r"=\s*\*dh\b", "= vload_half(0, dh)", s)
    s = sub(r"=\s*\*mh\b", "= vload_half(0, mh)", s)
    s = sub(r"=\s*\*dm\b", "= vload_half(0, dm)", s)
    s = sub(r"=\s*\*d\b", "= vload_half(0, d)", s)

    s = sub(r"\bdh\[0\]", "vload_half(0, dh)", s)
    s = sub(r"\bdh\[1\]", "vload_half(1, dh)", s)

    s = sub(r"\bad0\[ib\]", "vload_half(ib, ad0)", s)
    s = sub(r"\bad1\[ib\]", "vload_half(ib, ad1)", s)
    s = sub(r"\bad2\[ib\]", "vload_half(ib, ad2)", s)
    s = sub(r"\bad3\[ib\]", "vload_half(ib, ad3)", s)

    s = sub(r"\bblk_d\[ib\]", "vload_half(ib, blk_d)", s)

    # struct half field loads (not address-of)
    s = sub(r"(?<!&)x\[i\]\.d\b", "vload_half(0, &x[i].d)", s)
    s = sub(r"(?<!&)ax\[row\]\[ib\]\.d\b", "vload_half(0, &ax[row][ib].d)", s)

    if s == orig:
        n = 0
    return s, n


def main() -> None:
    else_total = 0
    half_total = 0
    files_else = []
    files_half = []
    for p in sorted(KDIR.glob("*.cl")):
        raw = p.read_bytes()
        nl = b"\r\n" in raw
        text = raw.decode("utf-8")
        if nl:
            text = text.replace("\r\n", "\n")
        t1, n1 = add_else_portable(text)
        t2, n2 = patch_half_loads(t1)
        if n1 or n2:
            out = t2.replace("\n", "\r\n") if nl else t2
            if not out.endswith("\n") and text.endswith("\n"):
                out += "\n" if not nl else "\r\n"
            p.write_bytes(out.encode("utf-8"))
        else_total += n1
        half_total += n2
        if n1:
            files_else.append(f"{p.name}:{n1}")
        if n2:
            files_half.append(f"{p.name}:{n2}")
    print("else_blocks", else_total)
    print(" ", ", ".join(files_else))
    print("half_loads", half_total)
    print(" ", ", ".join(files_half))


if __name__ == "__main__":
    main()
