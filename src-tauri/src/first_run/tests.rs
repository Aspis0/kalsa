use super::*;
use kalsa_probe::Backend;

fn scratch(name: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("kalsa-brain-first-run-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

fn plan(entries: Vec<&'static ModelEntry>, missing_bytes: u64) -> Plan {
    Plan {
        machine: startup::tests::machine(Backend::Cpu),
        entries,
        missing_bytes,
    }
}

#[test]
fn a_turn_on_with_nothing_chosen_is_refused_before_it_walks() {
    let dir = scratch("require-choice");
    let state_file = dir.join("server.state");
    assert!(
        matches!(
            require_choice(&state_file, false),
            Err(StartupFailure::AwaitingChoice)
        ),
        "no stored choice and no override: refused"
    );
    assert!(require_choice(&state_file, true).is_ok(), "a dev override owns its bytes");
    let chosen = crate::options::LaunchOverrides {
        model: Some("0123456789abcdef".to_string()),
        ..Default::default()
    };
    crate::options::save(&state_file, chosen).expect("save");
    assert!(require_choice(&state_file, false).is_ok(), "a stored choice walks");
}

#[test]
fn allow_walks_exactly_the_remembered_plan_in_order() {
    let listed: Vec<&'static ModelEntry> = kalsa_catalog::rows().take(2).collect();
    let remembered = plan(listed.clone(), 10);
    let mut walked = Vec::new();
    allow(Some(&remembered), Some(u64::MAX), |_, entry, label| {
        walked.push((entry.display_name, label));
        Ok(())
    })
    .expect("a remembered plan runs");
    assert_eq!(
        walked,
        vec![
            (listed[0].display_name, format!("Model 1 of 2: {}", listed[0].display_name)),
            (listed[1].display_name, format!("Model 2 of 2: {}", listed[1].display_name)),
        ]
    );
}

#[test]
fn allow_without_a_plan_or_room_walks_nothing() {
    let mut walks = 0;
    let err = allow(None, Some(u64::MAX), |_, _, _| {
        walks += 1;
        Ok(())
    })
    .expect_err("no Test in this run: nothing to allow");
    assert!(err.contains("Press Start first"), "{err}");

    let listed: Vec<&'static ModelEntry> = kalsa_catalog::rows().take(1).collect();
    let err = allow(Some(&plan(listed, 2 * 1_073_741_824)), Some(1), |_, _, _| {
        walks += 1;
        Ok(())
    })
    .expect_err("the disk cannot hold it");
    assert!(err.contains("2 GiB"), "{err}");
    assert_eq!(walks, 0);
}

#[test]
fn a_walk_that_fails_stops_the_allow() {
    let listed: Vec<&'static ModelEntry> = kalsa_catalog::rows().take(2).collect();
    let mut walks = 0;
    let err = allow(Some(&plan(listed, 0)), None, |_, _, _| {
        walks += 1;
        Err("the download failed".to_string())
    })
    .expect_err("the first failure is the answer");
    assert_eq!(err, "the download failed");
    assert_eq!(walks, 1, "the second model is not started after the first failed");
}

#[test]
fn a_missing_runtime_directory_measures_its_nearest_parent() {
    let dir = scratch("disk-free");
    let fresh = dir.join("not").join("created").join("yet");
    assert!(disk_free(&fresh).is_some(), "a fresh install still gets a space check");
}
