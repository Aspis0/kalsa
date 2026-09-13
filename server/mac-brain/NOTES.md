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

## Model

| | |
| --- | --- |
| Repo | [`ornith-ai/Ornith-1.5-35B-A3B-GGUF`](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF) (official GGUF, not a third-party requant) |
| File | `Ornith-1.5-35B-Q4_K_M.gguf` |
| Path | `~/.kalsa/models/ornith-1.5-35b-a3b/Ornith-1.5-35B-Q4_K_M.gguf` |
| Size | 20.22 GiB (21 713 463 040 bytes, from Hugging Face `Content-Length`) |
| Quant | Q4_K_M |

**Why Q4_K_M:** this Mac has 64 GB RAM and ~109 GB free disk. Q4_K_M is the
requested class and fits comfortably (~20 GB weights). Same official repo also
ships Q5_K_M (23.61 GiB), Q6_K (27.20 GiB), Q8_0 (35.21 GiB). Those would still
load on 64 GB; Q4_K_M leaves more unified-memory headroom for a 32k context,
Metal scratch, and the desktop. Not using `mmproj-Ornith-1.5-35B-BF16.gguf`
(vision projector) — this endpoint is chat completions only.

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

To be filled after `run.sh` brings `/health` up. Capture with:

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
