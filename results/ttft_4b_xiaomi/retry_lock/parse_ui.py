import re
import sys

p = sys.argv[1]
t = open(p, encoding="utf-8").read()
print("len", len(t))
for m in re.finditer(r"<node[^>]*>", t):
    n = m.group(0)
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    cls = re.search(r'class="([^"]*)"', n)
    rid = re.search(r'resource-id="([^"]*)"', n)
    b = re.search(r'bounds="([^"]*)"', n)
    blob = " ".join(
        [
            text.group(1) if text else "",
            desc.group(1) if desc else "",
            rid.group(1) if rid else "",
        ]
    )
    has_label = (text and text.group(1)) or (desc and desc.group(1))
    keys = ("pin", "password", "lock", "swipe", "unlock", "digit", "key", "enter", "pattern", "keyguard")
    if has_label or any(k in blob.lower() for k in keys):
        print(
            (cls.group(1) if cls else ""),
            "|",
            (rid.group(1) if rid else ""),
            "|",
            (text.group(1) if text else ""),
            "|",
            (desc.group(1) if desc else ""),
            "|",
            (b.group(1) if b else ""),
        )
