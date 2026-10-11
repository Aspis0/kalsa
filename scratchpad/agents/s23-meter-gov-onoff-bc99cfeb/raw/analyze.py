# Per-turn energy (charge counter x mean voltage) joined to KALSA_TELEMETRY tokens, ON (run 2) vs OFF.
import csv, glob, json, os, sys
def energy(path):
    rows = list(csv.reader(l for l in open(path) if not l.startswith('#')))
    h = rows[0]; d = [dict(zip(h, r)) for r in rows[1:] if r and r[h.index('charge_counter_status')] == 'ok' and r[h.index('voltage_status')] == 'ok']
    dq = (int(d[0]['charge_counter_uAh']) - int(d[-1]['charge_counter_uAh'])) / 1000.0  # mAh
    v = sum(float(x['voltage_mV']) for x in d) / len(d) / 1000.0
    return float(d[-1]['t_s']) - float(d[0]['t_s']), dq, dq * v  # s, mAh, mWh
def tel(rec):
    t = rec['telemetry'].get('KALSA_TELEMETRY') or []
    t = t if isinstance(t, list) else [t]
    pe = sum(x.get('tokensEvaluated', 0) or 0 for x in t); pr = sum(x.get('tokensPredicted', 0) or 0 for x in t)
    g = rec['telemetry'].get('KALSA_GOVERNOR') or []; g = g if isinstance(g, list) else [g]
    route = '/'.join(sorted({f"{x.get('engine_prefill')}>{x.get('engine_decode')}" for x in g if x})) or 'none'
    return pe, pr, route
def arm(name, jsonl, files, n):
    recs = [json.loads(l) for l in open(jsonl) if '"event"' not in l[:200]][:n]
    tot = [0, 0, 0, 0, 0]
    for i, (rec, f) in enumerate(zip(recs, files[:n]), 1):
        s, mah, mwh = energy(f); pe, pr, route = tel(rec)
        tot = [a + b for a, b in zip(tot, [s, mah, mwh, pe, pr])]
        print(f"{name} t{i} {os.path.basename(f)} dur={s:.0f}s dQ={mah:.2f}mAh E={mwh:.0f}mWh eval={pe} pred={pr} mWh/100tokOut={100*mwh/max(pr,1):.1f} skin={rec['env'].get('skinC')} route={route}")
    s, mah, mwh, pe, pr = tot
    print(f"{name} TOTAL {n} turns: {s:.0f}s {mah:.1f}mAh {mwh:.0f}mWh eval={pe} pred={pr} mWh/100tokOut={100*mwh/max(pr,1):.1f} mean_W={mwh*3.6/max(s,1):.2f}")
on = sorted(f for f in glob.glob('/tmp/meter-s23/pre-energy/*.csv') if int(os.path.basename(f).split('-')[0]) >= 1791700000000)
off = sorted(glob.glob('/tmp/meter-s23/off-energy/*.csv'))
n = int(sys.argv[1]) if len(sys.argv) > 1 else 6
R = '/Users/marco/Projects/kalsa-wt-gov/results/'
arm('ON ', R + 't20c-g2-campaign/T20C/c1-V1.jsonl', on, n)
arm('OFF', R + 'meter-off-bc99cfeb/T20C/c1-V1.jsonl', off, n)
