//! The engine walk against the real release, on this real machine.
//!
//! Everything else in this workspace is proved against fixtures: an archive we
//! built, a server we faked, a digest we chose. That proves the logic and says
//! nothing about the four facts only the world can settle — that the asset
//! table names files GitHub actually publishes, that their digests are the
//! ones we wrote down, that the archive extracts to a binary this OS will
//! execute, and that the flags we pass are flags *this* build accepts.
//!
//! Ignored by default: it downloads from the network and runs a child. Run it
//! deliberately, with `cargo test -p kalsa-runtime --test real_engine
//! -- --ignored --nocapture`.

use kalsa_probe::ProbeConfig;

#[test]
#[ignore = "downloads the real release and runs a real server"]
fn the_real_release_downloads_extracts_and_answers() {
    // The backend the app would use: detection is not public on its own,
    // it travels inside the measurement, and that is the path under test.
    let measured = kalsa_probe::measure(&ProbeConfig::default());
    eprintln!(
        "backend: {:?} (measured on {:?})",
        measured.will_run_on, measured.measured_on
    );

    let mut last = 0u64;
    let decision = kalsa_runtime::decide(measured.will_run_on, &mut |p| {
        // Progress is not decoration here: a walk that never reports bytes is
        // a walk that silently found nothing to do.
        if p.bytes_done > last {
            last = p.bytes_done;
            eprintln!("  {} / {} bytes", p.bytes_done, p.bytes_total);
        }
    })
    .expect("the release this machine's backend names must download, extract and answer");

    let exe = &decision.exe;
    assert!(exe.is_file(), "the decided server is not a file: {exe:?}");
    let meta = std::fs::metadata(exe).expect("metadata");
    assert!(meta.len() > 0, "the decided server is empty");
    eprintln!("decided: {} ({} bytes)", exe.display(), meta.len());
}
