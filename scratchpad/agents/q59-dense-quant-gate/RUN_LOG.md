# q59 — dense-model HTP-readable quant gate run log

## Lock / scope

- Cell: q59, primary model Qwen3.5-4B, PC-only CPU measurement.
- Locked preregistration: `PREREG.md`, requested lock `f10d997b`.
- Start date: 2026-08-25.
- No download had occurred before this record was written.
- Required quality gate: candidate Δ% = PPL(candidate) / PPL(Q4_K_M control) − 1 must be ≤ +1.0% on wiki + IT + ES + FR + ZH.
- Candidate order: IQ4_NL first; Q4_0 fallback; Q8_0 optional ceiling.
- No `--allow-requantize`: source will be F16/BF16 before quantization.

## Provenance scouting (recorded before download)

### App model / shipped quality-bar artifact

Read from `C:/Users/gualt/Desktop/Kalsa/ai-chat/src/engine/ModelRegistry.ts`:

| field | value |
|---|---|
| app id | `qwen3.5-4b` |
| default | `true` |
| quant | `Q4_K_M` |
| repo | `unsloth/Qwen3.5-4B-MTP-GGUF` |
| repo revision | `86835bf9949e4d14d6860f7910b1340ad4f271a9` |
| file | `Qwen3.5-4B-Q4_K_M.gguf` |
| registry bytes | `2,834,975,040` |

Read-only Hugging Face API scouting for the same repo/revision reports the shipped file as:

- bytes: `2,834,975,040`
- sha256: `3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630`

### Selected same-source path

Selected path (a): official high-precision source → pinned llama.cpp conversion → pinned `llama-quantize` arms.

| item | value |
|---|---|
| official source repo | `Qwen/Qwen3.5-4B` |
| official source revision | `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a` |
| source base-model metadata | `Qwen/Qwen3.5-4B-Base` |
| source format | BF16 safetensors, 2 shards |
| shard 1 | `model.safetensors-00001-of-00002.safetensors`, 5,329,398,688 B, sha256 `26a93f066e1916adb13453dae5a0c707c0fbc71299ed98779571a907b8e74c61` |
| shard 2 | `model.safetensors-00002-of-00002.safetensors`, 3,990,429,408 B, sha256 `cb544bd9bfae93dc59b0f22b292f5933573854a7f9b97835c67060d7d910e188` |
| total safetensor bytes | `9,319,828,096` B |
| source conversion | `BigMoeOnEdge/third_party/llama.cpp/convert_hf_to_gguf.py`, Qwen3.5 converter support present; output BF16 GGUF |

This source is the tagged base model of the app publisher's MTP-GGUF repo. The app's exact shipped Q4_K_M remains the registry quality-bar reference; all q59 measured arms will be generated from the single high-precision source with the pinned quantizer, so no quantized arm is requantized.

### Pinned builds and flags

| use | path / build | commit |
|---|---|---|
| conversion source tree | `BigMoeOnEdge/third_party/llama.cpp` | working-tree HEAD `a0cabca6b1b3248a92e05a8633fd0d82cf776e75`; tree was locally modified (`git status` showed `M BigMoeOnEdge`) |
| quantizer | `build-pc-quantize/bin/llama-quantize.exe` | build-info `b9967-e5605f3bd`; full commit `e5605f3bd3545867b2eb2581c96fd7042e243541` |
| PPL binary reused from q43 | `build-llama-pc/bin/llama-perplexity.exe` | build-info/compile commit `1882bf8cd99659246f4ddecb99c268669d7bb3c9` |

Quantization will use the direct `llama-quantize` path with positional source, output, type, and `8` threads; `--allow-requantize` is forbidden and will not appear in any command. PPL will use the q43 binary, CPU-only, all chunks, q59's `-c 2048`, and `-t 8` PC-gentle settings; exact commands will be appended before each run.

## Disk / execution policy

- C: free before any model download: `126,016,352,256` B (`~117.4 GiB`).
- Minimum free-space guard: 40 GiB.
- All q59 source, conversion output, quantized GGUFs, logs, and manifests stay under `scratchpad/agents/q59-dense-quant-gate/gguf/` except the required `RUN_LOG.md`, `REPORT.md`, and `manifest.json`.
- Downloads, conversion/quantization, and PPL will be sequential and Idle priority; no deletion outside q59 `gguf/`.

## Missing requested reference

- The user-requested `scratchpad/agents/q37-bprime-from-source/PREP.md` is absent in the workspace. The available q37 `SOURCE.md`, `NOTES.md`, and `cook_model.py` were inspected. q37's legacy script uses `--allow-requantize` for already-quantized Q8_0 sources; q59 explicitly forbids that flag and starts from BF16, so the legacy script will not be used. This is a provenance/audit caveat, not a mixed-provenance substitution.

## Download plan recorded before first transfer

