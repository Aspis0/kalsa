# q63 — Dense-model HTP-readable `IQ4_NL-M` recipe gate

**Status: LOCKED at commit time (orchestrator, 2026-08-26 evening; owner GO "ok perfetto vai" for road D). No q63 quantization or PPL number existed at lock.** Orchestrator notes at lock: (i) Candidate 1's predicted size (3,098,664,160 B) is +11.3 % vs same-source Q4_K_M — reported, not gated (PREREG q59 rule); (ii) the rebuilt toolchain (quantizer `63583b81…` @ e5605f3bd, perplexity `d4b31c42…` @ 1882bf8cd) replaces the deleted q59 binaries; the control-validity pre-check below is therefore MANDATORY before any candidate cell; (iii) execution order and budget as written below; runner detached, Idle, `-t 8`, one child at a time.

**Scope:** Qwen3.5-4B, PC-only recon and preregistration draft. No q63 quantization or PPL
cell has run. This document must be locked by the orchestrator before any q63 quantization,
perplexity, or result collection.

## Owner decision context

q59 showed that the same-source `IQ4_NL` arm did not meet the frozen `+1.0%` PPL gate on all
five corpora, while `Q4_K_M` remains the quality bar. The owner decision on 2026-08-26 is:

- **A:** keep `Q4_K_M` as the default/control.
- **D:** test an HTP-readable `IQ4_NL-M` recipe: retain an `IQ4_NL` base and replace the
  sensitive tensors promoted by the `Q4_K_M` mix with `Q8_0`.

### Falsifiable hypothesis

`Q4_K_M` beats `IQ4_NL` primarily because its M mix protects a small set of sensitive tensors,
not because K-quants are intrinsically superior as the base everywhere. Therefore, a readable
recipe that keeps the `IQ4_NL` base and applies `Q8_0` to those promoted tensors should satisfy
the same-source q59 gate on **all five** corpora. Failure on any corpus, after the readability
check passes, falsifies the quality prediction for this recipe. Candidate 2 separately tests
whether output/embedding protection alone accounts for the effect.

## Arms

All candidate arms start from the q59 BF16 GGUF and use the pinned quantizer after the
orchestrator restores/verifies it. No quantized GGUF may be requantized; `--allow-requantize`
is forbidden.

| arm | definition | predicted GGUF bytes | prereg status |
|---|---|---:|---|
| Control | q59 same-source `Q4_K_M`, reused; no q63 control run | 2,783,446,240 | reusable |
| Candidate 1: `IQ4_NL-M(full)` | non-pure `IQ4_NL` base plus ordered `Q8_0` promotions and ordered `IQ4_NL` catch-alls below, including token/output options | 3,098,664,160 | CLI-expressible; expected readable by type, subject to the post-quant dump |
| Candidate 2: `IQ4_NL-M(lite)` | `--pure IQ4_NL` base plus `Q8_0` on output/token embedding | 2,765,741,280 | readable by type if the post-quant dump matches the prediction |

The size predictions are payload accounting from the q59 GGUF tensor maps plus their common
`10,968,288`-byte GGUF data offset. They are predictions only; final candidate bytes must be
recorded after quantization and hashing.

### Candidate 1 command recipe

`--tensor-type` is regex-capable and repeatable. Without `--pure`, patterns are tried in order
and the first match wins; a manual match bypasses the ftype heuristic. The specific promotions
must therefore precede the catch-alls. The `Q4_K_M` `Q6_K` block indices are frozen by recon
below.

```text
--tensor-type "^blk\.(?:0|1|2|6|9|12|18|21|24|28|29|30)\.attn_qkv\.weight$=Q8_0"
--tensor-type "^blk\.(?:3|15|27|31|32)\.attn_v\.weight$=Q8_0"
--tensor-type "^blk\.(?:0|1|2|3|6|9|12|15|18|21|24|27|28|29|30|31|32)\.ffn_down\.weight$=Q8_0"
--tensor-type "^blk\.\d+\.attn_qkv\.weight$=IQ4_NL"
--tensor-type "^blk\.\d+\.attn_v\.weight$=IQ4_NL"
--tensor-type "^blk\.\d+\.ffn_down\.weight$=IQ4_NL"
--output-tensor-type Q8_0
--token-embedding-type Q8_0
```

