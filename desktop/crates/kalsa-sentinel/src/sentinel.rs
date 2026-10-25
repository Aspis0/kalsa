//! The sentinel itself: samples in, decisions and announcements out.
//!
//! It ties the detector's verdicts to the ladder's rungs, and it is the only
//! type a caller needs. Everything is driven from outside: [`Sentinel::observe`]
//! for a finished turn's throughput, [`Sentinel::note_unload`] for the
//! server owner reporting the model released. Nothing here reads a
//! clock, opens a socket or touches a process — the caller who owns the
//! server acts on the [`Event`]s.

use crate::detector::{Detector, Level, Verdict};
use crate::event::Event;
use crate::ladder::{Ladder, Step};
use crate::sample::Sample;

/// The sustainability guard for one loaded model on one machine.
pub struct Sentinel {
    loaded: bool,
    last_activity: f64,
    detector: Detector,
    ladder: Ladder,
    floor_announced: bool,
}

impl Sentinel {
    /// A sentinel for a model just loaded at `started_at`, to run at the
    /// machine's documented baseline. The baseline is what the machine did
    /// when it was cool and idle — a real measurement, not a hope: every
    /// verdict is a ratio against it, and a sentinel handed a fake one would
    /// silently guard nothing.
    ///
    /// # Panics
    /// If the baseline is zero, negative or not a number.
    pub fn new(baseline_tokens_per_second: f64, started_at: f64) -> Self {
        Self {
            loaded: true,
            last_activity: started_at,
            detector: Detector::new(baseline_tokens_per_second),
            ladder: Ladder::new(),
            floor_announced: false,
        }
    }

    /// The rung the model is currently eased to.
    pub fn step(&self) -> Step {
        self.ladder.step()
    }

    /// The detector's summary of the machine.
    pub fn level(&self) -> Level {
        self.detector.level()
    }

    /// One finished turn's throughput. Returns the events this turn earned:
    /// usually none, sometimes one, never a silent state change.
    ///
    /// The first sample after an [`Event::Unload`] *is* the reload — the
    /// model loads on demand, and the caller says so by simply feeding the
    /// next turn. A long idle gap between samples also breaks any decay
    /// streak inside the detector: evidence does not survive a cooling-off
    /// period.
    pub fn observe(&mut self, sample: Sample) -> Vec<Event> {
        let mut events = Vec::new();
        if !self.loaded {
            // Reloaded on demand. Ladder, anchor and level were reset at the
            // unload; the next few turns re-prove the machine from scratch,
            // and every transition on the way is announced.
            self.loaded = true;
        }
        if sample.at < self.last_activity {
            // A sample from before the previous one would lie to the idle
            // clock and to the streaks at the same time. Dropped whole.
            return events;
        }
        self.last_activity = sample.at;
        if !sample.is_measured() {
            // The turn happened — the machine was in use — but it says
            // nothing about what the machine can sustain: it neither builds
            // nor breaks a streak.
            return events;
        }
        match self.detector.observe(&sample) {
            Some(Verdict::SustainedDecay) => match self.ladder.gentler() {
                Some((from, to)) => events.push(Event::BackedOff { from, to }),
                None => {
                    // The ladder is at its floor and the machine still sank
                    // below its anchor: say so once, then hold the line —
                    // repeating it every confirming turn would be the noise
                    // this crate exists to refuse.
                    if !self.floor_announced {
                        self.floor_announced = true;
                        events.push(Event::Exhausted {
                            at: self.ladder.step(),
                        });
                    }
                }
            },
            Some(Verdict::SustainedRecovery) => {
                self.floor_announced = false;
                if let Some((from, to)) = self.ladder.fuller() {
                    events.push(Event::Restored { from, to });
                }
            }
            None => {}
        }
        events
    }

