//! Whether the machine is sustaining its baseline, has decayed, or has
//! recovered — decided from the throughput samples alone.
//!
//! The baseline is an input, not a measurement: it is what the machine did
//! when it was cool and idle, and every verdict here is a ratio against the
//! *anchor*, the throughput the machine is currently expected to sustain. Two
//! gates stand between a slow turn and a verdict, because a single slow turn
//! is a user opening a browser, not a thermal problem:
//!
//! * **magnitude** — a sample only counts against the machine below
//!   `DEGRADE_RATIO` of the anchor, and only *for* the machine at or above
//!   `RECOVER_RATIO`. The band between the lines is deliberately wide: a
//!   machine hovering inside it moves nothing, in either direction, for as
//!   long as it hovers.
//! * **persistence** — no verdict until one side of its line has been seen on
//!   several *consecutive* real turns spanning minutes. A streak is broken by
//!   a single in-band sample, by an idle gap long enough for the package to
//!   cool, and by the verdict it was building toward.
//!
//! The two lines are not symmetric on purpose. `DEGRADE_RATIO` and
//! `RECOVER_RATIO` differ, so the machine must climb out of the band to be
//! declared recovered — declaring both states at one line would oscillate on
//! the boundary. Recovery is also claimed on more evidence than decay
//! (`RECOVER_AFTER_SAMPLES` > `DEGRADE_AFTER_SAMPLES`), because the safe
//! error is staying gentle a few turns longer, never easing up on a lucky
//! turn.
//!
//! The anchor follows the machine **down**: when a decay is declared it
//! re-anchors to the median of the collapse, because the collapse is the best
//! measurement we have of what the machine now sustains. Without that, a
//! machine that sank to 0.6 would be judged against its old baseline forever,
//! the ladder would sink to its floor on stale arithmetic, and recovery would
//! be unreachable. The anchor never moves up: capacity lost is re-measured at
//! once, capacity regained is proven one rung at a time by the recovery
//! streaks themselves. Only a fresh session — an unload — returns to the true
//! baseline.

use crate::sample::Sample;

/// A turn only counts against the machine below this fraction of the anchor.
///
/// Thermal throttling on a machine with degraded cooling typically costs a
/// quarter to a half of sustained decode throughput; ordinary interference —
/// a browser, a sync client — drags single turns by tens of percent but does
/// not survive the persistence gate. 0.75 sits below the sustained drag of
/// any plausible co-tenant and above the deep collapse of real throttling.
pub const DEGRADE_RATIO: f64 = 0.75;

/// Recovery is declared only at or above this fraction of the anchor.
///
/// The fifteen-point gap to `DEGRADE_RATIO` is the hysteresis: between the
/// lines is *holding*, and no verdict fires there, so a machine hovering on
/// the boundary cannot flip state turn after turn. The gap is also wider than
/// the throughput cost of stepping one rung gentler, so a back-off does not
/// read as recovery the moment it lands.
pub const RECOVER_RATIO: f64 = 0.90;

/// Consecutive below-line turns needed to declare decay.
///
/// One slow turn is a browser; two is a burst. Three successive real turns
/// all a quarter down is a machine that changed — turns come from real usage
/// minutes apart, so this is persistence over a stretch of the afternoon, not
/// a benchmark hiccup.
pub const DEGRADE_AFTER_SAMPLES: usize = 3;

/// Consecutive at-or-above-line turns needed to declare recovery: more
/// evidence than decay needs, because easing the machine back up is the one
/// direction where a wrong call costs heat.
pub const RECOVER_AFTER_SAMPLES: usize = 4;

/// A decay or recovery streak must span at least this many seconds from its
/// first to its last turn.
///
/// A copy-paste session can fire three short turns in twenty seconds; a real
/// thermal state persists for minutes. Without this gate, three rapid turns
/// during a co-tenant burst would escalate the ladder over a load the machine
/// was never asked to sustain.
pub const MINIMUM_STREAK_SPAN_SECONDS: f64 = 90.0;

/// A gap between consecutive turns longer than this breaks a streak.
///
/// Evidence has a shelf life: five idle minutes between turns is long enough
/// for the package to cool and for the user's context to change, so a slow
/// turn from before the gap is not the same episode as a slow turn after it.
/// The budget stays below `UNLOAD_AFTER_SECONDS` — the machine may still be
/// loaded — but past it, "consecutive turns" no longer means "one sustained
/// state".
pub const STREAK_GAP_SECONDS: f64 = 300.0;

