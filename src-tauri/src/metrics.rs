use std::sync::Mutex;
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
}

struct MetricState {
    latest_decode: Option<f64>,
    sentinel: Option<Sentinel>,
}

#[derive(Clone, Serialize)]
pub(crate) struct RuntimeMetricsDto {
    pub(crate) decode_tokens_per_second: Option<f64>,
    pub(crate) phone_connected: Option<bool>,
    pub(crate) throttled: Option<bool>,
}

impl RuntimeMetrics {
    pub(crate) fn new() -> Self {
        Self {
            started: Instant::now(),
            state: Mutex::new(MetricState {
                latest_decode: None,
                sentinel: None,
            }),
        }
    }

    pub(crate) fn note_unload(&self) -> bool {
        if let Ok(mut state) = self.state.lock() {
            let notified = state.sentinel.as_mut().is_some_and(|sentinel| {
                let at = self.started.elapsed().as_secs_f64();
                sentinel.note_unload(at).is_some()
            });
            state.latest_decode = None;
            return notified;
        }
        false
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

    pub(crate) fn snapshot(&self, phone_connected: Option<bool>) -> RuntimeMetricsDto {
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
            phone_connected,
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
    use super::{RuntimeMetrics, TimingScanner};

    #[test]
    fn unloading_notifies_the_sentinel_and_clears_the_live_rate() {
        let metrics = RuntimeMetrics::new();
        metrics.observe_decode(12.0);
        assert!(metrics.note_unload());
        let snapshot = metrics.snapshot(None);
        assert_eq!(snapshot.decode_tokens_per_second, None);
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
