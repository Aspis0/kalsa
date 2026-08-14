$key = Join-Path $env:USERPROFILE ".ssh\moe_s23"
while ($true) {
  $st = ssh -p 8022 -i $key -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 u0_a344@192.168.1.152 "cat ~/experiments/results/kernel_ke/STATUS.txt 2>/dev/null"
  if ($st -match '^KE_DONE') { Write-Output DONE; exit 0 }
  if ($st -match 'ABORT_|FAIL_PIN|FAIL_NO_|PENDING_BATTERY') { Write-Output FAILED; exit 1 }
  Start-Sleep -Seconds 45
}
