from pathlib import Path

src = Path(__file__).resolve().parent / "emit_driver.py"
dst = Path(__file__).resolve().parent / "emit_continue.py"
t = src.read_text(encoding="utf-8")
t = t.replace('emit("driver.sh", DRIVER)', 'emit("continue_driver.sh", DRIVER)')
t = t.replace('emit("launch.sh", LAUNCH)', 'emit("continue_launch.sh", LAUNCH)')
t = t.replace("kalsa_q44/driver.sh", "kalsa_q44/continue_driver.sh")
t = t.replace(">/data/local/tmp/kalsa_q44/driver.out", ">/data/local/tmp/kalsa_q44/continue.out")
dst.write_text(t, encoding="utf-8")
print("wrote", dst, "bytes", dst.stat().st_size)
