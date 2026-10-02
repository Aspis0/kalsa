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

/// No single line may be longer than this, whatever was logged: a runaway
/// message must not eat the 2 MiB cap on its own.
const LINE_CHAR_CAP: usize = 8 * 1024;
/// A panic message's own cap, tight because a payload can be a whole error
/// dump with the request text inside it.
const PANIC_CHAR_CAP: usize = 500;
/// What a clipped line ends with, so a reader knows the line was cut.
const TRUNCATED: &str = " …[truncated]";

fn clip(text: &str, cap: usize) -> String {
    if text.chars().count() <= cap {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(cap).collect();
    cut.push_str(TRUNCATED);
    cut
}

/// The folder the log lives in, once [`install`] has run. The command that
/// opens the folder for the owner reads this; `None` before install and
/// after a failed install.
static FOLDER: OnceLock<PathBuf> = OnceLock::new();

/// The sink behind the `log` facade. The file sits inside the mutex with a
/// running byte count, so rotation is decided and performed under the same
/// lock that appends — two threads can never interleave a rotation.
pub struct Logger {
    state: Mutex<State>,
    /// What every message is redacted against, built once at open.
    redactions: Redactions,
}

struct State {
    /// The open live file and its size so far. `None` is the stderr-only
    /// fallback: the folder could not be created, or the file could not be
    /// opened, or a rotation lost the file — the run goes on regardless.
    file: Option<(File, u64)>,
    dir: PathBuf,
    cap: u64,
    /// Whether the one "rotation failed" warning has been said. A folder
    /// that cannot rotate will fail on every line past the cap; the first
    /// failure is the news, the rest are the same.
    rotation_warned: bool,
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
                rotation_warned: false,
            }),
            redactions: Redactions::build(),
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
                rotation_warned: false,
            }),
            redactions: Redactions::build(),
        }
    }

    /// One message, through redaction, to the file (with rotation) and to
    /// stderr. Tests call this directly; the [`Log`] impl forwards here.
    fn write(&self, level: Level, target: &str, message: &str) {
        let line = clip_line(&format!(
            "{} {:<5} {}: {}",
            rfc3339_now(),
            level,
            target,
            redact(message, &self.redactions)
        ));
        if let Ok(mut state) = self.state.lock() {
            let over_cap = state
                .file
                .as_ref()
                .is_some_and(|(_, len)| len + line.len() as u64 > state.cap);
            if over_cap && !rotate(&mut state) && !state.rotation_warned {
                // Say it once, through the ordinary path: the line below is
                // what a tester pastes, and "why is the file 3 MiB" deserves
                // its answer inside the file.
                state.rotation_warned = true;
                append(
                    &mut state,
                    &clip_line(&format!(
                        "{} WARN  logging: rotation failed; the live file keeps growing",
                        rfc3339_now()
                    )),
                );
            }
            append(&mut state, &line);
        }
        // The mirror, last and unpanicking: `eprint!` panics on a closed or
        // broken stderr, and a logger must never be what takes a process
        // down.
        let _ = std::io::stderr()
            .lock()
            .write_all(format!("{line}\n").as_bytes());
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

/// Whether the folder may be advertised to the owner as the place the log
/// lives: a folder was named AND the live file in it actually opened. A
/// stderr-only run has no folder to open in Finder or Explorer, and the
/// button must say so rather than open nothing.
fn advertise(dir: Option<&PathBuf>, opened: bool) -> bool {
    dir.is_some() && opened
}

/// Installs the global logger and writes the session header. `None` for the
/// folder is the platform refusing to name a log directory, and an unopened
/// file is the folder refusing the log: either way the logger comes up
/// stderr-only and no folder is advertised. The one place
/// `set_boxed_logger` is called; a second call (none exists) would be the
/// error, so its `Err` is dropped, not unwrapped.
pub fn install(dir: Option<PathBuf>, version: &str) {
    let logger = match dir.as_ref() {
        Some(dir) => Logger::open(dir, CAP_BYTES),
        None => Logger::stderr_only(),
    };
    logger.session_header(version);
    let opened = logger
        .state
        .lock()
        .map(|state| state.file.is_some())
        .unwrap_or(false);
    let _ = log::set_boxed_logger(Box::new(logger));
    log::set_max_level(LevelFilter::Info);
    if advertise(dir.as_ref(), opened) {
        let _ = FOLDER.set(dir.expect("advertise answered for a named folder"));
    }
}

/// The log folder, for the command that opens it. `None` when install never
/// ran or was given nothing.
pub fn folder() -> Option<&'static Path> {
    FOLDER.get().map(|dir| dir.as_path())
}

