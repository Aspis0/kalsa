$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marco_phase1'
$a3 = Join-Path $root 'A3\full'

Write-Output '=== A3 per-lang ==='
foreach ($lang in @('en','es','fr','it','zh')) {
  $d = Join-Path $a3 $lang
  $csv = Join-Path $d 'per_token.csv'
  $rc = Join-Path $d 'rc.txt'
  $stdout = Join-Path $d 'stdout.txt'
  $line = "$lang :"
  if (Test-Path $rc) {
    $rcv = (Get-Content $rc -Raw).Trim()
    $line += " rc=$rcv"
  } else { $line += ' rc=?' }
  if (Test-Path $csv) {
    $i = Get-Item $csv
    $line += " csv=$($i.Length)B @$($i.LastWriteTime.ToString('HH:mm:ss'))"
  } else { $line += ' csv=MISSING' }
  if (Test-Path $stdout) {
    $s = Get-Content $stdout -Raw -ErrorAction SilentlyContinue
    if ($s -match 'bpb=([0-9.]+)') { $line += " bpb=$($Matches[1])" }
    if ($s -match 's=([0-9.]+)') { $line += " s=$($Matches[1])" }
  }
  Write-Output $line
}

Write-Output ''
Write-Output '=== A2 durations (seconds from stdout) ==='
$sumA2 = 0.0
foreach ($lang in @('en','es','fr','it','zh')) {
  $stdout = Join-Path $root "A2\full\$lang\stdout.txt"
  if (Test-Path $stdout) {
    $s = Get-Content $stdout -Raw
    if ($s -match 's=([0-9.]+)') {
      $sec = [double]$Matches[1]
      $sumA2 += $sec
      Write-Output ("A2 {0}: {1:N0}s ({2:N1} min)" -f $lang, $sec, ($sec/60.0))
    }
  }
}
Write-Output ("A2 total wall-ish sum: {0:N0}s ({1:N1} min)" -f $sumA2, ($sumA2/60.0))

Write-Output ''
Write-Output '=== A3 done so far ==='
$sumA3 = 0.0
$done = @()
$pending = @()
foreach ($lang in @('en','es','fr','it','zh')) {
  $stdout = Join-Path $a3 "$lang\stdout.txt"
  $rc = Join-Path $a3 "$lang\rc.txt"
  $ok = $false
  if ((Test-Path $rc) -and ((Get-Content $rc -Raw).Trim() -eq '0') -and (Test-Path $stdout) -and ((Get-Item $stdout).Length -gt 0)) {
    $s = Get-Content $stdout -Raw
    if ($s -match 's=([0-9.]+)') {
      $sec = [double]$Matches[1]
      $sumA3 += $sec
      $done += $lang
      Write-Output ("A3 {0} DONE: {1:N0}s ({2:N1} min)" -f $lang, $sec, ($sec/60.0))
      $ok = $true
    }
  }
  if (-not $ok) { $pending += $lang }
}
Write-Output ("A3 done langs: {0}" -f ($done -join ','))
Write-Output ("A3 pending: {0}" -f ($pending -join ','))

# Live progress on current incomplete lang (largest recently-written incomplete csv)
$bmoe = Get-Process -Name 'bmoe-cli' -ErrorAction SilentlyContinue
Write-Output ''
Write-Output ("bmoe: {0}" -f $(if ($bmoe) { "ALIVE pid=$($bmoe.Id) start=$($bmoe.StartTime)" } else { 'NONE' }))
$parent = Get-Process -Id 17852 -ErrorAction SilentlyContinue
Write-Output ("parent 17852: {0}" -f $(if ($parent) { 'ALIVE' } else { 'DEAD' }))

# Estimate remaining from A2 per-lang times for pending langs
# Map pending to A2 seconds
$estRemain = 0.0
$a2map = @{}
foreach ($lang in @('en','es','fr','it','zh')) {
  $stdout = Join-Path $root "A2\full\$lang\stdout.txt"
  if (Test-Path $stdout) {
    $s = Get-Content $stdout -Raw
    if ($s -match 's=([0-9.]+)') { $a2map[$lang] = [double]$Matches[1] }
  }
}

# If current lang is in progress, subtract fraction based on csv size vs completed sibling
foreach ($lang in $pending) {
  $base = if ($a2map.ContainsKey($lang)) { $a2map[$lang] } else { 3300.0 }
  $csv = Join-Path $a3 "$lang\per_token.csv"
  $refCsv = $null
  # reference final size from A2 same lang
  $ref = Join-Path $root "A2\full\$lang\per_token.csv"
  $frac = 0.0
  if ((Test-Path $csv) -and (Test-Path $ref)) {
    $cur = (Get-Item $csv).Length
    $fin = (Get-Item $ref).Length
    if ($fin -gt 0) { $frac = [Math]::Min(0.99, $cur / [double]$fin) }
    Write-Output ("A3 {0} progress ~{1:P0} (csv {2}/{3})" -f $lang, $frac, $cur, $fin)
  } else {
    Write-Output ("A3 {0} not started or no ref" -f $lang)
  }
  $estRemain += $base * (1.0 - $frac)
}

Write-Output ''
Write-Output ("ETA remaining ~ {0:N0}s = {1:N1} min = {2:N2} h" -f $estRemain, ($estRemain/60.0), ($estRemain/3600.0))
$eta = (Get-Date).AddSeconds($estRemain)
Write-Output ("ETA clock ~ {0}" -f $eta.ToString('yyyy-MM-dd HH:mm:ss'))
Write-Output '(based on A2 wall times per lang; A3 drop=0.5 is often similar-or-slightly-slower)'
