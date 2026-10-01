import csv, json, glob, os, statistics
root = r"C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\olmoe_gpu_moe_s23\armC"
rows = list(csv.DictReader(open(os.path.join(root, "runs.csv"), encoding="utf-8-sig")))
assert len(rows)==12, len(rows)
A=[]; C=[]; tA=[]; tC=[]
mism=[]
for r in rows:
    assert r["rc"]=="0" and r["excluded"]=="False" and r["over_cap"]=="False"
    assert r["wake_pre"].endswith("Awake") and r["wake_post"].endswith("Awake")
    assert r["no_repack"]=="true"
    assert r["sha_impl"].startswith("8adc148c")
    assert r["sha_opencl"].startswith("f4325483")
    assert r["sha_stub"].startswith("b2ae0fa6")
    p = os.path.join(root, "cells", r["stdout_file"])
    j = json.loads(open(p, encoding="utf-8").read().strip().splitlines()[-1])
    if abs(float(j["avg_ts"]) - float(r["tg512"])) > 1e-9:
        mism.append((r["stdout_file"], j["avg_ts"], r["tg512"]))
    if r["arm"]=="A":
        assert int(j["n_gpu_layers"])==16 and int(j["n_cpu_moe"])==0
        A.append(float(r["tg512"])); tA.append(float(r["temp_peak"]))
    else:
        assert int(j["n_gpu_layers"])==0
        C.append(float(r["tg512"])); tC.append(float(r["temp_peak"]))
    assert int(j["n_threads"])==4 and int(j["flash_attn"])==0 and (j["no_repack"] is True if "no_repack" in j else ("repack" in j and j["repack"] is False))
    assert j["n_gen"]==512 and j["n_prompt"]==0
    assert j["build_commit"].startswith("7686ca6fc")
def med(x):
    s=sorted(x); n=len(s)
    return (s[n//2-1]+s[n//2])/2 if n%2==0 else s[n//2]
out=[]
out.append(f"n={len(rows)} mismatches={mism}")
out.append(f"medA={med(A):.17g} medC={med(C):.17g} A/C={med(A)/med(C):.17g}")
out.append(f"medTA={med(tA):.17g} medTC={med(tC):.17g} maxTA={max(tA)} maxTC={max(tC)}")
out.append(f"A={A}")
out.append(f"C={C}")
cc0=int(rows[0]["charge_counter_pre"]); cc1=int(rows[-1]["charge_counter_post"])
out.append(f"level {rows[0]['level_pre']}->{rows[-1]['level_post']} cc {cc0}->{cc1} dcc={cc0-cc1}")
open(os.path.join(root,"_verify_medians.txt"),"w",encoding="utf-8").write("\n".join(out)+"\n")
print("WROTE verify")
