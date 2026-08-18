$ErrorActionPreference = 'Continue'
$status = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marcokexp\QUANTIZE_STATUS.txt'
$watch = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\quantize-marcokexp-watch.log'
$out1 = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Marco-Mini-Instruct-KEXP.gguf'
$out2 = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Marco-Mini-Instruct-KEXP-q3k.gguf'
Add-Content $watch ('[watch-start ' + (Get-Date -Format o) + ']')
while ($true) {
    $st = if (Test-Path $status) { (Get-Content $status -Raw).Trim() } else { 'MISSING' }
    $s1 = if (Test-Path $out1) { (Get-Item $out1).Length } else { 0 }
    $s2 = if (Test-Path $out2) { (Get-Item $out2).Length } else { 0 }
    $line = '[watch {0}] status={1} kexp={2}B q3k={3}B' -f (Get-Date -Format o), $st, $s1, $s2
    Add-Content $watch $line
    if ($st -eq 'OK') {
        Write-Output 'DONE both MarcoKEXP quantized'
        if (Test-Path 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marcokexp\QUANTIZE_VERIFY.md') {
            Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\marcokexp\QUANTIZE_VERIFY.md' -Raw
        }
        Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\quantize-marcokexp.log' -Tail 25
        exit 0
    }
    if ($st -like 'FAIL*') {
        Write-Output ('FAILED quantize status=' + $st)
        Get-Content 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\logs\quantize-marcokexp.log' -Tail 40
        exit 2
    }
    Start-Sleep -Seconds 180
}
