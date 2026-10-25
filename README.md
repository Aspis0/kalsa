# Kalsa

An old computer becomes the AI of the phone in your pocket: the desktop app
serves a local model, the phone app talks to it.

| folder | what it is |
|---|---|
| [`phone/`](phone/) | the React Native phone app ([README](phone/README.md)) |
| [`desktop/`](desktop/) | the Tauri desktop app, Rust crates and React chat ([README](desktop/README.md)) |

Both folders keep their full history: `phone/` was this repository's `main`,
`desktop/` was the `brain` branch (tagged `archive/brain`). CI lives in
`.github/workflows/` and builds the phone app from `phone/`.

The research lab (kernels, device measurements, reports) is the
`moe-experiments` branch, an unrelated history. The engine is the
`Aspis0/kalsallama` fork of llama.cpp; the phone binding is `Aspis0/kalsa.rn`.
