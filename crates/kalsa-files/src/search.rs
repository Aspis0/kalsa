//! Finding a file by name across a scope, by interchangeable means.
//!
//! [`NameSearch`] is the whole interface: given a query, a scope, a sink
//! and a stop flag, it streams hits as it finds them and reports how it
//! ended. The page sees one interface. Behind it:
//!
//! * [`WalkerSearch`] reads every directory itself — ripgrep's `ignore`
//!   walker with every gitignore and hidden-file filter OFF, because the
//!   disk is the scope and the index's blind spots (dotfiles, `.git`,
//!   `~/Library`) are exactly what a find-file box must not have.
//!   `follow_links` is off, which is also the loop guard. A whole-drive
//!   cold walk takes minutes; that is measured and accepted at this stage,
//!   and the page offers "search here" by default.
//! * [`SpotlightSearch`] asks macOS's `mdfind` to enumerate the scope and
//!   does the actual matching itself, so both backends agree on what a
//!   match is and the page can never tell which one ran — it notices
//!   nothing but speed. When Spotlight is off, disabled for the scope, or
//!   vanishes mid-run, the walker finishes the job.
//!
//! An index — the next job after this one — is a third implementation of
//! the same trait and nothing else.

use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use ignore::WalkBuilder;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Serialize;

use crate::entry::Kind;
pub use crate::spotlight::SpotlightSearch;

/// Matches returned before the search stops and says it stopped — the same
/// honesty as `MAX_ROWS` one level up. The page sorts what it has by score;
/// a query loose enough to outrun the cap ("e" over a whole drive) has told
/// the user everything a name box can do about it: narrow the question.
pub const MAX_RESULTS: usize = 500;

/// One found file. The score is nucleo's, over the path relative to the
/// scope; the page sorts on it.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub kind: Kind,
    pub score: u32,
}

/// How a search ended. `skipped` counts the entries the OS would not show
/// us — a permission-denied directory is the machine saying no, not a bug,
/// so the search reports it and carries on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SearchOutcome {
    pub hits: u64,
    pub skipped: u64,
    pub limited: bool,
    pub cancelled: bool,
}

pub trait NameSearch {
    /// Every hit goes to `sink` the moment it is found — nothing is
    /// collected and returned at the end. `stop` is checked between
    /// entries; a set flag ends the walk and says so in `cancelled`.
    fn search(
        &self,
        query: &str,
        scope: &Path,
        sink: &mut dyn FnMut(SearchHit),
        stop: &AtomicBool,
    ) -> SearchOutcome;
}

/// Which backend runs for a scope. The page never reads this; it exists so
/// the choice itself can be tested.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Searcher {
    Walker(WalkerSearch),
    Spotlight(SpotlightSearch),
}

impl NameSearch for Searcher {
    fn search(
        &self,
        query: &str,
        scope: &Path,
        sink: &mut dyn FnMut(SearchHit),
        stop: &AtomicBool,
    ) -> SearchOutcome {
        match self {
            Self::Walker(walker) => walker.search(query, scope, sink, stop),
            Self::Spotlight(spotlight) => spotlight.search(query, scope, sink, stop),
        }
    }
}

/// Choose the backend. The whole-disk scopes where a cold walk costs
/// minutes go to Spotlight when it is there and indexing; everything
/// deeper is the person's own tree, where the walk is complete — it sees
/// what the index skips — and fast enough that completeness is worth it.
pub fn searcher_for(scope: &Path) -> Searcher {
    #[cfg(target_os = "macos")]
    if scope_is_large(scope) && spotlight_covers(scope) {
        return Searcher::Spotlight(SpotlightSearch);
    }
    Searcher::Walker(WalkerSearch)
}

/// "Large" without counting anything: at most two components under the
/// root. Two levels down is the machine's own half of the disk — `/`,
/// `/Users`, `/Users/<name>` — millions of files. Deeper it is projects
/// and document folders.
pub(crate) fn scope_is_large(scope: &Path) -> bool {
    scope.components().count() <= 3
}

/// The one answer from `mdutil` that means mdfind will actually see the
/// scope. Disabled, unknown and erroring scopes all walk instead.
#[cfg(target_os = "macos")]
fn spotlight_covers(scope: &Path) -> bool {
    let Ok(output) = Command::new("mdutil").arg("-s").arg(scope).output() else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).contains("Indexing enabled")
}

/// The matching brain both backends share: the query parsed as an
/// fzf-style fuzzy pattern, the haystack a path with `\` read as `/` so a
/// Windows path ranks exactly like a POSIX one.
pub(crate) fn matcher_for(query: &str) -> (Pattern, Matcher) {
    let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);
    let matcher = Matcher::new(Config::DEFAULT.match_paths());
    (pattern, matcher)
}

/// nucleo's score for the query against one path, or `None` for no match.
pub(crate) fn score_path(pattern: &Pattern, matcher: &mut Matcher, relative: &str) -> Option<u32> {
    let normalized = relative.replace('\\', "/");
    let mut chars = Vec::new();
    let haystack = Utf32Str::new(&normalized, &mut chars);
    pattern.score(haystack, matcher).filter(|score| *score > 0)
}

/// The walker: every file, in every directory under the scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WalkerSearch;

impl NameSearch for WalkerSearch {
    fn search(
        &self,
        query: &str,
        scope: &Path,
        sink: &mut dyn FnMut(SearchHit),
        stop: &AtomicBool,
    ) -> SearchOutcome {
        let mut outcome = SearchOutcome::default();
        if query.is_empty() {
            return outcome;
        }
        let (pattern, mut matcher) = matcher_for(query);
        // `standard_filters(false)` is the whole point: no gitignore, no
        // hidden-file skipping, nothing — we want all files.
        let walk = WalkBuilder::new(scope)
            .standard_filters(false)
            .follow_links(false)
            .build();

        for entry in walk {
            if stop.load(Ordering::Relaxed) {
                outcome.cancelled = true;
                break;
            }
            let Ok(entry) = entry else {
                // Permission denied, vanished mid-walk: the OS's answer,
                // counted and carried past, never a failed search.
                outcome.skipped += 1;
                continue;
            };
            if entry.depth() == 0 {
                continue; // the scope itself is not a result
            }
            let path = entry.path();
            let Some(file_type) = entry.file_type() else {
                continue;
            };
            let relative = path.strip_prefix(scope).unwrap_or(path);
            let Some(relative) = relative.to_str() else {
                continue; // no Unicode, no JSON, no row
            };
            let Some(score) = score_path(&pattern, &mut matcher, relative) else {
                continue;
            };
            outcome.hits += 1;
            let is_dir = file_type.is_dir();
            sink(SearchHit {
                name: file_name(path),
                path: path.to_string_lossy().into_owned(),
                is_dir,
                kind: if is_dir { Kind::Other } else { Kind::of(path) },
                score,
            });
            if outcome.hits >= MAX_RESULTS as u64 {
                outcome.limited = true;
                break;
            }
        }
        outcome
    }
}

pub(crate) fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}
