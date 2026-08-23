rows = {
    "marco": dict(c=6385238912, q8=6509642624, iq=6343771008, q4=6343771008, tr=228073472, ex=6121586688),
    "olmoe": dict(c=2668941792, q8=2846872032, iq=2609631712, q4=2609631712, tr=326205440, ex=2332033024),
    "lfm": dict(c=3326160384, q8=3580407296, iq=3222842880, q4=3222842880, tr=505577472, ex=2805727232),
}
shipped_marco = 6385238848
shipped_lfm = 3326160384
lines = []
for k, v in rows.items():
    d8 = v["q8"] - v["c"]
    di = v["iq"] - v["c"]
    lines.append(
        f"{k} q8_delta={d8} pct={100 * d8 / v['c']:.3f} "
        f"iq_delta={di} pct={100 * di / v['c']:.3f} "
        f"trunk_share={100 * v['tr'] / v['c']:.2f} iq_eq_q4={v['iq'] == v['q4']}"
    )
lines.append(f"marco_vs_shipped={rows['marco']['c'] - shipped_marco}")
lines.append(f"lfm_vs_shipped={rows['lfm']['c'] - shipped_lfm}")
lines.append(f"marco_q8_vs_q36={6509642624 - 6509642560}")
lines.append(f"marco_iq_vs_q36={6343771008 - 6343770944}")
text = "\n".join(lines) + "\n"
Path = __import__("pathlib").Path
Path(__file__).with_name("_math_check.txt").write_text(text, encoding="utf-8")
print(text, end="")
