$ErrorActionPreference = "Continue"
$env:hf_REDACTED = "hf_REDACTED"
$env:HUGGING_FACE_HUB_TOKEN = $env:hf_REDACTED
Set-Location "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
# hf download handles auth and resume in hub cache; then copy/link final file
& hf download "barozp/Qwen3.6-28B-REAP20-A3B-GGUF" "Qwen3.6-28B-REAP20-A3B-Q2_K.gguf" --local-dir "models/reap_community" 2>&1 |
  Tee-Object -FilePath "logs/dl-reap-f0-hf.log"
$code = $LASTEXITCODE
# clear secrets from env
Remove-Item Env:hf_REDACTED -ErrorAction SilentlyContinue
Remove-Item Env:HUGGING_FACE_HUB_TOKEN -ErrorAction SilentlyContinue
exit $code
