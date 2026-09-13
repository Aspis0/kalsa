# Mac brain — measured notes (M1)

Filled in on the owner Mac (`Marco’s MacBook Pro`, Apple Silicon, 10 cores,
64 GB unified memory). Update this file if the binary, GGUF, or flags change.

## llama.cpp

| | |
| --- | --- |
| Source | Homebrew formula `llama.cpp` (prebuilt bottle, not built from source) |
| Cellar | `/opt/homebrew/Cellar/llama.cpp/10360` |
| Binary | `/opt/homebrew/bin/llama-server` |
| Formula tag / git | `b10360` / `48d22e295e2b86b47366c16390794f3e05ba970a` (`https://github.com/ggml-org/llama.cpp.git`) |
| `--version` | `version: 10360 (48d22e295)` |
| Built with | AppleClang 21.0.0.21000101 for Darwin arm64 |
| CMake package version | `0.0.10360` |

Homebrew also advertised a newer stable `0.4.0`. This run kept the already-installed
`b10360` rather than upgrading mid-task.

## Model hunt (2026-09-13) — no GGUF on this Mac

Orchestrator update: Ornith is already on disk; do **not** download a GGUF.
A `hf download` of `Ornith-1.5-35B-Q4_K_M.gguf` that had started earlier in
this run was killed (PID 16218) and the ~17 GiB incomplete blob under
`~/.kalsa/models/ornith-1.5-35b-a3b/` was deleted. No conversion was run.

**What is actually here (usable by pi/mtplx, not by llama-server):**

| Path | Format | Size | Notes |
| --- | --- | --- | --- |
| `~/.mtplx/models/philipjohnbasile--ornith-ai-Ornith-1.5-35B-A3B-V2-MTPLX/` | safetensors shards + MTPLX sidecar | 21 GiB | Complete. Paseo profile `Free Coder open` model id `mtplx/philipjohnbasile-ornith-ai-ornith-1-5-35b-a3b-v2-mtplx`. Source repo `philipjohnbasile/ornith-ai-Ornith-1.5-35B-A3B-V2-MTPLX`, `resolved_sha` `5aeec0f34d48b7c6fff28adc15de14b689eb27ed`. Forge: body 4-bit affine, MTP kept bf16, arch `qwen3-next-mtp`. Files: `model-00001..04-of-00004.safetensors` (5.0+5.0+5.0+3.2 GiB), `model-vision.safetensors` (852 MiB), `mtp.safetensors` (1.6 GiB), tokenizer, `chat_template.jinja`, `mtplx_runtime.json`. |
| `~/.cache/huggingface/hub/models--ornith-ai--Ornith-1.5-35B-A3B-MLX-4bit` | Hugging Face cache stub | 4 KiB | `refs/main` only. **Not** the weights. |

**Searched, no Ornith GGUF:** `mdfind -name ornith`; `mdfind '*.gguf'`; `find ~ -maxdepth 5` (and a no-prune variant); `~/.cache/huggingface`, `~/.pi`, `~/.mtplx`, `~/.lmstudio`, `~/Library/Application Support/lmstudio`, `~/.ollama`, `~/.cache/lm-studio`, `~/Models`, `~/models`, `~/Downloads`, `~/.cache/pi`, `~/.kalsa/models`, `/Volumes` (only Macintosh HD); `~/Projects` including `kalsa-moe-experiments/logs/dl-ornith-q2kl.log` (that log is a Windows path `C:\Users\gualt\Desktop\Kalsa\moe-experiments\models\ornith-dl`, not this Mac). Large GGUFs present are MiniCPM/Qwen/Marco-Mini — not Ornith.

llama-server cannot load safetensors/MTPLX. `KALSA_BRAIN_MODEL` is therefore unset; `run.sh` will refuse until a GGUF exists. Do **not** convert the MTPLX tree in this run.

**Intended GGUF if a later run is allowed to fetch one:** official
[`ornith-ai/Ornith-1.5-35B-A3B-GGUF`](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF) `Ornith-1.5-35B-Q4_K_M.gguf` (~20.22 GiB). Why Q4_K_M: 64 GB unified memory, ~109 GB free disk; Q4_K_M is the requested class and leaves headroom for 32k ctx vs Q5_K_M (23.61 GiB) / Q6_K (27.20 GiB) / Q8_0 (35.21 GiB). Not using `mmproj-*.gguf` (vision). Default path `run.sh` looks for:
`~/.kalsa/models/ornith-1.5-35b-a3b/Ornith-1.5-35B-Q4_K_M.gguf` (file not present).

## Flags

```
llama-server
  --model ~/.kalsa/models/ornith-1.5-35b-a3b/Ornith-1.5-35B-Q4_K_M.gguf
  --host 127.0.0.1
  --port 8080
  --ctx-size 32768
  --threads 8
  --n-gpu-layers all
  --flash-attn auto
  --api-key-file ~/.kalsa/api-keys
  --sse-ping-interval 30
```

`--threads 8` leaves 2 of 10 cores for the OS/UI. `--n-gpu-layers all` is Metal
on unified memory (`auto` is the llama.cpp default; we pin `all`). Context 32768
is a deliberate cap vs whatever the GGUF advertises, so KV does not eat the
machine. `--sse-ping-interval 30` matches llama.cpp's own default; set explicitly
so a future default change does not silently drop pings.

API key file: `~/.kalsa/api-keys` (mode 600, one token per line). Not in git.

## RAM (first successful load)

Not measured. llama-server was not started: no Ornith GGUF on disk.

When a GGUF is present:

```bash
ps -o pid,rss,vsz,command -p "$(cat ~/.kalsa/macbrain.pid)"
# rss is KiB
```

Also `memory_pressure` / Activity Monitor "llama-server" if RSS looks off
because of Metal wired pages.

## Tailnet

| | |
| --- | --- |
| CLI | `/Applications/Tailscale.app/Contents/MacOS/Tailscale` (`tailscale` is not on the default PATH) |
| MagicDNS | `<mac>.<tailnet>.ts.net` |
| Serve | `tailscale serve --bg 8080` (HTTPS on 443, tailnet only — not Funnel) |
| Local | `http://127.0.0.1:8080` |
