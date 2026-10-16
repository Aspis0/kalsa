//! What this crate may write, checked in its sources rather than promised. Mail is read
//! over IMAP without a write command, and it is sent only by the `send` tool, which the
//! host runs after the person confirms it.

use std::path::PathBuf;

/// IMAP commands that change a mailbox. If one of these appears, the sidecar can write
/// to the mailbox, which the read path never does.
const WRITE_COMMANDS: [&str; 10] = [
    "STORE",
    "APPEND",
    "EXPUNGE",
    "MOVE",
    "COPY",
    "RENAME",
    "CREATE",
    "SETFLAGS",
    "SUBSCRIBE",
    "SELECT",
];

/// The list above has to be spelled out somewhere, so this file is the one place the
/// words may appear. Everything else in the crate is checked.
const THIS_FILE: &str = "no_write_commands.rs";

/// The only modules that name lettre: one composes the message, one delivers it.
const SENDING_MODULES: [&str; 2] = ["compose.rs", "smtp.rs"];

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

fn source_texts() -> Vec<(PathBuf, String)> {
    let mut files = sources("src");
    files.extend(sources("tests"));
    files
        .into_iter()
        .map(|path| {
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            (path, text)
        })
        .collect()
}

fn is_named(path: &std::path::Path, name: &str) -> bool {
    path.file_name().is_some_and(|file| file == name)
}

#[test]
fn no_source_file_mentions_a_write_command() {
    let files = source_texts();
    assert!(files.len() > 2, "the crate has sources to check");
    for (path, text) in files.iter().filter(|(path, _)| !is_named(path, THIS_FILE)) {
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
        mailbox.contains("BODY.PEEK[HEADER.FIELDS (FROM DATE)]"),
        "the sender history reads two headers, not bodies"
    );
    assert!(
        !mailbox.contains("BODY.PEEK[HEADER]"),
        "the sender history never asks for a whole header block"
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

#[test]
fn lettre_is_used_only_to_compose_and_deliver() {
    for (path, text) in source_texts() {
        if is_named(&path, THIS_FILE) || SENDING_MODULES.iter().any(|name| is_named(&path, name)) {
            continue;
        }
        assert!(
            !text.contains("lettre"),
            "{} names lettre; only {SENDING_MODULES:?} may",
            path.display()
        );
    }
}

#[test]
fn delivery_and_composition_are_reached_only_through_the_send_tool() {
    for (path, text) in source_texts() {
        if is_named(&path, THIS_FILE) {
            continue;
        }
        if !is_named(&path, "smtp.rs") && !is_named(&path, "send.rs") {
            assert!(
                !text.contains("deliver("),
                "{} delivers mail; only the send tool may",
                path.display()
            );
        }
        if !is_named(&path, "send.rs") {
            assert!(
                !text.contains("compose::reply("),
                "{} composes a reply; only the send tool may",
                path.display()
            );
        }
    }

    let mcp = std::fs::read_to_string(crate_dir().join("src/mcp.rs")).expect("mcp.rs");
    assert!(
        mcp.contains("ToolRoute::new(tools::send()"),
        "send is served as a tool route"
    );
    assert!(
        mcp.contains("guarded(send(account, senders, listed, kept, args))"),
        "the send route is the only caller of send"
    );
}
