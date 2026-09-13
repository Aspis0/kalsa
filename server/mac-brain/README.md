# Kalsa Mac brain (M1 server)

Serve **Ornith-1.5-35B-A3B** from this Mac via `llama-server` (OpenAI-compatible
HTTP + SSE). Bound to `127.0.0.1:8080`. Exposed on the tailnet only through
**Tailscale Serve** — not Funnel, not LAN.

This directory is the server-side deliverable. The phone app is a later run.

**This Mac, 2026-09-13:** Ornith is already on disk as **MTPLX safetensors**
(`~/.mtplx/models/philipjohnbasile--ornith-ai-Ornith-1.5-35B-A3B-V2-MTPLX/`,
21 GiB), not as a GGUF. llama-server cannot load that tree. No GGUF download
or conversion was done. See `NOTES.md`. `run.sh` will exit until
`KALSA_BRAIN_MODEL` points at a GGUF.

## What you get

| Piece | Role |
| --- | --- |
| `run.sh` | Idempotent start. Generates `~/.kalsa/api-keys` if missing. Refuses a second listener. Prints local + tailnet URLs. Never prints the key. |
| `test-sse.sh` | curl: `/health`, non-stream `/v1/chat/completions`, streaming SSE ending in `data: [DONE]`. |
| `com.kalsa.macbrain.plist` | launchd **template**. Not auto-installed. |
| `NOTES.md` | Exact llama.cpp build, GGUF + quant, flags, measured RAM. |

## Requirements

- Apple Silicon Mac, ~32 GB RAM or more (64 GB is comfortable for Q4_K_M + 32k ctx).
- ~22 GB free disk for the GGUF (plus a few GB of headroom).
- Homebrew.
- Tailscale app installed and logged in (Serve is tailnet-only). If Tailscale is
  missing or logged out, skip exposure — the local endpoint still works.

## 1. Install llama.cpp

Prefer the Homebrew bottle (this machine used formula `llama.cpp` tag `b10360`):

```bash
brew install llama.cpp
llama-server --version
```

If `brew install llama.cpp` fails, use a GitHub release binary for macOS arm64
from [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp/releases) and
put `llama-server` on `PATH`. Build from source only if both of those fail.

## 2. Model (GGUF)

Hunt local copies first (`NOTES.md`). On this Mac the only complete Ornith
is MTPLX safetensors; **do not download a 20 GB GGUF unless a later run
explicitly allows it.**

If a GGUF is required and still missing, official repo:
[`ornith-ai/Ornith-1.5-35B-A3B-GGUF`](https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF).

Default on this Mac: **Q4_K_M** (`Ornith-1.5-35B-Q4_K_M.gguf`, ~20.2 GiB).
64 GB unified memory holds weights + 32k KV with headroom. Q5_K_M (~23.6 GiB)
is the next step up if you want less quant noise; Q8_0 (~35 GiB) still fits
64 GB but leaves less room for ctx. See `NOTES.md`.

```bash
mkdir -p ~/.kalsa/models/ornith-1.5-35b-a3b
hf download ornith-ai/Ornith-1.5-35B-A3B-GGUF Ornith-1.5-35B-Q4_K_M.gguf \
  --local-dir ~/.kalsa/models/ornith-1.5-35b-a3b
```

Resumable. `huggingface-cli download …` or `curl -C - -L` of the `resolve/main`
URL also work. Do **not** download `mmproj-*.gguf` for this chat endpoint.

## 3. API key

`llama-server --api-key-file` expects **one key per line**. `run.sh` creates
`~/.kalsa/api-keys` with a random 32-byte hex token (mode `600`) if the file
is missing. Do not commit it, do not paste it into chat, do not print it.

To mint one by hand:

```bash
mkdir -p ~/.kalsa
umask 077
openssl rand -hex 32 > ~/.kalsa/api-keys
chmod 600 ~/.kalsa/api-keys
```

Clients send `Authorization: Bearer <that-line>`.

## 4. Run

```bash
chmod +x server/mac-brain/run.sh server/mac-brain/test-sse.sh
./server/mac-brain/run.sh
# or: KALSA_BRAIN_MODEL=/path/to/model.gguf ./server/mac-brain/run.sh
```

Expected printout (key never shown):

```
local:  http://127.0.0.1:8080
tailnet: https://<this-mac>.<tailnet>.ts.net
```

On this Mac the MagicDNS name is `<mac>.<tailnet>.ts.net`.

Flags used: `--host 127.0.0.1 --port 8080 --ctx-size 32768 --threads 8
--n-gpu-layers all --flash-attn auto --api-key-file ~/.kalsa/api-keys
--sse-ping-interval 30`. Override with `KALSA_BRAIN_CTX`, `KALSA_BRAIN_THREADS`,
`KALSA_BRAIN_NGL`, `KALSA_BRAIN_HOST`, `KALSA_BRAIN_PORT`.