/// The detector's summary of the machine, as of the last verdict.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// The machine is holding its anchor.
    Sustaining,
    /// A decay has been declared and not yet recovered from.
    Degraded,
}

/// A persistence gate that opened. The ladder answers these; the detector
/// only swears to them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    SustainedDecay,
    SustainedRecovery,
}

/// One side of the hysteresis: the consecutive samples gathered on that side
/// of the line, and when the run started.
struct Streak {
    first_at: f64,
    samples: Vec<f64>,
}

impl Streak {
    fn new() -> Self {
        Self {
            first_at: 0.0,
            samples: Vec::new(),
        }
    }

    fn extend(&mut self, at: f64, tokens_per_second: f64) {
        if self.samples.is_empty() {
            self.first_at = at;
        }
        self.samples.push(tokens_per_second);
    }

    /// A streak confirms when it has enough *consecutive* turns and they
    /// span enough *time*: count without span is a burst, span without count
    /// is one slow turn an hour apart. Both are noise; neither declares.
    fn confirmed(&self, at: f64, needed: usize) -> bool {
        self.samples.len() >= needed && at - self.first_at >= MINIMUM_STREAK_SPAN_SECONDS
    }

    fn reset(&mut self) {
        self.samples.clear();
    }
}

pub(crate) struct Detector {
    baseline: f64,
    anchor: f64,
    level: Level,
    low: Streak,
    high: Streak,
    last_sample_at: Option<f64>,
}

impl Detector {
    /// A detector handed a fake baseline would compute ratios against
    /// nonsense and silently never fire — worse than refusing to start.
    ///
    /// # Panics
    /// If the baseline is zero, negative or not a number.
    pub(crate) fn new(baseline_tokens_per_second: f64) -> Self {
        assert!(
            baseline_tokens_per_second.is_finite() && baseline_tokens_per_second > 0.0,
            "the baseline is what every ratio is taken against; it must be a real measurement"
        );
        Self {
            baseline: baseline_tokens_per_second,
            anchor: baseline_tokens_per_second,
            level: Level::Sustaining,
            low: Streak::new(),
            high: Streak::new(),
            last_sample_at: None,
        }
    }

    pub(crate) fn level(&self) -> Level {
        self.level
    }

    /// A fresh session: the anchor returns to the documented baseline and the
    /// machine is presumed sustaining until the samples say otherwise.
    pub(crate) fn reset(&mut self) {
        self.anchor = self.baseline;
        self.level = Level::Sustaining;
        self.low.reset();
        self.high.reset();
        self.last_sample_at = None;
    }

    /// Feed one *measured* sample — broken ones are filtered upstream, in
    /// [`Sample::is_measured`]. Returns the verdict whose persistence gate
    /// opened on this sample, if any. Repeated decay re-verdicts while the
    /// machine keeps sinking: that is what lets the ladder follow a collapse
    /// down more than one rung.
    pub(crate) fn observe(&mut self, sample: &Sample) -> Option<Verdict> {
        // Evidence does not cross a long idle gap: whatever the turns on
        // either side of it say, they are not one sustained state.
        if let Some(previous_at) = self.last_sample_at {
            if sample.at - previous_at > STREAK_GAP_SECONDS {
                self.low.reset();
                self.high.reset();
            }
        }
        self.last_sample_at = Some(sample.at);

        let verdict = if sample.tokens_per_second < self.anchor * DEGRADE_RATIO {
            self.high.reset();
            self.low.extend(sample.at, sample.tokens_per_second);
            if self.low.confirmed(sample.at, DEGRADE_AFTER_SAMPLES) {
                // The collapse is the best measurement of what the machine
                // now sustains: re-anchor to its median before answering.
                // The median, not the mean, so one interrupted turn among
                // the evidence cannot set the line.
                self.anchor = median(&self.low.samples);
                Some(Verdict::SustainedDecay)
            } else {
                None
            }
        } else if sample.tokens_per_second >= self.anchor * RECOVER_RATIO {
            self.low.reset();
            self.high.extend(sample.at, sample.tokens_per_second);
            // Recovery is only sworn from Degraded: a machine that was never
            // eased cannot recover from nothing, and at full settings the
            // ladder has no rung to give back — that verdict would be noise.
            if self.level == Level::Degraded
                && self.high.confirmed(sample.at, RECOVER_AFTER_SAMPLES)
            {
                // The anchor stays where the machine sank to: the true
                // baseline returns only with a fresh session.
                Some(Verdict::SustainedRecovery)
            } else {
                None
            }
        } else {
            // Between the lines: evidence against both directions at once.
            // This band is the hysteresis, and hovering in it moves nothing.
            self.low.reset();
            self.high.reset();
            None
        };

        if verdict.is_some() {
            self.level = match verdict {
                Some(Verdict::SustainedDecay) => Level::Degraded,
                _ => Level::Sustaining,
            };
            // The verdict is made of this evidence; the next one needs its
            // own.
            self.low.reset();
            self.high.reset();
        }
        verdict
    }
}

