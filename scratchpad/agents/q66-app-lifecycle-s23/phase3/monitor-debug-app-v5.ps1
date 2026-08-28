$ErrorActionPreference = 'Stop'
$phase = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase3'
$result = Join-Path $phase 'debug-app-build-v5-result.txt'
$log = Join-Path $phase 'debug-app-monitor-v5.log'
$previousCommitHigh = $false
$previousAllocated = $null
Set-Content -LiteralPath $log -Value "START=$(Get-Date -Format o)`nINTERVAL_SECONDS=60`nFLOOR_FREE_GIB=3`nFLOOR_COMMIT_PCT=97`nPAGEFILE_RULE=stop only after two consecutive commit>=97 samples with unchanged AllocatedBaseSize" -Encoding UTF8

function Get-State {
  $os=Get-CimInstance Win32_OperatingSystem
  $usage=@(Get-CimInstance Win32_PageFileUsage)
  [pscustomobject]@{
    FreeGiB=[math]::Round(([double]$os.FreePhysicalMemory*1KB)/1GB,2)
    CommitPct=[math]::Round((Get-Counter '\Memory\% Committed Bytes In Use').CounterSamples[0].CookedValue,1)
    PageUsage=$usage
    AllocatedMB=[int64](($usage|Measure-Object -Property AllocatedBaseSize -Sum).Sum)
  }
}
function Write-Sample([string]$label) {
  $s=Get-State
  Add-Content -LiteralPath $log -Value "SAMPLE=$label timestamp=$(Get-Date -Format o) free_gib=$($s.FreeGiB) commit_pct=$($s.CommitPct) pagefile_allocated_mb_total=$($s.AllocatedMB)"
  foreach($p in $s.PageUsage){Add-Content -LiteralPath $log -Value "  PAGEFILE name=$($p.Name) allocated_base_mb=$($p.AllocatedBaseSize) current_usage_mb=$($p.CurrentUsage) peak_usage_mb=$($p.PeakUsage) status=$($p.Status)"}
  Add-Content -LiteralPath $log -Value '  TOP3_BEGIN'
  Get-Process|Sort-Object WorkingSet64 -Descending|Select-Object -First 3 Id,ProcessName,PriorityClass,@{N='WorkingSetGiB';E={[math]::Round($_.WorkingSet64/1GB,2)}},@{N='CPUSeconds';E={$_.CPU}}|Out-String|Add-Content -LiteralPath $log
  Add-Content -LiteralPath $log -Value '  TOP3_END'
  return $s
}
function Get-Tree([int[]]$roots) {
  $all=@(Get-CimInstance Win32_Process);$ids=[System.Collections.Generic.HashSet[int]]::new();foreach($r in $roots){[void]$ids.Add($r)}
  do{$changed=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)-and$ids.Add([int]$p.ProcessId)){$changed=$true}}}while($changed);@($ids)
}
function Stop-Build {
  $all=@(Get-CimInstance Win32_Process);$roots=@($all|Where-Object{$_.Name-in@('cmd.exe','java.exe','gradle.exe')-and($_.CommandLine-match'q66p3b|gradlew|assembleRelease')}|Select-Object -ExpandProperty ProcessId)
  foreach($id in (Get-Tree $roots)){try{Stop-Process -Id $id -Force -ErrorAction Stop;"STOPPED_PID=$id"|Add-Content -LiteralPath $log}catch{}}
}

$initial=Write-Sample 'initial'
$previousCommitHigh=($initial.CommitPct -ge 97);$previousAllocated=$initial.AllocatedMB
while($true){
  Start-Sleep -Seconds 60
  $s=Write-Sample 'interval'
  if($s.FreeGiB -lt 3){Add-Content -LiteralPath $log -Value 'STOP_REASON=free_ram_below_3';Stop-Build;exit 42}
  $high=($s.CommitPct -ge 97)
  if($high -and $previousCommitHigh -and $s.AllocatedMB -eq $previousAllocated){Add-Content -LiteralPath $log -Value 'STOP_REASON=commit_ge_97_and_pagefile_allocated_unchanged_for_two_samples';Stop-Build;exit 42}
  $previousCommitHigh=$high;$previousAllocated=$s.AllocatedMB
  if(Test-Path -LiteralPath $result){$t=Get-Content -LiteralPath $result -Raw;if($t-match'EXIT='){Add-Content -LiteralPath $log -Value "RESULT_SEEN=$(Get-Date -Format o)";exit 0}}
  $p=@(Get-CimInstance Win32_Process|Where-Object{$_.CommandLine-match'q66p3b|debug-app-worker-v5|launch-debug-app-build-v5'});if($p.Count-eq 0){Add-Content -LiteralPath $log -Value "BUILD_PROCESSES_GONE=$(Get-Date -Format o)";exit 1}
}
