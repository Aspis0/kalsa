import csv
from pathlib import Path
root=Path(__file__).resolve().parent
for lang in ['en','it','es','fr','zh']:
 rows=list(csv.DictReader(open(root/f'{lang}_router_agg.csv')))
 assert len(rows)==40*256,(lang,len(rows))
 assert {int(r['layer']) for r in rows}==set(range(40))
 assert {int(r['expert']) for r in rows}==set(range(256))
 for layer in range(40):
  x=[r for r in rows if int(r['layer'])==layer]
  assert sum(int(r['selections']) for r in x)==1024*8,(lang,layer)
  assert len({int(r['selections']) for r in x})==1,(lang,layer)
  assert all(float(r['mass_sum'])>=0 for r in x)
 print(f'{lang}: 1024 input tokens; 40 layers; 256 experts/layer; 8192 selections/layer; each expert selected {rows[0]["selections"]} times/layer')
print('All validation checks passed')
