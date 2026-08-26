import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from gguf.constants import GGML_QUANT_SIZES, GGMLQuantizationType
from gguf.gguf_reader import GGUFReader

ROOT = Path(r"scratchpad/agents/q59-dense-quant-gate/gguf")
PATHS = {
    "Q4_K_M": ROOT / "Qwen3.5-4B-fromsrc-Q4_K_M.gguf",
    "IQ4_NL": ROOT / "Qwen3.5-4B-fromsrc-IQ4_NL.gguf",
    "BF16": ROOT / "Qwen3.5-4B-fromsrc-BF16.gguf",
}


def family(name: str) -> str:
    return re.sub(r"((?:blk|mtp)\.)\d+(?=\.)", r"\1*", name)


def align(value: int, alignment: int) -> int:
    return (value + alignment - 1) // alignment * alignment


readers = {key: GGUFReader(str(path), "r") for key, path in PATHS.items()}
print("HEADER")
for key, reader in readers.items():
    print(json.dumps({
        "file": key,
        "tensor_count": len(reader.tensors),
        "data_offset": reader.data_offset,
        "alignment": reader.alignment,
        "file_bytes": PATHS[key].stat().st_size,
    }, sort_keys=True))

names = [tensor.name for tensor in readers["BF16"].tensors]
for key, reader in readers.items():
    if {tensor.name for tensor in reader.tensors} != set(names):
        raise SystemExit(f"name-set mismatch: {key}")

by_name = {key: {tensor.name: tensor for tensor in reader.tensors}
           for key, reader in readers.items()}
groups = defaultdict(list)
for name in names:
    groups[family(name)].append(name)

print("FAMILIES")
for fam in sorted(groups):
    names_in_family = groups[fam]
    row = {"family": fam, "count": len(names_in_family)}
    for key in ("BF16", "Q4_K_M", "IQ4_NL"):
        tensors = [by_name[key][name] for name in names_in_family]
        row[key] = {
            "shapes": sorted({tuple(int(value) for value in tensor.shape)
                               for tensor in tensors}),
            "types": sorted({tensor.tensor_type.name for tensor in tensors}),
            "bytes": sorted({int(tensor.n_bytes) for tensor in tensors}),
            "sum_bytes": sum(int(tensor.n_bytes) for tensor in tensors),
        }
    print(json.dumps(row, sort_keys=True, separators=(",", ":")))

print("TYPE_SUMS")
for key in ("BF16", "Q4_K_M", "IQ4_NL"):
    sums = defaultdict(lambda: [0, 0])
    for tensor in readers[key].tensors:
        sums[tensor.tensor_type.name][0] += 1
        sums[tensor.tensor_type.name][1] += int(tensor.n_bytes)
    print(key, json.dumps({
        type_name: {"count": values[0], "bytes": values[1]}
        for type_name, values in sorted(sums.items())
    }, sort_keys=True, separators=(",", ":")))

print("EXACT_SPECIALS")
for key in ("Q4_K_M", "IQ4_NL", "BF16"):
    print(key)
    for tensor in readers[key].tensors:
        if (tensor.tensor_type.name in {"Q6_K", "Q5_K", "Q8_0", "F16", "F32"}
                or any(part in tensor.name for part in ("output.weight", "token_embd.weight"))):
            print(json.dumps({
                "name": tensor.name,
                "shape": [int(value) for value in tensor.shape],
                "type": tensor.tensor_type.name,
                "bytes": int(tensor.n_bytes),
            }, separators=(",", ":")))

print("OFFSET_CHECK")
for key, reader in readers.items():
    relative = [int(tensor.data_offset - reader.data_offset)
                for tensor in reader.tensors]
    gaps = [relative[0]] + [
        relative[index] - (relative[index - 1] + int(reader.tensors[index - 1].n_bytes))
        for index in range(1, len(relative))
    ]
    print(key, json.dumps({
        "min_gap": min(gaps),
        "max_gap": max(gaps),
        "unique_gaps": sorted(set(gaps))[:20],
        "last_end": relative[-1] + int(reader.tensors[-1].n_bytes),
        "data_bytes": sum(int(tensor.n_bytes) for tensor in reader.tensors),
    }, separators=(",", ":")))

q4_reader = readers["Q4_K_M"]
iq_reader = readers["IQ4_NL"]
q4_by_name = {tensor.name: tensor for tensor in q4_reader.tensors}

print("PREDICTED_CANDIDATES")
for candidate in ("C1_full", "C2_lite", "C2_lite_pure"):
    cursor = 0
    rows = []
    for tensor in iq_reader.tensors:
        q4_tensor = q4_by_name[tensor.name]
        output_type = tensor.tensor_type.name
        if candidate == "C2_lite_pure" and output_type != "F32":
            output_type = "IQ4_NL"
        if candidate == "C1_full":
            if (q4_tensor.tensor_type.name in {"Q5_K", "Q6_K"}
                    or tensor.name in {"output.weight", "token_embd.weight"}):
                output_type = "Q8_0"
        elif candidate in {"C2_lite", "C2_lite_pure"} and tensor.name in {"output.weight", "token_embd.weight"}:
            output_type = "Q8_0"
        quant_type = GGMLQuantizationType[output_type]
        block_size, type_size = GGML_QUANT_SIZES[quant_type]
        n_bytes = int(tensor.n_elements) * type_size // block_size
        start = align(cursor, iq_reader.alignment)
        rows.append((tensor.name, start, n_bytes, output_type))
        cursor = start + n_bytes
    counts = Counter(output_type for _, _, _, output_type in rows)
    bytes_by_type = Counter()
    for _, _, n_bytes, output_type in rows:
        bytes_by_type[output_type] += n_bytes
    print(candidate, json.dumps({
        "data_offset": iq_reader.data_offset,
        "payload_bytes": cursor,
        "file_bytes": iq_reader.data_offset + cursor,
        "by_type": dict(sorted(counts.items())),
        "bytes_by_type": dict(sorted(bytes_by_type.items())),
    }, sort_keys=True, separators=(",", ":")))
