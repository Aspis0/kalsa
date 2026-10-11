# Per-turn energy from the Meter trace two ways (S23, 2026-10-11): integrated current x voltage (the S23's
# current_uA field reads in mA) and charge-counter drop x mean voltage. The counter pins near full charge, so it is
# only a cross-check on turns that start below 100 %. Tokens come from the run's jsonl (KALSA_TELEMETRY).
import csv, json, sys

def trace(path):
    rows = list(csv.reader(l for l in open(path) if not l.startswith('#')))
    h = rows[0]
    d = [dict(zip(h, r)) for r in rows[1:] if r and r[h.index('current_status')] == 'ok' and r[h.index('voltage_status')] == 'ok']
    t = [float(x['t_s']) for x in d]
    p_mw = [-int(x['current_uA']) * int(x['voltage_mV']) / 1000.0 for x in d]  # mA x mV / 1000 = mW
    e_iv = sum(p_mw[i] * (t[i + 1] - t[i]) for i in range(len(d) - 1)) / 3600.0  # mWh
    cc = [int(x['charge_counter_uAh']) for x in d]
    v = sum(int(x['voltage_mV']) for x in d) / len(d) / 1000.0
    e_cc = (cc[0] - cc[-1]) / 1000.0 * v
    return t[-1] - t[0], e_iv, e_cc, cc[0], len(set(cc))

def tokens(jsonl, turn):
    recs = [json.loads(l) for l in open(jsonl) if '"event"' not in l[:200]]
    tel = recs[turn - 1]['telemetry'].get('KALSA_TELEMETRY') or []
    tel = tel if isinstance(tel, list) else [tel]
    return sum(x.get('tokensEvaluated', 0) or 0 for x in tel), sum(x.get('tokensPredicted', 0) or 0 for x in tel)

for spec in sys.argv[1:]:  # label=trace.csv=run.jsonl=turn
    label, path, jsonl, turn = spec.split('=')
    s, e_iv, e_cc, cc0, ncc = trace(path)
    pe, pr = tokens(jsonl, int(turn))
    print(f"{label}: {s:.0f}s E_IxV={e_iv:.0f}mWh mean={e_iv * 3.6 / s:.2f}W E_cc={e_cc:.0f}mWh cc_start={cc0} cc_steps={ncc - 1} "
          f"eval={pe} pred={pr} mWh/100out={100 * e_iv / max(pr, 1):.1f}")
