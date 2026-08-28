$ErrorActionPreference = 'Stop'

$phase = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase3'
$worker = Join-Path $phase 'engine-test-worker.ps1'
$launchLog = Join-Path $phase 'engine-test-launch.txt'
$ram = Get-CimInstance Win32_OperatingSystem
$freeGiB = [math]::Round($ram.FreePhysicalMemory / 1MB, 2)
$totalGiB = [math]::Round($ram.TotalVisibleMemorySize / 1MB, 2)
$gate = "timestamp=$(Get-Date -Format o)`nfree_physical_gib=$freeGiB`ntotal_physical_gib=$totalGiB`nrequired_free_physical_gib=8.00"
if ($freeGiB -lt 8.0) {
    $gate + "`nGATE=FAIL" | Set-Content -LiteralPath $launchLog -Encoding UTF8
    throw "RAM gate failed: $freeGiB GiB free physical RAM"
}
$gate + "`nGATE=PASS" | Set-Content -LiteralPath $launchLog -Encoding UTF8

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Q66Detached {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars;
    public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION {
    public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId;
  }
  [StructLayout(LayoutKind.Sequential)] public struct SECURITY_ATTRIBUTES {
    public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle;
  }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CreateProcess(string app, string cmd, ref SECURITY_ATTRIBUTES pa, ref SECURITY_ATTRIBUTES ta,
    bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  public const uint CREATE_NO_WINDOW=0x08000000, CREATE_NEW_PROCESS_GROUP=0x00000200,
    CREATE_UNICODE_ENVIRONMENT=0x00000400, CREATE_BREAKAWAY_FROM_JOB=0x01000000;
}
'@

$stdoutPath = Join-Path $phase 'engine-test-worker.stdout.log'
$stderrPath = Join-Path $phase 'engine-test-worker.stderr.log'
$stdout = [System.IO.File]::Open($stdoutPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
$stderr = [System.IO.File]::Open($stderrPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
$sa = New-Object Q66Detached+SECURITY_ATTRIBUTES
$sa.nLength = [Runtime.InteropServices.Marshal]::SizeOf($sa)
$sa.bInheritHandle = 1
$si = New-Object Q66Detached+STARTUPINFO
$si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
$si.dwFlags = 0x100
$si.hStdOutput = $stdout.SafeFileHandle.DangerousGetHandle()
$si.hStdError = $stderr.SafeFileHandle.DangerousGetHandle()
$pi = New-Object Q66Detached+PROCESS_INFORMATION
$flags = [Q66Detached]::CREATE_NO_WINDOW -bor [Q66Detached]::CREATE_NEW_PROCESS_GROUP -bor [Q66Detached]::CREATE_UNICODE_ENVIRONMENT -bor [Q66Detached]::CREATE_BREAKAWAY_FROM_JOB
$pwsh = (Get-Command powershell.exe).Source
$cmd = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$worker`""
$ok = [Q66Detached]::CreateProcess($pwsh, $cmd, [ref]$sa, [ref]$sa, $true, $flags, [IntPtr]::Zero, $phase, [ref]$si, [ref]$pi)
$lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
$stdout.Dispose(); $stderr.Dispose()
if (-not $ok) {
    "CreateProcess failed win32=$lastError`ncommand=$cmd" | Add-Content -LiteralPath $launchLog -Encoding UTF8
    throw "Detached worker launch failed: Win32 $lastError"
}
"worker_pid=$($pi.dwProcessId)`nworker_command=$cmd`nflags=CREATE_NO_WINDOW|CREATE_NEW_PROCESS_GROUP|CREATE_UNICODE_ENVIRONMENT|CREATE_BREAKAWAY_FROM_JOB" | Add-Content -LiteralPath $launchLog -Encoding UTF8
[Q66Detached]::CloseHandle($pi.hThread) | Out-Null
[Q66Detached]::CloseHandle($pi.hProcess) | Out-Null
