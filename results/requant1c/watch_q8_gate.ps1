# watch_q8_gate.ps1 - size + certutil SHA256 vs LFS oid. NO quantize.
$ErrorActionPreference = "Stop"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$out = Join-Path $root "models\Qwen3.6-35B-A3B-Q8_0.gguf"
$target = [int64]36903140320
$expectedSha = "d1a395809f65a43a13ad119eb4e7acdef1ac6d68120f39902c8ab96e72794a59"
$pidFile = Join-Path $root "results\requant1c\dl-q8.pid"
$status = Join-Path $root "results\requant1c\status_A.txt"
$gateLog = Join-Path $root "logs\q8-gate-postcrash.log"
$progress = Join-Path $root "logs\dl-q8-resume-progress.log"
$gateOut = Join-Path $root "results\requant1c\q8_gate.txt"

function Log([string]$m) {
    $line = "{0} {1}" -f (Get-Date -Format o), $m
    Add-Content -Path $gateLog -Value $line
    Add-Content -Path $progress -Value $line
}
function Write-Utf8NoBom([string]$path, [string[]]$lines) {
    $enc = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($path, $lines, $enc)
}
function Get-Sha256Certutil([string]$path) {
    $tmp = Join-Path $env:TEMP ("sha_" + [guid]::NewGuid().ToString() + ".txt")
    $p = Start-Process -FilePath "certutil.exe" -ArgumentList @("-hashfile", $path, "SHA256") -Wait -PassThru -NoNewWindow -RedirectStandardOutput $tmp -RedirectStandardError "$tmp.err"
    if ($p.ExitCode -ne 0) { throw "certutil exit $($p.ExitCode)" }
    $lines = Get-Content $tmp | Where-Object { $_ -match '^[0-9a-fA-F]{64}$' }
    Remove-Item $tmp,"$tmp.err" -Force -EA SilentlyContinue
    if (-not $lines -or $lines.Count -lt 1) { throw "certutil produced no 64-hex hash" }
    return ([string](@($lines)[0])).ToLowerInvariant()
}

Log "watch start (certutil gate, LFS oid expected)"
Write-Utf8NoBom (Join-Path $root "results\requant1c\watch-q8.pid") @("$PID")

while ($true) {
    $sz = if (Test-Path $out) { (Get-Item $out).Length } else { [int64]0 }
    $curlAlive = $false
    if (Test-Path $pidFile) {
        $raw = (Get-Content $pidFile | Select-Object -First 1)
        if ($raw -and $raw.Trim() -match '^\d+$') {
            $cid = [int]$raw.Trim()
            $proc = Get-Process -Id $cid -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -match 'curl') { $curlAlive = $true }
        }
    }
    $pct = [math]::Round(100.0 * $sz / $target, 2)
    Log ("sz={0} pct={1} curl_alive={2}" -f $sz, $pct, $curlAlive)
    if ($sz -ge $target -and -not $curlAlive) { break }
    if (-not $curlAlive -and $sz -lt $target -and $sz -gt 0) {
        # allow brief gap at start
        Start-Sleep -Seconds 5
        $proc2 = $null
        if (Test-Path $pidFile) {
            $raw2 = (Get-Content $pidFile | Select-Object -First 1)
            if ($raw2 -and $raw2.Trim() -match '^\d+$') {
                $proc2 = Get-Process -Id ([int]$raw2.Trim()) -EA SilentlyContinue
            }
        }
        if (-not $proc2) {
            Log ("ERROR curl died early sz={0}" -f $sz)
            Write-Utf8NoBom $gateOut @("Q8_GATE=FAIL_EARLY_EXIT sz=$sz")
            exit 2
        }
    }
    Start-Sleep -Seconds 30
}

Start-Sleep -Seconds 3
$sz = (Get-Item $out).Length
Log ("final size sz={0} target={1}" -f $sz, $target)
if ($sz -ne $target) {
    Write-Utf8NoBom $gateOut @("Q8_GATE=FAIL_SIZE sz=$sz expected=$target")
    exit 3
}

Log "certutil sha256 start (minutes)..."
try {
    $got = Get-Sha256Certutil $out
} catch {
    Log ("ERROR hash failed: $_")
    Write-Utf8NoBom $gateOut @("Q8_GATE=FAIL_HASH_TOOL error=$_")
    exit 6
}
if (-not $got -or $got.Length -ne 64) {
    Log "ERROR empty/short hash"
    Write-Utf8NoBom $gateOut @("Q8_GATE=FAIL_HASH_EMPTY")
    exit 7
}
Log ("sha got={0} expected={1}" -f $got, $expectedSha)
if ($got -ne $expectedSha) {
    Log "FAIL sha mismatch - DO NOT QUANTIZE - redownload from zero"
    Write-Utf8NoBom $gateOut @("Q8_GATE=FAIL_SHA got=$got expected=$expectedSha")
    exit 4
}

Log "GATE PASS"
$now = Get-Date -Format o
Write-Utf8NoBom $gateOut @("Q8_GATE=PASS","size=$sz","sha256=$got","checked=$now")
if (Test-Path $status) {
    $st = Get-Content $status | ForEach-Object { if ($_ -match '^phase=') { "phase=A_Q8_GATE_PASS" } else { $_ } }
    Set-Content $status $st
}
exit 0

