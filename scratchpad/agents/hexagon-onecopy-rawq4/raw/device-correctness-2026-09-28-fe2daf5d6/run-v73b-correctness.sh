#!/bin/sh
set -u

serial=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
root=/data/local/tmp/govhtp
out=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

gate() {
    gate_name=$1
    adb -s "$serial" shell '
        wake=$(dumpsys power | sed -n "s/.*mWakefulness=//p" | head -1)
        battery=$(dumpsys battery 2>/dev/null | grep -E "^  level:|^  temperature:")
        level=$(printf "%s\n" "$battery" | sed -n "s/^  level: //p" | head -1)
        temp=$(printf "%s\n" "$battery" | sed -n "s/^  temperature: //p" | head -1)
        thermal=$(dumpsys thermalservice | sed -n "s/.*Thermal Status: //p" | head -1)
        traced=$(getprop persist.traced.enable)
        ac=$(dumpsys battery 2>/dev/null | sed -n "s/^  AC powered: //p" | head -1)
        printf "mWakefulness=%s AC=%s level=%s temperature_dC=%s thermal_status=%s traced=%s\n" \
          "$wake" "$ac" "$level" "$temp" "$thermal" "$traced"
        [ "$wake" = Awake ] && [ "$level" -gt 30 ] && [ "$temp" -lt 430 ] \
          && [ "$thermal" -lt 3 ] && [ "$traced" = 0 ]
    ' > "$out/$gate_name.gate.log" 2>&1
    rc=$?
    echo "GATE_EXIT=$rc" >> "$out/$gate_name.gate.log"
    cat "$out/$gate_name.gate.log"
    return "$rc"
}

run_arm() {
    arm=$1
    mode=$2
    gate "$arm.pre" || return 30
    adb -s "$serial" shell am force-stop com.kalsa.app > "$out/$arm.force-stop.log" 2>&1
    force_rc=$?
    adb -s "$serial" shell pidof com.kalsa.app > "$out/$arm.app-pid.log" 2>&1
    pid_rc=$?
    if [ "$force_rc" -ne 0 ] || { [ "$pid_rc" -eq 0 ] && [ -s "$out/$arm.app-pid.log" ]; }; then
        echo "APP_GATE_FAIL force_stop=$force_rc pid=$pid_rc" > "$out/$arm.app-gate.log"
        cat "$out/$arm.app-gate.log"
        return 31
    fi

    case "$mode" in
        raw-host)
            setup='GGML_HEXAGON_HOSTBUF=1'
            override="-ot '.*=HTP0:0-HOST'"
            extra=
            ;;
        normal)
            setup=
            override=
            extra=
            ;;
        normal-no-repack)
            setup=
            override=
            extra=--no-repack
            ;;
        *)
            return 2
            ;;
    esac

    adb -s "$serial" shell "cd $root && export LD_LIBRARY_PATH=$root/lib ADSP_LIBRARY_PATH='$root/onecopy-v73b/dsp;$root/lib' GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 $setup && unset GGML_HEXAGON_HOSTBUF_REPACK GGML_HEXAGON_HOSTBUF_FLUSH GGML_HEXAGON_HOSTBUF_UNCACHED && ./onecopy-v73b/bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f $root/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 $override $extra -lm none --chunks 2 --kl-divergence-base $root/input/cause-cpu-base.logits --kl-divergence -lv 5 > $root/onecopy-v73b/$arm.log 2>&1; rc=\$?; echo EXIT=\$rc >> $root/onecopy-v73b/$arm.log; ops=\$(grep -c 'HTP0:0 execute-op MUL_MAT' $root/onecopy-v73b/$arm.log); host_ops=\$(grep -Ec 'HTP0:0 execute-op MUL_MAT.*HTP0:0-HOST x' $root/onecopy-v73b/$arm.log); errors=\$(grep -Eic 'dsp-error|NO-SUPPORT|CDSP.*CRASH|GGML_ABORT|ggml_abort|GGML_ASSERT|Segmentation fault' $root/onecopy-v73b/$arm.log || true); echo BINARY_EXIT=\$rc HTP_MUL_MAT=\$ops HTP_HOST_MUL_MAT=\$host_ops ERROR_MARKERS=\$errors; grep -E 'Mean PPL\(Q\)|Mean +KLD|Maximum KLD|Same top p' $root/onecopy-v73b/$arm.log | tail -5; exit \$rc" > "$out/$arm.run-summary.log" 2>&1
    adb_rc=$?
    echo "ADB_EXIT=$adb_rc" >> "$out/$arm.run-summary.log"
    tail -8 "$out/$arm.run-summary.log"
    gate "$arm.post"
    post_rc=$?
    adb -s "$serial" pull "$root/onecopy-v73b/$arm.log" "$out/$arm.log" > "$out/$arm.pull.log" 2>&1
    pull_rc=$?
    echo "PULL_EXIT=$pull_rc" >> "$out/$arm.pull.log"
    cat "$out/$arm.pull.log"
    if [ -f "$out/$arm.log" ] && grep -Eiq 'dsp-error|NO-SUPPORT|CDSP.*CRASH|GGML_ABORT|ggml_abort|GGML_ASSERT|Segmentation fault' "$out/$arm.log"; then
        echo "STOP_AFTER_DSP_OR_ABORT=$arm" | tee -a "$out/session.log"
        return 42
    fi
    [ "$adb_rc" -eq 0 ] && [ "$post_rc" -eq 0 ] && [ "$pull_rc" -eq 0 ]
}

adb -s "$serial" shell svc power stayon true > "$out/stayon.log" 2>&1
rc=$?
echo "STAYON_EXIT=$rc" >> "$out/stayon.log"
cat "$out/stayon.log"
[ "$rc" -eq 0 ] || exit "$rc"
adb -s "$serial" shell 'sha256sum /data/local/tmp/govhtp/onecopy-v73b/bin/llama-perplexity /data/local/tmp/govhtp/onecopy-v73b/dsp/libggml-htp-v73.so /data/local/tmp/govhtp/input/kld_english_fixture.txt /data/local/tmp/govhtp/input/cause-cpu-base.logits' > "$out/payload-sha256.log" 2>&1
rc=$?
echo "HASH_EXIT=$rc" >> "$out/payload-sha256.log"
cat "$out/payload-sha256.log"
[ "$rc" -eq 0 ] || exit 40

run_arm rawq4-kld raw-host || exit $?
run_arm twocopy-kld normal || exit $?
run_arm twocopy-no-repack-kld normal-no-repack || exit $?
gate session-postflight
