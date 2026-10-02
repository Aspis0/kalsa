use super::*;

/// A record like the facade hands over, aimed at this logger.
fn logged(logger: &Logger, message: &str) {
    logger.write(Level::Info, "test", message);
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "kalsa-logging-{name}-{}",
        std::process::id() as u64 + SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos() as u64
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// Reads the live file's lines, if any.
fn live_lines(dir: &Path) -> Vec<String> {
    std::fs::read_to_string(dir.join(LIVE_NAME))
        .unwrap_or_default()
        .lines()
        .map(|line| line.to_string())
        .collect()
}

/// The candidate line's own number, from the "line NNN" it was written
/// with.
fn line_number(line: &str) -> u32 {
    line.split("test: line ")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .and_then(|number| number.parse().ok())
        .unwrap_or(u32::MAX)
}

#[test]
fn a_write_past_the_cap_leaves_exactly_two_files_with_the_newest_lines_live() {
    let dir = scratch("rotation");
    let logger = Logger::open(&dir, 400);
    for line in 0..40 {
        logged(&logger, &format!("line {line:03} of the rotation test"));
    }
    let rotated = std::fs::read_to_string(dir.join(ROTATED_NAME)).unwrap_or_default();
    let live = live_lines(&dir);
    // Two files, no more: the rotated one holds the older lines, the
    // live one the newest. (An old line can rotate away entirely once a
    // later rotation replaces the rotated file — two files is the cap,
    // not a history.)
    let names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        names.len(),
        2,
        "exactly the live file and one rotated file, got {names:?}"
    );
    assert!(names.contains(&LIVE_NAME.to_string()));
    assert!(names.contains(&ROTATED_NAME.to_string()));
    // Every live line is newer than every rotated one, and the last
    // written line is live.
    assert!(!live.is_empty(), "the live file is the one still written");
    assert!(!rotated.is_empty(), "the rotated file holds the older lines");
    let oldest_live = live.iter().map(|line| line_number(line)).min().unwrap();
    let newest_rotated = rotated.lines().map(line_number).max().unwrap();
    assert!(
        newest_rotated < oldest_live,
        "the newest lines must be live: rotated {newest_rotated}, live {oldest_live}"
    );
    assert_eq!(
        live.iter().map(|line| line_number(line)).max().unwrap(),
        39,
        "the last line written is in the live file"
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_message_carrying_the_home_path_is_written_with_a_tilde() {
    let dir = scratch("redaction");
    let mut logger = Logger::open(&dir, CAP_BYTES);
    logger.redactions =
        Redactions::new(Some("/Users/someone".to_string()), None, false);
    logged(
        &logger,
        "files list failed: /Users/someone/Library/nope/here.txt (os error 2)",
    );
    let line = &live_lines(&dir)[0];
    assert!(line.contains("~/Library/nope/here.txt"), "{line}");
    assert!(!line.contains("/Users/someone"), "{line}");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_home_that_is_a_prefix_of_another_name_is_not_overmatched() {
    let redactions = Redactions::new(Some("/Users/marco".to_string()), None, false);
    let redacted = redact(
        "both /Users/marco and /Users/marco2 appear",
        &redactions,
    );
    assert_eq!(redacted, "both ~ and /Users/marco2 appear");
}

/// The Windows forms of one home path — the platform's own casing ignored,
/// either separator, and the doubled backslash `{:?}` renders — all redact
/// to the same `~`.
#[test]
fn windows_home_paths_redact_in_every_spelling() {
    let redactions = Redactions::new(
        Some("C:\\Users\\Marco G".to_string()),
        Some("Marco G".to_string()),
        true,
    );
    for line in [
        "open C:\\Users\\Marco G\\models\\weights.gguf failed",
        "open C:\\Users\\marco g\\models\\weights.gguf failed",
        "open C:/Users/Marco G/models/weights.gguf failed",
        // The literal doubled-backslash form, as `{:?}` renders it.
        "open \"C:\\\\Users\\\\Marco G\\\\models\\\\weights.gguf\" failed",
    ] {
        let redacted = redact(line, &redactions);
        // The spelling of the separators that FOLLOW the home path is the
        // text's own (doubled stays doubled); what must never survive is
        // the path itself.
        assert!(
            redacted.contains("~") && (redacted.contains("\\models") || redacted.contains("/models")),
            "{line} -> {redacted}"
        );
        assert!(!redacted.contains("Marco G"), "{line} -> {redacted}");
    }
}

/// The account name is a secret only where it stands as a path component:
/// between separators (including the doubled form), never in prose, and
/// never when it is too short to be more than a word.
#[test]
fn the_account_name_redacts_only_as_a_path_component() {
    let redactions = Redactions::new(None, Some("marco".to_string()), true);
    let redacted = redact(
        "C:\\Users\\marco\\AppData\\Local\\Temp and /tmp/marco/x, but marco wrote this",
        &redactions,
    );
    assert_eq!(
        redacted,
        "C:\\Users\\<user>\\AppData\\Local\\Temp and /tmp/<user>/x, but marco wrote this"
    );
    let short = Redactions::new(None, Some("mk".to_string()), true);
    assert_eq!(
        redact("C:\\Users\\mk\\x", &short),
        "C:\\Users\\mk\\x",
        "a two-letter name is a word, not a marker"
    );
}

/// The macOS per-user temp tree carries no user name of its own, but it is
/// a per-user identifier either way, and the `confstr`-long form begins
/// with `/private`.
#[test]
fn the_per_user_temp_tree_becomes_tmp() {
    let redactions = Redactions::new(None, None, false);
    for line in [
        "slot save: /var/folders/ab/xyz123/T/ai.kalsa.brain/slots/chat.bin",
        "slot save: /private/var/folders/ab/xyz123/T/ai.kalsa.brain/slots/chat.bin",
    ] {
        let redacted = redact(line, &redactions);
        assert!(
            redacted.starts_with("slot save: <tmp>/T/ai.kalsa.brain/"),
            "{line} -> {redacted}"
        );
    }
}

/// A line past [`LINE_CHAR_CAP`] characters is cut at the cap with the
/// marker behind it, so one runaway message cannot eat the file cap.
#[test]
fn a_line_past_eight_kib_is_cut_with_the_marker() {
    let dir = scratch("clip");
    let logger = Logger::open(&dir, CAP_BYTES);
    let huge = "x".repeat(LINE_CHAR_CAP + 5000);
    logged(&logger, &huge);
    let line = &live_lines(&dir)[0];
    assert!(line.ends_with(TRUNCATED), "{line:.80}");
    assert!(
        line.chars().count() <= LINE_CHAR_CAP + TRUNCATED.chars().count(),
        "the cut line stays at the cap plus the marker"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// A panic payload is clipped to [`PANIC_CHAR_CAP`] characters before it
/// reaches the log, redacted like any other line.
#[test]
fn a_panic_message_is_clipped_to_its_own_cap() {
    assert_eq!(clip("short", PANIC_CHAR_CAP), "short");
    let long = "p".repeat(PANIC_CHAR_CAP + 900);
    let clipped = clip(&long, PANIC_CHAR_CAP);
    assert_eq!(
        clipped.chars().count(),
        PANIC_CHAR_CAP + TRUNCATED.chars().count()
    );
    assert!(clipped.ends_with(TRUNCATED));
}

/// The folder is advertised only when a folder was named AND its live file
/// opened: a stderr-only run has nothing for the button to open.
#[test]
fn a_folder_is_advertised_only_when_its_file_opened() {
    let dir = PathBuf::from("/definitely/not/real");
    assert!(advertise(Some(&dir), true));
    assert!(!advertise(Some(&dir), false), "an unopened file is no folder to open");
    assert!(!advertise(None, true), "no folder named, nothing to advertise");
    assert!(!advertise(None, false));
}

/// A folder whose rotated file cannot be replaced keeps writing to the live
/// file instead of going silent: the cap is a preference, the log is the
/// point. A read-only folder makes remove and rename both fail while the
/// already-open live file still writes. Unix only: the read-only bit is
/// what POSIX makes of a directory, and the Windows equivalent (ACLs) is
/// not something a test may set up here.
#[cfg(unix)]
#[test]
fn a_rotation_that_cannot_happen_keeps_writing_the_live_file() {
    let dir = scratch("locked-rotation");
    let logger = Logger::open(&dir, 300);
    for line in 0..10 {
        logged(&logger, &format!("line {line:03} of the locked rotation test"));
    }
    // The rotated file exists; lock the folder so it can never be replaced.
    std::fs::write(dir.join(ROTATED_NAME), b"an untouchable rotated file").unwrap();
    let mut perms = std::fs::metadata(&dir).unwrap().permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        perms.set_mode(0o555);
    }
    std::fs::set_permissions(&dir, perms).unwrap();
    for line in 10..25 {
        logged(&logger, &format!("line {line:03} of the locked rotation test"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut open = std::fs::metadata(&dir).unwrap().permissions();
        open.set_mode(0o755);
        std::fs::set_permissions(&dir, open).unwrap();
    }
    let live = live_lines(&dir);
    let written = live
        .iter()
        .filter(|line| line.contains("test: line "))
        .map(|line| line_number(line))
        .max();
    assert_eq!(
        written,
        Some(24),
        "the live file kept receiving lines after the failed rotation"
    );
    assert!(
        live.iter().any(|line| line.contains("rotation failed")),
        "the failure is said inside the log: {live:?}"
    );
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn an_unwritable_log_folder_never_panics_and_keeps_stderr() {
    // A file where the folder should be: create_dir_all must fail, and
    // the logger must take the stderr-only fallback without a panic.
    let parent = scratch("fallback");
    std::fs::create_dir_all(&parent).unwrap();
    std::fs::write(parent.join("blocked"), b"not a folder").unwrap();
    let dir = parent.join("blocked").join("logs");
    let logger = Logger::open(&dir, CAP_BYTES);
    assert!(logger.state.lock().unwrap().file.is_none());
    logged(&logger, "this must not panic");
    // A later message after a failed rotation attempt is the same story.
    logged(&logger, "nor this");
    std::fs::remove_dir_all(&parent).ok();
}

#[test]
fn the_timestamp_is_rfc3339_utc_whole_seconds() {
    let stamp = |secs: u64| {
        let days = (secs / 86_400) as i64;
        let rest = secs % 86_400;
        let (year, month, day) = civil_from_days(days);
        format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
            rest / 3_600,
            (rest % 3_600) / 60,
            rest % 60
        )
    };
    assert_eq!(stamp(0), "1970-01-01T00:00:00Z");
    assert_eq!(stamp(951_782_400), "2000-02-29T00:00:00Z", "a leap day");
    assert_eq!(stamp(1_000_000_000), "2001-09-09T01:46:40Z");
    assert_eq!(stamp(1_709_164_799), "2024-02-28T23:59:59Z", "the day before");
    assert_eq!(stamp(1_709_164_800), "2024-02-29T00:00:00Z");
}

/// The sink is shared across threads (the ticker, the walk, the door):
/// a burst from many threads must neither panic nor lose a line under
/// the lock. Counting lines catches a torn or dropped write.
#[test]
fn writes_from_many_threads_all_reach_the_file() {
    let dir = scratch("threads");
    let logger = std::sync::Arc::new(Logger::open(&dir, CAP_BYTES));
    let handles: Vec<_> = (0..4)
        .map(|thread| {
            let logger = std::sync::Arc::clone(&logger);
            std::thread::spawn(move || {
                for line in 0..25 {
                    logger.write(Level::Info, "test", &format!("t{thread} line {line:03}"));
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().expect("no thread panics");
    }
    let rotated = std::fs::read_to_string(dir.join(ROTATED_NAME)).unwrap_or_default();
    let total = rotated.lines().count() + live_lines(&dir).len();
    assert_eq!(total, 100, "every line written under the lock");
    std::fs::remove_dir_all(&dir).ok();
}
