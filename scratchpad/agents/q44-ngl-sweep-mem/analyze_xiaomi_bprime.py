import hashlib
import json
import re
from pathlib import Path

root = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\htp_smoke\xiaomi_v75_bprime\kalsa_bprime_x")
out_dir = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\htp_smoke\xiaomi_v75_bprime")


def jlines(p: Path):
    rows = []
    if not p.exists():
        return rows
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line.startswith("{"):
            rows.append(json.loads(line))
    return rows


print("=== A STDOUT ===")
for r in jlines(root / "a_stdout.jsonl"):
    print(
        f"  n_prompt={r.get('n_prompt')} n_gen={r.get('n_gen')} avg_ts={r.get('avg_ts'):.6f} "
        f"backend={r.get('backends')} ngl={r.get('n_gpu_layers')} no_host={r.get('no_host')} "
        f"fa={r.get('flash_attn')} n_threads={r.get('n_threads')}"
    )
print("=== B STDOUT ===")
for r in jlines(root / "b_stdout.jsonl"):
    print(
        f"  n_prompt={r.get('n_prompt')} n_gen={r.get('n_gen')} avg_ts={r.get('avg_ts'):.6f} "
        f"stddev_ts={r.get('stddev_ts')} samples_ts={r.get('samples_ts')} backend={r.get('backends')}"
    )

print("=== HEADER SESSION ===")
print((root / "header_session.txt").read_text(encoding="utf-8", errors="replace"))
print("=== HEADER B ===")
print((root / "header_b.txt").read_text(encoding="utf-8", errors="replace"))
print("=== A_PROOF ===")
print((root / "a_proof.txt").read_text(encoding="utf-8", errors="replace"))
print("=== BUF ===")
print((root / "a_buffer_sizes.txt").read_text(encoding="utf-8", errors="replace"))
print("=== OFFLOAD ===")
print((root / "a_offload.txt").read_text(encoding="utf-8", errors="replace"))
print("=== RC ===", (root / "a_rc.txt").read_text().strip(), (root / "b_rc.txt").read_text().strip())
print("=== LOG ===")
print((root / "driver.log").read_text(encoding="utf-8", errors="replace"))

attn = (root / "a_execute_op_attn.txt").read_text(encoding="utf-8", errors="replace").splitlines()
print("attn execute-op count", len(attn))
for key in ["attn_q.weight", "attn_k.weight", "attn_v.weight", "attn_output.weight"]:
    hits = [l for l in attn if key in l and "MUL_MAT" in l and "HTP0" in l]
    print(f"  MUL_MAT {key} n={len(hits)}")
    if hits:
        print("   ", hits[0][:240])

experts = (root / "a_execute_op_experts.txt").read_text(encoding="utf-8", errors="replace").splitlines()
print("expert execute-op lines", len(experts))
if experts:
    print("  first", experts[0][:240])

mm = (root / "a_execute_op_mul_mat.txt").read_text(encoding="utf-8", errors="replace").splitlines()
q8 = [l for l in mm if "q8_0" in l.lower() and "HTP0" in l]
q2 = [l for l in mm if "q2_k" in l.lower() or "q2_K" in l]
q3 = [l for l in mm if "q3_k" in l.lower() or "q3_K" in l]
print("MUL_MAT q8_0 HTP lines", len(q8))
if q8:
    print("  first", q8[0][:240])
print("MUL_MAT q2_k lines", len(q2))
print("MUL_MAT q3_k lines", len(q3))
if q2:
    print("  q2 first", q2[0][:240])
if q3:
    print("  q3 first", q3[0][:240])

print("b_stderr tail:")
print("\n".join((root / "b_stderr.txt").read_text(encoding="utf-8", errors="replace").splitlines()[-20:]))

# MANIFEST
lines = [
    "# Xiaomi v75 B-prime Q8_0-trunk HTP smoke — MANIFEST",
    "",
    "REGISTRA+DICHIARA. SHA256 Python hashlib PC-side. Device sha256sum for binaries+model recorded in kalsa_bprime_x/binary_sha.txt and pre-push on-device sha.",
    "",
    "## Pins",
    "",
    "| artifact | value | sha256 |",
    "|---|---|---|",
    "| device | houji / 23127PN0CG / `adb-625689a2-9xEOfw._adb-tls-connect._tcp` | |",
    "| llama-bench | `/data/local/tmp/kalsahtp/llama-bench` @3f545be | `5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507` |",
    "| libllama-bench-impl.so | kalsahtp | `5c744d726e76b03c03e2b7821915ab21b8794bdbe1d32d6092169f78d0183915` |",
    "| libggml-hexagon.so | kalsahtp | `f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448` |",
    "| libggml-htp-v75.so | kalsahtp | `46d3ac923988f20b75d6d3489eea0e1432aa275aaff61c39253e170c17729182` |",
    "| GGUF | `/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` 6509642624 B | `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` |",
    "| env | GGML_HEXAGON_NDEV=1 HOSTBUF=1 (v75 cell1) VERBOSE=1 on (a) | |",
    "| flags | `-ngl 99 -dev HTP0 --no-host 1 --load-mode none -fa on --ubatch-size 1024` | |",
    "| (a) | `-p 16 -n 8 -r 1 --no-warmup -v -o jsonl` | |",
    "| (b) | `-p 512 -n 128 -r 2 -o jsonl` exploratory | |",
    "| deletions | none | |",
    "",
    "## Pulled files (`kalsa_bprime_x/`)",
    "",
    "| path | bytes | sha256 |",
    "|---|---:|---|",
]
base = out_dir
files = sorted(p for p in out_dir.rglob("*") if p.is_file() and p.name != "MANIFEST.md")
for p in files:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    rel = p.relative_to(out_dir).as_posix()
    lines.append(f"| `{rel}` | {p.stat().st_size} | `{h.hexdigest()}` |")
lines.append("")
(out_dir / "MANIFEST.md").write_text("\n".join(lines), encoding="utf-8")
print("wrote MANIFEST", len(files), "files")
