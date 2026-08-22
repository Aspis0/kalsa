from pathlib import Path
import csv
import statistics
from collections import defaultdict

p = Path(__file__).with_name("runs.csv")
rows = list(csv.DictReader(p.open(encoding="utf-8-sig")))
print("nrows", len(rows))
byb = defaultdict(list)
for r in rows:
    byb[int(r["block"])].append(r)

def cell_ok(r):
    return (
        r["rc"] == "0"
        and r["excluded"].lower() != "true"
        and r["over_cap"].lower() != "true"
        and r["tg512"] != ""
    )

complete = []
for b, cs in sorted(byb.items()):
    cs_s = sorted(cs, key=lambda x: int(x["cell_in_block"]))
    order = ",".join(x["arm"] for x in cs_s)
    oks = [x for x in cs if cell_ok(x)]
    excl = [x["exclude_reason"] for x in cs if x["excluded"].lower() == "true"]
    st = "COMPLETE" if (len(cs) == 6 and len(oks) == 6 and order == "A,B,C,C,B,A") else "INCOMPLETE"
    print(
        f"block {b} {st} n={len(cs)} ok={len(oks)} order={order} "
        f"warm={cs[0]['warm_start']} temp0={cs[0]['temp_c_block_start']} excl={excl}"
    )
    if st == "COMPLETE":
        complete.append(b)

counted = [r for r in rows if int(r["block"]) in complete and cell_ok(r)]


def med(arm, field="tg512"):
    v = [float(r[field]) for r in counted if r["arm"] == arm and r[field] != ""]
    v.sort()
    return v, (statistics.median(v) if v else None)


a, ma = med("A")
b, mb = med("B")
c, mc = med("C")
ta, mta = med("A", "temp_peak")
tb, mtb = med("B", "temp_peak")
tc, mtc = med("C", "temp_peak")
print("complete", complete)
print("nA nB nC", len(a), len(b), len(c))
print("A", a)
print("B", b)
print("C", c)
print("medA", ma)
print("medB", mb)
print("medC", mc)
print("A/B", (ma / mb) if mb else None)
print("A/C", (ma / mc) if mc else None)
print("peakA", mta, "peakB", mtb, "peakC", mtc, "A-B", (mta - mtb) if mta is not None and mtb is not None else None)
print("AB floor", (ma / mb) >= 1.50)
print("AC floor", (ma / mc) >= 1.20)
print("temp gate", mta <= mtb + 0.5)
print("no_repack", set(r["no_repack"] for r in counted))
print("sha_impl", set(r["sha_impl"] for r in counted))
print("sha_opencl", set(r["sha_opencl"] for r in counted))
print("sha_stub", set(r["sha_stub"] for r in counted))
print("wake_post", set(r["wake_post"] for r in counted))
print("over_cap", set(r["over_cap"] for r in counted))
print("label", set(r["label"] for r in counted))

# A decay per complete block
print("--- A decay ---")
for b in complete:
    cs = sorted(byb[b], key=lambda x: int(x["cell_in_block"]))
    a1 = float(cs[0]["tg512"])
    a2 = float(cs[5]["tg512"])
    print(b, a1, a2, (a1 - a2) / a1)

# arm D
dpath = Path(__file__).with_name("arm_d") / "runs.csv"
if dpath.exists():
    drows = list(csv.DictReader(dpath.open(encoding="utf-8-sig")))
    print("--- arm D ---")
    for r in drows:
        print(dict(r))
