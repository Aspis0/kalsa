//! The Spotlight backend: mdfind enumerates what the index holds for the
//! scope, one NUL-separated path at a time, and the shared matcher decides
//! what counts. macOS only; anywhere else this backend is never chosen.

use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::entry::Kind;
use crate::search::{
    file_name, matcher_for, score_path, NameSearch, SearchHit, SearchOutcome, WalkerSearch,
    MAX_RESULTS,
};

/// Spotlight: the fast half of "large scope". The user notices nothing but
/// speed — which is also the accepted cost: the index's blind spots
/// (dotfiles, `.git`, `~/Library`, unindexed volumes) are exactly why small
/// scopes walk instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpotlightSearch;

impl NameSearch for SpotlightSearch {
    fn search(
        &self,
        query: &str,
        scope: &Path,
        sink: &mut dyn FnMut(SearchHit),
        stop: &Arc<AtomicBool>,
    ) -> SearchOutcome {
        #[cfg(target_os = "macos")]
        return self.search_with_mdfind(query, scope, sink, stop);
        #[cfg(not(target_os = "macos"))]
        return WalkerSearch.search(query, scope, sink, stop);
    }
}

impl SpotlightSearch {
    #[cfg(target_os = "macos")]
    fn search_with_mdfind(
        &self,
        query: &str,
        scope: &Path,
        sink: &mut dyn FnMut(SearchHit),
        stop: &Arc<AtomicBool>,
    ) -> SearchOutcome {
        let mut outcome = SearchOutcome::default();
        if query.is_empty() {
            return outcome;
        }
        let (pattern, mut matcher) = matcher_for(query);
        // `-0`: NUL-separated, because a path may contain a newline. `*` as
        // the raw query enumerates everything indexed under the scope;
        // narrowing happens here, in the matcher both backends share.
        // mdfind chats on stderr as it starts; it is silenced, not captured.
        let child = Command::new("mdfind")
            .args(["-0", "-onlyin"])
            .arg(scope)
            .arg("*")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let mut child = match child {
            Ok(child) => child,
            // The gate said Spotlight was there and it went away mid-run:
            // finish the job the slow way rather than answer nothing.
            Err(_) => return WalkerSearch.search(query, scope, sink, stop),
        };
        let Some(stdout) = child.stdout.take() else {
            let _ = child.wait();
            return WalkerSearch.search(query, scope, sink, stop);
        };
        outcome.via_index = true;

        // The stop flag is checked between records, but a quiet mdfind pipe
        // delivers no records: the read below would block forever with the
        // flag set and the child alive. The watcher kills the child the
        // moment the flag lands, which closes the pipe, which unblocks the
        // read, which reaches the cleanup. A cancelled search leaves
        // nothing running. The watcher also exits when the search simply
        // finishes — a completed run must not leave a thread polling a
        // flag nobody will ever set.
        let shared = Arc::new(Mutex::new(child));
        let finished = Arc::new(AtomicBool::new(false));
        let watcher = watch_stop(stop, &finished, Arc::clone(&shared));

        let reader = BufReader::new(stdout);
        let mut seen: HashSet<String> = HashSet::new();
        for chunk in reader.split(0) {
            if stop.load(Ordering::Relaxed) {
                outcome.cancelled = true;
                break;
            }
            let Ok(chunk) = chunk else { break };
            let Ok(line) = String::from_utf8(chunk) else {
                continue;
            };
            let path = PathBuf::from(line.trim_end_matches('\0'));
            let Some(path_text) = path.to_str() else {
                continue;
            };
            if !seen.insert(path_text.to_owned()) {
                continue;
            }
            let relative = path.strip_prefix(scope).unwrap_or(&path);
            let Some(relative) = relative.to_str() else {
                continue;
            };
            let Some(score) = score_path(&pattern, &mut matcher, relative) else {
                continue;
            };
            outcome.hits += 1;
            sink(Self::hit(&path, path_text, score));
            if outcome.hits >= MAX_RESULTS as u64 {
                outcome.limited = true;
                break;
            }
        }
        // Whether it finished, was drained, or was stopped: the child is
        // killed if still alive and reaped either way, so no zombie outlives
        // the search. The watcher has usually done it already.
        if let Ok(mut child) = shared.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        finished.store(true, Ordering::Relaxed);
        let _ = watcher.join();
        outcome
    }

    #[cfg(target_os = "macos")]
    fn hit(path: &Path, path_text: &str, score: u32) -> SearchHit {
        let is_dir = std::fs::metadata(path).map(|meta| meta.is_dir()).unwrap_or(false);
        SearchHit {
            name: file_name(path),
            path: path_text.to_owned(),
            is_dir,
            kind: if is_dir { Kind::Other } else { Kind::of(path) },
            score,
        }
    }
}

/// Kill `child` as soon as `stop` is set — on its own thread, because the
/// reader it protects is blocked in a syscall and cannot help. Polled
/// rather than condvar'd: the flag is the only signal, 50 ms is far below
/// a person's perception, and the alternative — a blocking read with no
/// timeout — is the hang this exists to prevent.
pub(crate) fn watch_stop(
    stop: &Arc<AtomicBool>,
    finished: &Arc<AtomicBool>,
    child: Arc<Mutex<Child>>,
) -> std::thread::JoinHandle<()> {
    let stop = Arc::clone(stop);
    let finished = Arc::clone(finished);
    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) && !finished.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(50));
        }
        if !finished.load(Ordering::Relaxed) {
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
            }
        }
    })
}
