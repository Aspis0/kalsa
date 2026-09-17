use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use kalsa_sentinel::{Level, Sample, Sentinel};
use serde::Serialize;

const TIMINGS_KEY: &[u8] = b"\"timings\"";
const TIMING_KEY: &[u8] = b"\"predicted_per_second\"";

/// Facts the server has actually produced. Missing data stays missing; the UI
/// is allowed to say it has not been measured yet.
pub(crate) struct RuntimeMetrics {
    started: Instant,
    state: Mutex<MetricState>,
    /// The supervisor's count of model releases the server itself announced
    /// on stderr (`--sleep-idle-seconds` firing). The supervisor owns the
    /// server process, the server owns the release decision, and this side
    /// only ever reacts to the announcement — the sentinel runs no unload
    /// clock of its own and nothing here predicts one.
    releases: Arc<AtomicU64>,
    /// How many of those announcements have been applied to the sentinel.
    applied_releases: AtomicU64,
}

struct MetricState {
    latest_decode: Option<f64>,
    sentinel: Option<Sentinel>,
}

/// One currently-busy device, as the page may see it: the owner's label for
/// it and its id. A credential, a prompt, a path, any content — none of
/// that is here, because none of it may cross this boundary.
#[derive(Clone, Serialize)]
pub(crate) struct ActiveDeviceDto {
    pub(crate) id: u32,
    pub(crate) label: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct RuntimeMetricsDto {
    pub(crate) decode_tokens_per_second: Option<f64>,
    /// Who is busy right now, as the door sees it. `None` when there is no
    /// door to ask; an empty list is the honest "nobody is using it".
    pub(crate) active_devices: Option<Vec<ActiveDeviceDto>>,
    pub(crate) throttled: Option<bool>,
}

impl RuntimeMetrics {
    pub(crate) fn new(releases: Arc<AtomicU64>) -> Self {
        Self {
            started: Instant::now(),
            state: Mutex::new(MetricState {
                latest_decode: None,
                sentinel: None,
            }),
            releases,
            applied_releases: AtomicU64::new(0),
        }
    }

    /// Applies every announced release not yet applied, before the sentinel
    /// is read or written. Both readers of the sentinel go through here, so a
    /// release reaches the guard however the next touch arrives: the page's
    /// once-a-second poll, or the first phone turn after the reload — which
    /// is the next session, and starts at full settings.
    fn apply_releases(&self) {
        let mut applied = self.applied_releases.load(Ordering::Relaxed);
        while applied < self.releases.load(Ordering::Relaxed) {
            self.note_unload();
            applied += 1;
            self.applied_releases.store(applied, Ordering::Relaxed);
        }
    }

    /// One announced model release: tells the sentinel (a double report is
    /// its own no-op) and drops the live rate the sleeping model no longer
    /// backs.
    fn note_unload(&self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(sentinel) = state.sentinel.as_mut() {
                let at = self.started.elapsed().as_secs_f64();
                let _ = sentinel.note_unload(at);
            }
            state.latest_decode = None;
        }
    }

    pub(crate) fn reset(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.latest_decode = None;
            state.sentinel = None;
        }
    }

    pub(crate) fn observe_decode(&self, tokens_per_second: f64) {
        if !tokens_per_second.is_finite() || tokens_per_second <= 0.0 {
            return;
        }
        self.apply_releases();
        if let Ok(mut state) = self.state.lock() {
            let at = self.started.elapsed().as_secs_f64();
            match state.sentinel.as_mut() {
                Some(sentinel) => {
                    let _ = sentinel.observe(Sample {
                        at,
                        tokens_per_second,
                    });
                }
                None => state.sentinel = Some(Sentinel::new(tokens_per_second, at)),
            }
            state.latest_decode = Some(tokens_per_second);
        }
    }

    pub(crate) fn snapshot(
        &self,
        active_devices: Option<Vec<ActiveDeviceDto>>,
    ) -> RuntimeMetricsDto {
        self.apply_releases();
        let (decode, throttled) = self
            .state
            .lock()
            .map(|state| {
                (
                    state.latest_decode,
                    state
                        .sentinel
                        .as_ref()
                        .map(|sentinel| sentinel.level() == Level::Degraded),
                )
            })
            .unwrap_or((None, None));
        RuntimeMetricsDto {
            decode_tokens_per_second: decode,
            active_devices,
            throttled,
        }
    }
}