Full planned command, with `CANDIDATE_1.gguf` as the not-yet-created output:

```text
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q63-dense-htp-recipe/quantize-IQ4_NL-M-full.log build-pc-quantize/bin/llama-quantize.exe --tensor-type "^blk\.(?:0|1|2|6|9|12|18|21|24|28|29|30)\.attn_qkv\.weight$=Q8_0" --tensor-type "^blk\.(?:3|15|27|31|32)\.attn_v\.weight$=Q8_0" --tensor-type "^blk\.(?:0|1|2|3|6|9|12|15|18|21|24|27|28|29|30|31|32)\.ffn_down\.weight$=Q8_0" --tensor-type "^blk\.\d+\.attn_qkv\.weight$=IQ4_NL" --tensor-type "^blk\.\d+\.attn_v\.weight$=IQ4_NL" --tensor-type "^blk\.\d+\.ffn_down\.weight$=IQ4_NL" --output-tensor-type Q8_0 --token-embedding-type Q8_0 scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-BF16.gguf scratchpad/agents/q63-dense-htp-recipe/CANDIDATE_1.gguf IQ4_NL 8
```

Important quantizer interaction: the local quantizer source applies manual tensor patterns only
in the `!pure` branch (`BigMoeOnEdge/third_party/llama.cpp/src/llama-quant.cpp:676-700`), so
`--pure` must not be added to Candidate 1. The token/output options are checked first, before
that pure guard (`llama-quant.cpp:666-670`), and are therefore honored even under Candidate 2.
Because `output.weight` is absent and embeddings are tied, `--output-tensor-type` is a no-op for
this file; `token_embd.weight` is the tied output/embedding tensor and maps Q4_K_M's `Q6_K` to
Q8_0. The corrected Candidate 1 prediction is:

| type | tensor count | payload bytes |
|---|---:|---:|
| F32 | 184 | 3,899,392 |
| IQ4_NL | 222 | 1,700,904,960 |
| Q8_0 | 35 | 1,382,891,520 |
| GGUF file prediction | 441 tensors | **3,098,664,160** |

If the pinned help were to lack `--tensor-type`,
Candidate 1 would be **NOT EXPRESSIBLE with the pinned quantizer**; the nearest expressible arm
is Candidate 2. No new quantizer is proposed in q63.

### Candidate 2 command recipe

Candidate 2 uses `--pure` so the base is genuinely all-`IQ4_NL` for quantizable tensors; the
output/token options are parsed before the pure-mixture branch and remain effective in the
checked-in source. There is no `output.weight` tensor in this Qwen3.5-4B GGUF; the command
keeps the output override for protocol symmetry, while `token_embd.weight` is the actual
embedding tensor.

```text
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q63-dense-htp-recipe/quantize-IQ4_NL-M-lite.log build-pc-quantize/bin/llama-quantize.exe --pure --output-tensor-type Q8_0 --token-embedding-type Q8_0 scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-BF16.gguf scratchpad/agents/q63-dense-htp-recipe/CANDIDATE_2.gguf IQ4_NL 8
```

Predicted type composition:

| type | tensor count | payload bytes |
|---|---:|---:|
| F32 | 184 | 3,899,392 |
| IQ4_NL | 256 | 2,075,443,200 |
| Q8_0 | 1 (`token_embd.weight`) | 675,430,400 |
| GGUF file prediction | 441 tensors | **2,765,741,280** |

For reference only, a non-pure bare q59-style `IQ4_NL` plus token/output overrides would
predict `2,843,401,440` bytes and retain 37 `Q5_K` tensors, so it is not the preregistered
readable lite arm.

## Frozen readability check

After each candidate quantization, dump tensor metadata read-only with the local `gguf-py`
`GGUFReader` and record the full type inventory. The frozen type-only rule is:

```text
PASS iff every tensor type is one of {Q4_0, Q4_1, Q8_0, IQ4_NL, MXFP4, F16, F32}.
```

Any `Q4_K`, `Q5_K`, `Q6_K`, or other type is an invalid arm and is recorded but not measured.
Candidate 1 is expected to pass by type because its ordered catch-alls prevent residual K-quants;
Candidate 2 is also expected to pass by type. The post-quant dump is authoritative.
This readability check is performed before any PPL cell.

