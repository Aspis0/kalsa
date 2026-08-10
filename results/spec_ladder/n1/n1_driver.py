#!/data/data/com.termux/files/usr/bin/python3
# SCALA N1 driver C(k)=prefill(k)/decode(1) Drop 0.65 Pred C(4)~1.8-2.5
from __future__ import annotations
import csv, json, os, re, signal, statistics, subprocess, sys, time
from pathlib import Path

HOME = Path(os.environ.get('HOME', '/data/data/com.termux/files/home'))
OUTDIR = Path(os.environ.get('OUTDIR', str(HOME / 'experiments/results/spec_ladder/n1')))
BIN = Path(os.environ.get('BINARY', str(HOME / 'src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN')))
MODEL = Path(os.environ.get('MODEL', str(HOME / 'experiments/models/Qwen3.6-35B-A3B-KEXP.gguf')))
COLD = Path(os.environ.get('COLD_MODEL_SH', str(HOME / 'bin/cold_model.sh')))
PROMPTS = Path(os.environ.get('PROMPTS_DIR', str(HOME / 'experiments/prompts')))
PROMPT_CTRL = PROMPTS / 'f45_1_esplicativo.txt'
PROMPT_T1 = PROMPTS / 'short.txt'
DROP_F = '0.65'
THREADS, N_CTX, UBATCH, CACHE_MB = '4', '4096', '512', '2000'
N_EXPERT, IO_THREADS = '8', '4'
N_GEN_CTRL, N_GEN_T1 = 128, 32
BATT_STOP, DIE_START_C, DIE_STOP_C = 30, 80.0, 98.0
RUNTIME_COMMIT = '1ca51420'
BIN_SHA = ''

OUTDIR.mkdir(parents=True, exist_ok=True)
for sub in ('runs', 'calib', 'control'):
    (OUTDIR / sub).mkdir(exist_ok=True)
MASTER = OUTDIR / 'N1.master.log'
STATUS = OUTDIR / 'STATUS.txt'
CELL_CSV = OUTDIR / 'runs.csv'
CALIB_CSV = OUTDIR / 'calib.csv'
PIDFILE = OUTDIR / 'n1.pid'

def ts():
    return time.strftime('%Y-%m-%dT%H:%M:%S%z')

def log(msg):
    line = f'[{ts()}] {msg}'
    print(line, flush=True)
    with MASTER.open('a', encoding='utf-8') as f:
        f.write(line + chr(10))

def shasum(p):
    r = subprocess.run(['sha256sum', str(p)], capture_output=True, text=True)
    return r.stdout.split()[0] if r.returncode == 0 and r.stdout else ''

def max_die_c():
    mx = 0.0
    base = Path('/sys/class/thermal')
    if not base.exists():
        return mx
    for z in base.glob('thermal_zone*'):
        try:
            t = (z / 'type').read_text().strip()
        except Exception:
            continue
        if not re.search(r'cpu', t, re.I):
            continue
        try:
            v = float((z / 'temp').read_text().strip())
            if v > 1000:
                v /= 1000.0
            mx = max(mx, v)
        except Exception:
            pass
    return mx

def batt_fields():
    try:
        r = subprocess.run(['timeout', '5', 'termux-battery-status'], capture_output=True, text=True, timeout=8)
        d = json.loads(r.stdout)
        pl = d.get('plugged', '?')
        if pl in (False, 'false', 'UNPLUGGED', 0, '0', None):
            pl = 'UNPLUGGED'
        elif isinstance(pl, str) and 'UNPLUGGED' in pl.upper():
            pl = 'UNPLUGGED'
        elif isinstance(pl, str) and ('PLUGGED' in pl.upper() or pl.upper() in ('AC', 'USB', 'WIRELESS')):
            pl = 'PLUGGED'
        elif pl in (True, 'true'):
            pl = 'PLUGGED'
        else:
            pl = str(pl)
        return int(d.get('percentage', -1)), float(d.get('temperature', -1)), pl
    except Exception:
        return -1, -1.0, '?'