/// Finds the server's timing field inside the response's `timings` object
/// without retaining a completion or slowing the streaming response. The
/// field may be split across socket writes; values outside that object are
/// deliberately ignored.
pub(crate) struct TimingScanner {
    state: ScanState,
    number: Vec<u8>,
}

enum ScanState {
    SearchingTimings(usize),
    TimingsColon,
    TimingsObject,
    SearchingTiming { depth: usize, index: usize },
    TimingColon { depth: usize },
    Value { depth: usize },
    Number { depth: usize },
}

impl TimingScanner {
    pub(crate) fn new() -> Self {
        Self {
            state: ScanState::SearchingTimings(0),
            number: Vec::with_capacity(24),
        }
    }

    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Option<f64> {
        let mut found = None;
        for &byte in bytes {
            if let Some(value) = self.feed_byte(byte) {
                found = Some(value);
            }
        }
        found
    }

    fn feed_byte(&mut self, byte: u8) -> Option<f64> {
        match self.state {
            ScanState::SearchingTimings(index) => {
                if byte == TIMINGS_KEY[index] {
                    let next = index + 1;
                    self.state = if next == TIMINGS_KEY.len() {
                        ScanState::TimingsColon
                    } else {
                        ScanState::SearchingTimings(next)
                    };
                } else {
                    self.state = ScanState::SearchingTimings(usize::from(byte == TIMINGS_KEY[0]));
                }
            }
            ScanState::TimingsColon => {
                if byte == b':' {
                    self.state = ScanState::TimingsObject;
                } else if !byte.is_ascii_whitespace() {
                    self.restart_timings(byte);
                }
            }
            ScanState::TimingsObject => {
                if byte == b'{' {
                    self.state = ScanState::SearchingTiming { depth: 1, index: 0 };
                } else if !byte.is_ascii_whitespace() {
                    self.restart_timings(byte);
                }
            }
            ScanState::SearchingTiming { depth, index } => {
                if byte == b'{' {
                    self.state = ScanState::SearchingTiming {
                        depth: depth + 1,
                        index: 0,
                    };
                } else if byte == b'}' {
                    if depth == 1 {
                        self.restart_timings(byte);
                    } else {
                        self.state = ScanState::SearchingTiming {
                            depth: depth - 1,
                            index: 0,
                        };
                    }
                } else if depth == 1 && byte == TIMING_KEY[index] {
                    let next = index + 1;
                    self.state = if next == TIMING_KEY.len() {
                        ScanState::TimingColon { depth }
                    } else {
                        ScanState::SearchingTiming { depth, index: next }
                    };
                } else if depth == 1 {
                    self.state = ScanState::SearchingTiming {
                        depth,
                        index: usize::from(byte == TIMING_KEY[0]),
                    };
                }
            }
            ScanState::TimingColon { depth } => {
                if byte == b':' {
                    self.state = ScanState::Value { depth };
                } else if !byte.is_ascii_whitespace() {
                    self.state = ScanState::SearchingTiming { depth, index: 0 };
                }
            }
            ScanState::Value { depth } => {
                if byte.is_ascii_whitespace() {
                    return None;
                }
                if byte == b'-' || byte.is_ascii_digit() {
                    self.number.clear();
                    self.number.push(byte);
                    self.state = ScanState::Number { depth };
                } else {
                    self.state = ScanState::SearchingTiming { depth, index: 0 };
                }
            }
            ScanState::Number { depth } => {
                if byte.is_ascii_digit() || matches!(byte, b'.' | b'e' | b'E' | b'+' | b'-') {
                    if self.number.len() < 32 {
                        self.number.push(byte);
                    }
                } else {
                    let value = std::str::from_utf8(&self.number)
                        .ok()
                        .and_then(|number| number.parse::<f64>().ok())
                        .filter(|value| value.is_finite() && *value > 0.0);
                    self.state = ScanState::SearchingTiming { depth, index: 0 };
                    if value.is_some() {
                        return value;
                    }
                }
            }
        }
        None
    }

