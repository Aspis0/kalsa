import json, sys
from collections import Counter
from pathlib import Path
try:
    from gguf import GGUFReader
except ImportError:
    print("NO_GGUF")
    sys.exit(2)
path = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Marco-Mini-Instruct-KEXP.gguf")
r = GGUFReader(str(path))
rows = []
c = Counter()
for t in r.tensors:
    typ = t.tensor_type.name
    c[typ] += 1
    shape = [int(x) for x in t.shape]
    nbytes = int(t.n_bytes) if hasattr(t, "n_bytes") else int(t.data.nbytes) if hasattr(t, "data") else None
    rows.append({"name": t.name, "type": typ, "shape": shape, "nbytes": nbytes})
out = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q36-trunk-requant\baseline_tensors.json")
out.write_text(json.dumps({"file": str(path), "n_tensors": len(rows), "types": dict(c), "tensors": rows}, indent=2), encoding="utf-8")
print("n_tensors", len(rows))
print("types", dict(c))
print("wrote", out)
