import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from gguf.gguf_reader import GGUFReader

ROOT = Path(r"scratchpad/agents/q59-dense-quant-gate/gguf")
FILES = {
    "Q4_K_M": ROOT / "Qwen3.5-4B-fromsrc-Q4_K_M.gguf",
    "IQ4_NL": ROOT / "Qwen3.5-4B-fromsrc-IQ4_NL.gguf",
}


def family(name):
    return re.sub(r"((?:blk|mtp)\.)\d+(?=\.)", r"\1*", name)


readers = {key: GGUFReader(str(path), "r") for key, path in FILES.items()}
by_family = defaultdict(list)
for tensor in readers["Q4_K_M"].tensors:
    by_family[family(tensor.name)].append(tensor)

print("Q4KM_FAMILY_TYPE_SPLITS")
for fam in sorted(by_family):
    split = defaultdict(lambda: {"count": 0, "bytes": 0, "indices": []})
    for tensor in by_family[fam]:
        item = split[tensor.tensor_type.name]
        item["count"] += 1
        item["bytes"] += int(tensor.n_bytes)
        match = re.search(r"blk\.(\d+)\.", tensor.name)
        item["indices"].append(int(match.group(1)) if match else tensor.name)
    print(json.dumps({
        "family": fam,
        "split": dict(sorted(split.items())),
    }, sort_keys=True, separators=(",", ":")))

print("IQ4NL_FAMILY_TYPE_SPLITS")
iq4nl_families = defaultdict(list)
for tensor in readers["IQ4_NL"].tensors:
    iq4nl_families[family(tensor.name)].append(tensor)
for fam in sorted(iq4nl_families):
    split = defaultdict(lambda: {"count": 0, "bytes": 0})
    for tensor in iq4nl_families[fam]:
        item = split[tensor.tensor_type.name]
        item["count"] += 1
        item["bytes"] += int(tensor.n_bytes)
    print(json.dumps({
        "family": fam,
        "split": dict(sorted(split.items())),
    }, sort_keys=True, separators=(",", ":")))

print("PROMOTED_PATTERNS")
for fam in sorted(by_family):
    split = defaultdict(list)
    for tensor in by_family[fam]:
        if tensor.tensor_type.name in {"Q6_K", "Q5_K", "Q8_0", "F16", "F32"}:
            match = re.search(r"blk\.(\d+)\.", tensor.name)
            split[tensor.tensor_type.name].append(int(match.group(1)) if match else tensor.name)
    for type_name, indices in sorted(split.items()):
        if type_name != "Q6_K" and type_name != "Q5_K":
            continue
        escaped_family = fam.replace("*", "")
        suffix = fam.split(".", 2)[-1]
        if isinstance(indices[0], int):
            alt = "|".join(str(index) for index in indices)
            pattern = rf'^blk\\.(?:{alt})\\.{re.escape(suffix)}$=Q8_0'
        else:
            pattern = f'^{re.escape(fam)}$=Q8_0'
        print(json.dumps({
            "source_type": type_name,
            "family": fam,
            "indices": indices,
            "tensor_type_arg": pattern,
        }, sort_keys=True, separators=(",", ":")))

print("TYPE_SUMS_BY_MODEL")
for key, reader in readers.items():
    count = Counter(tensor.tensor_type.name for tensor in reader.tensors)
    sizes = defaultdict(int)
    for tensor in reader.tensors:
        sizes[tensor.tensor_type.name] += int(tensor.n_bytes)
    print(key, json.dumps({
        type_name: {"count": count[type_name], "bytes": sizes[type_name]}
        for type_name in sorted(count)
    }, sort_keys=True, separators=(",", ":")))
