//! The search tests run against small trees in a temp folder — never
//! against a real disk, and never a whole-drive walk. The one exception is
//! the ignored Spotlight smoke at the bottom, which needs a real index.

use std::fs::{self, Permissions};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::entry::Kind;
use crate::scope::home_dir;
use crate::search::NameSearch;
use crate::search::{
    matcher_for, score_path, scope_is_large, searcher_for, Searcher, SpotlightSearch,
    WalkerSearch, MAX_RESULTS,
};
use crate::tests::TempTree;

/// Restores a directory's permissions on the way out — declared after the
/// TempTree it guards, so it drops FIRST and the tree can still be deleted.
/// A chmod-000 directory left behind would be exactly the litter the
/// TempTree contract forbids.
#[cfg(unix)]
struct ChmodGuard<'a>(&'a Path);

#[cfg(unix)]
impl Drop for ChmodGuard<'_> {
    fn drop(&mut self) {
        let _ = fs::set_permissions(self.0, Permissions::from_mode(0o755));
    }
}

/// Runs one walker search, collecting hits.
fn walk_collect(query: &str, scope: &Path) -> (crate::search::SearchOutcome, Vec<crate::search::SearchHit>) {
    let stop = AtomicBool::new(false);
    let mut hits = Vec::new();
    let outcome = WalkerSearch.search(query, scope, &mut |hit| hits.push(hit), &stop);
    (outcome, hits)
}

#[test]
fn a_fuzzy_query_finds_a_nested_file() {
    // The brief's own example: two words match one path, across separators.
    let tree = TempTree::new("fuzzy");
    tree.file("filler-a.txt", "x");
    tree.file("kalsa-brain/src/main.rs", "fn main() {}");
    tree.file("unrelated/deep/other.md", "x");

    let (outcome, hits) = walk_collect("kalsa brain", tree.path());
    assert!(
        hits.iter()
            .any(|hit| hit.path.ends_with("kalsa-brain/src/main.rs")),
        "the fuzzy query must reach the nested file; got {hits:?}"
    );
    assert_eq!(outcome.hits as usize, hits.len());
}

#[test]
fn a_name_on_its_own_path_outranks_one_buried_in_a_word() {
    let tree = TempTree::new("rank");
    tree.file("src/main.rs", "fn main() {}");
    tree.file("domain-lock.txt", "x");

    let (_, hits) = walk_collect("main", tree.path());
    let score = |suffix: &str| {
        hits.iter()
            .find(|hit| hit.path.ends_with(suffix))
            .unwrap_or_else(|| panic!("{suffix} must match"))
            .score
    };
    let on_path = score("src/main.rs");
    let buried = score("domain-lock.txt");
    assert!(
        on_path > buried,
        "a real name segment ({on_path}) must outrank the same letters inside a word ({buried})"
    );
}

#[test]
fn a_hidden_file_is_found() {
    // Every standard filter is off: no gitignore, no hidden-file skipping.
    // A find-file box that cannot see `.env` is broken the day it ships.
    let tree = TempTree::new("hidden");
    tree.file(".env", "SECRET=1");
    tree.file("node_modules/.secret/env.js", "x");

    let (outcome, hits) = walk_collect("env", tree.path());
    assert!(
        hits.iter().any(|hit| hit.name == ".env"),
        "dotfiles are files too; got {hits:?}"
    );
    assert!(
        hits.iter().any(|hit| hit.path.ends_with("node_modules/.secret/env.js")),
        "hidden directories are entered and hidden files are found; got {hits:?}"
    );
    assert_eq!(outcome.hits, 2);
}

#[cfg(unix)]
#[test]
fn a_permission_denied_directory_is_counted_not_fatal() {
    let tree = TempTree::new("denied");
    tree.file("open/needle.txt", "found");
    let denied = tree.dir("denied");
    tree.file("denied/secret-needle.txt", "no entry");
    let guard = ChmodGuard(&denied);
    fs::set_permissions(&denied, Permissions::from_mode(0o000)).expect("chmod");

    let (outcome, hits) = walk_collect("needle", tree.path());
    assert!(
        hits.iter().any(|hit| hit.name == "needle.txt"),
        "the readable part of the tree still answers"
    );
    assert_eq!(
        outcome.skipped, 1,
        "the unreadable directory is the OS's answer, counted and reported"
    );

    drop(guard); // back to 0755 so TempTree's delete cannot fail
}

