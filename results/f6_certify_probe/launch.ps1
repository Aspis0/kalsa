$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\gualt\Desktop\Kalsa\moe-experiments'
$env:PYTHONUNBUFFERED = '1'
$py = 'C:\Users\gualt\AppData\Local\Programs\Python\Python312\python.exe'
$script = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scripts\run_f6_certify_probe.py'
$out = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\f6_certify_probe\out.log'
$err = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\f6_certify_probe\err.log'
& $py -u $script --execute > $out 2> $err
