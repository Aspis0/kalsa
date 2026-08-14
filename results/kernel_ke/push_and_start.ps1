$ErrorActionPreference = "Stop"
$key = Join-Path $env:USERPROFILE ".ssh\moe_s23"
$ssh = @("-p","8022","-i",$key,"-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","ConnectTimeout=20")
$scp = @("-P","8022","-i",$key,"-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","ConnectTimeout=20")
$host_ = "u0_a344@192.168.1.152"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\kernel_ke"
$bin = Join-Path $root "bin"
$build = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-kernel-ke"
$ndkStrip = "C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-strip.exe"

function L($m) { $line = "[{0}] {1}" -f (Get-Date -Format o), $m; Add-Content -Path "$root\push.log" -Value $line -Encoding utf8; Write-Host $line }

New-Item -ItemType Directory -Force -Path $bin | Out-Null

# Stage from build tree (campaign PS1 does not strip bmoe-cli)
$cli = Join-Path $build "cli\bmoe-cli"
if (-not (Test-Path $cli)) { throw "missing $cli" }
Copy-Item $cli (Join-Path $bin "bmoe-cli") -Force
$libs = @("libggml.so","libggml-base.so","libggml-cpu.so","libllama.so","libllama-common.so")
foreach ($name in $libs) {
  $src = Get-ChildItem -Path $build -Recurse -Filter $name | Select-Object -First 1
  if (-not $src) { throw "$name not found in $build" }
  Copy-Item $src.FullName (Join-Path $bin $name) -Force
}
$stl = "C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib\aarch64-linux-android\libc++_shared.so"
Copy-Item $stl (Join-Path $bin "libc++_shared.so") -Force

Get-ChildItem $bin | ForEach-Object {
  $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  L ("LOCAL {0} {1} {2}" -f $_.Name, $_.Length, $h)
  "{0}  {1}" -f $h, $_.Name
} | Set-Content -Encoding ascii (Join-Path $root "bin.sha256")

L "hash campaign pin BEFORE push"
ssh @ssh $host_ "sha256sum ~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN ~/bin/mellum2/bmoe-cli ~/bin/kernel_s1/bmoe-cli ~/bin/kernel_s2/bmoe-cli 2>/dev/null" | Tee-Object -FilePath "$root\campaign.sha256.before_push"

L "mkdir remote dirs"
ssh @ssh $host_ "mkdir -p ~/bin/kernel_ke ~/experiments/results/kernel_ke/s23 ~/experiments/results/kernel_ke/logs ~/experiments/results/kernel_ke/samples"

L "scp binaries"
scp @scp `
  "$bin\bmoe-cli" `
  "$bin\libggml.so" `
  "$bin\libggml-base.so" `
  "$bin\libggml-cpu.so" `
  "$bin\libllama.so" `
  "$bin\libllama-common.so" `
  "$bin\libc++_shared.so" `
  "${host_}:~/bin/kernel_ke/"

L "scp harness + prompt + wrapper"
scp @scp "$root\run_ke_s23.sh" "$root\p_fact.txt" "${host_}:~/experiments/results/kernel_ke/"
scp @scp "$root\bmoe-cli-kernel-ke" "${host_}:~/bin/bmoe-cli-kernel-ke"

L "chmod + verify pins"
ssh @ssh $host_ @"
chmod 755 ~/bin/kernel_ke/bmoe-cli ~/bin/bmoe-cli-kernel-ke ~/experiments/results/kernel_ke/run_ke_s23.sh
chmod 644 ~/bin/kernel_ke/*.so ~/experiments/results/kernel_ke/p_fact.txt
ls -la ~/bin/kernel_ke
echo '--- KE bins ---'
sha256sum ~/bin/kernel_ke/*
echo '--- pins (must match before) ---'
sha256sum ~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN
sha256sum ~/bin/mellum2/bmoe-cli
"@ | Tee-Object -FilePath "$root\install_remote.txt"

L "start harness in nohup"
ssh @ssh $host_ "termux-wake-lock >/dev/null 2>&1 || true; nohup bash ~/experiments/results/kernel_ke/run_ke_s23.sh > ~/experiments/results/kernel_ke/nohup.out 2>&1 & echo PID=`$!; sleep 1; cat ~/experiments/results/kernel_ke/STATUS.txt 2>/dev/null; tail -8 ~/experiments/results/kernel_ke/master.log 2>/dev/null"
L "PUSH+START done"
