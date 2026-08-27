2026-08-27T02:21:13-04:00 PREREG 4b5afc37 read first; q67 locked workflow accepted. Device recon: model path /data/local/tmp/q67/CANDIDATE_1.gguf, device size=3098664160, device sha256=c54e95f8a8be9e444428fe89519be241bb4f15d3436e5864e4bd85ec54b9d89d; verification completed before any arm.
2026-08-27T02:21:13-04:00 RECON device AC powered=true, battery level=51%, battery temperature=35.3 C, MemAvailable=5235220 kB; cool-start gate <=35.0 C required before A1.
2026-08-27T02:30:38-04:00 PREFLIGHT model_device_sha=c54e95f8a8be9e444428fe89519be241bb4f15d3436e5864e4bd85ec54b9d89d model_bytes=3098664160 runtime_sha={'llama-perplexity': '4aef69d7b032db4fea15d5fab86041328c2180b0086f74656c319d9331f7ba50', 'llama-bench': '5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507'} preflight={'level': 57, 'temperature_tenths': 334, 'voltage_mv': 4043, 'ac_powered': True, 'usb_powered': False, 'wireless_powered': False, 'dock_powered': False, 'mem_available_kb': 5152196, 'plugged': True, 'captured_at': '2026-08-27T02:30:37-04:00'} plugged_declared=True
2026-08-27T02:30:38-04:00 GATE a1_htp level=57 temp_tenths=334 plugged=True MemAvailable_kb=5148684
2026-08-27T02:30:38-04:00 GATE_PASS a1_htp battery>=40 temp<=35.0 MemAvailable>=4GiB plugged=True
2026-08-27T02:30:40-04:00 ARM_START a1_htp command=llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -ngl 99 -dev HTP0 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 32 -nkvo -v battery_pre=57 temp_pre_tenths=334 MemAvailable_pre_kb=5148684 binary_pid=30832 cpuset=/
2026-08-27T02:30:56-04:00 ARM_END a1_htp status=DONE workload_rc=0 guard_rc=None guard_max_temp_tenths=334 execute_op_htp0=722 execute_op_attn=96 max_chunk=None final_ppl=None
2026-08-27T02:30:57-04:00 GATE a2_cpu level=57 temp_tenths=333 plugged=True MemAvailable_kb=7026340
2026-08-27T02:30:57-04:00 GATE_PASS a2_cpu battery>=40 temp<=35.0 MemAvailable>=4GiB plugged=True
2026-08-27T02:30:59-04:00 ARM_START a2_cpu command=llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -ngl 0 -t 8 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 32 -nkvo -v battery_pre=57 temp_pre_tenths=333 MemAvailable_pre_kb=7026340 binary_pid=32448 cpuset=/
2026-08-27T02:31:13-04:00 ARM_END a2_cpu status=DONE workload_rc=0 guard_rc=None guard_max_temp_tenths=333 execute_op_htp0=0 execute_op_attn=0 max_chunk=None final_ppl=None
2026-08-27T02:31:13-04:00 GATE b_npu level=57 temp_tenths=333 plugged=True MemAvailable_kb=7297496
2026-08-27T02:31:13-04:00 GATE_PASS b_npu battery>=40 temp<=35.0 MemAvailable>=4GiB plugged=True
2026-08-27T02:31:15-04:00 ARM_START b_npu command=llama-bench -m /data/local/tmp/q67/CANDIDATE_1.gguf -p 512 -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl -ngl 99 -dev HTP0 -v battery_pre=57 temp_pre_tenths=333 MemAvailable_pre_kb=7297496 binary_pid=32645 cpuset=/
2026-08-27T02:31:32-04:00 ARM_END b_npu status=DONE workload_rc=0 guard_rc=None guard_max_temp_tenths=333 execute_op_htp0=1812 execute_op_attn=192 max_chunk=None final_ppl=None
2026-08-27T02:31:33-04:00 GATE b_cpu level=57 temp_tenths=340 plugged=True MemAvailable_kb=7395556
2026-08-27T02:31:33-04:00 GATE_PASS b_cpu battery>=40 temp<=35.0 MemAvailable>=4GiB plugged=True
2026-08-27T02:31:35-04:00 ARM_START b_cpu command=llama-bench -m /data/local/tmp/q67/CANDIDATE_1.gguf -p 512 -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl -ngl 0 battery_pre=57 temp_pre_tenths=340 MemAvailable_pre_kb=7395556 binary_pid=488 cpuset=/
2026-08-27T02:32:09-04:00 ARM_END b_cpu status=DONE workload_rc=0 guard_rc=None guard_max_temp_tenths=346 execute_op_htp0=0 execute_op_attn=0 max_chunk=None final_ppl=None
2026-08-27T02:32:09-04:00 DONE q67 all four arms complete
2026-08-27T02:35:00-04:00 FINALIZE protocol outcome: A1/A2 commands were executed exactly as frozen in PREREG.md. The command text contains no -f /data/local/tmp/wiki.test.raw; llama-perplexity reported the data file tokenizes to 0 tokens. No PPL chunks were produced, so r is VOID and the numeric verdict is FAIL-NUMERICS. No retry or command change made.
2026-08-27T02:35:00-04:00 FINALIZE proof: A1 HTP execute-op HTP0=722 and attention=96; B NPU execute-op HTP0=1812 and attention=192; all four workload rc=0; no captured guard KILL_THRESHOLD or BATTERY_LOW_ABORT. Guard rc files were not created by the supervisor, so guard_rc is NA rather than inferred.
2026-08-27T02:35:00-04:00 FINALIZE gates: all four arms passed battery>=40%, cool-start<=35.0 C, MemAvailable>=4194304 kB, AC-powered declared; cpuset=/ for every binary_pid. NPU guard 40.0/41.0 C, CPU guard 40.0/43.0 C, poll=10 s, wall cap=600 s.
2026-08-27T02:46:31-04:00 AMENDMENT1_START commit=d451a1ee corrected_A1_A2_only=true addition=-f_/data/local/tmp/wiki.test.raw B_untouched=true attempt1_raw_renamed=52 supervisor_guard_rc=true
2026-08-27T02:46:31-04:00 GATE a1_htp_attempt2 level=66 temp_tenths=343 plugged=True MemAvailable_kb=5817588
2026-08-27T02:46:31-04:00 GATE_PASS a1_htp_attempt2 battery>=40 temp<=35.0 MemAvailable>=4GiB plugged=True
2026-08-27T02:46:34-04:00 ARM_START a1_htp_attempt2 command=llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -f /data/local/tmp/wiki.test.raw -ngl 99 -dev HTP0 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 32 -nkvo -v battery_pre=66 temp_pre_tenths=343 MemAvailable_pre_kb=5817588 binary_pid=10426 cpuset=/
2026-08-27T02:54:40-04:00 ARM_END a1_htp_attempt2 status=STOPPED workload_rc=137 guard_rc=2 guard_max_temp_tenths=411 execute_op_htp0=30674 execute_op_attn=3951 max_chunk=20 final_ppl=None
2026-08-27T02:54:40-04:00 AMENDMENT1_CAPTURED tag=a1_htp_attempt2 guard_csv=raw/a1_htp_attempt2.guard.csv guard_rc=raw/a1_htp_attempt2.guard.rc running_ppl_per_chunk=raw/a1_htp_attempt2.running_ppl.csv
2026-08-27T02:54:40-04:00 AMENDMENT1_STOPPED tag=a1_htp_attempt2 reason=FAIL_LOAD rc=137
2026-08-27T02:55:24-04:00 FINALIZE_ATTEMPT2 common_chunks=0 last_common_n=NA r=NaN gate=VOID verdict=FAIL-LOAD attempt1_letter=VOID B_untouched=true
2026-08-27T02:56:13-04:00 FINALIZE_ATTEMPT2 common_chunks=0 last_common_n=NA r=NaN gate=VOID verdict=STOPPED attempt1_letter=VOID B_untouched=true
2026-08-27T02:57:05-04:00 FINALIZE_ATTEMPT2 common_chunks=0 last_common_n=NA r=NaN gate=VOID verdict=STOPPED attempt1_letter=VOID B_untouched=true stop=GUARD_KILL_A1_41.1C_rc2 A2_not_run_per_stop_rule=true
2026-08-27T02:57:23-04:00 CORRECTION A1 attempt-2 rc=137 was guard-induced; guard.csv records KILL_THRESHOLD at 411 tenths and guard.rc=2. Final stop classification is STOP_GUARD_KILL; A2 was not run.
2026-08-27T02:58:16-04:00 FINALIZE_ATTEMPT2 common_chunks=0 last_common_n=NA r=VOID gate=VOID verdict=STOPPED attempt1_letter=VOID B_untouched=true stop=GUARD_KILL_A1_41.1C_rc2 A2_not_run_per_stop_rule=true
2026-08-27T03:01:44-04:00 AMENDMENT2_START commit=aa697b3d A2_only=true chunks=20 addition=-f_/data/local/tmp/wiki.test.raw A1_stands=true B_untouched=true cooldown_poll_s=300 cooldown_max_s=2400
2026-08-27T03:01:44-04:00 GATE a2_cpu_amendment2 level=72 temp_tenths=368 plugged=True MemAvailable_kb=6066868
2026-08-27T03:01:44-04:00 COOLDOWN a2_cpu_amendment2 poll=1 elapsed_s=0 level=72 temp_tenths=368 MemAvailable_kb=6066868 plugged=True
2026-08-27T03:01:44-04:00 COOLDOWN_WAIT a2_cpu_amendment2 next_poll_s=300
2026-08-27T03:06:45-04:00 GATE a2_cpu_amendment2 level=75 temp_tenths=356 plugged=True MemAvailable_kb=5963556
2026-08-27T03:06:45-04:00 COOLDOWN a2_cpu_amendment2 poll=2 elapsed_s=301 level=75 temp_tenths=356 MemAvailable_kb=5963556 plugged=True
2026-08-27T03:06:45-04:00 COOLDOWN_WAIT a2_cpu_amendment2 next_poll_s=300
2026-08-27T03:11:45-04:00 GATE a2_cpu_amendment2 level=78 temp_tenths=348 plugged=True MemAvailable_kb=5746348
2026-08-27T03:11:45-04:00 COOLDOWN a2_cpu_amendment2 poll=3 elapsed_s=601 level=78 temp_tenths=348 MemAvailable_kb=5746348 plugged=True
2026-08-27T03:11:45-04:00 GATE_PASS a2_cpu_amendment2 battery>=40 temp<=35.0 MemAvailable>=4GiB plugged=True cooldown_elapsed_s=601
2026-08-27T03:11:48-04:00 ARM_START a2_cpu_amendment2 command=llama-perplexity -m /data/local/tmp/q67/CANDIDATE_1.gguf -f /data/local/tmp/wiki.test.raw -ngl 0 -t 8 -c 2048 -b 2048 -ub 1024 -fa on --load-mode none --chunks 20 -nkvo -v battery_pre=78 temp_pre_tenths=348 MemAvailable_pre_kb=5746348 binary_pid=26222 cpuset=/
2026-08-27T03:21:16-04:00 ARM_END a2_cpu_amendment2 status=STOPPED workload_rc=137 guard_rc=2 guard_max_temp_tenths=430 execute_op_htp0=0 execute_op_attn=0 max_chunk=4 final_ppl=None
2026-08-27T03:21:16-04:00 AMENDMENT2_CAPTURED tag=a2_cpu_amendment2 guard_csv=raw/a2_cpu_amendment2.guard.csv guard_rc=raw/a2_cpu_amendment2.guard.rc running_ppl_per_chunk=raw/a2_cpu_amendment2.running_ppl.csv chunks=4
2026-08-27T03:21:16-04:00 AMENDMENT2_R_VOID chunks_below_8; no_retry=true
2026-08-27T03:23:17-04:00 FINALIZE_ATTEMPT2 r20_common_chunks=4 last_common_n=4 r20=VOID q55_gate=VOID verdict=STOPPED attempt1_letter=VOID A1_guard_kill_41.1C_rc2 A2_guard_kill_43.0C_rc2 A2_chunks=4 no_retry=true B_untouched=true
2026-08-27T07:21:26-04:00 UNPLUGGED_VERIFY a2_cpu_amendment3 AC_powered=False USB_powered=False Wireless_powered=False Dock_powered=False level=99 temp_tenths=337
2026-08-27T07:21:26-04:00 AMENDMENT3_START commit=62e29f09 A2_only=true attempt=3 chunks=20 addition=-f_/data/local/tmp/wiki.test.raw AC_powered=false A1_stands=true B_untouched=true cooldown_poll_s=300 cooldown_max_s=2400
2026-08-27T07:21:26-04:00 GATE a2_cpu_amendment3 level=99 temp_tenths=337 plugged=False MemAvailable_kb=3962932
2026-08-27T07:21:26-04:00 COOLDOWN a2_cpu_amendment3 poll=1 elapsed_s=0 level=99 temp_tenths=337 MemAvailable_kb=3962932 plugged=False
2026-08-27T07:21:26-04:00 COOLDOWN_WAIT a2_cpu_amendment3 next_poll_s=300 unplugged=true
2026-08-27T07:26:27-04:00 GATE a2_cpu_amendment3 level=99 temp_tenths=309 plugged=False MemAvailable_kb=3952384
2026-08-27T07:26:27-04:00 COOLDOWN a2_cpu_amendment3 poll=2 elapsed_s=301 level=99 temp_tenths=309 MemAvailable_kb=3952384 plugged=False
2026-08-27T07:26:27-04:00 COOLDOWN_WAIT a2_cpu_amendment3 next_poll_s=300 unplugged=true
2026-08-27T07:31:27-04:00 GATE a2_cpu_amendment3 level=99 temp_tenths=299 plugged=False MemAvailable_kb=3914084
2026-08-27T07:31:27-04:00 COOLDOWN a2_cpu_amendment3 poll=3 elapsed_s=601 level=99 temp_tenths=299 MemAvailable_kb=3914084 plugged=False
2026-08-27T07:31:27-04:00 COOLDOWN_WAIT a2_cpu_amendment3 next_poll_s=300 unplugged=true
2026-08-27T07:36:28-04:00 GATE a2_cpu_amendment3 level=99 temp_tenths=294 plugged=False MemAvailable_kb=3919512
2026-08-27T07:36:28-04:00 COOLDOWN a2_cpu_amendment3 poll=4 elapsed_s=902 level=99 temp_tenths=294 MemAvailable_kb=3919512 plugged=False
2026-08-27T07:36:28-04:00 COOLDOWN_WAIT a2_cpu_amendment3 next_poll_s=300 unplugged=true
2026-08-27T07:41:28-04:00 GATE a2_cpu_amendment3 level=99 temp_tenths=289 plugged=False MemAvailable_kb=3747716
2026-08-27T07:41:28-04:00 COOLDOWN a2_cpu_amendment3 poll=5 elapsed_s=1202 level=99 temp_tenths=289 MemAvailable_kb=3747716 plugged=False
2026-08-27T07:41:28-04:00 COOLDOWN_WAIT a2_cpu_amendment3 next_poll_s=300 unplugged=true
2026-08-27T07:46:29-04:00 GATE a2_cpu_amendment3 level=98 temp_tenths=287 plugged=False MemAvailable_kb=3575788
2026-08-27T07:46:29-04:00 COOLDOWN a2_cpu_amendment3 poll=6 elapsed_s=1503 level=98 temp_tenths=287 MemAvailable_kb=3575788 plugged=False
2026-08-27T07:46:29-04:00 COOLDOWN_WAIT a2_cpu_amendment3 next_poll_s=300 unplugged=true
2026-08-27T07:51:29-04:00 GATE a2_cpu_amendment3 level=98 temp_tenths=284 plugged=False MemAvailable_kb=3612176
2026-08-27T07:51:29-04:00 COOLDOWN a2_cpu_amendment3 poll=7 elapsed_s=1803 level=98 temp_tenths=284 MemAvailable_kb=3612176 plugged=False
2026-08-27T07:51:29-04:00 COOLDOWN_WAIT a2_cpu_amendment3 next_poll_s=300 unplugged=true
2026-08-27T07:56:30-04:00 GATE a2_cpu_amendment3 level=98 temp_tenths=284 plugged=False MemAvailable_kb=3824108
2026-08-27T07:56:30-04:00 COOLDOWN a2_cpu_amendment3 poll=8 elapsed_s=2104 level=98 temp_tenths=284 MemAvailable_kb=3824108 plugged=False
2026-08-27T07:56:30-04:00 COOLDOWN_WAIT a2_cpu_amendment3 next_poll_s=300 unplugged=true
2026-08-27T08:01:31-04:00 GATE a2_cpu_amendment3 level=98 temp_tenths=279 plugged=False MemAvailable_kb=3861284
2026-08-27T08:01:31-04:00 COOLDOWN a2_cpu_amendment3 poll=9 elapsed_s=2404 level=98 temp_tenths=279 MemAvailable_kb=3861284 plugged=False
2026-08-27T08:01:31-04:00 NOT-RUN a2_cpu_amendment3 cool-start wait exceeded 40 min
2026-08-27T08:01:31-04:00 AMENDMENT3_STOPPED reason=cooldown_or_gate
2026-08-27T08:02:33-04:00 FINALIZE_ATTEMPT2 r3_common_chunks=0 last_common_n=NA r3=VOID q55_gate=VOID verdict=STOPPED attempt1_letter=VOID A1_guard_kill_41.1C_rc2 A2_attempt2_guard_kill_43.0C_rc2 A2_attempt3_not_started_mem_gate_timeout=true no_further_attempt=true B_untouched=true
2026-08-27T08:06:05-04:00 AMENDMENT4_REBOOT_REQUEST pre_reboot_level=97 pre_reboot_temp_tenths=279 pre_reboot_MemAvailable_kb=3854756 pre_reboot_AC_powered=False
2026-08-27T08:06:16-04:00 AMENDMENT4_REBOOT_ISSUED returncode=0 exactly_one=true
2026-08-27T08:10:57-04:00 AMENDMENT4_ADB_REATTACHED boot_completed=1 elapsed_s=281 serial=adb-625689a2-9xEOfw._adb-tls-connect._tcp
2026-08-27T08:10:57-04:00 AMENDMENT4_IDLE_START duration_s=180
2026-08-27T08:13:57-04:00 AMENDMENT4_IDLE_END duration_s=180
2026-08-27T08:13:58-04:00 UNPLUGGED_VERIFY a2_cpu_amendment4 AC_powered=False USB_powered=False Wireless_powered=False Dock_powered=False level=96 temp_tenths=323
2026-08-27T08:13:58-04:00 GATE a2_cpu_amendment4 level=96 temp_tenths=323 plugged=False MemAvailable_kb=4061968
2026-08-27T08:13:58-04:00 PREARM_GATE a2_cpu_amendment4 poll=1 boot_elapsed_s=281 level=96 temp_tenths=323 MemAvailable_kb=4061968 plugged=False
2026-08-27T08:13:58-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:14:29-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=323 plugged=False MemAvailable_kb=4021608
2026-08-27T08:14:29-04:00 PREARM_GATE a2_cpu_amendment4 poll=2 boot_elapsed_s=312 level=95 temp_tenths=323 MemAvailable_kb=4021608 plugged=False
2026-08-27T08:14:29-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:14:59-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3636304
2026-08-27T08:14:59-04:00 PREARM_GATE a2_cpu_amendment4 poll=3 boot_elapsed_s=342 level=95 temp_tenths=319 MemAvailable_kb=3636304 plugged=False
2026-08-27T08:14:59-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:15:30-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3773000
2026-08-27T08:15:30-04:00 PREARM_GATE a2_cpu_amendment4 poll=4 boot_elapsed_s=373 level=95 temp_tenths=319 MemAvailable_kb=3773000 plugged=False
2026-08-27T08:15:30-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:16:00-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3763816
2026-08-27T08:16:00-04:00 PREARM_GATE a2_cpu_amendment4 poll=5 boot_elapsed_s=403 level=95 temp_tenths=319 MemAvailable_kb=3763816 plugged=False
2026-08-27T08:16:00-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:16:30-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3723360
2026-08-27T08:16:30-04:00 PREARM_GATE a2_cpu_amendment4 poll=6 boot_elapsed_s=433 level=95 temp_tenths=319 MemAvailable_kb=3723360 plugged=False
2026-08-27T08:16:30-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:17:01-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3650712
2026-08-27T08:17:01-04:00 PREARM_GATE a2_cpu_amendment4 poll=7 boot_elapsed_s=464 level=95 temp_tenths=319 MemAvailable_kb=3650712 plugged=False
2026-08-27T08:17:01-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:17:31-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3621476
2026-08-27T08:17:31-04:00 PREARM_GATE a2_cpu_amendment4 poll=8 boot_elapsed_s=494 level=95 temp_tenths=319 MemAvailable_kb=3621476 plugged=False
2026-08-27T08:17:31-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:18:02-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3610280
2026-08-27T08:18:02-04:00 PREARM_GATE a2_cpu_amendment4 poll=9 boot_elapsed_s=525 level=95 temp_tenths=319 MemAvailable_kb=3610280 plugged=False
2026-08-27T08:18:02-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:18:32-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3588076
2026-08-27T08:18:32-04:00 PREARM_GATE a2_cpu_amendment4 poll=10 boot_elapsed_s=555 level=95 temp_tenths=319 MemAvailable_kb=3588076 plugged=False
2026-08-27T08:18:32-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:19:03-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3579120
2026-08-27T08:19:03-04:00 PREARM_GATE a2_cpu_amendment4 poll=11 boot_elapsed_s=586 level=95 temp_tenths=319 MemAvailable_kb=3579120 plugged=False
2026-08-27T08:19:03-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:19:33-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3568160
2026-08-27T08:19:33-04:00 PREARM_GATE a2_cpu_amendment4 poll=12 boot_elapsed_s=616 level=95 temp_tenths=319 MemAvailable_kb=3568160 plugged=False
2026-08-27T08:19:33-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:20:04-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=319 plugged=False MemAvailable_kb=3529656
2026-08-27T08:20:04-04:00 PREARM_GATE a2_cpu_amendment4 poll=13 boot_elapsed_s=647 level=95 temp_tenths=319 MemAvailable_kb=3529656 plugged=False
2026-08-27T08:20:04-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:20:34-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=309 plugged=False MemAvailable_kb=3527556
2026-08-27T08:20:34-04:00 PREARM_GATE a2_cpu_amendment4 poll=14 boot_elapsed_s=677 level=95 temp_tenths=309 MemAvailable_kb=3527556 plugged=False
2026-08-27T08:20:34-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:21:05-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=309 plugged=False MemAvailable_kb=3504852
2026-08-27T08:21:05-04:00 PREARM_GATE a2_cpu_amendment4 poll=15 boot_elapsed_s=708 level=95 temp_tenths=309 MemAvailable_kb=3504852 plugged=False
2026-08-27T08:21:05-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:21:35-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=309 plugged=False MemAvailable_kb=3451912
2026-08-27T08:21:35-04:00 PREARM_GATE a2_cpu_amendment4 poll=16 boot_elapsed_s=738 level=95 temp_tenths=309 MemAvailable_kb=3451912 plugged=False
2026-08-27T08:21:35-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:22:06-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=309 plugged=False MemAvailable_kb=3417088
2026-08-27T08:22:06-04:00 PREARM_GATE a2_cpu_amendment4 poll=17 boot_elapsed_s=769 level=95 temp_tenths=309 MemAvailable_kb=3417088 plugged=False
2026-08-27T08:22:06-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:22:36-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=309 plugged=False MemAvailable_kb=3415860
2026-08-27T08:22:36-04:00 PREARM_GATE a2_cpu_amendment4 poll=18 boot_elapsed_s=799 level=95 temp_tenths=309 MemAvailable_kb=3415860 plugged=False
2026-08-27T08:22:36-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:23:07-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=309 plugged=False MemAvailable_kb=3413140
2026-08-27T08:23:07-04:00 PREARM_GATE a2_cpu_amendment4 poll=19 boot_elapsed_s=830 level=95 temp_tenths=309 MemAvailable_kb=3413140 plugged=False
2026-08-27T08:23:07-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:23:37-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=309 plugged=False MemAvailable_kb=3592040
2026-08-27T08:23:37-04:00 PREARM_GATE a2_cpu_amendment4 poll=20 boot_elapsed_s=860 level=95 temp_tenths=309 MemAvailable_kb=3592040 plugged=False
2026-08-27T08:23:37-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:24:08-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=309 plugged=False MemAvailable_kb=3583044
2026-08-27T08:24:08-04:00 PREARM_GATE a2_cpu_amendment4 poll=21 boot_elapsed_s=891 level=95 temp_tenths=309 MemAvailable_kb=3583044 plugged=False
2026-08-27T08:24:08-04:00 PREARM_GATE_WAIT a2_cpu_amendment4 next_poll_s=30
2026-08-27T08:24:38-04:00 GATE a2_cpu_amendment4 level=95 temp_tenths=309 plugged=False MemAvailable_kb=3607860
2026-08-27T08:24:38-04:00 PREARM_GATE a2_cpu_amendment4 poll=22 boot_elapsed_s=921 level=95 temp_tenths=309 MemAvailable_kb=3607860 plugged=False
2026-08-27T08:24:38-04:00 AMENDMENT4_STOPPED reason=prearm_gate_timeout boot_elapsed_s=921 MemAvailable_kb=3607860 temp_tenths=309 level=95
2026-08-27T08:24:56-04:00 AMENDMENT4_ADB_DEVICES_POLL polls=3 interval_s=20 target_serial=adb-625689a2-9xEOfw._adb-tls-connect._tcp state=device new_ip=false adb_connect=false
2026-08-27T08:26:15-04:00 FINALIZE_ATTEMPT4 r4_common_chunks=0 last_common_n=NA r4=VOID q55_gate=VOID verdict=STOPPED attempt1_letter=VOID A1_guard_kill_41.1C_rc2 A2_attempt2_guard_kill_43.0C_rc2 A2_attempt3_not_started_mem_gate_timeout=true reboot_count=1 A2_attempt4_not_started_mem_gate_timeout=true no_further_attempt=true B_untouched=true
