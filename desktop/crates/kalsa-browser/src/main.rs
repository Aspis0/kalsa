//! Starts the browser server. The window and the page it drives belong to the
//! person; this process only holds the rules.

use kalsa_browser::{env, mcp};
use rmcp::ServiceExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

fn main() -> std::process::ExitCode {
    // When this run began, which is what separates a profile left behind by an
    // earlier one from a profile a live run is writing to.
    let started = std::time::SystemTime::now();

    // Before the runtime builds a thread pool: the driver and the browser are
    // both started with this environment, and everything left in it is something
    // a page could learn about the person.
    env::reduce();
    sweep_stale_profiles(started);

    let profile = match fresh_profile_dir() {
        Ok(profile) => profile,
        Err(_) => return fail("a profile directory could not be made"),
    };

    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(_) => return fail("the async runtime could not be started"),
    };
    let stopped = runtime.block_on(serve(profile.to_string_lossy().into_owned()));
    let _ = std::fs::remove_dir_all(&profile);
    match stopped {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(()) => fail("the browser server stopped"),
    }
}

/// A directory of our own that nothing else could have made. `create_dir` fails
/// if the name is taken, so a name that already existed is not adopted — it is
/// walked past — and the directory we get is one nobody has written in.
///
/// Readable and writable by us alone: this holds every cookie and every history
/// entry the person will ever have in this window, and a directory another
/// account on this computer could list is a directory we did not choose.
///
/// **In the product the host passes the directory in**, under app data with its
/// own ownership and its own "Clear Kalsa's browser data". This is the
/// standalone binary's own: a throwaway one, because nobody has asked for
/// anything to be remembered between runs.
fn fresh_profile_dir() -> std::io::Result<PathBuf> {
    static TRIES: AtomicU64 = AtomicU64::new(0);
    for _ in 0..16 {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|since| since.as_nanos())
            .unwrap_or_default();
        let nonce = TRIES.fetch_add(1, Ordering::Relaxed);
        let name = format!("kalsa-browser-profile-{}-{stamp}-{nonce}", std::process::id());
        let dir = std::env::temp_dir().join(name);
        match std::fs::create_dir(&dir) {
            Ok(()) => {
                // `create_dir` takes whatever the umask allows, which on a shared
                // machine can be more than us. Narrowed here, once the directory
                // is ours.
                #[cfg(unix)]
                std::fs::set_permissions(
                    &dir,
                    std::os::unix::fs::PermissionsExt::from_mode(0o700),
                )
                .ok();
                return Ok(dir);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "every profile name was taken"))
}

/// Remove what a run that was killed left behind.
///
/// A process that is stopped rather than asked to stop never reaches the cleanup
/// at the end of `main`, so this is where a profile goes instead. Only names this
/// binary made, and only those last written **before this process started**:
/// anything newer was written by this run or by a run still alive, and deleting
/// it would pull a live browser out from under it.
fn sweep_stale_profiles(started: std::time::SystemTime) {
    let Ok(started) = started.duration_since(std::time::UNIX_EPOCH) else {
        return;
    };
    let temp = std::env::temp_dir();
    let Ok(entries) = std::fs::read_dir(&temp) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Ok(written) = entry.metadata().and_then(|meta| meta.modified()) else {
            continue;
        };
        let Ok(written) = written.duration_since(std::time::UNIX_EPOCH) else {
            continue;
        };
        if is_stale(&name, std::time::UNIX_EPOCH + written, std::time::UNIX_EPOCH + started) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Whether a directory in the temp folder is one this binary made and left
/// behind. Anything still being written to belongs to a run that is alive.
fn is_stale(name: &str, written: std::time::SystemTime, started: std::time::SystemTime) -> bool {
    name.starts_with("kalsa-browser-profile-") && written < started
}

async fn serve(profile: String) -> Result<(), ()> {
    let service = mcp::BrowserServer::new(profile).serve(rmcp::transport::stdio()).await;
    match service {
        Ok(service) => service.waiting().await.map(|_| ()).map_err(|_| ()),
        Err(_) => Err(()),
    }
}

/// Every line this process writes is one of these. No reply from a page and
/// nothing from a host reaches it.
fn fail(message: &str) -> std::process::ExitCode {
    eprintln!("kalsa-browser: {message}");
    std::process::ExitCode::FAILURE
}

#[cfg(test)]
mod tests {
    use super::fresh_profile_dir;

    /// A profile nobody else has written in. A second call must not hand back
    /// the first one's directory, or one person would inherit another's session.
    #[test]
    fn a_profile_directory_is_ours_alone_and_never_repeated() {
        let first = fresh_profile_dir().expect("a directory");
        assert!(first.is_dir());
        let second = fresh_profile_dir().expect("another directory");
        assert_ne!(first, second);
        std::fs::remove_dir_all(&first).ok();
        std::fs::remove_dir_all(&second).ok();
    }

    #[test]
    fn the_profile_we_are_given_is_one_nobody_has_written_in() {
        let dir = fresh_profile_dir().expect("a directory");
        let written = std::fs::read_dir(&dir).expect("readable").next();
        assert!(written.is_none(), "the profile starts empty, found {written:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// This holds every cookie and every history entry the person will have in
    /// the window. Another account on this computer must not be able to list it.
    #[cfg(unix)]
    #[test]
    fn the_profile_is_readable_by_us_alone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = fresh_profile_dir().expect("a directory");
        let mode = std::fs::metadata(&dir).expect("readable").permissions().mode() & 0o777;
        assert_eq!(mode, 0o700, "the profile is mode {mode:o}");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A run that was killed leaves a directory behind holding a person's
    /// browsing. The next run clears it; a run that is still going is left alone,
    /// because deleting its profile would pull the browser out from under it.
    #[test]
    fn a_running_profile_and_another_binary_s_directory_are_never_swept() {
        let running = std::env::temp_dir().join(format!("kalsa-browser-profile-live-test-{}", std::process::id()));
        let ours = std::env::temp_dir().join(format!("kalsa-browser-profile-live-ours-{}", std::process::id()));
        let someone_elses = std::env::temp_dir().join(format!("kalsa-browser-rs-profile-{}", std::process::id()));
        let started = std::time::SystemTime::now();
        for dir in [&running, &ours, &someone_elses] {
            // Cleared first: a directory left by an earlier run keeps its old
            // timestamp, and would then look exactly like what we are testing.
            let _ = std::fs::remove_dir_all(dir);
            std::fs::create_dir_all(dir).expect("a directory");
        }

        super::sweep_stale_profiles(started);

        assert!(running.exists(), "a running profile must never be swept");
        assert!(someone_elses.exists(), "another binary's directory must never be swept");
        for dir in [&running, &ours, &someone_elses] {
            std::fs::remove_dir_all(dir).ok();
        }
    }

    /// What the sweep is allowed to take: a name this binary made, written before
    /// this process started. Everything else is a run in progress or a
    /// directory that is not ours.
    #[test]
    fn only_an_older_directory_of_our_own_naming_is_stale() {
        let now = std::time::SystemTime::now();
        let earlier = now - std::time::Duration::from_secs(60);
        let later = now + std::time::Duration::from_secs(60);
        let (start, old, new) = (now, earlier, later);

        assert!(super::is_stale("kalsa-browser-profile-1-2-3", old, start), "an older profile of ours");
        assert!(!super::is_stale("kalsa-browser-profile-1-2-3", new, start), "a run still going");
        assert!(!super::is_stale("kalsa-browser-rs-profile-1", old, start), "another binary's");
        assert!(!super::is_stale("something-else", old, start), "a directory that is not ours");
    }
}
