# step1-s23 — TILE32 placement, NPU one-copy and the three CPU layouts (2026-10-04)

Step 1 check (PLAN-INTEGRATION step 1, FABLE-DESIGN Amendment A item 6): with
`GGML_HEXAGON_HOSTBUF_REPACK=1` the Hexagon device exposes a non-host `HTP0-TILE32` buffer type
and llama's placement probe puts the Q4_0 MUL_MAT weights there without `-ot`. The session proves
that placement and measures the NPU one-copy against the two-copy reference, then measures the CPU
leg in three layouts — native, repacked and tiled (C-tile) — at 1 and 5 threads.

Engine: `kalsallama-gov-onecopy`, branch `feat/governor-onecopy`, HEAD `e9d7a9f45` (2026-10-04
21:34) or later. Not edited by this session. The commits this session needs:

- `edd25cb16` — `-ot <pattern>=HTP0-TILE32` parses: the buft maps in `common/arg.cpp:266-280` and
  `tools/llama-bench/llama-bench.cpp:957-972` enumerate each device's extra bufts through the same
  `ggml_backend_dev_get_extra_bufts` proc-address lookup `llama-model.cpp:1150-1165` uses.
- `1ce488134` (+ `e9d7a9f45`, which gates it on `params->ith == 0`) — the CPU proof line, once per
  weight tensor and batch width: `ggml-cpu: tile32 MUL_MAT tensor=<name> ne=<ne00>x<ne01>
  ne11=<ne11>` (`ggml/src/ggml-cpu/tile32.cpp:128`).
- `d6df25c2c` — the leftover T32DBG decline print is gone, so nothing prints on the normal path.

Artifacts (already built; `push-and-check.sh` verifies the sha256 on the phone):

| file | sha256 | built |
|---|---|---|
| `build-gateg/bin/llama-bench` | `705153797d28c27877b13ac5f270aa64775c5c18427b60ca21c2174c4a09b4ee` | 2026-10-04 21:40:55 |
| `build-gateg/bin/llama-perplexity` | `794a302d60ca69cfc8fd6b0ca320b3fa801b134b116fbbddc22195321bd43691` | 2026-10-04 21:43:18 |
| `build-gateg/ggml/src/ggml-hexagon/libggml-htp-v73.so` (debug skel, proofs) | `d40e98c64ff543ca03e265331976e1204def8e7840d2b00c8c8e6dc31ef09d5c` | 2026-10-04 14:02 |
| `build-gateg-rel/ggml/src/ggml-hexagon/libggml-htp-v73.so` (release skel, timed) | `61c8d6f592786302b257d0d5676d992efcb21bde68aad2cde22447c3fedca640` | 2026-10-04 17:23 |

Both skels are byte-identical to gate G's (the tile layout is a shared header since step 0; the DSP
code did not change). The two binaries were relinked while the fix series landed; the table is a
snapshot (`push-and-check.sh` compares the live build dir against the phone, so a rebuild is safe).
Evidence they contain the series: both hold the `tile32 MUL_MAT tensor=` string, and
`build-gateg/common/CMakeFiles/llama-common.dir/arg.cpp.o` and
`build-gateg/tools/llama-bench/CMakeFiles/llama-bench-impl.dir/llama-bench.cpp.o` were compiled at
21:22, after `edd25cb16` (21:09). If either is rebuilt again, re-read the hashes before pushing.
Model `/data/local/tmp/heat3way/ship.gguf`, fixture `$R/input/kld_english_fixture.txt` and base
logits `$R/input/cause-cpu-base.logits` are already on the phone from the gate-G session.

## Run (Marco runs the phone; one adb shell, unplugged, screen on)

```
REL_SKEL=~/Projects/kalsallama-gov-onecopy/build-gateg-rel/ggml/src/ggml-hexagon/libggml-htp-v73.so \
  ~/Projects/kalsa-moe-experiments/scratchpad/agents/onecopy-three-legs/step1-s23/push-and-check.sh [serial]
adb -s <serial> shell          # then, on the phone:
. /data/local/tmp/govhtp/step1-s23/run-step1.sh
```

