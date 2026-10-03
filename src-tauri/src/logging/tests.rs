use super::*;

/// A record like the facade hands over, aimed at this sink.
fn logged(sink: &Sink, message: &str) {
    sink.write(Level::Info, "test", message);
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
    let sink = Sink::open(&dir, 400);
    for line in 0..40 {
        logged(&sink, &format!("line {line:03} of the rotation test"));
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
    let mut sink = Sink::open(&dir, CAP_BYTES);
    sink.redactions = Redactions::new(Some("/Users/someone".to_string()), None, false);
    logged(
        &sink,
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
    let redacted = redact("both /Users/marco and /Users/marco2 appear", &redactions);
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

/// The addresses a report must not carry: this machine's LAN IPv4 and a
/// peer's global IPv6, in the compressed, zoned and bracketed-with-port
/// shapes a line prints them. Loopback stays — it names this computer to
/// itself — and so do the version-shaped numbers the session header is
/// made of, which a looser redactor would eat.
#[test]
fn the_machine_addresses_are_redacted_and_loopback_and_versions_survive() {
    let redactions = Redactions::new(None, None, false);
    let line = "peer=192.168.1.5 v6=[2001:db8:85a3::8a2e:370:7334]:7842 link=fe80::1c2b:3d4e%en0 mapped=::ffff:10.0.0.7 door=127.0.0.1:8131 self=::1";
    let redacted = redact(line, &redactions);
    for gone in [
        "192.168.1.5",
        "2001:db8:85a3::8a2e:370:7334",
        "fe80::1c2b:3d4e",
        "::ffff:10.0.0.7",
    ] {
        assert!(!redacted.contains(gone), "{gone} survived: {redacted}");
    }
    assert_eq!(redacted.matches("<addr>").count(), 4, "{redacted}");
    assert!(redacted.contains("[<addr>]:7842"), "the port stays: {redacted}");
    assert!(redacted.contains("127.0.0.1:8131"), "{redacted}");
    assert!(redacted.contains("self=::1"), "{redacted}");
    let versions = "kalsa-brain 1.1.5 · macos 25.6.0 · windows 10.0.19045 (build 26200.9457)";
    assert_eq!(redact(versions, &redactions), versions);
    // A `::` may stand for the groups at the END of the address — a
    // link-local is usually spelled that way — zone and bracketed port
    // included.
    let trailing = "to=fe80:: zone=fe80::%en0 any=2001:db8:: port=[fe80::]:8131";
    assert_eq!(
        redact(trailing, &redactions),
        "to=<addr> zone=<addr> any=<addr> port=[<addr>]:8131"
    );
    // The lone `::` of a Rust path is still not an address.
    let path = "tracing::span and a crate::b path";
    assert_eq!(redact(path, &redactions), path);
    // Eight colon-joined groups IS a valid IPv6 address, and it goes: no
    // format this app prints writes one (its hashes are bare hex, its
    // versions dotted), so the shape costs nothing here.
    assert_eq!(
        redact("fp aa:bb:cc:dd:ee:ff:00:11", &redactions),
        "fp <addr>"
    );
    // A MAC and a clock time are neither of them addresses.
    let other = "aa:bb:cc:dd:ee:ff at 09:41:05";
    assert_eq!(redact(other, &redactions), other);
    // A long numeric run is not an address, and reading it must not
    // overflow: digests and hashes are long runs of them.
    let digest = "digest 0123456789012345678901234567890123456789";
    assert_eq!(redact(digest, &redactions), digest);
    // Nor is a colon-separated fingerprint, whose tail holds eight
    // groups that would otherwise read as one.
    let fingerprint = "fp 00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff";
    assert_eq!(redact(fingerprint, &redactions), fingerprint);
    // A literal right behind a label's colon is still an address.
    let labelled = redact("peer:fe80::1", &redactions);
    assert_eq!(labelled, "peer:<addr>");
}

/// The sink enforces the rule, not the caller: a message carrying this
/// machine's LAN address and a peer's global IPv6 reaches the file with
/// neither, and the loopback door beside them is still legible.
#[test]
fn a_line_through_the_sink_carries_no_address_but_loopback() {
    let dir = scratch("addresses");
    let sink = Sink::open(&dir, CAP_BYTES);
    logged(
        &sink,
        "peer 192.168.1.5 answered from 2001:db8::5; this door is 127.0.0.1:8131",
    );
    let line = &live_lines(&dir)[0];
    assert!(!line.contains("192.168.1.5"), "{line}");
    assert!(!line.contains("2001:db8::5"), "{line}");
    assert!(line.contains("127.0.0.1:8131"), "{line}");
    assert_eq!(line.matches("<addr>").count(), 2, "{line}");
    std::fs::remove_dir_all(&dir).ok();
}

/// The crates that log per packet are held at WARN: their INFO — the
/// datagram lines with a peer's address on them, the mirror's span
/// records — never reaches the file, while their WARN and the app's own
/// crates' INFO do. The crate ROOT decides, so `kalsa_iroh` is not caught
/// by the `iroh` entry.
#[test]
fn the_flooding_crates_are_quiet_below_warn_through_the_logger() {
    let dir = scratch("quiet");
    let logger = Logger {
        sink: std::sync::Arc::new(Sink::open(&dir, CAP_BYTES)),
    };
    for (level, target, message) in [
        (Level::Info, "iroh::socket::transports", "poll_send; remote=192.168.1.5:7842"),
        (Level::Info, "tracing::span", "portmapper.service;"),
        (Level::Info, "netwatch::actor", "route change"),
        (Level::Info, "noq_proto::connection", "packet received"),
        (Level::Info, "kalsa_iroh::transport", "the road is open"),
        (
            Level::Warn,
            "iroh::socket::transports::relay::actor",
            "Lost connection to relay server: Ping timeout",
        ),
        (Level::Info, "kalsa_brain::report", "sending the log report"),
    ] {
        logger.log(
            &Record::builder()
                .level(level)
                .target(target)
                .args(format_args!("{message}"))
                .build(),
        );
    }
    let joined = live_lines(&dir).join("\n");
    for quiet in ["poll_send", "portmapper.service;", "route change", "packet received"] {
        assert!(!joined.contains(quiet), "{quiet} reached the file: {joined}");
    }
    assert!(joined.contains("the road is open"), "{joined}");
    assert!(joined.contains("Lost connection to relay server"), "{joined}");
    assert!(joined.contains("sending the log report"), "{joined}");
    std::fs::remove_dir_all(&dir).ok();
}

/// A line past [`LINE_CHAR_CAP`] characters is cut at the cap with the
/// marker behind it, so one runaway message cannot eat the file cap.
#[test]
fn a_line_past_eight_kib_is_cut_with_the_marker() {
    let dir = scratch("clip");
    let sink = Sink::open(&dir, CAP_BYTES);
    let huge = "x".repeat(LINE_CHAR_CAP + 5000);
    logged(&sink, &huge);
    let line = &live_lines(&dir)[0];
    assert!(line.ends_with(TRUNCATED), "{line:.80}");
    assert!(
        line.chars().count() <= LINE_CHAR_CAP + TRUNCATED.chars().count(),
        "the cut line stays at the cap plus the marker"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// The panic line is the location, and only the location: a payload is
/// whatever some code failed with — a request body, a file's contents —
/// and the hook must not read it at all. A guard in the shape of the door
/// cache-salt test: it reads this file's own source and fails if the hook
/// ever grows a payload read.
#[test]
fn the_panic_line_is_the_location_alone() {
    let source = include_str!("../logging.rs");
    let hook = source
        .split("pub fn install_panic_hook")
        .nth(1)
        .expect("the hook exists");
    let body = hook.split('}').next().unwrap_or(hook);
    assert!(
        !body.contains("payload"),
        "the panic hook reads the payload — the location is all the log gets"
    );
}

/// The webview's error line carries the error's name and the first stack
/// frame, clipped — never the message, which can quote a conversation.
#[test]
fn the_webview_error_line_names_the_error_and_its_frame_and_nothing_else() {
    let line = webview_line("TypeError", "at Thread (Thread.tsx:412:19)");
    assert_eq!(line, "webview error: TypeError at Thread (Thread.tsx:412:19)");
    let long = webview_line(&"n".repeat(400), &"f".repeat(400));
    assert!(long.contains(TRUNCATED), "{long:.60}");
}

/// The sink starts stderr-only — the launch has not yet won the instance
/// lock — and takes the file over only on attach: two processes on one log
/// is what the whole dance exists to prevent, and the file's first lines
/// of the session are the header.
#[test]
fn a_stderr_only_sink_takes_the_file_when_attached_after_the_lock() {
    let dir = scratch("attach");
    let sink = Sink::stderr_only();
    logged(&sink, "before the lock, stderr only");
    assert!(!dir.join(LIVE_NAME).exists(), "no file before the lock is won");
    assert!(sink.attach(&dir, "0.0.1-test"), "the attach opens the file");
    logged(&sink, "after the lock, the file");
    let lines = live_lines(&dir);
    let joined = lines.join("\n");
    assert!(
        joined.contains(SESSION_LINE) && joined.contains("kalsa-brain 0.0.1-test"),
        "the file's first lines of the session are the header: {joined}"
    );
    assert!(
        joined.contains("after the lock, the file"),
        "later lines land in the file: {joined}"
    );
    assert!(
        !joined.contains("before the lock"),
        "the stderr-only line never reaches the file"
    );
    // A second attach is a no-op, not a second header.
    assert!(sink.attach(&dir, "0.0.1-test"));
    let again = live_lines(&dir);
    assert_eq!(
        again.iter().filter(|l| l.contains(SESSION_LINE)).count(),
        1,
        "{again:?}"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// An attach that cannot open the file stays stderr-only, quietly: the
/// folder refusing the log costs the file, never the app.
#[test]
fn an_attach_that_cannot_open_stays_stderr_only() {
    let parent = scratch("attach-failed");
    std::fs::create_dir_all(&parent).unwrap();
    std::fs::write(parent.join("blocked"), b"not a folder").unwrap();
    let sink = Sink::stderr_only();
    assert!(
        !sink.attach(&parent.join("blocked").join("logs"), "0.0.1-test"),
        "the refused attach answers false"
    );
    assert!(
        sink.state.lock().unwrap().file.is_none(),
        "the sink stays stderr-only"
    );
    logged(&sink, "still stderr");
    std::fs::remove_dir_all(&parent).ok();
}

/// A folder whose rotated file cannot be replaced resets the live file
/// instead of growing forever: the cap is the point, and the newest lines
/// — the ones a report needs — are what survive. A read-only folder makes
/// remove and rename both fail while the held handle still truncates.
#[cfg(unix)]
#[test]
fn a_rotation_that_cannot_happen_resets_the_live_file() {
    let dir = scratch("locked-rotation");
    let sink = Sink::open(&dir, 300);
    for line in 0..10 {
        logged(&sink, &format!("line {line:03} of the locked rotation test"));
    }
    // The rotated file exists; lock the folder so it can never be replaced.
    std::fs::write(dir.join(ROTATED_NAME), b"an untouchable rotated file").unwrap();
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(&dir).unwrap().permissions();
    perms.set_mode(0o555);
    std::fs::set_permissions(&dir, perms).unwrap();
    for line in 10..40 {
        logged(&sink, &format!("line {line:03} of the locked rotation test"));
    }
    let mut open = std::fs::metadata(&dir).unwrap().permissions();
    open.set_mode(0o755);
    std::fs::set_permissions(&dir, open).unwrap();
    let live = live_lines(&dir);
    let written = live
        .iter()
        .filter(|line| line.contains("test: line "))
        .map(|line| line_number(line))
        .max();
    assert_eq!(
        written,
        Some(39),
        "the newest line survives every failed rotation: {live:?}"
    );
    assert!(
        live.iter().any(|line| line.contains("rotation failed; the live file was reset")),
        "the reset is said inside the log: {live:?}"
    );
    let size = std::fs::metadata(dir.join(LIVE_NAME)).unwrap().len();
    assert!(
        size < 600,
        "the live file stays bounded by the cap plus a line or two, not the whole history: {size}"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// A signed URL inside any logged string keeps its scheme, host and path,
/// and loses its query and fragment: ureq's transport errors carry the
/// failed URL (`error.rs` Display), the downloader follows redirects, and
/// a Hugging Face `/resolve/` redirect answers with a signed CDN URL whose
/// query is a credential.
#[test]
fn a_signed_url_loses_its_query_and_fragment_but_not_its_address() {
    let redactions = Redactions::new(None, None, false);
    let message = "download failed: weights.gguf: https://huggingface.co/Kalsa-ai/kalsa-server/resolve/f038a4f4/file.gz?X-Amz-Signature=deadbeef1234&X-Amz-Date=20261002T0000Z (status 403)";
    let redacted = redact(message, &redactions);
    assert!(
        redacted.contains("https://huggingface.co/Kalsa-ai/kalsa-server/resolve/f038a4f4/file.gz?…"),
        "{redacted}"
    );
    assert!(!redacted.contains("X-Amz-Signature"), "{redacted}");
    assert!(!redacted.contains("deadbeef"), "{redacted}");
    // A fragment goes the same way, and a plain URL is untouched.
    let with_fragment = redact("see https://example.invalid/a/b#c-token-here end", &redactions);
    assert!(with_fragment.contains("https://example.invalid/a/b?…"), "{with_fragment}");
    let plain = redact("at https://example.invalid/plain/path next", &redactions);
    assert!(plain.contains("https://example.invalid/plain/path"), "{plain}");
    assert!(!plain.contains("?…"), "{plain}");
}

/// Every scheme's query goes, not only the downloader's two: a relay URL
/// carries a token just as well, and the schemes Kalsa names today are not
/// the schemes a line may hold. A Windows path is not one of them — `C:\`
/// and `C:/` carry no `//`, which is the whole test the scheme scan makes —
/// and neither is a plain path.
#[test]
fn every_scheme_loses_its_query_and_windows_paths_stay_whole() {
    let redactions = Redactions::new(None, None, false);
    for line in [
        "relay wss://relay.example.com/x?token=deadbeef1234 done",
        "relay ws://relay.example.com/x?token=deadbeef1234 done",
        "asset ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/x?key=deadbeef1234 done",
        "odd scheme+ext.more://host/p?q=deadbeef1234 done",
    ] {
        let redacted = redact(line, &redactions);
        assert!(!redacted.contains("deadbeef"), "{line} -> {redacted}");
        assert!(redacted.contains("?…"), "{line} -> {redacted}");
    }
    assert!(
        redact("at wss://relay.example.com/x?token=zz end", &redactions)
            .contains("wss://relay.example.com/x?…"),
        "the URL keeps its address"
    );
    for path in [
        r"C:\Users\x\models\a.gguf",
        "C:/Users/x/models/a.gguf",
        r"\\server\share\a.gguf",
        "/Users/x/a.gguf",
    ] {
        assert_eq!(redact(path, &redactions), path);
    }
}

/// The versions, builds and hashes this app really prints, through the same
/// redaction: the GPU driver line (four dotted parts, `31.0.101.2125`), the
/// macOS and Windows build lines, the engine line, a model row, and the two
/// 64-character hashes of a digest mismatch. None is an address, and a
/// redaction that ate one would eat the facts a report is read for.
#[test]
fn the_versions_builds_and_hashes_the_app_logs_survive() {
    let redactions = Redactions::new(None, None, false);
    for line in [
        "adapter: Intel(R) Arc(TM) Graphics (discrete, driver 31.0.101.2125, 8.0 GiB)",
        "adapter: Apple M3 Pro (integrated, driver the OS's own, 18.0 GiB)",
        "memory bandwidth: 196.6 GiB/s (measured)",
        "windows 11 25H2 (build 26200.4652)",
        "macos 26.6.2 (build 25G83)",
        "engine: kalsa-server v1.1.5 · metal build",
        "model row: qwen3-8b · Qwen3-8B-Q4_K_M.gguf · context 32768 tokens · drafter on",
        "download failed: model.gguf: wrong sha256: expected 9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0, got 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ] {
        assert_eq!(redact(line, &redactions), line);
    }
}

/// A panic while the sink's mutex is held (the report builder holds it over
/// its reads) must not wait for it: the line goes to stderr that once, and
/// the file is not corrupted by a write from under a held lock. Once the
/// lock is free the panic line reaches the file like any other.
#[test]
fn a_panic_line_never_waits_on_the_sink_s_own_mutex() {
    let dir = scratch("panic-held");
    let sink = Sink::open(&dir, CAP_BYTES);
    let held = sink.state.lock().expect("the lock is taken");
    sink.panic_line("src/x.rs:7:2");
    assert!(
        !dir.join(LIVE_NAME).exists() || live_lines(&dir).iter().all(|l| !l.contains("panic at")),
        "no panic line reaches the file while the lock is held"
    );
    drop(held);
    sink.panic_line("src/x.rs:7:2");
    assert!(
        live_lines(&dir).iter().any(|l| l.contains("panic at src/x.rs:7:2")),
        "once free, the line is filed: {:?}",
        live_lines(&dir)
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// A rename that succeeds and a fresh open that fails leaves NO file: the
/// folder is un-advertised (nothing may point at a file nothing writes)
/// and the sink goes stderr-only — never silently.
#[test]
fn a_lost_rotation_unadvertises_the_folder_and_goes_stderr_only() {
    let dir = scratch("lost-rotation");
    let sink = Sink::open(&dir, 300);
    logged(&sink, "a line to grow on");
    advertise_dir(dir.clone());
    assert_eq!(folder(), Some(dir.clone()), "the folder starts advertised");
    let lost = {
        let mut state = sink.state.lock().unwrap();
        // Grow past the cap so a rotation is due, then fail the reopen on
        // an otherwise healthy folder.
        if let Some((_, len)) = state.file.as_mut() {
            *len = u64::MAX / 2;
        }
        rotate_with(&mut state, |_| None)
    };
    assert!(matches!(lost, Rotated::Lost), "the reopen failure is reported");
    assert_eq!(folder(), None, "the folder is withdrawn");
    assert!(
        !dir.join(LIVE_NAME).exists(),
        "the live file was renamed away and not reopened"
    );
    assert!(dir.join(ROTATED_NAME).exists(), "the rotated half survives");
    assert!(
        sink.state.lock().unwrap().file.is_none(),
        "the sink is stderr-only from here"
    );
    unadvertise();
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
    let sink = Sink::open(&dir, CAP_BYTES);
    assert!(sink.state.lock().unwrap().file.is_none());
    logged(&sink, "this must not panic");
    logged(&sink, "nor this");
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
    let sink = std::sync::Arc::new(Sink::open(&dir, CAP_BYTES));
    let handles: Vec<_> = (0..4)
        .map(|thread| {
            let sink = std::sync::Arc::clone(&sink);
            std::thread::spawn(move || {
                for line in 0..25 {
                    sink.write(Level::Info, "test", &format!("t{thread} line {line:03}"));
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

/// The engine's whole start line, through every stage that can touch it:
/// the supervisor's own worker renders the argv, the installed sink
/// redacts, the file holds the bytes. The path's separators are exactly
/// the shapes a C-style unescaper would eat — `\r`, `\a`, `\n`, `\t`,
/// `\b` after a separator — so the file must carry every one of them as
/// backslash and letter, with only the home replaced by `~`.
#[test]
fn an_engine_start_line_keeps_escape_shaped_separators_from_argv_to_the_file() {
    use kalsa_supervisor::{ServerConfig, Supervisor};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};

    // This process's sinks read their home once, at install — so the
    // Windows home the path below sits under is named first, wherever
    // this test runs.
    let previous_home = std::env::var("USERPROFILE").ok();
    std::env::set_var("USERPROFILE", r"C:\Users\x");
    let dir = scratch("engine-start-escapes");
    install(None, "test");
    attach_file(dir.clone(), "test");

    let port = {
        let probe = TcpListener::bind("127.0.0.1:0").expect("a free port");
        probe.local_addr().expect("the address").port()
    };
    let state_file =
        std::env::temp_dir().join(format!("kalsa-brain-escapes-{}.state", std::process::id()));
    let _ = std::fs::remove_file(&state_file);
    let path = r"C:\Users\x\AppData\Roaming\ai.kalsa.brain\runtime\new\tmp\b";
    #[cfg(unix)]
    let quiet = "-c";
    #[cfg(windows)]
    let quiet = "/C";
    let supervisor = Supervisor::new();
    let waiter = supervisor.start(ServerConfig {
        #[cfg(unix)]
        exe: std::path::PathBuf::from("/bin/sh"),
        #[cfg(windows)]
        exe: std::path::PathBuf::from("cmd.exe"),
        argv: vec![
            quiet.to_string(),
            "exit 0".to_string(),
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            port.to_string(),
            "--model".to_string(),
            path.to_string(),
        ],
        state_file: state_file.clone(),
        port,
        ready_timeout: Duration::from_millis(300),
        stop_grace: Duration::from_millis(50),
    });
    // The worker writes on its own thread: wait for the line rather than
    // for the settle, which can land either side of the write.
    let deadline = Instant::now() + Duration::from_secs(10);
    let engine_line = loop {
        if let Some(line) = live_lines(&dir)
            .into_iter()
            .find(|line| line.contains("engine start #1:") && line.contains(r"\new\tmp\b"))
        {
            break line;
        }
        assert!(
            Instant::now() < deadline,
            "the engine start line never reached the file: state {:?}, lines {:?}",
            supervisor.state(),
            live_lines(&dir)
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    let _ = waiter.outcome();
    let rendered = format!(
        "argv {quiet} \"exit 0\" --host 127.0.0.1 --port {port} --model ~\\AppData\\Roaming\\ai.kalsa.brain\\runtime\\new\\tmp\\b"
    );
    assert!(
        engine_line.contains(&rendered),
        "the path must reach the file as one backslash per separator: {engine_line}"
    );
    assert!(
        !engine_line.contains(r"C:\Users\x"),
        "the home is gone, only ~ stands for it: {engine_line}"
    );
    assert!(
        !engine_line.contains(r"\\"),
        "no doubled separator anywhere: {engine_line}"
    );
    match previous_home {
        Some(home) => std::env::set_var("USERPROFILE", home),
        None => std::env::remove_var("USERPROFILE"),
    }
}
