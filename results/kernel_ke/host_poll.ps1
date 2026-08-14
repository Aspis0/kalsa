$ErrorActionPreference = "Continue"
$adb = "C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$s = "adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\kernel_ke"
$key = Join-Path $env:USERPROFILE ".ssh\moe_s23"
$ssh = @("-p","8022","-i",$key,"-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","ConnectTimeout=12")
$host_ = "u0_a344@192.168.1.152"
$screenLog = Join-Path $root "s23_screen_host.txt"
$battLog = Join-Path $root "s23_battery_host.txt"
New-Item -ItemType Directory -Force -Path (Join-Path $root "s23") | Out-Null

function Wake {
  & $adb -s $s shell "input keyevent KEYCODE_WAKEUP" 2>$null
  & $adb -s $s shell "settings put system screen_off_timeout 7200000" 2>$null
}

"ts screen current_now_mA current_avg_mA voltage_mV temp_dC ac usb" | Set-Content -Encoding ascii $battLog
Wake
$n = 0
while ($true) {
  $n++
  $ts = Get-Date -Format o
  $wake = (& $adb -s $s shell "dumpsys power" 2>$null | Select-String -Pattern "mWakefulness=" | Select-Object -First 1)
  $w = if ($wake) { ($wake.ToString() -replace '.*mWakefulness=','').Trim() } else { "UNKNOWN" }
  if ($w -ne "Awake") { Wake }
  "$ts $w" | Add-Content -Encoding ascii $screenLog
  $batt = & $adb -s $s shell "dumpsys battery" 2>$null
  $now = (($batt | Select-String -Pattern "current now:" | Select-Object -First 1).ToString() -replace '.*current now:\s*','').Trim()
  $avg = (($batt | Select-String -Pattern "current_avg:" | Select-Object -Last 1).ToString() -replace '.*current_avg:','' -replace ',.*','').Trim()
  $volt = (($batt | Select-String -Pattern "^\s+voltage:" | Select-Object -First 1).ToString() -replace '.*voltage:\s*','').Trim()
  $temp = (($batt | Select-String -Pattern "^\s+temperature:" | Select-Object -First 1).ToString() -replace '.*temperature:\s*','').Trim()
  $ac = (($batt | Select-String -Pattern "AC powered:" | Select-Object -First 1).ToString() -replace '.*AC powered:\s*','').Trim()
  $usb = (($batt | Select-String -Pattern "USB powered:" | Select-Object -First 1).ToString() -replace '.*USB powered:\s*','').Trim()
  "$ts $w $now $avg $volt $temp $ac $usb" | Add-Content -Encoding ascii $battLog
  if ($n % 3 -eq 0) {
    ssh @ssh $host_ "echo '$ts $w' >> ~/experiments/results/kernel_ke/s23/screen_host.txt" 2>$null
  }
  $st = ssh @ssh $host_ "cat ~/experiments/results/kernel_ke/STATUS.txt 2>/dev/null" 2>$null
  if ($st -match "KE_DONE|ABORT_|FAIL_|PENDING_BATTERY") {
    "STOP $st" | Add-Content -Encoding ascii $battLog
    break
  }
  Start-Sleep -Seconds 5
}
