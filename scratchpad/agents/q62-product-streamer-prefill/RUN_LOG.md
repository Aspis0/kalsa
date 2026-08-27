# q62 RUN_LOG

2026-08-26T12:50:41-04:00 q62 execution start; owner GO received 2026-08-26; serial fixed to Xiaomi only

2026-08-26T12:50:41-04:00 PREP begin; no git operation; BigMoeOnEdge sources untouched

2026-08-26T12:50:43-04:00 runtime PC archive files=DEVICE.sha256,MANIFEST.md,bmoe-cli,libc++_shared.so,libggml-base.so,libggml-cpu.so,libggml.so,libllama-common.so,libllama.so

2026-08-26T12:50:46-04:00 runtime, guard, and sampler pushed; device LF checks passed

2026-08-26T12:50:46-04:00 device runtime sha256 verified for bmoe-cli and all six .so files

2026-08-26T12:50:46-04:00 model size verified bytes=13416430592

2026-08-26T12:51:01-04:00 model sha256 verified once on device sha256=ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a

2026-08-26T12:51:01-04:00 bmoe-cli --help rc=0 required_flags_missing=[]

2026-08-26T12:51:01-04:00 cold protocol: model hash complete; entering 600-second no-touch idle

2026-08-26T13:01:02-04:00 initial gate battery=54 temp_tenths=279 AC=False USB=False

2026-08-26T13:01:02-04:00 READY_UNPLUG level=54 temp_C=27.9

2026-08-26T13:01:02-04:00 unplug declared observed level=54 temp_tenths=279

2026-08-26T13:01:02-04:00 gates complete unplugged=True deviation=none

2026-08-26T13:01:12-04:00 RUN primary cache_mb=0 prompt=512 reps=3 battery_pre=54 temp_pre_tenths=279 MemAvailable_pre_kb=4949288 allow_plugged=False

2026-08-26T13:01:12-04:00 primary drop_caches rc=1; output= /system/bin/sh: can't create /proc/sys/vm/drop_caches: Permission denied

2026-08-26T13:01:27-04:00 primary launcher completed process_rc=1 binary_pid=13818 sampler_pid=13868

2026-08-26T13:01:37-04:00 primary load failure rc=1; retrying once with identical frozen flags

2026-08-26T13:01:46-04:00 RUN primary_retry1 cache_mb=0 prompt=512 reps=3 battery_pre=54 temp_pre_tenths=279 MemAvailable_pre_kb=4920768 allow_plugged=False

2026-08-26T13:02:01-04:00 primary_retry1 launcher completed process_rc=1 binary_pid=15144 sampler_pid=15191

2026-08-26T13:02:12-04:00 STOPPED primary: launcher rc=1

2026-08-26T13:06:30-04:00 correction: stderr shows the rc=1 cause was pre-load argument rejection `unknown arg: -r`, not a model load failure; the harness's broad rc=1 classifier triggered the single retry, which was retained and also rejected. No measured arm data exists.

2026-08-26T13:06:30-04:00 cpuset gate: primary sampler actual bmoe-cli row cpuset=/ Cpus_allowed_list=0-7 MemAvailable_kb=4925208; retry sampler actual bmoe-cli row cpuset=/ Cpus_allowed_list=0-7 MemAvailable_kb=4892336; gate pass; no exit-code-93 condition.

2026-08-26T13:06:30-04:00 arm outcomes: primary and primary_retry1 guard_rc=0 workload_rc=1 launcher_rc=1; guard logs reached MAX; no exact crash marker; no residual bmoe-cli/guard/sampler process after completion.

2026-08-26T13:22:07-04:00 Attempt 2 start; Amendment 1; owner hurry; serial fixed to Xiaomi only

2026-08-26T13:22:07-04:00 existing device check: bmoe-cli ls/sha passed; verified runtime/model/guard not redone

2026-08-26T13:22:08-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_pp512.txt sha256=2be11eee6db849cedf6e7a4848a824ae241a6d846ca71b5cc76d1ac97386a0a7 bytes=2073

2026-08-26T13:22:08-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=2072 p_arg_preview=Reliable systems are built from small observations that can be checked, repeated, and explained.  When a device is tested, its surroundings matter. Battery level, temperature, available memory,   Good measurements separate observation from interpretation. The observer should keep the origina  Fresh processes are valuable when cache state, allocation history, or scheduler state might infl  Streaming workloads add another layer of detail. Data may arrive in pieces while computation pro

2026-08-26T13:22:09-04:00 GATE attempt2_calib level=53 temp_tenths=270 plugged=False required_battery>=45

2026-08-26T13:22:09-04:00 deviation: drop_caches was denied in Attempt 1; not retried per owner instruction

