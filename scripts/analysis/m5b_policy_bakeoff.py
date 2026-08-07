#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, math, sys
from collections import defaultdict
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from m5_route_trace_analysis import MIB, N_EXPERT, N_LAYER, CacheSim, build_batches, load_trace, parse_stdout
REPO = Path(__file__).resolve().parents[2]
DEFAULT_TRACES = REPO / "results" / "f4.8" / "traces"
DEFAULT_OUT = REPO / "results" / "f4.8" / "m5b"
DEFAULT_LAYER = REPO / "results" / "f4.8" / "m5" / "pass1_layer.tsv"
GATE_C_MIB = 2000.0
THRESH_IMPLEMENT = 5.9
THRESH_ARCHIVE = 2.0

def build_batches_weighted(tr):
    pref, dec = defaultdict(list), defaultdict(list)
    for i in range(tr["n"]):
        ph, st, il, sl = int(tr["phase"][i]), int(tr["step"][i]), int(tr["layer"][i]), int(tr["slot"][i])
        e, w = int(tr["expert"][i]), float(tr["weight"][i])
        (pref[il] if ph==0 else dec[(st,il)]).append((st,sl,e,w) if ph==0 else (sl,e,w))
    batches=[]; layers=list(range(N_LAYER))
    for il in layers:
        if il in pref:
            rows=sorted(pref[il]); batches.append((il,[e for _s,_sl,e,_w in rows],[w for _s,_sl,_e,w in rows]))
    n_prefill=len(batches)
    for st in sorted({s for s,_l in dec}):
        for il in layers:
            if (st,il) in dec:
                rows=sorted(dec[(st,il)]); batches.append((il,[e for _sl,e,_w in rows],[w for _sl,_e,w in rows]))
    return batches, n_prefill

def score_quantiles(tr):
    w=tr["weight"]; w=w[~np.isnan(w)]
    return {"q10":float(np.quantile(w,0.10)),"q25":float(np.quantile(w,0.25)),"q50":float(np.quantile(w,0.50)),"q75":float(np.quantile(w,0.75)),"q90":float(np.quantile(w,0.90)),"mean":float(np.mean(w)),"n":int(w.size)}

def load_layer_stats(path):
    out={}
    with path.open() as f:
        header=f.readline().strip().split("	")
        for line in f:
            p=line.strip().split("	")
            if len(p)<5: continue
            row=dict(zip(header,p)); il=int(row["layer"])
            out[il]={"total":int(float(row["total"])),"unique":int(float(row["unique"])),"top8_share":float(row["top8_share"]),"entropy_bits":float(row["entropy_bits"])}
    return out

class Stats:
    __slots__=("lookups","hits","dec_lookups","dec_hits","read_bytes","dec_read_bytes")
    def __init__(self):
        self.lookups=self.hits=self.dec_lookups=self.dec_hits=self.read_bytes=self.dec_read_bytes=0
    def hit_pct(self): return 100.0*self.hits/self.lookups if self.lookups else 0.0
    def dec_hit_pct(self): return 100.0*self.dec_hits/self.dec_lookups if self.dec_lookups else 0.0
    def as_dict(self): return {"hit_req_cum":round(self.hit_pct(),3),"hit_req_dec":round(self.dec_hit_pct(),3),"dec_read_mib":round(self.dec_read_bytes/MIB,3),"lookups":self.lookups,"hits":self.hits,"dec_lookups":self.dec_lookups,"dec_hits":self.dec_hits}
