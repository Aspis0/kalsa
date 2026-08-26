# q64 RUN_LOG

2026-08-26T17:06:32-04:00 START q64; locked PREREG; no git commit/push; BigMoeOnEdge sources untouched; adb reconnect forbidden

2026-08-26T17:06:34-04:00 PUSH runtime files=bmoe-cli,libc++_shared.so,libggml-base.so,libggml-cpu.so,libggml.so,libllama-common.so,libllama.so

2026-08-26T17:06:38-04:00 PUSH device sha256 matches PC for all seven runtime files

2026-08-26T17:07:28-04:00 PUSH model sha256 computed once on device

2026-08-26T17:07:35-04:00 PUSH help rc=0 missing=[]

2026-08-26T17:07:35-04:00 GATE calib1 battery=90 temp_tenths=267 plugged=False required_battery>=40

2026-08-26T17:07:46-04:00 INVOCATION calib1 block=None arm=calib cache=0 n=1 battery_pre=90 temp_pre_tenths=267 MemAvailable_pre_kb=4726484 calibration=True retry=0

2026-08-26T17:09:42-04:00 CALIB accepted count=133; calibration loads=1; numbers discarded

2026-08-26T17:09:42-04:00 GATE b1_a1_0 battery=90 temp_tenths=270 plugged=False required_battery>=40

2026-08-26T17:09:53-04:00 INVOCATION b1_a1_0 block=1 arm=0 cache=0 n=128 battery_pre=90 temp_pre_tenths=270 MemAvailable_pre_kb=5359628 calibration=False retry=0

2026-08-26T17:13:28-04:00 SPACING waiting 39.0s; required=60s

2026-08-26T17:14:08-04:00 GATE b1_a2_1500 battery=89 temp_tenths=279 plugged=False required_battery>=40

2026-08-26T17:14:18-04:00 INVOCATION b1_a2_1500 block=1 arm=1500 cache=1500 n=128 battery_pre=89 temp_pre_tenths=279 MemAvailable_pre_kb=5222360 calibration=False retry=0

2026-08-26T17:18:06-04:00 STOPPED b1_a2_1500: launcher rc=1

finalize_q64 complete

2026-08-26T17:19:58-04:00 RESUME q64 after adapter-only bookkeeping correction; completed tags preserved

2026-08-26T17:19:59-04:00 b1_a1_0 RESUME already recorded; no rerun

2026-08-26T17:19:59-04:00 b1_a2_1500 RESUME already recorded; no rerun

2026-08-26T17:19:59-04:00 GATE b1_a3_2000 battery=89 temp_tenths=278 plugged=False required_battery>=40

2026-08-26T17:20:09-04:00 INVOCATION b1_a3_2000 block=1 arm=2000 cache=2000 n=128 battery_pre=89 temp_pre_tenths=278 MemAvailable_pre_kb=5370224 calibration=False retry=0

2026-08-26T17:23:42-04:00 SPACING waiting 23.9s; required=60s

2026-08-26T17:24:06-04:00 GATE b1_a4_4000 battery=88 temp_tenths=285 plugged=False required_battery>=40

2026-08-26T17:24:16-04:00 INVOCATION b1_a4_4000 block=1 arm=4000 cache=4000 n=128 battery_pre=88 temp_pre_tenths=285 MemAvailable_pre_kb=5348288 calibration=False retry=0

2026-08-26T17:26:25-04:00 SPACING waiting 41.8s; required=60s

2026-08-26T17:27:07-04:00 GATE b1_a5_auto battery=88 temp_tenths=288 plugged=False required_battery>=40

2026-08-26T17:27:13-04:00 INVOCATION b1_a5_auto block=1 arm=auto cache=auto n=128 battery_pre=88 temp_pre_tenths=288 MemAvailable_pre_kb=5319568 calibration=False retry=0

2026-08-26T17:30:15-04:00 SPACING waiting 8.1s; required=60s

2026-08-26T17:30:23-04:00 GATE b2_a1_1500 battery=87 temp_tenths=290 plugged=False required_battery>=40

2026-08-26T17:30:34-04:00 INVOCATION b2_a1_1500 block=2 arm=1500 cache=1500 n=128 battery_pre=87 temp_pre_tenths=290 MemAvailable_pre_kb=5357332 calibration=False retry=0

