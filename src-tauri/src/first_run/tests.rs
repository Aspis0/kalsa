use super::*;

fn scratch(name: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("kalsa-brain-first-run-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
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
