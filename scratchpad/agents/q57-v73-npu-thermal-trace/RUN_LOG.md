# q57 v73 NPU thermal trace RUN_LOG

File-first log. No q57 workload has started yet.

- Date: 2026-08-25
- Device: Galaxy S23 / Hexagon v73
- Serial endpoint: 192.168.1.152:43187 (mDNS service serial: adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp)
- q57 preregistration locked at `a4999d53`; read before measurement: yes
- q56 four-test revalidation: PASS (T1–T4)
- Start eligibility snapshot: 100%; 27.0 °C; unplugged
- No model push; no charging-state change; no deletion.

## Final status

- q57 Arm A/B/C: NOT RUN.
- Reason: hard stop after q53 lane-2 session-3 workload abort signature; no retry or NPU arm permitted.
- Final read-only device check: 96% battery; 36.3 °C at check; unplugged; no residual llama/guard process.