The local Hexagon source also requires, for quantized MUL_MAT/MUL_MAT_ID weights, the readable
repack set and `ne[0] % 32 == 0`; Candidate 2’s quantized matrix first dimensions are all
`2560`, `4096`, `5120`, or `9216`, so they meet that predicate. MUL_MAT additionally rejects
`src0->ne[1] > 32768`, so a direct lm-head MUL_MAT use of the `[2560, 248320]` embedding
would be rejected by the current source; normal embedding lookup is a separate operation.
These are recorded shape/op caveats, not a change to the frozen type-only rule.

## Control reuse and PPL gate

The q59 control is reused exactly; do not rerun it. Control GGUF for every corpus:

```text
scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-Q4_K_M.gguf
bytes = 2783446240
sha256 = a7d67feff949041d766c910f2faa641016a5dad6d8c5f7fada05d61b84eb1887
```

| corpus | chunks | reusable q59 control JSON |
|---|---:|---|
| wiki | 64 | `scratchpad/agents/q59-dense-quant-gate/gguf/ppl/ppl-control-wiki.json` |
| it | 60 | `scratchpad/agents/q59-dense-quant-gate/gguf/ppl/ppl-control-it.json` |
| es | 59 | `scratchpad/agents/q59-dense-quant-gate/gguf/ppl/ppl-control-es.json` |
| fr | 59 | `scratchpad/agents/q59-dense-quant-gate/gguf/ppl/ppl-control-fr.json` |
| zh | 61 | `scratchpad/agents/q59-dense-quant-gate/gguf/ppl/ppl-control-zh.json` |

### Rebuilt-binary control-validity pre-check

After lock and before any candidate PPL, run exactly one q59 control cell: `control/fr`, 59
chunks, using the rebuilt `1882bf8cd99659246f4ddecb99c268669d7bb3c9` binary and the exact q59
arguments. This is the only control rerun permitted as the initial equivalence check:

```text
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q63-dense-htp-recipe/control-validity-fr.log build-llama-pc/bin/llama-perplexity.exe -m scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-Q4_K_M.gguf -f scratchpad/agents/q43-q8trunk-ppl-gate/corpus/fr.txt -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0
```

PASS requires PPL `7.1786 ± 0.0005` and 59 chunks. On PASS, the five q59 control JSONs above
remain reusable. On failure, the rebuilt binary is not equivalent: rerun all five q59 control
cells before any candidate PPL, adding approximately `+5 h` and replacing the reused-control
assumption. This pre-check is not run in this draft turn.

The frozen gate is identical to q59:

```text
Delta% = PPL_candidate / PPL_Q4_K_M - 1
PASS iff Delta% <= +1.0% on ALL five corpora.
```

Use the rebuilt `build-llama-pc/bin/llama-perplexity.exe` at commit
`1882bf8cd99659246f4ddecb99c268669d7bb3c9`, with q59’s exact `-c 2048 -b 512 -ub 512 -t 8 -ngl 0`,
`--ppl-stride 0`; wiki uses `--chunks 64`, and it/es/fr/zh use `--chunks -1`. The exact
underlying command form, with only the model/corpus paths substituted per row, is:

```text
C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-llama-pc\bin\llama-perplexity.exe -m CANDIDATE_GGUF -f CORPUS -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks 64|-1 --ppl-stride 0
```

The frozen corpus substitutions are exactly those in q59: wiki =
`scratchpad/agents/q41-ppl-gate/corpus/wikitext-2-raw/wiki.test.raw` with `--chunks 64`;
it = `scratchpad/agents/q43-q8trunk-ppl-gate/corpus/it.txt`, es =
`scratchpad/agents/q43-q8trunk-ppl-gate/corpus/es.txt`, fr =
`scratchpad/agents/q43-q8trunk-ppl-gate/corpus/fr.txt`, and zh =
`scratchpad/agents/q43-q8trunk-ppl-gate/corpus/zh.txt`, each with `--chunks -1`.

Run Candidate 1 first if expressible. If its dump fails readability, record the invalid arm and
skip its PPL cells. Run Candidate 2 afterwards regardless, unless the PC budget is exceeded;
if that happens, stop at the next cell boundary and record the skipped cells without changing
the gate. Candidate PPL JSONs must store model/corpus bytes and SHA-256, command, return code,
wall time, PPL/error, and chunk count.

