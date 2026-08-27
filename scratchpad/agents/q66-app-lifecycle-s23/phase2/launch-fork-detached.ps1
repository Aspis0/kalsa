param([switch]$TestOnly)
$ErrorActionPreference = 'Stop'

$phase2 = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2'
$os = Get-CimInstance Win32_OperatingSystem
$free = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
$gate = Join-Path $phase2 'build-detached-gate.txt'
$procs = Get-Process | Where-Object { $_.Name -match 'gradle|cmake|ninja|clang|g\+\+|make|PPL|llama' } |
    Select-Object Name, Id, CPU, WorkingSet64, PriorityClass
"timestamp=$(Get-Date -Format o)`nFreePhysicalMemory_GB=$free`nRequiredMinimum_GB=8`nDETACHED_PROCESS=0x8`nCREATE_NEW_PROCESS_GROUP=0x200`n" |
    Set-Content -LiteralPath $gate
$procs | Out-File -FilePath $gate -Append
if ($free -lt 8) {
    Write-Error "RAM gate failed: $free GiB free"
    exit 42
}

$worker = Join-Path $phase2 'build-fork-detached-worker.ps1'
$pwsh = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$cmdline = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $worker + '"'

Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class DetachedLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public int bInheritHandle;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        ref SECURITY_ATTRIBUTES securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out int exitCode);

    public static int LaunchAndWait(string applicationName, string commandLine, string currentDirectory,
            string stdoutPath, string stderrPath, out int exitCode) {
        var security = new SECURITY_ATTRIBUTES {
            nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),
            lpSecurityDescriptor = IntPtr.Zero,
            bInheritHandle = 1,
        };
        const uint GENERIC_WRITE = 0x40000000;
        const uint FILE_SHARE_READ = 0x00000001;
        const uint FILE_SHARE_WRITE = 0x00000002;
        const uint CREATE_ALWAYS = 2;
        const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
        var stdout = CreateFile(stdoutPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                ref security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        var stderr = CreateFile(stderrPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                ref security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (stdout == new IntPtr(-1) || stderr == new IntPtr(-1)) {
            if (stdout != new IntPtr(-1)) CloseHandle(stdout);
            if (stderr != new IntPtr(-1)) CloseHandle(stderr);
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        var startup = new STARTUPINFO {
            cb = Marshal.SizeOf(typeof(STARTUPINFO)),
            dwFlags = 0x00000100,
            hStdOutput = stdout,
            hStdError = stderr,
        };
        PROCESS_INFORMATION processInfo;
        const uint DETACHED_PROCESS = 0x00000008;
        const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
        const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
        var mutableCommandLine = new StringBuilder(commandLine);
        if (!CreateProcess(applicationName, mutableCommandLine, IntPtr.Zero, IntPtr.Zero, true,
                DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT | CREATE_BREAKAWAY_FROM_JOB,
                IntPtr.Zero, currentDirectory, ref startup, out processInfo)) {
            CloseHandle(stdout);
            CloseHandle(stderr);
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        CloseHandle(stdout);
        CloseHandle(stderr);
        WaitForSingleObject(processInfo.hProcess, 0xffffffff);
        if (!GetExitCodeProcess(processInfo.hProcess, out exitCode)) {
            exitCode = -1;
        }
        CloseHandle(processInfo.hThread);
        CloseHandle(processInfo.hProcess);
        return processInfo.dwProcessId;
    }
}
'@

$workerOut = Join-Path $phase2 'build-detached-worker.out'
$workerErr = Join-Path $phase2 'build-detached-worker.err'
$testFile = Join-Path $phase2 'detached-command-test.txt'
$command = if ($TestOnly) {
    '"' + $pwsh + '" -NoProfile -NonInteractive -Command "Set-Content -LiteralPath ''' + $testFile + ''' -Value detached-command-ok"'
} else {
    $cmdline
}
$workerExit = 0
$childPid = [DetachedLauncher]::LaunchAndWait($pwsh, $command, 'C:\Users\gualt\kals-pin', $workerOut, $workerErr, [ref]$workerExit)
"timestamp=$(Get-Date -Format o)`npid=$childPid`nworker_exit_code=$workerExit`ncommand=$command`nworker=$worker`nflags=DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP|CREATE_UNICODE_ENVIRONMENT|CREATE_BREAKAWAY_FROM_JOB`npriority=worker sets CMake Idle`nworker_stdout=$workerOut`nworker_stderr=$workerErr`nstdout=$phase2\build-detached.log`nstderr=$phase2\build-detached.err" |
    Set-Content -LiteralPath (Join-Path $phase2 'build-detached-launch.txt')
Get-Content (Join-Path $phase2 'build-detached-launch.txt')
