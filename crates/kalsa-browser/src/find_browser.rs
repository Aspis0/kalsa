//! The browser we are willing to drive, found on this computer (one
//! responsibility: decide which installed browser Kalsa uses, and say plainly
//! when there is none worth using).
//!
//! Chromium is absent from the table on purpose, and the floor is per browser
//! because the three do not count the same way: Chrome and Edge report their
//! own build number, while Brave reports its own release number. Brave 1.83
//! ships Chromium 141 and 1.84 ships Chromium 142
//! ([Brave release schedule](https://github.com/brave/brave-browser/wiki/Brave-Release-Schedule)),
//! which is why Brave's floor is 1.84 and not 142.

use std::cmp::Ordering;
use std::process::Stdio;

use tokio::process::Command;

/// Chrome's Local Network Access permission prompt, which is the browser-level
/// backstop under our own route refusal.
pub const CHROMIUM_FLOOR: Version = Version { major: 142, minor: 0, patch: 0 };

/// The first Brave release carrying Chromium 142.
pub const BRAVE_FLOOR: Version = Version { major: 1, minor: 84, patch: 0 };

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl Version {
    /// The first three numbers of a `--version` line: the build number for
    /// Chrome and Edge, the release number for Brave. Anything past the third
    /// component is a build counter we do not compare on.
    fn of(output: &str) -> Option<Version> {
        let mut parts = Vec::new();
        let mut digits = String::new();
        for c in output.chars().chain(std::iter::once(' ')) {
            match c {
                '0'..='9' => digits.push(c),
                '.' if !digits.is_empty() => {
                    parts.push(digits.parse().ok()?);
                    digits.clear();
                }
                _ if !digits.is_empty() => {
                    parts.push(digits.parse().ok()?);
                    digits.clear();
                }
                _ => {}
            }
        }
        Some(match parts.len() {
            0 => return None,
            1 => Version { major: parts[0], minor: 0, patch: 0 },
            2 => Version { major: parts[0], minor: parts[1], patch: 0 },
            _ => Version { major: parts[0], minor: parts[1], patch: parts[2] },
        })
    }
}

pub enum Platform {
    MacOs,
    Windows,
    Other,
}

pub struct Candidate {
    pub name: &'static str,
    pub executable: String,
    pub floor: Version,
}

/// Where programs are kept, so neither table assumes a drive letter or an
/// account.
struct Roots {
    home: String,
    program_files: String,
    program_files_x86: String,
    local_app_data: String,
}

impl Roots {
    fn from_env() -> Roots {
        let read = |name: &str, fallback: &str| std::env::var(name).unwrap_or_else(|_| fallback.to_string());
        Roots {
            home: read("HOME", "/Users/kalsa"),
            program_files: read("ProgramFiles", r"C:\Program Files"),
            program_files_x86: read("ProgramFiles(x86)", r"C:\Program Files (x86)"),
            local_app_data: read("LOCALAPPDATA", r"C:\Users\kalsa\AppData\Local"),
        }
    }
}

/// Both places a person can put an app, and there is a third on macOS: a copy in
/// their own `~/Applications`, which is where a drag from a disk image lands.
fn macos_table(home: &str) -> Vec<Candidate> {
    let mut out = Vec::new();
    for (app, floor) in
        [("Google Chrome", CHROMIUM_FLOOR), ("Microsoft Edge", CHROMIUM_FLOOR), ("Brave Browser", BRAVE_FLOOR)]
    {
        for root in ["/Applications", &format!("{home}/Applications")] {
            out.push(Candidate {
                name: app,
                executable: format!("{root}/{app}.app/Contents/MacOS/{app}"),
                floor,
            });
        }
    }
    out
}