    /// The server's owner saw the model released: record it and reset for a
    /// fresh session. The sentinel runs no unload clock of its own — the
    /// server's `--sleep-idle-seconds` is the only one, and a second clock
    /// here could only disagree about when the release happened — so idle
    /// time alone never releases anything; only this call does. Returns the
    /// announcement, or nothing when the model was already released (a
    /// double report is the owner's bookkeeping slipping, not a second
    /// release).
    ///
    /// Release is also a reset: the idle time before the report was the
    /// machine's chance to cool, so the next session starts at full settings
    /// and the detector re-learns from live samples. Three slow turns will
    /// re-ease it if the optimism was wrong, and every step down is
    /// announced — a reset must never be a silent downgrade.
    pub fn note_unload(&mut self, now: f64) -> Option<Event> {
        if !self.loaded {
            return None;
        }
        let event = Event::Unload {
            idle_seconds: (now - self.last_activity).max(0.0),
            from: self.ladder.step(),
        };
        self.loaded = false;
        self.ladder.reset();
        self.detector.reset();
        self.floor_announced = false;
        Some(event)
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

    fn sentinel() -> Sentinel {
        Sentinel::new(BASELINE, 0.0)
    }

    /// The cliff every recovery test starts from: three healthy turns, then
    /// the machine collapses to 40% and is eased one rung on the third.
    fn cliff_to_fewer_threads(sentinel: &mut Sentinel) {
        for i in 0..3 {
            assert!(sentinel.observe(s(i as f64 * 120.0, 1.0)).is_empty());
        }
        assert!(sentinel.observe(s(360.0, 0.4)).is_empty());
        assert!(sentinel.observe(s(480.0, 0.4)).is_empty());
        assert_eq!(
            sentinel.observe(s(600.0, 0.4)),
            vec![Event::BackedOff {
                from: Step::Full,
                to: Step::FewerThreads
            }]
        );
    }

    #[test]
    fn a_steady_machine_never_moves_anything() {
        let mut sentinel = sentinel();
        for i in 0..12 {
            assert!(sentinel.observe(s(i as f64 * 120.0, 1.0)).is_empty());
        }
        assert_eq!(sentinel.step(), Step::Full);
        assert_eq!(sentinel.level(), Level::Sustaining);
    }

    #[test]
    fn one_slow_turn_is_a_browser_not_a_thermal_state() {
        let mut sentinel = sentinel();
        for i in 0..3 {
            assert!(sentinel.observe(s(i as f64 * 120.0, 1.0)).is_empty());
        }
        assert!(sentinel.observe(s(360.0, 0.5)).is_empty());
        assert!(sentinel.observe(s(480.0, 1.0)).is_empty());
        assert!(sentinel.observe(s(600.0, 0.5)).is_empty());
        assert!(sentinel.observe(s(720.0, 1.0)).is_empty());
        assert!(sentinel.observe(s(840.0, 1.0)).is_empty());
        assert_eq!(sentinel.step(), Step::Full);
    }

    #[test]
    fn a_gradual_slide_declares_itself_once_it_persists() {
        let mut sentinel = sentinel();
        let slide = [1.0, 0.95, 0.9, 0.85, 0.8, 0.74, 0.7];
        for (i, ratio) in slide.iter().enumerate() {
            assert!(sentinel.observe(s(i as f64 * 120.0, *ratio)).is_empty());
        }
        // The slide crosses the line at 0.74 and the third consecutive turn
        // below it closes the case.
        assert_eq!(
            sentinel.observe(s(840.0, 0.66)),
            vec![Event::BackedOff {
                from: Step::Full,
                to: Step::FewerThreads
            }]
        );
        assert_eq!(sentinel.level(), Level::Degraded);
        // Declared once: the slide continuing does not re-announce while the
        // evidence is still only one turn deep past the verdict.
        assert!(sentinel.observe(s(960.0, 0.6)).is_empty());
    }

    #[test]
    fn a_cliff_backs_off_on_the_third_turn_and_not_before() {
        let mut sentinel = sentinel();
        for i in 0..3 {
            assert!(sentinel.observe(s(i as f64 * 120.0, 1.0)).is_empty());
        }
        assert!(sentinel.observe(s(360.0, 0.4)).is_empty());
        assert!(sentinel.observe(s(480.0, 0.4)).is_empty());
        assert_eq!(
            sentinel.observe(s(600.0, 0.4)),
            vec![Event::BackedOff {
                from: Step::Full,
                to: Step::FewerThreads
            }]
        );
    }

    #[test]
    fn recovery_gives_the_rung_back_after_four_good_turns() {
        let mut sentinel = sentinel();
        cliff_to_fewer_threads(&mut sentinel);
        // The machine cools while eased: good turns at the gentler rung.
        for t in [720.0, 840.0, 960.0] {
            assert!(sentinel.observe(s(t, 1.0)).is_empty());
        }
        assert_eq!(
            sentinel.observe(s(1080.0, 1.0)),
            vec![Event::Restored {
                from: Step::FewerThreads,
                to: Step::Full
            }]
        );
        assert_eq!(sentinel.level(), Level::Sustaining);
    }

    #[test]
    fn the_band_between_the_lines_holds_no_matter_how_long_it_lasts() {
        let mut sentinel = sentinel();
        cliff_to_fewer_threads(&mut sentinel);
        // 82% of the anchor of 8 tok/s sits between the two lines: holding,
        // not decaying, not recovering — for half an hour of hovering.
        for i in 0..15 {
            assert!(sentinel
                .observe(s(720.0 + i as f64 * 120.0, 0.328))
                .is_empty());
        }
        assert_eq!(sentinel.step(), Step::FewerThreads);
    }

    #[test]
    fn a_noisy_machine_never_moves_the_ladder() {
        let mut sentinel = sentinel();
        // A co-tenant coming and going every other turn.
        for i in 0..20 {
            let ratio = if i % 2 == 0 { 1.0 } else { 0.5 };
            assert!(sentinel.observe(s(i as f64 * 120.0, ratio)).is_empty());
        }
        // Jitter entirely above the degrade line moves nothing either.
        for i in 20..40 {
            let ratio = if i % 2 == 0 { 0.95 } else { 1.05 };
            assert!(sentinel.observe(s(i as f64 * 120.0, ratio)).is_empty());
        }
        assert_eq!(sentinel.step(), Step::Full);
    }

    #[test]
    fn three_quick_turns_in_a_burst_are_not_sustained_decay() {
        let mut sentinel = sentinel();
        // A copy-paste session during a co-tenant burst: slow turns half a
        // minute apart. Three of them are count, not persistence.
        for t in [0.0, 30.0, 60.0] {
            assert!(sentinel.observe(s(t, 0.4)).is_empty());
        }
        // The same decay stretched over minutes is the real thing.
        assert_eq!(
            sentinel.observe(s(90.0, 0.4)),
            vec![Event::BackedOff {
                from: Step::Full,
                to: Step::FewerThreads
            }]
        );
    }

    #[test]
    fn evidence_does_not_cross_a_long_idle_gap() {
        let mut sentinel = sentinel();
        assert!(sentinel.observe(s(0.0, 0.4)).is_empty());
        assert!(sentinel.observe(s(120.0, 0.4)).is_empty());
        // A twenty-minute reading gap between slow turns: the machine had
        // time to cool, so the third slow turn starts a new episode instead
        // of completing the old one.
        assert!(sentinel.observe(s(1320.0, 0.4)).is_empty());
        assert!(sentinel.observe(s(1440.0, 0.4)).is_empty());
        assert_eq!(sentinel.observe(s(1560.0, 0.4)).len(), 1);
    }

    #[test]
    fn a_sinking_machine_walks_the_whole_ladder_then_announces_the_floor() {
        let mut sentinel = sentinel();
        let sinking = [
            (0.0, 12.0), // Full cannot hold
            (120.0, 11.0),
            (240.0, 10.0),
            (360.0, 6.0), // FewerThreads cannot hold
            (480.0, 5.0),
            (600.0, 4.0),
            (720.0, 3.0), // SmallBatches cannot hold
            (840.0, 2.0),
            (960.0, 2.0),
            (1080.0, 1.4), // QuantisedKv cannot hold
            (1200.0, 1.0),
            (1320.0, 1.0),
            (1440.0, 0.5), // Trickle is the floor
            (1560.0, 0.5),
            (1680.0, 0.5),
        ];
        let mut events = Vec::new();
        for (at, tokens_per_second) in sinking {
            events.extend(sentinel.observe(Sample {
                at,
                tokens_per_second,
            }));
        }
        assert_eq!(sentinel.step(), Step::Trickle);
        assert_eq!(
            events,
            vec![
                Event::BackedOff {
                    from: Step::Full,
                    to: Step::FewerThreads
                },
                Event::BackedOff {
                    from: Step::FewerThreads,
                    to: Step::SmallBatches
                },
                Event::BackedOff {
                    from: Step::SmallBatches,
                    to: Step::QuantisedKv
                },
                Event::BackedOff {
                    from: Step::QuantisedKv,
                    to: Step::Trickle
                },
                Event::Exhausted { at: Step::Trickle },
            ]
        );
        // Below the floor there is nothing left to ease, and the floor is
        // announced once, not on every confirming turn.
        for (at, tokens_per_second) in [
            (1800.0, 0.4),
            (1920.0, 0.4),
            (2040.0, 0.4),
            (2160.0, 0.3),
            (2280.0, 0.3),
            (2400.0, 0.3),
        ] {
            assert!(sentinel
                .observe(Sample {
                    at,
                    tokens_per_second
                })
                .is_empty());
        }
    }

    #[test]
    fn a_reported_unload_releases_and_resets() {
        let mut sentinel = sentinel();
        assert!(sentinel.observe(s(1000.0, 1.0)).is_empty());
        assert_eq!(
            sentinel.note_unload(1600.0),
            Some(Event::Unload {
                idle_seconds: 600.0,
                from: Step::Full
            })
        );
        // A double report is the owner's bookkeeping slipping, not a second
        // release: nothing left to release.
        assert_eq!(sentinel.note_unload(2000.0), None);
    }

    #[test]
    fn a_model_loaded_but_never_used_still_gets_released() {
        let mut sentinel = sentinel();
        assert_eq!(
            sentinel.note_unload(600.0),
            Some(Event::Unload {
                idle_seconds: 600.0,
                from: Step::Full
            })
        );
    }

    #[test]
    fn time_passing_without_a_report_releases_nothing() {
        // The decision this pins: the sentinel runs no unload clock, so two
        // idle hours with no owner report change nothing — no release, no
        // reset. A second clock here could only disagree with the server's
        // own about when the model left memory.
        let mut sentinel = sentinel();
        cliff_to_fewer_threads(&mut sentinel);
        // Two hours later the next turn arrives: the gap breaks the old
        // streaks, but the machine is still eased and still Degraded — only
        // a report resets that.
        assert!(sentinel.observe(s(7800.0, 1.0)).is_empty());
        assert_eq!(sentinel.step(), Step::FewerThreads);
        assert_eq!(sentinel.level(), Level::Degraded);
        // And the guard still works: the post-gap turn starts new evidence,
        // good turns re-prove the machine and hand the rung back.
        for t in [7920.0, 8040.0] {
            assert!(sentinel.observe(s(t, 1.0)).is_empty());
        }
        assert_eq!(
            sentinel.observe(s(8160.0, 1.0)),
            vec![Event::Restored {
                from: Step::FewerThreads,
                to: Step::Full
            }]
        );
    }

    #[test]
    fn an_unload_sends_the_next_session_back_to_full() {
        let mut sentinel = sentinel();
        cliff_to_fewer_threads(&mut sentinel);
        assert_eq!(
            sentinel.note_unload(1200.0),
            Some(Event::Unload {
                idle_seconds: 600.0,
                from: Step::FewerThreads
            })
        );
        // The user comes back: the model reloads on demand and the next turn
        // is a fresh session at full settings.
        assert!(sentinel.observe(s(1300.0, 1.0)).is_empty());
        assert_eq!(sentinel.step(), Step::Full);
        assert_eq!(sentinel.level(), Level::Sustaining);
    }

    #[test]
    fn a_broken_sample_is_activity_but_not_evidence() {
        let mut sentinel = sentinel();
        assert!(sentinel.observe(s(120.0, 0.4)).is_empty());
        // A killed turn: it happened, so it refreshes the idle clock, and it
        // says nothing about the machine, so it neither builds nor breaks
        // the streak.
        assert!(sentinel
            .observe(Sample {
                at: 240.0,
                tokens_per_second: f64::NAN
            })
            .is_empty());
        assert!(sentinel.observe(s(360.0, 0.4)).is_empty());
        assert_eq!(
            sentinel.observe(s(480.0, 0.4)),
            vec![Event::BackedOff {
                from: Step::Full,
                to: Step::FewerThreads
            }]
        );
        // And the idle clock ran past the broken turn to the last real one:
        // the report 600 s later says so.
        assert_eq!(
            sentinel.note_unload(1080.0),
            Some(Event::Unload {
                idle_seconds: 600.0,
                from: Step::FewerThreads
            })
        );
    }

    #[test]
    fn a_sample_from_before_the_previous_one_is_dropped() {
        let mut sentinel = sentinel();
        assert!(sentinel.observe(s(1000.0, 1.0)).is_empty());
        // The clock went backwards: dropped whole, idle clock untouched —
        // the report still measures from the kept turn.
        assert!(sentinel.observe(s(900.0, 1.0)).is_empty());
        assert_eq!(
            sentinel.note_unload(1600.0),
            Some(Event::Unload {
                idle_seconds: 600.0,
                from: Step::Full
            })
        );
    }
}