Logs: `~/.kalsa/macbrain.log`. PID: `~/.kalsa/macbrain.pid`.

A second `run.sh` while 8080 is already listening **exits 1** (double-start
refused) and still prints the URLs.

## 5. Prove it locally

```bash
./server/mac-brain/test-sse.sh
# or: ./server/mac-brain/test-sse.sh http://127.0.0.1:8080
```

That hits:

1. `GET /health` with the Bearer key.
2. Non-stream `POST /v1/chat/completions`.
3. Stream `POST /v1/chat/completions` — prints incremental `data:` lines and
   requires a final `data: [DONE]`.

## 6. Tailscale Serve (tailnet only)

Do **not** use Funnel. Check the CLI is present and logged in first:

```bash
# GUI build on this Mac:
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
```

If the binary is missing or `Logged out`, skip Serve. Local `127.0.0.1:8080`
still works.

Background proxy of the loopback server:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 8080
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
```

Equivalent if `tailscale` is on `PATH`: `tailscale serve --bg 8080`.

Then, **from this Mac** (or any logged-in tailnet device):

```bash
./server/mac-brain/test-sse.sh https://<mac>.<tailnet>.ts.net
```

Replace the hostname with whatever `tailscale status --json` reports as
`Self.DNSName` (strip the trailing dot).

## 7. launchd (optional, not installed by this run)

The plist is a template. Edit the model path / homedir if you are not `marco`,
then:

```bash
cp server/mac-brain/com.kalsa.macbrain.plist ~/Library/LaunchAgents/com.kalsa.macbrain.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kalsa.macbrain.plist
launchctl enable gui/$(id -u)/com.kalsa.macbrain
```

Do **not** run `run.sh` at the same time as the LaunchAgent — both want port
8080. `run.sh` is for a foreground-session start; launchd runs `llama-server`
directly (no double-fork).

Unload / uninstall:

```bash
launchctl bootout gui/$(id -u)/com.kalsa.macbrain
rm -f ~/Library/LaunchAgents/com.kalsa.macbrain.plist
```

## Stop / uninstall

Stop a `run.sh` server:

```bash
kill "$(cat ~/.kalsa/macbrain.pid)"
# if the pidfile is stale:
pkill -f '/llama-server.*--port 8080'
```

Remove Tailscale Serve (does not stop llama-server):

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset
```

Uninstall llama.cpp (optional): `brew uninstall llama.cpp`.

The GGUF and key live outside the repo:

```
~/.kalsa/api-keys
~/.kalsa/models/ornith-1.5-35b-a3b/Ornith-1.5-35B-Q4_K_M.gguf
~/.kalsa/macbrain.log
~/.kalsa/macbrain.pid
```

Delete that tree if you want a full wipe. **Do not** put the key in git.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `model not found` | GGUF path; `KALSA_BRAIN_MODEL`; download finished (`ls -lh ~/.kalsa/models/...`). |
| `llama-server not on PATH` | `brew install llama.cpp`; or use `/opt/homebrew/bin/llama-server`. |
| `refusing double-start` | Something already owns 8080 (`lsof -nP -iTCP:8080 -sTCP:LISTEN`). |
| `/health` not ready in 180s | `tail -n 80 ~/.kalsa/macbrain.log`. First load of 20 GB can take a minute; Metal OOM shows up here. Drop `KALSA_BRAIN_CTX` to `16384`. |
| HTTP 401 | Bearer does not match `~/.kalsa/api-keys` (first line, no quotes). |
| `Serve is not enabled on your tailnet` | This tailnet has Serve off. An admin must enable it (the CLI prints a `login.tailscale.com/f/serve` URL). Do not use Funnel. Local `127.0.0.1:8080` is independent. |
| Tailscale URL fails, local works | `tailscale status` logged in? `tailscale serve status` pointing at 8080? Funnel must stay off. |
| Stream has no `data: [DONE]` | Client must use `stream: true` and not buffer (`curl -N`). llama.cpp SSE ping interval is 30s (`--sse-ping-interval 30`). |

## Next run (phone app)

- Base URL: `https://<mac>.<tailnet>.ts.net` (HTTPS, no port).
- Auth: `Authorization: Bearer` from `~/.kalsa/api-keys` (provision the phone
  out of band; do not embed the key in the repo).
- API: OpenAI-compatible `/v1/chat/completions` with `stream: true`.
- `model` field is ignored by a single-model `llama-server`; send `ornith`.
- Do not implement app code in this directory.