/// Each browser installs per machine and per user, and a per-user copy is the
/// one a portable installer leaves behind.
fn windows_table(roots: &Roots) -> Vec<Candidate> {
    let mut rows: Vec<(&'static str, &'static str, Version)> = Vec::new();
    let mut at = |folder: &str, sub: &'static str, name: &'static str, floor: Version| {
        let executable = format!("{folder}\\{sub}");
        if !rows.iter().any(|(_, taken, _)| *taken == executable.as_str()) {
            rows.push((name, executable.leak(), floor));
        }
    };
    for folder in [&roots.program_files, &roots.local_app_data] {
        at(folder, "Google\\Chrome\\Application\\chrome.exe", "Google Chrome", CHROMIUM_FLOOR);
    }
    for folder in [&roots.program_files_x86, &roots.program_files] {
        at(folder, "Microsoft\\Edge\\Application\\msedge.exe", "Microsoft Edge", CHROMIUM_FLOOR);
    }
    for folder in [&roots.program_files, &roots.local_app_data] {
        at(folder, "BraveSoftware\\Brave-Browser\\Application\\brave.exe", "Brave Browser", BRAVE_FLOOR);
    }
    rows.into_iter()
        .map(|(name, executable, floor)| Candidate {
            name,
            executable: executable.to_string(),
            floor,
        })
        .collect()
}

/// The browsers we accept, in the order we prefer them.
fn table(platform: Platform, roots: &Roots) -> Vec<Candidate> {
    match platform {
        Platform::MacOs => macos_table(&roots.home),
        Platform::Windows => windows_table(roots),
        Platform::Other => Vec::new(),
    }
}

/// A candidate that is installed, and what it said about itself.
struct Asked {
    candidate: Candidate,
    version: Option<Version>,
}

/// The first candidate that is both installed and new enough. An old Chrome is
/// not a reason to drive an old Chrome: the next candidate may be an Edge that
/// is perfectly good, and skipping the first is the whole point of asking each.
fn eligible(asked: &[Asked]) -> Result<String, Missing> {
    let mut why: Option<Missing> = None;
    for one in asked {
        let Some(version) = one.version else {
            why.get_or_insert(Missing::NoVersion);
            continue;
        };
        if version.cmp(&one.candidate.floor) == Ordering::Less {
            why.get_or_insert(Missing::TooOld { name: one.candidate.name });
            continue;
        }
        return Ok(one.candidate.executable.clone());
    }
    Err(why.unwrap_or(Missing::NoneInstalled))
}

#[derive(Debug, PartialEq, Eq)]
pub enum Missing {
    /// Nothing on this computer is one of the three browsers.
    NoneInstalled,
    /// The browser is there and is too old to carry the guarantees.
    TooOld { name: &'static str },
    /// The browser is there but would not report what it is.
    NoVersion,
}

impl Missing {
    /// One plain line, saying which of the three is needed and why this one is
    /// not good enough. No path from the person's disk, no version echoed back.
    pub(crate) fn message(&self) -> &'static str {
        match self {
            Missing::NoneInstalled => {
                "the browser is not available: Kalsa drives Google Chrome, Microsoft Edge or Brave, \
                 at Chrome 142 or Brave 1.84 or newer"
            }
            Missing::TooOld { name } => {
                // The person updates a browser, so it is named. The version it
                // printed is not: it is not ours to report back.
                match *name {
                    "Google Chrome" => "Google Chrome is too old: Kalsa needs Chrome 142 or newer",
                    "Microsoft Edge" => "Microsoft Edge is too old: Kalsa needs Edge 142 or newer",
                    "Brave Browser" => "Brave Browser is too old: Kalsa needs Brave 1.84 or newer",
                    _ => "the browser is too old: Kalsa needs Chrome or Edge 142, or Brave 1.84, or newer",
                }
            }
            Missing::NoVersion => {
                "the browser did not report its version, so Kalsa cannot check that it is new enough"
            }
        }
    }
}

/// What `--version` answers, asked once. A browser that cannot be asked is not
/// assumed to be new enough.
async fn version_of(executable: &str) -> Option<Version> {
    Command::new(executable)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .await
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| Version::of(&String::from_utf8_lossy(&out.stdout)))
}

/// The executable to launch, or the one plain line that says why there is none.
pub async fn installed() -> Result<String, Missing> {
    let platform = if cfg!(target_os = "macos") {
        Platform::MacOs
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Other
    };
    let roots = Roots::from_env();
    let mut asked = Vec::new();
    for candidate in table(platform, &roots) {
        if !std::path::Path::new(&candidate.executable).is_file() {
            continue;
        }
        let version = version_of(&candidate.executable).await;
        asked.push(Asked { candidate, version });
    }
    eligible(&asked)
}

