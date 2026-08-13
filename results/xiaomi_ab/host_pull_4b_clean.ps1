# Pull clean 4B logs from Xiaomi after TASK_A_4B_CLEAN done. Does not start work.
$ErrorActionPreference = 'Stop'
$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$X = '192.168.1.193:39643'
$SRC = '/data/local/tmp/gdn_750/logs/task_a_4b_clean'
$DST = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi_ab\task_a_4b_clean'
New-Item -ItemType Directory -Force -Path $DST | Out-Null
Write-Host '=== status ==='
& $ADB -s $X shell "cat $SRC/status.txt"
Write-Host '=== pull ==='
# Pull contents into DST (not DST/task_a_4b_clean/) to avoid the nested task_a/task_a copy.
& $ADB -s $X pull "$SRC/." $DST
if ($LASTEXITCODE -ne 0) { throw "adb pull failed" }
Write-Host "pulled -> $DST"
Write-Host '=== batt ==='
& $ADB -s $X shell "dumpsys battery | grep -E 'AC powered|USB powered|^  level:|^  temperature:'"
