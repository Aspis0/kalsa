from pathlib import Path
for name in ("run_calaqwen_fix_cont.sh", "run_calaqwen_fix_session.sh"):
    p = Path.home() / "experiments/scripts" / name
    if not p.exists():
        print("missing", p)
        continue
    t = p.read_text(encoding="utf-8")
    t2 = t.replace("-lt 6 ] 2>/dev/null; then", "-lt 2 ] 2>/dev/null; then")
    t2 = t2.replace('-lt 6 ] 2>/dev/null; then', '-lt 2 ] 2>/dev/null; then')
    p.write_text(t2, encoding="utf-8")
    print(name, "lt6_left", t2.count("-lt 6"), "lt2", t2.count("-lt 2"))