2026-08-26T17:33:04-04:00 SPACING waiting 41.3s; required=60s

2026-08-26T17:33:46-04:00 GATE b2_a2_2000 battery=87 temp_tenths=294 plugged=False required_battery>=40

2026-08-26T17:33:56-04:00 INVOCATION b2_a2_2000 block=2 arm=2000 cache=2000 n=128 battery_pre=87 temp_pre_tenths=294 MemAvailable_pre_kb=5337340 calibration=False retry=0

2026-08-26T17:35:52-04:00 SPACING waiting 32.1s; required=60s

2026-08-26T17:36:24-04:00 GATE b2_a3_4000 battery=86 temp_tenths=299 plugged=False required_battery>=40

2026-08-26T17:36:34-04:00 INVOCATION b2_a3_4000 block=2 arm=4000 cache=4000 n=128 battery_pre=86 temp_pre_tenths=299 MemAvailable_pre_kb=5370892 calibration=False retry=0

2026-08-26T17:39:24-04:00 SPACING waiting 16.5s; required=60s

2026-08-26T17:39:41-04:00 GATE b2_a4_auto battery=86 temp_tenths=298 plugged=False required_battery>=40

2026-08-26T17:39:51-04:00 INVOCATION b2_a4_auto block=2 arm=auto cache=auto n=128 battery_pre=86 temp_pre_tenths=298 MemAvailable_pre_kb=5198304 calibration=False retry=0

2026-08-26T17:42:38-04:00 SPACING waiting 31.1s; required=60s

2026-08-26T17:43:09-04:00 GATE b2_a5_0 battery=85 temp_tenths=296 plugged=False required_battery>=40

2026-08-26T17:43:20-04:00 INVOCATION b2_a5_0 block=2 arm=0 cache=0 n=128 battery_pre=85 temp_pre_tenths=296 MemAvailable_pre_kb=5255404 calibration=False retry=0

2026-08-26T17:47:26-04:00 SPACING waiting 40.2s; required=60s

2026-08-26T17:48:07-04:00 GATE b3_a1_2000 battery=85 temp_tenths=298 plugged=False required_battery>=40

2026-08-26T17:48:17-04:00 INVOCATION b3_a1_2000 block=3 arm=2000 cache=2000 n=128 battery_pre=85 temp_pre_tenths=298 MemAvailable_pre_kb=5155904 calibration=False retry=0

2026-08-26T17:51:25-04:00 SPACING waiting 40.0s; required=60s

2026-08-26T17:52:06-04:00 GATE b3_a2_4000 battery=84 temp_tenths=298 plugged=False required_battery>=40

2026-08-26T17:52:15-04:00 INVOCATION b3_a2_4000 block=3 arm=4000 cache=4000 n=128 battery_pre=84 temp_pre_tenths=298 MemAvailable_pre_kb=5225148 calibration=False retry=0

2026-08-26T17:55:32-04:00 GATE b3_a3_auto battery=84 temp_tenths=298 plugged=False required_battery>=40

2026-08-26T17:55:42-04:00 INVOCATION b3_a3_auto block=3 arm=auto cache=auto n=128 battery_pre=84 temp_pre_tenths=298 MemAvailable_pre_kb=5298652 calibration=False retry=0

2026-08-26T17:58:14-04:00 SPACING waiting 28.4s; required=60s

2026-08-26T17:58:42-04:00 GATE b3_a4_0 battery=83 temp_tenths=298 plugged=False required_battery>=40

2026-08-26T17:58:53-04:00 INVOCATION b3_a4_0 block=3 arm=0 cache=0 n=128 battery_pre=83 temp_pre_tenths=298 MemAvailable_pre_kb=5292708 calibration=False retry=0

2026-08-26T18:04:06-04:00 GATE b3_a5_1500 battery=83 temp_tenths=299 plugged=False required_battery>=40

2026-08-26T18:04:16-04:00 INVOCATION b3_a5_1500 block=3 arm=1500 cache=1500 n=128 battery_pre=83 temp_pre_tenths=299 MemAvailable_pre_kb=5169168 calibration=False retry=0

2026-08-26T18:07:31-04:00 DONE all scheduled blocks complete

finalize_q64 complete

finalize_q64 complete

finalize_q64 complete

finalize_q64 complete
