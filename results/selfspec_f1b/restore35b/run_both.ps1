$ErrorActionPreference = "Continue"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$cli = Join-Path $root "BigMoeOnEdge-selfspec-f1\build\cli\bmoe-cli.exe"
$out = Join-Path $root "results\selfspec_f1b\restore35b"
$env:PATH = (Join-Path $root "BigMoeOnEdge-selfspec-f1\build\bin") + ";" + $env:PATH
$common = @(
  "-m", (Join-Path $root "models\Qwen3.6-35B-A3B-KEXP.gguf"),
  "--prompt-file", (Join-Path $root "results\selfspec_f0\prompts\p_longfact.txt"),
  "--selfspec-gold", (Join-Path $root "results\selfspec_f0\streams\longfact_target.txt"),
  "--selfspec-restore-test",
  "--selfspec-draft-k", "2",
  "--n-expert-used", "6",
  "-c", "4096",
  "--ubatch", "512",
  "-t", "8",
  "--moe-stream",
  "--cache-mb", "2000",
  "--io-threads", "4"
)
function Invoke-RestoreArm([string]$name, [string[]]$extra) {
  $log = Join-Path $out "$name.log"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & $cli (@($common) + $extra) *> $log
  $code = $LASTEXITCODE
  $sw.Stop()
  Add-Content -Path $log -Value ("`nEXIT_CODE={0} ELAPSED_SEC={1}" -f $code, [int]$sw.Elapsed.TotalSeconds)
  Set-Content -Path (Join-Path $out "$name.exit") -Value $code
  return $code
}
$codeA = Invoke-RestoreArm "runA" @("--selfspec-reject-every", "3")
$codeB = Invoke-RestoreArm "runB" @("--selfspec-reject-every", "0")
Set-Content -Path (Join-Path $out "DONE") -Value ("A={0} B={1}" -f $codeA, $codeB)
