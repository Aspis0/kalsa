//! The real thing: two offloads of one Metal build on this machine, when
//! the owner points at a server and a model. Nothing is downloaded, and
//! the measure's own drop stops every child it starts.
//!
//! ```text
//! KALSA_TUNE_REAL_SERVER=<path to kalsa-server> \
//! KALSA_TUNE_REAL_MODEL=<path to a .gguf> \
//!   cargo test -p kalsa-tune --test real_server -- --ignored --nocapture
//! ```

use std::path::{Path, PathBuf};

use kalsa_launch::Offload;
use kalsa_runtime::ServerBackend;

use kalsa_tune::{measure_candidates, Candidate};

/// The scratch state root, removed on the way out even when the test
/// panics: a leftover temp dir is not a failure anyone can see.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-tune-real-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        Self(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl std::ops::Deref for Scratch {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.0
    }
}

/// One build, two offloads: what the owner's rule asks the measure to
/// decide — full offload against the same build forced onto the CPU.
#[ignore = "starts the real engine; set KALSA_TUNE_REAL_SERVER and KALSA_TUNE_REAL_MODEL"]
#[test]
fn the_metal_build_measures_full_and_forced_off() {
    let (Ok(server), Ok(model)) = (
        std::env::var("KALSA_TUNE_REAL_SERVER"),
        std::env::var("KALSA_TUNE_REAL_MODEL"),
    ) else {
        eprintln!(
            "SKIPPED: set KALSA_TUNE_REAL_SERVER and KALSA_TUNE_REAL_MODEL to run this test"
        );
        return;
    };
    let candidates = [
        Candidate {
            backend: ServerBackend::Metal,
            threads: Some(8),
            offload: Offload::EngineFitted,
        },
        Candidate {
            backend: ServerBackend::Metal,
            threads: Some(8),
            offload: Offload::ForcedOff,
        },
    ];
    let root = Scratch::new();
    // Both candidates are the same Metal build — the exe travels with the
    // candidate so the measure can never pair them wrongly.
    let resolved = candidates
        .iter()
        .map(|candidate| (*candidate, PathBuf::from(&server)))
        .collect::<Vec<_>>();
    let build = |candidate: &Candidate, exe: &PathBuf, port: u16| {
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
            Offload::NoGpuBuild | Offload::EngineFitted => {}
        }
        (exe.clone(), argv)
    };
    let results = measure_candidates(&resolved, &root, build, &mut |_, _| {});

    let mut lines = Vec::new();
    for (candidate, outcome) in &results {
        let label = match candidate.offload {
            Offload::All => "full offload",
            Offload::ForcedOff => "forced off (--n-gpu-layers 0)",
            Offload::NoGpuBuild => "cpu build",
            Offload::EngineFitted => "engine-fitted",
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
