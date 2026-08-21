# olmoe_gpu_moe_s23 — RAN 2026-08-21 unplugged

Speed / thermal cell on S23 Adreno 740. **Result:** GPU MoE experts (K2-fixed q4_K/q5_K kernels) **2.17× burst tg** and **~1.5× sustained tg512** vs CPU experts, equal-or-lower temp. ngl=16 stable. Exploratory — see `RESULT.md` caveats.

TLS after unplug (`adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`). USB serial absent (cable out). UNPLUG_GATE PASS.

## Pins

| artifact | sha256 |
|---|---|
| OLMoE Q4_K_M 4213513024 B | `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` |
| noextra `libllama-bench-impl.so` (both arms) | `d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346` |
| `libggml-opencl.so` (LOG_ALLOC build, env unset) | `2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87` |

Stock extra_bufts impl `bad17952…` was **not** used: would REPACK ~3.5 GiB anonymous on this Q4_K MoE (oomwall class).

## Why noextra on BOTH arms

A/B is expert placement, not extra_bufts. `-fa off` (W2/W4c `map::at`). `GGML_OPENCL_LOG_ALLOC` unset.

## Model

olmoe, 16 layers, 64 experts / 8 used, 40/48 expert tensors Q4_K + 8 Q6_K, `ne00=2048` → Adreno MoE kernels fire. Dump: `results/oomwall_s23/olmoe_q4km_tensors.txt`.

## Protocol actually run

1. `push_model.ps1` while plugged (LFM GGUF deleted for space; Mellum2 kept).
2. Unplug. Probe **4 → 8 → 12 → 16** (never 99). All rc=0. Chosen **ngl=16**.
3. `run_ab.ps1 -Ngl 16` ABBA×2, `-p 128 -n 128 -fa off -t 4`.
4. Wake from Dozing. `run_sustain.ps1 -Ngl 16` 4× tg512 / arm.

## Artifacts

| file | what |
|---|---|
| `RESULT.md` | headline + tables + caveats |
| `runs.csv` | 8 ABBA + 8 SUSTAIN rows with pp_ts/tg_ts + sensors |
| `probe_ngl{4,8,12,16}.stdout.txt` | jsonl |
| `ab_0{1-8}_*.stdout.txt` | jsonl pp+tg |
| `sus_*.stdout.txt` | jsonl tg512 |
| `_lib.ps1` `one_cell.sh` `push_model.ps1` `probe_ngl.ps1` `run_ab.ps1` `run_sustain.ps1` | harness (TLS fallback + header-only unplug gate) |
| `ngl.txt` | `16` |