class ARCSim:
    def __init__(self, budget_bytes, ebytes, n_expert=N_EXPERT, ghost_cap=8192):
        self.budget=int(budget_bytes); self.ebytes=ebytes; self.n_expert=n_expert; self.ghost_cap=ghost_cap
        self.T1={}; self.T2={}; self.B1={}; self.B2={}; self.bytes_used=0; self.p=0.0; self.stats=Stats()
    def key(self, il, e): return il*self.n_expert+e
    def cost(self, il): return int(self.ebytes[il])
    def _t1_bytes(self): return sum(self.T1.values())
    def _t2_bytes(self): return sum(self.T2.values())
    def _ghost_add(self, ghost, i):
        if i in ghost: ghost.pop(i)
        ghost[i]=None
        while len(ghost)>self.ghost_cap: ghost.pop(next(iter(ghost)))
    def _replace(self, protected):
        while self.bytes_used>self.budget:
            t1b=self._t1_bytes(); victim=None; from_t1=False
            if t1b>=max(self.p,1.0) and self.T1:
                for k in list(self.T1.keys()):
                    if k not in protected: victim=k; from_t1=True; break
            if victim is None and self.T2:
                for k in list(self.T2.keys()):
                    if k not in protected: victim=k; break
            if victim is None and self.T1:
                for k in list(self.T1.keys()):
                    if k not in protected: victim=k; from_t1=True; break
            if victim is None: return
            if from_t1: b=self.T1.pop(victim); self._ghost_add(self.B1, victim)
            else: b=self.T2.pop(victim); self._ghost_add(self.B2, victim)
            self.bytes_used-=b
    def _touch_hit(self, i):
        if i in self.T1: b=self.T1.pop(i); self.T2[i]=b
        elif i in self.T2: b=self.T2.pop(i); self.T2[i]=b
    def _admit(self, i, c, protected):
        if i in self.B1:
            delta=max(c,(self._t2_bytes()/max(len(self.B2),1)) if self.B2 else c)
            self.p=min(self.budget,self.p+delta); self.B1.pop(i,None); self.T2[i]=c; self.bytes_used+=c
        elif i in self.B2:
            delta=max(c,(self._t1_bytes()/max(len(self.B1),1)) if self.B1 else c)
            self.p=max(0.0,self.p-delta); self.B2.pop(i,None); self.T2[i]=c; self.bytes_used+=c
        else:
            self.T1[i]=c; self.bytes_used+=c
        self._replace(protected|{i})
    def batch(self, il, ids, decode):
        seen=set(); touched=set()
        for e in ids:
            i=self.key(il,e)
            if i in seen:
                if i in self.T1 or i in self.T2: self._touch_hit(i)
                continue
            seen.add(i); touched.add(i); self.stats.lookups+=1
            if decode: self.stats.dec_lookups+=1
            if i in self.T1 or i in self.T2:
                self.stats.hits+=1
                if decode: self.stats.dec_hits+=1
                self._touch_hit(i)
            else:
                c=self.cost(il); self.stats.read_bytes+=c
                if decode: self.stats.dec_read_bytes+=c
                self._admit(i,c,touched)
    def run(self, batches, n_prefill):
        for bi,batch in enumerate(batches):
            self.batch(batch[0], batch[1], decode=(bi>=n_prefill))
        return self

class LIRSSim:
    def __init__(self, budget_bytes, ebytes, n_expert=N_EXPERT, lir_frac=0.99):
        self.budget=int(budget_bytes); self.ebytes=ebytes; self.n_expert=n_expert
        self.lir_budget=int(budget_bytes*lir_frac); self.resident={}; self.bytes_used=0; self.lir_bytes=0
        self.S={}; self.Q={}; self.stats=Stats(); self.stack_cap=20000
    def key(self, il, e): return il*self.n_expert+e
    def cost(self, il): return int(self.ebytes[il])
    def _stack_push(self, i):
        if i in self.S: self.S.pop(i)
        self.S[i]=None
        while len(self.S)>self.stack_cap:
            bot=next(iter(self.S))
            if bot in self.resident and self.resident[bot][1]: break
            self.S.pop(bot)
    def _prune_stack(self):
        while self.S:
            bot=next(iter(self.S))
            if bot in self.resident and self.resident[bot][1]: break
            if bot not in self.resident: self.S.pop(bot)
            else: break
    def _evict_hir(self, protected):
        for k in list(self.Q.keys()):
            if k in protected: continue
            if k not in self.resident: self.Q.pop(k,None); continue
            b,is_lir=self.resident.pop(k); self.bytes_used-=b
            if is_lir: self.lir_bytes-=b
            self.Q.pop(k,None); return True
        return False
    def _demote_lir_to_hir(self, protected):
        for k in list(self.S.keys()):
            if k not in self.resident: self.S.pop(k); continue
            b,is_lir=self.resident[k]
            if (not is_lir) or k in protected: continue
            self.resident[k]=(b,False); self.lir_bytes-=b; self.Q[k]=None; return True
        return False
    def _ensure_budget(self, protected):
        while self.bytes_used>self.budget:
            if self._evict_hir(protected): continue
            if self._demote_lir_to_hir(protected) and self._evict_hir(protected): continue
            return
        while self.lir_bytes>self.lir_budget:
            if not self._demote_lir_to_hir(protected): break
    def _admit(self, i, c, protected):
        if self.lir_bytes+c<=self.lir_budget:
            self.resident[i]=(c,True); self.lir_bytes+=c; self.bytes_used+=c; self._stack_push(i)
        else:
            self.resident[i]=(c,False); self.bytes_used+=c; self.Q[i]=None; self._stack_push(i)
        self._ensure_budget(protected|{i}); self._prune_stack()
    def _hit(self, i):
        b,is_lir=self.resident[i]
        if is_lir: self._stack_push(i)
        else:
            self.resident[i]=(b,True); self.lir_bytes+=b; self.Q.pop(i,None); self._stack_push(i)
            self._ensure_budget({i}); self._prune_stack()
    def batch(self, il, ids, decode):
        seen=set(); touched=set()
        for e in ids:
            i=self.key(il,e)
            if i in seen:
                if i in self.resident: self._hit(i)
                continue
            seen.add(i); touched.add(i); self.stats.lookups+=1
            if decode: self.stats.dec_lookups+=1
            if i in self.resident:
                self.stats.hits+=1
                if decode: self.stats.dec_hits+=1
                self._hit(i)
            else:
                c=self.cost(il); self.stats.read_bytes+=c
                if decode: self.stats.dec_read_bytes+=c
                self._admit(i,c,touched)
    def run(self, batches, n_prefill):
        for bi,batch in enumerate(batches):
            self.batch(batch[0], batch[1], decode=(bi>=n_prefill))
        return self

