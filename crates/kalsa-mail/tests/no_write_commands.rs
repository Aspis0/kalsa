//! The crate is read-only. This is the check that no write command exists in it,
//! not a promise: the words are searched for in every source file of the crate.

use std::path::{Path, PathBuf};

/// IMAP commands that change a mailbox. If one of these appears as a command, the
/// sidecar can write, and step one says it cannot.
const WRITE_COMMANDS: [&str; 9] = [
    "STORE",
    "APPEND",
    "EXPUNGE",
    "MOVE",
    "COPY",
    "RENAME",
    "CREATE",
    "SETFLAGS",
    "SUBSCRIBE",
];

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn sources(directory: &str) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(crate_dir().join(directory))
        .unwrap_or_else(|e| panic!("{directory} is readable: {e}"))
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext == "rs" || ext == "toml")
        })
        .collect();
    found.sort();
    found
}

/// The list above has to be spelled out somewhere, so this file is the one place the
/// words may appear. Everything else in the crate is checked.
const THIS_FILE: &str = "no_write_commands.rs";

#[test]
fn no_source_file_mentions_a_write_command() {
    let mut files = sources("src");
    files.extend(sources("tests"));
    files.retain(|path| !path.ends_with(THIS_FILE));
    assert!(files.len() > 2, "the crate has sources to check");

    for path in files {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        for (number, line) in text.lines().enumerate() {
            for command in WRITE_COMMANDS {
                assert!(
                    !line.contains(command),
                    "{}:{} mentions the write command {command}: {}",
                    path.display(),
                    number + 1,
                    line.trim()
                );
            }
        }
    }
}

#[test]
fn the_read_path_uses_peek_and_examine_only() {
    let imap = std::fs::read_to_string(crate_dir().join("src/imap.rs")).expect("imap.rs");
    let mailbox = std::fs::read_to_string(crate_dir().join("src/mailbox.rs")).expect("mailbox.rs");
    assert!(
        mailbox.contains("session.examine("),
        "the mailbox is opened read-only"
    );
    assert!(
        mailbox.contains("BODY.PEEK[]"),
        "a full fetch must never set the seen flag"
    );
    // Every fetch query has to be the peeking form, full or partial.
    for query in ["\"BODY[]\"", "\"BODY[]<"] {
        assert!(
            !mailbox.contains(query),
            "the query {query} would mark a mail seen"
        );
    }
    assert!(
        mailbox.contains("BODY.PEEK[HEADER]"),
        "the sender history reads headers, not bodies"
    );
    for call in [
        ".select(",
        ".store(",
        ".append(",
        ".expunge(",
        ".move(",
        ".copy(",
    ] {
        assert!(!imap.contains(call), "imap.rs never calls {call}");
    }
}

/// The manifest is part of the promise: no mail crate that can send is even present.
#[test]
fn no_sending_crate_is_a_dependency() {
    let manifest = std::fs::read_to_string(crate_dir().join("Cargo.toml")).expect("Cargo.toml");
    for sending in ["lettre", "sendmail", "mail-send", " lettre"] {
        assert!(
            !manifest.contains(sending),
            "{sending} would give this crate a way to send"
        );
    }
    assert!(
        Path::new(&crate_dir().join("src/draft.rs")).exists(),
        "the draft is built here and written nowhere"
    );
}
