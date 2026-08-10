#!/usr/bin/env python3
"""Verify KEXP dump: experts Q2_K/Q3_K, dense identical types to IQ2_M."""
from __future__ import annotations
import re, sys
from collections import Counter, defaultdict
from pathlib import Path

try:
    from gguf import GGUFReader
except ImportError:
    sys.path.insert(0, str(Path('.venv/Lib/site-packages')))
    from gguf import GGUFReader

IQ2M = Path('models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf')
KEXP = Path(sys.argv[1] if len(sys.argv) > 1 else 'models/Qwen3.6-35B-A3B-KEXP.gguf')

def inventory(path: Path):
    r = GGUFReader(str(path))
    rows = []
    for t in r.tensors:
        rows.append({
            'name': t.name,
            'dtype': t.tensor_type.name if hasattr(t.tensor_type, 'name') else str(t.tensor_type),
            'nbytes': int(t.n_bytes) if hasattr(t, 'n_bytes') else int(t.data.nbytes),
            'shape': tuple(int(x) for x in t.shape),
        })
    return rows

def is_expert(n: str) -> bool:
    return bool(re.search(r'ffn_(gate|up|down)_exps', n))

print(f'IQ2_M: {IQ2M} exists={IQ2M.exists()}')
print(f'KEXP:  {KEXP} exists={KEXP.exists()} size={KEXP.stat().st_size if KEXP.exists() else 0}')
iq = inventory(IQ2M)
kx = inventory(KEXP)
print(f'n_tensors iq={len(iq)} kx={len(kx)}')
iq_m = {t['name']: t for t in iq}
kx_m = {t['name']: t for t in kx}
missing = sorted(set(iq_m) - set(kx_m))
extra = sorted(set(kx_m) - set(iq_m))
print('missing_in_kexp', len(missing), missing[:5])
print('extra_in_kexp', len(extra), extra[:5])

exp_ok = dens_ok = dens_bad = exp_bad = 0
dens_mismatch = []
exp_types = Counter()
for name, t in sorted(kx_m.items()):
    dt = t['dtype']
    if is_expert(name):
        exp_types[dt] += 1
        if 'gate_exps' in name or 'up_exps' in name:
            ok = dt in ('Q2_K', 'GGML_TYPE_Q2_K') or 'Q2_K' in dt
        else:
            ok = dt in ('Q3_K', 'GGML_TYPE_Q3_K') or 'Q3_K' in dt
        if ok: exp_ok += 1
        else:
            exp_bad += 1
            print('EXP_BAD', name, dt)
    else:
        if name not in iq_m:
            continue
        src = iq_m[name]['dtype']
        # normalize
        if src == dt or src.replace('GGML_TYPE_','') == dt.replace('GGML_TYPE_',''):
            dens_ok += 1
        else:
            dens_bad += 1
            dens_mismatch.append((name, src, dt))

print('experts ok/bad', exp_ok, exp_bad, 'types', dict(exp_types))
print('dense ok/bad', dens_ok, dens_bad)
if dens_mismatch[:20]:
    print('dense mismatches sample:')
    for m in dens_mismatch[:20]:
        print(' ', m)
print('KEXP size', KEXP.stat().st_size)
# per-expert bytes (layer0)
for key in ['blk.0.ffn_gate_exps.weight','blk.0.ffn_up_exps.weight','blk.0.ffn_down_exps.weight']:
    if key in kx_m:
        nb = kx_m[key]['nbytes']
        print(key, 'nbytes', nb, 'per_expert', nb//256)

# Hard exit for orchestrator (F02 r2): never silent-success on logical failure
fail = False
if missing or extra:
    print('VERIFY_FAIL missing_or_extra', len(missing), len(extra))
    fail = True
if exp_bad:
    print('VERIFY_FAIL exp_bad', exp_bad)
    fail = True
if dens_bad:
    print('VERIFY_FAIL dens_bad', dens_bad)
    fail = True
if not KEXP.exists() or KEXP.stat().st_size < 1_000_000_000:
    print('VERIFY_FAIL size_too_small')
    fail = True
if fail:
    sys.exit(1)
print('VERIFY_OK')
sys.exit(0)
