# q58 RUN_LOG

cell=q58-s23-npu-spike-sweep
prereg=f10d997b
device=Galaxy S23 / Hexagon v73
serial=192.168.1.152:36269
wireless=1; unplugged=1; no_model_push=1; no_deletion=1; no_charging_change=1; git=0; BigMoeOnEdge=0
preflight=PASS
preflight_battery={'level': 81, 'temperature_tenths': 269, 'voltage_mv': 4132, 'health': 2, 'ac_powered': False, 'usb_powered': False, 'wireless_powered': False, 'dock_powered': False}
pin_device_file=raw/preflight_device_sha256.txt
pin_result=thermal_guard MATCH; llama-bench MATCH; libggml-hexagon MATCH; libggml-htp-v73 MATCH; Qwen3.5-4B-Q4_0 MATCH
guard_invocation=launch_with_guard.py --warn-tenths 400 --kill-tenths {NPU:410,CPU:430} --session-hard-cap-tenths 0 --sensor-failure-limit 4 --interval-s 1 --max-seconds 1800
workload=llama-bench -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl -v; NPU -ngl 99 -dev HTP0; CPU -ngl 0
environment=NDEV=1; NPU HOSTBUF=1; CPU HOSTBUF=unset
cool_gate=<=32.0 C before each run; 60 s polls; battery >=45%; unplugged
runs=16; normal=16; guard_kills=0; adb_reconnects=0; crash_signatures=NONE

## run order

q58_n128_npu_1 pre=26.9C/81% post=27.3C/81% delta=0.4C MAX=27.3C wall=16.950s tps=75.78319 guard=normal workload_rc=0 thermal=0/0
q58_n128_cpu_1 pre=27.3C/81% post=31.1C/80% delta=3.8C MAX=28.9C wall=53.136s tps=6.007431 guard=normal workload_rc=0 thermal=0/0
q58_n128_cpu_2 pre=31.1C/80% post=31.1C/80% delta=0.0C MAX=31.1C wall=18.209s tps=38.685951 guard=normal workload_rc=0 thermal=0/0
q58_n128_npu_2 pre=31.1C/80% post=31.7C/80% delta=0.6C MAX=31.7C wall=15.483s tps=73.646106 guard=normal workload_rc=0 thermal=0/0
q58_n512_npu_1 pre=31.7C/80% post=31.7C/80% delta=0.0C MAX=31.7C wall=20.066s tps=126.081691 guard=normal workload_rc=0 thermal=0/0
q58_n512_cpu_1 pre=31.3C/79% post=34.3C/79% delta=3.0C MAX=34.3C wall=63.774s tps=19.289335 guard=normal workload_rc=0 thermal=0/0
q58_n512_cpu_2 pre=31.5C/78% post=35.0C/78% delta=3.5C MAX=35.0C wall=63.707s tps=19.226679 guard=normal workload_rc=0 thermal=0/0
q58_n512_npu_2 pre=31.8C/78% post=31.8C/78% delta=0.0C MAX=31.8C wall=19.289s tps=128.801951 guard=normal workload_rc=0 thermal=0/0
q58_n1024_npu_1 pre=31.8C/78% post=32.6C/77% delta=0.8C MAX=32.6C wall=28.201s tps=127.868111 guard=normal workload_rc=0 thermal=0/0
q58_n1024_cpu_1 pre=31.9C/77% post=35.2C/76% delta=3.3C MAX=35.3C wall=181.904s tps=23.941668 guard=normal workload_rc=0 thermal=0/0
q58_n1024_cpu_2 pre=31.8C/76% post=35.0C/75% delta=3.2C MAX=35.0C wall=187.293s tps=28.213246 guard=normal workload_rc=0 thermal=0/0
q58_n1024_npu_2 pre=31.7C/75% post=33.1C/74% delta=1.4C MAX=33.1C wall=87.907s tps=82.506653 guard=normal workload_rc=0 thermal=0/0
q58_n2048_npu_1 pre=32.0C/74% post=34.1C/74% delta=2.1C MAX=34.1C wall=111.024s tps=92.171058 guard=normal workload_rc=0 thermal=0/0
q58_n2048_cpu_1 pre=31.6C/73% post=36.9C/71% delta=5.3C MAX=36.9C wall=378.454s tps=25.0061 guard=normal workload_rc=0 thermal=0/0
q58_n2048_cpu_2 pre=32.0C/71% post=37.0C/69% delta=5.0C MAX=37.2C wall=375.252s tps=25.478337 guard=normal workload_rc=0 thermal=0/0
q58_n2048_npu_2 pre=32.0C/69% post=34.3C/68% delta=2.3C MAX=34.4C wall=134.888s tps=84.396365 guard=normal workload_rc=0 thermal=0/0

## thermalservice exposure

thermal_statuses=[0]
current_headroom=not exposed
headroom_thresholds=NaN, 0.8666667, 0.93333334, 1.0, 1.1333333, 1.4333333, 2.4333334
verbatim_per_run_files=*.thermalservice.pre.txt; *.thermalservice.post.txt

## final

battery_start={'level': 81, 'temperature_tenths': 269, 'voltage_mv': 4132, 'health': 2, 'ac_powered': False, 'usb_powered': False, 'wireless_powered': False, 'dock_powered': False}
battery_end={'level': 68, 'temperature_tenths': 343, 'voltage_mv': 3995, 'ac_powered': False, 'usb_powered': False, 'wireless_powered': False, 'dock_powered': False}
crash_signature=NONE
