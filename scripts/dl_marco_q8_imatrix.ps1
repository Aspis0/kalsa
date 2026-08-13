# Download Marco Q8 + imatrix. Resume-safe. Verify size then sha256.
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$dest = Join-Path $root 'models'
$log = Join-Path $root 'logs\dl-marco-q8.log'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null

function L($m) {
    $t = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $m
    Add-Content $log $t -Encoding utf8
    Write-Host $t
}

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

L 'START Marco Q8 + imatrix download'
foreach ($j in $jobs) {
    L ("GET {0} -> {1} expect {2} B" -f $j.Name, $j.Out, $j.Size)
    & curl.exe -L --retry 20 --retry-delay 5 --retry-all-errors -C - --fail -o $j.Out $j.Url
    $rc = $LASTEXITCODE
    L ("curl {0} rc={1}" -f $j.Name, $rc)
    if ($rc -ne 0) {
        L ("FAIL curl {0}" -f $j.Name)
        'FAIL_CURL' | Set-Content (Join-Path $root 'results\marcokexp\DL_STATUS.txt')
        exit $rc
    }
    $got = (Get-Item $j.Out).Length
    L ("size {0} got={1} expect={2}" -f $j.Name, $got, $j.Size)
    if ($got -ne $j.Size) {
        L ("FAIL size {0}" -f $j.Name)
        'FAIL_SIZE' | Set-Content (Join-Path $root 'results\marcokexp\DL_STATUS.txt')
        exit 3
    }
    L ("sha256 {0} ..." -f $j.Name)
    $h = (Get-FileHash -Algorithm SHA256 $j.Out).Hash.ToLowerInvariant()
    L ("sha256 {0} = {1}" -f $j.Name, $h)
    if ($h -ne $j.Sha) {
        L ("FAIL sha {0} expected {1}" -f $j.Name, $j.Sha)
        'FAIL_SHA' | Set-Content (Join-Path $root 'results\marcokexp\DL_STATUS.txt')
        exit 4
    }
    L ("OK {0}" -f $j.Name)
}
'OK' | Set-Content (Join-Path $root 'results\marcokexp\DL_STATUS.txt')
L 'DONE both files verified'
exit 0
