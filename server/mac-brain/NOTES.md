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

**M1b:** mtplx *can* serve this tree over OpenAI HTTP. llama-server GGUF path is fallback only. No conversion, no download.

## Serving runtime (M1b) — mtplx, already up

| | |
| --- | --- |
| CLI wrapper | `~/.mtplx/bin/mtplx` → `exec '/Users/marco/Library/Application Support/MTPLX/runtime-venv/bin/mtplx'` |
| App | `/Applications/MTPLX.app` |
| Version | `mtplx 2.11.1` |
| Subcommands | `start`, `tune`, `setup`, `quickstart`, `serve`, `connect`, `ask`, `run`, `chat`, `status`, `stop`, `settings`, `inspect`, `trace`, `forge`, `hardware`, `models` |
| Live process | `python -m mtplx.server.openai` (PID 42053) launched by `mtplx serve --host 127.0.0.1 --port 8000 --model …V2-MTPLX … --app-launch-id …` |
| Bind | `127.0.0.1:8000` only. `run.sh` uses a mkdir lock + `/v1/models` attach so two scripts cannot both spawn. A second copy of the 21 GiB weights would still OOM if something else loaded them. |
| Spawn/lock residual | `nohup` backgrounds `mtplx serve`; the child pid is written into `macbrain.lock/pid`. Wrapper EXIT after ready still rmdirs the lock (attach path). SIGKILL of the wrapper before that write, or a second start before `/v1/models` is ready, is an accepted residual — not a lock redesign. |
| OpenAI API | `/v1/models`, `/v1/chat/completions` (stream + non-stream), `/docs`. `/health` (not `/v1/health`). |
| Served id | `philipjohnbasile-ornith-ai-ornith-1.5-35b-a3b-v2-mtplx` |
| pi | `~/.pi/agent/models.json` provider `mtplx` `baseUrl: http://127.0.0.1:8000/v1`. Paseo profile `Free Coder open` uses `mtplx/philipjohnbasile-ornith-ai-ornith-1-5-35b-a3b-v2-mtplx`. |

**Auth:** `mtplx serve` supports `--api-key`, `--api-key-file`, `--no-auth` (localhost). The **live** daemon has **none of those flags**. `/health` and `/v1/models` return 200 with no header. Chat completions return 200 with no key **and** with a dummy `Authorization: Bearer`. This is acceptable for loopback-only. **It is not acceptable to Tailscale-Serve this port until a key is configured** — flag before any Serve enable. `~/.kalsa/api-keys` exists for the llama-server fallback; the live mtplx process does not read it. pi stores its own key for `:8000` but the server does not enforce it.

**Do not** `mtplx stop` this daemon from Kalsa scripts — it is the Paseo local coder.

Smoke (this run, no extra start):

- `GET /health` → 200, `"ok": true`, model path the MTPLX tree.
- Non-stream `POST /v1/chat/completions` → 200, `content: "pong"`, model id as above. Needs `max_tokens` ≳ 64 because reasoning (`qwen3` parser, effort medium) consumes tokens before the answer.
- Stream → incremental `data:` chunks (141 lines), visible `delta.content` `"1 2 3 4 5 6 7 8"`, final `data: [DONE]`. ~60 tok/s decode.

`--download` exists on `mtplx serve`. `run.sh` never passes it.

## Flags

**Live mtplx (authoritative):** `--host 127.0.0.1 --port 8000 --model ~/.mtplx/models/philipjohnbasile--ornith-ai-Ornith-1.5-35B-A3B-V2-MTPLX --generation-mode mtp --profile sustained --depth 1 --scheduler-mode ar_batch --batching-preset agent --max-active-requests 2` plus the app's MTP/fan/adaptive flags. No `--api-key*`.

**llama-server fallback** (`run.sh --backend llama-server`) — only if a GGUF exists; unused this run:

```
llama-server --model <GGUF> --host 127.0.0.1 --port 8080 --ctx-size 32768
  --threads 8 --n-gpu-layers all --flash-attn auto
  --api-key-file ~/.kalsa/api-keys --sse-ping-interval 30
```

API key file: `~/.kalsa/api-keys` (mode 600, one token per line). Not in git. Enforced only by llama-server.

## RAM (mtplx Ornith, measured 2026-09-13)

From the stream completion `mtplx_stats`: `active_memory_bytes` 21 551 025 666 (~20.1 GiB), `peak_memory_bytes` 44 632 099 336 (~41.6 GiB), `cache_memory_bytes` ~348 MiB. Process RSS of the Python server is a red herring (~431 MiB) — weights live in Metal/MLX.

64 GB machine: peak ~42 GiB is tight-but-ok; do **not** start a second Ornith (no llama-server + mtplx, no second `mtplx serve` on 8080).

## Tailnet

| | |
| --- | --- |
| CLI | `/Applications/Tailscale.app/Contents/MacOS/Tailscale` (`tailscale` is not on the default PATH) |
| Logged in | yes — see `LOCAL.md` (gitignored) for node name / MagicDNS |
| MagicDNS | `https://<this-mac>.<tailnet>.ts.net` |
| Serve | **not enabled on this tailnet.** `tailscale serve --bg 8080` prints `Serve is not enabled on your tailnet` and a login.tailscale.com enable URL; `serve status` stays `No serve config`. Funnel was not used. An admin must enable Serve, then re-run `…/Tailscale serve --bg 8080`. |
| Local | `http://127.0.0.1:8000` (mtplx OpenAI server, Ornith). 8080 is the llama-server fallback and is free. |
| Serve target when enabled | `tailscale serve --bg 8000` (not 8080). Still blocked on the tailnet admin toggle. |
