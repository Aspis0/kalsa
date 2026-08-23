#!/usr/bin/env python3
"""Independent hostile-audit recomputation (v4) — self-contained GGUF parser.

Layout (empirically verified against llama.cpp's writer for these files):
  magic(4) version(u32) n_tensors(u64) n_kv(u64)
  KV section: key = u64-len+bytes ; type u32 ; value
     (u8 i8 u16 i16 u32 i32 f32 bool u64 i64 f64 -> fixed size; str; array)
  tensor infos: name = u64-len+bytes ; n_dims u32 ; dims u64[n_dims] ;
                type u32 ; offset u64   (offset relative to data section)
  data section starts at 32-aligned end of header (GGUF_DEFAULT_ALIGNMENT=32).

Checks per file:
  - n_tensors, type histogram, class byte-sums (attn / token_embd / experts / norms+router)
  - payload math: nbytes = n_elems * type_size // block_size (GGML_QUANT_SIZES),
    verified against on-disk offsets (next offset minus this offset, pad 0..31)
  - sha256 over (name + payload) of every ffn_{gate,up,down}_exps tensor
  - full-file sha256
"""
import hashlib, json, struct, sys, time
from pathlib import Path

from gguf.constants import GGML_QUANT_SIZES

SZ = {0:1, 1:1, 2:2, 3:2, 4:4, 5:4, 6:4, 7:1, 10:8, 11:8, 12:8}

def read_str(f):
    n = struct.unpack("<Q", f.read(8))[0]
    return f.read(n).decode("utf-8", "replace")

def skip_kv_section(f, count):
    for _ in range(count):
        read_str(f)
        t = struct.unpack("<I", f.read(4))[0]
        if t == 8:
            read_str(f)
        elif t == 9:
            at = struct.unpack("<I", f.read(4))[0]
            n = struct.unpack("<Q", f.read(8))[0]
            for _ in range(n):
                if at == 8:
                    read_str(f)
                else:
                    f.seek(SZ[at], 1)
        else:
            f.seek(SZ[t], 1)

def parse_gguf(path):
    with open(path, "rb") as f:
        assert f.read(4) == b"GGUF"
        version = struct.unpack("<I", f.read(4))[0]
        n_tensors = struct.unpack("<Q", f.read(8))[0]
        n_kv = struct.unpack("<Q", f.read(8))[0]
        skip_kv_section(f, n_kv)
        infos = []  # (name, dims, type, offset)
        for _ in range(n_tensors):
            name = read_str(f)
            nd = struct.unpack("<I", f.read(4))[0]
            dims = struct.unpack(f"<{nd}Q", f.read(8 * nd))
            typ = struct.unpack("<I", f.read(4))[0]
            off = struct.unpack("<Q", f.read(8))[0]
            infos.append((name, dims, typ, off))
        end = f.tell()
    return version, n_tensors, infos, (end + 31) & ~31

def nbytes_of(typ, nelems):
    bs, ts = GGML_QUANT_SIZES[typ]
    return nelems * ts // bs

def main(paths):
    for path in paths:
        t0 = time.time()
        p = Path(path)
        version, n_tensors, infos, data_start = parse_gguf(p)
        with open(p, "rb") as f:
            f.seek(data_start)
            data = f.read()  # one sequential pass
        # expected payloads from type tables; on-disk spans from offsets
        sums, counts, hist = {}, {}, {}
        exp = []
        mism = 0
        pad_total = 0
        for i, (name, dims, typ, off) in enumerate(infos):
            nelems = 1
            for d in dims:
                nelems *= d
            nb = nbytes_of(typ, nelems)
            next_off = infos[i + 1][3] if i + 1 < n_tensors else len(data)
            span = next_off - off
            if span != nb:
                pad = span - nb
                if pad < 0 or pad > 31:
                    mism += 1
                    if mism <= 10:
                        print(f"  LEN MISMATCH {name}: table={nb} span={span}")
                else:
                    pad_total += pad
            tname = str(typ).split('.')[-1]
            hist[tname] = hist.get(tname, 0) + 1
            if "ffn_gate_exps" in name or "ffn_up_exps" in name or "ffn_down_exps" in name:
                cls = "expert"
            elif ".attn_" in name and not name.endswith("norm.weight"):
                cls = "attn"
            elif name == "token_embd.weight":
                cls = "token_embd"
            elif name == "output.weight":
                cls = "output"
            else:
                cls = "other"
            sums[cls] = sums.get(cls, 0) + nb
            counts[cls] = counts.get(cls, 0) + 1
            if cls == "expert":
                exp.append((name, off, nb))
        h = hashlib.sha256()
        payload_total = 0
        for name, off, nb in exp:
            h.update(name.encode("utf-8"))
            h.update(data[off:off + nb])
            payload_total += nb
        sha = h.hexdigest()
        with open(p, "rb") as f:
            fh = hashlib.sha256()
            fh.update(f.read(data_start))
            fh.update(data)
            full = fh.hexdigest()
        trunk = sums.get("attn", 0) + sums.get("token_embd", 0)
        print(f"== {p.name}")
        print(f"  version={version} n_tensors={n_tensors} data_start={data_start}")
        print(f"  disk_bytes={p.stat().st_size} span_lens_fail={mism} inter_tensor_pad={pad_total}")
        print(f"  type_hist={json.dumps(hist, sort_keys=True)}")
        print(f"  class_bytes={json.dumps(sums, sort_keys=True)} counts={json.dumps(counts, sort_keys=True)}")
        print(f"  trunk_bytes={trunk} expert_payload={payload_total} ({len(exp)} tensors)")
        print(f"  expert_sha256={sha} MATCH={sha == 'd84c4b43b24384648b1036e043973655b3092d4ebdf6cb62bb8de18f3cc2c74d'}")
        print(f"  full_sha256={full}")
        print(f"  {(time.time()-t0):.1f}s")

if __name__ == "__main__":
    main(sys.argv[1:])