# q55 RUN_LOG

status=STARTING
prereg_lock=q55 PREREG locked; commit message="q55 PREREG locked"
device=23127PN0CG / houji_global / SM8650 / Hexagon v75 / Adreno 750 / UFS 4.0 / 12 GB
serial=adb-625689a2-9xEOfw._adb-tls-connect._tcp
wireless=1; unplugged_required=1; no_deletion=1; no_charging_change=1; git=0; BigMoeOnEdge=0; reconnects=0
guard_source=q56 thermal_guard.sh; validated_on_this_device_in_q61=1
guard_npu=WARN=400; KILL=410; interval=1s; wall_cap=600s; cool_start<=32.0C; battery>=45%
guard_cpu=WARN=400; KILL=430; cool_start<=32.0C; battery>=45%
stop_npu=dspqueue|INTERNAL-ERROR|ggml_abort|CDSP|guard kill; no retry
q48_setup=LD_LIBRARY_PATH=/data/local/tmp/kalsahtp:/vendor/lib64:/system/vendor/lib64:/system/lib64; ADSP_LIBRARY_PATH=/data/local/tmp/kalsahtp; CDSP_LIBRARY_PATH=/data/local/tmp/kalsahtp; GGML_HEXAGON_NDEV=1; GGML_HEXAGON_HOSTBUF=1
source_commit=3f545beccee69d9975f466ec7e45fd9aacd8ba90
setup_note=llama-perplexity --help after chmod emitted non-fatal "ggml-hex: failed to open session 0 : error 0x80000406" / "failed to create device/session 0"; no model arm, no dspqueue, INTERNAL-ERROR, ggml_abort, CDSP, or guard kill

## setup
correction_utc=2026-08-26T09:00:00Z; initial setup-only attempt used wrong Qwen path and classified ordinary sha256sum ENOENT as transport; no NPU/CPU arm was started; exact serial stayed online
initial_setup_error=ordinary sha256sum ENOENT on wrong Qwen path; exact Xiaomi transport did not drop; no arm started; corrected to /data/local/tmp/kalsahtp/models/Qwen3.5-4B-Q4_0.gguf
invalid_preflight=partA_olmoe_htp; guard_rc=0; workload_rc=1; stderr="error: invalid argument: 1"; no execute-op/crash/guard-kill; preserved; corrected arm uses q55 boolean flag syntax
setup_verified_utc=2026-08-26T09:06:59.014+00:00; corpus/model shas match; v75 setup shas recorded; source_commit=3f545beccee69d9975f466ec7e45fd9aacd8ba90
partA_olmoe_htp launcher_rc=1 guard_rc=0 workload_rc=1 max_C=27.9 signature=''
STOP q55 tag=partA_olmoe_htp; no retry; signature=''
STOP_REASON=partA_olmoe_htp_valid HTP runtime allocation failure; no retry
exact_error_line=0.00.09.830.275 E ggml-hex: HTP0 buffer mapping failed : domain_id 3 size 268439552 fd 21 error 0x00000001
exact_error_line=0.00.09.844.177 E ggml-hex: HTP0 failed to allocate buffer context (host): ggml-hex: fastrpc_mmap failed (see log for details)
exact_error_line=0.00.09.844.219 E alloc_tensor_range: failed to allocate HTP0 buffer of size 268435456
exact_error_line=0.00.09.844.350 E llama_init_from_model: failed to initialize the context: failed to allocate buffer for kv cache
q55_final_state=exact serial device; 74%; 28.1C; AC/USB/Wireless false; no residual benchmark/guard process
setup_verified_utc=2026-08-26T09:08:54.273+00:00; corpus/model shas match; v75 setup shas recorded; source_commit=3f545beccee69d9975f466ec7e45fd9aacd8ba90
partA_olmoe_htp_valid launcher_rc=1 guard_rc=0 workload_rc=1 max_C=27.9 signature=''
STOP q55 tag=partA_olmoe_htp_valid; no retry; signature=''
arbitration_utc=2026-08-26T09:20:27Z; one authorized retry only; exact serial remained online; MemAvailable=6818768 kB (>5.0 GB) PASS; battery=74%; temperature=27.7C; AC/USB/Wireless=false; no processes closed; no device state changed
arbitration_deviation=KV cache on host: attention K/V stay on CPU; the experts MUL_MAT_ID and dense matmuls still execute on HTP0 — proof required via execute-op lines
setup_verified_utc=2026-08-26T09:21:32.729+00:00; corpus/model shas match; v75 setup shas recorded; source_commit=3f545beccee69d9975f466ec7e45fd9aacd8ba90
partA_olmoe_htp_kvhost_retry launcher_rc=0 guard_rc=0 workload_rc=0 max_C=31.2 signature=''
partA_olmoe_cpu_kvhost launcher_rc=0 guard_rc=0 workload_rc=0 max_C=39.4 signature=''
partB_olmoe_npu_1 launcher_rc=0 guard_rc=0 workload_rc=0 max_C=31.9 signature='ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400007b0244c2d0'
STOP q55 tag=partB_olmoe_npu_1; no retry; signature='ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400007b0244c2d0'
exact_stop_line=ggml-hex: Loading driver libcdsprpc.so
exact_stop_line=ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400007b0244c2d0
thermalservice_headroom_available=false; raw thresholds include [NaN, NaN, NaN, 1.0, NaN, NaN, 1.95]
q55_arbitration_final_state=exact serial device; 59%; 31.9C; AC/USB/Wireless false; no residual llama-bench/llama-perplexity/thermal_guard process
