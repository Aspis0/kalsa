# Speed ABBA. Source env.sh and this file in ONE adb shell (the functions live in env.sh), unplugged,
# screen on, thermal 0, persist.traced.enable 0:
#   . /data/local/tmp/govhtp/onecopy-pair/env.sh; . $D/run-arms.sh
# Arms (llama-bench tg128 / pp512, -r 3), all one copy / base env unless noted:
#   T  two copies, new build                              reference, ~22.1
#   O  df538c50c binaries (OLD)                           ~15.6: what the new build is measured against
#   N  new build, two rows share the scale multiply       the change (RAWROW_PROBE unset)
#   L  new build, RAWROW_PROBE=8                          the dot before pairing, same binary as N
#   I  new build, RAWROW_PROBE=16                         integer stage only (loads, nibbles, vrmpy); output garbage
#   F  new build, RAWROW_PROBE=32                         float tail only (scale fan-out, multiplies); output garbage
#   S  new build, RAWROW_PROBE=1                          dot skipped: the DMA + arrangement floor, ~22.5; output garbage
# Order: T O N L I F S, then reversed (S F I L N O T): every arm runs once on each side of every other.
rm -f $D/speed.txt
runarm T  $D   $TWO
runarm O  $OLD $ONE
runarm N  $D   $ONE
runarm L  $D   $ONE GGML_HEXAGON_RAWROW_PROBE=8
runarm I  $D   $ONE GGML_HEXAGON_RAWROW_PROBE=16
runarm F  $D   $ONE GGML_HEXAGON_RAWROW_PROBE=32
runarm S  $D   $ONE GGML_HEXAGON_RAWROW_PROBE=1
runarm S2 $D   $ONE GGML_HEXAGON_RAWROW_PROBE=1
runarm F2 $D   $ONE GGML_HEXAGON_RAWROW_PROBE=32
runarm I2 $D   $ONE GGML_HEXAGON_RAWROW_PROBE=16
runarm L2 $D   $ONE GGML_HEXAGON_RAWROW_PROBE=8
runarm N2 $D   $ONE
runarm O2 $OLD $ONE
runarm T2 $D   $TWO
