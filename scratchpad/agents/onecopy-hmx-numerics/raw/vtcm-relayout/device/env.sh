# Source on the phone (adb shell): . /data/local/tmp/govhtp/onecopy-pair/env.sh
# Same recipe as s23-onecopy-abba-df538c50c/raw/env.sh; the binaries it runs are a PAIR (host binary +
# skel), so every arm names the directory both come from.
R=/data/local/tmp/govhtp
D=$R/onecopy-pair            # the new build (engine spike/onecopy-hmx-raw, this change)
OLD=$R/onecopy-abba          # df538c50c, already on the phone (sha256 in the ABBA report)
export LD_LIBRARY_PATH=$R/lib
M=/data/local/tmp/heat3way/ship.gguf
ONE="GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_HOSTBUF=1"   # one copy, base env
TWO="GGML_HEXAGON_OPFUSION=0"                                                  # two copies

# Session gates. COOL_* is what waitcool enforces; PP512_* is the one-copy prefill band measured in
# the df538c50c ABBA (856.2-861.6 over every one-copy run) - the two-copy arms have their own
# 878.3-882.4 band and are not gated.
COOL_MAX_TEMP=330     # tenths of a degree C: never start an arm above 33.0 C
COOL_TRIES=20         # give up after COOL_TRIES * COOL_SLEEP = 10 min and abort, never run hot
COOL_SLEEP=30
PP512_LO=856
PP512_HI=862
ERRPAT='dsp-error|NO-SUPPORT|CRASH|GGML_ABORT|Segmentation'

