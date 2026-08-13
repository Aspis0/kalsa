# LFM2.5 KEXP — imatrix plan

Campaign rule: calibration corpus **DISJOINT** from multi5 gates (Coffee / Photosynthesis / Caffè / 咖啡 / 光合作用 / 丝绸之路 / it-v2 Wikipedia Caffè).

## What KEXP actually used

KEXP 1c did **not** compute imatrix locally. It used Unsloth's precomputed
`models/imatrix_unsloth.gguf_file` (192 223 904 B) shipped with the Qwen3.5-35B GGUF.
See `results/kexp_baseline/README.md` and `mandates/requant-esperti-1c.md`.

There is **no campaign-owned calibration corpus** in this repo (only `corpus/multi5/`
and the old Dante `corpus_subset_10k`, both gate/meter material).

## Primary: Unsloth LFM2.5 imatrix (KEXP precedent) — DOWNLOADED

| | |
|---|---|
| Repo | https://huggingface.co/unsloth/LFM2.5-8B-A1B-GGUF |
| File | `imatrix_unsloth.gguf_file` |
| Size | **17 375 232** B |
| sha256 (HF LFS + local) | `09cf3e3f38c9906dc0239750f524d4e728b8fe985ad04bcfc07dd55bbb6e4474` |
| Local | `models/imatrix_lfm25_unsloth.gguf_file` |
| Match | **YES** (Get-FileHash 2026-08-12) |
| GGUF type | `general.type=imatrix` |
| Dataset name (in file) | `unsloth_calibration_LFM2.5-8B-A1B.txt` |
| chunks | 78 × 11008 |

Inspected 2026-08-12: 154 unique tensor bases. Names match official `lfm2moe`
(`ffn_*_exps`, `shortconv.*`, unfused attn, expert dim 1792 × 32). Coverage of
every routed-expert / attn / dense-FFN / shortconv-proj weight. **Not** covered
(expected): `shortconv.conv` (we keep F32) and `token_embd` (q5_k).

Unsloth calib filename ≠ multi5. Disjoint from the gates by construction. Same
vendor path as KEXP.

**This is the imatrix the quantize command will use.**

Honest caveat: the raw calib text is not on disk, so token-level disjointness
cannot be grepped. The recorded dataset name is not a multi5 slice.

## Fallback: campaign-owned llama-imatrix (NOT run unless Unsloth file is rejected)

If we ever need a campaign-owned matrix:

**Corpus (proposed, not built):** Wikipedia prose, languages ∩ (LFM card ∩ gates) =
en/es/fr/it/zh, articles **other than** Coffee/Photosynthesis/Caffè/咖啡/光合作用/丝绸之路.
Suggested pages (titles only — do not fetch until PC is free and we decide to compute):

- EN: Tea, Olive, Mathematics, Roman Empire
- IT: Tè, Olivo, Matematica, Impero romano
- ES: Té, Olivo, Matemática
- FR: Thé, Olivier (arbre), Mathématiques
- ZH: 茶, 橄榄, 数学

Concatenate to `corpus/imatrix_lfm25/calib.txt` (~200–400 KB), record per-article sha.
Must not contain any multi5 slice (byte-compare against `corpus/multi5/*.txt`).

**Binary:** look for `llama-imatrix` next to `llama-quantize`. If missing, it has to
be built from the same `build-pc-quantize` tree. **Do not start a compile while Marco
PPL is on CPU.**

**Command (PREPARED, not run):**

```
# after F16 is on disk and PC is idle of Marco
$IMATRIX = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-pc-quantize\bin\llama-imatrix.exe"
$F16     = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\LFM2.5-8B-A1B-F16.gguf"
$CALIB   = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\corpus\imatrix_lfm25\calib.txt"
$OUT     = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\imatrix_lfm25_campaign.gguf"

& $IMATRIX -m $F16 -f $CALIB -o $OUT --ctx-size 512 -ngl 0 -t 8
```

Run **only** when no `llama-quantize` / Marco `bmoe-cli` PPL is using the CPU.
Chunks: default. Do not use `--ppl-decode` multi5 files as `-f`.

## Decision

Default path = Unsloth file already on disk. Campaign-owned compute is optional
and is **not** required to start quantize when the PC frees.
