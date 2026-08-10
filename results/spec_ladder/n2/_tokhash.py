import struct, hashlib, sys
from pathlib import Path

def tok_sha(path):
    with open(path, "rb") as f:
        assert f.read(4) == b"GGUF"
        struct.unpack("<I", f.read(4))
        n_tensors, n_kv = struct.unpack("<QQ", f.read(16))
        def rstr():
            n = struct.unpack("<Q", f.read(8))[0]
            return f.read(n).decode("utf-8","replace")
        def skip(t):
            sizes = {0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8}
            if t == 8:
                rstr(); return
            if t == 9:
                at = struct.unpack("<I", f.read(4))[0]
                n = struct.unpack("<Q", f.read(8))[0]
                if at == 8:
                    for _ in range(n): rstr()
                else:
                    f.read(sizes.get(at,0)*n)
                return
            f.read(sizes.get(t,0))
        out = {}
        for _ in range(n_kv):
            k = rstr()
            t = struct.unpack("<I", f.read(4))[0]
            if k in ("tokenizer.ggml.tokens","tokenizer.ggml.merges","general.architecture","general.name"):
                if t == 9:
                    at = struct.unpack("<I", f.read(4))[0]
                    n = struct.unpack("<Q", f.read(8))[0]
                    if at == 8:
                        h = hashlib.sha256()
                        for _ in range(n):
                            s = rstr().encode(); h.update(s); h.update(b"\0")
                        out[k] = f"n={n}"; out[k+".sha16"] = h.hexdigest()[:16]
                    else:
                        f.read({0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8}.get(at,0)*n)
                elif t == 8:
                    out[k] = rstr()
                else:
                    skip(t)
            else:
                skip(t)
        return out

root = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments")
models = [
    root/"models/mtp/Qwen3.6-35B-A3B-UD-IQ1_M.gguf",
    root/"models/draft/Qwen3.5-4B-Q4_K_M.gguf",
    root/"models/draft/Qwen3.5-2B-Q4_K_M.gguf",
    root/"models/draft/Qwen3.5-0.8B-Q4_K_M.gguf",
    root/"models/draft/Qwen3-1.7B-Q4_K_M.gguf",
    root/"models/draft/Qwen3-0.6B-Q4_K_M.gguf",
    root/"models/draft/Qwen3.6-35B-A3B-DFlash-Q4_K_M.gguf",
    root/"models/mtp/mtp-Qwen3.6-35B-A3B-Q4_0.gguf",
]
lines = []
for m in models:
    if not m.exists():
        lines.append(f"MISSING {m}")
        continue
    try:
        meta = tok_sha(m)
        lines.append(f"{m.name}\t{meta.get('general.architecture')}\ttok={meta.get('tokenizer.ggml.tokens.sha16')}\tmerges={meta.get('tokenizer.ggml.merges.sha16')}\t{meta.get('tokenizer.ggml.tokens')}")
    except Exception as e:
        lines.append(f"ERR {m.name}: {e}")
outp = root/"results/spec_ladder/n2/tokenizer_hashes.txt"
outp.write_text("\n".join(lines)+"\n", encoding="utf-8")
print(outp)
print("\n".join(lines))