2026-08-26T13:22:21-04:00 INVOCATION calib1 cache_mb=0 prompt_file=q62_pp512.txt decode_n=1 battery_pre=53 temp_pre_tenths=270 MemAvailable_pre_kb=4298376 allow_plugged=False

2026-08-26T13:23:29-04:00 calib1 launcher completed process_rc=0 binary_pid=19458 sampler_pid=19498

2026-08-26T13:23:41-04:00 CALIB calib1 prompt_tokens=None source=no engine prompt-token count found; numbers discarded

2026-08-26T13:23:41-04:00 STOPPED exception=RuntimeError: calib1: engine prompt-token count unavailable

2026-08-26T13:25:16-04:00 Attempt 2 start; Amendment 1; owner hurry; serial fixed to Xiaomi only

2026-08-26T13:25:16-04:00 existing device check: bmoe-cli ls/sha passed; verified runtime/model/guard not redone

2026-08-26T13:25:17-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_pp512.txt sha256=e317c35f39aea519f476be6a75c6a77fff175ea23ae02da451d0ac22daebef4e bytes=2047

2026-08-26T13:25:17-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=2046 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  This keeps the test plain, short, and fit for a fair check.

2026-08-26T13:25:17-04:00 GATE attempt2_calib level=52 temp_tenths=282 plugged=False required_battery>=45

2026-08-26T13:25:17-04:00 deviation: drop_caches was denied in Attempt 1; not retried per owner instruction

2026-08-26T13:25:22-04:00 INVOCATION calib1 cache_mb=0 prompt_file=q62_pp512.txt decode_n=1 battery_pre=52 temp_pre_tenths=282 MemAvailable_pre_kb=6330240 allow_plugged=False

2026-08-26T13:25:24-04:00 calib1 launcher completed process_rc=1 binary_pid=19458 sampler_pid=24567

2026-08-26T13:25:28-04:00 STOPPED exception=RuntimeError: calib1: launcher rc=1

2026-08-26T13:25:43-04:00 Attempt 2 start; Amendment 1; owner hurry; serial fixed to Xiaomi only

2026-08-26T13:25:43-04:00 existing device check: bmoe-cli ls/sha passed; verified runtime/model/guard not redone

2026-08-26T13:25:43-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_pp512.txt sha256=e317c35f39aea519f476be6a75c6a77fff175ea23ae02da451d0ac22daebef4e bytes=2047

2026-08-26T13:25:43-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=2046 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  This keeps the test plain, short, and fit for a fair check.

2026-08-26T13:25:44-04:00 GATE attempt2_calib level=52 temp_tenths=282 plugged=False required_battery>=45

2026-08-26T13:25:44-04:00 deviation: drop_caches was denied in Attempt 1; not retried per owner instruction

2026-08-26T13:25:46-04:00 INVOCATION calib2 cache_mb=0 prompt_file=q62_pp512.txt decode_n=1 battery_pre=52 temp_pre_tenths=282 MemAvailable_pre_kb=6336244 allow_plugged=False

2026-08-26T13:26:12-04:00 calib2 launcher completed process_rc=1 binary_pid=25615 sampler_pid=25680

2026-08-26T13:26:24-04:00 STOPPED exception=RuntimeError: calib2: launcher rc=1

2026-08-26T13:27:00-04:00 CALIB correction: calib1 engine field was CSV summary n_prompt=360; calibration result is discarded and outside 480..544.

2026-08-26T13:27:00-04:00 CALIB 2 engine stderr: prompt + n_predict exceeds the session n_ctx (512); no prompt-token count emitted; no measurement started.

2026-08-26T13:27:00-04:00 STOPPED Attempt 2: calibration cap exhausted without an accepted 480..544 engine prompt-token count; n0 probe, primary, secondary, and optional p2048 not run.

2026-08-26T13:29:45-04:00 Attempt 2 start; Amendment 1; owner hurry; serial fixed to Xiaomi only

2026-08-26T13:29:45-04:00 existing device check: bmoe-cli ls/sha passed; verified runtime/model/guard not redone

2026-08-26T13:29:46-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_pp512.txt sha256=57b73e41eb26bef794de4c522cedb7e3702b4b97ca6e6292137ee3a5b8e5c948 bytes=1892

2026-08-26T13:29:46-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=1891 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam

2026-08-26T13:29:46-04:00 GATE attempt2_calib level=52 temp_tenths=279 plugged=False required_battery>=45

2026-08-26T13:29:46-04:00 deviation: drop_caches was denied in Attempt 1; not retried per owner instruction

2026-08-26T13:29:46-04:00 owner-directed resume: calibration cap already used; trimmed prompt before n0 probe; primary only

2026-08-26T13:30:00-04:00 INVOCATION n0_probe cache_mb=0 prompt_file=q62_pp512.txt decode_n=0 battery_pre=52 temp_pre_tenths=279 MemAvailable_pre_kb=6729252 allow_plugged=False

