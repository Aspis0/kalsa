#!/bin/sh
set -u

serial=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
root=/data/local/tmp/govhtp
out=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

gate() {
    gate_name=$1
    adb -s "$serial" shell '
        wake=$(dumpsys power | sed -n "s/.*mWakefulness=//p" | head -1)
        battery=$(dumpsys battery 2>/dev/null | grep -E "^  (AC|USB|Wireless) powered:|^  level:|^  temperature:")
        ac=$(printf "%s\n" "$battery" | sed -n "s/^  AC powered: //p" | head -1)
        usb=$(printf "%s\n" "$battery" | sed -n "s/^  USB powered: //p" | head -1)
        wireless=$(printf "%s\n" "$battery" | sed -n "s/^  Wireless powered: //p" | head -1)
        level=$(printf "%s\n" "$battery" | sed -n "s/^  level: //p" | head -1)
        temp=$(printf "%s\n" "$battery" | sed -n "s/^  temperature: //p" | head -1)
        thermal=$(dumpsys thermalservice | sed -n "s/.*Thermal Status: //p" | head -1)
        traced=$(getprop persist.traced.enable)
        printf "mWakefulness=%s AC=%s USB=%s Wireless=%s level=%s temperature_dC=%s thermal_status=%s traced=%s\n" \
          "$wake" "$ac" "$usb" "$wireless" "$level" "$temp" "$thermal" "$traced"
        [ "$wake" = Awake ] && [ "$level" -gt 30 ] && [ "$temp" -lt 430 ] \
          && [ "$thermal" -lt 3 ] && [ "$traced" = 0 ]
    ' > "$out/$gate_name.gate.log" 2>&1
    rc=$?
    echo "GATE_EXIT=$rc" >> "$out/$gate_name.gate.log"
    cat "$out/$gate_name.gate.log"
    return "$rc"
}

run_arm() {
    run_name=$1
    mode=$2
    gate "$run_name.pre" || return 30
    adb -s "$serial" shell am force-stop com.kalsa.app > "$out/$run_name.force-stop.log" 2>&1
    force_rc=$?
    adb -s "$serial" shell pidof com.kalsa.app > "$out/$run_name.app-pid.log" 2>&1
    pid_rc=$?
    if [ "$force_rc" -ne 0 ] || [ "$pid_rc" -eq 0 ] && [ -s "$out/$run_name.app-pid.log" ]; then
        echo "APP_GATE_FAIL force_stop=$force_rc pid=$pid_rc" | tee "$out/$run_name.app-gate.log"
        return 31
    fi

    case "$mode" in
        flush)
            option=GGML_HEXAGON_HOSTBUF_FLUSH=1
            ;;
        uncached)
            option=GGML_HEXAGON_HOSTBUF_UNCACHED=1
            ;;
        repack)
            option=GGML_HEXAGON_HOSTBUF_REPACK=1
            ;;
        *)
            return 2
            ;;
    esac

    adb -s "$serial" shell "cd $root && export LD_LIBRARY_PATH=$root/lib ADSP_LIBRARY_PATH=$root/lib GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 $option && ./bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f $root/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -ot '.*=HTP0:0-HOST' -lm none --chunks 2 --kl-divergence-base $root/input/cause-cpu-base.logits --kl-divergence -lv 5 > $root/$run_name.log 2>&1; rc=\$?; echo EXIT=\$rc >> $root/$run_name.log; ops=\$(grep -c 'HTP0:0 execute-op MUL_MAT' $root/$run_name.log); echo BINARY_EXIT=\$rc HTP_MUL_MAT=\$ops; tail -5 $root/$run_name.log; exit \$rc" > "$out/$run_name.run-summary.log" 2>&1
    adb_rc=$?
    echo "ADB_EXIT=$adb_rc" >> "$out/$run_name.run-summary.log"
    tail -5 "$out/$run_name.run-summary.log"

    gate "$run_name.post"
    post_rc=$?
    adb -s "$serial" pull "$root/$run_name.log" "$out/$run_name.log" > "$out/$run_name.pull.log" 2>&1
    pull_rc=$?
    echo "PULL_EXIT=$pull_rc" >> "$out/$run_name.pull.log"
    cat "$out/$run_name.pull.log"
    grep -E '^(EXIT=|BINARY_EXIT=|ADB_EXIT=)' "$out/$run_name.run-summary.log" || true
    grep -E 'Mean    KLD:|Maximum KLD:|Same top p:|Mean PPL\(Q\)' "$out/$run_name.log" | tail -5 || true
    [ "$adb_rc" -eq 0 ] && [ "$post_rc" -eq 0 ] && [ "$pull_rc" -eq 0 ]
}

svc_rc=$(adb -s "$serial" shell svc power stayon true >/dev/null 2>&1; echo $?)
echo "STAYON_EXIT=$svc_rc"
adb -s "$serial" shell 'cd /data/local/tmp/govhtp && sha256sum bin/llama-perplexity bin/hexagon-rpcmem-bench input/kld_english_fixture.txt input/cause-cpu-base.logits' > "$out/payload-sha256.log" 2>&1
hash_rc=$?
echo "HASH_EXIT=$hash_rc" >> "$out/payload-sha256.log"
cat "$out/payload-sha256.log"
[ "$hash_rc" -eq 0 ] || exit 40

run_arm host-uncached-kld-v2 uncached || exit $?
run_arm host-repack-kld repack || exit $?

gate session-postflight