`push-and-check.sh` pushes the two binaries, the two skels and the three device scripts (`env.sh`,
`run-step1.sh`, `cpu-arms.sh`). Everything lands in
`/data/local/tmp/govhtp/step1-s23/step1_report.txt` plus per-run logs next to it. A failing proof
or arm aborts the session; the CPU arm functions live in `cpu-arms.sh`, sourced by `run-step1.sh`.

## Arms (exact command lines as run; `$D=/data/local/tmp/govhtp/step1-s23`, `$R=/data/local/tmp/govhtp`, `$M=/data/local/tmp/heat3way/ship.gguf`, `$OT='proj.weight|ffn_gate|ffn_up|ffn_down|attn_q.weight|attn_k.weight|attn_v.weight|attn_output=HTP0-TILE32'`)

NPU proofs run first with `GGML_HEXAGON_PROFILE=1 GGML_HEXAGON_VERBOSE=1` and the debug skel
(`ADSP_LIBRARY_PATH=$D/dsp;$R/lib`); timed arms run with the release skel
(`ADSP_LIBRARY_PATH=$D/dsp-rel;$R/lib`).

| arm | command |
|---|---|
| NPU A proof | `llama-bench -m $M -p 0 -n 32 -ub 512 -r 1 -t 1 -ngl 99 -dev HTP0 -v` then `-p 512 -n 0 ...` |
| NPU T proof | `GGML_HEXAGON_HOSTBUF_REPACK=1` + the same two commands |
| NPU A bench+KLD | `toybox time -v llama-bench -m $M -p 512 -n 128 -ub 512 -r 3 -t 5 -ngl 99 -dev HTP0` then `llama-perplexity -m $M $KLD_ARGS` |
| NPU T bench+KLD | `GGML_HEXAGON_HOSTBUF_REPACK=1` + the same two commands |
| C-native proof | `llama-bench -m $M -p 0 -n 32 -ub 128 -r 1 -t 1 -ngl 0 -nr -v` |
| C-repack proof | the same with `-ngl 0` (no `-nr`) |
| C-tile proof | `GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_OPFILTER='.*' llama-bench -m $M -p 0 -n 32 -ub 128 -r 1 -t 5 -ngl 99 -dev HTP0 -nkvo 1 -ot '$OT' -v` then the same with `-p 128 -n 0` |
| C-native bench | `toybox time -v llama-bench -m $M -p 128 -n 128 -ub 128 -r 3 -t {1,5} -ngl 0 -nr` |
| C-repack bench | the same with `-ngl 0` (no `-nr`) |
| C-tile bench | `GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_OPFILTER='.*' toybox time -v llama-bench -m $M -p 128 -n 128 -ub 128 -r 3 -t {1,5} -ngl 99 -dev HTP0 -nkvo 1 -ot '$OT'` |
| C-native KLD | `llama-perplexity -m $M $KLD_ARGS_CPU -ngl 0 -nr` |
| C-repack KLD | the same without `-nr` |
| C-tile KLD | `GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_OPFILTER='.*' llama-perplexity -m $M $KLD_ARGS_CPU -ngl 99 -dev HTP0 -nkvo -ot '$OT'` |

`$KLD_ARGS` (gate G, unchanged): `-f $FIXT -c 512 -b 512 -ub 1 -ngl 99 -dev HTP0 --no-warmup
--chunks 2 --kl-divergence-base $BASELOGITS --kl-divergence -lv 5`. `$KLD_ARGS_CPU` is the same
minus `-ngl 99 -dev HTP0` (the device flags are per-arm), with `-t 5`. The C-tile `-ot` pattern is
gate G's 166 Q4_0 matrices (`gate-g/env.sh` arm B; 1369571328 B in `onecopy-three-legs/REPORT.md`),
only the buft changes HOST → TILE32.

Order: proofs A / T / c_native / c_repack / c_tile; NPU **A T T2 A2** (bench+KLD per leg, release
skel); CPU **-t 1** `c_native c_tile c_repack c_repack2 c_tile2 c_native2` (bench only, so the
ABBA timing stays tight — the order is ABBA for every pair), KLD `c_native c_repack c_tile`, CPU
**-t 5** the same six benches.

## Why these flags (decisions with the code that decides them)