2026-08-26T13:30:15-04:00 n0_probe launcher completed process_rc=1 binary_pid=28206 sampler_pid=28252

2026-08-26T13:30:26-04:00 n0 probe fallback: reason=launcher rc=1; using n=1 and excluding single decode row

2026-08-26T13:30:26-04:00 GATE primary_inv1 level=52 temp_tenths=279 plugged=False required_battery>=45

2026-08-26T13:30:37-04:00 INVOCATION primary_inv1 cache_mb=0 prompt_file=q62_pp512.txt decode_n=1 battery_pre=52 temp_pre_tenths=279 MemAvailable_pre_kb=6376072 allow_plugged=False

2026-08-26T13:31:45-04:00 primary_inv1 launcher completed process_rc=0 binary_pid=30014 sampler_pid=30052

2026-08-26T13:31:58-04:00 COOLDOWN primary_inv1_to_inv2 begin; required gap=60s

2026-08-26T13:32:58-04:00 COOLDOWN primary_inv1_to_inv2 complete

2026-08-26T13:32:58-04:00 GATE primary_inv2 level=51 temp_tenths=289 plugged=False required_battery>=45

2026-08-26T13:33:10-04:00 INVOCATION primary_inv2 cache_mb=0 prompt_file=q62_pp512.txt decode_n=1 battery_pre=51 temp_pre_tenths=289 MemAvailable_pre_kb=6787288 allow_plugged=False

2026-08-26T13:34:14-04:00 primary_inv2 launcher completed process_rc=0 binary_pid=1779 sampler_pid=1894

2026-08-26T13:34:27-04:00 COOLDOWN primary_inv2_to_inv3 begin; required gap=60s

2026-08-26T13:35:27-04:00 COOLDOWN primary_inv2_to_inv3 complete

2026-08-26T13:35:27-04:00 GATE primary_inv3 level=51 temp_tenths=304 plugged=False required_battery>=45

2026-08-26T13:35:39-04:00 INVOCATION primary_inv3 cache_mb=0 prompt_file=q62_pp512.txt decode_n=1 battery_pre=51 temp_pre_tenths=304 MemAvailable_pre_kb=6714820 allow_plugged=False

2026-08-26T13:36:37-04:00 primary_inv3 launcher completed process_rc=0 binary_pid=9196 sampler_pid=9222

2026-08-26T13:36:50-04:00 primary arm complete: 3 separate invocations

2026-08-26T13:36:50-04:00 SECONDARY and optional p2048 not run; owner directed separate session

2026-08-26T13:36:50-04:00 DONE_PRIMARY primary complete; finalize_q62.py remains deterministic post-processing

2026-08-26T13:38:00-04:00 primary prompt token count recorded from each invocation CSV summary n_prompt=486; accepted effective window 480..511; n=1 decode row excluded.

2026-08-26T13:38:00-04:00 phase-0 report source: io-trace rows phase=0 provide read_bytes and per-read latency; CSV summary provides prefill_s; shipped CSV/progress emit no phase-0 aggregate io_ms/compute_ms/mgmt_ms/cpu_ms/majflt.

2026-08-26T13:38:00-04:00 finalization: primary invocations=3; secondary=0; optional p2048=0; no exact crash marker; guard max temperatures and cpuset cross-check retained per invocation.

2026-08-26T13:39:00-04:00 GATE primary_inv1 post level=52 temp_tenths=287 MemAvailable_post_kb=6831116 unplugged=True rc=0 guard_rc=0 guard_max_temp_tenths=287 cpuset=0-7.

2026-08-26T13:39:00-04:00 GATE primary_inv2 post level=51 temp_tenths=292 MemAvailable_post_kb=6810936 unplugged=True rc=0 guard_rc=0 guard_max_temp_tenths=292 cpuset=0-7.

2026-08-26T13:39:00-04:00 GATE primary_inv3 post level=50 temp_tenths=312 MemAvailable_post_kb=6892484 unplugged=True rc=0 guard_rc=0 guard_max_temp_tenths=312 cpuset=0-7.

2026-08-26T13:45:00-04:00 PC-only re-derivation; no device run. Corrected phase-0 source to raw iotrace phase=0 PREFILL rows=19542 per invocation; phase=1 single decode rows excluded. Computed sum latency, four lane sums, and sum over layers of per-layer max lane latency as point I/O wall under overlap=0; no eval_MB_s=read_mb/wall identity used.

2026-08-26T13:45:00-04:00 PC-only phase-0 result: shipped BMOE_PROGRESS/CSV expose io_ms/compute_ms/mgmt_ms/cpu_ms/majflt only for the one decode step, not PREFILL; these fields remain NA. Derived compute_wall=wall-point_io_wall and shares/headroom from the frozen formulas only.

