//! Which single GPU a graphics launch is pinned to, asked of the engine.
//!
//! A Vulkan build on a machine with two devices splits layers across both —
//! slower than either alone — and the MTP drafter refuses to start when it
//! lands on the other device, so the app must say which card to use. The
//! answer comes from the installed build itself (`--list-devices`, which
//! prints every non-CPU device and exits), never from detection's spelling:
//! Vulkan's own names and order are what `--device` accepts.

use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::assets::ServerBackend;
use crate::child::TICK;

/// The engine's own header line (`common/arg.cpp` `common_print_available_devices`):
/// `Available devices:` then one `  name: description (total MiB, free MiB free)`
/// per non-CPU device, or the single line `  (none)`.
const HEADER: &str = "Available devices:";
const NO_DEVICES: &str = "(none)";

/// How long `--list-devices` gets. The command loads the backends and
/// exits; a driver that makes that hang is killed here, and its silence is
/// "no list", never a wait.
const LIST_DEADLINE: Duration = Duration::from_secs(15);

/// The list, once per session: the answer cannot change while the app runs.
/// Only a successful, non-empty list is remembered — a failed spawn, a
/// nonzero exit and an empty list are not answers, so the next ask repeats
/// (see [`kalsa_probe::once_present`]).
static LISTED: OnceLock<Vec<(String, String)>> = OnceLock::new();

/// The installed graphics build's device list, or `None` when the build
/// could not be asked (no spawn, no exit within the deadline, a nonzero exit)
/// or named no device.
pub fn list_devices(exe: &Path) -> Option<Vec<(String, String)>> {
    kalsa_probe::once_present(&LISTED, || {
        Some(parse_listed_devices(&ask_list_devices(exe)?)).filter(|listed| !listed.is_empty())
    })
}

/// `--list-devices` run the way the probe runs the engine: in the exe's own
/// directory, stdout captured, killed rather than left hanging.
fn ask_list_devices(exe: &Path) -> Option<String> {
    let mut command = std::process::Command::new(exe);
    command
        .arg("--list-devices")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(dir) = exe.parent() {
        command.current_dir(dir);
    }
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + LIST_DEADLINE;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(TICK),
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    // A crash prints whatever it printed before dying: not an answer.
    if !status.success() {
        return None;
    }
    let mut stdout = child.stdout.take()?;
    let mut text = String::new();
    stdout.read_to_string(&mut text).ok()?;
    Some(text)
}

/// The engine's listing as `(name, description)` pairs: everything after
/// the header that is shaped like a device line, in the engine's own order
/// (its device enumeration, not WMI's). Lines outside that shape — an error
/// message, a future rewrite — are dropped, and a text without the header
/// is not a list at all: empty, never a guess.
pub fn parse_listed_devices(text: &str) -> Vec<(String, String)> {
    let mut listed = Vec::new();
    let mut after_header = false;
    for line in text.lines() {
        // `str::lines` splits on LF and strips a CR, so CRLF output parses.
        let line = line.trim();
        if !after_header {
            after_header = line == HEADER;
            continue;
        }
        if line == NO_DEVICES {
            break;
        }
        if let Some(device) = parse_device_line(line) {
            listed.push(device);
        }
    }
    listed
}

/// One `  name: description (total MiB, free MiB free)` line. The name is
/// what `--device` will be given, so anything not exactly this shape is
/// refused rather than half-read into a name the engine would reject.
fn parse_device_line(line: &str) -> Option<(String, String)> {
    let (name, rest) = line.split_once(": ")?;
    let name = name.trim();
    if name.is_empty() || name.split_whitespace().count() > 1 {
        return None;
    }
    let (description, memory) = rest.rsplit_once(" (")?;
    let memory = memory.strip_suffix(")")?;
    let mut parts = memory.split(", ");
    let total = parts.next()?.strip_suffix(" MiB")?;
    let free = parts.next()?.strip_suffix(" MiB free")?;
    if parts.next().is_some()
        || total.parse::<u64>().is_err()
        || free.parse::<u64>().is_err()
    {
        return None;
    }
    let description = description.trim();
    if description.is_empty() {
        return None;
    }
    Some((name.to_string(), description.to_string()))
}

