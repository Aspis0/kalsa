$adb = 'C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$serial = 'adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp'
$out = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\kernel_s2\s23\screen_poll_phaseA.txt'
"mWakefulness poll start $(Get-Date -Format o)" | Set-Content -Path $out -Encoding utf8
while ($true) {
  $line = & $adb -s $serial shell "dumpsys power" 2>$null | Select-String -Pattern 'mWakefulness=' | Select-Object -First 1
  $stamp = Get-Date -Format o
  Add-Content -Path $out -Value ("$stamp  $line") -Encoding utf8
  Start-Sleep -Seconds 20
}