def nproc():
    try:
        return int(subprocess.check_output(['nproc'], text=True).strip())
    except Exception:
        return 0

def freq_snapshot():
    def f(cpu):
        p = Path(f'/sys/devices/system/cpu/cpu{cpu}/cpufreq/scaling_cur_freq')
        try:
            return p.read_text().strip()
        except Exception:
            return 'NA'
    return f'cpu0={f(0)};cpu4={f(4)};cpu7={f(7)}'

def kill_bmoe():
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            cmd = (proc / 'cmdline').read_bytes().replace(bytes([0]), b' ').decode('utf-8', 'replace')
        except Exception:
            continue
        if 'bmoe-cli' in cmd and 'n1_driver' not in cmd:
            try:
                os.kill(int(proc.name), signal.SIGTERM)
            except Exception:
                pass
    time.sleep(1)
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            cmd = (proc / 'cmdline').read_bytes().replace(bytes([0]), b' ').decode('utf-8', 'replace')
        except Exception:
            continue
        if 'bmoe-cli' in cmd and 'n1_driver' not in cmd:
            try:
                os.kill(int(proc.name), signal.SIGKILL)
            except Exception:
                pass
    time.sleep(1)

def repromote():
    subprocess.run(['termux-wake-lock'], capture_output=True)
    try:
        (OUTDIR / 'REPROMOTE.request').write_text(f'{ts()} nproc={nproc()}' + chr(10))
    except Exception:
        pass
    subprocess.run(['/system/bin/am', 'start', '-n', 'com.termux/.app.TermuxActivity'], capture_output=True)
    subprocess.run(['termux-notification', '--id', 'scala_n1', '--title', 'SCALA-N1',
                    '--content', f'nproc={nproc()}: keep Termux foreground'], capture_output=True)


def preflight(cell):
    batt, btemp, plugged = batt_fields()
    die = max_die_c()
    np = nproc()
    log(f'PREFLIGHT {cell} nproc={np} die={die:.1f}C batt={batt}% plugged={plugged} btemp={btemp} freq={freq_snapshot()}')
    if plugged != 'UNPLUGGED':
        log(f'FATAL PLUGGED={plugged}')
        STATUS.write_text(f'FATAL_PLUGGED {cell} {ts()}' + chr(10))
        (OUTDIR / 'STOP_REASON.txt').write_text('PLUGGED' + chr(10))
        return 4
    if batt >= 0 and batt < BATT_STOP:
        log(f'FATAL batt={batt}')
        STATUS.write_text(f'FATAL_BATT {cell} {ts()}' + chr(10))
        (OUTDIR / 'STOP_REASON.txt').write_text('BATT_LOW' + chr(10))
        return 92
    t0 = time.time()
    while True:
        np = nproc(); die = max_die_c()
        batt, _, plugged = batt_fields()
        if plugged != 'UNPLUGGED':
            return 4
        if batt >= 0 and batt < BATT_STOP:
            return 92
        if np >= 6 and die <= DIE_START_C:
            try:
                (OUTDIR / 'REPROMOTE.request').unlink()
            except Exception:
                pass
            break
        if time.time() - t0 >= 600:
            if np < 6:
                log(f'FATAL nproc={np}')
                STATUS.write_text(f'FATAL_NPROC {cell} {ts()}' + chr(10))
                return 93
            log(f'WARN die still {die:.1f}C after 600s - proceed')
            break
        log(f'preflight wait {cell} nproc={np} die={die:.1f}C')
        repromote()
        time.sleep(15)
    if nproc() < 6:
        return 93
    log(f'PREFLIGHT {cell} OK die={max_die_c():.1f}C batt={batt} nproc={nproc()}')
    return 0

def base_flags(session=False):
    flags = [
        str(BIN), '-m', str(MODEL), '-t', THREADS, '-c', N_CTX,
        '--temp', '0', '--chatml', '--no-think', '--moe-stream',
        '--cache-mb', CACHE_MB, '--dense-weights', 'anon', '--overlap',
        '--io-threads', IO_THREADS, '--ubatch', UBATCH,
        '--n-expert-used', N_EXPERT, '--drop-cold-experts', DROP_F,
    ]
    if session:
        flags.append('--session')
    return flags

