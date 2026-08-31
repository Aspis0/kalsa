Exact command lines of cell 793229 (audit fix F8/F20).

Per-invocation, on device via run_vl_793229.sh (archived copy of the pushed
/data/local/tmp/kalsa/run_vl.sh):
  export LD_LIBRARY_PATH=/data/local/tmp/kalsa
  ./llama-mtmd-cli -m vl3b.gguf --mmproj vl3b-mmproj.gguf --image test_image.jpg \
    -p "Describe the image in one sentence." -n 128 --temp 0 --seed 42 \
    --ignore-eos -t 8 <ARM_FLAGS> > vl_<ARM>_<TAG>.out 2>&1; echo $? > .exit
  ARM_FLAGS: C = "-ngl 0 --no-mmproj-offload"; A = "-ngl 99";
             M = "-ngl 99 --no-mmproj-offload"
Orchestration (gate, launch, poll, post-snapshot, pull): drive_vl_793229.sh,
invoked C 1; A 1; M 1; M 2; A 2; C 2; A 3; M 3; C 3 (serial eb49fb9d).

Terminal captures (orchestrator transcript; on-device output not persisted):
- kit push: "vl-kit-556118a08.tgz: 1 file pushed, 0 skipped. 6.0 MB/s
  (4204029 bytes in 0.666s)"
- kit verify: "llama-mtmd-cli: OK / libomp.so: OK / test_image.jpg: OK /
  KIT_OK" (sha256sum -c SHA256SUMS, 3/3)
- Mac smoke exits: vl_smoke.log run exit=0; vl_smoke4.log run exit=0
  (both echoed by `echo "exit=$?"` right after the invocation)

mtmd-cli timing patch: mtmd_timing_patch_556118a08.diff (git show 556118a08).
Determinism-probe hashes: text_hashes_793229.txt, produced by extract_text.py
(the exact extraction rule; audit fix F14).