2026-08-26T13:45:00-04:00 PC-only read cross-check: PREFILL trace read_bytes reconciled in MiB and decimal MB; engine read_mb field=351.160 matches decode read_bytes/1048576=351.156250 MiB (rounded), while decode read_bytes/1000000=368.214 decimal MB. Effective PREFILL rates use trace bytes/point_io_wall.

2026-08-26T13:45:00-04:00 sampler cross-check failure retained: sampler_cpu_s=0.020 over 40 rows followed shell wrapper rather than binary_pid; no sampler CPU share derived. cpuset evidence from binary_pid/guard remains authoritative. STATUS set DONE_PRIMARY_REDERIVED.

2026-08-26T13:50:00-04:00 AUDIT_MATH applied PC-only; numbers unchanged. Added B-M1 max-lane-per-layer caveat (no timestamps; step=485; PREFILL model PLAUSIBLE NOT VERIFIED; decode io_ms=334.4 vs trace max-lane 328.3 ms, 1.9%, serialized Σlat=1275 ms refuted), A-N1 wrapper-pid provenance, A-N2 effective 480–511 window with n=1, C-margin inv2 upper io share=0.477, D-N1 +4096 B/read in 19161/19542 reads (+1.05%), G-trend, and PREREG settling line.

2026-08-26T13:50:00-04:00 audit status: DONE_PRIMARY_AUDITED; no device runs and no numeric changes.

2026-08-26T23:42:17-04:00 Secondary follow-up start; Amendment 1; owner GO; primary records preserved

2026-08-26T23:42:18-04:00 existing device check: bmoe-cli ls/sha passed; verified runtime/model/guard not redone

2026-08-26T23:42:18-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_pp512.txt sha256=57b73e41eb26bef794de4c522cedb7e3702b4b97ca6e6292137ee3a5b8e5c948 bytes=1892

2026-08-26T23:42:18-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=1891 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam

2026-08-26T23:42:18-04:00 secondary uses existing decode fallback n=1; no n0 probe repeated

2026-08-26T23:42:19-04:00 GATE secondary_inv1 level=68 temp_tenths=349 plugged=False required_battery>=40

2026-08-26T23:42:19-04:00 WAIT_TEMP secondary_inv1 temp_tenths=349; waiting 30s

2026-08-26T23:42:49-04:00 GATE secondary_inv1 level=68 temp_tenths=349 plugged=False required_battery>=40

2026-08-26T23:42:49-04:00 WAIT_TEMP secondary_inv1 temp_tenths=349; waiting 30s

2026-08-26T23:43:19-04:00 GATE secondary_inv1 level=68 temp_tenths=349 plugged=False required_battery>=40

2026-08-26T23:43:19-04:00 WAIT_TEMP secondary_inv1 temp_tenths=349; waiting 30s

2026-08-26T23:43:49-04:00 GATE secondary_inv1 level=68 temp_tenths=349 plugged=False required_battery>=40

2026-08-26T23:43:49-04:00 WAIT_TEMP secondary_inv1 temp_tenths=349; waiting 30s

2026-08-26T23:44:19-04:00 GATE secondary_inv1 level=68 temp_tenths=339 plugged=False required_battery>=40

2026-08-26T23:44:19-04:00 WAIT_TEMP secondary_inv1 temp_tenths=339; waiting 30s

2026-08-26T23:44:49-04:00 GATE secondary_inv1 level=68 temp_tenths=339 plugged=False required_battery>=40

2026-08-26T23:44:49-04:00 WAIT_TEMP secondary_inv1 temp_tenths=339; waiting 30s

2026-08-26T23:45:20-04:00 GATE secondary_inv1 level=68 temp_tenths=339 plugged=False required_battery>=40

2026-08-26T23:45:20-04:00 WAIT_TEMP secondary_inv1 temp_tenths=339; waiting 30s

2026-08-26T23:45:50-04:00 GATE secondary_inv1 level=68 temp_tenths=339 plugged=False required_battery>=40

2026-08-26T23:45:50-04:00 WAIT_TEMP secondary_inv1 temp_tenths=339; waiting 30s

2026-08-26T23:46:20-04:00 GATE secondary_inv1 level=68 temp_tenths=329 plugged=False required_battery>=40

2026-08-26T23:46:20-04:00 WAIT_TEMP secondary_inv1 temp_tenths=329; waiting 30s

2026-08-26T23:46:50-04:00 GATE secondary_inv1 level=67 temp_tenths=326 plugged=False required_battery>=40

2026-08-26T23:46:50-04:00 WAIT_TEMP secondary_inv1 temp_tenths=326; waiting 30s

2026-08-26T23:47:20-04:00 GATE secondary_inv1 level=67 temp_tenths=326 plugged=False required_battery>=40

2026-08-26T23:47:20-04:00 WAIT_TEMP secondary_inv1 temp_tenths=326; waiting 30s