- **NPU T needs only `GGML_HEXAGON_HOSTBUF_REPACK=1`.** It is the gate on the extra-buft list:
  `if (!opt_hostbuf_repack) { return none; } ... dev_ctx->extra_bufts[0] =
  &dev_ctx->tile32_buffer_type` (`ggml-hexagon.cpp:7194-7202`). `llama-model.cpp:1150-1165`
  (`make_gpu_buft_list`) offers a device's extra bufts before its default buft, so the placement
  probe (`select_weight_buft`, `llama-model-loader.cpp:1060-1071`) sees TILE32 first and accepts
  it for a 2-D Q4_0 MUL_MAT weight (`ggml-hexagon.cpp:6732-6744` then
  `ggml_hexagon_supported_mul_mat`, `:4979`).
- **`GGML_HEXAGON_HOSTBUF` is not needed.** It only enables the device HOST buft:
  `if (!opt_hostbuf) { return NULL; }` (`ggml-hexagon.cpp:6584-6588`). The probe never selects a
  buft that is not in the list built by `make_gpu_buft_list`/`make_cpu_buft_list`; HOST is in
  neither, it is reachable only through a `-ot ...=HTP0-HOST` override.
- **`-lm none` is not needed.** Under mmap, a buft is only directly mapped when it is the device
  default buft: `bool is_default_buft = buft == ggml_backend_dev_buffer_type(dev);` and
  `if ((ml.use_mmap || is_lazy_mapped) && use_mmap_buffer && buffer_from_host_ptr_supported &&
  is_default_buft)` (`llama-model.cpp:1771,1778`). TILE32 fails `is_default_buft`, so it takes the
  else branch (`ggml_backend_alloc_ctx_tensors_from_buft`), the tensors have real addresses, and
  `load_all_data` picks the set path — `if (buf_mmap && cur->data == nullptr) {
  ggml_backend_tensor_alloc(...) } else { ggml_backend_tensor_set(cur, data, 0, n_size); }`
  (`llama-model-loader.cpp:1650-1664`) — which calls the TILE32 `set_tensor` and packs. With the
  HTP device present, load mode AUTO drops mmap anyway: `if (ml.use_mmap && params.load_mode ==
  LLAMA_LOAD_MODE_AUTO) { ... if (!props.caps.mmap_support) { ml.use_mmap = false; break; } }`
  (`llama-model.cpp:1446-1452`) with `/* .mmap_support = */ false`
  (`ggml-hexagon.cpp:6574`).
- **C-tile needs the `-ot` override because `GGML_HEXAGON_OPFILTER` also declines the placement
  probe.** Placement happens only through llama's probe, which calls the HTP's `supports_op` with a
  dummy buffer of the buft under test (`llama-model-loader.cpp:1048-1053`), and OPFILTER is the
  first check inside that function: `if (opt_opfilter &&
  std::regex_match(ggml_op_desc(op), *opt_opfilter)) { return false; }`
  (`ggml-hexagon.cpp:6722`; the regex is `new std::regex(str_opfilter, RE_ICASE)`,
  `:7407`). An override bypasses the probe entirely: `buft = overrides->buft;`
  (`llama-model-loader.cpp:1243`). So this arm is the mirror of arm T — `-ot` places TILE32, the
  probe never runs for those matrices, and the CPU computes over the tiles.
- **The OPFILTER pattern is `.*`, not `MUL_MAT`.** Refusing only MUL_MAT would leave norms,
  FLASH_ATTN and conv on the device buft and the graph would be a mix; `.*` refuses every op, so
  the non-overridden tensors fall through the probe to the CPU bufts. Every GPU buft list gets
  those appended as a fallback (`llama-model.cpp:1480-1481`), and CPU_REPACK declines them too (it
  supports only 2-D MUL_MAT weights in its own buffer, `ggml-cpu/repack.cpp:5408-5439`), so f32
  norms/conv and Q6_K `token_embd` read native CPU.
- **`-nkvo` keeps the KV on the CPU.** KV is allocated in the layer device buft unless offload is
  off: `if (offload) { auto * dev = model.dev_layer(il); buft =
  ggml_backend_dev_buffer_type(dev); }` (`llama-kv-cache.cpp:239-246`). With KV in HTP0 and every
  HTP op refused, the KV leaf would be a pre-allocated tensor whose buft cannot run its op and the
  scheduler aborts (`ggml-backend.cpp:947-950`).
