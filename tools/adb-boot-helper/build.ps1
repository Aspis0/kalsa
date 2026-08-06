# Builds and installs the wireless-debugging boot helper.
# No Gradle: this is ~2 classes and a manifest, and the SDK command line tools
# are enough. Run from anywhere; paths are resolved from $PSScriptRoot.
$ErrorActionPreference = 'Stop'

$sdk  = 'C:\Users\gualt\AppData\Local\Android\Sdk'
$bt   = "$sdk\build-tools\36.1.0"
$jbr  = 'C:\Program Files\Android\Android Studio\jbr\bin'
$plat = "$sdk\platforms\android-36\android.jar"
$adb  = "$sdk\platform-tools\adb.exe"

# d8/apksigner are .bat wrappers that shell out to `java`; neither is on PATH here.
$env:JAVA_HOME = Split-Path $jbr -Parent
$env:PATH = "$jbr;$env:PATH"

$root = $PSScriptRoot
$out  = "$root\build"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$out\classes" | Out-Null

Write-Host '== javac'
& "$jbr\javac.exe" -source 8 -target 8 -nowarn -bootclasspath $plat `
    -d "$out\classes" (Get-ChildItem "$root\src" -Recurse -Filter *.java).FullName
if ($LASTEXITCODE) { throw 'javac failed' }

Write-Host '== d8'
& "$bt\d8.bat" --lib $plat --min-api 26 --output $out `
    (Get-ChildItem "$out\classes" -Recurse -Filter *.class).FullName
if ($LASTEXITCODE) { throw 'd8 failed' }

Write-Host '== aapt2 link (no resources)'
& "$bt\aapt2.exe" link -I $plat --manifest "$root\AndroidManifest.xml" `
    --min-sdk-version 26 --target-sdk-version 28 -o "$out\base.apk"
if ($LASTEXITCODE) { throw 'aapt2 link failed' }

Write-Host '== add classes.dex'
Push-Location $out
& "$bt\aapt.exe" add -f base.apk classes.dex | Out-Null
Pop-Location
if ($LASTEXITCODE) { throw 'aapt add failed' }

Write-Host '== zipalign'
& "$bt\zipalign.exe" -f 4 "$out\base.apk" "$out\aligned.apk"
if ($LASTEXITCODE) { throw 'zipalign failed' }

$ks = "$root\debug.keystore"
if (-not (Test-Path $ks)) {
    Write-Host '== keystore'
    & "$jbr\keytool.exe" -genkeypair -v -keystore $ks -storepass moeboot -keypass moeboot `
        -alias moeboot -keyalg RSA -keysize 2048 -validity 10000 `
        -dname 'CN=MoE ADB Boot, OU=kalsa, O=kalsa, C=IT'
    if ($LASTEXITCODE) { throw 'keytool failed' }
}

Write-Host '== apksigner'
& "$bt\apksigner.bat" sign --ks $ks --ks-pass pass:moeboot --key-pass pass:moeboot `
    --out "$root\moe-adb-boot.apk" "$out\aligned.apk"
if ($LASTEXITCODE) { throw 'apksigner failed' }

Write-Host "== built $root\moe-adb-boot.apk"
