#Requires -RunAsAdministrator
<#
  Windows Home/Pro: reduce surprise reboots during long lab runs.

  1) Policy-equivalent: NoAutoRebootWithLoggedOnUsers = 1
     (same as GPO "No auto-restart with logged on users for scheduled
      automatic updates installations" — works via registry on Home too)

  2) Active hours that COVER THE NIGHT (max 18h window on Win10):
     default 16:00 -> 10:00 next day (overnight experiments safe)

  Run once elevated:
    Right-click PowerShell -> Run as administrator
    cd ...\moe-experiments
    powershell -ExecutionPolicy Bypass -File scripts\windows_no_auto_reboot_while_logged_on.ps1
#>
$ErrorActionPreference = "Stop"

Write-Host "Product:" (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').ProductName
Write-Host "Edition:" (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID

$au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
if (-not (Test-Path $au)) { New-Item -Path $au -Force | Out-Null }

# 1 = do not auto-reboot if a user is logged on
New-ItemProperty -Path $au -Name NoAutoRebootWithLoggedOnUsers -PropertyType DWord -Value 1 -Force | Out-Null
# Optional: notify before reboot (2 = notify for download and install — leave other AU keys alone)
Write-Host "Set NoAutoRebootWithLoggedOnUsers=1 under $au"

# Active hours: cover night (16:00 -> 10:00 = 18h max typical on Win10)
$ux = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
if (-not (Test-Path $ux)) { New-Item -Path $ux -Force | Out-Null }
New-ItemProperty -Path $ux -Name ActiveHoursStart -PropertyType DWord -Value 16 -Force | Out-Null
New-ItemProperty -Path $ux -Name ActiveHoursEnd   -PropertyType DWord -Value 10 -Force | Out-Null
# 1 = enabled on some builds
try {
  New-ItemProperty -Path $ux -Name IsActiveHoursEnabled -PropertyType DWord -Value 1 -Force | Out-Null
} catch {}
Write-Host "Set ActiveHours 16:00 -> 10:00 (covers overnight lab runs)"

Write-Host ""
Write-Host "Current values:"
Get-ItemProperty $au | Select-Object NoAutoRebootWithLoggedOnUsers | Format-List
Get-ItemProperty $ux | Select-Object ActiveHoursStart, ActiveHoursEnd, IsActiveHoursEnabled | Format-List

Write-Host "DONE. May need a sign-out or 'gpupdate' is N/A on Home; policy applies on next Update cycle."
Write-Host "Note: user can still reboot; feature updates may still force reboot eventually."
