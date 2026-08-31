Exact command lines of cell 793164 (audit fix F2.4/F4.3).

Per-invocation, on device via run_gov_793164.sh (archived copy of the script
pushed as /data/local/tmp/kalsa/run_gov.sh):
  export LD_LIBRARY_PATH=/data/local/tmp/kalsa
  ./governor-bench --arm <A|C|G> -m /data/local/tmp/kalsa/lfm8b.gguf -r 3 > gov_<ARM>_<TAG>.out 2>&1
  echo $? > gov_<ARM>_<TAG>.exit
Orchestration (gate, launch, wait, post-snapshot, pull): drive_one_793164.sh
(archived copy), invoked as: drive_one.sh A 1; C 1; C 2; A 2; G 1; G 2.

OpenCL banner probe (opencl_banner_probe_793164.txt), on device:
  cd /data/local/tmp/kalsa && LD_LIBRARY_PATH=/data/local/tmp/kalsa \
    ./llama-bench -m lfm8b.gguf -ngl 99 -p 16 -n 4 -r 1 2>&1 | head -25

Unit serial b4bd0901: from `ANDROID_ADB_SERVER_PORT=6037 adb devices` over the
session tunnel (terminal transcript; the getprop provenance capture omitted the
serial — audit fix F3.3).

Provenance of therm_reprobe_preG1/preG2_793164.txt (audit residue R1): these
are the live output files of thermal_gate.sh written by the cooldown watcher
to /tmp during the session (19:48 and 19:55), copied into raw/ post-hoc at
20:11 — file content is raw tool output, only the copy is late.
thermal_gate.sh itself is archived as thermal_gate_793164.sh (residue R2).
