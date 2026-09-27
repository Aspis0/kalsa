import json, re, glob, sys
def norm(s): return re.sub(r'[^a-z0-9àèéìòùäö]', '', (s or '').lower().replace('₂','2'))
def checks(n, a):
    A=(a or ''); L=A.lower(); N=norm(A)
    if not A.strip(): return False
    return {
     1: 'kkinen' in L and 'schumacher' not in L[:150],
     4: '4' in A[:120] or 'quattro' in L[:120],
     5: 'canberra' in L,
     6: 'manzoni' in L,
     7: '1989' in A,
     8: ('2' in A[:120] or 'due' in L[:120]) and 'tre' not in L[:60],
     9: '6' in A,
     11: 'vivi' in L or 'non si seppelli' in L or 'non vengono seppelliti' in L or 'sopravvissuti' in L and 'non' in L[:80],
     12: ' po' in L,
     13: 'michelangelo' in L,
     14: 'h2o2' in N,
     15: ('7' in A[:80] or 'sette' in L[:80]) and '8 lati' not in L and '5 lati' not in L,
     17: 'venerdì' in L or 'venerdi' in L,
     20: '79' in A,
     21: 'napolitano' in L,
     22: '1440' in N,
     23: 'mammifer' in L,
     25: 'non' in L[:200] and ('ancora' in L or 'futur' in L),
    }.get(n)
labels=sys.argv[1:]
qs=[1,4,5,6,7,8,9,11,12,13,14,15,17,20,21,22,23,25]
print('model'.ljust(14), ' '.join(f'{q:>3}' for q in qs), ' score  empty')
for lab in labels:
    files=sorted(glob.glob(f'official-{lab}-s*.jsonl'))
    runs=[{json.loads(l)['n']:json.loads(l) for l in open(f)} for f in files]
    cells=[]; tot=0; empty=0
    for q in qs:
        ok=sum(1 for r in runs if checks(q, r[q]['answer']))
        tot+=ok; cells.append(f'{ok}/{len(runs)}')
    empty=sum(1 for r in runs for d in r.values() if not (d['answer'] or '').strip())
    print(lab.ljust(14), ' '.join(f'{c:>3}' for c in cells), f' {tot}/{len(qs)*len(runs)}  {empty}')
