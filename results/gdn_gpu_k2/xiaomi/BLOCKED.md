# Xiaomi 14 (Adreno 750) — BLOCKED

K2 could not reach the device. Full S23 pass is in `../s23/`.

## Connection attempts (2026-08-12 ~13:48–13:49 -04:00)

| attempt | result |
|---|---|
| `adb devices -l` | S23 (`SM_S911U` / `dm1q`) + Jelly_Star only. No Xiaomi. |
| `adb mdns services` | `adb-R3CW406P8CV` (S23, 192.168.1.152:44831) and Jelly Star. **No `adb-625689a2*`**. |
| `adb mdns check` | daemon up (`adb discovery 0.0.0`) |
| `adb connect adb-625689a2-9xEOfw._adb-tls-connect._tcp` | `cannot resolve host ... port 5555 (11001)` |
| `adb connect adb-625689a2-9xEOfw` | same |

S0 recorded only the mDNS name (`reports/moe-spike-gpu-xiaomi.md` §1), no IPv4. S0 also noted Termux `sshd` was **not** running. No LAN port-scan was performed.

## Implication

Adreno 750 (the target family) is unmeasured. S23 Adreno 740 results do **not** substitute: 740 driver 0676.73 has no subgroup broadcast and flash-attn kernels fail to compile. 750 may differ.

Retry K2 Xiaomi when wireless debugging is on and `adb mdns services` lists `adb-625689a2*`.
