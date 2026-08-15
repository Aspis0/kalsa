$out = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\selfspec_e4"
$p = Start-Process -FilePath "python" `
  -ArgumentList "`"$out\run_e4_arms.py`"" `
  -RedirectStandardOutput "$out\runner.out.log" `
  -RedirectStandardError "$out\runner.err.log" `
  -WindowStyle Hidden -PassThru
$p.Id | Out-File "$out\runner.pid.txt" -Encoding ascii
Write-Output "LAUNCHED pid=$($p.Id)"
