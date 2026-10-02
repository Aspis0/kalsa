//! The app's one log sink: a small file logger behind the `log` facade,
//! mirrored to stderr, plus the panic hook that feeds it.
//!
//! Crates call `log::info!` and friends; this module is the only thing that
//! decides where the words land. One live file (`kalsa-brain.log`) and at
//! most one rotated file (`kalsa-brain.1.log`), in the folder Tauri names
//! for logs. A tester finds the folder and sends the file by hand — nothing
//! here ever uploads anything, and nothing here may stop the app: a folder
//! that cannot be opened or written degrades to stderr for the whole run.
//!
//! Every message passes through one redaction before it is written, so a
//! path that starts with the user's home directory is logged with `~` in
//! its place — in the file and on stderr alike.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use log::{Level, LevelFilter, Log, Metadata, Record};

/// The live file, inside the log folder.
const LIVE_NAME: &str = "kalsa-brain.log";
/// The previous session's file, kept beside the live one. Two files, no more.
const ROTATED_NAME: &str = "kalsa-brain.1.log";
/// The live file is rotated when a write would carry it past this.
const CAP_BYTES: u64 = 2 * 1024 * 1024;

/// The line between sessions, so a report reads one session at a glance.
const SESSION_LINE: &str = "──────── session ────────";

/// The folder the log lives in, once [`install`] has run. The command that
/// opens the folder for the owner reads this; `None` before install and
/// after a failed install.
static FOLDER: OnceLock<PathBuf> = OnceLock::new();

/// The sink behind the `log` facade. The file sits inside the mutex with a
/// running byte count, so rotation is decided and performed under the same
/// lock that appends — two threads can never interleave a rotation.
pub struct Logger {
    state: Mutex<State>,
    /// The home directory's path as a string, matched as a prefix of every
    /// message. `None` when it cannot be read: then nothing is redacted and
    /// a logged path keeps the user's name — the honest degradation.
    home: Option<String>,
}

struct State {
    /// The open live file and its size so far. `None` is the stderr-only
    /// fallback: the folder could not be created, or the file could not be
    /// opened, or a rotation lost the file — the run goes on regardless.
    file: Option<(File, u64)>,
    dir: PathBuf,
    cap: u64,
}

impl Logger {
    /// Opens the live file in `dir`, creating the folder if needed. A failure
    /// at either step is the fallback, not an error: the logger still works,
    /// to stderr only.
    fn open(dir: &Path, cap: u64) -> Self {
        Self {
            state: Mutex::new(State {
                file: open_live(dir),
                dir: dir.to_path_buf(),
                cap,
            }),
            home: home_dir(),
        }
    }

    /// The sink with no file at all: the platform named no log folder, so
    /// everything goes to stderr, redacted like any other line.
    fn stderr_only() -> Self {
        Self {
            state: Mutex::new(State {
                file: None,
                dir: PathBuf::new(),
                cap: CAP_BYTES,
            }),
            home: home_dir(),
        }
    }

    /// One message, through redaction, to the file (with rotation) and to
    /// stderr. Tests call this directly; the [`Log`] impl forwards here.
    fn write(&self, level: Level, target: &str, message: &str) {
        let line = format!(
            "{} {:<5} {}: {}\n",
            rfc3339_now(),
            level,
            target,
            redact(message, self.home.as_deref())
        );
        if let Ok(mut state) = self.state.lock() {
            if state.file.is_some() && state.file.as_ref().is_some_and(|(_, len)| {
                len + line.len() as u64 > state.cap
            }) {
                rotate(&mut state);
            }
            if let Some((file, len)) = state.file.as_mut() {
                if file.write_all(line.as_bytes()).is_ok() {
                    *len += line.len() as u64;
                } else {
                    // The folder vanished mid-run (a cleanup tool, a network
                    // home): stderr keeps the rest of the session.
                    state.file = None;
                }
            }
        }
        // A poisoned lock, a closed file, a failed write: none of it may eat
        // the line or the thread. stderr is the mirror and the last resort.
        eprint!("{line}");
    }

    /// The session header: one separating line, then the facts a report
    /// starts with — app version, OS with its version, architecture.
    fn session_header(&self, version: &str) {
        self.write(Level::Info, "session", SESSION_LINE);
        self.write(
            Level::Info,
            "session",
            &format!(
                "kalsa-brain {version} · {} · {}",
                os_version(),
                std::env::consts::ARCH
            ),
        );
    }
}

impl Log for Logger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= Level::Info
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            self.write(record.level(), record.target(), &record.args().to_string());
        }
    }

    fn flush(&self) {}
}

/// Installs the global logger and writes the session header. `None` for the
/// folder is the platform refusing to name a log directory: the logger comes
/// up stderr-only and no folder is advertised. The one place
/// `set_boxed_logger` is called; a second call (none exists) would be the
/// error, so its `Err` is dropped, not unwrapped.
pub fn install(dir: Option<PathBuf>, version: &str) {
    let logger = match dir {
        Some(ref dir) => Logger::open(dir, CAP_BYTES),
        None => Logger::stderr_only(),
    };
    logger.session_header(version);
    let _ = log::set_boxed_logger(Box::new(logger));
    log::set_max_level(LevelFilter::Info);
    if let Some(dir) = dir {
        let _ = FOLDER.set(dir);
    }
}

