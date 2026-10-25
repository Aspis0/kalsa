//! The environment the browser sidecar is started with.
//!
//! Not an allowlist over what the app already has — the list is what the child
//! is *given*, because the app's own environment carries the knobs that decide
//! how a browser runs. `playwright-rs` reads `CI` and `GITHUB_ACTIONS` to add
//! `--no-sandbox`, `--disable-web-security` and `--disable-gpu` to a launch
//! (its `browser_type.rs`), so on a machine that happens to be a CI machine
//! Kalsa would hand the person a browser with its sandbox off. `PLAYWRIGHT_NODE_EXE`
//! and `PLAYWRIGHT_CLI_JS` are worse still: together they mean "no driver
//! directory is needed at all" (`src/server/driver.rs:25-31`), which is exactly
//! the check this host just made.
//!
//! So the launcher clears first and sets these after, and the one variable that
//! names our verified driver is ours, not the app's.

use std::path::Path;

/// Copied from the app, by name, for what the browser and its runtime need to
/// find themselves. The same list the sidecar reduces its own environment to
/// (`crates/kalsa-browser/src/env.rs:19`), so there is one answer to "what may
/// this process see" and it is written down once per side.
const CARRIED: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LANGUAGE",
];

/// Kept on Windows only, where a unix path is not enough to find the browser,
/// the resolver or a `cmd`.
#[cfg(target_os = "windows")]
const CARRIED_ON_WINDOWS: &[&str] = &[
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

/// What the sidecar is started with: the carried values, the locale overrides,
/// and `PLAYWRIGHT_DRIVER_PATH` naming the driver this host verified.
pub(crate) fn for_driver(dir: &Path) -> Vec<(String, String)> {
    collect(dir, |name| std::env::var(name).ok())
}

/// `env` is the lookup, so a test can hand it a poisoned environment instead of
/// setting one: `std::env::set_var` in a test process with other tests running
/// is a race, and a race that decides whether a browser has its sandbox is not
/// a test worth writing.
fn collect(dir: &Path, env: impl Fn(&str) -> Option<String>) -> Vec<(String, String)> {
    let mut vars: Vec<(String, String)> = CARRIED
        .iter()
        .filter_map(|name| env(name).map(|value| ((*name).to_owned(), value)))
        .collect();
    #[cfg(target_os = "windows")]
    vars.extend(
        CARRIED_ON_WINDOWS.iter().filter_map(|name| env(name).map(|value| ((*name).to_owned(), value))),
    );
    let locale = |name: &str| {
        env(name).filter(|_| name.starts_with("LC_")).map(|value| (name.to_owned(), value))
    };
    vars.extend(["LC_ALL", "LC_CTYPE", "LC_MESSAGES"].into_iter().filter_map(locale));
    vars.push(("PLAYWRIGHT_DRIVER_PATH".to_owned(), dir.display().to_string()));
    vars
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Everything that could change what the child does, with a value that
    /// would be obvious if it arrived.
    fn poisoned(name: &str) -> Option<String> {
        let hostile = [
            "PLAYWRIGHT_NODE_EXE",
            "PLAYWRIGHT_CLI_JS",
            "PLAYWRIGHT_BROWSERS_PATH",
            "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
            "PLAYWRIGHT_DRIVER_CACHE_DIR",
            "NODE_OPTIONS",
            "NODE_PATH",
            "CI",
            "GITHUB_ACTIONS",
            "CONTINUOUS_INTEGRATION",
            "DYLD_INSERT_LIBRARIES",
            "LD_PRELOAD",
            "RUST_LOG",
            "DEBUG",
            "GITHUB_TOKEN",
            "GCM_INTERACTIVE",
        ];
        hostile.contains(&name).then(|| "ambient".to_owned())
    }

    fn names(vars: &[(String, String)]) -> Vec<&str> {
        vars.iter().map(|(name, _)| name.as_str()).collect()
    }

    #[test]
    fn a_poisoned_environment_reaches_the_child_as_nothing_but_the_driver_path() {
        let vars = collect(Path::new("/kalsa/driver"), poisoned);
        assert_eq!(names(&vars), ["PLAYWRIGHT_DRIVER_PATH"]);
        assert_eq!(vars[0].1, "/kalsa/driver");
    }

    #[test]
    fn the_overrides_that_would_replace_the_verified_driver_are_never_carried() {
        let vars = collect(Path::new("/kalsa/driver"), poisoned);
        for name in ["PLAYWRIGHT_NODE_EXE", "PLAYWRIGHT_CLI_JS", "PLAYWRIGHT_BROWSERS_PATH"] {
            assert!(!names(&vars).contains(&name), "{name} is how the driver check is skipped");
        }
    }

    #[test]
    fn what_the_browser_needs_to_find_itself_is_carried_and_nothing_else_is() {
        let ambient = |name: &str| match name {
            "PATH" => Some("/usr/bin".to_owned()),
            "HOME" => Some("/Users/someone".to_owned()),
            "TMPDIR" => Some("/tmp".to_owned()),
            "LC_ALL" => Some("it_IT.UTF-8".to_owned()),
            "SECRET" => Some("a token".to_owned()),
            _ => None,
        };
        let vars = collect(Path::new("/kalsa/driver"), ambient);
        assert_eq!(
            vars,
            vec![
                ("PATH".to_owned(), "/usr/bin".to_owned()),
                ("HOME".to_owned(), "/Users/someone".to_owned()),
                ("TMPDIR".to_owned(), "/tmp".to_owned()),
                ("LC_ALL".to_owned(), "it_IT.UTF-8".to_owned()),
                ("PLAYWRIGHT_DRIVER_PATH".to_owned(), "/kalsa/driver".to_owned()),
            ]
        );
    }

    #[test]
    fn the_driver_directory_is_the_one_we_named_and_not_an_ambient_variable() {
        let ambient = |name: &str| {
            (name == "PLAYWRIGHT_DRIVER_PATH").then(|| "/somewhere/else".to_owned())
        };
        let vars = collect(Path::new("/kalsa/driver"), ambient);
        let path = vars.iter().find(|(name, _)| name == "PLAYWRIGHT_DRIVER_PATH");
        assert_eq!(path.map(|(_, value)| value.as_str()), Some("/kalsa/driver"));
    }
}