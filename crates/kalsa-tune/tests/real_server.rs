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

use kalsa_tune::{measure_tune, Ask, Candidate};

/// The scratch state root, removed on the way out even when the test
/// panics: a leftover temp dir is not a failure anyone can see.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("kalsa-tune-real-{}", std::process::id()));
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
        eprintln!("SKIPPED: set KALSA_TUNE_REAL_SERVER and KALSA_TUNE_REAL_MODEL to run this test");
        return;
    };
    let candidates = [
        Candidate {
            backend: ServerBackend::Metal,
            threads: Some(8),
            offload: Offload::EngineFitted,
            draft: None,
        },
        Candidate {
            backend: ServerBackend::Metal,
            threads: Some(8),
            offload: Offload::ForcedOff,
            draft: None,
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
    let ask = Ask {
        prompt: kalsa_tune::DRAFT_PROMPT,
        temperature: None,
        top_p: None,
        top_k: None,
        seed: Some(kalsa_tune::DRAFT_SEED),
        n_predict: kalsa_tune::DRAFT_N_PREDICT,
        chat: true,
        min_generated: kalsa_tune::DRAFT_MIN_GENERATED,
    };
    let tuned = measure_tune(&resolved, &root, &ask, false, &[], build, &mut |_| {}, &mut |_| {});

    let mut lines = Vec::new();
    let mut scored = 0usize;
    for (candidate, kept) in &tuned.trials {
        let label = match candidate.offload {
            Offload::All => "full offload",
            Offload::ForcedOff => "forced off (--n-gpu-layers 0)",
            Offload::NoGpuBuild => "cpu build",
            Offload::EngineFitted => "engine-fitted",
        };
        match kept {
            kalsa_tune::record::Kept::Replied(reply) => {
                scored += 1;
                lines.push(format!("{label}: {} (of {reply:?})", reply.seconds));
            }
            other => lines.push(format!("{label}: no reply ({other:?})")),
        }
    }
    for line in &lines {
        eprintln!("{line}");
    }
    assert_eq!(
        scored,
        resolved.len(),
        "both shapes must have measured a reply: {lines:?}"
    );
}
