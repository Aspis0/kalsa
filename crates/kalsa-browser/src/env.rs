//! What this process's environment is allowed to contain (one responsibility:
//! leave an allowlist behind and drop everything else).
//!
//! The driver process, and the browser it starts, are both spawned with this
//! environment, so every variable here is something a page could learn about the
//! person and something that could change how the browser is launched.
//! `playwright-rs` reads the browser's own variables off this environment, and
//! on Windows it reads `CI` and `GITHUB_ACTIONS` to decide to add
//! `--no-sandbox`, `--disable-web-security` and `--disable-gpu` to the launch
//! (its `browser_type.rs`). A machine that happened to be a CI machine would
//! hand Kalsa a browser with its sandbox off.
//!
//! So the environment is reduced here, in `main`, before the runtime starts a
//! thread and before anything is spawned — not cleaned up afterwards, because by
//! then a thread has already read it.

/// Kept on every platform: what the browser needs to find itself, and the one
/// variable naming the driver that was verified before it arrived.
const KEPT: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LANGUAGE",
    "PLAYWRIGHT_DRIVER_PATH",
];

/// Kept on Windows, where the browser and the resolver need them and a Unix path
/// is not enough to find either.
#[cfg(target_os = "windows")]
const KEPT_ON_WINDOWS: &[&str] = &[
    "SystemRoot",
    "windir",
    "LOCALAPPDATA",
    "APPDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramData",
    "ComSpec",
    "PATHEXT",
    "USERPROFILE",
    "PUBLIC",
];

/// Whether this variable survives.
pub fn is_allowed(name: &str) -> bool {
    if KEPT.contains(&name) || name.starts_with("LC_") {
        return true;
    }
    #[cfg(target_os = "windows")]
    if KEPT_ON_WINDOWS.contains(&name) {
        return true;
    }
    false
}

/// Every `PLAYWRIGHT_*` and every other override we did not name.
fn dropped(vars: impl Iterator<Item = String>) -> Vec<String> {
    vars.filter(|name| !is_allowed(name)).collect()
}

/// Reduce the environment to the allowlist, and say what went. Called once, from
/// `main`, before the runtime starts: after this the browser can only be
/// launched by variables we chose.
pub fn reduce() -> Vec<String> {
    let gone = dropped(std::env::vars().map(|(name, _)| name));
    for name in &gone {
        std::env::remove_var(name);
    }
    gone
}

#[cfg(test)]
mod tests {
    use super::{dropped, is_allowed};

    /// The variables that change how the browser is launched, and the ones that
    /// tell a library it may relax. None of them is on the list.
    #[test]
    fn a_poisoned_environment_is_emptied_of_everything_we_did_not_name() {
        let poisoned = [
            "NODE_OPTIONS",
            "NODE_PATH",
            "NODE_REPL_EXTERNAL_MODULE",
            "CI",
            "GITHUB_ACTIONS",
            "CONTINUOUS_INTEGRATION",
            "PLAYWRIGHT_NODE_EXE",
            "PLAYWRIGHT_CLI_JS",
            "PLAYWRIGHT_BROWSERS_PATH",
            "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
            "DYLD_INSERT_LIBRARIES",
            "LD_PRELOAD",
            "DEBUG",
            "RUST_LOG",
            "GITHUB_TOKEN",
        ];
        for name in poisoned {
            assert!(!is_allowed(name), "{name} must not survive");
            assert!(dropped(poisoned.into_iter().map(str::to_string)).contains(&name.to_string()));
        }
    }

    #[test]
    fn what_the_browser_needs_to_start_stays() {
        for name in [
            "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LANGUAGE",
            "LC_ALL", "LC_CTYPE", "PLAYWRIGHT_DRIVER_PATH",
        ] {
            assert!(is_allowed(name), "{name} must survive");
        }
    }

    #[test]
    fn a_name_that_only_looks_like_one_of_ours_does_not_survive() {
        for name in ["PLAYWRIGHT_DRIVER_PATH_OTHER", "HOME_", "PATHEXT_X", "NOT_LANG"] {
            assert!(!is_allowed(name), "{name}");
        }
    }

    #[test]
    fn an_environment_of_nothing_but_the_allowlist_drops_nothing() {
        assert!(dropped(["PATH".to_string(), "HOME".to_string()].into_iter()).is_empty());
        assert_eq!(dropped(["PATH".to_string(), "SECRET".to_string()].into_iter()), ["SECRET"]);
    }
}