def parse_dones(text):
    out = []
    for line in text.splitlines():
        if 'BMOE_DONE' not in line:
            continue
        i = line.find('{')
        if i < 0:
            continue
        try:
            out.append(json.loads(line[i:]))
        except Exception:
            pass
    return out

def run_cmd(args, stdin_text=None, timeout=900):
    env = os.environ.copy()
    bindir = str(BIN.parent)
    env['LD_LIBRARY_PATH'] = bindir + ':' + env.get('LD_LIBRARY_PATH', '')
    t0 = time.time()
    p = subprocess.Popen(
        args,
        stdin=subprocess.PIPE if stdin_text is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True,
    )
    try:
        so, se = p.communicate(input=stdin_text, timeout=timeout)
    except subprocess.TimeoutExpired:
        p.kill()
        so, se = p.communicate()
        return -1, so, se, time.time() - t0
    return p.returncode, so, se, time.time() - t0

def cold_model():
    r = subprocess.run([str(COLD), str(MODEL)], capture_output=True, text=True)
    log(f'cold_model rc={r.returncode}')
    if r.returncode != 0:
        log('cold stderr: ' + (r.stderr[-500:] if r.stderr else ''))
    return r.returncode

def n_common_of(o):
    try:
        np = int(o.get('n_past') or 0)
        npr = int(o.get('n_prompt') or 0)
        tok = int(o.get('tokens') or 0)
        return max(np - npr - tok, 0)
    except Exception:
        return 0


