#!/usr/bin/env python3
from pathlib import Path
from collections import Counter

base = Path(r"results/htp_probe/s23_v73_olmoe_q40/device/kalsa_q48")
exps = (base / "a_execute_op_exps_htp0.txt").read_text(encoding="utf-8", errors="replace").splitlines()
mmid = (base / "a_execute_op_mul_mat_id.txt").read_text(encoding="utf-8", errors="replace").splitlines()
attn = (base / "a_execute_op_attn.txt").read_text(encoding="utf-8", errors="replace").splitlines()
htp = (base / "a_execute_op_htp0.txt").read_text(encoding="utf-8", errors="replace").splitlines()
init_exps = (base / "a_init_tensor_exps.txt").read_text(encoding="utf-8", errors="replace").splitlines()
init_attn = (base / "a_init_tensor_attn.txt").read_text(encoding="utf-8", errors="replace").splitlines()
yes = (base / "a_supports_mul_mat_id_yes.txt").read_text(encoding="utf-8", errors="replace").splitlines()
no = (base / "a_supports_mul_mat_id_no.txt").read_text(encoding="utf-8", errors="replace").splitlines()

kern = Counter()
for line in exps:
    if "hmx-tiled" in line:
        kern["hmx"] += 1
    elif "hvx-tiled" in line:
        kern["hvx"] += 1
    else:
        kern["other"] += 1
    if "x 8:16 ->" in line or "x 8:16:" in line:
        kern["shape_n16"] += 1
    if "x 8:1 ->" in line or "x 8:1:" in line:
        kern["shape_n1"] += 1

out = []
out.append(f"n_exps_htp0={len(exps)}")
out.append(f"n_mul_mat_id={len(mmid)}")
out.append(f"n_attn={len(attn)}")
out.append(f"n_htp0={len(htp)}")
out.append(f"n_init_exps={len(init_exps)}")
out.append(f"n_init_attn={len(init_attn)}")
out.append(f"n_supports_yes={len(yes)} n_supports_no={len(no)}")
out.append(f"exps_kernel {dict(kern)}")
out.append("--- init_exps first 6 ---")
out.extend(init_exps[:6])
out.append("--- init_attn first 4 ---")
out.extend(init_attn[:4])
out.append("--- last 3 exps ---")
out.extend(exps[-3:])
text = "\n".join(out) + "\n"
Path(r"scratchpad/agents/q48-olmoe-q40-npu/counts.txt").write_text(text, encoding="utf-8")
print(text)
