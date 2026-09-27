# S23 launch-jank preflight command record

Device: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`.
Each command's stdout/stderr is in its correspondingly named `.log`; exit
codes, in execution order, are in `commands.log`.

Preflight commands: `shasum -a 256 <requested APK>`; `adb devices -l`;
`adb -s <serial> shell dumpsys battery`; `dumpsys thermalservice`;
`ps -A`; `dumpsys power`; `settings get system screen_off_timeout`;
`getprop persist.traced.enable`.

Wake/unlock and install: `input keyevent KEYCODE_WAKEUP`; `wm dismiss-keyguard`;
temporarily set `screen_off_timeout` to `1800000`; capture power/window state;
`adb install -r <requested APK>`; capture `dumpsys package com.kalsa.app`;
launch once with `monkey -p com.kalsa.app 1` to establish package/UI state.

Debuggability check: `run-as com.kalsa.app id` returned exit 1 and
`run-as: package not debuggable: com.kalsa.app`. This was the stop condition;
no A/B arms or chat commands followed.

Cleanup: `am force-stop com.kalsa.app`; `settings delete system
screen_off_timeout`; verify the setting is `null`; wake and dismiss keyguard;
capture final power, battery, and thermal state.
