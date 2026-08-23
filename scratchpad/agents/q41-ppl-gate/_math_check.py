c, i, q = 9.5915, 10.0013, 10.3646
ci, ii, qi = 6.2585, 6.4725, 6.697
lines = [
    f"wiki_d_iq4={100 * (i - c) / c:.6f}",
    f"wiki_d_q40={100 * (q - c) / c:.6f}",
    f"wiki_pass_thr={c * 1.005:.6f}",
    f"wiki_grey_thr={c * 1.010:.6f}",
    f"wiki_iq4_minus_pass={i - c * 1.005:.6f}",
    f"it_d_iq4={100 * (ii - ci) / ci:.6f}",
    f"it_d_q40={100 * (qi - ci) / ci:.6f}",
    f"gate_iq4_fail={100 * (i - c) / c > 1.0}",
]
from pathlib import Path
Path(__file__).with_name("_math_check.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines))
