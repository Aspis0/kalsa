# Notify when trial-marco PC quality pipeline finishes.
# Prints a single line DONE/FAILED/CANCELLED for the monitor harness.
$ErrorActionPreference = "Continue"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$qwenJson = Join-Path $root "results\trial_marco\ppl_qwen35_4b\Qwen35_4B_multi5.json"
$gates = Join-Path $root "results\trial_marco\quality_gates.json"
$status = Join-Path $root "results\trial_marco\PC_PIPELINE_STATUS.txt"
$log = Join-Path $root "logs\watch-trial-marco-pc-done.log"

function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"), $m
  Add-Content -Path $log -Value $line -Encoding utf8
}

function Has-Macro($path) {
  if (-not (Test-Path $path)) { return $false }
  try {
    $d = Get-Content $path -Raw -Encoding utf8 | ConvertFrom-Json
    return ($null -ne $d.macro_bpb)
  } catch { return $false }
}

function Orch-Complete {
  if (-not (Test-Path $status)) { return $false }
  $t = Get-Content $status -Raw -ErrorAction SilentlyContinue
  return ($t -match "PC QUALITY PIPELINE COMPLETE|quality_gates|DONE KEXP_k6d065" -and (Test-Path $gates))
}

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
Log "watch start"

$idleRounds = 0
while ($true) {
  $qwenOk = Has-Macro $qwenJson
  $gatesOk = Test-Path $gates
  $bmoe = Get-Process bmoe-cli -ErrorAction SilentlyContinue
  $st = if (Test-Path $status) { (Get-Content $status -Raw).Trim() } else { "" }

  if ($gatesOk -and $qwenOk) {
    Log "gates+qwen macro present"
    Write-Output "DONE trial-marco PC quality complete gates=$gates"
    exit 0
  }

  # orch wrote complete line
  if ($st -match "PC QUALITY PIPELINE COMPLETE") {
    if ($gatesOk) {
      Log "status complete + gates"
      Write-Output "DONE trial-marco PC: $st"
      exit 0
    }
  }

  # if qwen macro done, no bmoe, wait a bit for gates writer
  if ($qwenOk -and -not $bmoe) {
    $idleRounds++
    if ($idleRounds -ge 3) {
      # 3 x 60s after qwen finished
      if ($gatesOk) {
        Write-Output "DONE trial-marco PC qwen+gates"
        exit 0
      }
      # try to detect orch died without gates
      $orch = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "orchestrate_trial_marco_pc" }
      if (-not $orch -and -not $gatesOk) {
        Log "qwen done, no bmoe, no orch, no gates -> FAILED"
        Write-Output "FAILED trial-marco PC: Qwen done but quality_gates.json missing"
        exit 1
      }
    }
  } else {
    $idleRounds = 0
  }

  Start-Sleep -Seconds 60
}
