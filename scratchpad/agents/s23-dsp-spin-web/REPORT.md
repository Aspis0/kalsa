# Web research: Galaxy S23 `adsprpcd`/`cdsprpcd` spin after "profiling signal"

Date: 2026-09-25. Method: web search + GitHub code/issue search + AOSP/Perfetto source reads.
No device commands were run. Every claim is labeled SOURCED (link) or INFERENCE.

## Executive summary

The log line `received profiling signal with si_value: 1` is **not Qualcomm fastrpc
code**. It is printed by **AOSP bionic libc**'s profiling-signal handler, and
`si_value: 1` identifies the sender as **`traced_perf`** (Perfetto's perf-based CPU
sampler). The chain on the S23 is therefore:

Samsung **`perfmond`** (init service) runs a **Perfetto tracing session** (with
`traced`/`traced_perf`; `traced_perf` starts ~6 min after boot) → `traced_perf`
`sigqueue`s a profiling signal into arbitrary processes system-wide, including
`adsprpcd`/`cdsprpcd` → bionic in the target opens `/proc/self/{maps,mem}` and ships
fds to `traced_perf`. The subsequent 100%-core spin in the daemons has **no public bug
report or fix** that I could find; the most likely known hooks are Samsung's
`debug.perfmond.*` properties, which the `adb shell` user can set (SELinux allows
shell → `debug_prop`).

---

## 1. Public reports of the phenomenon on Samsung Galaxy phones

