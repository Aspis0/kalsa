//! The real thing: two offloads of one Metal build on this machine, when
//! the owner points at a server and a model. Nothing is downloaded, and
//! the measure's own drop stops every child it starts.
//!
//! ```text
//! KALSA_TUNE_REAL_SERVER=<path to kalsa-server> \
//! KALSA_TUNE_REAL_MODEL=<path to a .gguf> \
//!   cargo test -p kalsa-tune --test real_server -- --ignored --nocapture
//! ```

use std::path::PathBuf;

use kalsa_launch::Offload;
use kalsa_runtime::ServerBackend;

use kalsa_tune::{measure_candidates, Candidate};

/// One build, two offloads: what the owner's rule asks the measure to
/// decide — full offload against the same build forced onto the CPU.
#[ignore = "starts the real engine; set KALSA_TUNE_REAL_SERVER and KALSA_TUNE_REAL_MODEL"]
#[test]
fn the_metal_build_measures_full_and_forced_off() {
    let (Ok(server), Ok(model)) = (
        std::env::var("KALSA_TUNE_REAL_SERVER"),
        std::env::var("KALSA_TUNE_REAL_MODEL"),
    ) else {
        eprintln!("skipping: KALSA_TUNE_REAL_SERVER / KALSA_TUNE_REAL_MODEL are not both set");
        return;
    };
    let candidates = [
        Candidate {
            backend: ServerBackend::Metal,
            threads: Some(8),
            offload: Offload::All,
        },
        Candidate {
            backend: ServerBackend::Metal,
            threads: Some(8),
            offload: Offload::ForcedOff,
        },
    ];
    let root = std::env::temp_dir().join(format!("kalsa-tune-real-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let build = |candidate: &Candidate, port: u16| {
        let mut argv = vec![
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            port.to_string(),
            "--model".to_string(),
            model.clone(),
            "--no-webui".to_string(),
        ];
        match candidate.offload {
            Offload::All => argv.extend(["--n-gpu-layers".to_string(), "all".to_string()]),
            Offload::ForcedOff => argv.extend(["--n-gpu-layers".to_string(), "0".to_string()]),
            Offload::NoGpuBuild => {}
        }
        (PathBuf::from(&server), argv)
    };
    let results = measure_candidates(&candidates, &root, build, &mut |_, _| {});
    let _ = std::fs::remove_dir_all(&root);

    let mut lines = Vec::new();
    for (candidate, outcome) in &results {
        let label = match candidate.offload {
            Offload::All => "full offload",
            Offload::ForcedOff => "forced off (--n-gpu-layers 0)",
            Offload::NoGpuBuild => "cpu build",
        };
        match outcome.best() {
            Some(rate) => lines.push(format!("{label}: {rate} tok/s (of {outcome:?})")),
            None => lines.push(format!("{label}: refused ({outcome:?})")),
        }
    }
    for line in &lines {
        eprintln!("{line}");
    }
    let bests = results
        .iter()
        .map(|(_, outcome)| {
            outcome
                .best()
                .unwrap_or_else(|| panic!("this machine must measure both: {lines:?}"))
        })
        .collect::<Vec<_>>();
    assert_eq!(bests.len(), 2, "both lifetimes must have run: {lines:?}");
}
