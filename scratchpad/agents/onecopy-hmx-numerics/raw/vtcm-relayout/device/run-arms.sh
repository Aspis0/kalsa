# Speed ABBA. Source env.sh and this file in ONE adb shell (the functions live in env.sh), unplugged,
# screen on, thermal 0, persist.traced.enable 0:
#   . /data/local/tmp/govhtp/onecopy-pair/env.sh; . $D/run-arms.sh
# Gates (every failure writes its reason to $D/speed.txt and aborts the session, never falls through):
#   probesanity  probes 0/16/32 must reach three different decode dots before arms I/F mean anything
#   waitcool     no arm starts above 33.0 C battery temp (10 min max wait)
#   runarm       llama-bench exit 0, tg128 + pp512 lines, init env line with this arm's RAWROW_PROBE,
#                zero error-pattern lines, pp512 inside $PP512_LO-$PP512_HI for one-copy arms
# Arms (llama-bench tg128 / pp512, -r 3), all one copy / base env unless noted:
#   T  two copies, new build                              reference, ~22.1
#   O  df538c50c binaries (OLD)                           ~15.6: what the new build is measured against
#   N  new build, two rows share the scale multiply       the change (RAWROW_PROBE unset)
#   L  new build, RAWROW_PROBE=8                          the dot before pairing, same binary as N
#   I  new build, RAWROW_PROBE=16                         integer stage only (loads, nibbles, vrmpy); output garbage
#   F  new build, RAWROW_PROBE=32                         float tail only (scale fan-out, multiplies); output garbage
#   S  new build, RAWROW_PROBE=1                          dot skipped: the DMA + arrangement floor, ~22.5; output garbage
# Order: T O N L I F S, then reversed (S F I L N O T): every arm runs once on each side of every other.
abort() { echo "SESSION ABORTED: $*" | tee -a $D/speed.txt; exit 1; }
arm() { runarm "$@" || abort "arm $1: gate failed (reason above)"; }
rm -f $D/speed.txt
probesanity || abort "probe sanity: probes 0/16/32 not distinguishable (see $D/probe0.log $D/probe16.log $D/probe32.log)"
arm T  $D   $TWO
arm O  $OLD $ONE
arm N  $D   $ONE
arm L  $D   $ONE GGML_HEXAGON_RAWROW_PROBE=8
arm I  $D   $ONE GGML_HEXAGON_RAWROW_PROBE=16
arm F  $D   $ONE GGML_HEXAGON_RAWROW_PROBE=32
arm S  $D   $ONE GGML_HEXAGON_RAWROW_PROBE=1
arm S2 $D   $ONE GGML_HEXAGON_RAWROW_PROBE=1
arm F2 $D   $ONE GGML_HEXAGON_RAWROW_PROBE=32
arm I2 $D   $ONE GGML_HEXAGON_RAWROW_PROBE=16
arm L2 $D   $ONE GGML_HEXAGON_RAWROW_PROBE=8
arm N2 $D   $ONE
arm O2 $OLD $ONE
arm T2 $D   $TWO