def run_control():
    log(f'==== CONTROL DECODE n={N_GEN_CTRL} ====')
    rc = preflight('ctrl_decode')
    if rc:
        return rc, None
    kill_bmoe()
    if cold_model() != 0:
        return 2, None
    batt, _, plugged = batt_fields()
    if plugged != 'UNPLUGGED':
        return 4, None
    ptext = PROMPT_CTRL.read_text(encoding='utf-8')
    args = base_flags(False) + ['-p', ptext, '-n', str(N_GEN_CTRL)]
    die_s = max_die_c()
    brc, so, se, elapsed = run_cmd(args, timeout=1200)
    die_e = max_die_c()
    batt_e, _, _ = batt_fields()
    text = so + chr(10) + se
    (OUTDIR / 'control/ctrl.stdout.log').write_text(so, encoding='utf-8', errors='replace')
    (OUTDIR / 'control/ctrl.stderr.log').write_text(se, encoding='utf-8', errors='replace')
    dones = parse_dones(text)
    ets = prefill_s = n_prompt = hit = tokens = None
    if dones:
        o = dones[-1]
        ets = o.get('tok_s')
        prefill_s = o.get('prefill_s')
        n_prompt = o.get('n_prompt')
        hit = o.get('cache_hit_pct')
        tokens = o.get('tokens')
    if ets is None:
        m = re.search(r'generation:\s*\d+\s+tokens,\s*[0-9.]+\s*s/token\s*\(([0-9.]+)\s*tok/s\)', text)
        if m:
            ets = float(m.group(1))
    if ets is None:
        m = re.search(r'\(([0-9.]+)\s*tok/s\)', text)
        if m:
            ets = float(m.group(1))
    if ets is None:
        m = re.search(r'eval time.*?([0-9.]+)\s+tokens per second', text, re.I | re.S)
        if m:
            ets = float(m.group(1))
    if prefill_s is None:
        m = re.search(r'prefill:\s*(\d+)\s+tokens,\s*([0-9.]+)\s*s\s*\(([0-9.]+)\s*tok/s\)', text)
        if m:
            n_prompt = int(m.group(1))
            prefill_s = float(m.group(2))
    if hit is None:
        m = re.search(r'moe-cache:\s*([0-9.]+)%\s*hit', text)
        if m:
            hit = float(m.group(1))
    if tokens is None:
        m = re.search(r'generation:\s*(\d+)\s+tokens', text)
        if m:
            tokens = int(m.group(1))
    try:
        ets = float(ets) if ets is not None else 0.0
    except Exception:
        ets = 0.0
    t_decode1 = (1.0 / ets) if ets > 0 else None
    summary = {
        'label': 'ctrl_decode', 'eval_tok_s': ets, 't_decode1_s': t_decode1,
        'prefill_s': prefill_s, 'n_prompt': n_prompt, 'hit': hit, 'tokens': tokens,
        'elapsed_s': elapsed, 'rc': brc, 'batt_s': batt, 'batt_e': batt_e,
        'die_s': die_s, 'die_e': die_e, 'bin_sha256': BIN_SHA, 'n_gen': N_GEN_CTRL,
        'drop_f': float(DROP_F),
    }
    (OUTDIR / 'control/ctrl.summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    (OUTDIR / 'control/eval_tok_s.txt').write_text(str(ets), encoding='utf-8')
    log(f'CONTROL eval_tok_s={ets} t_decode1={t_decode1} wall={elapsed:.1f}s rc={brc} die {die_s:.1f}->{die_e:.1f}')
    return 0, summary

def session_jsonl(t1, t2, n1, n2):
    lines = [
        json.dumps({'cmd': 'generate', 'prompt': t1, 'id': 1, 'n_predict': n1, 'clear_kv': True, 'think': False}, ensure_ascii=False),
        json.dumps({'cmd': 'generate', 'prompt': t2, 'id': 2, 'n_predict': n2, 'clear_kv': False, 'think': False}, ensure_ascii=False),
        json.dumps({'cmd': 'close'}),
    ]
    return chr(10).join(lines) + chr(10)

def run_session(label, t1, t2, n1, n2, opfx):
    log(f'---- session {label} ----')
    batt_s, _, plugged = batt_fields()
    if plugged != 'UNPLUGGED':
        return 4, None
    if batt_s >= 0 and batt_s < BATT_STOP:
        return 92, None
    die_s = max_die_c()
    np = nproc()
    freq = freq_snapshot()
    jsin = session_jsonl(t1, t2, n1, n2)
    opfx.with_suffix('.jsonl').write_text(jsin, encoding='utf-8')
    args = base_flags(True) + ['-n', str(n1)]
    brc, so, se, elapsed = run_cmd(args, stdin_text=jsin, timeout=1200)
    die_e = max_die_c()
    batt_e, _, _ = batt_fields()
    opfx.with_suffix('.stdout.log').write_text(so, encoding='utf-8', errors='replace')
    opfx.with_suffix('.stderr.log').write_text(se, encoding='utf-8', errors='replace')
    dones = parse_dones(so + chr(10) + se)
    by = {int(o.get('id') or 0): o for o in dones}
    t1o = by.get(1, {})
    t2o = by.get(2, {})

    def g(o, k):
        v = o.get(k, '')
        return '' if v is None else v

    def mib_tok(o, key='n_prompt'):
        try:
            r = float(o.get('read_mib') or 0)
            t = float(o.get(key) or 0)
            return (r / t) if t > 0 else ''
        except Exception:
            return ''

    summary = {
        'label': label, 'elapsed_s': elapsed, 'rc': brc,
        'batt_s': batt_s, 'batt_e': batt_e, 'die_s': die_s, 'die_e': die_e,
        'nproc': np, 'freq_s': freq, 'bin_sha256': BIN_SHA,
        't1_n_prompt': g(t1o, 'n_prompt'), 't1_n_past': g(t1o, 'n_past'),
        't1_tokens': g(t1o, 'tokens'), 't1_prefill_s': g(t1o, 'prefill_s'),
        't1_prefill_tps': g(t1o, 'prefill_tps'), 't1_tok_s': g(t1o, 'tok_s'),
        't1_hit': g(t1o, 'cache_hit_pct'), 't1_read_mib': g(t1o, 'read_mib'),
        't2_n_prompt': g(t2o, 'n_prompt'), 't2_n_past': g(t2o, 'n_past'),
        't2_tokens': g(t2o, 'tokens'), 't2_prefill_s': g(t2o, 'prefill_s'),
        't2_prefill_tps': g(t2o, 'prefill_tps'), 't2_tok_s': g(t2o, 'tok_s'),
        't2_hit': g(t2o, 'cache_hit_pct'), 't2_n_common': n_common_of(t2o),
        't2_read_mib': g(t2o, 'read_mib'), 't2_mib_tok': mib_tok(t2o, 'n_prompt'),
    }
    opfx.with_suffix('.summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    log(f't1 n_prompt={summary["t1_n_prompt"]} prefill_s={summary["t1_prefill_s"]} tok_s={summary["t1_tok_s"]}')
    log(f't2 n_prompt={summary["t2_n_prompt"]} prefill_s={summary["t2_prefill_s"]} n_common={summary["t2_n_common"]} hit={summary["t2_hit"]}')
    log(f'session {label} DONE rc={brc} wall={elapsed:.1f}s batt {batt_s}->{batt_e} die {die_s:.1f}->{die_e:.1f}')
    return brc, summary


def calibrate(t1p):
    log('==== CALIBRATION t2 n_prompt ====')
    rc = preflight('calib')
    if rc:
        return rc
    kill_bmoe()
    best_np = {2: 999, 4: 999, 8: 999, 16: 999}
    best_p = {2: '', 4: '', 8: '', 16: ''}
    cands = [('x ' * n).strip() for n in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32]]
    cands += ['ok', 'si', 'ok si', 'va bene', 'dimmi', 'a b', 'a b c', 'a b c d',
              'a b c d e f', 'ciao ok', 'prova k', 'uno due', 'uno due tre', 'uno due tre quattro']
    with CALIB_CSV.open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['idx', 'cand', 'n_prompt', 'prefill_s', 'n_common', 'rc'])
        for i, cand in enumerate(cands, 1):
            batt, _, plugged = batt_fields()
            if plugged != 'UNPLUGGED':
                return 4
            if batt >= 0 and batt < BATT_STOP:
                return 92
            opfx = OUTDIR / f'calib/c{i:02d}'
            log(f'calib[{i}] cand={cand[:40]!r}')
            brc, s = run_session(f'calib_{i}', t1p, cand, 8, 1, opfx)
            if not s:
                continue
            try:
                npv = int(float(s['t2_n_prompt'])) if s['t2_n_prompt'] != '' else None
            except Exception:
                npv = None
            try:
                nc = int(s.get('t2_n_common') or 0)
            except Exception:
                nc = 0
            w.writerow([i, cand, s.get('t2_n_prompt'), s.get('t2_prefill_s'), nc, brc])
            f.flush()
            if npv is None or nc <= 0:
                continue
            for k in (2, 4, 8, 16):
                cur = best_np[k]
                dist = abs(npv - k)
                best_dist = abs(cur - k)
                if npv == k or dist < best_dist:
                    best_np[k] = npv
                    best_p[k] = cand
            if all(best_np[k] == k for k in (2, 4, 8, 16)):
                log('calib: all k exact - stop early')
                break
    for k in (2, 4, 8, 16):
        if best_np[k] == 999 or not best_p[k]:
            prompt = ('x ' * k).strip()
            (OUTDIR / f'calib/prompt_k{k}.txt').write_text(prompt + '\n', encoding='utf-8')
            (OUTDIR / f'calib/n_prompt_k{k}.txt').write_text('approx\n', encoding='utf-8')
            log(f'WARN k={k} fallback x-run')
        else:
            (OUTDIR / f'calib/prompt_k{k}.txt').write_text(best_p[k] + '\n', encoding='utf-8')
            (OUTDIR / f'calib/n_prompt_k{k}.txt').write_text(str(best_np[k]) + '\n', encoding='utf-8')
            log(f'CHOSEN k={k} n_prompt={best_np[k]} prompt={best_p[k]!r}')
    return 0

