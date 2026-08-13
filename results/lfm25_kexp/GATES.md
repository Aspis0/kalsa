# LFM2.5 KEXP — quality gates (PRE-DECLARED, not renegotiated)

Declared 2026-08-12 **before** any LFM2.5 PPL exists on disk.

## Meter

| | |
|---|---|
| Binary | `build-pc\cli\bmoe-cli.exe` (same as Marco quality) |
| Mode | `--ppl-decode` |
| Corpus | `corpus/multi5/{en,es,fr,it,zh}.txt` — **it.txt is v2** (Wikipedia Caffè, 45747 B) |
| Script | `scripts/run_multi5_ppl_host.py` |
| ctx / ubatch | 4096 / 512 |
| k flag | `--n-expert-used` (script only forwards this when `--moe-stream` is set — pass both) |

`it.txt` on disk is v2 (head: "Il caffè è una bevanda…"). `MANIFEST.json` is stale
(still lists historical 50054 B). SHA of the file on disk will be recorded at run time.

## A0 — official Q4_K_M at k=4, k=3, k=2 (none exist yet)

Same-k G1 needs A0 at every k. All three are **required**, not optional.

```powershell
foreach ($k in 4,3,2) {
  python C:\Users\gualt\Desktop\Kalsa\moe-experiments\scripts\run_multi5_ppl_host.py `
    --binary C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-pc\cli\bmoe-cli.exe `
    --model  C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\LFM2.5-8B-A1B-Q4_K_M.gguf `
    --tag A0-Q4KM-k$k `
    --outdir C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\lfm25_kexp\A0-Q4KM-k$k `
    --langs en,es,fr,it,zh `
    --threads 8 `
    --moe-stream --n-expert-used $k
}
```

`--threads 8` pinned (script default is `cpu_count()//2` = 11 on this box).
No A0 number may be invented.

## KEXP variants (after quantize)

Same script, model `models\LFM2.5-8B-A1B-KEXP.gguf`, `--threads 8`:

| tag | k |
|---|---|
| `KEXP-k4` | `--n-expert-used 4` |
| `KEXP-k3` | `--n-expert-used 3` |
| `KEXP-k2` | `--n-expert-used 2` |

outdir: `results/lfm25_kexp/<tag>/`

## Gates (frozen — mandate text, not renegotiated)

### G1 — same k vs A0

KEXP-k vs **A0-Q4KM at the same k** (k ∈ {4,3,2}):

- Per language (en, es, fr, it, zh): **Δbpb ≤ +0.10**
- Macro (mean of 5 langs): **Δbpb ≤ +0.05**

G99 also asked for A0 k-reduction (k=3/k=2 vs A0-k4) as a separate product-cell
question ("if k=2 dies, 14.4 tok/s is not a product cell"). That comparison is
**reported** from the same A0 runs. It is not G1.

### G2 — k-reduction fail-fast (mandate: IT+EN only)

On **KEXP**, vs KEXP-k4:

- IT + EN: each **Δbpb ≤ +0.05** at k=3 and at k=2
- Fail-fast: if k=3 already exceeds +0.05 on IT or EN, **stop** — do not argue
  k=2 into a product cell

zh/es/fr at k<4 are **reported** and still sit under G1 same-k. They are not
G2 fail-fast languages. The mandate said "fail-fast ≤+0.05 on IT+EN". Marco
phase-1 historically also watched zh; we do **not** add zh to G2 (that would
be renegotiating). We do not hide that zh is usually the worst language.

## What is NOT a gate in this task

- Jelly tok/s. Speed re-test is a later task.
- Dante `corpus_subset_10k`.
- Any number not written by `run_multi5_ppl_host.py` on this PC.

## Order when PC frees

1. A0-Q4KM-k4, A0-k3, A0-k2 (Q4 already on disk)
2. F16 sha + dry-run + quantize + **tensor-type verify**
3. KEXP-k4, then KEXP-k3, then KEXP-k2
4. Fill tables in `reports/moe-lfm25-kexp.md` from JSON on disk

A0 is CPU-heavy (`bmoe-cli --threads 8`). It waits behind Marco quality, same as quantize.
