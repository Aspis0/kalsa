# Launch Task B ABBA only if UNPLUGGED and batt >= 45. Else print NEED_CHARGE.
$ErrorActionPreference = 'Stop'
$ADB = 'C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$X = '192.168.1.193:39643'
$ROOT = '/data/local/tmp/gdn_750'

$batt = (& $ADB -s $X shell "dumpsys battery") | Out-String
$level = if ($batt -match '(?m)^\s*level:\s*(\d+)') { [int]$Matches[1] } else { -1 }
$ac = $batt -match '(?m)AC powered:\s*true'
$usb = $batt -match '(?m)USB powered:\s*true'
$wl = $batt -match '(?m)Wireless powered:\s*true'
$dock = $batt -match '(?m)Dock powered:\s*true'
$plugged = $ac -or $usb -or $wl -or $dock
$temp = if ($batt -match '(?m)^\s*temperature:\s*(\d+)') { [int]$Matches[1] / 10.0 } else { -1 }
Write-Host "level=$level plugged=$plugged tempC=$temp ac=$ac usb=$usb"
if ($plugged) { Write-Host 'NEED_CHARGE plugged=1'; exit 10 }
if ($level -lt 45) { Write-Host "NEED_CHARGE level=$level"; exit 11 }

# binary + model must exist
$chk = (& $ADB -s $X shell "ls -l $ROOT/bin/bmoe-cli $ROOT/Qwen3.6-35B-A3B-KEXP.gguf $ROOT/run_task_b.sh $ROOT/prompts/p_fact.txt $ROOT/prompts/p_creative.txt") | Out-String
Write-Host $chk
if ($chk -notmatch 'bmoe-cli') { throw 'missing bmoe-cli on device' }
if ($chk -notmatch 'Qwen3.6-35B-A3B-KEXP') { throw 'missing KEXP on device' }

& $ADB -s $X shell "mkdir -p $ROOT/logs/task_b"
& $ADB -s $X shell "cd $ROOT && nohup sh ./run_task_b.sh > $ROOT/logs/task_b/nohup.txt 2>&1 & echo STARTED"
Write-Host 'LAUNCHED'
exit 0
