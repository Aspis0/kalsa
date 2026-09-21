//! The disk tier's tick: the app's own thread, not the webview's.
//!
//! The tier writes a slot out once it has been quiet long enough, and that clock
//! is asked for by nobody: no client request carries it, no head asks for it, and
//! no window has to be open for it. The webview's store poll was the wrong owner
//! — it stops with the last listener, and WebKit throttles it when the window is
//! occluded or the process takes an App Nap, which is exactly the case this timer
//! exists for: a phone chatting while the desktop window is an icon. So the tick
//! is Rust's, on a thread of its own; the webview's poll only reads state.
//!
//! What it is not: the interval. The door holds that one — the unload clock
//! divided by three, from the launch record (`kalsa_launch::idle_save_seconds`)
//! — and decides per slot. This only says how often anybody asks, and the caller
//! gives it an instant so the door's decision reads one clock and not two.

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// How often the tier looks at its slots. Short next to the shortest interval
/// the panel can set — a 60 s unload clock is 20 s of quiet — and it is the rate
/// the webview's store poll ran at, kept so the tick's rate is not a new number.
pub const PERIOD: Duration = Duration::from_secs(1);

/// A thread running `tick` every `period`, independent of every webview.
pub struct Ticker {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Ticker {
    /// Starts the tick. `Err` is the thread that could not be spawned, which is
    /// the caller's to report: without it the tier still saves on a switch and
    /// never on a timer.
    pub fn start<F>(period: Duration, tick: F) -> io::Result<Self>
    where
        F: Fn() + Send + 'static,
    {
        let stop = Arc::new(AtomicBool::new(false));
        let running = Arc::clone(&stop);
        let handle = thread::Builder::new()
            .name("kalsa-disk-tier-tick".into())
            .spawn(move || {
                while !running.load(Ordering::SeqCst) {
                    thread::sleep(period);
                    if running.load(Ordering::SeqCst) {
                        break;
                    }
                    tick();
                }
            })?;
        Ok(Self {
            stop,
            handle: Some(handle),
        })
    }
}

impl Drop for Ticker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Deliberately not joined: one tick can be inside an engine call held for
        // the door's patience of ten seconds, and the app is on its way out — a
        // quit that waits that long would be the freeze this thread was moved
        // here to stop. The thread sees the flag, finishes what it is doing and
        // goes; the handle is dropped with it.
        self.handle.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::time::Instant;

    /// The property the webview's poll could not give: the tick runs with no
    /// listener, no window and no command behind it.
    #[test]
    fn the_tick_runs_with_nothing_asking_for_it() {
        let ticks = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&ticks);
        let ticker = Ticker::start(Duration::from_millis(5), move || {
            counted.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while ticks.load(Ordering::SeqCst) < 3 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(1));
        }
        assert!(
            ticks.load(Ordering::SeqCst) >= 3,
            "the tick ran {} times with nobody listening",
            ticks.load(Ordering::SeqCst)
        );
        drop(ticker);
    }
}
