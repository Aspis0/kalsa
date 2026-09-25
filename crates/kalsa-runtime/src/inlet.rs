//! Whether the engine we mounted consumes the door's private headers.
//!
//! The engine arrives as a download, so what it can do is a runtime fact: a
//! compile-time declaration of `Consumed` would be a claim about bytes
//! nobody had fetched. This module reads the claim out of the bytes instead.
//!
//! It is a capability check, not a version check. The archive's sha256 in
//! [`crate::assets`] is the version; a build can gain or lose the inlet
//! without changing that story, and two releases ship the same launcher (see
//! the comment at the fork's row). What matters to the door is only whether
//! the module we would load carries the inlet.

use crate::assets::Platform;
use std::io::Read;
use std::path::Path;

/// The file the fork's server implementation is shipped in, beside the
/// launcher. The launcher is thin: the inlet lives here, so searching the
/// launcher alone would always report the capability missing.
#[cfg(target_os = "windows")]
pub const ENGINE_MODULE_FILE: &str = engine_module_file(Platform::WindowsX64);
#[cfg(not(target_os = "windows"))]
pub const ENGINE_MODULE_FILE: &str = engine_module_file(Platform::MacArm64);

/// Which module the fork ships a platform's engine's inlet in: the Windows
/// archives carry a DLL, the macOS archive a dylib.
const fn engine_module_file(platform: Platform) -> &'static str {
    match platform {
        Platform::WindowsX64 => "llama-server-impl.dll",
        Platform::MacArm64 | Platform::MacX64 => "libllama-server-impl.dylib",
    }
}

/// The inlet as the engine spells it in its own bytes. Lowercase only: the
/// engine lowercases the header name before it matches, so a correct build
/// carries the lowercase literal and not the capitalised one.
///
/// The source of that claim, as it stands in the release this app installs:
/// in `kalsa-server-v1.1.2`, `tools/server/server-context.cpp:4556` is
/// `static const std::string key = "x-kalsa-slot";` and the comparison at
/// `:4563` folds the incoming header name to lowercase byte by byte against
/// that key. So the CASE is irrelevant to the ENGINE and decisive for THIS
/// PROBE (which searches a literal in the binary): `INLET` is spelled the
/// way the engine's own key is.
///
/// The counts are a measurement over an artifact that is NOT in this repo,
/// so they travel with their command: `strings -a <module> | grep -c` on
/// the published module answers `x-kalsa-slot` = 1 and `X-Kalsa-Slot` = 0
/// (v1.1.2's macOS dylib, from the release archive, checked against its
/// published sha256 first, 2026-09-25). Redo it the same way on the next
/// release rather than trusting a version word here: searching for the
/// capitalised form would report the inlet missing exactly where it is
/// present.
const INLET: &[u8] = b"x-kalsa-slot";

/// Whether the engine at `exe` consumes the door's private headers, read
/// from the module file shipped beside it.
///
/// The module is looked for beside the mounted executable, not by a walk of
/// the build tree: the answer must describe the engine that will run, and a
/// second copy of the module elsewhere in the tree is not it. A missing or
/// unreadable file is `false`, which is both the honest answer and the safe
/// one — the door then refuses to serve more than one device.
pub fn engine_consumes_private_headers(exe: &Path) -> bool {
    let Some(dir) = exe.parent() else {
        return false;
    };
    contains(&dir.join(ENGINE_MODULE_FILE), INLET)
}