2026-08-26T23:47:51-04:00 GATE secondary_inv1 level=67 temp_tenths=322 plugged=False required_battery>=40

2026-08-26T23:47:51-04:00 WAIT_TEMP secondary_inv1 temp_tenths=322; waiting 30s

2026-08-26T23:48:21-04:00 GATE secondary_inv1 level=67 temp_tenths=319 plugged=False required_battery>=40

2026-08-26T23:48:31-04:00 INVOCATION secondary_inv1 cache_mb=2000 prompt_file=q62_pp512.txt decode_n=1 battery_pre=67 temp_pre_tenths=319 MemAvailable_pre_kb=4380080 allow_plugged=False

2026-08-26T23:49:28-04:00 secondary_inv1 launcher completed process_rc=0 binary_pid=15709 sampler_pid=15734

2026-08-26T23:49:39-04:00 COOLDOWN secondary_inv1_to_inv2 begin; required gap=60s

2026-08-26T23:50:39-04:00 COOLDOWN secondary_inv1_to_inv2 complete

2026-08-26T23:50:39-04:00 GATE secondary_inv2 level=67 temp_tenths=329 plugged=False required_battery>=40

2026-08-26T23:50:39-04:00 WAIT_TEMP secondary_inv2 temp_tenths=329; waiting 30s

2026-08-26T23:51:09-04:00 GATE secondary_inv2 level=67 temp_tenths=329 plugged=False required_battery>=40

2026-08-26T23:51:09-04:00 WAIT_TEMP secondary_inv2 temp_tenths=329; waiting 30s

2026-08-26T23:51:40-04:00 GATE secondary_inv2 level=67 temp_tenths=319 plugged=False required_battery>=40

2026-08-26T23:51:50-04:00 INVOCATION secondary_inv2 cache_mb=2000 prompt_file=q62_pp512.txt decode_n=1 battery_pre=67 temp_pre_tenths=319 MemAvailable_pre_kb=6587120 allow_plugged=False

2026-08-26T23:52:44-04:00 secondary_inv2 launcher completed process_rc=0 binary_pid=20421 sampler_pid=20455

2026-08-26T23:52:55-04:00 COOLDOWN secondary_inv2_to_inv3 begin; required gap=60s

2026-08-26T23:53:55-04:00 COOLDOWN secondary_inv2_to_inv3 complete

2026-08-26T23:53:56-04:00 GATE secondary_inv3 level=66 temp_tenths=322 plugged=False required_battery>=40

2026-08-26T23:53:56-04:00 WAIT_TEMP secondary_inv3 temp_tenths=322; waiting 30s

2026-08-26T23:54:26-04:00 GATE secondary_inv3 level=66 temp_tenths=319 plugged=False required_battery>=40

2026-08-26T23:54:36-04:00 INVOCATION secondary_inv3 cache_mb=2000 prompt_file=q62_pp512.txt decode_n=1 battery_pre=66 temp_pre_tenths=319 MemAvailable_pre_kb=6820500 allow_plugged=False

2026-08-26T23:55:32-04:00 secondary_inv3 launcher completed process_rc=0 binary_pid=23575 sampler_pid=23617

2026-08-26T23:55:43-04:00 secondary arm complete: 3 separate invocations; cache_mb=2000

2026-08-26T23:55:43-04:00 optional prompt candidate created path=q62_p2048.txt bytes=7572; calibration target <=2047 tokens with n=1,n_ctx=2048

2026-08-26T23:55:44-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_p2048.txt sha256=08145d6aa1e537800c6aa6ef655019026eaef3372cef21c79ab2984651fe3f88 bytes=7572

2026-08-26T23:55:44-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=7570 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam

2026-08-26T23:55:45-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_p2048.txt sha256=08145d6aa1e537800c6aa6ef655019026eaef3372cef21c79ab2984651fe3f88 bytes=7572

2026-08-26T23:55:45-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=7570 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam

2026-08-26T23:55:45-04:00 GATE optional_p2048_calib1 level=65 temp_tenths=331 plugged=False required_battery>=40

2026-08-26T23:55:45-04:00 WAIT_TEMP optional_p2048_calib1 temp_tenths=331; waiting 30s

2026-08-26T23:56:15-04:00 GATE optional_p2048_calib1 level=65 temp_tenths=329 plugged=False required_battery>=40

2026-08-26T23:56:15-04:00 WAIT_TEMP optional_p2048_calib1 temp_tenths=329; waiting 30s

2026-08-26T23:56:45-04:00 GATE optional_p2048_calib1 level=65 temp_tenths=329 plugged=False required_battery>=40

2026-08-26T23:56:45-04:00 WAIT_TEMP optional_p2048_calib1 temp_tenths=329; waiting 30s

2026-08-26T23:57:15-04:00 GATE optional_p2048_calib1 level=65 temp_tenths=329 plugged=False required_battery>=40

