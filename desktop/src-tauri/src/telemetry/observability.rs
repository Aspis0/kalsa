//! The one place a telemetry line is said.
//!
//! A release build writes the log facade and nothing else. Under test the
//! line is also kept in a bounded ring: the facade allows one logger per
//! process, and the app's own tests install theirs first, so a test that
//! captured the facade would pass or fail on whichever test ran first. The
//! ring is the capture that works whatever logger won — and it is bounded,
//! so a day offline cannot grow it.

#[cfg(test)]
use std::collections::VecDeque;
#[cfg(test)]
use std::sync::Mutex;

/// One line said. The level is the facade's; the line itself is all a test
/// reads back — release builds write the facade alone and keep nothing.
pub(super) fn say(level: log::Level, line: String) {
    match level {
        log::Level::Warn => log::warn!("{line}"),
        _ => log::info!("{line}"),
    }
    #[cfg(test)]
    {
        let thread = std::thread::current().name().unwrap_or_default().to_string();
        if let Ok(mut said) = SAID.lock() {
            said.push_back((thread, line));
            while said.len() > KEPT {
                said.pop_front();
            }
        }
    }
}

/// How many of the newest lines the ring keeps.
#[cfg(test)]
const KEPT: usize = 64;

/// The newest lines said, each with the thread that said it.
#[cfg(test)]
static SAID: Mutex<VecDeque<(String, String)>> = Mutex::new(VecDeque::new());

/// The lines this test's thread has said, oldest first. The tests run in
/// parallel and share the ring, so a test reads only its own thread's.
#[cfg(test)]
pub(super) fn mine() -> Vec<String> {
    let thread = std::thread::current().name().unwrap_or_default().to_string();
    SAID.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .filter(|(writer, _)| *writer == thread)
        .map(|(_, line)| line.clone())
        .collect()
}
