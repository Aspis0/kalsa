"""One-off GGUF tensor-meta dump. Header only; does not load weights."""
import collections
import os
import struct
import sys
from pathlib import Path

GGUF_TYPE = {
    0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0", 7: "Q5_1",
    8: "Q8_0", 9: "Q8_1", 10: "Q2_K", 11: "Q3_K", 12: "Q4_K", 13: "Q5_K",
    14: "Q6_K", 15: "Q8_K", 16: "IQ2_XXS", 17: "IQ2_XS", 18: "IQ3_XXS",
    19: "IQ1_S", 20: "IQ4_NL", 21: "IQ3_S", 22: "IQ2_S", 23: "IQ4_XS",
    24: "I8", 25: "I16", 26: "I32", 27: "I64", 28: "F64", 29: "IQ1_M",
    30: "BF16", 34: "TQ1_0", 35: "TQ2_0",
}

# GGUF metadata value types
U8, I8, U16, I16, U32, I32, F32, BOOL, STRING, ARRAY, U64, I64, F64 = range(13)
SCALAR = {U8: 1, I8: 1, U16: 2, I16: 2, U32: 4, I32: 4, F32: 4, BOOL: 1, U64: 8, I64: 8, F64: 8}


def read_str(f):
    n = struct.unpack("<Q", f.read(8))[0]
    if n > 10_000_000:
        raise RuntimeError(f"implausible string length {n} at {f.tell()}")
    return f.read(n).decode("utf-8", "replace")


def skip_val(f, t):
    if t == STRING:
        read_str(f)
        return
    if t == ARRAY:
        at, n = struct.unpack("<IQ", f.read(12))
        if n > 50_000_000:
            raise RuntimeError(f"implausible array n={n}")
        if at == STRING:
            for _ in range(n):
                read_str(f)
        elif at in SCALAR:
            f.read(SCALAR[at] * n)
        else:
            for _ in range(n):
                skip_val(f, at)
        return
    if t in SCALAR:
        f.read(SCALAR[t])
        return
    raise RuntimeError(f"unknown meta type {t} at {f.tell()}")


def pack_eligible(tname, ne1):
    if tname in ("Q4_K", "Q5_K", "Q6_K", "Q2_K") and ne1 % 8 == 0:
        return True
    if tname in ("Q4_0", "Q8_0", "IQ4_NL") and ne1 % 4 == 0:
        return True
    return False


def dump(path: Path) -> str:
    st = path.stat()
    out = [f"file={path}", f"bytes={st.st_size}"]
    with path.open("rb") as f:
        magic = f.read(4)
        if magic != b"GGUF":
            return "\n".join(out + ["not gguf"])
        ver, n_tensors, n_kv = struct.unpack("<IQQ", f.read(20))
        out.append(f"ver={ver} n_tensors={n_tensors} n_kv={n_kv}")
        kv_keep = {}
        for _ in range(n_kv):
            key = read_str(f)
            t = struct.unpack("<I", f.read(4))[0]
            pos = f.tell()
            if key in (
                "general.architecture", "general.size_label",
                "general.file_type",
            ) or key.endswith(".block_count") or key.endswith(".embedding_length") or key.endswith(
                ".feed_forward_length"
            ) or key.endswith(".expert_count") or key.endswith(".expert_used_count") or key.endswith(
                ".expert_feed_forward_length"
            ):
                if t == STRING:
                    kv_keep[key] = read_str(f)
                    continue
                if t == U32:
                    kv_keep[key] = struct.unpack("<I", f.read(4))[0]
                    continue
                if t == U64:
                    kv_keep[key] = struct.unpack("<Q", f.read(8))[0]
                    continue
                f.seek(pos)
            skip_val(f, t)
        out.append("kv=" + repr(kv_keep))
        rows = []
        for _ in range(n_tensors):
            name = read_str(f)
            nd = struct.unpack("<I", f.read(4))[0]
            dims = list(struct.unpack("<" + "Q" * nd, f.read(8 * nd)))
            typ = struct.unpack("<I", f.read(4))[0]
            off = struct.unpack("<Q", f.read(8))[0]
            tname = GGUF_TYPE.get(typ, f"type{typ}")
            ne1 = dims[1] if nd > 1 else 1
            rows.append((name, tname, dims, ne1, pack_eligible(tname, ne1), off, typ))
        offs = [r[5] for r in rows] + [st.st_size]
        hist = collections.Counter()
        hist_ex = collections.Counter()
        hist_non = collections.Counter()
        bytes_by = collections.Counter()
        nbytes_ex = nbytes_non = 0
        pack_n = pack_b = nop_n = nop_b = 0
        pack_ex_b = pack_non_b = 0
        for i, r in enumerate(rows):
            sz = offs[i + 1] - r[5]
            hist[r[1]] += 1
            bytes_by[r[1]] += sz
            is_ex = "exps" in r[0]
            (hist_ex if is_ex else hist_non)[r[1]] += 1
            if is_ex:
                nbytes_ex += sz
            else:
                nbytes_non += sz
            if r[4]:
                pack_n += 1
                pack_b += sz
                if is_ex:
                    pack_ex_b += sz
                else:
                    pack_non_b += sz
            else:
                nop_n += 1
                nop_b += sz
        out.append("type_hist=" + str(dict(hist)))
        out.append("expert_hist=" + str(dict(hist_ex)))
        out.append("nonexpert_hist=" + str(dict(hist_non)))
        out.append(f"expert_bytes={nbytes_ex} ({nbytes_ex/1024/1024:.1f} MiB)")
        out.append(f"nonexpert_bytes={nbytes_non} ({nbytes_non/1024/1024:.1f} MiB)")
        out.append("bytes_by_type_mib=" + str({k: round(v / 1024 / 1024, 1) for k, v in bytes_by.most_common()}))
        out.append(f"repack_eligible tensors={pack_n} bytes={pack_b} ({pack_b/1024/1024:.1f} MiB)")
        out.append(f"  of which experts={pack_ex_b/1024/1024:.1f} MiB dense={pack_non_b/1024/1024:.1f} MiB")
        out.append(f"repack_ineligible tensors={nop_n} bytes={nop_b} ({nop_b/1024/1024:.1f} MiB)")
        out.append("--- first 16 tensors ---")
        for r in rows[:16]:
            out.append(f"  {r[1]:8} {r[0]} {r[2]} ne1={r[3]} pack={r[4]}")
        ex = [r for r in rows if "exps" in r[0]]
        out.append(f"--- {len(ex)} expert tensors, first 8 ---")
        for r in ex[:8]:
            out.append(f"  {r[1]:8} {r[0]} {r[2]} ne1={r[3]} pack={r[4]}")
        unknown = [r for r in rows if r[1].startswith("type")]
        if unknown:
            out.append(f"--- {len(unknown)} unknown types, first 8 ---")
            for r in unknown[:8]:
                out.append(f"  {r[1]:8} {r[0]} {r[2]} typ={r[6]}")
    return "\n".join(out)


def main():
    paths = sys.argv[1:]
    for p in paths:
        path = Path(p)
        print(f"# dumping {path} exists={path.exists()}", flush=True)
        text = dump(path)
        outp = Path("results/oomwall_s23") / ("_" + path.stem + "_tensors.txt")
        outp.write_text(text + "\n", encoding="utf-8")
        print(f"wrote {outp} ({len(text)} chars)", flush=True)


if __name__ == "__main__":
    main()
