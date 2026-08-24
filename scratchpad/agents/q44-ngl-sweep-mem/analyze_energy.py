import hashlib
import json
import re
from pathlib import Path

root = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\htp_smoke\xiaomi_v75_bprime\kalsa_bprime_x")
edir = root / "energy"
out_dir = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\htp_smoke\xiaomi_v75_bprime")


def parse_batt(p: Path) -> dict:
    t = p.read_text(encoding="utf-8", errors="replace")
    def g(pat, cast=int):
        m = re.search(pat, t, re.M)
        return cast(m.group(1)) if m else None
    return {
        "cc": g(r"Charge counter:\s*(\d+)"),
        "level": g(r"^\s*level:\s*(\d+)"),
        "temp10": g(r"^\s*temperature:\s*(\d+)"),
        "mV": g(r"^\s*voltage:\s*(\d+)"),
    }


def jlines(p: Path):
    rows = []
    if not p.exists():
        return rows
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.strip().startswith("{"):
            rows.append(json.loads(line))
    return rows


def energy(pre, post, tokens, label):
    dq = pre["cc"] - post["cc"]
    v = 0.5 * (pre["mV"] + post["mV"]) / 1000.0
    E = (dq / 1e6) * v * 3600.0
    dT = (post["temp10"] - pre["temp10"]) / 10.0
    jpt = E / tokens if tokens else None
    rec = {
        "label": label,
        "dQ_uAh": dq,
        "dQ_mAh": dq / 1000.0,
        "Vmean": v,
        "E_J": E,
        "tokens": tokens,
        "J_per_token": jpt,
        "dT_C": dT,
        "Tpre": pre["temp10"] / 10.0,
        "Tpost": post["temp10"] / 10.0,
        "level_pre": pre["level"],
        "level_post": post["level"],
        "cc_pre": pre["cc"],
        "cc_post": post["cc"],
    }
    print(
        f"{label}: dQ={dq} uAh ({rec['dQ_mAh']:.1f} mAh) V={v:.4f} E={E:.1f} J "
        f"tok={tokens} J/tok={jpt:.4f} dT={dT:.1f}C ({rec['Tpre']:.1f}->{rec['Tpost']:.1f}) "
        f"batt {pre['level']}->{post['level']}"
    )
    return rec


print("=== C primary -r 2 jsonl ===")
for r in jlines(root / "c_stdout.jsonl"):
    print(f"  n_prompt={r.get('n_prompt')} n_gen={r.get('n_gen')} avg_ts={r.get('avg_ts'):.6f} samples={r.get('samples_ts')}")

print("=== energy cpu reps jsonl ===")
for i in (1, 2):
    print(f" -- c_rep{i} --")
    for r in jlines(edir / f"c_rep{i}_stdout.jsonl"):
        print(f"  n_prompt={r.get('n_prompt')} n_gen={r.get('n_gen')} avg_ts={r.get('avg_ts'):.6f} samples={r.get('samples_ts')}")

print("=== extra HTP jsonl ===")
for r in jlines(edir / "b_extra_stdout.jsonl"):
    print(f"  n_prompt={r.get('n_prompt')} n_gen={r.get('n_gen')} avg_ts={r.get('avg_ts'):.6f} samples={r.get('samples_ts')}")

# tokens: default warmup + r reps
# original (b)/(c) -r 2: 3*(512+128)=1920
# energy -r 1: 2*(512+128)=1280
TOK_R2 = 3 * 512 + 3 * 128
TOK_R1 = 2 * 512 + 2 * 128

recs = []
recs.append(energy(parse_batt(root / "battery_b_pre.txt"), parse_batt(root / "battery_b_post.txt"), TOK_R2, "HTP (b) original -r2 PROCESS"))
recs.append(energy(parse_batt(root / "battery_c_pre.txt"), parse_batt(root / "battery_c_post.txt"), TOK_R2, "CPU (c) original -r2 PROCESS"))
recs.append(energy(parse_batt(edir / "c_rep1_charge_pre.txt"), parse_batt(edir / "c_rep1_charge_post.txt"), TOK_R1, "CPU energy rep1 -r1 PROCESS"))
recs.append(energy(parse_batt(edir / "c_rep2_charge_pre.txt"), parse_batt(edir / "c_rep2_charge_post.txt"), TOK_R1, "CPU energy rep2 -r1 PROCESS"))
recs.append(energy(parse_batt(edir / "b_extra_charge_pre.txt"), parse_batt(edir / "b_extra_charge_post.txt"), TOK_R1, "HTP extra (b) -r1 PROCESS"))

# write energy_summary.txt
lines = [
    "xiaomi_v75_bprime energy summary",
    "sysfs /sys/class/power_supply/battery/charge_counter = EACCES for adb shell",
    "source = dumpsys battery 'Charge counter' (uAh) + voltage (mV)",
    "E_J = (dQ_uAh/1e6) * Vmean * 3600",
    "Vmean = average of pre/post dumpsys voltage",
    "UNPLUGGED all probes (AC=USB=Wireless=Dock=false)",
    "tokens assume llama-bench default warmup ON: -r N => (N+1) * (pp512+tg128)",
    "ALL process brackets INCLUDE model load + HTP session init (even -ngl 0 opens HTP0)",
    "(a) sanity omitted from J/token (load-dominated, 24 tokens)",
    "",
]
for rec in recs:
    lines.append(
        "{label}: dQ_uAh={dQ_uAh} Vmean={Vmean:.4f} E_J={E_J:.1f} tokens={tokens} "
        "J_per_token={J_per_token:.4f} dT_C={dT_C:.1f} T={Tpre:.1f}->{Tpost:.1f} "
        "level={level_pre}->{level_post} cc={cc_pre}->{cc_post}".format(**rec)
    )
lines.append("")
htp = recs[0]
cpu = recs[1]
lines.append(f"matched original process: HTP/CPU energy = {htp['E_J']/cpu['E_J']:.3f}")
lines.append(f"matched original process: CPU/HTP J/token = {cpu['J_per_token']/htp['J_per_token']:.3f}")
(edir / "energy_summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("wrote energy_summary")

# MANIFEST refresh
mlines = [
    "# Xiaomi v75 B-prime Q8_0-trunk HTP smoke — MANIFEST",
    "",
    "REGISTRA+DICHIARA. Includes (a)(b) HTP, (c) CPU same-harness, energy probes.",
    "SHA256 Python hashlib PC-side.",
    "",
    "## Pins",
    "",
    "| artifact | value | sha256 |",
    "|---|---|---|",
    "| device | houji / 23127PN0CG / `adb-625689a2-9xEOfw._adb-tls-connect._tcp` | |",
    "| llama-bench | kalsahtp @3f545be | `5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507` |",
    "| libggml-htp-v75.so | kalsahtp | `46d3ac923988f20b75d6d3489eea0e1432aa275aaff61c39253e170c17729182` |",
    "| GGUF | 6509642624 B | `bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419` |",
    "| (b) HTP | `-ngl 99 -dev HTP0 --no-host 1 -p 512 -n 128 -r 2` HOSTBUF=1 | |",
    "| (c) CPU | `-ngl 0` no -dev HTP0 no --no-host, same -p/-n/-r/jsonl | |",
    "| (d) | skipped (ambiguous) | |",
    "| energy | dumpsys Charge counter (sysfs EACCES) | |",
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
    mlines.append(f"| `{rel}` | {p.stat().st_size} | `{h.hexdigest()}` |")
mlines.append("")
(out_dir / "MANIFEST.md").write_text("\n".join(mlines), encoding="utf-8")
print("MANIFEST files", len(files))
