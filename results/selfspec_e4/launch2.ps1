$out = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\selfspec_e4"
$env:FORCE_START = "1"
$p = Start-Process -FilePath "python" `
  -ArgumentList "`"$out\run_e4_arms.py`"" `
  -RedirectStandardOutput "$out\runner2.out.log" `
  -RedirectStandardError "$out\runner2.err.log" `
  -WindowStyle Hidden -PassThru
$p.Id | Out-File "$out\runner2.pid.txt" -Encoding ascii
Write-Output "LAUNCHED pid=$($p.Id)"
