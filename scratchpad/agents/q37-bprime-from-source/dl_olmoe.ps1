# q37: download official AllenAI OLMoE Instruct Q8_0. Resume-safe.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$here = Join-Path $root 'scratchpad\agents\q37-bprime-from-source'
$dest = Join-Path $here 'src'
$log  = Join-Path $root 'logs\dl-q37-olmoe.log'
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
        'ABORT_DISK' | Set-Content (Join-Path $here 'DL_OLMOE_STATUS.txt')
        exit 9
    }
}

L 'START q37 OLMoE Q8_0'
Disk-Line 'pre-olmoe-download'
'RUNNING' | Set-Content (Join-Path $here 'DL_OLMOE_STATUS.txt')

$j = @{
    Url  = 'https://huggingface.co/allenai/OLMoE-1B-7B-0924-Instruct-GGUF/resolve/main/olmoe-1b-7b-0924-instruct-q8_0.gguf'
    Out  = Join-Path $dest 'olmoe-1b-7b-0924-instruct-q8_0.gguf'
    Size = [int64]7359943136
    Sha  = 'd089e8b12dee00764c1783f6c557a2ddd1f680ffb0d22b44ad28ef25f8909c66'
}
L ("GET OLMoE Q8 -> {0} expect {1} B" -f $j.Out, $j.Size)
L ("URL {0}" -f $j.Url)
& curl.exe -L --retry 20 --retry-delay 5 --retry-all-errors -C - --fail --progress-bar -o $j.Out $j.Url
$rc = $LASTEXITCODE
L ("curl rc={0}" -f $rc)
if ($rc -ne 0) { 'FAIL_CURL' | Set-Content (Join-Path $here 'DL_OLMOE_STATUS.txt'); exit $rc }
$got = (Get-Item $j.Out).Length
L ("size got={0} expect={1}" -f $got, $j.Size)
if ($got -ne $j.Size) { 'FAIL_SIZE' | Set-Content (Join-Path $here 'DL_OLMOE_STATUS.txt'); exit 3 }
L 'sha256 ...'
$py = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$h = (& $py (Join-Path $here 'sha256.py') $j.Out | Out-String).Trim().ToLowerInvariant()
L ("sha256={0} expect={1}" -f $h, $j.Sha)
if ($h -ne $j.Sha) { 'FAIL_SHA' | Set-Content (Join-Path $here 'DL_OLMOE_STATUS.txt'); exit 4 }
Disk-Line 'post-olmoe-download'
'OK' | Set-Content (Join-Path $here 'DL_OLMOE_STATUS.txt')
L 'DONE OLMoE Q8_0 verified'
exit 0
