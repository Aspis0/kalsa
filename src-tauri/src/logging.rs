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
//! Every message passes through one redaction before it is written — in
//! the file and on stderr alike: a path that starts with the user's home
//! directory is logged with `~` in its place, a signed URL loses its
//! query, and an IP literal that is not loopback (this machine's own
//! address, a peer's, a relay's) becomes `<addr>`.
//!
//! The crates that log per packet (the iroh stack and the tracing mirror
//! over it) are held at WARN: their INFO is not the app's story, it is
//! every datagram sent with the peer's address in the line.

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
/// What a clipped line ends with, so a reader knows the line was cut.
const TRUNCATED: &str = " …[truncated]";

pub(crate) fn clip(text: &str, cap: usize) -> String {
    if text.chars().count() <= cap {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(cap).collect();
    cut.push_str(TRUNCATED);
    cut
}

/// The folder the log lives in, once a file in it actually opened — the
/// command that opens the folder and the report both read it. A clearable
/// slot, not a one-shot: a file lost after a rotation un-advertises it
/// ([`lost_the_file`]), so nothing points at a file nothing writes.
static FOLDER: Mutex<Option<PathBuf>> = Mutex::new(None);

/// The sink behind the `log` facade: the file (with its rotation state)
/// behind one mutex, shared with the attach path so the process can start
/// stderr-only — before the instance lock says this process owns the log —
/// and take the file over only once the lock is won. Two apps on one log
/// file would interleave their lines; the lock decides which one may have
/// a file at all.
pub struct Logger {
    sink: std::sync::Arc<Sink>,
}

/// The state one process's log owns.
pub struct Sink {
    state: Mutex<State>,
    /// What every message is redacted against, built once at open.
    redactions: Redactions,
}

struct State {
    /// The open live file and its size so far. `None` is the stderr-only
    /// fallback: no folder named yet, the folder could not be created, the
    /// file could not be opened, or a rotation lost the file — the run
    /// goes on regardless.
    file: Option<(File, u64)>,
    dir: PathBuf,
    cap: u64,
}

/// The installed sink, once [`install`] has run: the logger holds one Arc
/// into it, and [`attach_file`] reaches it to take the file over after the
/// instance lock is won.
static SINK: OnceLock<std::sync::Arc<Sink>> = OnceLock::new();

impl Sink {
    /// The sink with the live file open in `dir`, creating the folder if
    /// needed. A failure at either step is the fallback, not an error: the
    /// logger still works, to stderr only.
    fn open(dir: &Path, cap: u64) -> Self {
        Self {
            state: Mutex::new(State {
                file: open_live(dir),
                dir: dir.to_path_buf(),
                cap,
            }),
            redactions: Redactions::build(),
        }
    }

    /// The sink with no file at all: everything goes to stderr, redacted
    /// like any other line.
    fn stderr_only() -> Self {
        Self {
            state: Mutex::new(State {
                file: None,
                dir: PathBuf::new(),
                cap: CAP_BYTES,
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
            if over_cap && matches!(rotate_with(&mut state, open_live), Rotated::Reset) {
                // Said on every reset, because the next reset truncates this
                // one away — and the newest chunk is what a report reads.
                // A Lost rotation says its own line on stderr — there is no
                // file left to carry one.
                append(
                    &mut state,
                    &clip_line(&format!(
                        "{} WARN  logging: rotation failed; the live file was reset",
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
    /// starts with — app version, OS with its version (the product version
    /// a person means, the same line the session facts print), arch.
    fn session_header(&self, version: &str) {
        self.write(Level::Info, "session", SESSION_LINE);
        self.write(
            Level::Info,
            "session",
            &format!(
                "kalsa-brain {version} · {} · {}",
                crate::system::os_description(),
                std::env::consts::ARCH
            ),
        );
    }

    /// The panic line: the location, through `try_lock`. A panic that
    /// fires while the sink's mutex is held — the report builder holds it
    /// over its file reads — must not wait for it: stderr carries the line
    /// that once, and `Ok(())` is returned either way, because a panic hook
    /// that can fail is a hook nobody calls twice.
    fn panic_line(&self, location: &str) {
        let line = clip_line(&format!(
            "{} ERROR  logging: panic at {location}",
            rfc3339_now()
        ));
        if let Ok(mut state) = self.state.try_lock() {
            append(&mut state, &line);
        }
        let _ = std::io::stderr()
            .lock()
            .write_all(format!("{line}\n").as_bytes());
    }

    /// Takes the file over, from a sink that started stderr-only: called
    /// once, after the instance lock says this process owns the log. On
    /// success the session header is written into the file (it is the
    /// file's first lines of this session) and the folder is advertised.
    /// On failure the sink stays stderr-only, nothing is advertised, and
    /// the answer is `false` — the app is never stopped by its log.
    fn attach(&self, dir: &Path, version: &str) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if state.file.is_some() {
            return true;
        }
        state.dir = dir.to_path_buf();
        state.cap = CAP_BYTES;
        state.file = open_live(dir);
        let opened = state.file.is_some();
        drop(state);
        if opened {
            self.session_header(version);
        }
        opened
    }
}

/// Crate roots whose INFO is not the app's story. The iroh stack logs
/// every datagram it sends (`poll_send`) with the peer's address in the
/// line — through the QUIC layer beneath it — and the tracing mirror under
/// both adds a record per span; together they filled ~98% of one
/// reporter's log. What a report wants from these crates is their WARN: a
/// relay that would not connect.
const QUIET_BELOW_WARN: &[&str] = &[
    "iroh",
    "iroh_relay",
    "noq",
    "noq_proto",
    "noq_udp",
    "netwatch",
    "portmapper",
    "tracing",
];

/// Whether one record is the quiet crates' below-warn chatter. INFO is the
/// deepest level this sink writes, so that is the level refused here; the
/// crate ROOT decides, so `iroh::socket` and `iroh_relay::client` are both
/// covered without silencing a name that merely starts with the same
/// letters.
fn quiet_below_warn(target: &str, level: Level) -> bool {
    level == Level::Info
        && QUIET_BELOW_WARN.contains(&target.split("::").next().unwrap_or(target))
}

impl Log for Logger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= Level::Info
            && !quiet_below_warn(metadata.target(), metadata.level())
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            self.sink
                .write(record.level(), record.target(), &record.args().to_string());
        }
    }

    fn flush(&self) {}
}

/// Installs the global logger. `Some(dir)` opens the live file at once and
/// writes the session header; `None` — the launch has not yet won the
/// instance lock, or the platform named no log directory — installs the
/// sink stderr-only with no header, and [`attach_file`] takes the file over
/// once the lock is won. The one place `set_boxed_logger` is called; a
/// second call (none exists) would be the error, so its `Err` is dropped,
/// not unwrapped.
pub fn install(dir: Option<PathBuf>, version: &str) {
    let sink = std::sync::Arc::new(match dir.as_ref() {
        Some(dir) => Sink::open(dir, CAP_BYTES),
        None => Sink::stderr_only(),
    });
    if dir.is_some() {
        sink.session_header(version);
    }
    let opened = sink
        .state
        .lock()
        .map(|state| state.file.is_some())
        .unwrap_or(false);
    let _ = log::set_boxed_logger(Box::new(Logger {
        sink: std::sync::Arc::clone(&sink),
    }));
    log::set_max_level(LevelFilter::Info);
    let _ = SINK.set(sink);
    if opened {
        if let Some(dir) = dir {
            advertise_dir(dir);
        }
    }
}

/// Advertises the folder everything log-shaped points at.
fn advertise_dir(dir: PathBuf) {
    if let Ok(mut slot) = FOLDER.lock() {
        *slot = Some(dir);
    }
}

/// Withdraws the advertisement: no live file, no folder to open or send.
fn unadvertise() {
    if let Ok(mut slot) = FOLDER.lock() {
        *slot = None;
    }
}

/// Takes the installed sink's file over, after the instance lock is won:
/// the session header is written into the file and the folder becomes the
/// one the open-folder button and the report read. A refused second launch
/// never calls this — its lines stay on stderr, and the winner's file is
/// never interleaved with another process's.
pub fn attach_file(dir: PathBuf, version: &str) {
    let attached = SINK
        .get()
        .is_some_and(|sink| sink.attach(&dir, version));
    if attached {
        advertise_dir(dir);
    }
}

/// Runs `f` with the installed sink's write lock held, so a reader — the
/// report building its body — sees the file between two lines rather than
/// mid-write. With no sink installed it just runs.
pub(crate) fn with_log_held<R>(f: impl FnOnce() -> R) -> R {
    match SINK.get() {
        Some(sink) => match sink.state.lock() {
            Ok(_held) => f(),
            Err(_) => f(),
        },
        None => f(),
    }
}

/// The log folder, for the command that opens it and the report that reads
/// it. `None` when no file was ever opened — or when the file was lost.
pub fn folder() -> Option<PathBuf> {
    FOLDER.lock().ok().and_then(|slot| slot.clone())
}

/// One string redacted against the same redactions every log line uses —
/// for values gathered outside a log macro (the session facts' adapter
/// strings), so they meet the same rules the sink enforces.
pub(crate) fn redact_str(text: &str) -> String {
    static REDACTIONS: OnceLock<Redactions> = OnceLock::new();
    redact(
        text,
        REDACTIONS.get_or_init(Redactions::build),
    )
}

/// The webview's error line: the error's own name and the first stack
/// frame's file:line — component and file names, never the message, which
/// can quote a whole conversation. The frame arrives as the webview read
/// it (`at Thread (Thread.tsx:412:19)`), so it is glued, not wrapped.
pub(crate) fn webview_line(name: &str, frame: &str) -> String {
    format!("webview error: {} {}", clip(name, 100), clip(frame, 200))
}

/// Panics reach the log before the platform's own hook: the LOCATION, and
/// nothing else. A panic payload is whatever some code failed with — a
/// request body, a file's contents — and the log's promise is that none of
/// it reaches the file, so the payload is not read at all. And the line is
/// written with `try_lock`: a panic that fires while the sink's mutex is
/// held (the report builder holds it over its file reads) must not
/// deadlock the hook waiting for the same mutex — a held lock means
/// stderr, this once, and stderr never lost anyone a panic line.
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|at| format!("{}:{}:{}", at.file(), at.line(), at.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        if let Some(sink) = SINK.get() {
            sink.panic_line(&location);
        } else {
            let _ = std::io::stderr().lock().write_all(
                format!(
                    "{} ERROR  logging: panic at {location}\n",
                    rfc3339_now()
                )
                .as_bytes(),
            );
        }
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

/// How one rotation attempt ended.
enum Rotated {
    /// Renamed, and a fresh live file is open.
    Yes,
    /// The rename could not happen, so the live file was reset in place.
    Reset,
    /// The rename happened and the fresh open failed: there is NO file, the
    /// folder is un-advertised, and stderr carries the one line that says
    /// so — the file that would have carried it is the thing that was
    /// lost.
    Lost,
}

/// The live file becomes the rotated one (replacing whatever rotated file
/// was there) and a fresh live file takes its place. The caller holds the
/// state lock. A rotation that cannot happen — the rotated file locked or
/// read-only, the folder refusing the rename — RESETS the live file
/// (`set_len(0)` on the handle still held) rather than letting it grow
/// past the cap forever: the bound is the point, and the newest lines are
/// the ones a report needs. The reset is said once inside the log. A
/// rename that succeeds and an open that fails is the one ending nothing
/// survives silently: [`Rotated::Lost`]. `reopen` is the fresh-open step,
/// injected so a test can fail it on an otherwise healthy folder.
fn rotate_with(state: &mut State, reopen: impl FnOnce(&Path) -> Option<(File, u64)>) -> Rotated {
    let Some((file, _)) = state.file.take() else {
        return Rotated::Reset;
    };
    let live = state.dir.join(LIVE_NAME);
    let rotated = state.dir.join(ROTATED_NAME);
    let room = std::fs::remove_file(&rotated).is_ok() || !rotated.exists();
    if room && std::fs::rename(&live, &rotated).is_ok() {
        state.file = reopen(&state.dir);
        return match state.file {
            Some(_) => Rotated::Yes,
            None => {
                lost_the_file();
                Rotated::Lost
            }
        };
    }
    // The rename failed, so the file still sits at the live path under the
    // handle we hold: truncate it in place and keep writing.
    if file.set_len(0).is_ok() {
        state.file = Some((file, 0));
    }
    Rotated::Reset
}

/// What a lost file costs: the folder is un-advertised (the button and the
/// report must not point at a file nothing writes), and one line says so
/// on stderr — the file that would have carried it is the thing lost.
fn lost_the_file() {
    unadvertise();
    let _ = std::io::stderr().lock().write_all(
        format!(
            "{} WARN  logging: the log file was lost after a rotation; stderr only from here\n",
            rfc3339_now()
        )
        .as_bytes(),
    );
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
            // Windows spells the home directory `USERPROFILE` and some
            // environments set `HOME` beside it with the other separator's
            // spelling — the platform's own variable wins.
            home: env_path("USERPROFILE").or_else(|| env_path("HOME")),
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
        // A separator in the pattern may absorb a DOUBLED one in the text
        // (the `{:?}` form of a Windows path) — but never when the pattern
        // itself continues with another separator, or "https://" would
        // spend its second slash on the first and die on 'e'.
        if is_sep(pc)
            && text.get(t).is_some_and(|next| is_sep(*next))
            && !pattern.get(p).is_some_and(|next| is_sep(*next))
        {
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

/// The one redaction, in passes over the message: the URL query first (a
/// signed query can carry the very path and name the later passes redact),
/// then the temp tree, the home directory, the account name as a path
/// component, and the IP literals last.
fn redact(message: &str, r: &Redactions) -> String {
    let chars: Vec<char> = message.chars().collect();
    let chars = redact_urls(&chars);
    let chars = redact_tmp(&chars);
    let chars = redact_path(&chars, r);
    let chars = redact_component(&chars, r);
    redact_addresses(&chars).into_iter().collect()
}

/// Characters that end a URL printed inside free text: whitespace, or a
/// bracketing punctuation a sentence might wrap it in. Everything between
/// the scheme and the first `?`/`#` is the URL's own address and stays;
/// the query and fragment go, because a downloader's redirect answers with
/// signed URLs whose query is a credential (`?X-Amz-Signature=…` from a
/// Hugging Face `/resolve/` redirect, printed verbatim inside a transport
/// error's Display).
fn redact_urls(text: &[char]) -> Vec<char> {
    const MARK: &str = "?…";
    let http: Vec<char> = "http://".chars().collect();
    let https: Vec<char> = "https://".chars().collect();
    let ends_url = |c: char| c.is_whitespace() || matches!(c, ')' | ']' | '}' | '>' | '"' | '\'');
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        let scheme = [&https, &http]
            .iter()
            .find_map(|prefix| match_path_at(text, at, prefix, true));
        match scheme {
            Some(end_of_scheme) => {
                // The address runs to the first ?/# (kept up to, not
                // including); the query and fragment run to the URL's end.
                let url_end = text[end_of_scheme..]
                    .iter()
                    .position(|c| ends_url(*c))
                    .map(|stop| end_of_scheme + stop)
                    .unwrap_or(text.len());
                let cut = text[end_of_scheme..url_end]
                    .iter()
                    .position(|c| *c == '?' || *c == '#')
                    .map(|stop| end_of_scheme + stop);
                match cut {
                    Some(cut) => {
                        out.extend(text[at..cut].iter().copied());
                        out.extend(MARK.chars());
                        at = url_end;
                    }
                    None => {
                        out.extend(text[at..url_end].iter().copied());
                        at = url_end;
                    }
                }
            }
            None => {
                out.push(text[at]);
                at += 1;
            }
        }
    }
    out
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

/// IP literals that name this machine or the peers it talks to become
/// `<addr>`: a report is read by the person who was given it, and the
/// address a laptop dials from is none of their business. Loopback stays —
/// it names this computer to itself, which is what the report is read for —
/// and a port beside a literal stays too, so a line still says where Kalsa
/// listened.
fn redact_addresses(text: &[char]) -> Vec<char> {
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        let found = starts_literal(text, at)
            .then(|| ipv4_at(text, at).or_else(|| ipv6_at(text, at)))
            .flatten();
        match found {
            Some(end) => {
                let literal: String = text[at..end].iter().collect();
                if is_loopback(&literal) {
                    out.extend(text[at..end].iter().copied());
                } else {
                    out.extend("<addr>".chars());
                }
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

/// Where a literal may begin: the character before it must not be part of a
/// name or of a longer dotted run, or a version's tail (`1.2.3.4.5` holds
/// no address) would be taken for one. A colon before it is allowed —
/// `peer:fe80::1` is how a line names a peer — unless that colon closes a
/// hex group too, so the tail of a longer fingerprint is not an address.
fn starts_literal(text: &[char], at: usize) -> bool {
    match at.checked_sub(1).and_then(|before| text.get(before)) {
        None => true,
        Some(':') => at
            .checked_sub(2)
            .and_then(|before| text.get(before))
            .is_none_or(|c| !(c.is_ascii_hexdigit() || matches!(c, ':' | '.'))),
        Some(c) => !(c.is_ascii_alphanumeric() || matches!(c, '.' | '%' | '_')),
    }
}

/// Whether a literal is loopback, any zone behind `%` ignored. The standard
/// parser is the authority here; a literal it refuses is redacted.
fn is_loopback(literal: &str) -> bool {
    literal
        .split('%')
        .next()
        .and_then(|addr| addr.parse::<std::net::IpAddr>().ok())
        .is_some_and(|addr| addr.is_loopback())
}

/// An IPv4 literal at `at`, or `None`: four dotted decimal octets of one to
/// three digits, no leading zero and none above 255 — so `1.2.3.4` is an
/// address and `10.0.19045.4046` is a version. A fifth group or a decimal
/// tail behind it is a longer run, not an address.
fn ipv4_at(text: &[char], at: usize) -> Option<usize> {
    let mut cursor = at;
    for group in 0..4 {
        let octet_start = cursor;
        let mut octet = 0u32;
        while let Some(digit) = text.get(cursor).and_then(|c| c.to_digit(10)) {
            if cursor - octet_start == 3 {
                // A fourth digit is not an octet, whatever it spells; the
                // run is refused before the arithmetic can overflow on it.
                return None;
            }
            octet = octet * 10 + digit;
            cursor += 1;
        }
        let digits = cursor - octet_start;
        if digits == 0 || octet > 255 {
            return None;
        }
        if digits > 1 && text[octet_start] == '0' {
            return None;
        }
        if group < 3 {
            if text.get(cursor) != Some(&'.') {
                return None;
            }
            cursor += 1;
        }
    }
    match text.get(cursor) {
        Some(c) if c.is_ascii_digit() || *c == '.' => None,
        _ => Some(cursor),
    }
}

/// An IPv6 literal at `at`, or `None`: groups of one to four hex digits
/// joined by single colons, at most one `::` standing for the groups left
/// out, an optional zone behind `%`, and the dotted tail of a mapped
/// address. Without a `::` all eight groups are required, so a clock time
/// (`10:17:57`) is not an address; a lone `::` is not one either — every
/// Rust path in a log carries one.
fn ipv6_at(text: &[char], at: usize) -> Option<usize> {
    let mut cursor = at;
    let mut groups = 0usize;
    let mut compressed = false;
    if text.get(cursor) == Some(&':') {
        if text.get(cursor + 1) != Some(&':') {
            return None;
        }
        compressed = true;
        cursor += 2;
    }
    loop {
        let group_start = cursor;
        while text.get(cursor).is_some_and(|c| c.is_ascii_hexdigit()) {
            cursor += 1;
        }
        if cursor == group_start || cursor - group_start > 4 {
            // The `::` already taken is the only empty group there is: a
            // second one, or a trailing colon, is not an address.
            return None;
        }
        if text.get(cursor) == Some(&'.') {
            // The dotted tail of a mapped address (`::ffff:10.0.0.7`): it
            // is redacted with the address it maps, as two groups.
            cursor = ipv4_at(text, group_start)?;
            groups += 2;
            break;
        }
        groups += 1;
        if groups > 8 {
            // More than the eight a full address has: not an address, and
            // the scan stops rather than reading the rest of a digest.
            return None;
        }
        match text.get(cursor) {
            Some(&':') => {
                if text.get(cursor + 1) == Some(&':') {
                    if compressed {
                        return None;
                    }
                    compressed = true;
                    cursor += 2;
                } else {
                    cursor += 1;
                }
            }
            _ => break,
        }
    }
    if text.get(cursor) == Some(&'%') {
        let zone = cursor + 1;
        let mut end = zone;
        while text
            .get(end)
            .is_some_and(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
        {
            end += 1;
        }
        if end == zone {
            return None;
        }
        cursor = end;
    }
    let complete = if compressed { groups < 8 } else { groups == 8 };
    (complete && groups > 0).then_some(cursor)
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
