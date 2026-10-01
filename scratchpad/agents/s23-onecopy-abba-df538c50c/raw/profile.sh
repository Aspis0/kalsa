R=/data/local/tmp/govhtp
D=$R/onecopy-abba
export LD_LIBRARY_PATH=$R/lib
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
M=/data/local/tmp/heat3way/ship.gguf
prof() { name=$1; shift
  input keyevent 224; sleep 2
  echo "== prof $name start $(date +%s)" >> $D/profile.txt
  env GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_PROFILE=1 GGML_HEXAGON_VERBOSE=1 "$@" \
    $D/bin/llama-bench -m $M -p 0 -n 32 -r 1 -t 5 -ngl 99 -dev HTP0 --load-mode none -v > $D/profile_$name.log 2>&1
  echo "exit=$?" >> $D/profile.txt
  grep -c "hvx-rawrow" $D/profile_$name.log >> $D/profile.txt
  grep -m2 -E "raw-row matvec paths" $D/profile_$name.log >> $D/profile.txt
  grep -m1 -E "hvx-tiled" $D/profile_$name.log >> $D/profile.txt
  input keyevent 224
  echo "== prof $name after $(date +%s)" >> $D/profile.txt
  sleep 60; }
rm -f $D/profile.txt