#[test]
fn the_walk_stops_when_the_flag_is_set() {
    // The proof that cancellation stops the walk — not just that its
    // results are ignored — is structural: the sink holds the walker
    // INSIDE its own callback until the flag lands. If the walk then
    // visits anything more, the stop check is a lie.
    let tree = TempTree::new("stop");
    for index in 0..2000 {
        tree.file(&format!("needle-{index:04}.txt"), "x");
    }
    let stop = Arc::new(AtomicBool::new(false));
    let started = Arc::new(AtomicBool::new(false));

    let walker = WalkerSearch;
    let sink_stop = Arc::clone(&stop);
    let walk_stop = Arc::clone(&stop);
    let sink_started = Arc::clone(&started);
    let scope = tree.path().to_path_buf();
    let worker = std::thread::spawn(move || {
        walker.search(
            "needle",
            &scope,
            &mut |_hit| {
                if sink_started.swap(true, Ordering::SeqCst) {
                    return; // only the first hit holds the walk
                }
                while !sink_stop.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(1));
                }
            },
            &walk_stop,
        )
    });

    let deadline = Instant::now() + Duration::from_secs(10);
    while !started.load(Ordering::SeqCst) {
        assert!(
            Instant::now() < deadline,
            "the walk never produced its first hit"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
    stop.store(true, Ordering::SeqCst);

    let outcome = worker.join().expect("the walk thread");
    assert_eq!(
        outcome.hits, 1,
        "the walk ended at the entry it was sitting on — 2000 files exist and it saw one"
    );
    assert!(outcome.cancelled, "a stopped walk says it was stopped");
}

#[test]
fn the_cap_stops_the_walk_and_admits_it() {
    let tree = TempTree::new("cap");
    for index in 0..(MAX_RESULTS + 5) {
        tree.file(&format!("needle-{index:04}.txt"), "x");
    }

    let (outcome, hits) = walk_collect("needle", tree.path());
    assert_eq!(outcome.hits, MAX_RESULTS as u64);
    assert_eq!(hits.len(), MAX_RESULTS);
    assert!(
        outcome.limited,
        "stopping at the cap without saying so is the listing lie again"
    );
}

#[test]
fn hits_carry_the_full_path_and_their_name() {
    let tree = TempTree::new("fields");
    let full = tree.file("a/b/notes.md", "hello");

    let (_, hits) = walk_collect("notes", tree.path());
    let hit = hits
        .iter()
        .find(|hit| hit.name == "notes.md")
        .expect("the note matches");
    assert_eq!(
        hit.path,
        full.to_str().expect("utf-8 temp path"),
        "the page opens what the hit names, so the path is the full one"
    );
    assert!(!hit.is_dir);
    assert_eq!(hit.kind, Kind::Text);
}

#[test]
fn a_backslash_path_scores_like_a_forward_slash_one() {
    let (pattern, mut matcher) = matcher_for("src main");
    let windows = score_path(&pattern, &mut matcher, "kalsa-brain\\src\\main.rs");
    let posix = score_path(&pattern, &mut matcher, "kalsa-brain/src/main.rs");
    assert!(posix.is_some(), "the posix spelling matches");
    assert_eq!(
        windows, posix,
        "the same path under Windows separators must rank the same"
    );
}

#[test]
fn a_whole_disk_scope_is_large_and_a_project_is_not() {
    assert!(scope_is_large(Path::new("/")));
    assert!(scope_is_large(Path::new("/Users")));
    assert!(scope_is_large(Path::new("/Users/marco")));
    assert!(
        !scope_is_large(Path::new("/Users/marco/Projects")),
        "deeper than the machine's own half, the walk is the honest choice"
    );
}

#[test]
fn a_deep_scope_always_walks() {
    // The temp tree sits many components under the root: not "large" on
    // any platform, so the walker is the answer — on macOS regardless of
    // the index state, elsewhere because there is no Spotlight at all.
    let tree = TempTree::new("choose");
    assert_eq!(searcher_for(tree.path()), Searcher::Walker(WalkerSearch));
}

#[test]
fn an_empty_query_searches_nothing() {
    let tree = TempTree::new("empty");
    tree.file("needle.txt", "x");
    let (outcome, hits) = walk_collect("", tree.path());
    assert!(hits.is_empty() && outcome.hits == 0, "no query, no hits");
}

#[cfg(target_os = "macos")]
#[ignore = "a manual smoke: needs this Mac's Spotlight index; run with cargo test -- --ignored"]
#[test]
fn spotlight_really_answers_when_the_scope_is_indexed() {
    let Some(home) = home_dir() else {
        panic!("no home on this Mac");
    };
    let scope = home.join("Projects/kalsa-brain");
    assert!(scope.is_dir(), "run this where the kalsa-brain checkout lives");

    let stop = AtomicBool::new(false);
    let mut collected = Vec::new();
    let outcome =
        SpotlightSearch.search("cargo.toml", &scope, &mut |hit| collected.push(hit), &stop);
    assert!(outcome.hits >= 1, "the repo's manifests are indexed; got {outcome:?}");
    assert!(
        collected.iter().any(|hit| hit.name.eq_ignore_ascii_case("cargo.toml")),
        "the mdfind stream was parsed into named hits; got {collected:?}"
    );
}
