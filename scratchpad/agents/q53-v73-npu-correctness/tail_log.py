from pathlib import Path
import sys

path = Path(sys.argv[1])
lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
for line in lines[-40:]:
    print(line)
