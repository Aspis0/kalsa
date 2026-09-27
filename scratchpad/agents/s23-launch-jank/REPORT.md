# S23 launch stutter: delayed model load

## 2026-09-26 — preflight stopped

The requested APK was installed with `adb install -r` (success; app data was
preserved). SHA-256 matched the requested build:
`7239d0d29c1c40ae116487a4638dbc730c4eb2de075cd36973d6b07a3f5e1dd0`.
Installed package metadata: versionName `0.1.0`, lastUpdateTime
`2026-09-26 20:34:29`.

**No arms ran.** The installed APK is not debuggable: `dumpsys package` lists
`pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]` without `DEBUGGABLE`, and
`run-as com.kalsa.app id` returned `run-as: package not debuggable`. This
fails the S23 debuggable-build requirement, so no benchmark commands or chat
messages were sent and no stutter/latency measurements are available.

Other preflight checks passed: unplugged, battery 100%, battery 26.8 C,
thermal status 0, no `llama|bench` process, and `persist.traced.enable=0`.
The phone was Dozing at initial inspection; it was woken and keyguard
dismissed before launching the app to inspect package state. Cleanup
force-stopped Kalsa and restored the original `screen_off_timeout` (`null`);
the final power capture showed Awake. No uninstall or data clear occurred.

Raw preflight and cleanup records: `raw/session-20260926/`. Provide a
debuggable APK before retrying the six-arm A/B session.
