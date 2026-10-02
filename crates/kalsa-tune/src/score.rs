//! Which trial wins: the room's wait, not a rate. A reply re-reads the
//! history the room already holds and decodes the answer the owner waits
//! for, so the two measured rates become one number in seconds — the
//! average of a typical turn and a long history.

use kalsa_launch::Offload;

use crate::candidates::Candidate;

/// The two replies the owner waits for, averaged: a typical turn (about
/// three hundred tokens read, two hundred written) and a long history (about
/// two thousand read, two hundred written). The prompt rate pays for what is
/// read, the decode rate for what is written. The long history is also the
/// size of the room ask that measures the prompt rate (see `room.rs`).
const TURN_PROMPT_TOKENS: u64 = 300;
const TURN_REPLY_TOKENS: u64 = 200;
pub(crate) const ROOM_PROMPT_TOKENS: u64 = 2000;
const ROOM_REPLY_TOKENS: u64 = 200;

/// Trials within 5 % of the fastest reply are equal in use, so the
/// lighter launch wins — the same band the rate ranking used, now on
/// seconds: two runs of one launch differ by percents, and a trial that
/// wins by less than this has not won.
pub(crate) const TIE_BAND: f64 = 0.05;

/// What one trial measured, as the room feels it: the shape's prefill
/// rate, the trial's own decode rate, and the seconds the owner waits.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reply {
    pub prompt_rate: f64,
    pub decode_rate: f64,
    pub seconds: f64,
}

impl Reply {
    /// The reply the two rates describe, when both are measurements and
    /// the score they make is one too: nothing is invented for a rate
    /// that is not positive and finite.
    pub fn from_rates(prompt_rate: f64, decode_rate: f64) -> Option<Self> {
        if !measured(prompt_rate) || !measured(decode_rate) {
            return None;
        }
        let seconds = reply_seconds(prompt_rate, decode_rate);
        measured(seconds).then_some(Self {
            prompt_rate,
            decode_rate,
            seconds,
        })
    }
}

/// The room's own score: the mean wait of a typical turn and a long
/// history, each a prefill of what is read and a decode of what is written.
/// Lower is better.
pub fn reply_seconds(prompt_rate: f64, decode_rate: f64) -> f64 {
    let wait = |read: u64, written: u64| read as f64 / prompt_rate + written as f64 / decode_rate;
    (wait(TURN_PROMPT_TOKENS, TURN_REPLY_TOKENS) + wait(ROOM_PROMPT_TOKENS, ROOM_REPLY_TOKENS))
        / 2.0
}

/// The prefill share of the score, which no decode rate can take away: a
/// reply is never shorter than this, so a shape whose prefill alone costs
/// as much as the best complete reply cannot beat it.
pub fn prefill_seconds(prompt_rate: f64) -> f64 {
    (TURN_PROMPT_TOKENS + ROOM_PROMPT_TOKENS) as f64 / 2.0 / prompt_rate
}

/// The winner: which launch to keep, and the reply that won it — the app
/// shows the wait it chose, so the numbers travel with the choice.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Winner {
    pub candidate: Candidate,
    pub reply: Reply,
}

/// The best sample of one rate, never the mean — the probe's own rule:
/// competition can only make a sample slower, so the fastest observed run
/// is the closest thing to this setting's own speed. A rate that is not
/// positive and finite is not a measurement.
pub(crate) fn best_rate(rates: &[f64]) -> Option<f64> {
    rates
        .iter()
        .copied()
        .filter(|rate| measured(*rate))
        .reduce(f64::max)
}

/// A positive, finite number: the only shape a measurement takes.
fn measured(rate: f64) -> bool {
    rate.is_finite() && rate > 0.0
}

/// Lighter is better inside the band: the offload that puts every layer on
/// the GPU first (the GPU does the work then, though full offload does not
/// free the processor entirely), then the fewer threads — and an unknown
/// thread count ranks heaviest of all: the engine's own default may be
/// every core the machine has. The draft axis ranks last and lightest at
/// none: speculation a measurement did not clearly buy is not kept, and a
/// wider proposal loses a tie to a narrower one.
fn lightness(candidate: &Candidate) -> (u8, usize, u32) {
    // EngineFitted aims at the same place as All — every layer on the
    // card — and lets the engine confirm the count, so it ranks as the
    // fuller offload too.
    let offload_rank = u8::from(!matches!(
        candidate.offload,
        Offload::All | Offload::EngineFitted
    ));
    let thread_rank = candidate.threads.unwrap_or(usize::MAX);
    let draft_rank = candidate.draft.map_or(0, |n_max| 1 + n_max);
    (offload_rank, thread_rank, draft_rank)
}