#[cfg(test)]
mod tests {
    use super::{eligible, table, Asked, Candidate, Missing, Platform, Roots, Version, BRAVE_FLOOR, CHROMIUM_FLOOR};

    fn roots() -> Roots {
        Roots {
            home: "/Users/kalsa".to_string(),
            program_files: r"C:\Program Files".to_string(),
            program_files_x86: r"C:\Program Files (x86)".to_string(),
            local_app_data: r"C:\Users\kalsa\AppData\Local".to_string(),
        }
    }

    /// One candidate as `installed` would find it: present, and with a version.
    fn asked(name: &'static str, executable: &str, version: Option<(u32, u32, u32)>) -> Asked {
        Asked {
            candidate: Candidate { name, executable: executable.to_string(), floor: CHROMIUM_FLOOR },
            version: version.map(|(major, minor, patch)| Version { major, minor, patch }),
        }
    }

    /// An old Chrome is installed and is first in the list; the Edge beside it
    /// is new enough. Taking the first *present* one would drive the old Chrome.
    #[test]
    fn a_browser_too_old_does_not_hide_one_beside_it_that_is_new_enough() {
        let both = [
            asked("Google Chrome", "/Applications/Google Chrome.app/old", Some((141, 0, 0))),
            asked("Microsoft Edge", "/Applications/Microsoft Edge.app/new", Some((155, 0, 0))),
        ];
        assert_eq!(eligible(&both), Ok("/Applications/Microsoft Edge.app/new".to_string()));
    }

    #[test]
    fn a_browser_that_will_not_say_its_version_does_not_hide_one_that_will() {
        let both = [
            asked("Google Chrome", "/Applications/Google Chrome.app/x", None),
            asked("Microsoft Edge", "/Applications/Microsoft Edge.app/x", Some((155, 0, 0))),
        ];
        assert_eq!(eligible(&both), Ok("/Applications/Microsoft Edge.app/x".to_string()));
    }

    /// With nothing usable left, the line names what was found and why it was
    /// no good: the person can act on it.
    #[test]
    fn with_nothing_eligible_the_reason_is_the_first_thing_was_wrong_with() {
        assert_eq!(eligible(&[]), Err(Missing::NoneInstalled));
        assert_eq!(eligible(&[asked("Google Chrome", "/x", Some((141, 0, 0)))]),
            Err(Missing::TooOld { name: "Google Chrome" }));
        assert_eq!(eligible(&[asked("Google Chrome", "/x", None)]), Err(Missing::NoVersion));
    }

    #[test]
    fn the_newest_enough_browser_wins_in_the_order_they_are_preferred() {
        let both = [
            asked("Google Chrome", "/Applications/Google Chrome.app/x", Some((155, 0, 0))),
            asked("Brave Browser", "/Applications/Brave Browser.app/x", Some((1, 84, 0))),
        ];
        assert_eq!(eligible(&both), Ok("/Applications/Google Chrome.app/x".to_string()));
    }

