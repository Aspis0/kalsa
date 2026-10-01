//! The room's own ask: a history the size of a real conversation, built in
//! code so every shape prefaces the same work — no file, no randomness.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::candidates::Candidate;
use crate::measure::{lifetime, REQUEST_TIMEOUT};
use crate::refusal::Refusal;
use crate::sample::post_to;
use crate::score::ROOM_PROMPT_TOKENS;

/// The room prompt's length in characters: the turns below run about five
/// characters to a token on the tokenizers the app ships, so this builds
/// roughly the history the score prices. What the sample is checked
/// against is the server's own `prompt_n`, never this target.
const ROOM_CHARS: usize = 10_000;

/// The fewest prompt tokens a sample must prove it processed: half the
/// room. A server that answered from its own cache reports the few tokens
/// it really read, not the history the ask ordered — that sample would
/// measure the cache, so it is refused, not silently accepted.
const PROMPT_FLOOR: u64 = ROOM_PROMPT_TOKENS / 2;

/// The room's turns, cycled until the target length: household prose, the
/// kind of history a conversation really carries, none of it a question a
/// model could answer in three tokens.
const TURNS: [&str; 8] = [
    "Good morning, the kitchen radiator is still cold even though the thermostat says twenty-one degrees.",
    "Yesterday the plumber checked the valve and said the pipe behind the cabinet is probably blocked.",
    "We should ask the neighbour whether her heating was checked before the building changed hands.",
    "The invoice for the last visit is on the shelf in the hallway, beside the folder with the warranty papers.",
    "Before we call anyone again, let us write down every room and how warm it actually gets by the evening.",
    "The bedroom window faces north, so it stays cool, but the bathroom has never been a problem in winter.",
    "If the valve is fine, the next thing to check is whether the pump runs when the heating comes on.",
    "Please keep the notes together so the next person who looks at this has the whole story in one place.",
];

/// The room ask's own length: a handful of tokens. The request exists for
/// its prompt timings, not for its answer.
const ROOM_N_PREDICT: u64 = 8;

/// The warm-up's ask: one token on a prompt of its own, so the room ask's
/// first-token cost is the measurement and not the connection's.
const WARMUP_PROMPT: &str = "Hello";

/// One shape's prefill lifetime: a short discarded warm-up, then the room
/// ask once. One request is enough for a rate that is a property of the
/// shape — the same weights and the same build — and the warm-up is short
/// because the history itself is the expensive part being measured.
pub(crate) fn prefill_lifetime(
    state_root: &Path,
    candidate: &Candidate,
    resolved_exe: &PathBuf,
    build: &impl Fn(&Candidate, &PathBuf, u16) -> (PathBuf, Vec<String>),
) -> Result<Vec<f64>, Refusal> {
    lifetime(state_root, candidate, resolved_exe, build, |addr| {
        let _ = post_to(addr, REQUEST_TIMEOUT, "/completion", &warmup_body());
        match post_to(addr, REQUEST_TIMEOUT, "/completion", &ask_body()) {
            Ok(answer) => prompt_rate(&answer).map(|rate| vec![rate]),
            // A timeout or an HTTP error is a lifetime with no usable
            // answer, the same reading the decode pass gives one.
            Err(_) => Err(Refusal::NoUsableAnswer),
        }
    })
}

/// The prefill rate one answer proves, or the closed cause that keeps it
/// out of the tune: the server's own `prompt_n` must show it processed
/// the history, and `prompt_per_second` must be a measurement.
pub(crate) fn prompt_rate(body: &str) -> Result<f64, Refusal> {
    let parsed: Value = serde_json::from_str(body).map_err(|_| Refusal::NoUsableAnswer)?;
    let timings = parsed.get("timings").ok_or(Refusal::NoUsableAnswer)?;
    let prompt_n = timings
        .get("prompt_n")
        .and_then(Value::as_u64)
        .ok_or(Refusal::NoUsableAnswer)?;
    if prompt_n < PROMPT_FLOOR {
        return Err(Refusal::PromptTooShort);
    }
    let rate = timings
        .get("prompt_per_second")
        .and_then(Value::as_f64)
        .ok_or(Refusal::NoUsableAnswer)?;
    (rate.is_finite() && rate > 0.0)
        .then_some(rate)
        .ok_or(Refusal::NoUsableAnswer)
}

