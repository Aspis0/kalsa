param([switch]$TestOnly)
$ErrorActionPreference = 'Stop'

$phase2 = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2'
$os = Get-CimInstance Win32_OperatingSystem
$free = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
$gate = Join-Path $phase2 'build-detached-v2-gate.txt'
"timestamp=$(Get-Date -Format o)`nFreePhysicalMemory_GB=$free`nRequiredMinimum_GB=8`nflags=DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP|CREATE_UNICODE_ENVIRONMENT|CREATE_BREAKAWAY_FROM_JOB" |
    Set-Content -LiteralPath $gate
Get-Process | Where-Object { $_.Name -match 'gradle|cmake|ninja|clang|g\+\+|make|PPL|llama' } |
    Select-Object Name, Id, CPU, WorkingSet64, PriorityClass | Out-File -FilePath $gate -Append
if ($free -lt 8) {
    Write-Error "RAM gate failed: $free GiB free"
    exit 42
}

$worker = Join-Path $phase2 'build-fork-detached-worker.ps1'
$pwsh = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$workerOut = Join-Path $phase2 'build-detached-v2-worker.out'
$workerErr = Join-Path $phase2 'build-detached-v2-worker.err'
$buildOut = Join-Path $phase2 'build-detached-v2.log'
$buildErr = Join-Path $phase2 'build-detached-v2.err'
$testFile = Join-Path $phase2 'detached-command-test-v2.txt'
if ($TestOnly) {
    $arguments = '-NoProfile -NonInteractive -Command "Set-Content -LiteralPath ''' + $testFile + ''' -Value detached-command-ok"'
} else {
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $worker + '"'
}

Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class DetachedLauncherV2 {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize;
        public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
        public int dwFlags; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION {
        public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES {
        public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(string fileName, uint desiredAccess, uint shareMode,
        ref SECURITY_ATTRIBUTES securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string applicationName, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
        IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out int exitCode);

    public static int LaunchAndWait(string applicationName, string arguments, string currentDirectory,
            string stdoutPath, string stderrPath, out int exitCode) {
        var security = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = 1 };
        const uint GENERIC_WRITE = 0x40000000, FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2;
        const uint CREATE_ALWAYS = 2, FILE_ATTRIBUTE_NORMAL = 0x80;
        var stdout = CreateFile(stdoutPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, ref security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        var stderr = CreateFile(stderrPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, ref security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (stdout == new IntPtr(-1) || stderr == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        var startup = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)), dwFlags = 0x100, hStdOutput = stdout, hStdError = stderr };
        const uint DETACHED_PROCESS = 8, CREATE_NEW_PROCESS_GROUP = 0x200, CREATE_UNICODE_ENVIRONMENT = 0x400, CREATE_BREAKAWAY_FROM_JOB = 0x1000000;
        var commandLine = new StringBuilder(arguments);
        PROCESS_INFORMATION processInfo;
        if (!CreateProcess(applicationName, commandLine, IntPtr.Zero, IntPtr.Zero, true,
                DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT | CREATE_BREAKAWAY_FROM_JOB,
                IntPtr.Zero, currentDirectory, ref startup, out processInfo)) {
            CloseHandle(stdout); CloseHandle(stderr); throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        CloseHandle(stdout); CloseHandle(stderr);
        WaitForSingleObject(processInfo.hProcess, 0xffffffff);
        if (!GetExitCodeProcess(processInfo.hProcess, out exitCode)) exitCode = -1;
        CloseHandle(processInfo.hThread); CloseHandle(processInfo.hProcess);
        return processInfo.dwProcessId;
    }
}
'@

$workerExit = 0
$childPid = [DetachedLauncherV2]::LaunchAndWait($pwsh, $arguments, 'C:\Users\gualt\kals-pin', $workerOut, $workerErr, [ref]$workerExit)
"timestamp=$(Get-Date -Format o)`npid=$childPid`nworker_exit_code=$workerExit`napplication=$pwsh`narguments=$arguments`nflags=DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP|CREATE_UNICODE_ENVIRONMENT|CREATE_BREAKAWAY_FROM_JOB`nworker_stdout=$workerOut`nworker_stderr=$workerErr`nbuild_stdout=$buildOut`nbuild_stderr=$buildErr" |
    Set-Content -LiteralPath (Join-Path $phase2 'build-detached-v2-launch.txt')
Get-Content (Join-Path $phase2 'build-detached-v2-launch.txt')
