param([switch]$TestOnly)
$ErrorActionPreference = 'Stop'
$phase = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase3'
$stage = 'C:\q66p3'
$worker = Join-Path $phase 'build-app-worker.ps1'
$workerOut = Join-Path $phase 'detached-worker.out'
$workerErr = Join-Path $phase 'detached-worker.err'
$launchRecord = Join-Path $phase 'detached-launch.txt'
$os = Get-CimInstance Win32_OperatingSystem
$freeGiB = [math]::Round(([double]$os.FreePhysicalMemory * 1KB) / 1GB, 2)
$before = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match '^(java|gradle|gradle\.bat|cmake|ninja|clang|node)$'
} | Select-Object Id,ProcessName,CPU,WorkingSet64,PriorityClass)
@(
  "START=$(Get-Date -Format o)",
  "STAGE=$stage",
  "FREE_PHYSICAL_GIB=$freeGiB",
  "REQUIRED_MIN_GIB=8",
  'DETACHED_FLAGS=DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP|CREATE_UNICODE_ENVIRONMENT|CREATE_BREAKAWAY_FROM_JOB',
  'PROCESS_GATE_BEGIN',
  ($before | Out-String).TrimEnd(),
  'PROCESS_GATE_END'
) | Set-Content -LiteralPath (Join-Path $phase 'build-gate.txt')
Write-Output "FREE_PHYSICAL_GIB=$freeGiB"
$before | Format-Table -AutoSize | Out-String | Write-Output
if ($freeGiB -lt 8) { Write-Error "RAM gate failed: $freeGiB GiB free"; exit 42 }

$pwsh = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
if ($TestOnly) {
  $testMarker = Join-Path $phase 'detached-self-test.txt'
  $testWorker = Join-Path $phase 'detached-self-test-worker.ps1'
  $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $testWorker + '"'
} else {
  $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $worker + '"'
}

$args | Set-Content -LiteralPath (Join-Path $phase 'detached-command-line.txt')
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class Q66Detached {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
    public int dwFlags; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SA { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string n,uint a,uint s,ref SA sa,uint c,uint f,IntPtr t);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h,out int c);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  public static int Run(string app,string args,string cwd,string stdout,string stderr,out int code) {
    var sa=new SA{nLength=Marshal.SizeOf(typeof(SA)),bInheritHandle=1};
    const uint GW=0x40000000, SR=1, SW=2, CA=2, FA=0x80;
    var ho=CreateFile(stdout,GW,SR|SW,ref sa,CA,FA,IntPtr.Zero); var he=CreateFile(stderr,GW,SR|SW,ref sa,CA,FA,IntPtr.Zero);
    if(ho==new IntPtr(-1)||he==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    var si=new SI{cb=Marshal.SizeOf(typeof(SI)),dwFlags=0x100,hStdOutput=ho,hStdError=he}; PI pi;
    const uint DP=0x08000000, NG=0x200, UE=0x400, BJ=0x1000000;
    if(!CreateProcess(app,new StringBuilder(args),IntPtr.Zero,IntPtr.Zero,true,DP|NG|UE|BJ,IntPtr.Zero,cwd,ref si,out pi)) throw new Win32Exception(Marshal.GetLastWin32Error());
    CloseHandle(ho); CloseHandle(he); WaitForSingleObject(pi.hProcess,0xffffffff); if(!GetExitCodeProcess(pi.hProcess,out code)) code=-1; CloseHandle(pi.hThread); CloseHandle(pi.hProcess); return pi.dwProcessId;
  }
}
'@

$workerExit = 0
$workerPid = [Q66Detached]::Run($pwsh, $args, $stage, $workerOut, $workerErr, [ref]$workerExit)
$selfTest = if ($TestOnly) { Join-Path $phase 'detached-self-test.txt' } else { $null }
if ($TestOnly) {
  Write-Output "SELF_TEST_EXIT=$workerExit"
  Write-Output "SELF_TEST_MARKER=$selfTest"
  exit $workerExit
}
$gradlew = Join-Path $stage 'android\gradlew.bat'
$stopLog = Join-Path $phase 'gradle-stop.log'
@(
  "WORKER_END=$(Get-Date -Format o)",
  "WORKER_PID=$workerPid",
  "WORKER_EXIT=$workerExit",
  "WORKER_STDOUT=$workerOut",
  "WORKER_STDERR=$workerErr"
) | Set-Content -LiteralPath $launchRecord
$stopCommand = "/d /c call `"$gradlew`" --stop > `"$stopLog`" 2>&1"
$stopProc = Start-Process -FilePath 'cmd.exe' -ArgumentList $stopCommand -WorkingDirectory (Join-Path $stage 'android') -WindowStyle Hidden -Wait -PassThru
$stopCode = $stopProc.ExitCode
@(
  "GRADLE_STOP_EXIT=$stopCode",
  "GRADLE_STOP_LOG=$stopLog",
  "END=$(Get-Date -Format o)"
) | Add-Content -LiteralPath $launchRecord
Get-Content -LiteralPath $launchRecord
exit $workerExit