2026-08-26T23:57:15-04:00 WAIT_TEMP optional_p2048_calib1 temp_tenths=329; waiting 30s

2026-08-26T23:57:46-04:00 GATE optional_p2048_calib1 level=65 temp_tenths=323 plugged=False required_battery>=40

2026-08-26T23:57:46-04:00 WAIT_TEMP optional_p2048_calib1 temp_tenths=323; waiting 30s

2026-08-26T23:58:16-04:00 GATE optional_p2048_calib1 level=65 temp_tenths=323 plugged=False required_battery>=40

2026-08-26T23:58:16-04:00 WAIT_TEMP optional_p2048_calib1 temp_tenths=323; waiting 30s

2026-08-26T23:58:46-04:00 GATE optional_p2048_calib1 level=65 temp_tenths=319 plugged=False required_battery>=40

2026-08-26T23:58:56-04:00 INVOCATION optional_p2048_calib1 cache_mb=0 prompt_file=q62_p2048.txt decode_n=1 battery_pre=65 temp_pre_tenths=319 MemAvailable_pre_kb=6796464 allow_plugged=False

2026-08-27T00:01:41-04:00 optional_p2048_calib1 launcher completed process_rc=0 binary_pid=27214 sampler_pid=27251

2026-08-27T00:01:52-04:00 CALIB optional_p2048_calib1 prompt_tokens=1947 source=CSV summary n_prompt field; numbers discarded

2026-08-27T00:01:52-04:00 optional prompt adjusted after engine_count=1947; bytes=7973

2026-08-27T00:01:53-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_p2048.txt sha256=66271b4753fcaec9f289898ab8c9b1562627b225931fd857f17b6ba0c188975d bytes=7973

2026-08-27T00:01:53-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=7972 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at

2026-08-27T00:01:53-04:00 GATE optional_p2048_calib2 level=64 temp_tenths=350 plugged=False required_battery>=40

2026-08-27T00:01:53-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=350; waiting 30s

2026-08-27T00:02:23-04:00 GATE optional_p2048_calib2 level=64 temp_tenths=350 plugged=False required_battery>=40

2026-08-27T00:02:23-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=350; waiting 30s

2026-08-27T00:02:53-04:00 GATE optional_p2048_calib2 level=64 temp_tenths=349 plugged=False required_battery>=40

2026-08-27T00:02:53-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=349; waiting 30s

2026-08-27T00:03:24-04:00 GATE optional_p2048_calib2 level=64 temp_tenths=349 plugged=False required_battery>=40

2026-08-27T00:03:24-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=349; waiting 30s

2026-08-27T00:03:54-04:00 GATE optional_p2048_calib2 level=64 temp_tenths=349 plugged=False required_battery>=40

2026-08-27T00:03:54-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=349; waiting 30s

2026-08-27T00:04:24-04:00 GATE optional_p2048_calib2 level=64 temp_tenths=339 plugged=False required_battery>=40

2026-08-27T00:04:24-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=339; waiting 30s

2026-08-27T00:04:54-04:00 GATE optional_p2048_calib2 level=64 temp_tenths=336 plugged=False required_battery>=40

2026-08-27T00:04:54-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=336; waiting 30s

2026-08-27T00:05:24-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=336 plugged=False required_battery>=40

2026-08-27T00:05:24-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=336; waiting 30s

2026-08-27T00:05:54-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=336 plugged=False required_battery>=40

2026-08-27T00:05:54-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=336; waiting 30s

2026-08-27T00:06:25-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=336 plugged=False required_battery>=40

2026-08-27T00:06:25-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=336; waiting 30s

2026-08-27T00:06:55-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=329 plugged=False required_battery>=40

2026-08-27T00:06:55-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=329; waiting 30s

2026-08-27T00:07:25-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=329 plugged=False required_battery>=40

2026-08-27T00:07:25-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=329; waiting 30s

2026-08-27T00:07:55-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=329 plugged=False required_battery>=40

2026-08-27T00:07:55-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=329; waiting 30s

2026-08-27T00:08:26-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=329 plugged=False required_battery>=40

2026-08-27T00:08:26-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=329; waiting 30s

2026-08-27T00:08:56-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=323 plugged=False required_battery>=40

2026-08-27T00:08:56-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=323; waiting 30s

2026-08-27T00:09:26-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=323 plugged=False required_battery>=40

2026-08-27T00:09:26-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=323; waiting 30s

2026-08-27T00:09:56-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=323 plugged=False required_battery>=40

2026-08-27T00:09:56-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=323; waiting 30s

2026-08-27T00:10:26-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=323 plugged=False required_battery>=40

2026-08-27T00:10:26-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=323; waiting 30s

2026-08-27T00:10:57-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=323 plugged=False required_battery>=40

