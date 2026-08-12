#!/usr/bin/env python3
"""List GGUF tensor name, type, and shape. No third-party deps."""
import struct
import sys

GGUF_MAGIC = b"GGUF"
TYPE_NAMES = {
    0: "f32", 1: "f16", 2: "q4_0", 3: "q4_1", 6: "q5_0", 7: "q5_1",
    8: "q8_0", 9: "q8_1", 10: "q2_K", 11: "q3_K", 12: "q4_K", 13: "q5_K",
    14: "q6_K", 15: "q8_K", 24: "i8", 25: "i16", 26: "i32", 27: "i64",
    28: "f64", 29: "iq1_m", 30: "bf16",
}

def rstr(f):
    (n,) = struct.unpack("<Q", f.read(8))
    return f.read(n).decode("utf-8", "replace")

def rkv(f, vtype):
    if vtype == 8:
        return rstr(f)
    sizes = {0:1, 1:1, 2:2, 3:2, 4:4, 5:4, 6:4, 7:8, 10:8, 11:8, 12:8}
    if vtype == 9:
        at = struct.unpack("<I", f.read(4))[0]
        (n,) = struct.unpack("<Q", f.read(8))
        return [rkv(f, at) for _ in range(n)]
    n = sizes.get(vtype)
    if n is None:
        raise SystemExit("unsupported kv type %d" % vtype)
    return f.read(n)

def dump(path):
    with open(path, "rb") as f:
        magic = f.read(4)
        if magic != GGUF_MAGIC:
            raise SystemExit("not a GGUF: %r" % magic)
        ver, n_tensors, n_kv = struct.unpack("<IQQ", f.read(20))
        print("file", path)
        print("gguf_version", ver)
        print("n_tensors", n_tensors, "n_kv", n_kv)
        for _ in range(n_kv):
            key = rstr(f)
            (vt,) = struct.unpack("<I", f.read(4))
            val = rkv(f, vt)
            if key in (
                "general.architecture", "general.name",
                "qwen35.embedding_length", "qwen35.feed_forward_length",
                "qwen35.block_count", "qwen35.attention.head_count",
                "llama.embedding_length", "llama.feed_forward_length",
                "llama.block_count",
            ) or key.endswith("embedding_length") or key.endswith("feed_forward_length") or key.endswith("block_count"):
                print("kv", key, val)
        print("--- tensors ---")
        counts = {}
        q4k = []
        for _ in range(n_tensors):
            name = rstr(f)
            (n_dims,) = struct.unpack("<I", f.read(4))
            dims = [struct.unpack("<Q", f.read(8))[0] for _ in range(n_dims)]
            (typ,) = struct.unpack("<I", f.read(4))
            (off,) = struct.unpack("<Q", f.read(8))
            tname = TYPE_NAMES.get(typ, "t%d" % typ)
            counts[tname] = counts.get(tname, 0) + 1
            shape = "x".join(str(d) for d in dims)
            print("%-40s %-6s %s" % (name, tname, shape))
            if tname == "q4_K":
                nbytes = 1
                for d in dims:
                    nbytes *= d
                # Q4_K is 18/32 bytes per weight roughly; report logical elems
                q4k.append((name, dims, nbytes))
        print("--- type counts ---")
        for k, v in sorted(counts.items()):
            print(k, v)
        print("--- q4_K by bytes (logical nelem) ---")
        q4k.sort(key=lambda t: t[2], reverse=True)
        for name, dims, ne in q4k:
            print("%12d  %-40s %s" % (ne, name, "x".join(str(d) for d in dims)))

if __name__ == "__main__":
    dump(sys.argv[1])
