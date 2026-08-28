$ErrorActionPreference = 'Stop'
$phase = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase3'
$result = Join-Path $phase 'debug-app-build-v4-result.txt'
$log = Join-Path $phase 'debug-app-monitor-v4.log'
Set-Content -LiteralPath $log -Value "START=$(Get-Date -Format o)`nINTERVAL_SECONDS=60`nFLOOR_FREE_GIB=3`nFLOOR_COMMIT_PCT=95" -Encoding UTF8

function State {
  $os=Get-CimInstance Win32_OperatingSystem
  [pscustomobject]@{ FreeGiB=[math]::Round(([double]$os.FreePhysicalMemory*1KB)/1GB,2); CommitPct=[math]::Round((Get-Counter '\Memory\% Committed Bytes In Use').CounterSamples[0].CookedValue,1) }
}
function Tree([int[]]$roots) {
  $all=@(Get-CimInstance Win32_Process); $ids=[System.Collections.Generic.HashSet[int]]::new(); foreach($r in $roots){[void]$ids.Add($r)}
  do {$changed=$false; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$changed=$true}}} while($changed)
  @($ids)
}
function StopBuild {
  $all=@(Get-CimInstance Win32_Process)
  $roots=@($all|Where-Object { $_.Name -in @('cmd.exe','java.exe','gradle.exe') -and ($_.CommandLine -match 'q66p3b|gradlew|assembleRelease') }|Select-Object -ExpandProperty ProcessId)
  foreach($id in (Tree $roots)){try{Stop-Process -Id $id -Force -ErrorAction Stop; "STOPPED_PID=$id"|Add-Content -LiteralPath $log}catch{}}
}
while($true){
  Start-Sleep -Seconds 60; $m=State; "SAMPLE=$(Get-Date -Format o) free_gib=$($m.FreeGiB) commit_pct=$($m.CommitPct)"|Add-Content -LiteralPath $log
  if($m.FreeGiB -lt 3 -or $m.CommitPct -gt 95){
    Add-Content -LiteralPath $log -Value 'FLOOR_BREACH_TOP_CONSUMERS_BEGIN'
    Get-Process|Sort-Object WorkingSet64 -Descending|Select-Object -First 20 Id,ProcessName,PriorityClass,@{N='WorkingSetGiB';E={[math]::Round($_.WorkingSet64/1GB,2)}},@{N='CPUSeconds';E={$_.CPU}}|Out-String|Add-Content -LiteralPath $log
    Add-Content -LiteralPath $log -Value 'FLOOR_BREACH_TOP_CONSUMERS_END'; StopBuild; Add-Content -LiteralPath $log -Value "STOP_COMPLETE=$(Get-Date -Format o)"; exit 42
  }
  if(Test-Path -LiteralPath $result){$t=Get-Content -LiteralPath $result -Raw;if($t -match 'EXIT='){Add-Content -LiteralPath $log -Value "RESULT_SEEN=$(Get-Date -Format o)";exit 0}}
  $p=@(Get-CimInstance Win32_Process|Where-Object {$_.CommandLine -match 'q66p3b|debug-app-worker-v4|launch-debug-app-build-v4'});if($p.Count -eq 0){Add-Content -LiteralPath $log -Value "BUILD_PROCESSES_GONE=$(Get-Date -Format o)";exit 1}
}
