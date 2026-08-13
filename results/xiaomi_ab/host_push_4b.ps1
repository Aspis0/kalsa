# Push 4B GGUF + 4B harness to Xiaomi, sha-verify, launch if batt>=85 and UNPLUGGED.
$ErrorActionPreference = 'Stop'
$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$X = '192.168.1.193:39643'
$PC = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\draft\Qwen3.5-4B-Q4_K_M.gguf'
$SCRIPT = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\xiaomi_ab\run_task_a_4b.sh'
$EXPECT = '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4'
$DEV = '/data/local/tmp/gdn_750/Qwen3.5-4B-Q4_K_M.gguf'

Write-Host '=== pre-push battery ==='
& $ADB -s $X shell "dumpsys battery | grep -E 'AC powered|USB powered|Wireless powered|^  level:|^  temperature:'"
Write-Host '=== df ==='
& $ADB -s $X shell "df -h /data"

Write-Host '=== push 4B model ==='
& $ADB -s $X push $PC $DEV
if ($LASTEXITCODE -ne 0) { throw "adb push 4B failed" }

Write-Host '=== on-device sha256 (few min) ==='
$got = (& $ADB -s $X shell "sha256sum $DEV").ToString().Trim()
Write-Host $got
if ($got -notmatch "^$EXPECT") { throw "4B sha mismatch: $got" }

& $ADB -s $X push $SCRIPT /data/local/tmp/gdn_750/run_task_a_4b.sh
& $ADB -s $X shell "chmod 755 /data/local/tmp/gdn_750/run_task_a_4b.sh"

Write-Host '=== launch 4B harness ==='
& $ADB -s $X shell "cd /data/local/tmp/gdn_750 && nohup sh ./run_task_a_4b.sh > /data/local/tmp/gdn_750/logs/task_a/nohup_4b.txt 2>&1 & echo STARTED"
Start-Sleep -Seconds 2
& $ADB -s $X shell "cat /data/local/tmp/gdn_750/logs/task_a/status_4b.txt; ps -A | grep -E 'llama-bench|run_task_a_4b' || true"
