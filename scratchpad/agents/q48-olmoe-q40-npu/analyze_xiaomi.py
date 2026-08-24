import hashlib
import json
import re
from collections import Counter
from pathlib import Path

root = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\htp_probe\xiaomi_v75_olmoe_q40\kalsa_q48_x")
out_dir = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\htp_probe\xiaomi_v75_olmoe_q40")


def jlines(p: Path):
    rows = []
    for src in (p, Path(str(p).replace("_stdout.jsonl", "_stdout_from_stderr.jsonl"))):
        if not src.exists():
            continue
        for line in src.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.strip().startswith("{"):
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return rows


def parse_batt(p: Path):
    t = p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""
    def g(pat, cast=int):
        m = re.search(pat, t, re.M)
        return cast(m.group(1)) if m else None
    return {
        "cc": g(r"Charge counter:\s*(\d+)"),
        "level": g(r"^\s*level:\s*(\d+)"),
        "temp10": g(r"^\s*temperature:\s*(\d+)"),
        "mV": g(r"^\s*voltage:\s*(\d+)"),
    }


def energy(pre, post, tokens, label):
    if not pre["cc"] or not post["cc"]:
        print(label, "missing charge")
        return None
    dq = pre["cc"] - post["cc"]
    v = 0.5 * ((pre["mV"] or 0) + (post["mV"] or 0)) / 1000.0
    E = (dq / 1e6) * v * 3600.0 if v else None
    dT = ((post["temp10"] or 0) - (pre["temp10"] or 0)) / 10.0
    jpt = E / tokens if E is not None and tokens else None
    print(
        f"{label}: dQ={dq} uAh ({dq/1000:.1f} mAh) V={v:.4f} E={E:.1f}J tok={tokens} "
        f"J/tok={jpt} dT={dT:.1f}C T={pre['temp10']/10:.1f}->{post['temp10']/10:.1f} "
        f"batt {pre['level']}->{post['level']}"
    )
    return {"label": label, "dQ": dq, "E": E, "jpt": jpt, "dT": dT, "tokens": tokens}


print("=== jsonl ===")
for name in ["a_stdout.jsonl", "b_r1_stdout.jsonl", "b_r2_stdout.jsonl", "b_tg_stdout.jsonl", "c_r1_stdout.jsonl", "c_r2_stdout.jsonl"]:
    print(f"-- {name} --")
    rows = jlines(root / name)
    if not rows:
        # try from_stderr sibling
        alt = root / name.replace("_stdout.jsonl", "_stdout_from_stderr.jsonl")
        print("  empty primary, from_stderr exists", alt.exists(), "bytes", alt.stat().st_size if alt.exists() else 0)
        rows = jlines(alt) if alt.exists() else []
    for r in rows:
        print(
            f"  n_prompt={r.get('n_prompt')} n_gen={r.get('n_gen')} avg_ts={r.get('avg_ts')} "
            f"samples={r.get('samples_ts')} ngl={r.get('n_gpu_layers')} no_host={r.get('no_host')}"
        )

print("=== a proof / buffers ===")
print((root / "a_proof.txt").read_text())
print((root / "a_buffer_sizes.txt").read_text())
print((root / "a_offload.txt").read_text())
print((root / "a_errcounts.txt").read_text())

exps = (root / "a_execute_op_exps.txt").read_text(encoding="utf-8", errors="replace").splitlines()
print("exps lines", len(exps))
by_w = Counter()
by_tile = Counter()
for l in exps:
    if "ffn_gate_exps" in l:
        by_w["gate"] += 1
    elif "ffn_up_exps" in l:
        by_w["up"] += 1
    elif "ffn_down_exps" in l:
        by_w["down"] += 1
    if "hmx-tiled" in l:
        by_tile["hmx"] += 1
    elif "hvx-tiled" in l:
        by_tile["hvx"] += 1
    else:
        by_tile["other"] += 1
print("by weight", dict(by_w))
print("by tile", dict(by_tile))
if exps:
    print("sample", exps[0][:280])

print("=== errcounts all ===")
for p in sorted(root.glob("*_errcounts.txt")):
    print(p.name, p.read_text().replace("\n", " | "))

print("=== crash_context exists? ===")
for p in sorted(root.glob("*crash_context*")):
    t = p.read_text(encoding="utf-8", errors="replace")
    print(p.name, "bytes", len(t), "dspqueue" in t, "first100", t[:100].replace("\n", " "))

print("=== global grep ===")
for pat in ["dspqueue", "INTERNAL-ERROR", "hmx error", "Aborted", "ggml_abort"]:
    n = 0
    files = []
    for p in root.glob("*stderr.txt"):
        t = p.read_text(encoding="utf-8", errors="replace")
        c = len(re.findall(pat, t, flags=re.I if "hmx" in pat else 0))
        if c:
            n += c
            files.append(f"{p.name}:{c}")
    print(pat, n, files)

print("=== energy ===")
# (a) tokens 16+8 no warmup = 24, load dominated
# (b) -r 1 -n 0: warmup ON => 2*512 = 1024 prompt tokens
# (b_tg) -p 0 -n 128 -r 1 warmup => 2*128 = 256
# (c) -r 1 pp+tg warmup => 2*(512+128)=1280
pairs = [
    ("a", 24, "HTP (a) pp16+tg8 no-warmup LOAD-DOMINATED"),
    ("b_r1", 1024, "HTP (b) r1 pp512 -n 0"),
    ("b_r2", 1024, "HTP (b) r2 pp512 -n 0"),
    ("b_tg", 256, "HTP tg128 -p 0 -n 128"),
    ("c_r1", 1280, "CPU (c) r1 pp512+tg128"),
    ("c_r2", 1280, "CPU (c) r2 pp512+tg128"),
]
for tag, tok, label in pairs:
    pre = parse_batt(root / f"charge_{tag}_pre.txt")
    post = parse_batt(root / f"charge_{tag}_post.txt")
    energy(pre, post, tok, label)

print("=== header session ===")
print((root / "header_session.txt").read_text(encoding="utf-8", errors="replace")[:500])
print("=== session end batt ===")
end = parse_batt(root / "battery_session_end.txt")
print(end)

# MANIFEST
lines = [
    "# Xiaomi v75 OLMoE-Q4_0 experts-on-NPU probe — MANIFEST",
    "",
    "REGISTRA+DICHIARA. SHA256 Python hashlib PC-side.",
    "",
    "## Pins",
    "",
    "| artifact | value | sha256 |",
    "|---|---|---|",
    "| device | houji / 23127PN0CG / `adb-625689a2-9xEOfw._adb-tls-connect._tcp` | |",
    "| llama-bench | kalsahtp @3f545be | `5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507` |",
    "| libggml-htp-v75.so | kalsahtp | `46d3ac923988f20b75d6d3489eea0e1432aa275aaff61c39253e170c17729182` |",
    "| GGUF | OLMoE-1B-7B-0924-Instruct-Q4_0.gguf 3928037856 B | `43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500` |",
    "| env | HOSTBUF=1 NDEV=1 VERBOSE=1 on HTP cells | |",
    "| HTP flags | `-ngl 99 -dev HTP0 --no-host 1 --load-mode none -fa on --ubatch-size 1024` | |",
    "| deletions | none | |",
    "",
    "## Pulled files",
    "",
    "| path | bytes | sha256 |",
    "|---|---:|---|",
]
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
print("MANIFEST", len(files))