- **The tiled MUL_MAT lands on the CPU in `backend_from_buffer`.** For a WEIGHTS src the scheduler
  takes the first backend in priority order that supports the buffer type *and* the op
  (`ggml-backend.cpp:897-910`, `:970-985`): HTP0 supports its own buft but OPFILTER declines the
  op, the CPU accepts both (`ggml_backend_cpu_device_supports_buft`,
  `ggml-cpu.cpp:488-492`: host buft, CPU extra bufts, or TILE32 layout with `ggml_cpu_has_dotprod()`;
  S23 v73 has dotprod). Compute dispatch is `ggml_cpu/traits.cpp:21-25` →
  `ggml_cpu_tile32_compute_forward`.
- **`-nkvo 1` in llama-bench, `-nkvo` in llama-perplexity.** llama-bench's own parser consumes a
  value for `-nkvo` (`llama-bench.cpp:842-848`), the common parser takes it as a negated flag
  (`common/arg.cpp:2428-2435`); passing the wrong form fails argument parsing.
- **The OPFILTER regex is passed by an `env` function, not by a variable.** Two shell facts, both
  verified locally: `v="GGML_HEXAGON_OPFILTER='.*'"; env $v ...` hands the engine the five
  characters `'.*'` (quotes inside a variable are data, so `regex_match` matches nothing), and
  `v="GGML_HEXAGON_OPFILTER=.*"; env $v ...` pathname-expands the `*` if a file named
  `GGML_HEXAGON_OPFILTER=.something` exists. `arm_env_tile()` quotes the value at the call site
  (`env.sh`), so the engine always receives `.*`. The `-ot` value needs no such care: it has no
  glob character, and gate G's scripts passed the same pattern through a variable.
- **C-native disables repack with llama-bench's `-nr`**: `params.no_repack.push_back(true)`
  (`llama-bench.cpp:912-914`) and `mparams.use_extra_bufts = !no_repack` (`:1270`). The CPU buft
  list adds the CPU's extra bufts (CPU_REPACK) only `if (use_extra_bufts)`
  (`llama-model.cpp:1092-1110`). In the app the same switch is
  `mparams.use_extra_bufts = !params.no_extra_bufts` (`common/common.cpp:1706`), which
  `rn-llama.cpp` sets for the S23 decode model.
- **CPU KLD runs at `-t 5`**: KLD is a correctness gate, not a timing, and 1024 tokens at 1 thread
  would add ~15 min to the session. Documented here so the number is not mistaken for a -t 1 run.

## Proof lines (a missing/extra line fails the arm and aborts the session)

