$ADB='C:/Users/gualt/AppData/Local/Android/Sdk/platform-tools/adb.exe'; $S23='adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp'; $key='C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\spec_ladder\n1\.ssh\moe_s23'
for ($i=0; $i -lt 360; $i++) {
  & $ADB -s $S23 shell input keyevent KEYCODE_WAKEUP 2>$null | Out-Null
  & $ADB -s $S23 shell am start -n com.termux/.app.TermuxActivity 2>$null | Out-Null
  Start-Sleep 30
}
