import sys, numpy as np
sys.path.insert(0, '~/Projects/kalsa-moe-experiments/scratchpad/agents/moe-expert-usage-v3/raw')
from router_data import load_segments, group_indices, N_LAYER, N_EXPERT
groups, tokens, c, m = load_segments('/tmp/moe-expert-usage-v3/runs')
gi = group_indices(groups)
KEEP = ["it","fr","es","en","zh","code","math"]
rng = np.random.default_rng(20261001)
pos = rng.permutation(40); cal_pos, test_pos = pos[:20], pos[20:]
cal = {g: m[gi[g][cal_pos]].sum(axis=0) for g in gi}
test = {g: m[gi[g][test_pos]].sum(axis=0) for g in gi}
caltok = {g: tokens[gi[g][cal_pos]].sum() for g in gi}
def share(g, keep): t=test[g]; return 100*(t*keep).sum()/t.sum()
def keep_from_score(s, K):
    keep = np.zeros((N_LAYER,N_EXPERT),bool)
    o = np.argsort(-s,axis=1)
    for l in range(N_LAYER): keep[l,o[l,:K]] = True
    return keep
def score(w):
    s=np.zeros((N_LAYER,N_EXPERT))
    for g,wg in w.items(): s += wg*cal[g]/caltok[g]
    return s
print("== A. weight frontier at uniform 128 (code,math weight x; langs 1) ==")
print("w_cm | it fr es en zh code math | de ja ko ru ar")
for wcm in [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0]:
    w={g:1.0 for g in ["it","fr","es","en","zh"]}; w["code"]=wcm; w["math"]=wcm
    keep=keep_from_score(score(w),128)
    print(f"{wcm:4.1f} | " + " ".join(f"{share(g,keep):5.1f}" for g in KEEP) + " | " + " ".join(f"{share(g,keep):5.1f}" for g in ["de","ja","ko","ru","ar"]))
print("\n== B. coverage rule: per-domain quota q from each domain's own top list, remainder by balanced mean (uniform 128) ==")
bal=score({g:1.0 for g in KEEP})
for q in [0, 32, 48, 64, 80, 96]:
    keep=np.zeros((N_LAYER,N_EXPERT),bool)
    for l in range(N_LAYER):
        for g in KEEP:
            o=np.argsort(-cal[g][l]); keep[l,o[:q]]=True
        # fill to 128 by balanced score among the rest
        if keep[l].sum()>128:
            # too many: trim lowest balanced among the union
            idx=np.where(keep[l])[0]; o=idx[np.argsort(-bal[l,idx])]; keep[l]=False; keep[l,o[:128]]=True
        else:
            o=np.argsort(-bal[l]); 
            for e in o:
                if keep[l].sum()>=128: break
                keep[l,e]=True
    print(f"q={q:3d} | " + " ".join(f"{share(g,keep):5.1f}" for g in KEEP) + f" | min={min(share(g,keep) for g in KEEP):.1f}")
print("\n== C. max-min greedy at uniform 128: at each step add the expert that most raises the currently-worst domain share (per layer) ==")
keep=np.zeros((N_LAYER,N_EXPERT),bool)
for l in range(N_LAYER):
    tot={g:cal[g][l].sum() for g in KEEP}
    got={g:0.0 for g in KEEP}
    avail=np.ones(N_EXPERT,bool)
    for step in range(128):
        gw=min(KEEP,key=lambda g: got[g]/tot[g])
        cand=np.where(avail)[0]; e=cand[np.argmax(cal[gw][l][cand])]
        avail[e]=False; keep[l,e]=True
        for g in KEEP: got[g]+=cal[g][l][e]