Reuse q59’s `scratchpad/agents/q59-dense-quant-gate/paired_chunks_q59.py` and its paired data
for post-hoc per-chunk comparison only. This analysis is explicitly **non-gating**.

## Ship consequence if a candidate passes

Even a 5/5 PPL PASS ships nothing by itself. The consequence of PASS is per-device only:

- v75-class devices may receive the readable recipe;
- all other devices keep `Q4_K_M`;
- a q52-class behavioral-loop gate is required before any ship.

The behavioral-loop gate is not run or gated in q63. A PPL PASS is not a ship decision.

## Toolchain rebuild

The q59 binary directories were absent. Rebuild from kalsallama’s
`BigMoeOnEdge/third_party/llama.cpp` using detached worktrees; never checkout or reset that
working tree. The pinned provenance is quantizer
`e5605f3bd3545867b2eb2581c96fd7042e243541` and perplexity
`1882bf8cd99659246f4ddecb99c268669d7bb3c9`. Worktree paths are
`scratchpad/agents/q63-dense-htp-recipe/worktree-e5605f3bd/` and
`scratchpad/agents/q63-dense-htp-recipe/worktree-1882bf8cd/`.

CPU-only CMake Release build, using CMake `3.31.6-msvc6`, Ninja, and MSVC
`19.44.35227.0`, with `--parallel 4` (Ninja `-j4`) and Windows Idle process priority:

```text
git -c core.longpaths=true -C BigMoeOnEdge/third_party/llama.cpp worktree add --detach C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q63-dense-htp-recipe\worktree-e5605f3bd e5605f3bd3545867b2eb2581c96fd7042e243541
git -c core.longpaths=true -C BigMoeOnEdge/third_party/llama.cpp worktree add --detach C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q63-dense-htp-recipe\worktree-1882bf8cd 1882bf8cd99659246f4ddecb99c268669d7bb3c9
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q63-dense-htp-recipe/build-quantizer.log cmd.exe /d /s /c scratchpad/agents/q63-dense-htp-recipe/build_quantizer.cmd
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q63-dense-htp-recipe/build-perplexity.log cmd.exe /d /s /c scratchpad/agents/q63-dense-htp-recipe/build_perplexity.cmd
```

Each wrapper configures with `cmake.exe -S scratchpad/agents/q63-dense-htp-recipe/worktree-… -B
build-… -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF`, enables
`LLAMA_BUILD_COMMON/TOOLS`, disables examples/tests/server/app/UI/OpenSSL, enables CPU/native,
and disables CUDA/HIP/Vulkan/Metal/SYCL/RPC/OpenCL/Hexagon; it then runs
`cmake.exe --build build-… --config Release --target <tool> --parallel 4`.

The quantizer target is `llama-quantize` into `build-pc-quantize/`; the PPL target is
`llama-perplexity` into `build-llama-pc/`. Build compiler, build-info strings, command logs,
and executable SHA-256 are recorded below after the toolchain-only rebuild. q59’s manifest
recorded commit identities but no executable SHA-256, so there is no old executable digest to
quote; the pinned commit is the provenance.

### Rebuild record

| binary | commit | compiler | build-info | sha256 | status |
|---|---|---|---|---|---|
| `build-pc-quantize/bin/llama-quantize.exe` | `e5605f3bd3545867b2eb2581c96fd7042e243541` | `MSVC 19.44.35227.0` | `b9967-e5605f3bd` | `63583b81162bbe1ae3b74ae2adac2cf79466edd52213ce088bc000b0e195d9c5` | built; help contains `--tensor-type` (RC 1 after printing help) |
| `build-llama-pc/bin/llama-perplexity.exe` | `1882bf8cd99659246f4ddecb99c268669d7bb3c9` | `MSVC 19.44.35227.0` | `b10011-1882bf8cd` | `d4b31c42195f1d0e1b586ae4544ece6203ba2fd13d814fcefca170e6667707d7` | built; `--version` RC 0 |

Recorded checks: `quantizer-help-rebuilt.log` contains `--tensor-type`, `--output-tensor-type`,
`--token-embedding-type`, `--pure`, and `--imatrix`; `perplexity-version.log` prints
`version: 10011 (1882bf8cd)` and `built with MSVC 19.44.35227.0 for Windows AMD64`.
Help/version checks do not load a model.

## Hygiene and execution budget