/// Panics reach the log before the platform's own hook: message and location
/// on one line, then the default hook does whatever it would have done. A
/// panic message can carry a path or a whole error dump (`unwrap` on a file
/// operation, a payload with request text in it), so the line goes through
/// the same redaction as every other and the message is clipped to
/// [`PANIC_CHAR_CAP`] characters.
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
        // The mirror of a panic must not be able to panic either: the line
        // reaches stderr through the same never-panicking write as any other.
        log::error!("panic at {location}: {}", clip(&message, PANIC_CHAR_CAP));
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

/// One line into the live file, if there is one. A failed write ends the
/// file for the run (the folder vanished mid-run, a cleanup tool, a network
/// home) — stderr keeps the rest of the session. The caller holds the lock.
fn append(state: &mut State, line: &str) {
    if let Some((file, len)) = state.file.as_mut() {
        let bytes = format!("{line}\n");
        if file.write_all(bytes.as_bytes()).is_ok() {
            *len += bytes.len() as u64;
        } else {
            state.file = None;
        }
    }
}

/// The live file becomes the rotated one (replacing whatever rotated file
/// was there) and a fresh live file takes its place. The caller holds the
/// state lock. A failure at any step reopens the LIVE file for append and
/// answers `false`: a folder whose rotated file is locked or read-only
/// keeps its log — past the cap, but written — rather than going silent.
fn rotate(state: &mut State) -> bool {
    state.file = None;
    let live = state.dir.join(LIVE_NAME);
    let rotated = state.dir.join(ROTATED_NAME);
    let room = std::fs::remove_file(&rotated).is_ok() || !rotated.exists();
    let renamed = room && std::fs::rename(&live, &rotated).is_ok();
    if !renamed {
        state.file = open_live(&state.dir);
        return false;
    }
    state.file = open_live(&state.dir);
    true
}

/// What every message is redacted against, read from the environment once
/// at open: the home directory as a whole path, the account name as a path
/// component, and the platform's temp-folder tree. Windows paths are
/// case-insensitive with two spellings for every separator, and `{:?}` on a
/// path doubles the backslashes — the matcher below takes all of that, on
/// every platform, so a Windows log line is covered by the same code a test
/// on this Mac exercises.
pub(crate) struct Redactions {
    home: Option<String>,
    /// The account name (`USERNAME` on Windows, `USER` elsewhere), when it
    /// is at least three characters: a two-letter name between separators
    /// would eat ordinary words.
    user: Option<String>,
    /// Windows matches paths without regard to case; everywhere else the
    /// exact spelling is the rule.
    insensitive: bool,
}

impl Redactions {
    pub(crate) fn build() -> Self {
        Self {
            home: env_path("HOME").or_else(|| env_path("USERPROFILE")),
            user: env_name("USERNAME").or_else(|| env_name("USER")),
            insensitive: cfg!(windows),
        }
    }

    /// A build with the given strings, for tests and for fixtures.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn new(home: Option<String>, user: Option<String>, insensitive: bool) -> Self {
        Self {
            home,
            user,
            insensitive,
        }
    }
}

fn env_path(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|value| !value.is_empty())
}

/// The account name, only when long enough to be a name and not a word.
fn env_name(key: &str) -> Option<String> {
    let value = env_path(key)?;
    (value.chars().count() >= 3).then_some(value)
}

fn is_sep(c: char) -> bool {
    c == '/' || c == '\\'
}

/// One character of a path pattern against one of the text: separators are
/// interchangeable (both platforms write both), and case is ignored where
/// the platform ignores it.
fn char_matches(pat: char, got: char, insensitive: bool) -> bool {
    if is_sep(pat) && is_sep(got) {
        return true;
    }
    if insensitive {
        pat.eq_ignore_ascii_case(&got)
    } else {
        pat == got
    }
}

/// Whether `pattern` matches `text` starting at `at`, in characters: a
/// separator in the pattern may absorb a doubled separator in the text —
/// the form `{:?}` gives a Windows path. Returns the end offset, or `None`.
fn match_path_at(text: &[char], at: usize, pattern: &[char], insensitive: bool) -> Option<usize> {
    let mut p = 0;
    let mut t = at;
    while p < pattern.len() {
        let (pc, tc) = (*pattern.get(p)?, *text.get(t)?);
        if !char_matches(pc, tc, insensitive) {
            return None;
        }
        t += 1;
        p += 1;
        if is_sep(pc) && text.get(t).is_some_and(|next| is_sep(*next)) {
            t += 1;
        }
    }
    Some(t)
}