| proof | where | grep |
|---|---|---|
| TILE32 placement (arm T and C-tile; must be absent in A and in both shipped CPU arms) | every `-v` log | `grep -c 'HTP0-TILE32 model buffer size'`; floor 1000 MiB (gate G packed 1369571328 B = 1306.1 MiB of the same 166 matrices) |
| CPU reads the tiles (C-tile proof) | `proof_c_tile_decode.log` and `proof_c_tile_prefill.log` | `grep -c 'ggml-cpu: tile32 MUL_MAT tensor=.* ne11=1$'` > 0 and a line with `ne11>1` > 0; the report also prints the distinct-tensor count (gate G's pattern places 166) |
| no HTP op (C-tile proof, `GGML_HEXAGON_PROFILE=1`) | both C-tile proof logs | `grep -c 'profile-op'` = 0, `grep -c 'profile-op MUL_MAT'` = 0 |
| no HOST buft anywhere | every `-v` log | `grep -c 'HTP0-HOST model buffer size'` must be 0 |
| decode kernel family (NPU arms) | `proof_decode_*.log` | `grep 'profile-op MUL_MAT'` → `hvx-tiled\|hmx-tiled` > 0, `hvx-flat` = 0 |
| prefill HMX (NPU arms) | `adsprpc_*.log` (FARF mask `0x1F` during the prefill pass, as gate G) | `grep -c 'hmx-mm-2d:'` > 0 |
| graph splits (NPU arms) | `proof_decode_*.log` | `grep -m1 'graph splits'` ≤ `MAX_SPLITS` (4; gate G measured 2) |
| CPU layout | `proof_c_*.log` | c_repack: `grep -c 'CPU_REPACK model buffer size'` > 0; c_native: = 0; both: no `HTP0` buffer lines |
| errors | all logs | `ERRPAT='dsp-error\|NO-SUPPORT\|CRASH\|GGML_ABORT\|Segmentation'` count 0 |

## Guard rails (copied from gate-g/env.sh)

`session_gates` before the session and before every arm: battery ≥ 30 %, `ac/usb/wl` all false,
`mWakefulness=Awake`, `Thermal Status` 0, `persist.traced.enable` 0. `waitcool` blocks until the
battery temperature is ≤ 33.0 °C, for at most 10 min, else the arm is refused. `st()` prints the
battery/skin/wake/thermal state into every report line. An arm that fails its gates, its parse or
the error pattern returns 1 and the session aborts. The only change against gate G is
`REPORT=$D/step1_report.txt`.

## Runtime estimate

Based on the gate-G session (~24.5 min for 2 proofs + 4 NPU legs with their sleeps) and this
session's structure. The CPU numbers for this model on the S23 are an estimate, not a measurement;
the C-tile prefill is the open e4 number and the widest error bar in the table.

| block | estimate |
|---|---|
| 5 proofs + 60 s sleeps (C-tile = 2 passes × load + pack) | ~8–10 min |
| NPU ABBA A T T2 A2 (bench + KLD + 90/60 s sleeps) | ~24 min |
| CPU -t 1 ABBA, six benches (4 at ~5 min, 2 tiled at ~8 min assumed) | ~35–45 min |
| CPU KLD native + repack + tile (1024 tokens at ~8 tok/s + sleeps) | ~15 min |
| CPU -t 5 ABBA, six benches | ~15–20 min |
| **total** | **~100 min (1.7 h), ±30 min** |

## C-tile: how the arm is built, and why `-ot` is required

The two blockers this file's earlier revision recorded are fixed in the engine:

1. `-ot ...=HTP0-TILE32` parses, because the `-ot` buft maps now enumerate a device's extra bufts
   (`edd25cb16`; `common/arg.cpp:266-280`, `tools/llama-bench/llama-bench.cpp:957-972`).
2. The placement probe is off the path: an override assigns `overrides->buft` directly
   (`llama-model-loader.cpp:1243`), and `GGML_HEXAGON_OPFILTER='.*'` then keeps the HTP from
   claiming any op, including the tiled MUL_MAT.

The CPU-side proof that the tiles were read is the INFO line `1ce488134`/`e9d7a9f45` added to
`ggml-cpu/tile32.cpp`, once per weight tensor and batch width; without it the arm would be a
number with no placement evidence, so `proof_ctile` runs both passes verbose (`-v`) and requires
the line.

Still open after this session (e4, measured by the C-tile bench, not fixed): the tile prefill is a
per-column gemv loop, each column re-reading the weights (`ggml-cpu/tile32.cpp:1-6`), so pp128 on
tiles is expected far below the two CPU layouts. The tile comparison is `c_tile` vs `c_native` for
pp128 / tg128 at -t 1 and -t 5 and the KLD trio; a layout failure shows up as C-tile KLD ≠
C-native KLD or as one of the proof gates above.

## Validation

`sh -n` and `dash -n` on `env.sh` / `cpu-arms.sh` / `run-step1.sh` and `zsh -n` on
`push-and-check.sh` all exit 0. A stub-binary dry run (kept outside this folder) sources the real
scripts with stub
`llama-bench` / `llama-perplexity` / `dumpsys` / `getprop` / `logcat` / `toybox` and reaches
`SESSION COMPLETE`, exit 0. The stub asserts the tile arm's env is exactly
`GGML_HEXAGON_OPFILTER=.*` and the exact `-ot` pattern; negative runs abort as intended:
OPFILTER held in a variable (`proof-exit=3/3`), an engine without the tile32 proof line
(`no-tile32-line-at-ne11=1`), and an HTP that still profiles a MUL_MAT
(`htp-profile-op-MUL_MAT=1`). The dry run cannot exercise the engine or the DSP.
