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
    logger.home = Some("/Users/someone".to_string());
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

#[test]
fn a_home_that_is_a_prefix_of_another_name_is_not_overmatched() {
    let redacted = redact(
        "both /Users/marco and /Users/marco2 appear",
        Some("/Users/marco"),
    );
    assert_eq!(redacted, "both ~ and /Users/marco2 appear");
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