/// Characters that would extend the path's last name when they follow a
/// match: `marco2` is another name, `marco/` is the same path deeper.
fn extends_name(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '.')
}

/// The one redaction, in three passes over the message: the temp-folder
/// tree first (it contains the user's name in its own structure), then the
/// home directory as a whole path, then the account name where it stands as
/// a path component of its own.
fn redact(message: &str, r: &Redactions) -> String {
    let chars: Vec<char> = message.chars().collect();
    let chars = redact_tmp(&chars);
    let chars = redact_path(&chars, r);
    redact_component(&chars, r).into_iter().collect()
}

/// `/var/folders/ab/…` and `/private/var/folders/ab/…` become `<tmp>/ab/…`'s
/// replacement: the whole `<a>/<b>` pair under the prefix is the machine's
/// per-user temp tree, and what follows it is the app's own subfolders.
fn redact_tmp(text: &[char]) -> Vec<char> {
    let private: Vec<char> = "/private/var/folders/".chars().collect();
    let plain: Vec<char> = "/var/folders/".chars().collect();
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        let matched = [private.as_slice(), plain.as_slice()]
            .iter()
            .find_map(|prefix| match_path_at(text, at, prefix, false));
        match matched {
            Some(end) => {
                out.extend("<tmp>/".chars());
                // The two per-user components under the prefix go with it;
                // each is name characters followed by a separator.
                let mut cursor = end;
                for _ in 0..2 {
                    let name_len = text[cursor..]
                        .iter()
                        .take_while(|c| !is_sep(**c))
                        .count();
                    let sep = text.get(cursor + name_len).is_some_and(|c| is_sep(*c));
                    if name_len == 0 || !sep {
                        break;
                    }
                    cursor += name_len + 1;
                }
                at = cursor;
            }
            None => {
                out.push(text[at]);
                at += 1;
            }
        }
    }
    out
}

/// The home directory path, in any of its spellings, becomes `~`. The
/// trailing boundary is the name rule: a match followed by a name-extending
/// character is a different path and keeps the user's name (rare, and
/// honest) rather than mangling both.
fn redact_path(text: &[char], r: &Redactions) -> Vec<char> {
    let Some(home) = r.home.as_deref() else {
        return text.to_vec();
    };
    let pattern: Vec<char> = home.chars().collect();
    if pattern.is_empty() {
        return text.to_vec();
    }
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        let matched = match_path_at(text, at, &pattern, r.insensitive).filter(|end| text.get(*end).is_none_or(|next| !extends_name(*next)));
        match matched {
            Some(end) => {
                out.push('~');
                at = end;
            }
            None => {
                out.push(text[at]);
                at += 1;
            }
        }
    }
    out
}

/// The account name where it stands as a path component — between
/// separators (or at the ends of the text) — becomes `<user>`. Matched
/// case-insensitively on every platform: an account name in a log line is
/// the same name whether the writer cased it or not. In prose, between
/// spaces or punctuation, a word equal to the name is left alone: the rule
/// is the path shape, not the word.
fn redact_component(text: &[char], r: &Redactions) -> Vec<char> {
    let Some(user) = r.user.as_deref() else {
        return text.to_vec();
    };
    let pattern: Vec<char> = user.chars().collect();
    if pattern.len() < 3 {
        return text.to_vec();
    }
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        let bounded_before = at == 0 || is_sep(text[at - 1]);
        let matched = bounded_before
            .then(|| match_path_at(text, at, &pattern, true))
            .flatten()
            .filter(|end| text.get(*end).is_none_or(|next| is_sep(*next)));
        match matched {
            Some(end) => {
                out.extend("<user>".chars());
                at = end;
            }
            None => {
                out.push(text[at]);
                at += 1;
            }
        }
    }
    out
}

/// One line as it will be written: never longer than [`LINE_CHAR_CAP`]
/// characters, cut on a character boundary with the marker behind it.
fn clip_line(line: &str) -> String {
    clip(line, LINE_CHAR_CAP)
}

/// "macos 25.6.0" / "windows 10.0.19045": the OS name this binary was built
/// for, plus the version the machine reports. A version that cannot be read
/// is an unnamed operand, not a failure. The session facts (`system`) build
/// their own richer line and fall back to this one.
pub(crate) fn os_version() -> String {
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
