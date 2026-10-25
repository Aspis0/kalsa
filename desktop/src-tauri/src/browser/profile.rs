//! The browser's own folder, and the one control that empties it.
//!
//! Kalsa keeps a profile of its own under the app data directory. Never the
//! person's, and never a copy of theirs: since Chrome 136 the remote debugging
//! switches are ignored on the default data directory
//! ([developer.chrome.com/blog/remote-debugging-port](https://developer.chrome.com/blog/remote-debugging-port)),
//! so a sidecar that drove the everyday profile could not drive it at all — and
//! a copy would carry every cookie the person already had.
//!
//! A profile is where a login lives, so it is the one place here holding
//! anything of the person's, and Settings offers one control over it.

use std::path::{Path, PathBuf};

use super::error::BrowserError;

/// The profile, made for this install and readable by this user only.
pub(crate) fn dir(app_data: &Path) -> Result<PathBuf, BrowserError> {
    let dir = app_data.join("browser").join("profile");
    std::fs::create_dir_all(&dir).map_err(|_| BrowserError::Storage)?;
    restrict(&dir)?;
    Ok(dir)
}

/// Everything the browser kept: the logins, the cookies, the history, and the
/// cache. The driver beside it is not touched — it is not the person's data
/// and re-downloading 40 MB to sign out again would be a punishment, not a fix.
pub(crate) fn clear(app_data: &Path) -> Result<(), BrowserError> {
    let profile = dir(app_data)?;
    // `remove_dir_all` and then recreate, rather than emptying entry by entry:
    // a browser profile holds nested state a version bump may add, and this
    // control has to be total.
    std::fs::remove_dir_all(&profile).map_err(|_| BrowserError::Storage)?;
    dir(app_data).map(|_| ())
}

/// Owner-only on unix, because a profile is a set of cookies and tokens.
#[cfg(unix)]
fn restrict(dir: &Path) -> Result<(), BrowserError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(|_| BrowserError::Storage)
}

#[cfg(not(unix))]
fn restrict(_dir: &Path) -> Result<(), BrowserError> {
    // Windows inherits the profile from the app data directory, which is already
    // per-user and not world readable.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-profile-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    #[test]
    fn the_profile_is_kalsas_own_directory_and_not_the_browsers() {
        let app_data = scratch("own");
        let profile = dir(&app_data).expect("the profile exists");
        assert!(profile.starts_with(&app_data));
        assert!(profile.ends_with("browser") || profile.ends_with("profile"), "{profile:?}");
        assert!(!profile.ends_with("Google/Chrome"), "{profile:?}");
        let _ = std::fs::remove_dir_all(&app_data);
    }

    #[cfg(unix)]
    #[test]
    fn the_profile_is_readable_by_its_owner_and_nobody_else() {
        use std::os::unix::fs::PermissionsExt;
        let app_data = scratch("mode");
        let profile = dir(&app_data).expect("the profile exists");
        let mode = std::fs::metadata(&profile).expect("metadata").permissions().mode();
        assert_eq!(mode & 0o777, 0o700, "the profile is not owner-only");
        let _ = std::fs::remove_dir_all(&app_data);
    }

    #[test]
    fn clearing_takes_the_browsers_data_and_leaves_the_folder_usable() {
        let app_data = scratch("clear");
        let profile = dir(&app_data).expect("the profile exists");
        std::fs::write(profile.join("Cookies"), "a login once").expect("a cookie file");
        std::fs::create_dir_all(profile.join("Default")).expect("a subfolder");
        std::fs::write(profile.join("Default/History"), "a page once").expect("history");

        clear(&app_data).expect("cleared");
        assert!(!profile.join("Cookies").exists(), "a cookie survived");
        assert!(!profile.join("Default").exists(), "a subfolder survived");
        assert!(profile.is_dir(), "the profile is not usable again");
        let _ = std::fs::remove_dir_all(&app_data);
    }

    #[test]
    fn clearing_a_profile_that_is_never_used_is_not_a_failure() {
        let app_data = scratch("never");
        clear(&app_data).expect("clearing nothing still leaves a profile");
        let _ = std::fs::remove_dir_all(&app_data);
    }
}