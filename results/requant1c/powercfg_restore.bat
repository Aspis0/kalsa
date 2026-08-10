@echo off
REM Restore power timeouts after campaign (values from pre-mitigation snapshot 2026-08-10)
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 240
powercfg /change monitor-timeout-ac 30
powercfg /change monitor-timeout-dc 3
echo RESTORED monitor-ac=30min monitor-dc=3min standby-dc=240min standby-ac=0