**Negative result (the load-bearing finding):** I found **no public report** — XDA,
Reddit, Samsung Community, Google Issue Tracker, Qualcomm forums, GitHub — of the exact
phenomenon (`cdsprpcd`/`adsprpcd` pegging a core after "received profiling signal with
si_value"). INFERENCE: this is not a widely-known firmware bug; there is no public
"One UI X fixed it" note to cite. Absence of reports is consistent with it being a
rare interaction between Samsung's internal profiling session and the fastrpc daemons,
rather than a mass-market drain bug.

Closest context found (all real but none name the mechanism):

- Generic One UI drain threads on S23 exist but never name these daemons: Samsung
  Community "S23 battery drain following One UI 7 update"
  https://eu.community.samsung.com/t5/galaxy-s23-series/battery-drain-after-one-ui-6-1-update-s23-ultra/td-p/9608861
  (One UI 6.1 S23 Ultra, 85+ replies, generic advice: cache wipe, wait for patch);
  r/oneui One UI 6.1 heat/drain https://www.reddit.com/r/oneui/comments/1c19qxw/one_ui_61_hot_battery_and_battery_draining .
- `cdsprpcd` appears as a top battery consumer on a **Xiaomi** device (r/Xiaomi thread,
  GSam stats listing `cdsprpcd` among top drainers):
  https://www.reddit.com/r/Xiaomi/ (thread "Something in the kernel is draining all my
  juice", surfaced in Arabic/Indonesian mirrors) — SOURCED that the daemon can show as a
  top drainer elsewhere; no Samsung thread naming it found.
- A GitHub issue (mnn-llm #239, Dec 2024) shows the exact log line appearing in an
  **unrelated Android app** crash log: `libc: sh: received profiling signal with
  si_value : 1` — https://github.com/wangzhaode/mnn-llm/issues/239 — SOURCED. This
  corroborates that the `traced_perf` profiling signal is delivered into arbitrary
  user processes system-wide on some devices, without root and without the user asking
  for profiling.
- Google Issue Tracker (Buganizer) is not search-engine indexed; my queries
  ("traced_perf"/"heapprofd" + samsung + drain/spin) returned nothing — INFERENCE: no
  public issue found, not proof of absence.

## 2. Samsung `perfmond`, `debug.perfmond.*`, and no-root mitigation options

What perfmond is (SOURCED, from Samsung firmware dumps and ROM trees):

- `perfmond.rc` (Galaxy A53 dump): `service perfmond /system/bin/perfmond`, `class
  core`, `user system`, `group root readproc`, `critical`, two seqpacket sockets
  (`perfmond`, `perfmon_send`); an init trigger `on property:debug.perfmond.atrace=*`
  execs `/system/bin/init.perfmond_atrace.sh`.
  https://github.com/SelynCatto/samsung_a53x_dump (file `system/system/etc/init/perfmond.rc`).
  Note `critical`: init auto-restarts the service if it dies (and AOSP init reboots the
  device if a critical service crashes repeatedly — SOURCED flag, INFERENCE on the
  reboot consequence).
- SELinux in the same dump grants perfmond the right to **execute the perfetto
  binary**: `(allow perfmond perfetto_exec (file (ioctl read getattr lock map execute
  open watch watch_reads execute_no_trans)))` — `system_ext_sepolicy.cil`
  https://github.com/SelynCatto/samsung_a53x_dump (system_ext SELinux). This matches
  Marco's `perfetto --query` observation of a live session owned by a system UID.
- `debug.perfmond.default.perfetto = 1` is present on other Samsung devices/firmwares:
  Galaxy A55 (One UI 7.0/Android 15) and Galaxy Z Fold7 (One UI 8.0/Android 16) getprop
  dumps in https://github.com/getActivity/AndroidSystemPropertyCollect ; S24 FE runtime
  getprop dump https://github.com/ain0203root/root (file
  `root/RMG_S24FE_RUNTIME/getprop.txt`). Same repo shows `init.svc.perfmond = running`
  across One UI 2.5 (S9) → 8.0 (Z Fold7), incl. S24 (One UI 6.1).
- Snapdragon 8 Gen 2 (S23-family) device trees also touch the namespace:
  `setprop debug.perfmond.atrace.buffer 16384` in
  https://github.com/LineageOS/android_device_samsung_sm8550-common (`init/init.samsung.rc`),
  also `dmXq-development/android_device_samsung_sm8550-common`, `chaptsand/...` — SOURCED.
- A `debug.perfmond.user_trial.enable` trigger exists in `ssrm.rc` on A5x/A1x dumps
  (e.g. https://github.com/RandomPush/samsung_a54x_dump) — SOURCED; INFERENCE: Samsung
  runs perfmond profiling as an internal "trial" mechanism, which fits a session that
  appears tens of minutes after boot.

Can the adb `shell` user set `debug.perfmond.*`?

- SOURCED: Samsung ships stock AOSP contexts for the namespace — dump
  `plat_property_contexts` contains `debug.  u:object_r:debug_prop:s0`
  (https://github.com/SelynCatto/samsung_a53x_dump), identical to AOSP main
  (https://android.googlesource.com/platform/system/sepolicy/+/refs/heads/main/private/property_contexts,
  lines: `debug. u:object_r:debug_prop:s0`, `debug.db. u:object_r:debuggerd_prop:s0`).
  No Samsung-specific override for `debug.perfmond.` was found in the dumps' property
  contexts (grep returned nothing).
- SOURCED: AOSP grants the shell domain `set_prop(shell, debug_prop)`
  (e.g. https://github.com/GrapheneOS/platform_system_sepolicy/blob/main/private/shell.te;
  same line in SubstratumResources/OmniROM mirrors of `system/sepolicy`).
- INFERENCE: therefore `adb shell setprop debug.perfmond.default.perfetto 0` should be
  **accepted by SELinux** on a stock, non-rooted S23. Whether it *stops* the spin is
  unverified: `perfmond.rc` has no init trigger on `debug.perfmond.default.perfetto`,
  so the daemon binary itself must read it (at start, or periodically — unknown).
  Caveats: `debug.*` properties reset on reboot (no `persist.debug.perfmond.*` context
  found in the dumps), and on a user build the shell user generally cannot
  `ctl.stop`/restart arbitrary init services (`stop perfmond` likely fails) — INFERENCE.
  So the realistic no-root experiment is: set the prop to 0 and watch whether the
  in-flight session stops; if the prop is only read at daemon start, the mitigation
  must be re-applied after every boot (e.g. from Marco's harness) since the value
  cannot be persisted without root.

Other no-root options:

- `pm disable-user`: **not applicable** — SOURCED that perfmond is a native init
  service (`/system/bin/perfmond`), not an APK; no package named
  `com.samsung.android.perfmond` exists in the dumps (package-name searches returned
  nothing; the "disable via pm" suggestions in some search summaries are hallucinated
  package names — treat them as wrong). INFERENCE: there is no debloatable APK owning
  this behavior; the only APK-side lever would be whatever app UI sets
  `debug.perfmond.user_trial.enable` (none found publicly).
- Stopping the Perfetto session as shell: `perfetto --query` works unprivileged, but
  detaching/terminating another UID's session is not permitted to shell on a user
  build — INFERENCE (consistent with Perfetto's permission model; not separately
  sourced). `adb shell perfetto --detach` only applies to sessions you started.
- Developer options: no public developer option or settings toggle is documented to
  gate perfmond — negative result, SOURCED-by-search-absence.

## 3. Is the "profiling signal" handling a known fastrpc bug?

Short answer: the string does not come from fastrpc at all.

- SOURCED: bionic installs a handler for `BIONIC_SIGNAL_PROFILER` in
  `bionic/libc/bionic/android_profiling_dynamic.cpp`
  (https://android.googlesource.com/platform/bionic/+/refs/heads/main/libc/bionic/android_profiling_dynamic.cpp):
  - `static constexpr int kHeapprofdSignalValue = 0;`
    `static constexpr int kTracedPerfSignalValue = 1;`
  - `async_safe_format_log(ANDROID_LOG_INFO, "libc", "%s: received profiling signal
    with si_value: %d", getprogname(), signal_value);`
  - `si_value == 1` dispatches to `HandleTracedPerfSignal()`, which synchronously
    opens `/proc/self/maps` and `/proc/self/mem` and sends the fds over the
    `/dev/socket/traced_perf` Unix socket (with a temporary seccomp/SIGSYS override
    wrapper).
- SOURCED: the sender side is Perfetto's `traced_perf`:
  `src/profiling/perf/proc_descriptors.cc`:
  `constexpr static int kPerfProfilerSignalValue = 1;`
  `constexpr static int kProfilerSignal = __SIGRTMIN + 4;`
  `sigqueue(pid, kProfilerSignal, signal_value)`
  https://github.com/google/perfetto/blob/main/src/profiling/perf/proc_descriptors.cc
  (`sigqueue` ⇒ `si_code == SI_QUEUE`, which matches bionic's queued-signal check).
- SOURCED (absence): no public fastrpc code matches these strings — searches of
  https://github.com/qualcomm/fastrpc and CodeLinaro mirrors for "profiling signal" /
  `si_value` in the fastrpc daemon (`adsprpcd`/`cdsprpcd`) found nothing; the only
  indexed hits for the log string are bionic mirrors/quotes (e.g. the mnn-llm issue
  above, a cnblogs heapprofd article). So there is **no known Qualcomm bug** of a
  "busy loop after profiling signal" in public fastrpc sources.
- INFERENCE (mechanism, needs on-device confirmation): the spin starts only after
  `traced_perf` signals the daemons, so the causal chain runs through the bionic
  handshake and/or `traced_perf`'s unwinding of these processes. Plausible candidates:
  (a) the synchronous fd handshake inside a multithreaded, polling daemon misbehaves
  (e.g. a thread interrupted in a syscall loop), or (b) the daemons re-enter the
  handler repeatedly during the long-lived session, or (c) the spin is the daemons'
  own event loop degraded by `ptrace`-less `/proc/self/mem` reading. None of these is
  documented anywhere I could find. On-device discriminators (for a later session, not
  done here): compare `perfetto --query` config on a bad boot vs after
  `setprop debug.perfmond.default.perfetto 0`; check whether the daemons sit in the
  bionic handshake (many short socket ops) or in their own poll loop.

## Source list

- bionic profiling handler: https://android.googlesource.com/platform/bionic/+/refs/heads/main/libc/bionic/android_profiling_dynamic.cpp
- perfetto traced_perf sender: https://github.com/google/perfetto/blob/main/src/profiling/perf/proc_descriptors.cc
- perfmond.rc + SELinux (A53 dump): https://github.com/SelynCatto/samsung_a53x_dump
- `debug.perfmond.default.perfetto=1` dumps: https://github.com/getActivity/AndroidSystemPropertyCollect , https://github.com/ain0203root/root
- sm8550-common atrace buffer prop: https://github.com/LineageOS/android_device_samsung_sm8550-common
- AOSP property_contexts (`debug.` → debug_prop): https://android.googlesource.com/platform/system/sepolicy/+/refs/heads/main/private/property_contexts
- AOSP shell grant (`set_prop(shell, debug_prop)`): https://github.com/GrapheneOS/platform_system_sepolicy/blob/main/private/shell.te
- qualcomm/fastrpc (no matching handler found): https://github.com/qualcomm/fastrpc
- Corroborating signal-in-arbitrary-process log: https://github.com/wangzhaode/mnn-llm/issues/239
- Generic S23 drain threads (no daemon names): https://eu.community.samsung.com/t5/galaxy-s23-series/battery-drain-after-one-ui-6-1-update-s23-ultra/td-p/9608861 , https://www.reddit.com/r/oneui/comments/1c19qxw/one_ui_61_hot_battery_and_battery_draining
