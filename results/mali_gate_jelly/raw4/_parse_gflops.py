import re
from pathlib import Path
raw = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\mali_gate_jelly\raw4")
pat = re.compile(
    r"MUL_MAT(?:_ID)?\(([^)]+)\):.*?([0-9.]+)\s+(GFLOPS|MFLOPS)",
    re.S,
)
# line-based: strip ansi
ansi = re.compile(r"\x1b\[[0-9;]*m")
num = re.compile(r"([0-9]+\.[0-9]+)\s+(GFLOPS|MFLOPS)")

def parse(p):
    rows = []
    for ln in p.read_text(encoding="utf-8", errors="replace").splitlines():
        s = ansi.sub("", ln)
        if "MUL_MAT" not in s or "FLOP" not in s:
            continue
        m = re.search(r"(MUL_MAT(?:_ID)?\([^)]+\))", s)
        n = num.search(s)
        if m and n:
            g = float(n.group(1))
            if n.group(2) == "MFLOPS":
                g /= 1000.0
            rows.append((m.group(1), g))
    return rows

for kind in ["g_mmid_q8", "c_mmid_q8", "g_mm_f32n", "c_mm_f32"]:
    print("====", kind)
    by = {}
    for r in (1, 2, 3):
        p = raw / f"{kind}_r{r}.out"
        if not p.exists():
            print(" missing", p.name)
            continue
        for name, g in parse(p):
            by.setdefault(name, []).append(g)
    for name, gs in by.items():
        avg = sum(gs) / len(gs)
        print(f"  n={len(gs)} avg={avg:7.2f}  vals={['%.2f'%x for x in gs]}  {name[:90]}")
