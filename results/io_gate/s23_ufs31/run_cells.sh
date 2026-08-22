#!/system/bin/sh
set -eu
BIN=/data/local/tmp/kalsaio/iogate_ufs4
FILE=/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf
OUT=/data/local/tmp/kalsaio
cd "$OUT"
run_cell() {
  name=$1
  mode=$2
  "$BIN" "$FILE" "$mode" 2000 983040 14 > "${name}.out" 2> "${name}.err"
  echo $? > "${name}.rc"
}
run_cell cell_01_seq seq
run_cell cell_02_rand rand
run_cell cell_03_seq seq
run_cell cell_04_rand rand
run_cell cell_05_seq seq
run_cell cell_06_rand rand
echo DONE
