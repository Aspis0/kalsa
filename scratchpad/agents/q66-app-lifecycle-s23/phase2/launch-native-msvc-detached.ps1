param([switch]$Diagnostics, [switch]$VcvarsDiagnostics, [switch]$NinjaOnly, [switch]$PsDiagnostics, [switch]$Q63Exact, [switch]$AllCTest)
$ErrorActionPreference = 'Stop'

$phase2 = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\phase2'
$cmd = 'C:\Windows\System32\cmd.exe'
$batch = if ($AllCTest) { Join-Path $phase2 'run-all-ctest.cmd' } elseif ($Q63Exact) { Join-Path $phase2 'run-native-msvc-exact.cmd' } elseif ($NinjaOnly) { Join-Path $phase2 'run-native-ninja.cmd' } elseif ($PsDiagnostics) { Join-Path $phase2 'test-vcvars-ps.cmd' } elseif ($VcvarsDiagnostics) { Join-Path $phase2 'test-vcvars64-return.cmd' } elseif ($Diagnostics) { Join-Path $phase2 'test-vsdev-return.cmd' } else { Join-Path $phase2 'run-native-msvc.cmd' }
$suffix = if ($AllCTest) { '-all-ctest' } else { '' }
$result = Join-Path $phase2 ("build-native-msvc-result$suffix.txt")
$gate = Join-Path $phase2 ("build-native-msvc-gate$suffix.txt")
$stdout = Join-Path $phase2 ("build-native-msvc$suffix.log")
$stderr = Join-Path $phase2 ("build-native-msvc$suffix.err")

$os = Get-CimInstance Win32_OperatingSystem
$free = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
"timestamp=$(Get-Date -Format o)`nFreePhysicalMemory_GB=$free`nRequiredMinimum_GB=8`nflags=DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP|CREATE_UNICODE_ENVIRONMENT|CREATE_BREAKAWAY_FROM_JOB`nVsDevCmd=BuildTools-2022 -arch=x64`nCMAKE_BUILD_PARALLEL_LEVEL=2`nNINJAFLAGS=-j2" | Set-Content -LiteralPath $gate
Get-Process | Where-Object { $_.Name -match 'gradle|cmake|ninja|clang|cl|make|PPL|llama' } | Select-Object Name,Id,CPU,WorkingSet64,PriorityClass | Out-File -FilePath $gate -Append
if ($free -lt 8) { Write-Error "RAM gate failed: $free GiB free"; exit 42 }

Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class DetachedMsvcLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO {
        public int cb; public IntPtr lpReserved; public IntPtr lpDesktop; public IntPtr lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize;
        public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
        public int dwFlags; public ushort wShowWindow; public ushort cbReserved2; public IntPtr lpReserved2;
        public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
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
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetPriorityClass(IntPtr process, uint priorityClass);

    public static int Launch(string applicationName, string arguments, string currentDirectory,
            string stdoutPath, string stderrPath, out int exitCode) {
        var security = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = 1 };
        const uint GENERIC_WRITE = 0x40000000, FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2;
        const uint CREATE_ALWAYS = 2, FILE_ATTRIBUTE_NORMAL = 0x80;
        var stdout = CreateFile(stdoutPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, ref security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        var stderr = CreateFile(stderrPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, ref security, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (stdout == new IntPtr(-1) || stderr == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        var startup = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)), dwFlags = 0x100, hStdOutput = stdout, hStdError = stderr };
        const uint DETACHED_PROCESS = 8, CREATE_NEW_PROCESS_GROUP = 0x200, CREATE_UNICODE_ENVIRONMENT = 0x400, CREATE_BREAKAWAY_FROM_JOB = 0x1000000;
        var mutableArguments = new StringBuilder(arguments);
        PROCESS_INFORMATION processInfo;
        if (!CreateProcess(applicationName, mutableArguments, IntPtr.Zero, IntPtr.Zero, true,
                DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT | CREATE_BREAKAWAY_FROM_JOB,
                IntPtr.Zero, currentDirectory, ref startup, out processInfo)) {
            CloseHandle(stdout); CloseHandle(stderr); throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        CloseHandle(stdout); CloseHandle(stderr);
        SetPriorityClass(processInfo.hProcess, 0x40);
        WaitForSingleObject(processInfo.hProcess, 0xffffffff);
        if (!GetExitCodeProcess(processInfo.hProcess, out exitCode)) exitCode = -1;
        CloseHandle(processInfo.hThread); CloseHandle(processInfo.hProcess);
        return processInfo.dwProcessId;
    }
}
'@

$exitCode = 0
$started = Get-Date
$arguments = $cmd + ' /d /c call "' + $batch + '"'
$processId = [DetachedMsvcLauncher]::Launch($cmd, $arguments, 'C:\Users\gualt\kals-pin', $stdout, $stderr, [ref]$exitCode)
$ended = Get-Date
"started=$($started.ToString('o'))`nended=$($ended.ToString('o'))`nwall_seconds=$(($ended - $started).TotalSeconds)`npid=$processId`nexit_code=$exitCode`npriority=IDLE_PRIORITY_CLASS`nrecipe=VsDevCmd.bat -arch=x64; MSVC CMake/Ninja; CMAKE_BUILD_PARALLEL_LEVEL=2; NINJAFLAGS=-j2" | Set-Content -LiteralPath $result
Get-Content $result
exit $exitCode