/// How a detection name meets a Vulkan description: case-folded and every
/// run of whitespace collapsed to one space on both sides. The captures on
/// record spell both sides the same words — "NVIDIA GeForce RTX 4050 Laptop
/// GPU" — and only case and spacing have ever differed between producers.
fn normalise(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

/// The device this launch pins: the listed device whose description is the
/// card detection named — exactly one such device, matched after
/// [`normalise`] — or, when detection named no card at all (the iGPU's
/// path), the single listed device alone. A name that matches nothing is
/// never rescued by the list's only entry: a dedicated card asleep leaves
/// just the iGPU visible, and the budget is the dedicated card's. Two
/// devices and no unambiguous match answer `None`: starting on the wrong
/// card, or split across both, is worse than CPU.
fn choose_device(listed: Option<&[(String, String)]>, wanted: Option<&str>) -> Option<String> {
    let listed = listed?;
    let Some(wanted) = wanted else {
        return match listed {
            [(name, _)] => Some(name.clone()),
            _ => None,
        };
    };
    let wanted = normalise(wanted);
    let mut hits = listed
        .iter()
        .filter(|(_, description)| normalise(description) == wanted)
        .map(|(name, _)| name.as_str());
    let first = hits.next()?;
    hits.next().is_none().then(|| first.to_string())
}

/// The build and device a start routes to once the graphics build answered
/// `--list-devices`: that build pinned to the one device, or the CPU build
/// with no device. The caller asks this only when the graphics build is the
/// one on disk.
pub fn route(
    listed: Option<&[(String, String)]>,
    wanted: Option<&str>,
) -> (ServerBackend, Option<String>) {
    match choose_device(listed, wanted) {
        Some(name) => (ServerBackend::Vulkan, Some(name)),
        None => (ServerBackend::Cpu, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RTX: &str = "NVIDIA GeForce RTX 4050 Laptop GPU";
    const ARC: &str = "Intel(R) Arc(TM) Graphics";

    /// The engine's own two-line listing, as the owner's Lenovo prints it.
    fn lenovo() -> Vec<(String, String)> {
        parse_listed_devices(
            "Available devices:\r\n  Vulkan0: NVIDIA GeForce RTX 4050 Laptop GPU (6141 MiB, 5152 MiB free)\r\n  Vulkan1: Intel(R) Arc(TM) Graphics (2147479552 MiB, 2000000 MiB free)\r\n",
        )
    }

    #[test]
    fn the_engines_own_lines_parse_into_names_and_descriptions() {
        assert_eq!(
            lenovo(),
            vec![
                ("Vulkan0".to_string(), RTX.to_string()),
                ("Vulkan1".to_string(), ARC.to_string()),
            ]
        );
        // CRLF throughout, and memory figures that are not numbers, are
        // refused rather than half-parsed.
        let garbage = "Available devices:\n\
                       nope\n\
                       Vulkan2: (1 MiB, 2 MiB free)\n\
                       Vulkan3: Some GPU (many MiB, free)\n\
                       Vulkan4: Some GPU (1 MiB)\n\
                       Vulkan5:   (1 MiB, 2 MiB free)\n";
        assert!(parse_listed_devices(garbage).is_empty(), "{garbage:?}");
        // No header is not a list; a header and `(none)` is an empty one.
        assert!(parse_listed_devices("Vulkan0: GPU (1 MiB, 2 MiB free)").is_empty());
        assert!(parse_listed_devices("Available devices:\n  (none)\n").is_empty());
        assert!(parse_listed_devices("").is_empty());
    }

    #[test]
    fn the_named_discrete_card_is_pinned_even_when_it_is_not_first() {
        // The match is on the description, the pin on the name: the Lenovo
        // numbers the RTX Vulkan0, and a machine that numbers the Arc first
        // pins the RTX as Vulkan1.
        assert_eq!(
            route(Some(&lenovo()), Some(RTX)),
            (ServerBackend::Vulkan, Some("Vulkan0".to_string()))
        );
        let arc_first = vec![
            ("Vulkan0".to_string(), ARC.to_string()),
            ("Vulkan1".to_string(), RTX.to_string()),
        ];
        assert_eq!(
            route(Some(&arc_first), Some(RTX)),
            (ServerBackend::Vulkan, Some("Vulkan1".to_string()))
        );
    }

    #[test]
    fn a_name_that_matches_no_listed_device_routes_to_the_cpu_build() {
        // Two cards, and the one detection named is not among them: no way
        // to know which of the two is meant, so no card at all.
        assert_eq!(route(Some(&lenovo()), Some("AMD Radeon RX 6600")), (ServerBackend::Cpu, None));
        // And with no list there is nothing to pin either.
        assert_eq!(route(None, Some(RTX)), (ServerBackend::Cpu, None));
        assert_eq!(route(None, None), (ServerBackend::Cpu, None));
    }

    #[test]
    fn a_single_listed_device_pins_that_device() {
        // The iGPU's own case: no discrete adapter for detection to name
        // (`wanted` absent), one device listed — that one.
        let single = vec![(
            "Vulkan0".to_string(),
            "Intel(R) Iris(R) Plus Graphics".to_string(),
        )];
        assert_eq!(
            route(Some(&single), None),
            (ServerBackend::Vulkan, Some("Vulkan0".to_string()))
        );
        // When a name WAS asked for and matches nothing, the one visible card
        // is not it: the dedicated card is asleep and the budget is its.
        assert_eq!(
            route(Some(&single), Some("NVIDIA GeForce RTX 4050 Laptop GPU")),
            (ServerBackend::Cpu, None)
        );
        // Two cards and no name is as ambiguous as a name that matches
        // neither.
        assert_eq!(route(Some(&lenovo()), None), (ServerBackend::Cpu, None));
    }

    /// An executable that prints a listing and exits with `code`.
    #[cfg(unix)]
    fn fake_engine(name: &str, code: i32) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "kalsa-runtime-devices-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let exe = dir.join("engine.sh");
        std::fs::write(
            &exe,
            format!(
                "#!/bin/sh\necho 'Available devices:'\necho '  Vulkan0: GPU (1 MiB, 1 MiB free)'\nexit {code}\n"
            ),
        )
        .expect("script");
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        exe
    }

    #[cfg(unix)]
    #[test]
    fn only_a_clean_exit_makes_the_listing_an_answer() {
        let ok = ask_list_devices(&fake_engine("ok", 0)).expect("a clean exit answers");
        assert_eq!(parse_listed_devices(&ok).len(), 1);
        // The same text from a build that then crashed is not an answer, so
        // it is never parsed, let alone remembered.
        assert_eq!(ask_list_devices(&fake_engine("crash", 1)), None);
    }

    #[test]
    fn the_match_folds_case_and_whitespace_on_both_sides() {
        assert_eq!(
            route(Some(&lenovo()), Some("nvidia geforce   rtx 4050 LAPTOP gpu")),
            (ServerBackend::Vulkan, Some("Vulkan0".to_string()))
        );
    }
}
