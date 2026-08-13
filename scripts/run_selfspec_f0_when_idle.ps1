# Wait until LFM / Marco / quantize / any bmoe-cli release the PC, then run SELFSPEC F0.
# Does not kill those jobs. PC only. No phones.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$res = Join-Path $root 'results\selfspec_f0'
$log = Join-Path $res 'waiter.log'
$status = Join-Path $res 'STATUS.txt'
$busyFile = Join-Path $res 'PC_BUSY.txt'
$PY = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$RUN = Join-Path $root 'scripts\run_selfspec_f0.py'

function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $log $t -Encoding utf8
    Write-Host $t
}

function Set-St($s) {
    Set-Content $status $s -Encoding utf8
    L ("STATUS " + $s)
}

function Get-Busy {
    # Match by process Name + script path. Do NOT grep CommandLine for
    # 'llama-quantize' alone — agent prompts contain that string.
    $procs = Get-CimInstance Win32_Process | Where-Object {
        $n = $_.Name
        $c = $_.CommandLine
        if (-not $c) { $c = '' }
        if ($n -eq 'llama-quantize.exe') { return $true }
        if ($n -eq 'llama-imatrix.exe') { return $true }
        if ($n -eq 'bmoe-cli.exe') { return $true }
        if ($n -eq 'python.exe' -and $c -match 'run_multi5_ppl_host\.py') { return $true }
        # Require an actual -File invocation, not a prompt/command that merely names the script.
        if ($n -match '^(powershell|pwsh)\.exe$' -and $c -match '-File\s+\S*run_lfm25_kexp_when_idle\.ps1') { return $true }
        if ($n -match '^(powershell|pwsh)\.exe$' -and $c -match '-File\s+\S*run_marcokexp_quality') { return $true }
        return $false
    }
    return @($procs)
}

New-Item -ItemType Directory -Force -Path $res | Out-Null
L 'START wait for PC idle of LFM/Marco/quantize/bmoe-cli'
Set-St 'BLOCKED_PC'

while ($true) {
    $busy = Get-Busy
    if (-not $busy -or $busy.Count -eq 0) {
        L 'PC idle'
        break
    }
    $snap = ($busy | ForEach-Object { '{0}:{1}' -f $_.ProcessId, $_.Name }) -join ', '
    L ("still busy: " + $snap)
    $os = Get-CimInstance Win32_OperatingSystem
    @(
        'PC_BUSY — selfspec-f0 waiter (poll 600s)',
        ('time={0}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')),
        ('still busy: {0}' -f $snap),
        ('FreePhysicalMemory_KB={0}' -f $os.FreePhysicalMemory),
        'Grid NOT started. Do not kill LFM/Marco/quantize.'
    ) | Set-Content $busyFile -Encoding utf8
    Set-St 'BLOCKED_PC'
    Start-Sleep -Seconds 600
}

while ($true) {
    L 'launch run_selfspec_f0.py --execute'
    & $PY $RUN --execute
    $rc = $LASTEXITCODE
    L ("runner rc={0}" -f $rc)
    if ($rc -eq 3) {
        L 'runner still saw a busy PC; wait again'
        Start-Sleep -Seconds 600
        continue
    }
    if ($rc -ne 0) {
        $cur = ''
        if (Test-Path $status) { $cur = (Get-Content $status -Raw).Trim() }
        if ($cur -notmatch '^(DONE|BLOCKED_)') { Set-St 'BLOCKED_ENGINE' }
    }
    exit $rc
}