/// Whether `path` holds `needle`, streamed so a multi-megabyte library never
/// lands in memory whole. Every read error and a missing file are `false`:
/// bytes nobody can read cannot say the engine reads the door's headers.
fn contains(path: &Path, needle: &[u8]) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    const CHUNK: usize = 64 * 1024;
    let mut buf = [0u8; CHUNK];
    // The tail of the previous chunk, because a needle can straddle two
    // reads; one byte short of the needle is exactly what has to survive.
    let mut tail = Vec::with_capacity(CHUNK + needle.len());
    loop {
        match file.read(&mut buf) {
            Ok(0) => return false,
            Ok(read) => {
                tail.extend_from_slice(&buf[..read]);
                if tail.windows(needle.len()).any(|window| window == needle) {
                    return true;
                }
                if tail.len() > needle.len() - 1 {
                    tail.drain(..tail.len() - (needle.len() - 1));
                }
            }
            // A read interrupted by a signal is the one error worth another
            // try; every other error is the file's own, and false is its
            // answer.
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-runtime-inlet-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// A build directory with a launcher and a module whose bytes are the
    /// test's own, returning the launcher's path the way the walk would.
    fn mounted(name: &str, module_bytes: &[u8]) -> PathBuf {
        let dir = scratch(name);
        let exe = dir.join("kalsa-server");
        std::fs::write(&exe, b"a thin launcher").expect("launcher");
        std::fs::write(dir.join(ENGINE_MODULE_FILE), module_bytes).expect("module");
        exe
    }

    fn clean(exe: &Path) {
        if let Some(dir) = exe.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// The module's name is a fact about the platform's archive: the Windows
    /// fork zips ship `llama-server-impl.dll`, the macOS archive a dylib —
    /// and the running build's constant agrees with its own platform.
    #[test]
    fn each_platform_reads_the_module_the_fork_ships_for_it() {
        assert_eq!(
            engine_module_file(Platform::WindowsX64),
            "llama-server-impl.dll"
        );
        assert_eq!(
            engine_module_file(Platform::MacArm64),
            "libllama-server-impl.dylib"
        );
        assert_eq!(
            engine_module_file(Platform::MacX64),
            "libllama-server-impl.dylib"
        );
        if let Some(platform) = Platform::current() {
            assert_eq!(ENGINE_MODULE_FILE, engine_module_file(platform));
        }
    }

    #[test]
    fn the_lowercase_inlet_is_the_one_a_correct_engine_carries() {
        let exe = mounted("present", b"a module carrying x-kalsa-slot inside");
        assert!(engine_consumes_private_headers(&exe));
        clean(&exe);
    }

    #[test]
    fn a_module_without_the_inlet_is_not_claimed() {
        let exe = mounted("absent", b"a module that never heard of the door");
        assert!(!engine_consumes_private_headers(&exe));
        clean(&exe);
    }

    #[test]
    fn the_capitalised_spelling_is_not_the_inlet() {
        // The engine lowercases the header name before matching, so a
        // correct build's bytes never carry `X-Kalsa-Slot`; a search for it
        // returns zero on the one build that has the inlet, which is why the
        // needle is lowercase.
        let exe = mounted("capitalised", b"a module naming X-Kalsa-Slot only");
        assert!(!engine_consumes_private_headers(&exe));
        clean(&exe);
    }

    #[test]
    fn a_missing_module_is_not_a_capability() {
        // An upstream archive (the CUDA rows) or an Intel row: the launcher
        // exists and the module beside it does not. False, not an error the
        // door has to interpret.
        let dir = scratch("no-module");
        let exe = dir.join("kalsa-server");
        std::fs::write(&exe, b"a thin launcher").expect("launcher");
        assert!(!engine_consumes_private_headers(&exe));
        clean(&exe);
    }

    #[test]
    fn an_inlet_split_across_two_reads_is_still_found() {
        // The scan keeps the tail of each chunk. A needle straddling the
        // 64 KiB boundary must not be missed, or a correct engine reads as
        // one without the inlet and the door silently drops to one device.
        let mut bytes = vec![b'.'; 64 * 1024 - 4];
        bytes.extend_from_slice(INLET);
        bytes.extend_from_slice(&[b'.'; 16]);
        let exe = mounted("straddle", &bytes);
        assert!(engine_consumes_private_headers(&exe));
        clean(&exe);
    }

    #[test]
    #[ignore = "needs the fork engine extracted under the runtime root"]
    fn the_real_mounted_engine_carries_the_inlet() {
        // The end of the chain the unit tests cannot reach: the bytes on this
        // machine. Run it after the app (or the ignored `real_engine` test)
        // has fetched the fork, or it fails on an engine that is the honest
        // `NotConsumed` case.
        let dir = crate::store::root()
            .join("builds")
            .join(crate::assets::ServerBackend::Metal.name());
        let exe = crate::extract::find_server(&dir).expect("a build on disk");
        assert!(
            engine_consumes_private_headers(&exe),
            "the build at {} is not the fork: its module carries no x-kalsa-slot inlet",
            exe.display()
        );
    }
}