def run_k_series(t1p, t_decode1):
    log('==== K SERIES C(k) ====')
    rc = preflight('k_series')
    if rc:
        return rc
    kill_bmoe()
    if cold_model() != 0:
        return 2
    with CELL_CSV.open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['label', 'k', 'rep', 't2_n_prompt', 't2_prefill_s', 't2_prefill_tps', 't2_n_common',
                    't2_hit', 't2_read_mib', 't2_mib_per_prompt_tok', 't1_tok_s', 't1_n_past',
                    'elapsed_s', 'rc', 'batt_s', 'batt_e', 'die_s', 'die_e', 'nproc', 'C_k', 't_decode1', 'bin_sha256'])
        for k in (2, 4, 8, 16):
            t2p = (OUTDIR / f'calib/prompt_k{k}.txt').read_text(encoding='utf-8').strip()
            for rep in (1, 2):
                label = f'k{k}_r{rep}'
                prc = preflight(label)
                if prc:
                    return prc
                opfx = OUTDIR / f'runs/{label}'
                brc, s = run_session(label, t1p, t2p, N_GEN_T1, 1, opfx)
                if brc in (4, 92):
                    return brc
                if not s:
                    continue
                try:
                    pf = float(s.get('t2_prefill_s') or 0)
                    C = pf / t_decode1 if t_decode1 > 0 else None
                except Exception:
                    C = None
                w.writerow([
                    s.get('label'), k, rep, s.get('t2_n_prompt'), s.get('t2_prefill_s'),
                    s.get('t2_prefill_tps'), s.get('t2_n_common'), s.get('t2_hit'),
                    s.get('t2_read_mib'), s.get('t2_mib_tok'), s.get('t1_tok_s'),
                    s.get('t1_n_past'), s.get('elapsed_s'), s.get('rc'),
                    s.get('batt_s'), s.get('batt_e'), s.get('die_s'), s.get('die_e'),
                    s.get('nproc'), f'{C:.4f}' if C is not None else '', t_decode1, BIN_SHA,
                ])
                f.flush()
                log(f"C({k})={C} n_prompt={s.get('t2_n_prompt')} prefill_s={s.get('t2_prefill_s')}")
                batt, _, plugged = batt_fields()
                if plugged != 'UNPLUGGED':
                    (OUTDIR / 'STOP_REASON.txt').write_text('PLUGGED\n')
                    return 4
                if batt >= 0 and batt < BATT_STOP:
                    (OUTDIR / 'STOP_REASON.txt').write_text('BATT_LOW\n')
                    return 92
    return 0