class ScoreEvictSim:

    def __init__(self, budget_bytes, ebytes, n_expert=N_EXPERT):

        self.budget=int(budget_bytes); self.ebytes=ebytes; self.n_expert=n_expert

        self.resident={}; self.bytes_used=0; self.score={}; self.order={}; self.clock=0; self.stats=Stats()

    def key(self, il, e): return il*self.n_expert+e

    def cost(self, il): return int(self.ebytes[il])

    def _note_score(self, i, w):

        if w!=w: return

        prev=self.score.get(i)

        if prev is None or w>prev: self.score[i]=w

    def _victim(self, protected):

        pool=[i for i in self.resident if i not in protected]

        if not pool: return None

        return min(pool, key=lambda i: (self.score.get(i,0.0), self.order.get(i,0)))

    def _evict(self, protected):

        while self.bytes_used>self.budget:

            v=self._victim(protected)

            if v is None: return

            b=self.resident.pop(v); self.bytes_used-=b; self.order.pop(v,None)

    def batch(self, il, ids, weights, decode):

        seen=set(); touched=set()

        for e,w in zip(ids,weights):

            i=self.key(il,e); self.clock+=1; self._note_score(i,w)

            if i in seen:

                if i in self.resident: self.order[i]=self.clock

                continue

            seen.add(i); touched.add(i); self.stats.lookups+=1

            if decode: self.stats.dec_lookups+=1

            if i in self.resident:

                self.stats.hits+=1

                if decode: self.stats.dec_hits+=1

                self.order[i]=self.clock

            else:

                c=self.cost(il); self.stats.read_bytes+=c

                if decode: self.stats.dec_read_bytes+=c

                self.resident[i]=c; self.bytes_used+=c; self.order[i]=self.clock; self._evict(touched)

    def run(self, batches, n_prefill):

        for bi,batch in enumerate(batches):

            il,ids,weights=batch; self.batch(il,ids,weights,decode=(bi>=n_prefill))

        return self


class ScoreAdmitSim:

    def __init__(self, budget_bytes, ebytes, threshold, n_expert=N_EXPERT):

        self.budget=int(budget_bytes); self.ebytes=ebytes; self.threshold=float(threshold); self.n_expert=n_expert

        self.resident={}; self.bytes_used=0; self.order={}; self.clock=0; self.stats=Stats(); self.n_admitted=0; self.n_rejected=0

    def key(self, il, e): return il*self.n_expert+e

    def cost(self, il): return int(self.ebytes[il])

    def _victim(self, protected):

        pool=[i for i in self.resident if i not in protected]

        if not pool: return None

        return min(pool, key=lambda i: self.order.get(i,0))

    def _evict(self, protected):

        while self.bytes_used>self.budget:

            v=self._victim(protected)

            if v is None: return

            b=self.resident.pop(v); self.bytes_used-=b; self.order.pop(v,None)

    def batch(self, il, ids, weights, decode):

        seen=set(); touched=set(); max_w={}

        for e,w in zip(ids,weights):

            i=self.key(il,e)

            if w==w: max_w[i]=max(max_w.get(i,float("-inf")), w)

        for e,w in zip(ids,weights):

            i=self.key(il,e); self.clock+=1

            if i in seen:

                if i in self.resident: self.order[i]=self.clock

                continue

            seen.add(i); touched.add(i); self.stats.lookups+=1

            if decode: self.stats.dec_lookups+=1

            if i in self.resident:

                self.stats.hits+=1

                if decode: self.stats.dec_hits+=1

                self.order[i]=self.clock

            else:

                c=self.cost(il); self.stats.read_bytes+=c

                if decode: self.stats.dec_read_bytes+=c

                ww=max_w.get(i, w if w==w else 0.0)

                if ww>=self.threshold:

                    self.resident[i]=c; self.bytes_used+=c; self.order[i]=self.clock; self.n_admitted+=1; self._evict(touched)

                else:

                    self.n_rejected+=1

    def run(self, batches, n_prefill):

        for bi,batch in enumerate(batches):

            il,ids,weights=batch; self.batch(il,ids,weights,decode=(bi>=n_prefill))

        return self