/// The history every shape is measured on: the turns in order until the
/// target length. Deterministic by construction, so two shapes' rates are
/// the same work made.
fn prompt() -> String {
    let mut text = String::with_capacity(ROOM_CHARS + 128);
    let mut index = 0usize;
    while text.len() < ROOM_CHARS {
        text.push_str(TURNS[index % TURNS.len()]);
        text.push(' ');
        index += 1;
    }
    text
}

/// The room ask at the one length the prefill pass uses: greedy, no
/// cache, forced to decode rather than stop early.
fn ask_body() -> String {
    body(&prompt(), ROOM_N_PREDICT)
}

/// The warm-up's body, discarded: a prompt of its own, one token.
fn warmup_body() -> String {
    body(WARMUP_PROMPT, 1)
}

fn body(prompt: &str, n_predict: u64) -> String {
    serde_json::json!({
        "prompt": prompt,
        "n_predict": n_predict,
        "cache_prompt": false,
        "temperature": 0.0,
        "ignore_eos": true,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same history every run, long enough to be the room the score
    /// prices, built only from the turns above.
    #[test]
    fn the_room_history_is_deterministic_and_about_the_room_size() {
        let first = prompt();
        let second = prompt();
        assert_eq!(first, second, "no randomness, no clock");
        assert!(
            first.len() >= ROOM_CHARS && first.len() < ROOM_CHARS + TURNS[0].len() + 1,
            "the target length is the loop's only bound: {}",
            first.len()
        );
        assert!(TURNS.iter().any(|turn| first.contains(turn)));
    }

    /// The ask itself: one uncached, greedy request at the room length,
    /// with the history in it.
    #[test]
    fn the_room_ask_is_one_greedy_uncached_request() {
        let ask = ask_body();
        let parsed: Value = serde_json::from_str(&ask).expect("our own JSON");
        assert_eq!(parsed["n_predict"], ROOM_N_PREDICT);
        assert_eq!(parsed["cache_prompt"], false);
        assert_eq!(parsed["temperature"], 0.0);
        assert_eq!(parsed["ignore_eos"], true);
        let sent = parsed["prompt"].as_str().expect("the history travels");
        assert_eq!(sent, prompt(), "the whole history, not a prefix");
    }

    /// The check the cache cannot pass: a rate is only a prefill rate when
    /// the server proved it read the history.
    #[test]
    fn a_sample_that_read_far_less_than_the_room_is_refused() {
        let sample = |prompt_n: u64, rate: f64| {
            serde_json::json!({
                "timings": { "prompt_n": prompt_n, "prompt_per_second": rate }
            })
            .to_string()
        };
        assert_eq!(
            prompt_rate(&sample(120, 900.0)),
            Err(Refusal::PromptTooShort),
            "a cached answer is not a prefill"
        );
        assert_eq!(prompt_rate(&sample(1999, 73.0)), Ok(73.0));
        // No rate, no count, no timings at all: nothing to read.
        assert_eq!(
            prompt_rate(&sample(2000, 0.0)),
            Err(Refusal::NoUsableAnswer)
        );
        assert_eq!(
            prompt_rate(r#"{"timings":{"prompt_n":2000}}"#),
            Err(Refusal::NoUsableAnswer)
        );
        assert_eq!(
            prompt_rate(r#"{"content":"hi"}"#),
            Err(Refusal::NoUsableAnswer)
        );
        assert_eq!(prompt_rate("not json"), Err(Refusal::NoUsableAnswer));
    }
}
