//! The file panel's commands: what is in a folder, what are this machine's
//! roots, what does one file's name match, and the bytes of one file.
//!
//! Everything real happens in `kalsa-files`; this module is the IPC skin —
//! blocking work pushed off the main thread, results shaped for the page,
//! and the search streamed as events rather than one long answer.
//!
//! The search speaks twice. The invoke itself returns only a summary; the
//! hits travel on the `brain_files_search` event as they are found, in
//! batches, with `done: true` closing the run. A new search cancels the
//! one before it — there is one panel, and the newest question wins.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kalsa_files::{self, NameSearch, SearchHit};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// The same cap the page enforces on a `File` it reads itself —
/// `MAX_FILE_BYTES` in `chat/src/lib/attachments.ts`. The page wraps these
/// bytes in a `File` and calls its own extractor, so the two numbers must
/// agree; a test pins the pair.
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;

/// The event the search streams on. The `query` rides along so a late
/// batch of a cancelled search is recognizably stale to the page.
const SEARCH_EVENT: &str = "brain_files_search";

/// Hits per batch, and how long a thin batch may stretch before it is
/// sent anyway — the page must see progress, not silence.
const BATCH_HITS: usize = 50;
const BATCH_INTERVAL: Duration = Duration::from_millis(250);

/// Blocking file work on a pool thread: the window keeps drawing while a
/// two-hundred-thousand-entry folder or a cold walk is being read.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "The file work did not finish. Trying again usually works.".to_string())?
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Where browsing starts: the filesystem's roots, and the user's home —
/// the page cannot guess either.
#[derive(Serialize)]
pub(crate) struct RootsDto {
    roots: Vec<String>,
    home: Option<String>,
}

#[tauri::command]
pub(crate) fn brain_files_roots() -> RootsDto {
    RootsDto {
        roots: kalsa_files::roots()
            .iter()
            .map(|root| path_to_string(root))
            .collect(),
        home: kalsa_files::home_dir().as_deref().map(path_to_string),
    }
}

/// One folder's contents, folders first, capped at `MAX_ROWS` with
/// `truncated` telling the truth about the rest and `skipped` counting the
/// children the OS would not let us read — a folder that quietly lost rows
/// reads as complete, which it is not.
#[derive(Serialize)]
pub(crate) struct ListingDto {
    path: String,
    entries: Vec<kalsa_files::Entry>,
    truncated: bool,
    skipped: u64,
}

#[tauri::command]
pub(crate) async fn brain_files_list(path: String) -> Result<ListingDto, String> {
    blocking(move || {
        let listing = kalsa_files::list_dir(Path::new(&path)).map_err(|error| error.to_string())?;
        Ok(ListingDto {
            path: path_to_string(&listing.path),
            entries: listing.entries,
            truncated: listing.truncated,
            skipped: listing.skipped,
        })
    })
    .await
}