class LayerBudgetSim:

    def __init__(self, layer_budgets, ebytes, n_expert=N_EXPERT):

        self.layer_budgets={int(k):int(v) for k,v in layer_budgets.items()}; self.ebytes=ebytes; self.n_expert=n_expert

        self.resident=defaultdict(dict); self.bytes_used=defaultdict(int); self.order=defaultdict(dict); self.clock=0; self.stats=Stats()

    def key(self, il, e): return il*self.n_expert+e

    def cost(self, il): return int(self.ebytes[il])

    def _evict(self, il, protected):

        bud=self.layer_budgets.get(il,0); res=self.resident[il]; ord_=self.order[il]

        while self.bytes_used[il]>bud:

            pool=[i for i in res if i not in protected]

            if not pool: return

            v=min(pool, key=lambda i: ord_.get(i,0)); b=res.pop(v); self.bytes_used[il]-=b; ord_.pop(v,None)

    def batch(self, il, ids, decode):

        bud=self.layer_budgets.get(il,0); seen=set(); touched=set(); res=self.resident[il]; ord_=self.order[il]

        for e in ids:

            i=self.key(il,e); self.clock+=1

            if i in seen:

                if i in res: ord_[i]=self.clock

                continue

            seen.add(i); touched.add(i); self.stats.lookups+=1

            if decode: self.stats.dec_lookups+=1

            if i in res:

                self.stats.hits+=1

                if decode: self.stats.dec_hits+=1

                ord_[i]=self.clock

            else:

                c=self.cost(il); self.stats.read_bytes+=c

                if decode: self.stats.dec_read_bytes+=c

                if bud>0:

                    res[i]=c; self.bytes_used[il]+=c; ord_[i]=self.clock; self._evict(il, touched)

    def run(self, batches, n_prefill):

        for bi,batch in enumerate(batches):

            self.batch(batch[0], batch[1], decode=(bi>=n_prefill))

        return self

    def partition_report(self):

        rows=[]

        for il in range(N_LAYER):

            bud=self.layer_budgets.get(il,0)

            rows.append({"layer":il,"budget_bytes":bud,"budget_mib":round(bud/MIB,3),"resident_entries":len(self.resident.get(il,{})),"bytes_used":self.bytes_used.get(il,0)})

        return rows



def allocate_layer_budgets(layer_stats, ebytes, total_budget, mode):

    layers=list(range(N_LAYER))

    if mode=="equal": weights={il:1.0 for il in layers}

    elif mode=="prop_invH":

        hmax=math.log2(N_EXPERT); weights={il:max(1e-9,1.0-(layer_stats[il]["entropy_bits"]/hmax)) for il in layers}

    elif mode=="prop_top8": weights={il:max(1e-9,layer_stats[il]["top8_share"]) for il in layers}

    else: raise ValueError(mode)

    s=sum(weights.values()); budgets={il:int(total_budget*(weights[il]/s)) for il in layers}

    rem=total_budget-sum(budgets.values())

    for il in sorted(layers, key=lambda x: weights[x], reverse=True):

        if rem<=0: break

        budgets[il]+=1; rem-=1

    return budgets