All URLs below are immutable `resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/` paths from the official source repo. Each transfer is sequential, wrapped with Windows `/low`, and uses `curl --fail --retry 3 --retry-all-errors --continue-at -`.

The `/low` wrapper is `run_low.py`, which calls `SetPriorityClass(..., IDLE_PRIORITY_CLASS)` on the one child process and waits for completion. The shell's native `start /low` form was rejected before execution, so no transfer was made through it.

```text
curl.exe -L --fail --retry 3 --retry-all-errors --continue-at - https://huggingface.co/Qwen/Qwen3.5-4B/resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/config.json -o scratchpad/agents/q59-dense-quant-gate/gguf/source/config.json
curl.exe -L --fail --retry 3 --retry-all-errors --continue-at - https://huggingface.co/Qwen/Qwen3.5-4B/resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/model.safetensors.index.json -o scratchpad/agents/q59-dense-quant-gate/gguf/source/model.safetensors.index.json
curl.exe -L --fail --retry 3 --retry-all-errors --continue-at - https://huggingface.co/Qwen/Qwen3.5-4B/resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/tokenizer.json -o scratchpad/agents/q59-dense-quant-gate/gguf/source/tokenizer.json
curl.exe -L --fail --retry 3 --retry-all-errors --continue-at - https://huggingface.co/Qwen/Qwen3.5-4B/resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/tokenizer_config.json -o scratchpad/agents/q59-dense-quant-gate/gguf/source/tokenizer_config.json
curl.exe -L --fail --retry 3 --retry-all-errors --continue-at - https://huggingface.co/Qwen/Qwen3.5-4B/resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/merges.txt -o scratchpad/agents/q59-dense-quant-gate/gguf/source/merges.txt
curl.exe -L --fail --retry 3 --retry-all-errors --continue-at - https://huggingface.co/Qwen/Qwen3.5-4B/resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/vocab.json -o scratchpad/agents/q59-dense-quant-gate/gguf/source/vocab.json
curl.exe -L --fail --retry 3 --retry-all-errors --continue-at - https://huggingface.co/Qwen/Qwen3.5-4B/resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/model.safetensors-00001-of-00002.safetensors -o scratchpad/agents/q59-dense-quant-gate/gguf/source/model.safetensors-00001-of-00002.safetensors
curl.exe -L --fail --retry 3 --retry-all-errors --continue-at - https://huggingface.co/Qwen/Qwen3.5-4B/resolve/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/model.safetensors-00002-of-00002.safetensors -o scratchpad/agents/q59-dense-quant-gate/gguf/source/model.safetensors-00002-of-00002.safetensors
```

## Source downloads completed

| file | bytes | sha256 | result |
|---|---:|---|---|
| `gguf/source/model.safetensors-00001-of-00002.safetensors` | `5,329,398,688` | `26a93f066e1916adb13453dae5a0c707c0fbc71299ed98779571a907b8e74c61` | API match |
| `gguf/source/model.safetensors-00002-of-00002.safetensors` | `3,990,429,408` | `cb544bd9bfae93dc59b0f22b292f5933573854a7f9b97835c67060d7d910e188` | API match |

Both hashes were computed with Python `hashlib` using `scratchpad/agents/q37-bprime-from-source/sha256.py`. C: free after source download: `114,989,092,864` B.

## Conversion

Source config confirms `Qwen3_5ForConditionalGeneration`, 32 text layers, one MTP layer, and tied embeddings. The converter will retain the bundled MTP head (no `--no-mtp`) and emit BF16:

```text
python scratchpad/agents/q59-dense-quant-gate/run_low.py python BigMoeOnEdge/third_party/llama.cpp/convert_hf_to_gguf.py --outtype bf16 --outfile scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-BF16.gguf scratchpad/agents/q59-dense-quant-gate/gguf/source
```

Conversion result: `gguf/Qwen3.5-4B-fromsrc-BF16.gguf`, `8,665,619,680` B, sha256 `9ba85223a9db256879b525d747090407a4b9aad3d920e4098519a401bba0149b`, rc=0. The converter log reports `n_tensors = 441` and successful export.

## Quantization plan / commands

Pinned binary: `build-pc-quantize/bin/llama-quantize.exe`, 8 threads, idle priority. Dry-run and real-run commands are sequential. No command below contains `--allow-requantize`.

