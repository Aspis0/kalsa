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

/// Trials within 5 % of the fastest reply are equal in wait, so the one that
/// answers fastest wins: two runs of one launch differ by percents, and a
/// trial that wins the wait by less than this has not won it.
pub(crate) const TIE_BAND: f64 = 0.05;

/// Inside the band the winner is the highest decode rate — in a chat the
/// decode is felt on every message, the wait only in total. Decode rates
/// within 5 % of the best are equal too; then — and only for trials no
/// other in-band trial beats on both axes — the lighter launch wins.
pub(crate) const DECODE_MARGIN: f64 = 0.05;

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

/// The decode share of the score, the most a drafted setting can take
/// away: a reply's written tokens at the trial's own decode rate.
pub(crate) fn decode_seconds(decode_rate: f64) -> f64 {
    (TURN_REPLY_TOKENS + ROOM_REPLY_TOKENS) as f64 / 2.0 / decode_rate
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

/// Lighter is better among trials neither of which dominates the other
/// and whose decodes the margin calls equal: the offload that puts every
/// layer on the GPU first (the GPU does the work then, though full
/// offload does not free the processor entirely), then the fewer threads —
/// and an unknown thread count ranks heaviest of all: the engine's own
/// default may be every core the machine has. The draft axis ranks last
/// and lightest at none: speculation a measurement did not clearly buy is
/// not kept, and a wider proposal loses a tie to a narrower one.
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

/// The winner among the scored trials: the lowest reply time; within
/// `TIE_BAND` of it the fastest decoder; within `DECODE_MARGIN` of that
/// decode rate the lightest candidate that no other in-band trial
/// dominates — another trial at least as good on BOTH the wait and the
/// decode and strictly better on one, which can therefore never win,
/// however light it is. `None` when nothing scored. Exact ties on every
/// axis fall to the lower reply seconds and then the candidate's own
/// identity, so the winner cannot depend on the order the trials arrive in.
pub(crate) fn reply_winner(scored: &[(Candidate, Reply)]) -> Option<Winner> {
    let top = scored
        .iter()
        .map(|(_, reply)| reply.seconds)
        .reduce(f64::min)?;
    let in_band = |reply: &Reply| reply.seconds <= top * (1.0 + TIE_BAND);
    let fastest_decode = scored
        .iter()
        .filter(|(_, reply)| in_band(reply))
        .map(|(_, reply)| reply.decode_rate)
        .reduce(f64::max)?;
    // Dominated: another in-band trial is at least as good on both axes
    // and strictly better on one — a trial that lost twice cannot win on
    // lightness. The dominating trial needs no separate check to be a
    // survivor itself: its wait is no worse (so it is in-band too) and its
    // decode no lower (so it passes the margin when the dominated one does).
    let dominated = |reply: &Reply| {
        scored.iter().any(|(_, other)| {
            in_band(other)
                && other.seconds <= reply.seconds
                && other.decode_rate >= reply.decode_rate
                && (other.seconds < reply.seconds || other.decode_rate > reply.decode_rate)
        })
    };
    scored
        .iter()
        .filter(|(_, reply)| in_band(reply))
        .filter(|(_, reply)| reply.decode_rate >= fastest_decode * (1.0 - DECODE_MARGIN))
        .filter(|(_, reply)| !dominated(reply))
        .map(|(candidate, reply)| {
            // The identity is the candidate's own debug spelling:
            // injective on the struct and stable across runs, so two trials
            // tied on every scored axis are separated here, never by the
            // order they arrived in.
            (
                lightness(candidate),
                reply.seconds,
                format!("{candidate:?}"),
                candidate,
                reply,
            )
        })
        .min_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.total_cmp(&right.1))
                .then_with(|| left.2.cmp(&right.2))
        })
        .map(|(_, _, _, candidate, reply)| Winner {
            candidate: *candidate,
            reply: *reply,
        })
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

    /// The Surface's tune run 3 (LFM2.5 Q8): three shapes inside the 5 %
    /// band — the engine-fitted card (53.3 s, decode 5.3), the mixed shape
    /// (52.5 s, 9.8) and the processor at 8 threads (53.9 s, 13.3). The old
    /// tie-break gave the owner the card's 5.3 tok/s; the chat is felt in
    /// decode, so the fastest writer of the three wins.
    #[test]
    fn inside_the_band_the_fastest_decoder_wins() {
        let fitted = Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(4),
            offload: Offload::EngineFitted,
            draft: None,
        };
        let mixed = Candidate {
            offload: Offload::ForcedOff,
            ..fitted
        };
        let trials = [
            (fitted, reply(73.1, 5.32)),
            (mixed, reply(35.9, 9.78)),
            (cpu(4), reply(24.1, 11.1)),
            (cpu(8), reply(29.6, 13.29)),
        ];
        let seconds: Vec<f64> = trials.iter().map(|(_, reply)| reply.seconds).collect();
        assert!((seconds[0] - 53.33).abs() < 0.01, "{seconds:?}");
        assert!((seconds[1] - 52.49).abs() < 0.01, "{seconds:?}");
        assert!((seconds[2] - 65.74).abs() < 0.01, "{seconds:?}");
        assert!((seconds[3] - 53.93).abs() < 0.05, "{seconds:?}");
        let win = reply_winner(&trials).expect("scored");
        assert_eq!(win.candidate, cpu(8), "{win:?}");
        // The shape outside the band never competes, whatever it decodes.
        let slow_but_fast_decoder = [(cpu(4), reply(10.0, 40.0)), (fitted, reply(73.1, 5.32))];
        assert_eq!(
            reply_winner(&slow_but_fast_decoder).map(|win| win.candidate),
            Some(fitted),
            "a decode rate cannot buy a wait that is outside the band"
        );
    }

    /// Decode rates inside 5 % of each other are equal, and the lighter
    /// launch wins — but only between trials that trade: a launch that
    /// waits longer AND writes slower is dominated and cannot win on
    /// lightness, however few threads it asks for.
    #[test]
    fn lightness_decides_only_where_no_trial_is_dominated() {
        // cpu(4) writes 4 % slower and waits longer (12.72 s against
        // 12.30): dominated on both axes, so the heavier cpu(8) takes it.
        let dominated = [(cpu(8), reply(500.0, 20.0)), (cpu(4), reply(500.0, 19.2))];
        assert_eq!(
            reply_winner(&dominated).map(|win| win.candidate),
            Some(cpu(8)),
            "the lighter launch lost on both axes"
        );
        // A real trade: cpu(4) reads faster (700 against 500) and writes
        // 2.5 % slower — neither dominates the other, and the fewer
        // threads win the tie the score cannot break.
        let trade = [(cpu(8), reply(500.0, 20.0)), (cpu(4), reply(700.0, 19.5))];
        assert_eq!(
            reply_winner(&trade).map(|win| win.candidate),
            Some(cpu(4)),
            "4 % apart is one decode rate"
        );
        let apart = [(cpu(8), reply(500.0, 20.0)), (cpu(4), reply(500.0, 18.0))];
        assert_eq!(
            reply_winner(&apart).map(|win| win.candidate),
            Some(cpu(8)),
            "10 % apart is a real decode lead"
        );
    }

    /// Inside the band the fewer threads win only when nothing else
    /// separates the trials: at equal rates (3.15 s, 100 tok/s) the six
    /// extra threads buy nothing and lose the tie — but cpu(22)'s 3.09 s
    /// at 103 tok/s beats cpu(16) on BOTH axes, and the faster, heavier
    /// launch takes the room.
    #[test]
    fn the_fewer_threads_win_the_band_when_nothing_else_separates() {
        let equal = [
            (cpu(16), reply(1000.0, 100.0)),
            (cpu(22), reply(1000.0, 100.0)),
        ];
        assert_eq!(
            reply_winner(&equal).map(|win| win.candidate),
            Some(cpu(16)),
            "within 5 %, the fewer threads win"
        );
        let both_axes = [
            (cpu(16), reply(1000.0, 100.0)),
            (cpu(22), reply(1000.0, 103.0)),
        ];
        assert!(
            both_axes[1].1.seconds < both_axes[0].1.seconds,
            "a real lead"
        );
        assert_eq!(
            reply_winner(&both_axes).map(|win| win.candidate),
            Some(cpu(22)),
            "the 22 threads wait less AND write faster: dominance, not lightness"
        );
    }

    /// The pair that exposed lightness picking the loser: B waits longer
    /// (11.676 s against 11.150) and writes slower (19 against 20 tok/s)
    /// yet is the lighter launch — dominated on both axes, it cannot win,
    /// whichever order the two arrive in.
    #[test]
    fn a_trial_dominated_on_both_axes_never_wins_on_lightness() {
        let a = cpu(8);
        let b = gpu(); // Vulkan, All: the lighter launch of the two
        let trials = [(a, reply(1000.0, 20.0)), (b, reply(1000.0, 19.0))];
        assert!((trials[0].1.seconds - 11.150).abs() < 1e-9, "{trials:?}");
        assert!((trials[1].1.seconds - 11.676).abs() < 1e-3, "{trials:?}");
        assert!(
            trials[1].1.seconds > trials[0].1.seconds
                && trials[1].1.decode_rate < trials[0].1.decode_rate,
            "B is worse on both axes"
        );
        assert_eq!(
            reply_winner(&trials).map(|win| win.candidate),
            Some(a),
            "dominated on both axes: the heavier A wins"
        );
        let reversed = [(b, reply(1000.0, 19.0)), (a, reply(1000.0, 20.0))];
        assert_eq!(
            reply_winner(&reversed).map(|win| win.candidate),
            Some(a),
            "dominance does not care about order either"
        );
    }

    /// The selection is total: two trials equal on every scored axis and
    /// on lightness are separated by the candidates' own identities, so
    /// the same set yields the same winner whichever order it arrives in.
    #[test]
    fn the_winner_does_not_depend_on_the_order_of_the_trials() {
        let all = Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(8),
            offload: Offload::All,
            draft: None,
        };
        let fitted = Candidate {
            offload: Offload::EngineFitted,
            ..all
        };
        assert_eq!(lightness(&all), lightness(&fitted), "the fixtures tie");
        let first = (all, reply(500.0, 20.0));
        let second = (fitted, reply(500.0, 20.0));
        let forward = reply_winner(&[first, second]).expect("both scored");
        let backward = reply_winner(&[second, first]).expect("both scored");
        assert_eq!(
            forward.candidate, backward.candidate,
            "input order must not pick the winner: {forward:?} against {backward:?}"
        );
    }

    /// The draft axis is the lightest: with the two replies inseparable the
    /// target-only run wins, because speculation a measurement did not
    /// separate is not kept. What lightness cannot do is keep a run that
    /// waits longer AND writes slower — the drafted run that beats the base
    /// on both axes wins despite being the heavier launch.
    #[test]
    fn no_draft_wins_a_tie_inside_the_band() {
        let base = cpu(16);
        let drafted = Candidate {
            draft: Some(2),
            ..base
        };
        let tied = [(drafted, reply(500.0, 20.0)), (base, reply(500.0, 20.0))];
        assert_eq!(reply_winner(&tied).map(|win| win.candidate), Some(base));
        let dominated = [(drafted, reply(500.0, 20.16)), (base, reply(500.0, 20.0))];
        assert!(
            dominated[0].1.seconds < dominated[1].1.seconds,
            "a real lead"
        );
        assert_eq!(
            reply_winner(&dominated).map(|win| win.candidate),
            Some(drafted),
            "the base waits longer AND writes slower: dominance outranks lightness"
        );
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

    /// Two equal scores and equal decoders: the lightness alone decides, and
    /// EngineFitted ranks with the fuller offload — it aims at the card, and
    /// the engine's fit decides how many layers fit this start's memory.
    /// (A faster decoder would win first: see
    /// `inside_the_band_the_fastest_decoder_wins`.)
    #[test]
    fn an_engine_fitted_tie_between_equal_decoders_is_the_fullest_offload() {
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
            "equal decoders: the fuller offload wins the tie"
        );
    }

    /// An unknown thread count is the heaviest, not the lightest: the
    /// engine's own default may be every core, and ranking it as zero
    /// would let the unmeasured setting win a tie it cannot justify. It
    /// still wins the trials it is measurably better on — that victory
    /// comes from dominance, never from its rank.
    #[test]
    fn an_unknown_thread_count_is_the_heaviest_not_the_lightest() {
        let unknown = Candidate {
            threads: None,
            ..cpu(4)
        };
        let tied = [(unknown, reply(1000.0, 22.0)), (cpu(4), reply(1000.0, 22.0))];
        assert_eq!(
            reply_winner(&tied).map(|win| win.candidate),
            Some(cpu(4)),
            "the known count is lighter than the engine's default"
        );
        let better_on_both = [(unknown, reply(1000.0, 22.0)), (cpu(4), reply(1000.0, 21.5))];
        assert_eq!(
            reply_winner(&better_on_both).map(|win| win.candidate),
            Some(unknown),
            "shorter wait and faster decode: the rank never gets a say"
        );
    }
}
