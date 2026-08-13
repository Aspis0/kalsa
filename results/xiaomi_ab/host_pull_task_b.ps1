# Pull Task B logs after TASK_B done.
$ErrorActionPreference = 'Stop'
$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$X = '192.168.1.193:39643'
$SRC = '/data/local/tmp/gdn_750/logs/task_b'
$DST = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi_ab\task_b'
New-Item -ItemType Directory -Force -Path $DST | Out-Null
Write-Host '=== status ==='
& $ADB -s $X shell "cat $SRC/status.txt"
Write-Host '=== pull ==='
& $ADB -s $X pull "$SRC/." $DST
if ($LASTEXITCODE -ne 0) { throw "adb pull failed" }
Write-Host "pulled -> $DST"
Write-Host '=== batt ==='
& $ADB -s $X shell "dumpsys battery | grep -E 'AC powered|USB powered|^  level:|^  temperature:'"