/// The log folder, for the command that opens it. `None` when install never
/// ran or was given nothing.
pub fn folder() -> Option<&'static Path> {
    FOLDER.get().map(|dir| dir.as_path())
}

/// Panics reach the log before the platform's own hook: message and location
/// on one line, then the default hook does whatever it would have done. A
/// panic message can carry a path (`unwrap` on a file operation), so the
/// line goes through the same redaction as every other.
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic payload".to_string());
        let location = info
            .location()
            .map(|at| format!("{}:{}", at.file(), at.line()))
            .unwrap_or_else(|| "unknown location".to_string());
        log::error!("panic at {location}: {message}");
        default(info);
    }));
}

/// The live file opened for append, with its current size: the byte count
/// starts where the file already is, so a rotation decision reads the whole
/// file, not only this session's part. `None` is the fallback.
fn open_live(dir: &Path) -> Option<(File, u64)> {
    std::fs::create_dir_all(dir).ok()?;
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(LIVE_NAME))
        .ok()?;
    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    Some((file, len))
}

/// The live file becomes the rotated one (replacing whatever rotated file
/// was there) and a fresh live file takes its place. The caller holds the
/// state lock. A failure here leaves `file` None — stderr only — never a
/// panic and never a lost line before this one.
fn rotate(state: &mut State) {
    state.file = None;
    let live = state.dir.join(LIVE_NAME);
    let rotated = state.dir.join(ROTATED_NAME);
    let _ = std::fs::remove_file(&rotated);
    if std::fs::rename(&live, &rotated).is_err() {
        return;
    }
    state.file = open_live(&state.dir);
}

/// The one redaction: the home directory's path becomes `~` where it stands
/// for itself — as the whole path, or the prefix a separator continues. A
/// neighbouring name that merely starts with the same text (`/Users/marco2`,
/// `/Users/marco-v2`) keeps its name: those characters extend the name, a
/// separator, whitespace or punctuation do not.
fn redact(message: &str, home: Option<&str>) -> String {
    let Some(home) = home.filter(|home| !home.is_empty()) else {
        return message.to_string();
    };
    let mut out = String::with_capacity(message.len());
    let mut rest = message;
    while let Some(at) = rest.find(home) {
        let after = at + home.len();
        let extends_name = rest[after..]
            .chars()
            .next()
            .is_some_and(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'));
        if extends_name {
            out.push_str(&rest[..after]);
        } else {
            out.push_str(&rest[..at]);
            out.push('~');
        }
        rest = &rest[after..];
    }
    out.push_str(rest);
    out
}

/// The user's home directory, by the environment variable each platform
/// documents for it. No crate: one `var` read, once, at install.
fn home_dir() -> Option<String> {
    #[cfg(target_os = "windows")]
    let key = "USERPROFILE";
    #[cfg(not(target_os = "windows"))]
    let key = "HOME";
    std::env::var(key).ok().filter(|home| !home.is_empty())
}

/// "macos 25.6.0" / "windows 10.0.19045": the OS name this binary was built
/// for, plus the version the machine reports. A version that cannot be read
/// is an unnamed operand, not a failure.
fn os_version() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::mem::zeroed;
        // SAFETY: `GetVersionExW` fills a plain struct of the size it is told.
        unsafe {
            let mut info: windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW =
                zeroed();
            info.dwOSVersionInfoSize =
                std::mem::size_of::<windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW>
                    () as u32;
            if windows_sys::Win32::System::SystemInformation::GetVersionExW(&mut info) != 0 {
                return format!(
                    "{} {}.{}.{}",
                    std::env::consts::OS, info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber
                );
            }
        }
        std::env::consts::OS.to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        // SAFETY: `uname` writes into the caller's zeroed array and returns
        // its own success code; the release field is NUL-terminated or the
        // read is abandoned for the bare OS name.
        unsafe {
            let mut name: libc::utsname = std::mem::zeroed();
            if libc::uname(&mut name) == 0 {
                let release = std::ffi::CStr::from_ptr(name.release.as_ptr())
                    .to_string_lossy()
                    .into_owned();
                return format!("{} {}", std::env::consts::OS, release);
            }
        }
        std::env::consts::OS.to_string()
    }
}

/// The current moment as RFC 3339, whole seconds, UTC: `2026-10-02T09:41:05Z`.
/// Hand-rolled so the logger pulls in no date crate; the arithmetic is
/// Howard Hinnant's `civil_from_days` and the tests pin real dates.
fn rfc3339_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        (rest % 3_600) / 60,
        rest % 60
    )
}

/// Days since 1970-01-01 to a (year, month, day) in the proleptic Gregorian
/// calendar. Valid for the whole `i64` range of days this clock can name.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
#[path = "logging/tests.rs"]
mod tests;
