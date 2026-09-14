# Kalsa Brain

Desktop app that lets a phone use the computer it already owns as its model.
This repository is the skeleton: **one screen** (status + a switch) and the part
that actually matters, the **process supervisor**.

The plan behind it is the product spec; this README is only how to build and
test what exists today.

## Layout

```
crates/kalsa-supervisor/   the supervisor: no UI, no Tauri, testable alone
  src/child.rs             spawn, stdin-as-shutdown, SIGTERM -> SIGKILL, job object
  src/health.rs            the readiness handshake (HTTP /health with a deadline)
  src/supervisor.rs        the actor: commands in, state out, watches for death
  tests/fixtures/*.sh      fake children, so tests need no server and no model
src-tauri/                 the app shell: commands + config, no logic
src/                       the one screen (static HTML/CSS/JS)
NOTICE                     what came from Jan (MIT) and what did not
```

## Build and test

```sh
cargo test -p kalsa-supervisor      # the supervisor: fast, no network, no model
cargo check -p kalsa-brain          # the app shell
cargo run -p kalsa-brain            # opens the window
```

Running the app needs a server binary and a model, because model selection and
download are later pages:

```sh
KALSA_BRAIN_MODEL=/path/to/model.gguf \
KALSA_BRAIN_SERVER_BIN=$(command -v llama-server) \
cargo run -p kalsa-brain
```

Without `KALSA_BRAIN_MODEL` the switch reports that no model is selected yet.
`KALSA_BRAIN_SERVER_BIN` is a development override: a shipped build carries
`llama-server` next to its own executable.

## What the supervisor guarantees

- **Readiness is a probe, not a sleep.** `llama-server` has no startup line to
  read, so the supervisor polls `/health` until its deadline. A guessed `sleep`
  is either too short (first request fails) or too slow (the user waits on a
  server that is already up).
- **Stopping is ordered.** Close the child's stdin (the signal a cooperating
  child waits for), then SIGTERM to its process group, then SIGKILL. Always
  reaped, so no zombie survives a stop.
- **The child can die on its own.** `GGML_ASSERT` calls `abort()`, which
  `catch_unwind` does not contain — an inference crash takes down its host. The
  supervisor watches the child and reports the exit, with the last lines of its
  stderr, without taking the app down.
- **Defaults for old hardware.** Half the logical cores (2..8), batch 512,
  ubatch 128, `--sleep-idle-seconds 300`, host `127.0.0.1`. The objective is the
  highest sustainable throughput, not the maximum.

### Force-quit, per platform

| platform | what stops the child when the app is killed |
| --- | --- |
| Windows | job object with `KILL_ON_JOB_CLOSE`: the OS reaps it |
| Linux | `PR_SET_PDEATHSIG`: the kernel signals it when we die |
| macOS | **nothing.** No job object, no `PR_SET_PDEATHSIG` |

On macOS a force-quit can leave an idle `llama-server` behind. It is not
burning CPU — `--sleep-idle-seconds` unloads the model and the KV cache — but
the process is there, and the next app start must notice the port is taken and
either reuse or stop it. That work is not in this skeleton.

Closing the window normally is covered everywhere: the app's exit handler calls
`Supervisor::shutdown`, which stops the child before the process goes.

## Licence

Apache-2.0 for this shell. Parts of `crates/kalsa-supervisor/src/child.rs` are
derived from Jan's MIT-licensed `tauri-plugin-llamacpp`; see `NOTICE` for
exactly which parts and under what terms.
