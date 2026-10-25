#!/usr/bin/env python3
"""Reads only the GGUF header of two files and compares tensor types, counts and metadata keys (one responsibility: header diff).

Usage: gguf_header.py A.gguf B.gguf
"""
import collections, struct, sys

SCALAR = {0: "<B", 1: "<b", 2: "<H", 3: "<h", 4: "<I", 5: "<i", 6: "<f", 7: "<?", 10: "<Q", 11: "<q", 12: "<d"}


def read(f, fmt):
    return struct.unpack(fmt, f.read(struct.calcsize(fmt)))[0]


def read_str(f):
    return f.read(read(f, "<Q")).decode("utf-8", "replace")


def skip_value(f, vtype):
    if vtype == 8:
        read_str(f)
    elif vtype == 9:
        etype = read(f, "<I")
        count = read(f, "<Q")
        for _ in range(count):
            skip_value(f, etype)
    else:
        f.read(struct.calcsize(SCALAR[vtype]))


def header(path):
    with open(path, "rb") as f:
        assert f.read(4) == b"GGUF", "not a GGUF file"
        version = read(f, "<I")
        n_tensors = read(f, "<Q")
        n_kv = read(f, "<Q")
        kv_keys = []
        for _ in range(n_kv):
            key = read_str(f)
            vtype = read(f, "<I")
            kv_keys.append(key)
            skip_value(f, vtype)
        tensors = []
        for _ in range(n_tensors):
            name = read_str(f)
            ndims = read(f, "<I")
            dims = tuple(read(f, "<Q") for _ in range(ndims))
            ttype = read(f, "<I")
            read(f, "<Q")  # data offset, not compared
            tensors.append((name, ttype, dims))
    return {"version": version, "kv_keys": kv_keys, "tensors": tensors}


def main():
    a_path, b_path = sys.argv[1], sys.argv[2]
    a, b = header(a_path), header(b_path)
    for label, h in (("A", a), ("B", b)):
        hist = collections.Counter(t for _, t, _ in h["tensors"])
        print(f"{label}: gguf v{h['version']} tensors={len(h['tensors'])} kv={len(h['kv_keys'])} type_ids={dict(sorted(hist.items()))}")
    a_map = {n: (t, d) for n, t, d in a["tensors"]}
    b_map = {n: (t, d) for n, t, d in b["tensors"]}
    only_a = sorted(set(a_map) - set(b_map))
    only_b = sorted(set(b_map) - set(a_map))
    differing = [n for n in sorted(set(a_map) & set(b_map)) if a_map[n] != b_map[n]]
    print(f"tensor names only in A: {len(only_a)}, only in B: {len(only_b)}, same name but different (type,dims): {len(differing)}")
    for n in (only_a + only_b + differing)[:8]:
        print("  diff:", n, a_map.get(n), b_map.get(n))
    print(f"kv keys only in A: {sorted(set(a['kv_keys']) - set(b['kv_keys']))}")
    print(f"kv keys only in B: {sorted(set(b['kv_keys']) - set(a['kv_keys']))}")


if __name__ == "__main__":
    main()
