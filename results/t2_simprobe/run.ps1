$ErrorActionPreference = "Continue"
Set-Location "C:\Users\gualt\Desktop\Kalsa\moe-experiments"
$log = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\t2_simprobe\run.log"
$script = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\t2_simprobe\simprobe.py"
$out = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\t2_simprobe"
$report = "C:\Users\gualt\AppData\Local\Temp\claude\C--Users-gualt-Desktop-Kalsa-moe-experiments\fb421f6e-808c-4488-b008-5b732da526a8\scratchpad\agents\t2-simprobe\report.md"
$mellum = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf"
$qwen = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\Qwen3.6-35B-A3B-KEXP.gguf"
"START $(Get-Date -Format o)" | Set-Content -Path $log -Encoding utf8
& python $script --out $out --report $report --stride 4 $mellum $qwen 2>&1 | Tee-Object -FilePath $log -Append
"EXIT $LASTEXITCODE $(Get-Date -Format o)" | Add-Content -Path $log -Encoding utf8
