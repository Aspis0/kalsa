#![cfg(unix)]

mod common;

use common::{FakeHealth, When, clear_files, config, unique_port, wait_for};
use kalsa_supervisor::{Failure, ServerState, Supervisor};

#[test]
fn signal_number_survives_an_engine_exit_with_diagnostics() {
    let port = unique_port();
    clear_files(port);
    let _health = FakeHealth::start(port, When::OnceChildIsUp);
    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_signal.sh", port));
    wait_for(&supervisor, |state| {
        matches!(state, ServerState::Running { .. })
    });
    let failed = wait_for(&supervisor, |state| {
        matches!(state, ServerState::Failed { .. })
    });
    match failed {
        ServerState::Failed {
            reason:
                Failure::ServerExited {
                    detail,
                    exit_code,
                    exit_signal,
                },
        } => {
            assert_eq!(exit_code, None);
            assert_eq!(exit_signal, Some(15));
            assert!(detail.contains("GGML_ASSERT ggml-vulkan.cpp:1234"));
        }
        other => panic!("unexpected state {other:?}"),
    }
    supervisor.shutdown();
    clear_files(port);
}
