# Kalsa

An open-source, macOS-first desktop app. It reads the machine, ranks local
inference engines from published benchmarks, installs and launches the chosen
engine in isolation, and offers a thin chat over an OpenAI-compatible endpoint.
Kalsa builds no engine; every engine is credited with author, licence, source
and measurements.

The repository is at M0 (strip). `PLAN.md` holds the milestones.

Build: `cargo check --workspace`; `npm --prefix chat ci && npm --prefix chat run build`.
Tests: `cargo test -p kalsa-probe -p kalsa-catalog`.
