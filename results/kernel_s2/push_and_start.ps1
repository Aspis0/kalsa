$ErrorActionPreference = "Stop"
$key = Join-Path $env:USERPROFILE ".ssh\moe_s23"
$ssh = @("-p","8022","-i",$key,"-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","ConnectTimeout=20")
$scp = @("-P","8022","-i",$key,"-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","ConnectTimeout=20")
$host_ = "u0_a344@192.168.1.152"
$root = "C:\Users\gualt\Desktop\Kalsa\moe-experiments\results\kernel_s2"
$bin = Join-Path $root "bin"
$ndkStrip = "C:\Users\gualt\AppData\Local\Android\Sdk\ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-strip.exe"

function L($m) { $line = "[{0}] {1}" -f (Get-Date -Format o), $m; Add-Content -Path "$root\push.log" -Value $line -Encoding utf8; Write-Host $line }

if (-not (Test-Path "$bin\bmoe-cli")) { throw "missing $bin\bmoe-cli" }
if (-not (Test-Path "$bin\test-backend-ops")) { throw "missing $bin\test-backend-ops" }

if (Test-Path $ndkStrip) {
  Copy-Item "$bin\test-backend-ops" "$bin\test-backend-ops.unstripped" -Force
  & $ndkStrip "$bin\test-backend-ops"
  L "stripped test-backend-ops"
}

Get-ChildItem $bin | ForEach-Object {
  $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  L ("LOCAL {0} {1} {2}" -f $_.Name, $_.Length, $h)
}

# pin BEFORE push
L "hash campaign pin before push"
ssh @ssh $host_ "sha256sum ~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN ~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli ~/bin/mellum2/bmoe-cli ~/bin/kernel_s1/bmoe-cli" | Tee-Object -FilePath "$root\campaign.sha256.push_before"

L "mkdir remote dirs"
ssh @ssh $host_ "mkdir -p ~/bin/kernel_s2 ~/experiments/results/kernel_s2/s23 ~/experiments/results/kernel_s2/logs"

L "scp binaries"
scp @scp `
  "$bin\bmoe-cli" `
  "$bin\test-backend-ops" `
  "$bin\libggml.so" `
  "$bin\libggml-base.so" `
  "$bin\libggml-cpu.so" `
  "$bin\libllama.so" `
  "$bin\libllama-common.so" `
  "$bin\libc++_shared.so" `
  "${host_}:~/bin/kernel_s2/"

L "scp harness + prompt"
scp @scp "$root\run_s2_s23.sh" "$root\p_fact.txt" "${host_}:~/experiments/results/kernel_s2/"

L "chmod + wrapper"
$wrapper = @'
#!/data/data/com.termux/files/usr/bin/bash
HERE="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="$HERE/kernel_s2${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$HERE/kernel_s2/bmoe-cli" "$@"
'@
$wrapperPath = Join-Path $root "bmoe-cli-kernel-s2"
Set-Content -Path $wrapperPath -Value $wrapper -Encoding ascii -NoNewline
Add-Content -Path $wrapperPath -Value "`n" -Encoding ascii
scp @scp $wrapperPath "${host_}:~/bin/bmoe-cli-kernel-s2"

ssh @ssh $host_ @"
chmod 755 ~/bin/kernel_s2/bmoe-cli ~/bin/kernel_s2/test-backend-ops ~/bin/bmoe-cli-kernel-s2 ~/experiments/results/kernel_s2/run_s2_s23.sh
chmod 644 ~/bin/kernel_s2/*.so ~/experiments/results/kernel_s2/p_fact.txt
# never touch campaign pin
ls -la ~/bin/kernel_s2
sha256sum ~/bin/kernel_s2/*
sha256sum ~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN
"@ | Tee-Object -FilePath "$root\install_remote.txt"

L "start harness in nohup"
ssh @ssh $host_ "nohup bash ~/experiments/results/kernel_s2/run_s2_s23.sh > ~/experiments/results/kernel_s2/nohup.out 2>&1 & echo PID=`$!; sleep 1; cat ~/experiments/results/kernel_s2/STATUS.txt 2>/dev/null; tail -5 ~/experiments/results/kernel_s2/master.log 2>/dev/null"
L "PUSH+START done"
