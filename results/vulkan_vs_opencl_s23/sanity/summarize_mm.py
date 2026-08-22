import collections
import pathlib
import re

p = pathlib.Path(__file__).with_name("vk_mm_support.out")
ansi = re.compile(r"\x1b\[[0-9;]*m")
pat = re.compile(r"MUL_MAT\(type_a=([^,]+).*?\):\s*(SUPPORTED|NOT SUPPORTED)")
detail = collections.defaultdict(lambda: collections.Counter())
for ln in p.read_text(encoding="utf-8", errors="replace").splitlines():
    ln = ansi.sub("", ln)
    m = pat.search(ln)
    if m:
        detail[m.group(1)][m.group(2)] += 1
out = pathlib.Path(__file__).with_name("vk_mm_support_summary.txt")
lines = ["type\tSUPPORTED\tNOT_SUPPORTED"]
for t in sorted(detail):
    lines.append(f"{t}\t{detail[t]['SUPPORTED']}\t{detail[t]['NOT SUPPORTED']}")
text = "\n".join(lines) + "\n"
out.write_text(text, encoding="utf-8")
print(text, end="")
