# Kalsa Mac brain (M1 server)

Serve **Ornith-1.5-35B-A3B** from this Mac over OpenAI-compatible HTTP + SSE.
**Preferred runtime is mtplx** (already running, already has the weights).
llama-server is a GGUF fallback only.

Exposed on the tailnet only through **Tailscale Serve** — not Funnel, not LAN.
Serve is currently **disabled on this tailnet**; local loopback still works.

This directory is the server-side deliverable. The phone app is a later run.

**This Mac, 2026-09-13 (M1b):** Ornith is MTPLX safetensors at
`~/.mtplx/models/philipjohnbasile--ornith-ai-Ornith-1.5-35B-A3B-V2-MTPLX/`
(21 GiB). The MTPLX app already serves it at `http://127.0.0.1:8000`
(`python -m mtplx.server.openai`). No GGUF, no download, no conversion.
Do not start a second copy on 8080 (would double ~21 GiB / ~42 GiB peak).

## What you get

| Piece | Role |
| --- | --- |
| `run.sh` | `--backend mtplx` (default) attaches to `:8000` if up, else `mtplx serve` (never `--download`). `--backend llama-server` is the GGUF path on `:8080`. Prints URLs. Never prints the key. |
| `test-sse.sh` | curl: `/health`, non-stream `/v1/chat/completions`, streaming SSE ending in `data: [DONE]`. Default base `http://127.0.0.1:8000`. |
| `com.kalsa.macbrain.plist` | launchd **template for llama-server only**. Not auto-installed. mtplx is owned by MTPLX.app. |
| `NOTES.md` | mtplx binary/ports/auth, llama.cpp fallback, measured RAM. |

## Requirements

- Apple Silicon Mac, 64 GB recommended (mtplx Ornith peaked ~42 GiB this run).
- MTPLX.app (this Mac: v2.11.1) with the Ornith tree already in `~/.mtplx/models/`.
- Tailscale app logged in for later Serve. If missing/logged out, skip exposure.

## 1. Runtime: mtplx (preferred)

CLI: `~/.mtplx/bin/mtplx` (not a Homebrew formula). The GUI already launched:

```
mtplx serve --host 127.0.0.1 --port 8000 \
  --model ~/.mtplx/models/philipjohnbasile--ornith-ai-Ornith-1.5-35B-A3B-V2-MTPLX
```

OpenAI surface: `http://127.0.0.1:8000` (`/health`, `/v1/models`, `/v1/chat/completions`).
**Do not** start a second Ornith on 8080. `run.sh` attaches to this daemon.

llama.cpp is optional fallback only (`brew install llama.cpp`, tag `b10360` here).
See `NOTES.md`.

## 2. Model

On this Mac the complete Ornith is the MTPLX tree (21 GiB safetensors + MTP sidecar).
**Do not download a GGUF** unless a later run explicitly allows it. There is no
local Ornith GGUF.

## 3. API key

The **live mtplx daemon has no API key** (`--api-key` / `--api-key-file` not set;
dummy Bearer still 200). Loopback-only is acceptable. **Set a key before
Tailscale Serve.** `mtplx serve --api-key-file ~/.kalsa/api-keys` (or
`~/.mtplx/api-key`). Changing auth on the live daemon will break pi/Paseo
until those clients get the same key — coordinate.

`run.sh` still mints `~/.kalsa/api-keys` (mode 600) for the llama-server
fallback. Never commit or print it. llama-server clients send
`Authorization: Bearer <that-line>`.

## 4. Run

```bash
chmod +x server/mac-brain/run.sh server/mac-brain/test-sse.sh
./server/mac-brain/run.sh                  # mtplx, attach or serve on :8000
./server/mac-brain/run.sh --backend llama-server   # GGUF on :8080, if present
```

Expected (key never shown):

```
backend: mtplx
local:  http://127.0.0.1:8000
tailnet: https://<this-mac>.<tailnet>.ts.net  (Serve must be enabled…)
```

