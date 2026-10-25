//! Which Playwright variables this process runs with (one responsibility: leave
//! `PLAYWRIGHT_DRIVER_PATH` as the only Playwright variable in the environment).
//!
//! `playwright-rs` reads these from our own environment and then spawns the
//! driver with it. `PLAYWRIGHT_NODE_EXE` and `PLAYWRIGHT_CLI_JS` each replace
//! the runtime or the CLI script outright, and the two together mean no driver
//! directory is needed at all, so an ambient value from an unrelated tool would
//! quietly decide which driver runs. `PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD` is a
//! build-time knob and means nothing here.
//!
//! Called once, before the first browser is launched: after a driver process has
//! been spawned the decision is already made.

/// The one variable we honour, because it names a driver that was verified
/// before it arrived here.
const HONOURED: &str = "PLAYWRIGHT_DRIVER_PATH";

/// Every `PLAYWRIGHT_*` the ambient environment may hold except the one that
/// names our verified driver.
fn overrides(vars: impl Iterator<Item = String>) -> Vec<String> {
    vars.filter(|name| name.starts_with("PLAYWRIGHT_") && name != HONOURED).collect()
}

#[derive(Debug)]
pub enum Missing {
    /// No `PLAYWRIGHT_DRIVER_PATH`: there is no verified driver to run.
    NotSet,
    /// It is set to a directory that does not hold the driver.
    NotADriver,
}

/// Read the verified driver's directory, clearing every other override from our
/// own environment on the way.
pub(crate) fn apply() -> Result<String, Missing> {
    for name in overrides(std::env::vars().map(|(name, _)| name)) {
        std::env::remove_var(name);
    }
    let dir = std::env::var(HONOURED).map_err(|_| Missing::NotSet)?;
    let node = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
    let holds = std::path::Path::new(&dir).join(node).is_file()
        && std::path::Path::new(&dir).join("package/cli.js").is_file();
    if !holds {
        return Err(Missing::NotADriver);
    }
    Ok(dir)
}

impl Missing {
    pub(crate) fn message(&self) -> &'static str {
        match self {
            Missing::NotSet => {
                "the browser driver is not available: PLAYWRIGHT_DRIVER_PATH must name a verified \
                 driver directory"
            }
            Missing::NotADriver => {
                "the browser driver is not available: that directory does not hold the driver"
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{overrides, Missing};

    fn cleared() -> Vec<String> {
        overrides(
            [
                "PATH",
                "HOME",
                "PLAYWRIGHT_DRIVER_PATH",
                "PLAYWRIGHT_NODE_EXE",
                "PLAYWRIGHT_CLI_JS",
                "PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD",
                "PLAYWRIGHT_DRIVER_CACHE_DIR",
                "PLAYWRIGHT_BROWSERS_PATH",
            ]
            .into_iter()
            .map(str::to_string),
        )
    }

    #[test]
    fn every_playwright_override_is_cleared_but_the_driver_path_is_kept() {
        let names = cleared();
        assert!(names.contains(&"PLAYWRIGHT_NODE_EXE".to_string()));
        assert!(names.contains(&"PLAYWRIGHT_CLI_JS".to_string()));
        assert!(names.contains(&"PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD".to_string()));
        assert!(names.contains(&"PLAYWRIGHT_DRIVER_CACHE_DIR".to_string()));
        assert!(names.contains(&"PLAYWRIGHT_BROWSERS_PATH".to_string()));
        assert!(!names.contains(&"PLAYWRIGHT_DRIVER_PATH".to_string()));
    }

    /// Playwright's own cache decides which *browser* to run; we point at the
    /// installed one, so a cache that is set must not reach the driver.
    #[test]
    fn the_playwright_browsers_cache_is_cleared_too() {
        assert!(cleared().iter().any(|name| name.ends_with("BROWSERS_PATH")));
    }

    #[test]
    fn a_variable_that_is_not_ours_is_left_alone() {
        assert!(!cleared().contains(&"PATH".to_string()));
        assert!(!cleared().contains(&"HOME".to_string()));
    }

    #[test]
    fn an_empty_environment_clears_nothing() {
        assert!(overrides(std::iter::empty()).is_empty());
    }

    #[test]
    fn both_refusals_say_one_line_without_a_path() {
        for missing in [Missing::NotSet, Missing::NotADriver] {
            let message = missing.message();
            assert!(!message.contains('/') && !message.contains('\\'), "{message}");
        }
    }
}