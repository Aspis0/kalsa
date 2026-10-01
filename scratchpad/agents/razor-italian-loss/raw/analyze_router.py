import csv, json, re
from pathlib import Path
from statistics import mean, median

ROOT = Path(__file__).resolve().parent
LANGS = ['en', 'it', 'es', 'fr', 'zh']
N_LAYER, N_EXPERT, K, BUDGET, KEEP_N = 40, 256, 8, 1024, 128
UBATCH_CALLS = 4  # 1024 tokens / 256-token microbatches; each layer must appear once per microbatch

KEEP = json.load(open(ROOT / 'kept_expert_indices.json'))
RAZOR = [set(KEEP[f'main_{l}']) for l in range(N_LAYER)]


def load(lang):
    rows = list(csv.DictReader(open(ROOT / f'{lang}_router_agg.csv')))
    if len(rows) != N_LAYER * N_EXPERT:
        raise SystemExit(f'{lang}: row count {len(rows)}')
    c = [[0] * N_EXPERT for _ in range(N_LAYER)]
    m = [[0.0] * N_EXPERT for _ in range(N_LAYER)]
    for r in rows:
        l, e = int(r['layer']), int(r['expert'])
        c[l][e] = int(r['selections'])
        m[l][e] = float(r['mass_sum'])
    for l in range(N_LAYER):
        if sum(c[l]) != BUDGET * K:
            raise SystemExit(f'{lang} layer {l}: selections {sum(c[l])}')
        if len(set(c[l])) == 1:
            raise SystemExit(f'{lang} layer {l}: uniform selection counts (router-read bug)')
    return c, m


SANITY_RE = re.compile(
    r'layer=(\d+) topk_calls=(\d+) weights_calls=(\d+) tokens=(\d+)'
    r' wsum_min=([\d.e+-]+) wsum_mean=([\d.e+-]+) wsum_max=([\d.e+-]+)')


def sanity_from_log(lang):
    out = {}
    for line in open(ROOT / f'{lang}_agg.log'):
        mo = SANITY_RE.search(line)
        if mo:
            l = int(mo.group(1))
            out[l] = (int(mo.group(2)), int(mo.group(3)), int(mo.group(4)),
                      float(mo.group(5)), float(mo.group(6)), float(mo.group(7)))
    if len(out) != N_LAYER:
        raise SystemExit(f'{lang}: {len(out)} ROUTER_SANITY lines, expected {N_LAYER}')
    for l, (tk, wc, tok, wmin, wmean, wmax) in out.items():
        if tk != UBATCH_CALLS or wc != UBATCH_CALLS or tok != BUDGET:
            raise SystemExit(f'{lang} layer {l}: calls/tokens {tk}/{wc}/{tok}')
        csv_mean = sum(D[lang][1][l]) / BUDGET
        if abs(csv_mean - wmean) > 1e-6 * max(1.0, wmean):
            raise SystemExit(f'{lang} layer {l}: log wsum_mean {wmean} vs CSV mass {csv_mean}')
    return out


D = {lang: load(lang) for lang in LANGS}
SANITY = {lang: sanity_from_log(lang) for lang in LANGS}


def rankset(scores, l):
    return set(sorted(range(N_EXPERT), key=lambda e: (-scores[l][e], e))[:KEEP_N])


def col(langs, which):
    return [[sum(D[x][which][l][e] for x in langs) for e in range(N_EXPERT)] for l in range(N_LAYER)]


EN_C = [rankset(D['en'][0], l) for l in range(N_LAYER)]
EN_M = [rankset(D['en'][1], l) for l in range(N_LAYER)]
MULTI_C = [rankset(col(['en', 'it', 'es', 'fr'], 0), l) for l in range(N_LAYER)]
MULTI_M = [rankset(col(['en', 'it', 'es', 'fr'], 1), l) for l in range(N_LAYER)]

with open(ROOT / 'usage_rank_sets.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['strategy', 'layer', 'rank', 'expert', 'score'])
    for name, sets, scores in [
        ('en_count', EN_C, D['en'][0]),
        ('en_mass', EN_M, D['en'][1]),
        ('balanced_multilingual_count', MULTI_C, col(['en', 'it', 'es', 'fr'], 0)),
        ('balanced_multilingual_mass', MULTI_M, col(['en', 'it', 'es', 'fr'], 1)),
    ]:
        for l in range(N_LAYER):
            for rank, e in enumerate(sorted(sets[l], key=lambda e: (-scores[l][e], e)), 1):
                w.writerow([name, l, rank, e, scores[l][e]])

with open(ROOT / 'per_layer_removed.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['lang', 'layer', 'tokens', 'selections_total', 'removed_selections',
                'removed_selection_share', 'selected_mass_total', 'removed_mass',
                'removed_selected_mass_share'])
    for lang in LANGS:
        c, m = D[lang]
        for l in range(N_LAYER):
            rem = set(range(N_EXPERT)) - RAZOR[l]
            nt = sum(c[l])
            rm = sum(c[l][e] for e in rem)
            mt = sum(m[l])
            mr = sum(m[l][e] for e in rem)
            w.writerow([lang, l, BUDGET, nt, rm, rm / nt, mt, mr, mr / mt])

