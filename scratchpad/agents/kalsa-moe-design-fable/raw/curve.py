import sys, numpy as np, csv
sys.path.insert(0, '~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-expert-usage-v3/raw')
from router_data import load_segments, group_indices, N_LAYER, N_EXPERT
groups, tokens, c, m = load_segments('/tmp/moe-expert-usage-v3/runs')
gi = group_indices(groups)
KEEP = ["it","fr","es","en","zh","code","math"]
rng = np.random.default_rng(20261001)
# content-disjoint split: FLORES segment id i is parallel across languages -> split by position index within group
# (groups have 40 segments each in run order; use same positions for all groups)
pos = rng.permutation(40); cal_pos, test_pos = pos[:20], pos[20:]
def mass_of(g, which):
    idx = gi[g][which]
    return m[idx].sum(axis=0)  # [layer, expert]
cal = {g: mass_of(g, cal_pos) for g in gi}
test = {g: mass_of(g, test_pos) for g in gi}
# balanced ranking score: equal-weight mean over KEEP groups of per-token mass share
def score(weights):
    s = np.zeros((N_LAYER, N_EXPERT))
    for g,w in weights.items():
        tot = tokens[gi[g][cal_pos]].sum()
        s += w * cal[g] / tot
    return s
def retained(keepmask, g):
    t = test[g]
    return (t*keepmask).sum()/t.sum()
def retained_per_layer(keepmask, g):
    t = test[g]
    return (t*keepmask).sum(axis=1)/t.sum(axis=1)
bal = score({g:1.0 for g in KEEP})
order = np.argsort(-bal, axis=1)
print("size, " + ", ".join(KEEP) + ", de, ja, ko, ru, ar")
for K in [64, 96, 112, 128, 144, 160, 192, 224, 256]:
    keep = np.zeros((N_LAYER,N_EXPERT),bool)
    for l in range(N_LAYER): keep[l, order[l,:K]] = True
    row = [f"{100*retained(keep,g):.1f}" for g in KEEP+["de","ja","ko","ru","ar"]]
    print(K, ", ".join(row))
# per-layer heterogeneity at K=128 for IT and CODE
keep = np.zeros((N_LAYER,N_EXPERT),bool)
for l in range(N_LAYER): keep[l, order[l,:128]] = True
for g in ["it","code","math"]:
    r = retained_per_layer(keep,g)
    print(g, "per-layer retained@128: min %.1f p25 %.1f med %.1f p75 %.1f max %.1f" % tuple(100*np.percentile(r,[0,25,50,75,100])))
# per-layer concentration: fraction of balanced cal mass in top-128 per layer (in-sample) and effective number of experts exp(H)
bal_norm = bal / bal.sum(axis=1, keepdims=True)
H = -(bal_norm*np.log(np.where(bal_norm>0,bal_norm,1))).sum(axis=1)
neff = np.exp(H)
top128 = np.sort(bal_norm,axis=1)[:, ::-1][:, :128].sum(axis=1)
print("layer, neff, top128_mass_share")
for l in range(N_LAYER): print(l, f"{neff[l]:.1f}", f"{100*top128[l]:.1f}")
