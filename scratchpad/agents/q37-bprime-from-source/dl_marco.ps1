# q37: download Marco Q8_0 + imatrix. Resume-safe. Logs to logs\dl-q37-marco.log
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$here = Join-Path $root 'scratchpad\agents\q37-bprime-from-source'
$dest = Join-Path $here 'src'
$log  = Join-Path $root 'logs\dl-q37-marco.log'
$disk = Join-Path $here 'DISK_LOG.md'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null

function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $log $t -Encoding utf8
    Write-Host $t
}

function Disk-Line($phase) {
    $d = Get-PSDrive C
    $gb = [math]::Round($d.Free / 1GB, 2)
    $line = '| {0} | {1} | {2} | {3} |' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $phase, $d.Free, $gb
    Add-Content $disk $line -Encoding utf8
    L ("DISK free_bytes={0} free_GB={1} phase={2}" -f $d.Free, $gb, $phase)
    if ($d.Free -lt 40GB) {
        L 'ABORT free < 40GB'
        'ABORT_DISK' | Set-Content (Join-Path $here 'DL_MARCO_STATUS.txt')
        exit 9
    }
}

if (-not (Test-Path $disk)) {
    @(
        '# q37 disk log',
        '',
        '| when | phase | free_bytes | free_GB |',
        '|---|---|---:|---:|'
    ) | Set-Content $disk -Encoding utf8
}

L 'START q37 Marco Q8_0 + imatrix'
Disk-Line 'pre-marco-download'

$py = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$shaPy = Join-Path $here 'sha256.py'
$jobs = @(
    @{
        Name = 'Q8'
        Url  = 'https://huggingface.co/mradermacher/Marco-Mini-Instruct-GGUF/resolve/main/Marco-Mini-Instruct.Q8_0.gguf'
        Out  = Join-Path $dest 'Marco-Mini-Instruct.Q8_0.gguf'
        Size = [int64]18356453952
        Sha  = '3287457af7a6632cce7b9e9dd37a7bce72f6e61c3d64eb79deea474bda5e6f1c'
    },
    @{
        Name = 'imatrix'
        Url  = 'https://huggingface.co/mradermacher/Marco-Mini-Instruct-i1-GGUF/resolve/main/Marco-Mini-Instruct.imatrix.gguf'
        Out  = Join-Path $dest 'Marco-Mini-Instruct.imatrix.gguf'
        Size = [int64]81548704
        Sha  = 'f05d4d4a7b043904728a1fed6496715e5348b4bd825e47eda5cbdc97fb8aec23'
    }
)

function File-Sha256($path) {
    $h = & $py $shaPy $path
    if ($LASTEXITCODE -ne 0) { return '' }
    return ([string]$h).Trim().ToLowerInvariant()
}

'RUNNING' | Set-Content (Join-Path $here 'DL_MARCO_STATUS.txt')
foreach ($j in $jobs) {
    Disk-Line ("pre-$($j.Name)")
    L ("GET {0} -> {1} expect {2} B expect_sha={3}" -f $j.Name, $j.Out, $j.Size, $j.Sha)
    $needCurl = $true
    if (Test-Path $j.Out) {
        $got0 = (Get-Item $j.Out).Length
        if ($got0 -eq $j.Size) {
            L ("existing size ok, sha256 {0} ..." -f $j.Name)
            $h0 = File-Sha256 $j.Out
            L ("sha256 {0} = {1}" -f $j.Name, $h0)
            if ($h0 -eq $j.Sha) {
                L ("SKIP curl {0} already verified" -f $j.Name)
                $needCurl = $false
            }
        }
    }
    if ($needCurl) {
        & curl.exe -L --retry 20 --retry-delay 5 --retry-all-errors -C - --fail --progress-bar -o $j.Out $j.Url
        $rc = $LASTEXITCODE
        L ("curl {0} rc={1}" -f $j.Name, $rc)
        if ($rc -ne 0) {
            L ("FAIL curl {0}" -f $j.Name)
            'FAIL_CURL' | Set-Content (Join-Path $here 'DL_MARCO_STATUS.txt')
            exit $rc
        }
    }
    $got = (Get-Item $j.Out).Length
    L ("size {0} got={1} expect={2}" -f $j.Name, $got, $j.Size)
    if ($got -ne $j.Size) {
        L ("FAIL size {0}" -f $j.Name)
        'FAIL_SIZE' | Set-Content (Join-Path $here 'DL_MARCO_STATUS.txt')
        exit 3
    }
    L ("sha256 {0} ..." -f $j.Name)
    $h = File-Sha256 $j.Out
    L ("sha256 {0} = {1} expect={2}" -f $j.Name, $h, $j.Sha)
    if ($h -ne $j.Sha) {
        L ("FAIL sha {0} got={1} expected={2}" -f $j.Name, $h, $j.Sha)
        'FAIL_SHA' | Set-Content (Join-Path $here 'DL_MARCO_STATUS.txt')
        exit 4
    }
    L ("OK {0}" -f $j.Name)
    Disk-Line ("post-$($j.Name)")
}
'OK' | Set-Content (Join-Path $here 'DL_MARCO_STATUS.txt')
L 'DONE Marco Q8_0 + imatrix verified'
exit 0