- Lock this draft before any q63 quantization/PPL; no q63 result number exists yet.
- Use `hashlib` SHA-256 for BF16, candidate GGUFs, control references, and corpora.
- No download is needed. The q59 BF16 GGUF is already on disk and was verified against its
  manifest: `8,665,619,680` bytes, sha256
  `9ba85223a9db256879b525d747090407a4b9aad3d920e4098519a401bba0149b`.
- Use Idle priority for quantization, metadata dumps, and PPL. Use PC-gentle `-t 8`.
- One llama/quantizer child at a time; never run two PPL cells concurrently.
- Use the q59 detached-runner style: scheduler flags
  `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`; each llama child uses
  `IDLE_PRIORITY_CLASS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`.
- The rebuild above is toolchain-only; no model runtime load during recon, no git commit, and no
  push. Quantization/PPL remain forbidden until the orchestrator locks this draft.

Budget from q59, excluding the already completed reusable controls:

The q59 control cells took `3419–3927 s` each and the q59 candidate cells took `4400–4937 s`
each at `-t 8` Idle. The control range is recorded for planning only; those five cells are
reused and must not be rerun.

| work | estimate |
|---|---:|
| two candidate quantizations | `200–440 s` (`~0.06–0.12 h`) |
| rebuilt-binary control-validity pre-check | one q59 `fr` cell, about `3448 s` (`~57 min`); not run in this turn |
| five Candidate 1 PPL cells if readable | `5 × 4400–4937 s` (`~6.1–6.9 h`) |
| five Candidate 2 PPL cells | `5 × 4400–4937 s` (`~6.1–6.9 h`) |
| full candidate worst-case q63 wall | `~12.3–13.8 h` plus small dump/runner overhead; add ~57 min for validity check |
| if validity check fails | rerun all five controls before candidate PPL, add approximately `+5 h` |
| if Candidate 1 is invalid before PPL | `~6.2–7.1 h` plus quantization/dump overhead |

Execution order is: orchestrator lock → run the single `control/fr` validity check → if it fails,
rerun all five controls → restore/verify pinned quantizer → quantize Candidate 1 from BF16 →
dump/readability decision → measure Candidate 1 only if readable → quantize Candidate 2 from BF16
→ dump/readability decision → measure Candidate 2 → compute the frozen gate against valid q59
controls → non-gating paired analysis → report; no ship action in q63.

## Recon appendix — facts only

### Inputs and reader

The three files were read with `GGUFReader(..., "r")` from
`BigMoeOnEdge/third_party/llama.cpp/gguf-py`, without loading a model into a runtime. All three
have `441` tensors, `data_offset = 10,968,288`, and `32`-byte GGUF alignment. Tensor names match
as sets across BF16, q4, and IQ4 files. Shapes below are the GGUF/BF16 shapes; bytes are payload
bytes per tensor for each listed type.

