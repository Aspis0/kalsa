# LFM2.5 KEXP — llama-quantize command (PREPARED, not run)

**Status:** NOT RUN. Wait for (1) F16 download + sha match (2) PC idle of Marco
`bmoe-cli` / `run_marcokexp_quality.ps1` / any `llama-quantize`.

## Binary

`C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-pc-quantize\bin\llama-quantize.exe`

`--dry-run` **is supported** (verified `--help` 2026-08-12).

## Command

```powershell
$Q      = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-pc-quantize\bin\llama-quantize.exe"
$SRC    = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\LFM2.5-8B-A1B-F16.gguf"
$IM     = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\imatrix_lfm25_unsloth.gguf_file"
$TYPES  = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\lfm25_kexp\tensor_types_lfm25.txt"
$OUT    = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\LFM2.5-8B-A1B-KEXP.gguf"
$LOG    = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\lfm25_kexp\quantize.log"

# 0. sha gate on F16
$exp = "c6eb857414327e26d32654d996838d305cb57c01c06def0894bde244f7baa159"
$got = (Get-FileHash $SRC -Algorithm SHA256).Hash.ToLower()
if ($got -ne $exp) { throw "F16 sha mismatch: $got" }

# 1. syntactic / size dry-run (no write)
& $Q --dry-run --imatrix $IM --tensor-type-file $TYPES $SRC $OUT Q5_K *>&1 |
    Tee-Object "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\lfm25_kexp\quantize_dryrun.log"

# 2. real quantize — ONLY after dry-run looks sane and PC is idle
& $Q --imatrix $IM --tensor-type-file $TYPES $SRC $OUT Q5_K *>&1 |
    Tee-Object $LOG
if ($LASTEXITCODE -ne 0) { throw "quantize rc=$LASTEXITCODE" }

# 3. record sha
$h = Get-FileHash $OUT -Algorithm SHA256
"{0}  {1}  {2}" -f (Get-Item $OUT).Length, $h.Hash.ToLower(), $OUT |
    Set-Content "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\lfm25_kexp\KEXP.sha256"

# 4. tensor-type verify (Marco/KEXP 1c precedent)
python C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\lfm25_kexp\verify_kexp.py $OUT
```

## Notes

- **No `--allow-requantize`.** Source is F16. That flag is a quality footgun and is
  only needed for Q8→k-quant (KEXP 35B / Marco path).
- Default type `Q5_K` matches KEXP 1c. Per-tensor file overrides experts / norms /
  shortconv / dense-down.
- `--leave-output-tensor` omitted: there is no `output.weight` (tied).
- Threads: omit (llama-quantize default = hw). Do not raise while anything else is
  on the CPU.
- Fallback source if F16 never lands: Q8_0 + `--allow-requantize`, sha
  `33ab3b8ce6a964fb8ebac89360c9b3cf72c4fa418d5e4c0a94d46883124d5c02`.

## Syntax check already done

`llama-quantize --help` lists `--imatrix`, `--tensor-type-file`, `--dry-run`, `Q5_K`.
Recipe file is `name=type` / `regex=type` per the 1c format. Full dry-run needs the
F16 file on disk and is deferred with the real quantize.
