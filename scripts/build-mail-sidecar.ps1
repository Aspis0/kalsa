# Builds the mail sidecar in release and copies it to the name Tauri bundles beside
# the app. Prints one line, the assignment the app is compiled with, on stdout.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root 'target' }
cargo build --release -p kalsa-mail --manifest-path (Join-Path $root 'Cargo.toml') | Out-Null
$binaries = Join-Path $root 'src-tauri\binaries'
New-Item -ItemType Directory -Force -Path $binaries | Out-Null
$destination = Join-Path $binaries 'kalsa-mail-x86_64-pc-windows-msvc.exe'
Copy-Item (Join-Path $targetDir 'release\kalsa-mail.exe') $destination -Force
$sha = (Get-FileHash -Algorithm SHA256 $destination).Hash.ToLower()
Write-Output "`$env:KALSA_MAIL_SHA256 = '$sha'"