2026-08-27T00:10:57-04:00 WAIT_TEMP optional_p2048_calib2 temp_tenths=323; waiting 30s

2026-08-27T00:11:27-04:00 GATE optional_p2048_calib2 level=63 temp_tenths=318 plugged=False required_battery>=40

2026-08-27T00:11:39-04:00 INVOCATION optional_p2048_calib2 cache_mb=0 prompt_file=q62_p2048.txt decode_n=1 battery_pre=63 temp_pre_tenths=318 MemAvailable_pre_kb=5583128 allow_plugged=False

2026-08-27T00:12:05-04:00 optional_p2048_calib2 launcher completed process_rc=1 binary_pid=7980 sampler_pid=8010

2026-08-27T00:12:16-04:00 STOPPED exception=RuntimeError: optional_p2048_calib2: launcher rc=1

2026-08-27T00:13:41-04:00 Secondary follow-up start; Amendment 1; owner GO; primary records preserved

2026-08-27T00:13:42-04:00 existing device check: bmoe-cli ls/sha passed; verified runtime/model/guard not redone

2026-08-27T00:13:42-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_pp512.txt sha256=57b73e41eb26bef794de4c522cedb7e3702b4b97ca6e6292137ee3a5b8e5c948 bytes=1892

2026-08-27T00:13:43-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=1891 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam

2026-08-27T00:13:43-04:00 secondary uses existing decode fallback n=1; no n0 probe repeated

2026-08-27T00:13:43-04:00 secondary arm already complete in prior follow-up; preserving 3 existing invocations

2026-08-27T00:13:43-04:00 optional prompt candidate preserved for resume path=q62_p2048.txt bytes=7973

2026-08-27T00:13:43-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_p2048.txt sha256=66271b4753fcaec9f289898ab8c9b1562627b225931fd857f17b6ba0c188975d bytes=7973

2026-08-27T00:13:43-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=7972 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at

2026-08-27T00:13:43-04:00 optional p2048 resume: calib2 n_ctx rejection; trimmed candidate 1%; remaining calibration load=3 bytes=7894

2026-08-27T00:13:44-04:00 prompt pushed remote=/data/local/tmp/q62_out/q62_p2048.txt sha256=a748f3c4fa0977517f9e74d3aef64e62c74f1c2d5a71cae949eb080cb585bb8a bytes=7894

2026-08-27T00:13:44-04:00 prompt dry echo passed; p_arg_count=1 p_arg_chars=7893 p_arg_preview=A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work. We note each one at   Clear tests use one fresh task at a time. A new task may have a new set of page and file state,   Data can move while math runs. A read may fill a buf as a core does a sum. Thus read time and ma  The same rule holds for read size and read rate. A byte count is not a time, and a rate is not a  Heat and power are part of the test. A warn mark can show a rise in heat. A kill mark can end th  The text in a prompt has more than one size. It has chars, words, and tok. These are not the sam  A test can be calm and clear. We set one aim, list each step, and keep the same plan from start   On a small hand set, heat, charge, free space, and load can shift the work.

2026-08-27T00:13:44-04:00 GATE optional_p2048_calib3 level=63 temp_tenths=319 plugged=False required_battery>=40

2026-08-27T00:13:55-04:00 INVOCATION optional_p2048_calib3 cache_mb=0 prompt_file=q62_p2048.txt decode_n=1 battery_pre=63 temp_pre_tenths=319 MemAvailable_pre_kb=6793948 allow_plugged=False

2026-08-27T00:17:30-04:00 optional_p2048_calib3 launcher completed process_rc=0 binary_pid=11187 sampler_pid=11224

2026-08-27T00:17:41-04:00 CALIB optional_p2048_calib3 prompt_tokens=2033 source=CSV summary n_prompt field; numbers discarded

2026-08-27T00:17:41-04:00 CALIB optional p2048 accepted prompt_tokens=2033 source=CSV summary n_prompt field; calibration numbers discarded

2026-08-27T00:17:41-04:00 optional p2048 calibration complete prompt_tokens=2033; final prompt sha256=66271b4753fcaec9f289898ab8c9b1562627b225931fd857f17b6ba0c188975d is superseded by calibrated push

2026-08-27T00:17:41-04:00 GATE optional_p2048 level=61 temp_tenths=349 plugged=False required_battery>=40

2026-08-27T00:17:41-04:00 WAIT_TEMP optional_p2048 temp_tenths=349; waiting 30s

2026-08-27T00:18:11-04:00 GATE optional_p2048 level=61 temp_tenths=347 plugged=False required_battery>=40

2026-08-27T00:18:11-04:00 WAIT_TEMP optional_p2048 temp_tenths=347; waiting 30s

2026-08-27T00:18:42-04:00 GATE optional_p2048 level=61 temp_tenths=347 plugged=False required_battery>=40

