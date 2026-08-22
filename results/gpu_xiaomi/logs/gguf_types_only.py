#!/usr/bin/env python3
import struct, sys
from collections import Counter

GGML_TYPES = {
    0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0", 7: "Q5_1",
    8: "Q8_0", 9: "Q8_1", 10: "Q2_K", 11: "Q3_K", 12: "Q4_K", 13: "Q5_K",
    14: "Q6_K", 15: "Q8_K", 16: "IQ2_XXS", 17: "IQ2_XS", 18: "IQ3_XXS",
    19: "IQ1_S", 20: "IQ4_NL", 21: "IQ3_S", 22: "IQ2_S", 23: "IQ4_XS",
    24: "I8", 25: "I16", 26: "I32", 27: "I64", 28: "F64", 29: "IQ1_M",
    30: "BF16", 34: "TQ1_0", 35: "TQ2_0",
}
# GGUF value types
# 0 UINT8 1 INT8 2 UINT16 3 INT16 4 UINT32 5 INT32 6 FLOAT32 7 BOOL 8 STRING 9 ARRAY 10 UINT64 11 INT64 12 FLOAT64
VAL_SIZE = {0:1, 1:1, 2:2, 3:2, 4:4, 5:4, 6:4, 7:1, 10:8, 11:8, 12:8}

def read_str(f):
    (n,) = struct.unpack("<Q", f.read(8))
    if n > 10_000_000:
        raise ValueError(f"string length absurd: {n} at pos {f.tell()}")
    return f.read(n).decode("utf-8", errors="replace")

def skip_val(f, vt):
    if vt == 8:  # STRING
        (n,) = struct.unpack("<Q", f.read(8))
        f.seek(n, 1)
    elif vt == 9:  # ARRAY
        (at,) = struct.unpack("<I", f.read(4))
        (n,) = struct.unpack("<Q", f.read(8))
        if at == 8:  # array of strings
            for _ in range(n):
                (sn,) = struct.unpack("<Q", f.read(8))
                f.seek(sn, 1)
        elif at == 9:
            raise ValueError("nested array")
        else:
            sz = VAL_SIZE.get(at)
            if sz is None:
                raise ValueError(f"unknown array elem type {at}")
            f.seek(sz * n, 1)
    else:
        sz = VAL_SIZE.get(vt)
        if sz is None:
            raise ValueError(f"unknown value type {vt} at {f.tell()}")
        f.seek(sz, 1)

def main(path):
    with open(path, "rb") as f:
        magic = f.read(4)
        if magic != b"GGUF":
            print("NOT_GGUF", magic); sys.exit(2)
        (version,) = struct.unpack("<I", f.read(4))
        n_tensors, n_kv = struct.unpack("<QQ", f.read(16))
        print(f"GGUF version={version} n_tensors={n_tensors} n_kv={n_kv}")
        for i in range(n_kv):
            k = read_str(f)
            (vt,) = struct.unpack("<I", f.read(4))
            skip_val(f, vt)
        tensors = []
        for _ in range(n_tensors):
            name = read_str(f)
            (n_dims,) = struct.unpack("<I", f.read(4))
            dims = struct.unpack("<" + "Q" * n_dims, f.read(8 * n_dims))
            (ttype,) = struct.unpack("<I", f.read(4))
            (offset,) = struct.unpack("<Q", f.read(8))
            tname = GGML_TYPES.get(ttype, f"TYPE_{ttype}")
            tensors.append((name, tname, ttype, dims))

        non_expert = []
        expert = []
        print("\n=== ALL TENSORS (tag | type | dims | name) ===")
        for name, tname, ttype, dims in tensors:
            is_exp = ("_exps" in name) or (".exps." in name) or ("experts" in name)
            tag = "EXPERT" if is_exp else "NONEXP"
            print(f"{tag:6} {tname:10} {list(dims)}  {name}")
            if is_exp:
                expert.append((name, tname, ttype))
            else:
                non_expert.append((name, tname, ttype))

        print("\n=== NON-EXPERT TYPE SUMMARY ===")
        for t, n in sorted(Counter(t for _, t, _ in non_expert).items(), key=lambda x: -x[1]):
            print(f"  {t}: {n}")
        print("\n=== EXPERT TYPE SUMMARY ===")
        for t, n in sorted(Counter(t for _, t, _ in expert).items(), key=lambda x: -x[1]):
            print(f"  {t}: {n}")

        # B1: non-expert must be in OpenCL-supported dense set
        allowed = {"Q4_K", "Q5_K", "Q6_K", "F32", "Q8_0", "F16", "BF16"}
        bad = [(n, t) for n, t, _ in non_expert if t not in allowed]
        print("\n=== B1 GATE ===")
        print(f"non_expert_count={len(non_expert)} expert_count={len(expert)}")
        print(f"allowed={sorted(allowed)}")
        if bad:
            print("VERDICT=STOP")
            print("BAD_NON_EXPERT_TENSORS:")
            for n, t in bad:
                print(f"  {t}  {n}")
            print("BAD_TYPES:", sorted(set(t for _, t in bad)))
        else:
            print("VERDICT=PASS")
            print("All non-expert tensors in allowed set.")

if __name__ == "__main__":
    main(sys.argv[1])