| name pattern | count | BF16 shape | q4 `Q4_K_M` type / bytes each | IQ4 `IQ4_NL` type / bytes each |
|---|---:|---|---|---|
| `blk.*.attn_gate.weight` | 24 | `[2560,4096]` | `Q4_K` / 5,898,240 | `IQ4_NL` / 5,898,240 |
| `blk.*.attn_k.weight` | 9 | `[2560,1024]` | `Q4_K` / 1,474,560 | `IQ4_NL` / 1,474,560 |
| `blk.*.attn_k_norm.weight` | 9 | `[256]` | `F32` / 1,024 | `F32` / 1,024 |
| `blk.*.attn_norm.weight` | 33 | `[2560]` | `F32` / 10,240 | `F32` / 10,240 |
| `blk.*.attn_output.weight` | 9 | `[4096,2560]` | `Q4_K` / 5,898,240 | `IQ4_NL` / 5,898,240 |
| `blk.*.attn_q.weight` | 9 | `[2560,8192]` | `Q4_K` / 11,796,480 | `IQ4_NL` / 11,796,480 |
| `blk.*.attn_q_norm.weight` | 9 | `[256]` | `F32` / 1,024 | `F32` / 1,024 |
| `blk.*.attn_qkv.weight` | 24 | `[2560,8192]` | `Q4_K` ×12 / 11,796,480; `Q6_K` ×12 / 17,203,200 | `Q5_K` ×24 / 14,417,920 |
| `blk.*.attn_v.weight` | 9 | `[2560,1024]` | `Q4_K` ×4 / 1,474,560; `Q6_K` ×5 / 2,150,400 | `Q5_K` ×9 / 1,802,240 |
| `blk.*.ffn_down.weight` | 33 | `[9216,2560]` | `Q4_K` ×16 / 13,271,040; `Q6_K` ×17 / 19,353,600 | `IQ4_NL` ×29 / 13,271,040; `Q5_K` ×4 / 16,220,160 |
| `blk.*.ffn_gate.weight` | 33 | `[2560,9216]` | `Q4_K` / 13,271,040 | `IQ4_NL` / 13,271,040 |
| `blk.*.ffn_up.weight` | 33 | `[2560,9216]` | `Q4_K` / 13,271,040 | `IQ4_NL` / 13,271,040 |
| `blk.*.nextn.eh_proj.weight` | 1 | `[5120,2560]` | `Q4_K` / 7,372,800 | `IQ4_NL` / 7,372,800 |
| `blk.*.nextn.enorm.weight` | 1 | `[2560]` | `F32` / 10,240 | `F32` / 10,240 |
| `blk.*.nextn.hnorm.weight` | 1 | `[2560]` | `F32` / 10,240 | `F32` / 10,240 |
| `blk.*.nextn.shared_head_norm.weight` | 1 | `[2560]` | `F32` / 10,240 | `F32` / 10,240 |
| `blk.*.post_attention_norm.weight` | 33 | `[2560]` | `F32` / 10,240 | `F32` / 10,240 |
| `blk.*.ssm_a` | 24 | `[32]` | `F32` / 128 | `F32` / 128 |
| `blk.*.ssm_alpha.weight` | 24 | `[2560,32]` | `Q4_K` / 46,080 | `IQ4_NL` / 46,080 |
| `blk.*.ssm_beta.weight` | 24 | `[2560,32]` | `Q4_K` / 46,080 | `IQ4_NL` / 46,080 |
| `blk.*.ssm_conv1d.weight` | 24 | `[4,8192]` | `F32` / 131,072 | `F32` / 131,072 |
| `blk.*.ssm_dt.bias` | 24 | `[32]` | `F32` / 128 | `F32` / 128 |
| `blk.*.ssm_norm.weight` | 24 | `[128]` | `F32` / 512 | `F32` / 512 |
| `blk.*.ssm_out.weight` | 24 | `[4096,2560]` | `Q4_K` / 5,898,240 | `IQ4_NL` / 5,898,240 |
| `output_norm.weight` | 1 | `[2560]` | `F32` / 10,240 | `F32` / 10,240 |
| `token_embd.weight` | 1 | `[2560,248320]` | `Q6_K` / 521,472,000 | `Q6_K` / 521,472,000 |

`output.weight` is absent; `output_norm.weight` is present and remains `F32`.

### Exact q4 type map

- `Q6_K`: `token_embd.weight`; `blk.{0,1,2,6,9,12,18,21,24,28,29,30}.attn_qkv.weight`;
  `blk.{3,15,27,31,32}.attn_v.weight`; and
  `blk.{0,1,2,3,6,9,12,15,18,21,24,27,28,29,30,31,32}.ffn_down.weight`.
- `Q5_K`: none.
- `Q8_0`: none.
- `F16`: none.
- `F32`: all `blk.*.attn_k_norm.weight`, `attn_norm.weight`, `attn_q_norm.weight`,
  `post_attention_norm.weight`, `ssm_a`, `ssm_conv1d.weight`, `ssm_dt.bias`, `ssm_norm.weight`,
  plus `blk.32.nextn.enorm.weight`, `blk.32.nextn.hnorm.weight`,
  `blk.32.nextn.shared_head_norm.weight`, and `output_norm.weight` — `184` tensors total.
- `Q4_K`: all remaining q4 quantized tensors: `attn_gate` (24), `attn_k` (9), `attn_output`
  (9), `attn_q` (9), `ffn_gate` (33), `ffn_up` (33), `nextn.eh_proj` (1), `ssm_alpha` (24),
  `ssm_beta` (24), `ssm_out` (24); plus the listed non-promoted `attn_qkv` (12), `attn_v`
  (4), and `ffn_down` (16) tensors — `222` tensors total.

### Sum bytes by type

