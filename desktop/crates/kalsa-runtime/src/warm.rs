//! A fresh build's first run, spent before anything is timed.
//!
//! A build installed seconds ago has its files scanned by the antivirus on
//! first use, and on a corporate laptop that scan outlasted the tune's ready
//! deadline: the same argv was ready in 7-10 s by hand afterwards. Running
//! the engine once after the install — `--list-devices`, which loads every
//! backend library and exits — moves that cost here, where nothing is timed.

use std::path::Path;
use std::time::Duration;

use crate::devices::ask_list_devices;

/// Generous: the scan is somebody else's clock, and this run is the one place
/// a slow answer costs nothing but the wait.
const WARM_DEADLINE: Duration = Duration::from_secs(300);

/// Runs the build once and discards what it says. Never an error: a build that
/// cannot be warmed is still a build, and the start goes on to find out.
pub(crate) fn warm(exe: &Path) {
    let _ = ask_list_devices(exe, WARM_DEADLINE);
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Instant;

    fn script(name: &str, body: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-runtime-warm-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let exe = dir.join("engine.sh");
        std::fs::write(&exe, format!("#!/bin/sh\n{body}\n")).expect("script");
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        exe
    }

    #[test]
    fn the_build_is_run_once_with_the_listing_flag() {
        let exe = script("ran", "echo \"$@\" > ran.txt");
        warm(&exe);
        let seen = std::fs::read_to_string(exe.with_file_name("ran.txt")).expect("the build ran");
        assert_eq!(seen.trim(), "--list-devices");
    }

    #[test]
    fn a_build_that_hangs_is_killed_at_the_deadline_not_waited_for() {
        let exe = script("hang", "sleep 30");
        let started = Instant::now();
        assert_eq!(ask_list_devices(&exe, Duration::from_millis(300)), None);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "{:?}",
            started.elapsed()
        );
    }

    #[test]
    fn a_build_that_cannot_run_is_not_an_error() {
        warm(Path::new("/nonexistent/kalsa-server"));
        let crash = script("crash", "exit 3");
        warm(&crash);
    }
}
