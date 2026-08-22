#!/data/data/com.termux/files/usr/bin/bash
# marco_dump_command.sh — exact B1 dump provenance for hostile-review FIX 1
# Device: Xiaomi 14 (houji / 23127PN0CG), run-as com.termux
# Date: 2026-08-11T01:02:22-04:00
# EXIT code of working dump: 0
#
# python3 --version → Python 3.14.6
#
# MANDATE command (as written) FAILED on this tree:
#   - path gguf-py/scripts/gguf_dump.py does NOT exist
#   - actual stock path: $HOME/llama.cpp/gguf-py/gguf/scripts/gguf_dump.py
#   - stock_sha256: d8b8fc28e96d15d8a4d6f05cdff4a747f5a06f31172efee9dfc971998ed0203f
#   - stock head (first lines):
#       #!/usr/bin/env python3
#       from __future__ import annotations
#       import logging
#       import argparse
#       ...
#       from gguf import GGUFReader, GGUFValueType, ReaderTensor
#   - stock attempt: EXIT=1  ModuleNotFoundError: No module named 'numpy'
#   - /sdcard/Download write: Permission denied under u:r:runas_app:s0 (SELinux)
#   - HOME under run-as must be /data/data/com.termux/files/home (NOT /data/user/0/com.termux)
#
# WORKING command (same tool that produced original marco_gguf_dump.txt):
#   tool: $HOME/logs/gguf_types_only.py
#   tool_sha256: 465fd71748d8b004fe2dffaf3cab489c8d3d6df675a423968addc537117806d9
#   tool recognizes (type map extras, NOT present in this model): F16, BF16, Q8_0, ...
#   model tensors actually present: F32, Q5_K, IQ2_S, IQ3_S, Q4_K only
#
# Cross-check vs original marco_gguf_dump.txt: IDENTICAL type counts
#   NONEXP: F32=141, IQ2_S=56, IQ3_S=28, Q4_K=28, Q5_K=1
#   EXPERT: IQ2_S=81, IQ3_S=3
#   total tensors: 338  (n_tensors header matches)
#   discrepancy: none
#
# Outputs pulled to PC:
#   results/gpu_xiaomi/logs/marco_dump_v2.txt
#   results/gpu_xiaomi/logs/marco_dump_v2.err   (EXIT=0)
#   results/gpu_xiaomi/logs/gguf_types_only.py  (tool source)

export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
export LD_LIBRARY_PATH=$PREFIX/lib
export HOME=/data/data/com.termux/files/home
export DEBIAN_FRONTEND=noninteractive

MODEL=$HOME/models/Marco-Mini-Instruct.i1-IQ2_M.gguf
OUT=$HOME/logs/marco_dump_v2.txt
ERR=$HOME/logs/marco_dump_v2.err
TOOL=$HOME/logs/gguf_types_only.py

python3 --version
sha256sum "$TOOL"

# header is already present in marco_dump_v2.txt; re-run body only if needed:
python3 "$TOOL" "$MODEL" > "$OUT.body" 2> "$ERR"
echo EXIT=$? >> "$ERR"

# Host-side pull (from PC; run-as private dir not readable by adb pull):
#   adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp shell \
#     "run-as com.termux cat /data/data/com.termux/files/home/logs/marco_dump_v2.txt" \
#     > moe-experiments/results/gpu_xiaomi/logs/marco_dump_v2.txt
#   adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp shell \
#     "run-as com.termux cat /data/data/com.termux/files/home/logs/marco_dump_v2.err" \
#     > moe-experiments/results/gpu_xiaomi/logs/marco_dump_v2.err

# Full adb wrapper that was used for this fix (adapted from mandate; HOME/path corrected):
# adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp shell \
#   "run-as com.termux /data/data/com.termux/files/usr/bin/bash --noprofile --norc -c '
#     export PREFIX=/data/data/com.termux/files/usr
#     export PATH=\$PREFIX/bin:\$PATH
#     export LD_LIBRARY_PATH=\$PREFIX/lib
#     export HOME=/data/data/com.termux/files/home
#     export DEBIAN_FRONTEND=noninteractive
#     python3 \$HOME/logs/gguf_types_only.py \
#       \$HOME/models/Marco-Mini-Instruct.i1-IQ2_M.gguf \
#       > \$HOME/logs/marco_dump_v2.txt \
#       2> \$HOME/logs/marco_dump_v2.err
#     echo EXIT=\$? >> \$HOME/logs/marco_dump_v2.err
#   '"
