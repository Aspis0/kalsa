# q37: download official LiquidAI LFM2.5-8B-A1B Q8_0. Resume-safe.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$here = Join-Path $root 'scratchpad\agents\q37-bprime-from-source'
$dest = Join-Path $here 'src'
$log  = Join-Path $root 'logs\dl-q37-lfm.log'
$disk = Join-Path $here 'DISK_LOG.md'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $log $t -Encoding utf8
    Write-Host $t
}
function Disk-Line($phase) {
    $d = Get-PSDrive C
    $gb = [math]::Round($d.Free / 1GB, 2)
    Add-Content $disk ('| {0} | {1} | {2} | {3} |' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $phase, $d.Free, $gb) -Encoding utf8
    L ("DISK free_bytes={0} free_GB={1} phase={2}" -f $d.Free, $gb, $phase)
    if ($d.Free -lt 40GB) {
        L 'ABORT free < 40GB'
        'ABORT_DISK' | Set-Content (Join-Path $here 'DL_LFM_STATUS.txt')
        exit 9
    }
}

L 'START q37 LFM2.5 Q8_0'
Disk-Line 'pre-lfm-download'
'RUNNING' | Set-Content (Join-Path $here 'DL_LFM_STATUS.txt')
$j = @{
    Url  = 'https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/main/LFM2.5-8B-A1B-Q8_0.gguf'
    Out  = Join-Path $dest 'LFM2.5-8B-A1B-Q8_0.gguf'
    Size = [int64]9010195680
    Sha  = '33ab3b8ce6a964fb8ebac89360c9b3cf72c4fa418d5e4c0a94d46883124d5c02'
}
L ("GET LFM Q8 -> {0} expect {1} B  URL {2}" -f $j.Out, $j.Size, $j.Url)
& curl.exe -L --retry 20 --retry-delay 5 --retry-all-errors -C - --fail --progress-bar -o $j.Out $j.Url
$rc = $LASTEXITCODE
L ("curl rc={0}" -f $rc)
if ($rc -ne 0) { 'FAIL_CURL' | Set-Content (Join-Path $here 'DL_LFM_STATUS.txt'); exit $rc }
$got = (Get-Item $j.Out).Length
L ("size got={0} expect={1}" -f $got, $j.Size)
if ($got -ne $j.Size) { 'FAIL_SIZE' | Set-Content (Join-Path $here 'DL_LFM_STATUS.txt'); exit 3 }
L 'sha256 ...'
$py = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$h = (& $py (Join-Path $here 'sha256.py') $j.Out | Out-String).Trim().ToLowerInvariant()
L ("sha256={0} expect={1}" -f $h, $j.Sha)
if ($h -ne $j.Sha) { 'FAIL_SHA' | Set-Content (Join-Path $here 'DL_LFM_STATUS.txt'); exit 4 }
Disk-Line 'post-lfm-download'
'OK' | Set-Content (Join-Path $here 'DL_LFM_STATUS.txt')
L 'DONE LFM2.5 Q8_0 verified'
exit 0
