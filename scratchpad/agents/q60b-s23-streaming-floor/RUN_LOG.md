# q60b RUN_LOG

cell=q60b-s23-streaming-floor
prereg_lock=9e2b6b36
device=Galaxy S23 / v73 / UFS 3.1
serial=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
direct_endpoint_seen=192.168.1.152:36269
wireless=1; unplugged=1; no_model_push=1; no_deletion=1; no_charging_change=1; git=0; BigMoeOnEdge=0
initial_inventory_mem_total_kb=7243748; initial_inventory_mem_available_kb=4725704; run_start_mem_total_kb=7243748; run_start_mem_available_kb=4539468; data_use_pct=93
selected_model=/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf; bytes=6509642624; sha256=bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419; larger_than_mem_available=1
selected_binary=/data/local/tmp/s3oracle/llama-bench; bytes=7600; sha256=b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c; LD_LIBRARY_PATH=/data/local/tmp/s3oracle; -ngl=0; -mmp=1 (mmap); -nr (canonical boolean no-repack)
cold_protocol=hash model before idle; >=600 s no-touch idle; rep1=cold-designated; reps2-3=warm; separate -r 1 launch and sampler CSV per rep
guard_invocation=WARN 400 / KILL 430 / interval 1 s / sensor_failure_limit 4 / session_hard_cap 0
sampler=q60_sampler.sh exact logic inline on-device; utime+stime, majflt, read_bytes, /proc/pressure/io; no sampler push
workload=-p N -n 0 -r 1 --no-warmup -t 8 -o jsonl -ngl 0 -mmp 1 -nr
npu_flags=absent; -dev HTP0=absent; -ngl 99=absent
cool_gate=<=32.0 C; 60 s polls; battery >=45%; q56 launch precheck >=50%; unplugged

## run order
q60b_final2_n128_r1 pre_level=67 pre_temp_C=28.7 post_level=67 post_temp_C=30.0 wall_s=18.566302 busy_frac=0.233016 stime_s=25.110 read_MB=12370.747 MB_s=666.301 majflt=43329 guard_manifest=raw/q60b_final2_n128_r1.manifest.json
q60b_final2_n128_r2 pre_level=67 pre_temp_C=30.0 post_level=67 post_temp_C=31.2 wall_s=12.243919 busy_frac=0.332818 stime_s=23.980 read_MB=12290.159 MB_s=1003.777 majflt=49692 guard_manifest=raw/q60b_final2_n128_r2.manifest.json
q60b_final2_n128_r3 pre_level=67 pre_temp_C=31.2 post_level=67 post_temp_C=31.9 wall_s=9.353330 busy_frac=0.399056 stime_s=21.710 read_MB=10825.327 MB_s=1157.377 majflt=43933 guard_manifest=raw/q60b_final2_n128_r3.manifest.json
q60b_final2_n512_r1 pre_level=66 pre_temp_C=28.7 post_level=66 post_temp_C=29.4 wall_s=16.007762 busy_frac=0.464775 stime_s=28.030 read_MB=12029.182 MB_s=751.459 majflt=35734 guard_manifest=raw/q60b_final2_n512_r1.manifest.json
q60b_final2_n512_r2 pre_level=66 pre_temp_C=29.4 post_level=66 post_temp_C=30.8 wall_s=16.639369 busy_frac=0.473876 stime_s=29.530 read_MB=11207.922 MB_s=673.579 majflt=30810 guard_manifest=raw/q60b_final2_n512_r2.manifest.json
q60b_final2_n512_r3 pre_level=66 pre_temp_C=30.8 post_level=66 post_temp_C=32.5 wall_s=16.961654 busy_frac=0.478137 stime_s=30.830 read_MB=12210.602 MB_s=719.895 majflt=34116 guard_manifest=raw/q60b_final2_n512_r3.manifest.json
q60b_final2_n2048_r1 pre_level=65 pre_temp_C=28.9 post_level=64 post_temp_C=32.7 wall_s=93.504276 busy_frac=0.333594 stime_s=90.290 read_MB=29904.531 MB_s=319.820 majflt=285154 guard_manifest=raw/q60b_final2_n2048_r1.manifest.json
q60b_final2_n2048_r2 pre_level=64 pre_temp_C=31.5 post_level=63 post_temp_C=34.3 wall_s=101.971790 busy_frac=0.313555 stime_s=94.430 read_MB=30585.545 MB_s=299.941 majflt=278849 guard_manifest=raw/q60b_final2_n2048_r2.manifest.json
q60b_final2_n2048_r3 pre_level=63 pre_temp_C=31.7 post_level=62 post_temp_C=35.3 wall_s=90.869036 busy_frac=0.358896 stime_s=52.880 read_MB=30859.604 MB_s=339.605 majflt=335412 guard_manifest=raw/q60b_final2_n2048_r3.manifest.json

## analysis
best_sustained_cell_MB_s=1157.376741
io_gate_seq_median_MB_s=430.223000; seq_best_MB_s=452.654000; comparable=0
headroom=wall/max(io_floor,compute_s/k), k=2,4,8; compute_s=utime_s+stime_s; stime_reported_separately=1
pp512_warm_wording=mixed; pp512_warm_io_floor_ratio_mean=0.601996; median=0.622005
max_temperature_C=35.4; battery_start_pct=67; battery_end_pct=62
pressure_io_readable=1
anomalies=initial q60b_n128_r1 kalsahtp probe: rc=1 invalid parameter -nr; no model benchmark ran; guard normal; q60b_final_n128_r1 #23 probe: rc=1 invalid parameter -lm; no model benchmark ran; guard normal
