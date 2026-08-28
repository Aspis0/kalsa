#!/system/bin/sh
base=/data/local/tmp/q66_enginetest/run-20260827-1941
echo $$ > "$base/shell_pid.txt"
cat /proc/$$/cpuset > "$base/shell_cpuset.txt"
cat /proc/$$/oom_score_adj > "$base/shell_oom_score_adj.txt"
export LD_LIBRARY_PATH="$base${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
"$base/test-repack-q23k-load" --loader-set > "$base/output.txt" 2>&1 &
test_pid=$!
echo "$test_pid" > "$base/pid.txt"
if [ -r "/proc/$test_pid/cpuset" ]; then cat "/proc/$test_pid/cpuset" > "$base/cpuset.txt"; fi
if [ -r "/proc/$test_pid/oom_score_adj" ]; then cat "/proc/$test_pid/oom_score_adj" > "$base/oom_score_adj.txt"; fi
wait "$test_pid"
rc=$?
echo "$rc" > "$base/exit.txt"
exit "$rc"
