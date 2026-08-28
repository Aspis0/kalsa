$ErrorActionPreference = 'Stop'
$phase = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase3'
$stage = 'C:\q66p3b'
$worker = Join-Path $phase 'build-debug-app-worker-v5.ps1'
$pwsh = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$workerOut = Join-Path $phase 'debug-app-worker-v5.out'
$workerErr = Join-Path $phase 'debug-app-worker-v5.err'
$launchRecord = Join-Path $phase 'debug-app-launch-v5.txt'
$stopLog = Join-Path $phase 'debug-app-gradle-stop-v5.log'

Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class Q66DebugAppDetachedV5 {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SA { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string n,uint a,uint s,ref SA sa,uint c,uint f,IntPtr t);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h,out int c);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  public static int Run(string app,string args,string cwd,string stdout,string stderr,out int code) {
    var sa=new SA{nLength=Marshal.SizeOf(typeof(SA)),bInheritHandle=1}; const uint GW=0x40000000, SR=1, SW=2, CA=2, FA=0x80;
    var ho=CreateFile(stdout,GW,SR|SW,ref sa,CA,FA,IntPtr.Zero); var he=CreateFile(stderr,GW,SR|SW,ref sa,CA,FA,IntPtr.Zero);
    if(ho==new IntPtr(-1)||he==new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    var si=new SI{cb=Marshal.SizeOf(typeof(SI)),dwFlags=0x100,hStdOutput=ho,hStdError=he}; PI pi;
    const uint NG=0x200, UE=0x400, BJ=0x1000000, NW=0x08000000;
    if(!CreateProcess(app,new StringBuilder(args),IntPtr.Zero,IntPtr.Zero,true,NW|NG|UE|BJ,IntPtr.Zero,cwd,ref si,out pi)) throw new Win32Exception(Marshal.GetLastWin32Error());
    CloseHandle(ho); CloseHandle(he); WaitForSingleObject(pi.hProcess,0xffffffff); if(!GetExitCodeProcess(pi.hProcess,out code)) code=-1; CloseHandle(pi.hThread); CloseHandle(pi.hProcess); return pi.dwProcessId;
  }
}
'@

$args = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $worker + '"'
Set-Content -LiteralPath $launchRecord -Value @(
  "START=$(Get-Date -Format o)",
  "WORKER=$worker",
  "WORKER_STDOUT=$workerOut",
  "WORKER_STDERR=$workerErr",
  'DETACHED_FLAGS=CREATE_NO_WINDOW|CREATE_NEW_PROCESS_GROUP|CREATE_UNICODE_ENVIRONMENT|CREATE_BREAKAWAY_FROM_JOB'
) -Encoding UTF8
$workerExit = 0
$workerPid = [Q66DebugAppDetachedV5]::Run($pwsh, $args, $stage, $workerOut, $workerErr, [ref]$workerExit)
@("END=$(Get-Date -Format o)","WORKER_PID=$workerPid","WORKER_EXIT=$workerExit") | Add-Content -LiteralPath $launchRecord

$stopArgs = '/d /c set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"&&set "PATH=C:\Program Files\Android\Android Studio\jbr\bin;%PATH%"&&call "' + $stage + '\android\gradlew.bat" --stop > "' + $stopLog + '" 2>&1'
$stop = Start-Process -FilePath 'cmd.exe' -ArgumentList $stopArgs -WorkingDirectory "$stage\android" -WindowStyle Hidden -Wait -PassThru
try { $stop.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle } catch {}
@("GRADLE_STOP_EXIT=$($stop.ExitCode)","GRADLE_STOP_LOG=$stopLog") | Add-Content -LiteralPath $launchRecord
Get-Content -LiteralPath $launchRecord
exit $workerExit
