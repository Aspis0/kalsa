# Kalsa

An open-source, macOS-first desktop app. It reads the machine, ranks local
inference engines from published benchmarks, installs and launches the chosen
engine in isolation, and offers a thin chat over an OpenAI-compatible endpoint.
Kalsa builds no engine; every engine is credited with author, licence, source
and measurements.

The catalog lives in `catalog/engines.toml`; the website is generated from it by `crates/kalsa-site`.

Build: `cargo check --workspace`; `npm --prefix chat ci && npm --prefix chat run build`.
Tests: `cargo test -p kalsa-engines -p kalsa-site -p kalsa-engine-host`.
