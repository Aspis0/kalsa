# Sampler-overhead probe (S23, 2026-10-11). Runs on the device as the app uid (run-as), every 2 s:
# CPU time of the Meter's HandlerThread "GovernorBatterySampler" (comm truncated to 15 chars).
# Line: epoch_s pid tid schedstat(run_ns wait_ns slices) utime stime (ticks). Stops on files/ovh.stop.
OUT=/data/data/com.kalsa.app/files/ovh.txt
while [ ! -f /data/data/com.kalsa.app/files/ovh.stop ]; do
  p=$(pidof com.kalsa.app)
  if [ -n "$p" ]; then
    for t in /proc/$p/task/*; do
      case "$(cat $t/comm 2>/dev/null)" in
        GovernorBatter*) s=$(cat $t/stat 2>/dev/null); set -- ${s#*) }
          echo "$(date +%s) $p ${t##*/} $(cat $t/schedstat 2>/dev/null) ${12} ${13}" >> $OUT ;;
      esac
    done
  fi
  sleep 2
done