| GGUF | F32 | Q4_K | Q5_K | Q6_K | IQ4_NL |
|---|---:|---:|---:|---:|---:|
| BF16 source | 3,899,392 (`184`) | — | — | — | — |
| q4 `Q4_K_M` | 3,899,392 (`184`) | 1,700,904,960 (`222`) | — | 1,067,673,600 (`35`) | — |
| q59 `IQ4_NL` | 3,899,392 (`184`) | — | 427,130,880 (`37`) | 521,472,000 (`1`) | 1,725,972,480 (`219`) |

BF16 source additionally has `BF16` payload `8,650,752,000` across `257` tensors. The payload
sums exclude the common GGUF header/data offset.

### Erratum — q59 `IQ4_NL` arm

The q59 arm labelled `IQ4_NL` was an ftype mixture, not pure `IQ4_NL`: its dump contains
`37` `Q5_K` tensors (`attn_qkv ×24`, `attn_v ×9`, `ffn_down ×4`) plus `token_embd.weight` as
`Q6_K`. Therefore the measured q59 arm was **not HTP-readable**. q63 Candidate 2 is the first
truly readable pure-`IQ4_NL` plus `Q8_0` embedding/output arm. This is a factual correction,
not a q63 result.

### Quantizer capability findings

| capability | finding | evidence/status |
|---|---|---|
| `--tensor-type <pattern>=<type>` | **YES**; regex syntax, repeatable | rebuilt help `scratchpad/agents/q63-dense-htp-recipe/quantizer-help-rebuilt.log:1-2,25`; source `tools/quantize/README.md:65`, `tools/quantize/quantize.cpp:123-150,428-430` |
| `--output-tensor-type` | **YES** | rebuilt help: `quantizer-help-rebuilt.log:2,21`; source `quantize.cpp:142-143,410-418` |
| `--token-embedding-type` | **YES** | rebuilt help: `quantizer-help-rebuilt.log:2,23`; source `quantize.cpp:144-145,419-427` |
| `--pure` | **YES** | rebuilt help: `quantizer-help-rebuilt.log:1,13`; source `quantize.cpp:134-135,448-449` |
| `--imatrix` | **YES** | rebuilt help: `quantizer-help-rebuilt.log:1`; source `quantize.cpp:123,450-454` |
| q59 quantizer commit | `e5605f3bd3545867b2eb2581c96fd7042e243541` | q59 `manifest.json` and `REPORT.md` |
| rebuilt quantizer | **YES**; build-info `b9967-e5605f3bd` | `build-pc-quantize/bin/llama-quantize.exe`, SHA-256 recorded above |
| rebuilt PPL binary | **YES**; build-info `b10011-1882bf8cd` | `build-llama-pc/bin/llama-perplexity.exe`, SHA-256 recorded above |

The rebuilt quantizer help printed RC 1 after emitting the complete help text; this is the
tool’s help-exit behavior, not a missing flag. The rebuilt PPL `--version` check returned RC 0.
The source confirms first-match/manual-override behavior and that token/output overrides precede
the pure guard.

### HTP support facts

The local Hexagon backend’s `ggml_hexagon_is_repack_type` accepts `Q4_0`, `Q4_1`, `Q8_0`,
`IQ4_NL`, and `MXFP4`; `F16` and `F32` are also HMX weight types
(`BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:164-172`).
The device support dispatcher routes MUL_MAT and MUL_MAT_ID to their dedicated predicates
(`BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:4047-4053`).

For MUL_MAT, the predicate requires output `F32`, activation `F32` or `F16`, one of the five
repack quant types above, `src0->ne[0] % 32 == 0`, `src0->ne[1] <= 32768`, no activation
broadcast in `ne[2]/ne[3]`, and a Hexagon-repacked weight buffer
(`BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:2810-2843`).
F16/F32 branches have their own contiguous/layout and activation-shape checks
(`BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:2845-2865`).
For MUL_MAT_ID, the activation/output/index types must be `F32`/`F32`/`I32`,
the same five repack quant types are accepted, `src0->ne[0] % 32 == 0`, and the weight must
be in a Hexagon-repacked buffer
(`BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:2882-2904`).
VTCM budget checks follow both predicates.

No q63 candidate is allowed to rely on `Q4_K`, `Q5_K`, or `Q6_K` being HTP-readable.
