# Push the NEW kf binary to Jelly ~/bin/kernel_kf/ and start the A/B harness.
# Never writes the campaign pin. Verify sha before and after.
$ErrorActionPreference = "Stop"
$ssh = @("-p","8022","-o","BatchMode=yes","-o","ConnectTimeout=20")
$scp = @("-P","8022","-o","BatchMode=yes","-o","ConnectTimeout=20")
$host_ = "u0_a225@192.168.1.82"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\kernel_kf_proto"
$bin = Join-Path $root "bin"
$build = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge-kf\build-android-kf"
$ndkStrip = "C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-strip.exe"

function L($m) {
    $line = "[{0}] {1}" -f (Get-Date -Format o), $m
    Add-Content -Path "$root\push.log" -Value $line -Encoding utf8
    Write-Host $line
}

New-Item -ItemType Directory -Force -Path $bin | Out-Null

$cli = Join-Path $build "cli\bmoe-cli"
if (-not (Test-Path $cli)) { throw "missing $cli — build Android first" }
Copy-Item $cli (Join-Path $bin "bmoe-cli") -Force
$libs = @("libggml.so","libggml-base.so","libggml-cpu.so","libllama.so","libllama-common.so")
foreach ($name in $libs) {
    $src = Get-ChildItem -Path $build -Recurse -Filter $name | Select-Object -First 1
    if (-not $src) { throw "$name not found in $build" }
    Copy-Item $src.FullName (Join-Path $bin $name) -Force
}
$stl = "C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib\aarch64-linux-android\libc++_shared.so"
Copy-Item $stl (Join-Path $bin "libc++_shared.so") -Force
if (Test-Path $ndkStrip) {
    & $ndkStrip (Join-Path $bin "bmoe-cli")
}

Get-ChildItem $bin | ForEach-Object {
    $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
    L ("LOCAL {0} {1} {2}" -f $_.Name, $_.Length, $h)
} | Out-Null
Get-ChildItem $bin | ForEach-Object {
    "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
} | Set-Content -Encoding ascii (Join-Path $root "bin.sha256")

L "hash campaign pin BEFORE push"
ssh @ssh $host_ "sha256sum ~/bin/bmoe-cli.JELLY ~/bin/kernel_s1/bmoe-cli ~/bin/kernel_s2/bmoe-cli 2>/dev/null" | Tee-Object -FilePath "$root\campaign.sha256.before_push"

L "mkdir remote dirs"
ssh @ssh $host_ "mkdir -p ~/bin/kernel_kf ~/experiments/results/kernel_kf_proto/logs ~/experiments/results/kernel_kf_proto/prompts ~/experiments/results/kernel_kf_proto/mem ~/experiments/results/kernel_kf_proto/gen"

L "scp binaries + harness + prompt"
scp @scp `
    "$bin\bmoe-cli" `
    "$bin\libggml.so" `
    "$bin\libggml-base.so" `
    "$bin\libggml-cpu.so" `
    "$bin\libllama.so" `
    "$bin\libllama-common.so" `
    "$bin\libc++_shared.so" `
    "${host_}:~/bin/kernel_kf/"
scp @scp "$root\run_kf_jelly.sh" "${host_}:~/experiments/results/kernel_kf_proto/run_kf_jelly.sh"
scp @scp "$root\prompts\p_fact.txt" "${host_}:~/experiments/results/kernel_kf_proto/prompts/p_fact.txt"

L "chmod + verify pins"
ssh @ssh $host_ @"
chmod 755 ~/bin/kernel_kf/bmoe-cli ~/experiments/results/kernel_kf_proto/run_kf_jelly.sh
chmod 644 ~/bin/kernel_kf/*.so ~/experiments/results/kernel_kf_proto/prompts/p_fact.txt
echo '--- KF bins ---'
sha256sum ~/bin/kernel_kf/*
echo '--- campaign pin (must match before) ---'
sha256sum ~/bin/bmoe-cli.JELLY
"@ | Tee-Object -FilePath "$root\install_remote.txt"

L "start harness in nohup"
ssh @ssh $host_ "export PATH=/data/data/com.termux/files/usr/bin:`$HOME/bin:`$PATH; termux-wake-lock >/dev/null 2>&1 || true; nohup bash ~/experiments/results/kernel_kf_proto/run_kf_jelly.sh > ~/experiments/results/kernel_kf_proto/nohup.out 2>&1 & echo PID=`$!; sleep 1; cat ~/experiments/results/kernel_kf_proto/STATUS.txt 2>/dev/null; tail -8 ~/experiments/results/kernel_kf_proto/KF.master.log 2>/dev/null"
L "PUSH+START done"
