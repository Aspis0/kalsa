# Device input recipe (Galaxy S23, wireless adb)

Lost once (never committed). Diagnosed 2026-08-17 on `192.168.1.152:5555`, APK `3a3a15f`, app `com.kalsa.app`. Serial must be passed as `-s` every time. Never `adb disconnect`, never uninstall (GGUF lives in app data).

## What unloads the model

**Product behaviour, independent of the bench.** `AppState === "background"` disposes the engine.

```2474:2576:src/app/AppShell.tsx
      onAppState: (state) => {
        if (disposed) return;
        if (state === "background") {
          // True background only. iOS `inactive` is Control Center / shade —
          // abort/save/dispose there would kill a still-visible session.
          ...
                    console.info(
                      "model.unload",
                      JSON.stringify({ reason: "background" }),
                    );
```

`inactive` is intentionally ignored. Anything that makes RN report `background` kills a live session.

### Trigger that cost the thermal run: `am start`

Even a no-op deliver-to-the-already-focused activity is enough:

```
$ adb -s 192.168.1.152:5555 shell am start -n com.kalsa.app/.MainActivity
Starting: Intent { cmp=com.kalsa.app/.MainActivity }
Warning: Activity not started, intent has been delivered to currently running top-most instance.
```

```
08-17 10:25:07.641 15146 15171 I ReactNativeJS: KALSA_SESSION {"op":"save",...,"ok":true,"tokens":1298,...}
08-17 10:25:07.947 15146 15171 I ReactNativeJS: 'model.unload', '{"reason":"background"}'
```

The `kalsa://share?text=` path is the same bug: it is an `am start -a VIEW`. The deep link is not special; **any `am start` of this activity after the engine is up unloads it.**

Also unloads:

- Screen off (unplugged default timeout). First aborted control: `interrupted:true` then `model.unload {"reason":"background"}`.
- Notification shade on top (`mCurrentFocus=NotificationShade`) — collapse it before driving.

Does **not** unload (measured):

- `settings put system user_rotation` 1→0 (stays `active`).
- Opening the in-app drawer, Settings, or "Nuova chat" (no new `model.unload` line).

Hold the screen: `settings put system screen_off_timeout 86400000` (save+restore; `ci-lib.sh` `device_keepawake_setup`). Plus Termux `termux-wake-lock` (see below).

## How to type a turn

**Source of truth: `scripts/ci-bench.sh` `send_and_wait`** — type block ~795–858, Send block ~860–921 — plus `type_text` / `tap_editable` / `tap_node` / `message_was_submitted` in `scripts/ci-lib.sh`. Copy or source those helpers. Do not restate the sequence here; it will rot. Do **not** run `ci-bench.sh` itself on this phone (it reinstalls the APK and rewrites prefs).

Do not invent a shorter path. The earlier failures (IME-up Send bounds, leftover concatenation, assuming `input text` landed) are why that routine exists.

## Turn 2+ on this build (2026-08-17, APK `3a3a15f`) — verdict (b)

The project's own routine **also fails at turn 2**. Regression against the harness Fase 4 depended on (16-turn campaigns used this same type+Send path).

Wireless `192.168.1.152:5555`, pid `23042`, no `am start` after launch, keep-awake on.

Turn 1 — routine succeeds:

```
[ci] type attempt 1/3: Ciao
[ci] tap 'Fai una domanda…' at 540,1987
[ci] tap 'Invia' at 963,2115
[ci] submitted: Ciao prev_count=0
[ci] turn 1 replied count=1
08-17 10:39:19.240 23042 23070 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1",...,"interrupted":false}
```

Turn 2 — text **is** in the composer (30 s visibility poll passed; `type_text` + ESC 111 ran). Send tapped three times at the post-ESC bounds. Message never leaves:

```
[ci] type attempt 1/3: Quanto fa due piu due
[ci] tap 'Fai una domanda…' at 540,1987
[ci] Send attempt 1/3: Quanto fa due piu due
[ci] tap 'Invia' at 963,2115
[ci] message still in composer after Send tap (attempt 1)
… attempts 2 and 3 identical …
[ci] FAIL: message never left the composer after 3 send attempts
=== composer after fail ===
Quanto fa due piu due
```

Only one `KALSA_TELEMETRY` line exists (turn 1). `message_was_submitted` never flipped.

Typing lands; submitting does not. Not the IME-bounds bug (ESC 111 already ran).

**Send node at the failed tap** (composer text was `Quanto fa due piu due`):

```
class="android.widget.Button" content-desc="Invia" clickable="true" enabled="true"
  focusable="true" bounds="[909,2061][1017,2169]"
```

Same attributes after the tap. The Android view is **live** (`enabled="true"`). RN sets `accessibilityState.disabled` from `!canSend` (`AiChatPage.tsx:4520`) but does **not** set `disabled=` on the `Pressable`, so the tap is delivered and `onSendOrStop` no-ops on empty `draft` (`:3323-3332`). Not a disabled button swallowing hits.

Do not work around the composer with `am start` *in order to type*. The deep link is a separate delivery path: `am start` does unload the model (see above), but with `kalsa.bench.kvtranscript=1` a subsequent turn recovers via `session_restore` + `delta` (~145 ms load) instead of a re-prefill. If the UI shows `Tocca per ricaricare`, tap it and continue.

## Termux

`termux-wake-lock` / `termux-wake-unlock` via `run-as com.termux` return 0. Use that to hold the CPU when unplugged.

`input` is not in Termux `$PREFIX/bin`. `/system/bin/input` as the Termux uid has no `INJECT_EVENTS` on this user build. Drive `input` through `adb shell` (shell uid). `ANDROID_SERIAL` is enough for `ci-lib.sh`.

## Restore

```bash
adb -s 192.168.1.152:5555 shell \
  "run-as com.termux files/usr/bin/bash -lc 'export PATH=/data/data/com.termux/files/usr/bin:\$PATH; termux-wake-unlock'"
# screen: device_keepawake_restore, or settings delete system screen_off_timeout if it was unset
```
