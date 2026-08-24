"""Extract charge/voltage/temp from dumpsys battery dumps already on disk."""
import re
from pathlib import Path

root = Path(r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\htp_smoke\xiaomi_v75_bprime\kalsa_bprime_x")


def parse(p: Path) -> dict:
    t = p.read_text(encoding="utf-8", errors="replace")
    def g(pat, cast=int):
        m = re.search(pat, t, re.M)
        return cast(m.group(1)) if m else None
    return {
        "source": p.name,
        "charge_counter_uAh": g(r"Charge counter:\s*(\d+)"),
        "level": g(r"^\s*level:\s*(\d+)"),
        "temperature_tenth_C": g(r"^\s*temperature:\s*(\d+)"),
        "voltage_mV": g(r"^\s*voltage:\s*(\d+)"),
        "ac": g(r"AC powered:\s*(true|false)", str),
        "usb": g(r"USB powered:\s*(true|false)", str),
        "wireless": g(r"Wireless powered:\s*(true|false)", str),
        "dock": g(r"Dock powered:\s*(true|false)", str),
        "status": g(r"^\s*status:\s*(\d+)"),
    }


def write(name: str, d: dict, note: str) -> None:
    lines = [
        f"note={note}",
        "sysfs=/sys/class/power_supply/battery/charge_counter Permission denied (shell)",
        "source=dumpsys battery Charge counter (uAh)",
    ]
    for k, v in d.items():
        lines.append(f"{k}={v}")
    (root / name).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote", name, d)


pairs = [
    ("charge_b_process_pre.txt", "battery_b_pre.txt", "HTP (b) whole-process PRE (original -r 2, includes load+warmup)"),
    ("charge_b_process_post.txt", "battery_b_post.txt", "HTP (b) whole-process POST"),
    ("charge_c_process_pre.txt", "battery_c_pre.txt", "CPU (c) whole-process PRE (original -r 2, includes load+warmup)"),
    ("charge_c_process_post.txt", "battery_c_post.txt", "CPU (c) whole-process POST"),
    ("charge_a_process_pre.txt", "battery_a_pre.txt", "HTP (a) sanity PRE — load-dominated, not for J/token"),
    ("charge_a_process_post.txt", "battery_a_post.txt", "HTP (a) sanity POST"),
]
for out, src, note in pairs:
    write(out, parse(root / src), note)

# compute
bpre, bpost = parse(root / "battery_b_pre.txt"), parse(root / "battery_b_post.txt")
cpre, cpost = parse(root / "battery_c_pre.txt"), parse(root / "battery_c_post.txt")


def energy(pre, post, tokens, label):
    dq = pre["charge_counter_uAh"] - post["charge_counter_uAh"]  # uAh used
    v = 0.5 * (pre["voltage_mV"] + post["voltage_mV"]) / 1000.0
    # E = Ah * V * 3600 J
    E = (dq / 1e6) * v * 3600.0
    dT = (post["temperature_tenth_C"] - pre["temperature_tenth_C"]) / 10.0
    jpt = E / tokens if tokens else None
    print(
        f"{label}: dQ={dq} uAh ({dq/1000:.1f} mAh) Vmean={v:.4f} V  E={E:.1f} J  "
        f"tokens={tokens} J/tok={jpt:.4f}  dT={dT:.1f} C  "
        f"T {pre['temperature_tenth_C']/10:.1f}->{post['temperature_tenth_C']/10:.1f}"
    )


# warmup + 2 reps of pp512 and tg128
TOK = 3 * 512 + 3 * 128
energy(bpre, bpost, TOK, "HTP (b) process")
energy(cpre, cpost, TOK, "CPU (c) process")
print("ratio E_htp/E_cpu", ((bpre["charge_counter_uAh"] - bpost["charge_counter_uAh"]) / (cpre["charge_counter_uAh"] - cpost["charge_counter_uAh"])))