def summarize():
    rows = list(csv.DictReader(CELL_CSV.open(encoding='utf-8'))) if CELL_CSV.exists() else []
    by = {}
    for r in rows:
        try:
            k = int(r['k'])
            C = float(r['C_k']) if r['C_k'] else None
            npv = int(float(r['t2_n_prompt'])) if r['t2_n_prompt'] else None
        except Exception:
            continue
        if C is None:
            continue
        by.setdefault(k, []).append((C, npv))
    ctrl = json.loads((OUTDIR / 'control/ctrl.summary.json').read_text(encoding='utf-8'))
    lines = [
        f"t_decode1={ctrl.get('t_decode1_s')} s  eval_tok_s={ctrl.get('eval_tok_s')}",
        'k,C_r1,C_r2,C_med,n_prompt_med,verdict',
    ]
    for k in (2, 4, 8, 16):
        vals = by.get(k, [])
        Cs = [v[0] for v in vals]
        nps = [v[1] for v in vals if v[1] is not None]
        if not Cs:
            lines.append(f'{k},NA,NA,NA,NA,NO_DATA')
            continue
        med = statistics.median(Cs)
        v = ('VERDE' if med <= 2.2 else ('GIALLO' if med <= 3.0 else 'ROSSO')) if k == 4 else '(info)'
        def g(i, Cs=Cs):
            return f'{Cs[i]:.3f}' if i < len(Cs) else 'NA'
        npmed = statistics.median(nps) if nps else 'NA'
        lines.append(f'{k},{g(0)},{g(1)},{med:.3f},{npmed},{v}')
    (OUTDIR / 'summary.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    log('SUMMARY\n' + '\n'.join(lines))
    Cs4 = [v[0] for v in by.get(4, [])]
    if Cs4:
        med = statistics.median(Cs4)
        verdict = 'VERDE' if med <= 2.2 else ('GIALLO' if med <= 3.0 else 'ROSSO')
        (OUTDIR / 'verdict.txt').write_text(f'C4_med={med:.4f}\nverdict={verdict}\n', encoding='utf-8')
        log(f'VERDICT {verdict} C4_med={med:.4f}')

def main():
    global BIN_SHA
    PIDFILE.write_text(str(os.getpid()) + '\n')
    STATUS.write_text(f'RUNNING {ts()}\n')
    sha_file = HOME / 'src/BigMoeOnEdge/build-bmoe/cli/CAMPAIGN.sha256'
    exp = sha_file.read_text().split()[0] if sha_file.exists() else ''
    BIN_SHA = shasum(BIN)
    if not BIN.name.endswith('CAMPAIGN'):
        log('ERRORE pin: non CAMPAIGN')
        sys.exit(6)
    if exp and BIN_SHA != exp:
        log(f'ERRORE pin sha mismatch got={BIN_SHA} exp={exp}')
        sys.exit(6)
    log(f'pin OK sha={BIN_SHA}')
    subprocess.run(['termux-wake-lock'], capture_output=True)
    repromote()
    batt, btemp, plugged = batt_fields()
    meta = f'batt_start={batt} plugged={plugged} die_start={max_die_c():.1f} nproc={nproc()} drop_f={DROP_F} bin={BIN_SHA} {ts()}\n'
    (OUTDIR / 'session_meta.txt').write_text(meta, encoding='utf-8')
    log(f'SESSION START {meta.strip()}')
    log('PREDICTION_A_VERBALE: C(4) ~ 1.8-2.5; soglie <=2.2 VERDE / 2.2-3.0 GIALLO / >3.0 ROSSO')
    (OUTDIR / 'predictions.txt').write_text(
        'N1 prediction a verbale (BEFORE numbers): C(4) ~ 1.8-2.5\n'
        'Soglie: <=2.2 VERDE; 2.2-3.0 GIALLO; >3.0 ROSSO\n'
        f'drop_f={DROP_F}\nbin_sha256={BIN_SHA}\nruntime_commit={RUNTIME_COMMIT}\n',
        encoding='utf-8',
    )
    if plugged != 'UNPLUGGED':
        STATUS.write_text('FATAL_PLUGGED\n')
        sys.exit(4)

    rc, ctrl = run_control()
    if rc != 0 or not ctrl or not ctrl.get('t_decode1_s'):
        STATUS.write_text(f'FAIL_CONTROL rc={rc} {ts()}\n')
        sys.exit(rc or 1)
    t_decode1 = float(ctrl['t_decode1_s'])
    t1p = PROMPT_T1.read_text(encoding='utf-8')
    rc = calibrate(t1p)
    if rc != 0:
        STATUS.write_text(f'FAIL_CALIB rc={rc} {ts()}\n')
        sys.exit(rc)
    rc = run_k_series(t1p, t_decode1)
    summarize()
    batt_e, _, plug_e = batt_fields()
    with (OUTDIR / 'session_meta.txt').open('a', encoding='utf-8') as f:
        f.write(f'batt_end={batt_e} plugged={plug_e} die_end={max_die_c():.1f} nproc={nproc()} {ts()}\n')
        f.write(f'rc_k={rc}\n')
    if rc == 0:
        STATUS.write_text(f'DONE {ts()}\n')
        log('N1 DONE OK')
    else:
        STATUS.write_text(f'PARTIAL rc={rc} {ts()}\n')
        log(f'N1 PARTIAL rc={rc}')
    subprocess.run(['termux-wake-unlock'], capture_output=True)
    sys.exit(rc)

if __name__ == '__main__':
    main()