def reuse_distance_stats(batches, n_prefill, n_expert=N_EXPERT):

    last={}; distances=[]

    for bi,batch in enumerate(batches):

        il,ids=batch[0],batch[1]

        if bi<n_prefill:

            for e in set(ids): last[il*n_expert+e]=bi

            continue

        seen=set()

        for e in ids:

            i=il*n_expert+e

            if i in seen: continue

            seen.add(i)

            if i in last: distances.append(bi-last[i])

            last[i]=bi

    if not distances: return {"n":0}

    d=np.array(distances,dtype=np.float64)

    return {"n":int(d.size),"mean":float(np.mean(d)),"median":float(np.median(d)),"p90":float(np.quantile(d,0.90)),"p99":float(np.quantile(d,0.99)),"frac_reuse_le_40":float(np.mean(d<=40)),"frac_reuse_le_200":float(np.mean(d<=200)),"frac_reuse_le_800":float(np.mean(d<=800)),"frac_reuse_gt_2000":float(np.mean(d>2000))}



def score_vs_reuse(batches, n_prefill, n_expert=N_EXPERT):

    last={}; dist_lists=defaultdict(list); max_score={}

    for bi,batch in enumerate(batches):

        il,ids,weights=batch[0],batch[1],batch[2]; seen=set()

        for e,w in zip(ids,weights):

            i=il*n_expert+e

            if w==w: max_score[i]=max(max_score.get(i,float("-inf")), float(w))

            if i in seen: continue

            seen.add(i)

            if bi>=n_prefill and i in last: dist_lists[i].append(bi-last[i])

            last[i]=bi

    xs,ys=[],[]

    for i,ds in dist_lists.items():

        if i not in max_score: continue

        xs.append(max_score[i]); ys.append(float(np.median(ds)))

    if len(xs)<10: return {"n":len(xs),"pearson":float("nan")}

    x=np.array(xs,dtype=np.float64); y=np.array(ys,dtype=np.float64)

    x=(x-x.mean())/(x.std()+1e-12); y=(y-y.mean())/(y.std()+1e-12)

    pearson=float(np.mean(x*y)); thr=float(np.median(xs))

    high=[ys[k] for k in range(len(xs)) if xs[k]>=thr]; low=[ys[k] for k in range(len(xs)) if xs[k]<thr]

    return {"n":len(xs),"pearson_score_vs_med_reuse":round(pearson,4),"med_reuse_high_score":round(float(np.median(high)),2) if high else None,"med_reuse_low_score":round(float(np.median(low)),2) if low else None,"note":"negative pearson => high score -> short reuse"}



def verdict(delta_pp):

    if delta_pp>=THRESH_IMPLEMENT: return "IMPLEMENTA"

    if delta_pp<THRESH_ARCHIVE: return "ARCHIVIA"

    return "IN_MEZZO"

