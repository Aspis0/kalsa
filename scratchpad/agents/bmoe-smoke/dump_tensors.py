import sys
sys.path.insert(0, "BigMoeOnEdge/third_party/llama.cpp/gguf-py")
from gguf.gguf_reader import GGUFReader
from gguf.constants import GGUFValueType
import collections

path = "models/LFM2.5-8B-A1B-KEXP.gguf"
r = GGUFReader(path)

# tensor type enum name lookup
try:
    from gguf.constants import GGMLQuantType
    qname = {v: k for k, v in GGMLQuantType.__members__.items()} if hasattr(GGMLQuantType, "__members__") else {}
except Exception:
    qname = {}

# GGUFReader tensors: list of ReaderTensor with .name, .data_type (enum int), .shape, .n_elements, .n_bytes
type_count = collections.Counter()
expert_tensors = []
all_names = []
for t in r.tensors:
    # ReaderTensor is a NamedTuple: name, tensor_type (GGMLQuantizationType), shape, n_elements, n_bytes, data
    tt = t.tensor_type
    nm = getattr(tt, "name", None) or qname.get(tt) or str(tt)
    type_count[nm] += 1
    all_names.append((t.name, nm, tuple(t.shape) if hasattr(t, "shape") else None, t.n_elements, t.n_bytes))
    # expert tensors: ffn_*_exps (MoE expert weights) — the trans4-name-gate targets
    nl = t.name
    if ("ffn" in nl and "exps" in nl) or nl.endswith("exps.weight") or ".ffn_" in nl and ".exps" in nl:
        expert_tensors.append((nl, nm, tuple(t.shape) if hasattr(t, "shape") else None, t.n_elements, t.n_bytes))

print("=== ALL tensor types (count) ===")
for nm, c in sorted(type_count.items(), key=lambda x: -x[1]):
    print(f"  {nm}: {c}")

print(f"\n=== total tensors: {len(all_names)} ===")

print(f"\n=== EXPERT tensors (ffn_*_exps) — {len(expert_tensors)} ===")
trans4_types = {"Q4_0", "Q4_1", "Q5_0", "Q5_1", "MXFP4", "Q4_0_B", "Q4_1_B"}
for nl, nm, sh, ne, nb in expert_tensors[:40]:
    gated = "  <== TRANS4-GATED" if nm in trans4_types else ""
    print(f"  {nl}  type={nm}  shape={sh}  nelem={ne}  nbytes={nb}{gated}")

if not expert_tensors:
    print("  (no ffn_*_exps tensors; dumping all tensors with 'exps' in name:)")
    for nl, nm, sh, ne, nb in all_names:
        if "exps" in nl:
            gated = "  <== TRANS4-GATED" if nm in trans4_types else ""
            print(f"  {nl}  type={nm}  shape={sh}  nelem={ne}  nbytes={nb}{gated}")

# also: any tensor whose name matches the trans4-moe name gate? gate = (ffn+exps) or "as" + ne01%32==0
print("\n=== tensors with 'as' in name (the other name-gate) ===")
for nl, nm, sh, ne, nb in all_names:
    if nl == "as" or ".as" in nl.lower():
        print(f"  {nl}  type={nm}  shape={sh}")