```text
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q59-dense-quant-gate/gguf/quantize-iq4_nl.log build-pc-quantize/bin/llama-quantize.exe --dry-run scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-BF16.gguf scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-IQ4_NL.gguf IQ4_NL 8
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q59-dense-quant-gate/gguf/quantize-iq4_nl.log build-pc-quantize/bin/llama-quantize.exe scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-BF16.gguf scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-IQ4_NL.gguf IQ4_NL 8
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q59-dense-quant-gate/gguf/quantize-q4_k_m.log build-pc-quantize/bin/llama-quantize.exe --dry-run scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-BF16.gguf scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-Q4_K_M.gguf Q4_K_M 8
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q59-dense-quant-gate/gguf/quantize-q4_k_m.log build-pc-quantize/bin/llama-quantize.exe scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-BF16.gguf scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-Q4_K_M.gguf Q4_K_M 8
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q59-dense-quant-gate/gguf/quantize-q4_0.log build-pc-quantize/bin/llama-quantize.exe --dry-run scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-BF16.gguf scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-Q4_0.gguf Q4_0 8
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q59-dense-quant-gate/gguf/quantize-q4_0.log build-pc-quantize/bin/llama-quantize.exe scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-BF16.gguf scratchpad/agents/q59-dense-quant-gate/gguf/Qwen3.5-4B-fromsrc-Q4_0.gguf Q4_0 8
```

IQ4_NL result: `2,689,443,040` B, sha256 `d1badf2682c66c4bf3aaa410c8e15a5605746a33ba049ae5a968afe82c71c539`, quantizer-reported wall `219,195.74 ms`, rc=0.

Q4_K_M control result: `2,783,446,240` B, sha256 `a7d67feff949041d766c910f2faa641016a5dad6d8c5f7fada05d61b84eb1887`, quantizer-reported wall `103,919.64 ms`, rc=0.

## PPL protocol / command template

Corpora are reused exactly from q41/q43; the runner verifies their Python `hashlib.sha256` before every run. The PPL binary is q43's `build-llama-pc/bin/llama-perplexity.exe` (commit `1882bf8cd99659246f4ddecb99c268669d7bb3c9`). q59 uses q43's `-b 512 -ub 512 -ngl 0 --chunks -1 --ppl-stride 0`, q59's locked `-c 2048`, and PC-gentle `-t 8`.

The runner is called sequentially once per arm/corpus; each JSON stores the exact underlying command, model/corpus bytes and hashes, PPL ± error, chunk count, rc, and wall seconds. The actual command form is:

```text
python scratchpad/agents/q59-dense-quant-gate/run_ppl_q59.py ARM CORPUS
```

It launches:

```text
C:/Users/gualt/Desktop/Kalsa/moe-experiments/build-llama-pc/bin/llama-perplexity.exe -m MODEL -f CORPUS -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks -1 --ppl-stride 0
```

Because the first cell's measured ETA is multi-hour, the resumable sequential scheduler is launched as:

```text
python scratchpad/agents/q59-dense-quant-gate/run_low.py --log scratchpad/agents/q59-dense-quant-gate/gguf/ppl/pipeline_wrapper.log python scratchpad/agents/q59-dense-quant-gate/run_ppl_pipeline_q59.py
```

It waits for an already-running `control/wiki` JSON, skips any complete JSON, and invokes the remaining cells in frozen corpus-block order. It is not allowed to launch a second PPL child concurrently.

For the remaining arms, dry-run logs are separate from real-run logs (`*-dry.log`) so the exact dry-run output is retained.

## Amendment 1 execution stop / relaunch

- At `2026-08-25` before any completed PPL JSON or final estimate existed, the pre-amendment scheduler and its active `control/wiki` cell were stopped cleanly. The last log line showed partial chunk index `N=7`; that partial per-chunk value was not read into a result, used in arithmetic, or used for the gate. The terminated q59 process tree was `llama-perplexity` PID `37376`, runner PID `33720`/`36480`, and scheduler PID `34984`/`33364`/`41304`.
- The old cell used `--chunks -1` and was therefore discarded under Amendment 1. No PPL value was used from it.
- Amendment 1 plan applied: primary order `control/wiki`, `IQ4_NL/wiki`, `control/IT`, `IQ4_NL/IT`, `control/ES`, `IQ4_NL/ES`, `control/FR`, `IQ4_NL/FR`, `control/ZH`, `IQ4_NL/ZH`; wiki uses `--chunks 64`; the four language corpora use `--chunks -1`; Q4_0 runs only if IQ4_NL fails any corpus; Q8_0 is skipped.
- The relaunch uses `launch_q59_detached.py`, modeled on q52's detached launcher: `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`; the scheduler and PPL runner ignore `SIGINT`/`SIGBREAK`; each llama-perplexity child uses `IDLE_PRIORITY_CLASS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`. The scheduler is resumable by valid per-cell JSON and launches one child at a time.
- Amended command forms are `python scratchpad/agents/q59-dense-quant-gate/run_ppl_q59.py ARM wiki 64` and `python scratchpad/agents/q59-dense-quant-gate/run_ppl_q59.py ARM it|es|fr|zh -1`; the underlying binary command is `llama-perplexity.exe -m MODEL -f CORPUS -c 2048 -b 512 -ub 512 -t 8 -ngl 0 --chunks 64|-1 --ppl-stride 0`.
- Detached scheduler launch: `python scratchpad/agents/q59-dense-quant-gate/launch_q59_detached.py`; launch PID `39848`; first amended cell is `control/wiki` and was observed running with child PID `7176`.