/// The bytes of one file, up to `MAX_FILE_BYTES`. The page wraps the
/// buffer in a `File` and runs the extractor it already has, so no
/// document parsing happens here.
#[tauri::command]
pub(crate) async fn brain_files_read(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = blocking(move || read_capped(Path::new(&path), MAX_FILE_BYTES)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Resolve, refuse a folder, refuse anything that is not a regular file —
/// the whole disk is in scope now, and a FIFO named `notes.txt` would other-
/// wise hold the read open forever waiting for a writer that never comes.
/// Then read through [`read_bounded`], so the cap bounds the WORK, not just
/// the answer: a file that grows after the metadata check is still read to
/// at most `max_bytes + 1`, never to whatever it has become.
fn read_capped(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let real = kalsa_files::resolve(path).map_err(|error| {
        format!("{}: {}", path_to_string(path), error)
    })?;
    let meta = std::fs::metadata(&real)
        .map_err(|error| format!("{}: {error}", path_to_string(&real)))?;
    if meta.is_dir() {
        return Err(format!(
            "{} is a folder — pick a file inside it.",
            path_to_string(&real)
        ));
    }
    if !meta.is_file() {
        return Err(format!(
            "{} is not a regular file — pipes and devices never end, so it is not read.",
            path_to_string(&real)
        ));
    }
    let over = |size: u64| {
        format!(
            "{} is {size} bytes; the page reads at most {max_bytes} bytes (32 MB).",
            path_to_string(&real)
        )
    };
    let size = meta.len();
    if size > max_bytes {
        return Err(over(size));
    }
    let file = std::fs::File::open(&real).map_err(|error| format!("{}: {error}", path_to_string(&real)))?;
    let bytes = read_bounded(file, max_bytes).map_err(|error| format!("{}: {error}", path_to_string(&real)))?;
    let read_len = bytes.len() as u64;
    if read_len > max_bytes {
        return Err(over(read_len));
    }
    Ok(bytes)
}

/// `Read::take` does the bounding: at most `max_bytes + 1` bytes are ever
/// allocated or moved, so a file racing past the cap between the metadata
/// check and the read costs one byte over the limit, not the file's new
/// size. The `+ 1` is what lets the caller's over-cap check distinguish
/// "grew past the cap" from "exactly at it".
fn read_bounded(file: std::fs::File, max_bytes: u64) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut bytes = Vec::new();
    file.take(max_bytes.saturating_add(1)).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// The one running search. Starting a new one cancels the previous —
/// `WalkState::Quit` for the walker, a kill for mdfind.
#[derive(Default)]
pub(crate) struct Searches(Mutex<Option<Arc<AtomicBool>>>);

impl Searches {
    fn start_new(&self) -> Arc<AtomicBool> {
        let stop = Arc::new(AtomicBool::new(false));
        if let Ok(mut slot) = self.0.lock() {
            if let Some(previous) = slot.replace(Arc::clone(&stop)) {
                previous.store(true, Ordering::Relaxed);
            }
        }
        stop
    }
}

/// Hits accumulate here and leave in batches — a whole-disk walk can find
/// thousands, and one event per hit would flood the page.
struct HitBatcher {
    buf: Vec<SearchHit>,
    limit: usize,
    interval: Duration,
    started: Instant,
}

impl HitBatcher {
    fn new(limit: usize, interval: Duration) -> Self {
        Self {
            buf: Vec::new(),
            limit,
            interval,
            started: Instant::now(),
        }
    }

    /// Some hits when the batch is full, `None` to keep waiting.
    fn push(&mut self, hit: SearchHit) -> Option<Vec<SearchHit>> {
        self.buf.push(hit);
        if self.buf.len() >= self.limit || self.started.elapsed() >= self.interval {
            Some(self.take())
        } else {
            None
        }
    }

    fn take(&mut self) -> Vec<SearchHit> {
        self.started = Instant::now();
        std::mem::take(&mut self.buf)
    }
}

#[derive(Serialize, Clone)]
pub(crate) struct SearchEvent {
    /// The page-chosen generation of this search. The query string alone
    /// cannot tell two runs of the same words apart, and a late batch from
    /// a replaced run must be recognisable as stale even when the words
    /// are identical.
    id: u64,
    query: String,
    matches: Vec<SearchHit>,
    skipped: u64,
    limited: bool,
    done: bool,
    /// Meaningful on the done event only: the answer came from the index.
    /// Carried on the event (not just the invoke's summary) because the
    /// event can be the last word to arrive.
    via_index: bool,
}

#[derive(Serialize)]
pub(crate) struct SearchSummary {
    id: u64,
    hits: u64,
    skipped: u64,
    limited: bool,
    cancelled: bool,
    /// The answer came from the Spotlight index, which is fast and blind at
    /// once — the page says so, because fewer results must never read as
    /// "nothing else exists".
    via_index: bool,
}

/// Search file names under `scope`, streaming matches on `brain_files_search`.
/// An empty query cancels the running search, clears the panel, and answers
/// nothing — the page's stop button without a fifth command.
#[tauri::command]
pub(crate) async fn brain_files_search(
    app: AppHandle,
    id: u64,
    query: String,
    scope: String,
    searches: State<'_, Searches>,
) -> Result<SearchSummary, String> {
    let stop = searches.start_new();
    let query = query.trim().to_owned();
    let outcome = blocking(move || -> Result<kalsa_files::SearchOutcome, String> {
        let real = kalsa_files::resolve(Path::new(&scope)).map_err(|error| error.to_string())?;
        let mut batcher = HitBatcher::new(BATCH_HITS, BATCH_INTERVAL);
        let emit = |event: SearchEvent| {
            let _ = app.emit(SEARCH_EVENT, event);
        };
        let outcome = if query.is_empty() {
            let mut stopped = kalsa_files::SearchOutcome::default();
            stopped.cancelled = true;
            stopped
        } else {
            kalsa_files::searcher_for(&real).search(
                &query,
                &real,
                &mut |hit| {
                    if let Some(batch) = batcher.push(hit) {
                        emit(SearchEvent {
                            id,
                            query: query.clone(),
                            matches: batch,
                            skipped: 0,
                            limited: false,
                            done: false,
                            via_index: false,
                        });
                    }
                },
                &stop,
            )
        };
        emit(SearchEvent {
            id,
            query,
            matches: batcher.take(),
            skipped: outcome.skipped,
            limited: outcome.limited,
            done: true,
            via_index: outcome.via_index,
        });
        Ok(outcome)
    })
    .await?;
    Ok(SearchSummary {
        id,
        hits: outcome.hits,
        skipped: outcome.skipped,
        limited: outcome.limited,
        cancelled: outcome.cancelled,
        via_index: outcome.via_index,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::PathBuf;

    /// A temp directory that deletes itself, unconditionally — a failing
    /// assert must not leave litter behind.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let mut path = std::env::temp_dir();
            path.push(format!(
                "kalsa-brain-files-{tag}-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            std::fs::create_dir_all(&path).expect("temp dir");
            Self(path)
        }

        fn write(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, contents).expect("write");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The wiring itself. This app's recorded recurring defect is code that
    /// is correct and never connected; a command missing from
    /// `generate_handler!` is dead to the page and nothing else would
    /// notice. The registration is macro input, so the source is what tells
    /// the truth — the same approach as main.rs's capability test — and the
    /// live calls prove the dependency actually reaches this file.
    #[test]
    fn the_file_commands_are_reachable_and_registered() {
        let source =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs"))
                .expect("main.rs is readable");
        let handler = source.find("generate_handler!").expect("the handler list");
        let open = handler + source[handler..].find('[').expect("the list opens");
        let close = open + source[open..].find(']').expect("the list closes");
        let registered = &source[open..close];
        for command in [
            "files::brain_files_roots",
            "files::brain_files_list",
            "files::brain_files_read",
            "files::brain_files_search",
        ] {
            assert!(
                registered.contains(command),
                "{command} is not in generate_handler! — correct code, connected to nothing"
            );
        }

        // Live calls through the dependency: unwire `kalsa-files` and this
        // stops compiling; break a command and this fails here.
        let roots = brain_files_roots();
        assert!(!roots.roots.is_empty(), "this machine has a filesystem root");
        let tree = TempDir::new("wiring");
        tree.write("notes.txt", b"hello");
        let listing = tauri::async_runtime::block_on(brain_files_list(
            tree.0.to_string_lossy().into_owned(),
        ))
        .expect("the listing command answers");
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].name, "notes.txt");
        let read = tauri::async_runtime::block_on(brain_files_read(
            tree.0.join("notes.txt").to_string_lossy().into_owned(),
        ))
        .expect("the read command answers");
        let _ = read; // ipc::Response carries the bytes; its body has no accessor
    }

    #[test]
    fn a_folder_bigger_than_the_cap_answers_truncated_through_the_command() {
        let tree = TempDir::new("cap");
        for index in 0..(kalsa_files::MAX_ROWS + 5) {
            tree.write(&format!("file-{index:04}.txt"), b"x");
        }
        let listing = tauri::async_runtime::block_on(brain_files_list(
            tree.0.to_string_lossy().into_owned(),
        ))
        .expect("the command answers");
        assert_eq!(listing.entries.len(), kalsa_files::MAX_ROWS);
        assert!(
            listing.truncated,
            "the command must carry the crate's honesty across IPC"
        );
    }

    #[test]
    fn a_file_over_the_cap_is_refused_with_its_size() {
        let tree = TempDir::new("big");
        let contents = vec![0u8; MAX_FILE_BYTES as usize + 1024];
        let big = tree.write("big.pdf", &contents);

        let error = read_capped(&big, MAX_FILE_BYTES).expect_err("over the cap");
        assert!(
            error.contains(&contents.len().to_string()),
            "the message says the actual size: {error}"
        );
        assert!(
            error.contains(&MAX_FILE_BYTES.to_string()),
            "the message says the limit: {error}"
        );

        // Under the cap the same path reads.
        let small = tree.write("small.pdf", b"%PDF-1.4 not really");
        let bytes = read_capped(&small, MAX_FILE_BYTES).expect("under the cap");
        assert_eq!(bytes, b"%PDF-1.4 not really");
    }

    /// A FIFO the page could name, inside the temp dir as required. Removed
    /// by name in its Drop — `remove_dir_all` alone would hang on it.
    #[cfg(unix)]
    struct Fifo(std::path::PathBuf);

    #[cfg(unix)]
    impl Fifo {
        fn new(dir: &std::path::Path, name: &str) -> Self {
            use std::os::unix::process::ExitStatusExt;
            let path = dir.join(name);
            let made = std::process::Command::new("mkfifo")
                .arg(&path)
                .status()
                .expect("mkfifo runs");
            assert!(
                made.success() && made.code().is_some_and(|code| code == 0),
                "mkfifo made the pipe"
            );
            Self(path)
        }
    }

    #[cfg(unix)]
    impl Drop for Fifo {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_refused_without_reading_it() {
        use std::sync::mpsc;
        use std::time::Duration;
        let tree = TempDir::new("fifo");
        let fifo = Fifo::new(&tree.0, "notes.txt");

        // The watchdog is the point: an unguarded read of a FIFO blocks
        // forever waiting for a writer, and a test without a deadline
        // would pass by hanging. The refusal itself is fast; five seconds
        // is a hundred lifetimes of it and an instant next to the hang it
        // detects.
        let path = fifo.0.clone();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(read_capped(&path, MAX_FILE_BYTES));
        });
        let answer = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("the refusal is immediate — a timeout means the read blocked");
        let error = answer.expect_err("a FIFO is not a readable file");
        assert!(
            error.contains("not a regular file"),
            "the refusal names what it refused: {error}"
        );
    }

    #[test]
    fn a_boundless_file_cannot_outgrow_the_read_budget() {
        use std::sync::mpsc;
        use std::time::Duration;

        // /dev/zero is endless and fast: the perfect stand-in for a file
        // that races past the cap while being read. A bounded reader stops
        // at max+1 bytes and refuses; an unbounded one never comes back,
        // and the watchdog turns that hang into this test's failure.
        let file = std::fs::File::open("/dev/zero").expect("dev zero exists");
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(read_bounded(file, 1024));
        });
        let bytes = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("the bounded read returns — a timeout means it read without a bound")
            .expect("reading /dev/zero does not error");
        assert_eq!(
            bytes.len(),
            1025,
            "exactly the cap plus the sentinel byte: the bound held, and the sentinel is what lets the caller see it crossed"
        );
    }

    #[test]
    fn the_read_cap_is_the_one_the_page_enforces() {
        // Two caps that disagree would truncate or admit files differently
        // depending on which side noticed first. The page's number:
        let ts = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../chat/src/lib/attachments.ts"
        ))
        .expect("attachments.ts is readable");
        assert!(
            ts.contains("export const MAX_FILE_BYTES = 32 * 1024 * 1024;"),
            "the page's cap moved; this side must move with it"
        );
        assert_eq!(MAX_FILE_BYTES, 32 * 1024 * 1024);
    }

    #[test]
    fn a_new_search_cancels_the_previous_one() {
        let searches = Searches::default();
        let first = searches.start_new();
        assert!(!first.load(Ordering::Relaxed));
        let second = searches.start_new();
        assert!(
            first.load(Ordering::Relaxed),
            "starting a search is what cancels the one before it"
        );
        assert!(!second.load(Ordering::Relaxed), "only the previous one");
    }

    #[test]
    fn the_batcher_flushes_at_its_limit_and_holds_the_rest_for_done() {
        let mut batcher = HitBatcher::new(50, Duration::from_secs(1));
        let hit = |index: usize| SearchHit {
            name: format!("hit-{index}"),
            path: format!("/x/hit-{index}"),
            is_dir: false,
            kind: kalsa_files::Kind::Other,
            score: 1,
        };
        let mut flushes = Vec::new();
        for index in 0..120 {
            if let Some(batch) = batcher.push(hit(index)) {
                flushes.push(batch);
            }
        }
        assert_eq!(flushes.len(), 2, "50 and 50 went out as they filled");
        assert_eq!(flushes[0].len(), 50);
        assert_eq!(batcher.take().len(), 20, "the tail waits for done");
        assert!(batcher.take().is_empty(), "take empties the batch");
    }
}
