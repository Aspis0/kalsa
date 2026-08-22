import re
from pathlib import Path
kdir = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\worktree-mali-probe\ggml\src\ggml-opencl\kernels")
pats = [
    r"=\s*\*dh\b",
    r"=\s*\*mh\b",
    r"=\s*\*dm\b",
    r"=\s*\*d\b",
    r"\bdh\[\d+\]",
    r"\bad[0-3]\[[^\]]+\]",
    r"\bsrc0_d\[[^\]]+\]",
    r"\]\.d\b",
    r"\]\.dmin\b",
    r"\]\.m\b",
    r"x\[i\]\.d",
    r"x\[ib\]\.d",
]
for p in sorted(kdir.glob("mul_mv*.cl")):
    t = p.read_text(encoding="utf-8")
    hits = []
    for i, ln in enumerate(t.splitlines(), 1):
        if "vload_half" in ln:
            continue
        if any(re.search(pat, ln) for pat in pats):
            hits.append(f"  {i}: {ln.strip()}")
    if hits:
        print(f"=== {p.name} ({len(hits)})")
        print("\n".join(hits[:40]))
        if len(hits) > 40:
            print(f"  ... +{len(hits)-40} more")
