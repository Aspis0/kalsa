# S23 delayed eager-load launch-jank run

Device: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. Requested debug APK
was SHA-256 checked, installed with `adb install -r`, and validated using
`run-as com.kalsa.app id`. Full gate/install evidence is under `preflight/`;
the six measured arms each preserve `gfxinfo.log`, `top.log`, and filtered
timestamped `key_events.log`.

For each measured arm, the order was battery/thermal gate, `am force-stop
com.kalsa.app`, 20 s idle, `dumpsys gfxinfo com.kalsa.app reset`, `logcat -c`,
launch marker, `monkey -p com.kalsa.app 1`, poll `pidof` until available,
`top -H -b -n 6 -d 5 -p <pid>`, gfxinfo capture, then logcat capture. After
30 s, the verified text `Reply with one word: ok` was sent; a log marker and
the resulting `KALSA_TELEMETRY` line are retained. A used
`bench:eager_delay clear`; B used `bench:eager_delay 5000`; each ack was
checked in the UI dump before the next cold launch.

Order: A1, B1, A2, B2, A3, B3. `arm-b1/` is the first B1 launch attempt: the
immediate PID read was empty, so it has no valid top/gfx sample. The measured
B1 retry is in `arm-b1-valid/`. A1's first prompt input contained literal
percent signs and was sent; the standard prompt was sent as turn 2. Both
deviations are described in `../../REPORT.md`.

After B3, `bench:eager_delay clear` was acknowledged, Kalsa was force-stopped,
the original timeout (`null`) restored, and the WAKEUP loop stopped. Raw
command output is in the adjacent `.log` files; execution exit statuses are
listed in `commands.log`. `control_acks.log` records the UI-confirmed A/B
settings; `input_checks.log` confirms the exact prompt text before send.