st() { dumpsys battery | grep 'Sending ACTION_BATTERY_CHANGED' | tail -1 | sed -nE 's/.*level:([0-9]+),.*ac:([a-z]+),.*usb:([a-z]+),.*wireless:([a-z]+),.*temperature:([0-9]+),.*/lvl=\1 ac=\2 usb=\3 wl=\4 batT=\5/p' | tr -d '\n'; sk=$(dumpsys thermalservice | grep 'mName=SKIN' | tail -1 | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p'); echo -n " skin=$sk wake=$(dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2) thermal=$(dumpsys thermalservice | grep '^Thermal Status' | tail -1 | sed -nE 's/.*: ([0-9]+).*/\1/p') traced=$(getprop persist.traced.enable)"; }

# waitcool: block until the battery is at COOL_MAX_TEMP tenths; after COOL_TRIES * COOL_SLEEP s it
# FAILS (return 1) instead of falling through - a hot arm is never run (the ABBA had to rerun three
# arms that overshot 33.0 C).
waitcool() {
  i=0
  while [ $i -lt $COOL_TRIES ]; do
    t=$(dumpsys battery | grep -m1 'temperature' | sed -nE 's/.*temperature: ([0-9]+).*/\1/p')
    [ "${t:-999}" -le $COOL_MAX_TEMP ] && return 0
    input keyevent 224   # the session runs with the screen on, including during the wait
    sleep $COOL_SLEEP; i=$((i + 1))
  done
  echo "waitcool: battery ${t:-unknown} tenths > $COOL_MAX_TEMP after $((COOL_TRIES * COOL_SLEEP / 60)) min - refusing to start the arm"
  return 1
}

# probe_sig P: one KLD run at GGML_HEXAGON_RAWROW_PROBE=P against the CPU base logits. Logs the
# evidence to $D/speed.txt and echoes the signature; fails (echoing nothing) unless the run exited
# clean, hit the raw-row kernel and logged no error pattern.
probe_sig() {
  p=$1
  input keyevent 224
  env $ONE GGML_HEXAGON_RAWROW_PROBE=$p GGML_HEXAGON_VERBOSE=1 $D/bin/llama-perplexity -m $M \
    -f $R/input/kld_english_fixture.txt -c 512 -b 512 -ub 1 -ngl 99 -dev HTP0 -lm none --no-warmup \
    --chunks 1 --kl-divergence-base $R/input/cause-cpu-base.logits --kl-divergence -lv 5 \
    > $D/probe$p.log 2>&1
  rc=$?
  raw=$(grep -c 'hvx-rawrow' $D/probe$p.log)
  errs=$(grep -c -E "$ERRPAT" $D/probe$p.log)
  sig=$(grep -E 'Mean +KLD|Maximum KLD|Same top p|Mean PPL\(Q\)' $D/probe$p.log | tr '\n' ';')
  echo "probe=$p exit=$rc hvx-rawrow=$raw errors=$errs sig=[$sig]" >> $D/speed.txt
  if [ "$rc" -eq 0 ] && [ "${raw:-0}" -gt 0 ] && [ "$errs" -eq 0 ] && [ -n "$sig" ]; then
    echo "$sig"
    return 0
  fi
  return 1
}

# probesanity: prove on the device, before the ABBA spends arms I/F on them, that RAWROW_PROBE 0/16/32
# reach three different decode dots. Signal: the KLD signature of a -ub 1 --chunks 1 run - ub 1 sends
# every token through the raw-row decode kernel, the only consumer of the probe, and the three dots
# are different functions of the same activations, so their signatures must be pairwise different.
# The build has no cheaper tell: llama-bench prints no tokens and no log line names the dot (the
# verbose op line says only "hvx-rawrow vtcm <n>"), while this signature is deterministic run to run.
probesanity() {
  echo "== probe-sanity start $(date +%s) [$(st)]" >> $D/speed.txt
  s0=$(probe_sig 0);   r0=$?
  sleep 30
  s16=$(probe_sig 16); r16=$?
  sleep 30
  s32=$(probe_sig 32); r32=$?
  if [ $r0 -ne 0 ] || [ $r16 -ne 0 ] || [ $r32 -ne 0 ]; then
    echo "probe-sanity INVALID: a probe run failed its exit/raw-row/error gates (probe0=$r0 probe16=$r16 probe32=$r32)" | tee -a $D/speed.txt
    return 1
  fi
  if [ "$s0" = "$s16" ] || [ "$s0" = "$s32" ] || [ "$s16" = "$s32" ]; then
    echo "probe-sanity INVALID: KLD signatures not pairwise distinct s0=[$s0] s16=[$s16] s32=[$s32]" | tee -a $D/speed.txt
    return 1
  fi
  echo "probe-sanity PASS: probes 0/16/32 reached three different decode dots" >> $D/speed.txt
  sleep 30
}

# runarm NAME BINDIR ENV... : one tg128 / pp512 llama-bench arm, 90 s gap. Every result gate is
# checked here; a failing gate writes `INVALID NAME: <reasons>` (or `GATE-FAIL NAME: ...`) to
# $D/speed.txt, prints it and returns 1 so run-arms.sh aborts the session - a bad arm never passes
# as data (audit 4.3/4.4).
runarm() {
  name=$1; bin=$2; shift 2
  export ADSP_LIBRARY_PATH="$bin/dsp;$R/lib"
  if ! waitcool; then
    echo "GATE-FAIL $name: battery above $COOL_MAX_TEMP tenths after $((COOL_TRIES * COOL_SLEEP / 60)) min; arm not started" | tee -a $D/speed.txt
    return 1
  fi
  want=0; onecopy=0
  for a in "$@"; do
    case $a in
      GGML_HEXAGON_RAWROW_PROBE=*) want=${a#*=} ;;
      GGML_HEXAGON_RAW_HMX=1)      onecopy=1 ;;
    esac
  done
  input keyevent 224; sleep 2
  echo "== $name start $(date +%s) [$(st)]" >> $D/speed.txt
  env "$@" toybox time -v $bin/bin/llama-bench -m $M -p 512 -n 128 -ub 512 -r 3 -t 5 -ngl 99 -dev HTP0 --load-mode none > $D/speed_$name.log 2>&1
  rc=$?
  echo "exit=$rc" >> $D/speed.txt
  grep -m1 'memory-path env:' $D/speed_$name.log >> $D/speed.txt
  grep -E 'pp512|tg128|Max RSS' $D/speed_$name.log >> $D/speed.txt
  errs=$(grep -c -E "$ERRPAT" $D/speed_$name.log)
  echo "errors=$errs" >> $D/speed.txt
  bad=
  [ $rc -ne 0 ] && bad="$bad llama-bench-exit=$rc"
  grep -q 'tg128' $D/speed_$name.log || bad="$bad no-tg128-line"
  grep -q 'pp512' $D/speed_$name.log || bad="$bad no-pp512-line"
  case "$(grep -m1 'memory-path env:' $D/speed_$name.log)" in
    *"RAWROW_PROBE=$want") ;;
    *) bad="$bad init-env-line-missing-or-want-RAWROW_PROBE=$want" ;;
  esac
  [ "$errs" -eq 0 ] || bad="$bad errors=$errs"
  pp=$(sed -nE 's/.*\| *pp512 *\| *([0-9]+\.[0-9]+) .*/\1/p' $D/speed_$name.log | head -1)
  if [ $onecopy -eq 1 ]; then
    if [ -z "$pp" ]; then
      bad="$bad no-pp512-value"
    else
      # llama-bench prints t/s as "%.2f": drop the dot, compare hundredths in shell arithmetic
      pp100=$(printf '%s' "$pp" | tr -d '.')
      lo100=$((PP512_LO * 100)); hi100=$((PP512_HI * 100))
      if [ "$pp100" -ge "$lo100" ] && [ "$pp100" -le "$hi100" ]; then
        echo "gate=pp512 $pp in $PP512_LO-$PP512_HI" >> $D/speed.txt
      else
        bad="$bad pp512=$pp-outside-$PP512_LO-$PP512_HI"
      fi
    fi
  fi
  if [ -n "$bad" ]; then
    echo "INVALID $name:$bad" | tee -a $D/speed.txt
    return 1
  fi
  input keyevent 224; sleep 2
  echo "== $name after  $(date +%s) [$(st)]" >> $D/speed.txt
  sleep 90
}