    fn restart_timings(&mut self, byte: u8) {
        self.number.clear();
        self.state = ScanState::SearchingTimings(usize::from(byte == TIMINGS_KEY[0]));
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    use super::{RuntimeMetrics, TimingScanner};

    fn metrics() -> (RuntimeMetrics, Arc<AtomicU64>) {
        let releases = Arc::new(AtomicU64::new(0));
        (RuntimeMetrics::new(Arc::clone(&releases)), releases)
    }

    #[test]
    fn an_announced_release_clears_the_rate_the_page_would_show() {
        // The server announced a release and no phone turn has happened yet:
        // the page's once-a-second poll alone must apply it, so the UI stops
        // quoting a rate the sleeping model no longer backs.
        let (metrics, releases) = metrics();
        metrics.observe_decode(12.0);
        releases.fetch_add(1, Ordering::Relaxed);
        let snapshot = metrics.snapshot(None);
        assert_eq!(snapshot.decode_tokens_per_second, None);
    }

    #[test]
    fn the_first_turn_after_a_release_opens_a_fresh_session() {
        // Decay announced, then the model reloads on demand: the first turn
        // is measured against a fresh baseline at full settings, not against
        // the eased rung the release threw away.
        let (metrics, releases) = metrics();
        metrics.observe_decode(12.0);
        releases.fetch_add(1, Ordering::Relaxed);
        metrics.observe_decode(12.0);
        let snapshot = metrics.snapshot(None);
        assert_eq!(snapshot.decode_tokens_per_second, Some(12.0));
        assert_eq!(snapshot.throttled, Some(false));
    }

    #[test]
    fn a_release_before_any_measurement_is_applied_without_a_sentinel() {
        // The model can be released before its first measured turn (a start
        // nobody used, then the idle clock fired). The announcement still
        // counts as applied; nothing panics, nothing is invented.
        let (metrics, releases) = metrics();
        releases.fetch_add(1, Ordering::Relaxed);
        let snapshot = metrics.snapshot(None);
        assert_eq!(snapshot.decode_tokens_per_second, None);
        assert_eq!(snapshot.throttled, None);
        metrics.observe_decode(12.0);
        assert_eq!(
            metrics.snapshot(None).decode_tokens_per_second,
            Some(12.0)
        );
    }

    #[test]
    fn timing_can_cross_response_chunks() {
        let mut scanner = TimingScanner::new();
        assert_eq!(scanner.feed(br#"{"timings":{"predicted_per_"#), None);
        assert_eq!(scanner.feed(br#"second": 12.5}}"#), Some(12.5));
    }

    #[test]
    fn malformed_or_zero_timing_is_not_measurement() {
        let mut scanner = TimingScanner::new();
        assert_eq!(scanner.feed(br#"{"predicted_per_second":0}"#), None);
        let mut scanner = TimingScanner::new();
        assert_eq!(
            scanner.feed(br#"{"timings":{"predicted_per_second":"secret"}}"#),
            None
        );
    }

    #[test]
    fn timing_uses_the_latest_value_in_one_response_chunk() {
        let mut scanner = TimingScanner::new();
        assert_eq!(
            scanner.feed(
                br#"{"timings":{"predicted_per_second":8.0}}{"timings":{"predicted_per_second":12.0}}"#
            ),
            Some(12.0)
        );
    }

    #[test]
    fn a_timing_key_outside_the_timings_object_is_ignored() {
        let mut scanner = TimingScanner::new();
        assert_eq!(
            scanner.feed(br#"{"content":{"predicted_per_second":99.0},"timings":{"other":1}}"#),
            None
        );
    }
}