def run_bakeoff(traces_dir, out_dir, layer_tsv, write_report):
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    names = ["short_bench","f45_1_esplicativo","f45_2_scrittura","f45_3_istruzioni","f45_4_codice","f45_5_ragionamento","long_512"]
    traces=[]; stdout_by={}
    for name in names:
        tp = Path(traces_dir) / (name + ".route.tsv"); sp = Path(traces_dir) / (name + ".stdout.txt")
        if not tp.exists():
            print("WARN missing", tp); continue
        traces.append(load_trace(tp))
        if sp.exists(): stdout_by[name]=parse_stdout(sp)
    layer_stats = load_layer_stats(Path(layer_tsv))
    budget = int(GATE_C_MIB * MIB)
    gate_tr = next(t for t in traces if "short_bench" in Path(t["path"]).name)
    plain_batches, n_pref = build_batches(gate_tr)
    gate_sim = CacheSim("lru", budget, gate_tr["ebytes"]).run(plain_batches, n_pref)
    measured = stdout_by.get("short_bench", {}).get("hit_pct")
    gate = {
        "trace": "short_bench", "C_mib": GATE_C_MIB,
        "simulated_cum": round(gate_sim.hit_pct(), 3),
        "simulated_dec": round(gate_sim.dec_hit_pct(), 3),
        "measured_cum": measured,
        "gap_pp": round(gate_sim.hit_pct() - (measured or 0), 3) if measured is not None else None,
        "passed": measured is not None and abs(gate_sim.hit_pct() - measured) <= 2.0,
    }
    policy_rows=[]; partition_rows=[]; mechanism={}
    for tr in traces:
        name = Path(tr["path"]).name.replace(".route.tsv", "").replace(".tsv", "")
        wbatches, n_prefill = build_batches_weighted(tr)
        plain = [(il, ids) for il, ids, _w in wbatches]
        ebytes = tr["ebytes"]; qs = score_quantiles(tr)
        for pol in ("lru", "belady", "lfu"):
            sim = CacheSim(pol, budget, ebytes).run(plain, n_prefill)
            policy_rows.append({"trace": name, "policy": pol, "hit_req_cum": round(sim.hit_pct(), 3), "hit_req_dec": round(sim.dec_hit_pct(), 3), "dec_read_mib": round(sim.dec_read_bytes / MIB, 3), "extra": ""})
        arc = ARCSim(budget, ebytes).run(wbatches, n_prefill)
        policy_rows.append({"trace": name, "policy": "arc2l", **arc.stats.as_dict(), "extra": "final_p_mib=%.1f" % (arc.p / MIB)})
        lirs = LIRSSim(budget, ebytes).run(wbatches, n_prefill)
        policy_rows.append({"trace": name, "policy": "lirs_hir", **lirs.stats.as_dict(), "extra": "lir_frac=0.99"})
        se = ScoreEvictSim(budget, ebytes).run(wbatches, n_prefill)
        policy_rows.append({"trace": name, "policy": "score_evict", **se.stats.as_dict(), "extra": ""})
        for qname in ("q10", "q25", "q50"):
            thr = qs[qname]
            sa = ScoreAdmitSim(budget, ebytes, thr).run(wbatches, n_prefill)
            policy_rows.append({"trace": name, "policy": "score_admit_" + qname, **sa.stats.as_dict(), "extra": "thr=%.6f;adm=%d;rej=%d" % (thr, sa.n_admitted, sa.n_rejected)})
        for mode in ("prop_invH", "prop_top8", "equal"):
            lb = allocate_layer_budgets(layer_stats, ebytes, budget, mode)
            lbs = LayerBudgetSim(lb, ebytes).run(wbatches, n_prefill)
            policy_rows.append({"trace": name, "policy": "layer_" + mode, **lbs.stats.as_dict(), "extra": ""})
            if name == "short_bench":
                for pr in lbs.partition_report():
                    partition_rows.append({"mode": mode, **pr})
        if name == "short_bench":
            mechanism["reuse_distance"] = reuse_distance_stats(wbatches, n_prefill)
            mechanism["score_vs_reuse"] = score_vs_reuse(wbatches, n_prefill)
            mechanism["score_quantiles"] = qs
    by = defaultdict(dict)
    for r in policy_rows: by[r["policy"]][r["trace"]] = r
    lru_dec = {t: by["lru"][t]["hit_req_dec"] for t in by["lru"]}
    belady_dec = {t: by["belady"][t]["hit_req_dec"] for t in by["belady"]}
    summary_rows = []
    for pol, trmap in sorted(by.items()):
        if pol in ("lru", "belady"): continue
        deltas = [trmap[t]["hit_req_dec"] - lru_dec[t] for t in trmap]
        sb = trmap.get("short_bench")
        sb_delta = (sb["hit_req_dec"] - lru_dec["short_bench"]) if sb else float("nan")
        lng = trmap.get("long_512")
        lng_delta = (lng["hit_req_dec"] - lru_dec["long_512"]) if lng else float("nan")
        mean_delta = float(np.mean(deltas)) if deltas else float("nan")
        gap = belady_dec["short_bench"] - lru_dec["short_bench"]
        gap_lng = (belady_dec["long_512"] - lru_dec["long_512"]) if "long_512" in belady_dec else float("nan")
        summary_rows.append({"policy": pol, "short_bench_dec": sb["hit_req_dec"] if sb else None, "short_bench_delta_vs_lru": round(sb_delta, 3), "long_512_dec": lng["hit_req_dec"] if lng else None, "long_512_delta_vs_lru": round(lng_delta, 3) if lng else None, "mean_delta_vs_lru_all": round(mean_delta, 3), "min_delta": round(min(deltas), 3) if deltas else None, "max_delta": round(max(deltas), 3) if deltas else None, "verdict_short_bench": verdict(sb_delta), "verdict_long_512": verdict(lng_delta) if lng else None, "belady_gap_captured_frac_sb": round(sb_delta / gap, 3) if sb and gap else None, "belady_gap_captured_frac_long512": round(lng_delta / gap_lng, 3) if lng and gap_lng else None})
    sep = chr(9)
    cols = ["trace", "policy", "hit_req_cum", "hit_req_dec", "dec_read_mib", "extra"]
    with (out_dir / "policies_C2000.tsv").open("w") as f:
        f.write(sep.join(cols) + chr(10))
        for r in policy_rows: f.write(sep.join(str(r.get(c, "")) for c in cols) + chr(10))
    with (out_dir / "summary_verdicts.tsv").open("w") as f:
        cols2 = list(summary_rows[0].keys()) if summary_rows else []
        f.write(sep.join(cols2) + chr(10))
        for r in summary_rows: f.write(sep.join(str(r.get(c, "")) for c in cols2) + chr(10))
    with (out_dir / "layer_partition_short_bench.tsv").open("w") as f:
        if partition_rows:
            cols3 = list(partition_rows[0].keys())
            f.write(sep.join(cols3) + chr(10))
            for r in partition_rows: f.write(sep.join(str(r.get(c, "")) for c in cols3) + chr(10))
    (out_dir / "mechanism.json").write_text(json.dumps(mechanism, indent=2), encoding="utf-8")
    (out_dir / "gate.json").write_text(json.dumps(gate, indent=2), encoding="utf-8")
    result = {"gate": gate, "lru_short_dec": lru_dec.get("short_bench"), "belady_short_dec": belady_dec.get("short_bench"), "belady_minus_lru": round(belady_dec["short_bench"] - lru_dec["short_bench"], 3) if "short_bench" in belady_dec else None, "summary": summary_rows, "policy_rows": policy_rows, "mechanism": mechanism, "partition_rows": partition_rows}
    if write_report: write_m5b_report(REPO / "reports" / "moe-m5b.md", result)
    print(json.dumps({"gate": gate, "belady_minus_lru": result["belady_minus_lru"], "verdicts": [{k: r[k] for k in ("policy", "short_bench_dec", "short_bench_delta_vs_lru", "long_512_delta_vs_lru", "mean_delta_vs_lru_all", "verdict_short_bench", "verdict_long_512", "belady_gap_captured_frac_sb")} for r in summary_rows]}, indent=2))
    return result