with open(ROOT / 'per_layer_it_keep_comparison.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['layer', 'razor_it_mass_kept_share', 'en_count_rank_it_mass_kept_share',
                'multi_count_rank_it_mass_kept_share', 'en_mass_rank_it_mass_kept_share',
                'balanced_multi_mass_rank_it_mass_kept_share', 'razor_it_selection_kept_share',
                'it_en_count_top128_overlap', 'it_en_count_top128_jaccard',
                'it_en_mass_top128_overlap', 'it_en_mass_top128_jaccard'])
    for l in range(N_LAYER):
        itc, itm = D['it']
        totalm, totalc = sum(itm[l]), sum(itc[l])
        topit_c, topit_m = rankset(itc, l), rankset(itm, l)

        def shares(S):
            return sum(itm[l][e] for e in S) / totalm, sum(itc[l][e] for e in S) / totalc

        r1, r2 = shares(RAZOR[l])
        ec1, _ = shares(EN_C[l])
        mc1, _ = shares(MULTI_C[l])
        em1, _ = shares(EN_M[l])
        mm1, _ = shares(MULTI_M[l])
        ov_c = len(topit_c & EN_C[l])
        ov_m = len(topit_m & EN_M[l])
        w.writerow([l, r1, ec1, mc1, em1, mm1, r2,
                    ov_c, ov_c / len(topit_c | EN_C[l]),
                    ov_m, ov_m / len(topit_m | EN_M[l])])

with open(ROOT / 'overall_summary.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['lang', 'input_tokens', 'layer_token_positions', 'selections', 'removed_selections',
                'removed_selection_share', 'selected_mass', 'removed_mass',
                'removed_selected_mass_share', 'removed_mass_per_token'])
    for lang in LANGS:
        c, m = D[lang]
        sel = sum(sum(x) for x in c)
        mass = sum(sum(x) for x in m)
        rem = sum(sum(c[l][e] for e in range(N_EXPERT) if e not in RAZOR[l]) for l in range(N_LAYER))
        rmass = sum(sum(m[l][e] for e in range(N_EXPERT) if e not in RAZOR[l]) for l in range(N_LAYER))
        w.writerow([lang, BUDGET, BUDGET * N_LAYER, sel, rem, rem / sel, mass, rmass,
                    rmass / mass, rmass / (BUDGET * N_LAYER)])

with open(ROOT / 'sanity_count_distribution.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['lang', 'layer', 'selections_total', 'min', 'median', 'max', 'experts_selected'])
    for lang in LANGS:
        c, _ = D[lang]
        for l in range(N_LAYER):
            w.writerow([lang, l, sum(c[l]), min(c[l]), median(c[l]), max(c[l]),
                        sum(1 for x in c[l] if x > 0)])

with open(ROOT / 'sanity_weights_sum.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['lang', 'layer', 'tokens', 'wsum_min', 'wsum_mean', 'wsum_max'])
    for lang in LANGS:
        for l, (_, _, _, wmin, wmean, wmax) in sorted(SANITY[lang].items()):
            w.writerow([lang, l, BUDGET, wmin, wmean, wmax])

pl = list(csv.DictReader(open(ROOT / 'per_layer_it_keep_comparison.csv')))
os_ = list(csv.DictReader(open(ROOT / 'overall_summary.csv')))
print('== removed experts (overall_summary.csv)')
for r in os_:
    print(f"{r['lang']}: removed selections {float(r['removed_selection_share'])*100:.3f}%"
          f"  removed mass {float(r['removed_selected_mass_share'])*100:.3f}%"
          f"  removed mass/token-layer {float(r['removed_mass_per_token']):.5f}")
print('== IT selected mass retained by 128-expert keep sets (mean over layers)')
for col_name, label in [('razor_it_mass_kept_share', 'razor'),
                        ('en_count_rank_it_mass_kept_share', 'en_count'),
                        ('multi_count_rank_it_mass_kept_share', 'multi_count'),
                        ('en_mass_rank_it_mass_kept_share', 'en_mass'),
                        ('balanced_multi_mass_rank_it_mass_kept_share', 'multi_mass')]:
    print(f"{label}: {mean(float(r[col_name]) for r in pl)*100:.2f}%")
print('== IT vs EN top-128 overlap (mean): count', mean(int(r['it_en_count_top128_overlap']) for r in pl),
      'mass', mean(int(r['it_en_mass_top128_overlap']) for r in pl))
print('== selection-count distribution (sanity_count_distribution.csv)')
for lang in LANGS:
    rows = [r for r in csv.DictReader(open(ROOT / 'sanity_count_distribution.csv')) if r['lang'] == lang]
    mins = [int(r['min']) for r in rows]
    meds = [float(r['median']) for r in rows]
    maxs = [int(r['max']) for r in rows]
    print(f"{lang}: per-layer min {min(mins)}-{max(mins)}  median {min(meds):.1f}-{max(meds):.1f}"
          f"  max {min(maxs)}-{max(maxs)}")
print('== per-token top-8 weight sum (sanity_weights_sum.csv)')
for lang in LANGS:
    rows = [r for r in csv.DictReader(open(ROOT / 'sanity_weights_sum.csv')) if r['lang'] == lang]
    print(f"{lang}: min {min(float(r['wsum_min']) for r in rows):.4f}"
          f"  mean {mean(float(r['wsum_mean']) for r in rows):.4f}"
          f"  max {max(float(r['wsum_max']) for r in rows):.4f}")
print('Wrote usage_rank_sets.csv, per_layer_removed.csv, per_layer_it_keep_comparison.csv,'
      ' overall_summary.csv, sanity_count_distribution.csv, sanity_weights_sum.csv')