print("maxmin | " + " ".join(f"{share(g,keep):5.1f}" for g in KEEP) + " | " + " ".join(f"{share(g,keep):5.1f}" for g in ["de","ja","ko","ru","ar"]))
print("\n== D. non-uniform per-layer budget, total 40*128=5120, floor 64 cap 224, greedy on balanced marginal cal mass ==")
s=bal/ bal.sum(axis=1,keepdims=True)  # per-layer normalized balanced share
sorted_s=-np.sort(-s,axis=1)
cum=np.cumsum(sorted_s,axis=1)
K=np.full(N_LAYER,64)
while K.sum()<5120:
    gain=np.array([sorted_s[l,K[l]] if K[l]<224 else -1 for l in range(N_LAYER)])
    l=int(np.argmax(gain)); K[l]+=1
keep=np.zeros((N_LAYER,N_EXPERT),bool); o=np.argsort(-bal,axis=1)
for l in range(N_LAYER): keep[l,o[l,:K[l]]]=True
keepu=keep_from_score(bal,128)
print("K per layer:", K.tolist())
print("uniform128 | " + " ".join(f"{share(g,keepu):5.1f}" for g in KEEP))
print("nonunif    | " + " ".join(f"{share(g,keep):5.1f}" for g in KEEP))
# also test allocation driven by per-layer code/lang divergence (JS) as in 2605.28042, just report JS per layer
def js(p,q):
    p=p/p.sum(); q=q/q.sum(); mm=0.5*(p+q)
    def kl(a,b): 
        mask=a>0; return (a[mask]*np.log(a[mask]/b[mask])).sum()
    return 0.5*kl(p,mm)+0.5*kl(q,mm)
jsl=[js(cal["it"][l],cal["en"][l]) for l in range(N_LAYER)]
jsc=[js(cal["code"][l],cal["en"][l]) for l in range(N_LAYER)]
print("JS(it,en) per layer:", [round(x,3) for x in jsl])
print("JS(code,en) per layer:", [round(x,3) for x in jsc])
print("\n== E. RAZOR dbpb vs removed mass (A40 bpb, v3 removed share) ==")
r=np.array([0.509,0.498,0.494,0.415,0.449]); d=np.array([1.462-0.580,1.274-0.604,1.141-0.601,0.792-0.586,1.101-0.852])
A=np.vstack([np.ones(5),r]).T; coef,res,_,_=np.linalg.lstsq(A,np.log(d),rcond=None)
pred=np.exp(A@coef); print("ln d = %.2f + %.1f r ; e-fold in r = %.3f ; pred:"%(coef[0],coef[1],1/coef[1]), np.round(pred,3), "obs:", np.round(d,3))
for rr in [0.11,0.15,0.25,0.32,0.415,0.50]: print(f"  r={rr:.3f} -> dbpb {np.exp(coef[0]+coef[1]*rr):.3f}")
print("\n== F. size table (GB, 1e9 B). experts 3,145,728 params; 40 layers; dense (non-expert) text params 2,448,355,968 ==")
PE=3145728; L=40; DENSE=34660610688-32212254720
def gb(K, bpw_e, bpw_d=5.5): return (K*L*PE*bpw_e/8 + DENSE*bpw_d/8)/1e9
for K in [96,112,128,144,160,192,256]:
    print(f"K={K:3d} | Q4_K(4.85):{gb(K,4.85):5.2f} Q4_0(4.5):{gb(K,4.5):5.2f} Q3_K_M(3.9):{gb(K,3.9):5.2f} IQ3_S(3.5):{gb(K,3.5):5.2f} IQ3_XXS(3.1):{gb(K,3.1):5.2f} KEXP(2.75):{gb(K,2.75):5.2f} IQ2_M(2.7):{gb(K,2.7):5.2f}  [dense 5.5 bpw = {DENSE*5.5/8/1e9:.2f} GB]")
# streaming bytes/token (no cache): k experts * L * PE * bpw/8
for k in [8,6,4]:
    print(f"k={k}: raw expert bytes/token Q4_0 {k*L*PE*4.5/8/2**20:.0f} MiB, IQ3_S {k*L*PE*3.5/8/2**20:.0f} MiB, KEXP {k*L*PE*2.75/8/2**20:.0f} MiB")