def write_m5b_report(path, result):
    g = result["gate"]; lines = []
    lines.append("# M5b - Bake-off politiche cache (F4.8/notte)")
    lines.append("")
    lines.append("Solo PC. Stesse trace di M5. C=2000 MiB. Finestra decode-only per i delta.")
    lines.append("")
    lines.append("## Gate del simulatore")
    lines.append("")
    lines.append("- LRU@2000 cum simulato: **%.3f%%** (misurato %s)" % (g["simulated_cum"], g["measured_cum"]))
    lines.append("- gap: **%s pp** - %s" % (g["gap_pp"], "PASS" if g["passed"] else "FAIL"))
    lines.append("- LRU decode short_bench: **%s%%**" % result["lru_short_dec"])
    lines.append("- Belady decode short_bench: **%s%%**" % result["belady_short_dec"])
    lines.append("- Belady-LRU: **%s pp**" % result["belady_minus_lru"])
    lines.append("")
    lines.append("## Dichiarazioni di fedelta")
    lines.append("")
    lines.append("- **ARC-2L**: T1/T2 + ghost size-aware (budget in byte). NON l ARC a pagine unitarie di Megiddo & Modha 2003.")
    lines.append("- **LIRS-HIR**: LIR/HIR size-aware, lir_frac=0.99. NON la LIRS stack-distance esatta di Jiang & Zhang 2002.")
    lines.append("- **SCORE-***: colonna weight del route-trace. SCORE-ADMIT soglie = q10/q25/q50 osservati.")
    lines.append("- **BUDGET-LAYER**: LRU per layer, budget fissi che sommano a C.")
    lines.append("")
    lines.append("## Regola di decisione (dichiarata)")
    lines.append("")
    lines.append("- delta_dec vs LRU >= +%.1f pp -> IMPLEMENTA" % THRESH_IMPLEMENT)
    lines.append("- delta_dec vs LRU < +%.1f pp -> ARCHIVIA" % THRESH_ARCHIVE)
    lines.append("- in mezzo -> REPORT + costo implementazione")
    lines.append("")
    lines.append("## Classifica short_bench (hit decode @ C=2000)")
    lines.append("")
    lines.append("| policy | hit dec % | d vs LRU | frazione gap Belady | verdetto |")
    lines.append("|---|---:|---:|---:|---|")
    lines.append("| lru (baseline) | %s | 0 | 0 | - |" % result["lru_short_dec"])
    lines.append("| belady (oracolo) | %s | +%s | 1.0 | oracolo |" % (result["belady_short_dec"], result["belady_minus_lru"]))
    for r in sorted(result["summary"], key=lambda x: x["short_bench_delta_vs_lru"], reverse=True):
        lines.append("| %s | %s | %+.3f | %s | **%s** |" % (r["policy"], r["short_bench_dec"], r["short_bench_delta_vs_lru"], r["belady_gap_captured_frac_sb"], r["verdict_short_bench"]))
    lines.append("")
    lines.append("## Media su 6 trace (d decode vs LRU)")
    lines.append("")
    lines.append("| policy | mean d | min | max | verdetto media |")
    lines.append("|---|---:|---:|---:|---|")
    for r in sorted(result["summary"], key=lambda x: (x.get("long_512_delta_vs_lru") is None, -(x.get("long_512_delta_vs_lru") or -99)), reverse=False):
        lines.append("| %s | %+.3f | %+.3f | %+.3f | %s | %s |" % (r["policy"], r.get("long_512_delta_vs_lru") or 0, r.get("mean_delta_vs_lru_all") or 0, r.get("min_delta") or 0, r.get("verdict_long_512") or "?", r.get("verdict_short_bench") or "?"))
    mech = result["mechanism"]
    lines.append("")
    lines.append("## Meccanismo")
    lines.append("")
    if "reuse_distance" in mech:
        rd = mech["reuse_distance"]
        lines.append("### Distanza di riuso (decode, short_bench)")
        for k in ("n","median","p90","p99","frac_reuse_le_40","frac_reuse_le_200","frac_reuse_le_800","frac_reuse_gt_2000"):
            lines.append("- %s: %s" % (k, rd.get(k)))
    if "score_vs_reuse" in mech:
        sv = mech["score_vs_reuse"]
        lines.append("")
        lines.append("### Score router vs distanza di riuso")
        for k, v in sv.items(): lines.append("- %s: %s" % (k, v))
    lines.append("")
    lines.append("Belady vede la distanza di riuso futura. SCORE usa il weight del router come proxy; ARC/LIRS usano frequenza/IRR passati; BUDGET-LAYER scommette sui layer concentrati.")
    lines.append("")
    lines.append("## Partizionamento per-layer (short_bench, estratto)")
    lines.append("")
    for mode in sorted({r["mode"] for r in result.get("partition_rows", [])}):
        rows = [r for r in result["partition_rows"] if r["mode"] == mode]
        total = sum(r["budget_mib"] for r in rows)
        lines.append("### mode=%s (somma=%.1f MiB)" % (mode, total))
        lines.append("| layer | budget MiB | resident |")
        lines.append("|---:|---:|---:|")
        show = set(list(range(0, 5)) + list(range(18, 22)) + list(range(35, 40)))
        for r in rows:
            if r["layer"] in show: lines.append("| L%s | %s | %s |" % (r["layer"], r["budget_mib"], r["resident_entries"]))
        lines.append("")
    lines.append("## Costi implementazione (IN_MEZZO)")
    lines.append("")
    lines.append("| policy | effort | note |")
    lines.append("|---|---|---|")
    lines.append("| arc2l | 2-4 gg | T1/T2+ghost size-aware in IExpertSource |")
    lines.append("| lirs_hir | 3-5 gg | stack S + Q HIR |")
    lines.append("| score_evict | 0.5-1 gg | max-weight per entry |")
    lines.append("| score_admit_* | 0.5 gg | soglia su weight; vicino a drop-cold |")
    lines.append("| layer_* | 1-2 gg | budget per layer |")
    lines.append("")
    lines.append("## Cosa non dice")
    lines.append("")
    lines.append("- Non misura qualita (PPL).")
    lines.append("- Simulatore offline, non telefono.")
    lines.append("- ARC/LIRS sono varianti size-aware dichiarate.")
    lines.append("- Trace brevi (32 tok gen); vedi C3 per 512 tok.")
    lines.append("")
    Path(path).write_text(chr(10).join(lines), encoding="utf-8")
    print("wrote", path)

def main():
    ap = argparse.ArgumentParser(description="M5b policy bake-off")
    ap.add_argument("--traces", type=Path, default=DEFAULT_TRACES)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--layer-tsv", type=Path, default=DEFAULT_LAYER)
    ap.add_argument("--write-report", action="store_true")
    args = ap.parse_args()
    run_bakeoff(args.traces, args.out, args.layer_tsv, args.write_report)

if __name__ == "__main__":
    main()