    fn names(platform: Platform) -> Vec<&'static str> {
        table(platform, &roots()).into_iter().map(|c| c.name).collect()
    }

    /// Chromium is not in the table on any platform: it is a browser we dropped,
    /// and a detection that listed it would offer it on a machine that has it.
    #[test]
    fn chromium_is_not_a_candidate_on_any_platform() {
        for platform in [Platform::MacOs, Platform::Windows, Platform::Other] {
            for name in names(platform) {
                assert!(!name.to_lowercase().contains("chromium"), "{name} must not be offered");
            }
        }
    }

    /// A copy dragged into the account's own Applications is still an installed
    /// browser, and the table has to look there too.
    #[test]
    fn macos_offers_each_browser_from_both_places_it_can_be_installed() {
        assert_eq!(
            names(Platform::MacOs),
            [
                "Google Chrome",
                "Google Chrome",
                "Microsoft Edge",
                "Microsoft Edge",
                "Brave Browser",
                "Brave Browser",
            ]
        );
        let rows = table(Platform::MacOs, &roots());
        assert_eq!(rows[0].executable, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
        assert_eq!(
            rows[1].executable,
            "/Users/kalsa/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        );
        assert_eq!(
            rows[5].executable,
            "/Users/kalsa/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
        );
    }

    /// A browser installed for the account alone lives under AppData, so a table
    /// that only knows `C:\Program Files` finds nothing there.
    #[test]
    fn windows_offers_both_the_machine_and_the_per_user_install_of_each() {
        let rows = table(Platform::Windows, &roots());
        let chrome: Vec<&str> = rows
            .iter()
            .filter(|c| c.name == "Google Chrome")
            .map(|c| c.executable.as_str())
            .collect();
        assert_eq!(
            chrome,
            [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Users\kalsa\AppData\Local\Google\Chrome\Application\chrome.exe",
            ]
        );
        assert_eq!(rows.len(), 6, "three browsers, two install locations each");
    }

    #[test]
    fn windows_roots_come_from_the_environment_rather_than_a_drive_letter() {
        let moved = Roots {
            home: r"D:\Users\k".to_string(),
            program_files: r"D:\Apps".to_string(),
            program_files_x86: r"D:\Apps\x86".to_string(),
            local_app_data: r"D:\Users\k\AppData\Local".to_string(),
        };
        assert_eq!(
            table(Platform::Windows, &moved)[0].executable,
            r"D:\Apps\Google\Chrome\Application\chrome.exe"
        );
    }

    #[test]
    fn a_platform_we_do_not_ship_offers_nothing() {
        assert!(table(Platform::Other, &roots()).is_empty());
    }

    #[test]
    fn a_version_is_the_first_three_numbers_a_browser_prints() {
        assert_eq!(Version::of("Google Chrome 155.0.8059.84\n"), Some(Version { major: 155, minor: 0, patch: 8059 }));
        assert_eq!(Version::of("Microsoft Edge 142.0.1343.51"), Some(Version { major: 142, minor: 0, patch: 1343 }));
        assert_eq!(Version::of("Brave Browser 1.84.141"), Some(Version { major: 1, minor: 84, patch: 141 }));
        assert_eq!(Version::of("1.84"), Some(Version { major: 1, minor: 84, patch: 0 }));
        assert_eq!(Version::of("1.84.141"), Some(Version { major: 1, minor: 84, patch: 141 }));
        assert_eq!(Version::of("Google Chrome"), None);
        assert_eq!(Version::of(""), None);
    }

    /// Brave counts its own releases, not Chromium's: 1.83 ships Chromium 141
    /// and 1.84 ships Chromium 142, so a floor of 142 would reject every Brave
    /// and a floor of 1.83 would accept one that is too old.
    #[test]
    fn the_floor_is_in_the_units_each_browser_reports() {
        let rows = table(Platform::MacOs, &roots());
        let brave = rows.iter().find(|c| c.name == "Brave Browser").expect("Brave");
        assert_eq!(brave.floor, BRAVE_FLOOR);
        assert!(Version::of("Brave Browser 1.83.141").expect("1.83") < brave.floor);
        assert!(Version::of("Brave Browser 1.84.141").expect("1.84") >= brave.floor);
        let chrome = rows.iter().find(|c| c.name == "Google Chrome").expect("Chrome");
        assert_eq!(chrome.floor, CHROMIUM_FLOOR);
        assert!(Version::of("Google Chrome 141.0.1.2").expect("141") < chrome.floor);
        assert!(Version::of("Google Chrome 142.0.1.2").expect("142") >= chrome.floor);
    }

    /// Every way of finding nothing says one plain line, and none of them names a
    /// path on the person's disk. A browser too old is named, because the person
    /// updates a browser; the version it printed is not echoed back, because that
    /// is the driver's word and not ours.
    #[test]
    fn every_refusal_is_one_line_without_a_path() {
        for missing in [
            Missing::NoneInstalled,
            Missing::TooOld { name: "Microsoft Edge" },
            Missing::NoVersion,
        ] {
            let message = missing.message();
            assert!(!message.is_empty());
            assert!(!message.contains('\\') && !message.contains('/'), "{message}");
        }
    }
}