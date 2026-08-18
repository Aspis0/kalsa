import sys
import xml.etree.ElementTree as ET
from pathlib import Path

for name in sys.argv[1:]:
    p = Path(name)
    print("====", p.name)
    root = ET.parse(p).getroot()
    first = root.find(".//node")
    print("root_pkg", first.get("package") if first is not None else "?")
    for n in root.iter("node"):
        t = n.get("text") or ""
        d = n.get("content-desc") or ""
        c = (n.get("class") or "").split(".")[-1]
        b = n.get("bounds") or ""
        interesting = bool(t) or bool(d) or c in ("EditText", "Button", "Switch")
        if not interesting:
            continue
        if len(t) > 90:
            t = t[:90] + "..."
        if len(d) > 90:
            d = d[:90] + "..."
        print(f"  [{c}] text={t!r} desc={d!r} {b} click={n.get('clickable')}")