2026-08-27T00:18:42-04:00 WAIT_TEMP optional_p2048 temp_tenths=347; waiting 30s

2026-08-27T00:19:12-04:00 GATE optional_p2048 level=61 temp_tenths=339 plugged=False required_battery>=40

2026-08-27T00:19:12-04:00 WAIT_TEMP optional_p2048 temp_tenths=339; waiting 30s

2026-08-27T00:19:42-04:00 GATE optional_p2048 level=61 temp_tenths=339 plugged=False required_battery>=40

2026-08-27T00:19:42-04:00 WAIT_TEMP optional_p2048 temp_tenths=339; waiting 30s

2026-08-27T00:20:12-04:00 GATE optional_p2048 level=61 temp_tenths=339 plugged=False required_battery>=40

2026-08-27T00:20:12-04:00 WAIT_TEMP optional_p2048 temp_tenths=339; waiting 30s

2026-08-27T00:20:43-04:00 GATE optional_p2048 level=61 temp_tenths=339 plugged=False required_battery>=40

2026-08-27T00:20:43-04:00 WAIT_TEMP optional_p2048 temp_tenths=339; waiting 30s

2026-08-27T00:21:13-04:00 GATE optional_p2048 level=61 temp_tenths=327 plugged=False required_battery>=40

2026-08-27T00:21:13-04:00 WAIT_TEMP optional_p2048 temp_tenths=327; waiting 30s

2026-08-27T00:21:43-04:00 GATE optional_p2048 level=61 temp_tenths=327 plugged=False required_battery>=40

2026-08-27T00:21:43-04:00 WAIT_TEMP optional_p2048 temp_tenths=327; waiting 30s

2026-08-27T00:22:14-04:00 GATE optional_p2048 level=61 temp_tenths=327 plugged=False required_battery>=40

2026-08-27T00:22:14-04:00 WAIT_TEMP optional_p2048 temp_tenths=327; waiting 30s

2026-08-27T00:22:44-04:00 GATE optional_p2048 level=61 temp_tenths=318 plugged=False required_battery>=40

2026-08-27T00:22:55-04:00 INVOCATION optional_p2048 cache_mb=0 prompt_file=q62_p2048.txt decode_n=1 battery_pre=61 temp_pre_tenths=318 MemAvailable_pre_kb=6849524 allow_plugged=False

2026-08-27T00:26:07-04:00 optional_p2048 launcher completed process_rc=0 binary_pid=19350 sampler_pid=19384

2026-08-27T00:26:18-04:00 optional p2048 arm complete: 1 invocation; cache_mb=0

2026-08-27T00:27:00-04:00 follow-up finalization correction: device recheck included bmoe-cli SHA and model size; the 13 GB model SHA was not rehashed per locked instruction. Secondary 3/3 and optional 1/1 completed; all raw CSV, io-trace, sampler, guard, gate, memory, and cpuset evidence pulled.
2026-08-27T00:48:13-04:00 APPENDIX AUDIT G-1: formal deviation recorded: run_q62.py used >=40% for the follow-up arms versus the locked >=45%; actual battery levels 68% -> 60% were all >=45%, so no invocation was admitted that the locked gate would reject.
2026-08-27T00:48:13-04:00 APPENDIX AUDIT G-2: final optional prompt prompts/q62_p2048.txt is 7894 B with sha256 a748f3c4fa0977517f9e74d3aef64e62c74f1c2d5a71cae949eb080cb585bb8a; device copy /data/local/tmp/q62_out/q62_p2048.txt rechecked and matches. Superseded 7973 B candidate sha256 66271b4753fcaec9f289898ab8c9b1562627b225931fd857f17b6ba0c188975d retained as raw/q62_p2048.superseded_candidate.sha256.txt.
2026-08-27T00:48:13-04:00 APPENDIX AUDIT G-3/G-4: report wording corrected to "consistent with no measurable prefill effect (deltas −8.05/−4.49/+5.85 %, within this device's ±6–14 % run scatter)"; pooled mean defined as mean of per-invocation deltas in seconds / mean primary wall; optional arm labeled n=1, exploratory.
2026-08-27T00:48:13-04:00 APPENDIX AUDIT margins: study-wide narrowest margin is secondary inv3 upper-bound io share 0.494, 1.1% below 0.5; secondary inv1/inv2 are mixed under serialized upper bound, robustness False/False/True. Secondary settling min headroom(k=4)=1.938 under serialized bound and >=2.0 under lower/point; primary settling statement remains primary-only.
2026-08-27T00:48:13-04:00 APPENDIX AUDIT finalization: finalize_q62.py regenerated REPORT.md and a second regeneration produced the identical SHA256 dc44cb0e6e5c60de57ea66c060d65546d595938b783b9ac75133d04fbb2b9006; STATUS.txt set to DONE_ALL_AUDITED.