/// The median of a non-empty slice; call sites guarantee the streak has
/// samples.
fn median(samples: &[f64]) -> f64 {
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let middle = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASELINE: f64 = 20.0;

    fn s(at: f64, ratio: f64) -> Sample {
        Sample {
            at,
            tokens_per_second: BASELINE * ratio,
        }
    }

    #[test]
    fn a_steady_machine_never_verdicts() {
        let mut detector = Detector::new(BASELINE);
        for i in 0..8 {
            assert_eq!(detector.observe(&s(i as f64 * 120.0, 1.0)), None);
        }
        assert_eq!(detector.level(), Level::Sustaining);
    }

    #[test]
    fn three_collapsed_turns_spanning_minutes_are_decay() {
        let mut detector = Detector::new(BASELINE);
        assert_eq!(detector.observe(&s(0.0, 1.0)), None);
        assert_eq!(detector.observe(&s(120.0, 0.4)), None);
        assert_eq!(detector.observe(&s(240.0, 0.4)), None);
        assert_eq!(
            detector.observe(&s(360.0, 0.4)),
            Some(Verdict::SustainedDecay)
        );
        assert_eq!(detector.level(), Level::Degraded);
    }

    #[test]
    fn recovery_is_judged_against_where_the_machine_sank_to() {
        let mut detector = Detector::new(BASELINE);
        assert_eq!(detector.observe(&s(0.0, 1.0)), None);
        assert_eq!(detector.observe(&s(120.0, 0.4)), None);
        assert_eq!(detector.observe(&s(240.0, 0.4)), None);
        assert_eq!(
            detector.observe(&s(360.0, 0.4)),
            Some(Verdict::SustainedDecay)
        );
        // 9.0 tok/s is deep decay against the baseline of 20 and recovery
        // against the anchor of 8 the collapse re-anchored to: the verdict
        // says which quantity is in force.
        for t in [480.0, 600.0, 720.0] {
            assert_eq!(detector.observe(&s(t, 0.45)), None);
        }
        assert_eq!(
            detector.observe(&s(840.0, 0.45)),
            Some(Verdict::SustainedRecovery)
        );
        // And the anchor never moved up: 6.4 tok/s is between the lines of
        // the anchor of 8, so it is holding — judged against a baseline or a
        // raised anchor it would build a decay streak and re-verdict.
        for t in [960.0, 1080.0, 1200.0, 1320.0, 1440.0] {
            assert_eq!(detector.observe(&s(t, 0.32)), None);
        }
    }

    #[test]
    fn a_sample_between_the_lines_is_evidence_against_both() {
        let mut detector = Detector::new(BASELINE);
        assert_eq!(detector.observe(&s(0.0, 1.0)), None);
        assert_eq!(detector.observe(&s(120.0, 0.4)), None);
        assert_eq!(detector.observe(&s(240.0, 0.4)), None);
        // In the band: the low streak is gone, and the count starts over.
        assert_eq!(detector.observe(&s(360.0, 0.8)), None);
        assert_eq!(detector.observe(&s(480.0, 0.4)), None);
        assert_eq!(detector.observe(&s(600.0, 0.4)), None);
        assert_eq!(
            detector.observe(&s(720.0, 0.4)),
            Some(Verdict::SustainedDecay)
        );
    }

    #[test]
    fn evidence_does_not_cross_a_long_idle_gap() {
        let mut detector = Detector::new(BASELINE);
        assert_eq!(detector.observe(&s(0.0, 0.4)), None);
        assert_eq!(detector.observe(&s(120.0, 0.4)), None);
        // A twenty-minute gap: long enough to cool, so the third slow turn
        // is a new episode, not the third of three.
        assert_eq!(detector.observe(&s(1320.0, 0.4)), None);
        assert_eq!(detector.observe(&s(1440.0, 0.4)), None);
        assert_eq!(
            detector.observe(&s(1560.0, 0.4)),
            Some(Verdict::SustainedDecay)
        );
    }
}