`run.sh` **nohup-backgrounds** a spawn (it is not a foreground supervisor).
A mkdir lock under `~/.kalsa/macbrain.lock` serializes attach/spawn so two
concurrent starts cannot both load weights. The lock directory stores the
holder pid; a dead pid is reclaimed under a short mkdir mutex
(`.reclaim`) so two waiters that both saw the same dead pid cannot both
mv the replacement lock. A lock with no pid file
is never stolen (the holder may still be writing it). If a start times out
on that lock, recover with `rm -rf ~/.kalsa/macbrain.lock ~/.kalsa/macbrain.lock.reclaim` (only when no
`run.sh` is running). mtplx `--no-auth` is loopback-only:
`KALSA_BRAIN_HOST` must be `127.0.0.1` / `localhost` / `::1`. If something
is already listening and `/v1/models` returns a model list, it attaches.
llama-server still **exits 1** on a busy 8080. The launchd plist (`KeepAlive`)
is the restart path for llama-server only — edit the hardcoded `/Users/marco`
paths first.

## 5. Prove it locally

```bash
./server/mac-brain/test-sse.sh
# or: ./server/mac-brain/test-sse.sh http://127.0.0.1:8000
```

1. `GET /health`.
2. Non-stream `POST /v1/chat/completions` (`test-sse.sh` uses `max_tokens` 256;
   the phone app default is 4096).
3. Stream `POST /v1/chat/completions` — incremental `data:` then `data: [DONE]`.
   Optional: `./server/mac-brain/test-sse.sh http://127.0.0.1:8000 <model-id>`.

## 6. Tailscale Serve (tailnet only)

Do **not** use Funnel. Check the CLI is present and logged in first:

```bash
# GUI build on this Mac:
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
```

If the binary is missing or `Logged out`, skip Serve. Local `127.0.0.1:8000`
still works. **Do not Serve until mtplx has an API key.**

Background proxy of the loopback server:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 8000
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
```

Equivalent if `tailscale` is on `PATH`: `tailscale serve --bg 8000`.

Then, **from this Mac** (or any logged-in tailnet device):

```bash
./server/mac-brain/test-sse.sh https://<this-mac>.<tailnet>.ts.net
```

Replace the hostname with whatever `tailscale status --json` reports as
`Self.DNSName` (strip the trailing dot).

## 7. launchd (optional, llama-server only, not installed)

mtplx is owned by MTPLX.app — do not wrap it in this plist. The plist is a
llama-server fallback template. Edit paths if you are not `marco`, then:

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

Do **not** `mtplx stop` the app-owned daemon from here (it is Paseo's local
coder). Only kill a pidfile that `run.sh` itself created:

```bash
kill "$(cat ~/.kalsa/macbrain.pid)"
# llama-server fallback:
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
| `model not found` | mtplx: directory under `~/.mtplx/models/`. llama-server: GGUF path / `KALSA_BRAIN_MODEL`. |
| `mtplx already serving` | Expected. `run.sh` attached; do not start another copy. |
| `llama-server not on PATH` | `brew install llama.cpp`; or use `/opt/homebrew/bin/llama-server`. |
| `refusing double-start` | llama-server: something already owns 8080 (`lsof -nP -iTCP:8080 -sTCP:LISTEN`). |
| `/health` not ready in 180s | `tail -n 80 ~/.kalsa/macbrain.log`. First load of 20 GB can take a minute. |
| HTTP 401 | llama-server: Bearer must match `~/.kalsa/api-keys`. mtplx live: no key required on localhost. |
| `Serve is not enabled on your tailnet` | Admin must enable Serve (`login.tailscale.com/f/serve`). Do not use Funnel. Put a key on mtplx before Serve. |
| Tailscale URL fails, local works | Serve status pointing at **8000**? Funnel must stay off. |
| Stream has no `data: [DONE]` | `stream: true` and `curl -N`. Raise `max_tokens` (Ornith reasons first). |

## Next run (phone app)

- Local now: `http://127.0.0.1:8000`. Tailnet later:
  `https://<this-mac>.<tailnet>.ts.net` **after** Serve is enabled
  **and** mtplx has an API key. Machine-specific values live in
  `server/mac-brain/LOCAL.md` (gitignored).
- Model id: `philipjohnbasile-ornith-ai-ornith-1.5-35b-a3b-v2-mtplx`
  (single-model server; other ids may still work).
- API: OpenAI `/v1/chat/completions` with `stream: true`. Give
  `max_tokens` enough for Qwen3 reasoning + answer (256+).
- Do not implement app code in this directory.
