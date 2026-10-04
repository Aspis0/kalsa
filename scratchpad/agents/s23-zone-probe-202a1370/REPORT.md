# S23: can the app process read per-component temperatures? (2026-10-03)

**Answer: yes, through sysfs. No, through HardwarePropertiesManager.**

Build: app `202a1370` (debuggable APK, CI run 37172399524), kalsa.rn `c3f982b5`, kalsallama `32f6033c8`.
Device: Galaxy S23 (SM-S911U), unplugged, 72 %, battery 29.5 C, thermal status 0.
Process domain at probe time: `u:r:untrusted_app:s0:c91,c257,c512,c768` (same domain as a release build;
`debuggable` only enables run-as, it does not change the app domain).

Method: `kalsa.bench.zone_probe=1`, cold launch, one `KALSA_ZONE_PROBE` line
(`raw/kalsa-zone-probe.logcat.txt`), key deleted afterwards.

## sysfs `/sys/class/thermal`

- 95 zones; `type` readable on 95, `temp` readable on 86.
- The 9 unreadable `temp` files fail with `IOException: read failed: EINVAL` (a disabled/virtual zone
  answering EINVAL, not an SELinux denial: an SELinux denial reads as EACCES).
- Every component zone read, temps in milli-C:
  - CPU: `cpuss-0..3`, `cpu-0-0..2` (little), `cpu-1-0..10` (big/prime) - 45.4 to 62.0 C at app boot.
  - GPU: `gpuss-0..7` - 37.2 to 44.4 C.
  - NSP (Hexagon): `nspss-0..3` - 35.4 to 39.0 C.

So the policy reading earlier the same day (`vendor_sepolicy.cil` grants `sysfs_thermal` read only to
`platform_app`/`system_app`) was incomplete: the app process reads these files. The grant comes from a rule
we did not see (the compiled policy is not readable from shell), so the measured read is the evidence.

## HardwarePropertiesManager

CPU, GPU and SKIN all throw `SecurityException: The caller is neither a device owner, nor holding the
DEVICE_POWER permission, nor the current VrListener.` Not usable by a normal app.

## Consequence for the governor

The per-component temperature input that the "three-legged surfer" needs (CPU / GPU / NSP each) is readable
in-app on the S23 at no permission cost. Open: other vendors (Jelly/MediaTek, Xiaomi 14, 8 Elite QRD) may
label the zones differently or deny them - the probe answers that per device in one launch.
