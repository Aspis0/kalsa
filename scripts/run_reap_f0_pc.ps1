# FASE 0 (PC path): smoke + bpb EN/IT on community REAP GGUF.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Out = Join-Path $Root "results\reap\f0"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Bin = Join-Path $Root "build-pc\cli\bmoe-cli.exe"
$Model = Join-Path $Root "models\reap_community\Qwen3.6-28B-REAP20-A3B-Q2_K.gguf"
$En = Join-Path $Root "corpus\multi5\en_slice.txt"
$It = Join-Path $Root "corpus\multi5\it_slice.txt"
$Master = Join-Path $Out "f0_pc.master.log"
$env:Path = "$(Split-Path $Bin);$env:Path"

function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"), $m
  Add-Content -Path $Master -Value $line
  Write-Host $line
}

function Quote-Arg([string]$s) {
  if ($null -eq $s) { return '""' }
  if ($s -match '[\s"]') { return '"' + ($s -replace '"', '\"') + '"' }
  return $s
}

function Invoke-Bmoe {
  param([string[]]$ArgList, [string]$StdoutPath, [string]$StderrPath)
  # cmd.exe redirect: preserves args, no PS stderr→exception
  $parts = @((Quote-Arg $Bin)) + ($ArgList | ForEach-Object { Quote-Arg $_ })
  $cmdline = ($parts -join ' ') + " >$(Quote-Arg $StdoutPath) 2>$(Quote-Arg $StderrPath)"
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $cmdline) -Wait -PassThru -NoNewWindow -WindowStyle Hidden
  return $p.ExitCode
}

"" | Set-Content $Master
if (-not (Test-Path $Bin)) { throw "missing bin $Bin" }
if (-not (Test-Path $Model)) { throw "missing model $Model" }
$mi = Get-Item $Model
$expect = 10599958400L
Log "model size=$($mi.Length) expect=$expect match=$($mi.Length -eq $expect)"
if ($mi.Length -ne $expect) { throw "size mismatch" }

$shaOut = & certutil -hashfile $Model SHA256 2>&1 | Out-String
$sha = ([regex]::Match($shaOut, '[0-9A-Fa-f]{64}')).Value.ToLower()
if (-not $sha) { throw "sha256 failed: $shaOut" }
Log "sha256=$sha"
$sha | Set-Content (Join-Path $Out "model.sha256")

Log "SMOKE gen n=32"
$ptext = "Reply with one short sentence about flash storage."
$smokeOut = Join-Path $Out "smoke_pc.stdout.txt"
$smokeErr = Join-Path $Out "smoke_pc.stderr.txt"
$smokeArgs = @(
  "-m", $Model,
  "--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon", "--overlap",
  "--io-threads", "4", "--ubatch", "512", "-t", "8", "-c", "2048",
  "--n-expert-used", "8",
  "--temp", "0", "--chatml", "--no-think",
  "-n", "32",
  "-p", $ptext
)
$rcSmoke = Invoke-Bmoe -ArgList $smokeArgs -StdoutPath $smokeOut -StderrPath $smokeErr
Log "smoke rc=$rcSmoke"
if (Test-Path $smokeErr) {
  Select-String -Path $smokeErr, $smokeOut -Pattern "n_expert|expert_count|generation:|BMOE_DONE|error|Error|load time|moe|unknown arg|print_info" -ErrorAction SilentlyContinue |
    Select-Object -First 80 | ForEach-Object { $_.Line } |
    Tee-Object -FilePath (Join-Path $Out "smoke_pc_extract.txt") |
    ForEach-Object { Log $_ }
}

if ($rcSmoke -ne 0) {
  "FAIL_SMOKE" | Set-Content (Join-Path $Out "STATUS_PC.txt")
  Log "SMOKE FAIL"
  exit 3
}

function Run-Bpb($tag, $corpus) {
  $d = Join-Path $Out "bpb_pc_$tag"
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  Log "BPB $tag corpus=$corpus"
  $so = Join-Path $d "stdout.txt"
  $se = Join-Path $d "stderr.txt"
  $csv = Join-Path $d "per_token.csv"
  $a = @(
    "-m", $Model,
    "--moe-stream", "--cache-mb", "2000", "--dense-weights", "anon", "--overlap",
    "--io-threads", "4", "--ubatch", "512", "-t", "8", "-c", "4096",
    "--n-expert-used", "8",
    "--ppl-decode", $corpus,
    "--ppl-csv", $csv
  )
  $rc = Invoke-Bmoe -ArgList $a -StdoutPath $so -StderrPath $se
  Log "bpb $tag rc=$rc"
  if (Test-Path $se) { Get-Content $se -Tail 25 | ForEach-Object { Log $_ } }
  return $rc
}

$rcEn = Run-Bpb "en" $En
$rcIt = Run-Bpb "it" $It
if ($rcEn -eq 0 -and $rcIt -eq 0) {
  Log "F0_PC PASS"
  "PASS" | Set-Content (Join-Path $Out "STATUS_PC.txt")
  exit 0
} else {
  Log "F0_PC FAIL en=$rcEn it=$rcIt"
  "FAIL" | Set-Content (Join-Path $Out "STATUS_PC.txt")
  exit 4
}
