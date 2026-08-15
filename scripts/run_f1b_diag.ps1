# F1b selfspec diagnostics E1/E2/E3 on the 35B (longfact reference stream).
# Invocation from the F1b impl report (branch kalsa/selfspec-f1 @ 2396c56).
$ErrorActionPreference = "Continue"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$out = "$root\results\selfspec_f1b\longfact"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$env:PATH = "$root\BigMoeOnEdge-selfspec-f1\build\bin;" + $env:PATH

& "$root\BigMoeOnEdge-selfspec-f1\build\cli\bmoe-cli.exe" `
  -m "$root\models\Qwen3.6-35B-A3B-KEXP.gguf" `
  --prompt-file "$root\results\selfspec_f0\prompts\p_longfact.txt" `
  --selfspec-gold "$root\results\selfspec_f0\streams\longfact_target.txt" `
  --selfspec-diag e1,e2,e3 `
  --selfspec-diag-out $out `
  --selfspec-draft-k 2 `
  --selfspec-draft-prefill-k 6 `
  --n-expert-used 6 `
  -c 4096 --ubatch 512 -t 8 `
  --moe-stream --cache-mb 2000 --io-threads 4 `
  *> "$out\run.log"
$LASTEXITCODE | Set-Content "$out\exit.code"