/// The winner among the scored trials: the lowest reply time, and within
/// `TIE_BAND` of it the lightest candidate. `None` when nothing scored.
pub(crate) fn reply_winner(scored: &[(Candidate, Reply)]) -> Option<Winner> {
    let top = scored
        .iter()
        .map(|(_, reply)| reply.seconds)
        .reduce(f64::min)?;
    let mut best: Option<Winner> = None;
    for (candidate, reply) in scored {
        if reply.seconds > top * (1.0 + TIE_BAND) {
            continue;
        }
        let take = match &best {
            None => true,
            Some(current) => lightness(candidate) < lightness(&current.candidate),
        };
        if take {
            best = Some(Winner {
                candidate: *candidate,
                reply: *reply,
            });
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_runtime::ServerBackend;

    fn cpu(threads: usize) -> Candidate {
        Candidate {
            backend: ServerBackend::Cpu,
            threads: Some(threads),
            offload: Offload::NoGpuBuild,
            draft: None,
        }
    }

    fn gpu() -> Candidate {
        Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(16),
            offload: Offload::All,
            draft: None,
        }
    }

    fn reply(prompt_rate: f64, decode_rate: f64) -> Reply {
        Reply::from_rates(prompt_rate, decode_rate).expect("two measurements")
    }

    /// The score is the room's arithmetic and nothing else: the mean of a
    /// typical turn (300 read, 200 written) and a long history (2,000 read,
    /// 200 written), the reads at the prompt rate and the writes at the
    /// decode rate.
    #[test]
    fn a_reply_is_the_mean_of_a_turn_and_a_long_history() {
        let scored = reply(1000.0, 50.0);
        let turn = 0.3 + 4.0;
        let long = 2.0 + 4.0;
        assert!((scored.seconds - (turn + long) / 2.0).abs() < 1e-12, "{scored:?}");
        // The prefill share alone is the mean of the two reads.
        assert!((prefill_seconds(1000.0) - 1.15).abs() < 1e-12);
        // A rate that is not a measurement makes no reply.
        assert_eq!(Reply::from_rates(0.0, 50.0), None);
        assert_eq!(Reply::from_rates(1000.0, f64::NAN), None);
        assert_eq!(Reply::from_rates(-1.0, 50.0), None);
    }

    /// The reply, not the decode: a card that decodes 10 tok/s but reads
    /// 60 tok/s waits 39.2 s on the mean of a turn and a long history,
    /// where a processor that decodes slower (8 tok/s) and reads 300 waits
    /// 28.8 s. Inside the band, though, the fuller offload keeps the card:
    /// at a 360 tok/s read the processor's 28.2 s is only 2.4 % short of a
    /// card (100 tok/s read, 11.5 decode) that waits 28.9 s.
    #[test]
    fn the_reply_not_the_decode_decides() {
        let card = reply(60.0, 10.0);
        let processor = reply(300.0, 8.0);
        assert!(
            processor.seconds < card.seconds,
            "the slower decoder waits less: {processor:?} against {card:?}"
        );
        let trials = [(gpu(), card), (cpu(16), processor)];
        let win = reply_winner(&trials).expect("both scored");
        assert_eq!(win.candidate, cpu(16), "the reply, not the rate: {win:?}");
        assert!(
            win.reply.decode_rate < card.decode_rate,
            "and the winning trial is the slower decoder"
        );

        let near = [(gpu(), reply(100.0, 11.5)), (cpu(16), reply(360.0, 8.0))];
        assert!(near[1].1.seconds < near[0].1.seconds, "a real lead");
        assert_eq!(
            reply_winner(&near).map(|win| win.candidate),
            Some(gpu()),
            "inside the band the fuller offload wins"
        );
    }

    /// The Surface, measured 2026-10-01 on the 2,252-token room ask: the
    /// card fully offloaded reads 64.4 and decodes 5.3, the processor (4
    /// threads) reads 22.7 and decodes 13.3, and the mixed shape — weights
    /// on the processor, the card taking the big-batch prefill — reads 41.8
    /// and decodes 9.9. Neither pure shape is the best wait: 55.6 s and
    /// 65.7 s against the mixed shape's 47.7 s.
    #[test]
    fn the_surfaces_mixed_shape_beats_both_pure_ones() {
        let card = reply(64.4, 5.3);
        let processor = reply(22.7, 13.3);
        let mixed_candidate = Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(4),
            offload: Offload::ForcedOff,
            draft: None,
        };
        let trials = [
            (gpu(), card),
            (cpu(4), processor),
            (mixed_candidate, reply(41.8, 9.9)),
        ];
        let win = reply_winner(&trials).expect("all three scored");
        assert_eq!(win.candidate, mixed_candidate, "{trials:?}");
    }

    /// MTP on the shape that loses the decode race outright: the
    /// processor's own drafter turns its faster history into the shortest
    /// wait, and the trial that wins is a drafted one.
    #[test]
    fn a_drafter_on_the_slower_shape_can_win_the_room() {
        let processor = cpu(16);
        let drafted = Candidate {
            draft: Some(3),
            ..processor
        };
        let trials = [
            // 25.8 s on the mean of the two replies.
            (gpu(), reply(60.0, 30.0)),
            // 32.7 s.
            (processor, reply(150.0, 8.0)),
            // 22.0 s: the draft trial wins, on a decode rate no shape would
            // have chosen alone.
            (drafted, reply(150.0, 14.0)),
        ];
        let win = reply_winner(&trials).expect("three scored");
        assert_eq!(win.candidate, drafted);
        assert_eq!(win.reply.decode_rate, 14.0);
        assert!(
            trials[0].1.decode_rate > win.reply.decode_rate,
            "the room can prefer the slower decoder"
        );
    }

    /// Inside the band (3.15 s against 3.09 s) the lighter setting wins,
    /// not the raw minimum — 22 logical threads ask for six more than the
    /// machine's sixteen physical cores.
    #[test]
    fn a_tie_within_the_band_goes_to_the_fewer_threads() {
        let trials = [
            (cpu(16), reply(1000.0, 100.0)),
            (cpu(22), reply(1000.0, 103.0)),
        ];
        assert!(trials[1].1.seconds < trials[0].1.seconds, "a real lead");
        assert_eq!(
            reply_winner(&trials).map(|win| win.candidate),
            Some(cpu(16)),
            "within 5 %, the fewer threads win"
        );
    }

    /// The draft axis is the lightest: a drafted trial marginally faster
    /// than the same shape's target-only run loses the tie, because
    /// speculation a measurement did not clearly buy is not kept.
    #[test]
    fn no_draft_wins_a_tie_inside_the_band() {
        let base = cpu(16);
        let drafted = Candidate {
            draft: Some(2),
            ..base
        };
        let trials = [(drafted, reply(500.0, 20.16)), (base, reply(500.0, 20.0))];
        assert!(trials[0].1.seconds < trials[1].1.seconds, "a real lead");
        assert_eq!(reply_winner(&trials).map(|win| win.candidate), Some(base));
    }

    /// A rate that is not positive is not a measurement: a row of them
    /// leaves nothing that can win.
    #[test]
    fn nothing_scored_means_no_winner() {
        assert_eq!(best_rate(&[0.0, -3.0, 7.5]), Some(7.5));
        assert_eq!(best_rate(&[0.0, -3.0]), None);
        assert_eq!(reply_winner(&[]), None);
    }

    /// The estimate is the best sample, never the mean: B's best decode
    /// (15) beats A's (10) though A's mean (10) beats B's (9.5) — only a
    /// mean-driven estimate keeps A's shorter wait.
    #[test]
    fn the_estimate_is_the_best_sample_not_the_mean() {
        let a = cpu(16);
        let b = cpu(22);
        let a_reply = reply(500.0, best_rate(&[10.0, 10.0]).expect("a measured row"));
        let b_reply = reply(500.0, best_rate(&[15.0, 4.0]).expect("a measured row"));
        assert_eq!(b_reply.decode_rate, 15.0);
        assert_eq!(
            reply_winner(&[(a, a_reply), (b, b_reply)]).map(|win| win.candidate),
            Some(b)
        );
    }

    /// Two equal scores: the tie-break alone decides, and EngineFitted
    /// ranks with the fuller offload — it aims at the card, and the
    /// engine's fit decides how many layers fit this start's memory.
    #[test]
    fn an_engine_fitted_tie_is_the_fullest_offload() {
        let off = cpu(16);
        let fitted = Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(16),
            offload: Offload::EngineFitted,
            draft: None,
        };
        let trials = [(off, reply(1000.0, 25.0)), (fitted, reply(1000.0, 25.0))];
        assert_eq!(
            reply_winner(&trials).map(|win| win.candidate),
            Some(fitted),
            "the fuller offload wins the tie"
        );
    }

    /// An unknown thread count is the heaviest, not the lightest: the
    /// engine's own default may be every core, and ranking it as zero
    /// would let the unmeasured setting win the tie it cannot justify.
    #[test]
    fn an_unknown_thread_count_is_the_heaviest_not_the_lightest() {
        let unknown = Candidate {
            threads: None,
            ..cpu(4)
        };
        let trials = [
            (unknown, reply(1000.0, 22.0)),
            (cpu(4), reply(1000.0, 21.5)),
        ];
        assert_eq!(
            reply_winner(&trials).map(|win| win.candidate),
            Some(cpu(4)),
            "the known count is lighter than the engine's default"
        );
    }
}
