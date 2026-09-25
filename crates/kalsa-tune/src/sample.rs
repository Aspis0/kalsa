//! One request, one number: ask a live server for decode and keep the
//! rate only when the answer proves it decoded what we ordered.

use std::net::SocketAddr;
use std::time::Duration;

use serde_json::Value;

/// Every measured sample decodes exactly this many tokens — `ignore_eos`
/// holds the server to it — so rates from different builds are the same
/// work made. The warm-up asks for far fewer (see `WARMUP_N_PREDICT`).
pub(crate) const N_PREDICT: u64 = 64;

/// One fixed prompt: the same work for every candidate, a plain factual
/// paragraph no model is tempted to end early or refuse.
const PROMPT: &str = "Write a short paragraph about the history of the bicycle.";

/// The decode rate the server itself measured, or nothing: fewer tokens
/// than ordered (the answer proved less than we asked for), no timings
/// block, or a rate that is not a positive finite number — none of those
/// is a measurement.
pub(crate) fn rate_from(body: &str, min_n: u64) -> Option<f64> {
    let parsed: Value = serde_json::from_str(body).ok()?;
    let timings = parsed.get("timings")?;
    if timings.get("predicted_n")?.as_u64()? < min_n {
        return None;
    }
    let rate = timings.get("predicted_per_second")?.as_f64()?;
    (rate.is_finite() && rate > 0.0).then_some(rate)
}

/// The per-start check's ask: a discarded 8-token warm-up (the tune's own
/// shape, so a first-request cost lands there), then 16 tokens — each
/// request bounded by CHECK_TIMEOUT on the connect too, because ureq's
/// connect timeout defaults to 30 s and the request timeout does not cover
/// it. The whole check is therefore two legs of at most 2×CHECK_TIMEOUT.
pub const CHECK_N_PREDICT: u64 = 16;
pub const CHECK_WARMUP_N_PREDICT: u64 = 8;
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(15);

/// What one check answered: the decode rate; a timeout — no answer within
/// the bound, which the check reads as slow (it cannot tell a starved
/// card from a waiting server, only from a fast one); or a failure that
/// says nothing about speed: an HTTP error, an unusable body, a rejected
/// timing.
pub enum Answer {
    Rate(f64),
    Timeout,
    Failed,
}

/// The decode rate for one short request, read the way the tune reads its
/// samples: the same `rate_from`, after the same discarded warm-up.
pub fn checked_rate(addr: SocketAddr, timeout: Duration) -> Answer {
    let _ = request(addr, timeout, CHECK_WARMUP_N_PREDICT);
    match post(addr, timeout, CHECK_N_PREDICT) {
        Ok(text) => rate_from(&text, CHECK_N_PREDICT).map_or(Answer::Failed, Answer::Rate),
        Err(SendFailed::Timeout) => Answer::Timeout,
        Err(SendFailed::Failed) => Answer::Failed,
    }
}

/// How a POST went wrong, kept apart because the check reads them apart:
/// only a timeout means the card is slow.
enum SendFailed {
    Timeout,
    Failed,
}

/// The agent both asks share, so the POST and the identity GET hold the
/// same bound: the request timeout covers neither the connect (ureq's
/// default is 30 s) nor a redirect's deadline-free DNS lookup, and the
/// only server we dial is our own on 127.0.0.1, which never redirects —
/// a 3xx is refused instead of followed.
fn agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(timeout)
        .redirects(0)
        .build()
}

/// One POST to `/completion`, shared by the tune's samples and the check.
fn post(addr: SocketAddr, timeout: Duration, n_predict: u64) -> Result<String, SendFailed> {
    let body = completion_body(n_predict);
    match agent(timeout)
        .post(&format!("http://{addr}/completion"))
        .timeout(timeout)
        .send_string(&body)
    {
        // The body has its own deadline; running out of time while reading
        // it is the same timeout as anywhere else.
        Ok(response) => {
            // A refused redirect arrives as an Ok: someone else's body is
            // never a sample, and reading one that stalls must not come
            // back as the Timeout that would blame our card.
            if !(200..300).contains(&response.status()) {
                return Err(SendFailed::Failed);
            }
            response.into_string().map_err(|io| {
                if io.kind() == std::io::ErrorKind::TimedOut {
                    SendFailed::Timeout
                } else {
                    SendFailed::Failed
                }
            })
        }
        Err(ureq::Error::Transport(transport)) => {
            // ureq has no timeout kind of its own: a request that ran out
            // of time arrives as an io error with TimedOut underneath.
            let timed_out = std::error::Error::source(&transport)
                .and_then(|source| source.downcast_ref::<std::io::Error>())
                .is_some_and(|io| io.kind() == std::io::ErrorKind::TimedOut);
            Err(if timed_out {
                SendFailed::Timeout
            } else {
                SendFailed::Failed
            })
        }
        Err(_) => Err(SendFailed::Failed),
    }
}

/// One POST to llama-server's `/completion` — the endpoint that takes
/// `n_predict` and reports `timings`. Anything that is not a 2xx with a
/// parseable body is no sample: a server still loading answers 503, a
/// build without the endpoint answers 404, and neither is this crate's
/// problem to surface — it is a lifetime with no usable answer.
pub(crate) fn request(addr: SocketAddr, timeout: Duration, n_predict: u64) -> Option<f64> {
    rate_from(&post(addr, timeout, n_predict).ok()?, n_predict)
}

/// The exact ask, with the token count the caller chose: the same prompt,
/// the same flags, a different `n_predict` for the warm-up.
fn completion_body(n_predict: u64) -> String {
    serde_json::json!({
        "prompt": PROMPT,
        "n_predict": n_predict,
        "ignore_eos": true,
        "temperature": 0.0,
        "cache_prompt": false,
    })
    .to_string()
}

/// True when the port lists OUR nonce among `/v1/models`'s entries — the
/// only proof the 200s and the rates came from our child: the engine
/// builds each entry as `{"id", meta.model_name}` with its aliases beside
/// it (`{"aliases", meta.model_aliases}`,
/// kalsallama `tools/server/server-context.cpp:4879-4885`, wrapped at
/// `:4924-4928`). Our nonce counts as `id` OR as one of `aliases`: an
/// inherited `LLAMA_ARG_ALIAS` (applied before the command line) can sort
/// into the set before ours and take the `id`
/// (`server-context.cpp:1384-1395`), and the entry still carries ours.
pub(crate) fn serves_id(addr: SocketAddr, nonce: &str, timeout: Duration) -> bool {
    let reply = agent(timeout)
        .get(&format!("http://{addr}/v1/models"))
        .timeout(timeout)
        .call();
    match reply {
        Ok(response) => id_among(&response.into_string().unwrap_or_default(), nonce),
        Err(_) => false,
    }
}

/// The pure half of the check: our nonce is among the listed ids. A body
/// that does not parse, has no `data` array, or lists other models is not
/// our server.
fn id_among(body: &str, nonce: &str) -> bool {
    let Ok(parsed) = serde_json::from_str::<Value>(body) else {
        return false;
    };
    parsed
        .get("data")
        .and_then(Value::as_array)
        .map(|entries| {
            entries.iter().any(|entry| {
                entry.get("id").and_then(Value::as_str) == Some(nonce)
                    || entry
                        .get("aliases")
                        .and_then(Value::as_array)
                        .is_some_and(|aliases| {
                            aliases.iter().any(|alias| alias.as_str() == Some(nonce))
                        })
            })
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape the server really writes — the two fields the measure
    /// reads and their neighbours, as the sentinel's real-server test and
    /// the real walk read them.
    fn body(predicted_n: u64, rate: f64) -> String {
        serde_json::json!({
            "content": "The bicycle began as a hobby-horse.",
            "timings": {
                "prompt_n": 12,
                "prompt_ms": 3.1,
                "prompt_per_second": 3870.9,
                "predicted_n": predicted_n,
                "predicted_ms": 1409.6,
                "predicted_per_second": rate,
            },
        })
        .to_string()
    }

    /// The engine's real `/v1/models` entry (server-context.cpp:4879-4885
    /// inside the `data` array of `:4924-4928`), as it lists our alias.
    fn models_json(id: &str) -> String {
        serde_json::json!({
            "models": [{"name": id, "model": id}],
            "object": "list",
            "data": [{
                "id": id,
                "aliases": [id],
                "tags": [""],
                "object": "model",
                "created": 0,
                "owned_by": "llamacpp",
            }],
        })
        .to_string()
    }

    /// Identity, on the real shape: only OUR nonce on the port counts.
    #[test]
    fn only_our_nonce_on_the_models_listing_counts() {
        let nonce = "kalsa-tune-00112233445566778899aabbccddeeff";
        assert!(id_among(&models_json(nonce), nonce), "our server, our id");
        assert!(
            !id_among(&models_json("Trinity-Nano-Preview-Q4_K_M"), nonce),
            "somebody else's model on our freed port is not ours"
        );
        // An inherited LLAMA_ARG_ALIAS can take the id; ours survives in
        // the aliases array — that still counts as our server.
        let aliases_body = serde_json::json!({
            "object": "list",
            "data": [{
                "id": "owner-inherited-name",
                "aliases": [nonce],
                "object": "model",
            }],
        })
        .to_string();
        assert!(id_among(&aliases_body, nonce), "our nonce in aliases is ours");
        let nowhere_body = serde_json::json!({
            "object": "list",
            "data": [{
                "id": "owner-inherited-name",
                "aliases": ["other-name"],
                "object": "model",
            }],
        })
        .to_string();
        assert!(!id_among(&nowhere_body, nonce), "neither id nor aliases: not ours");
        assert!(!id_among(r#"{"data":[]}"#, nonce), "no entries: no proof");
        assert!(!id_among(r#"{"data":[{"object":"model"}]}"#, nonce), "no id: no proof");
        assert!(!id_among("not json at all", nonce), "unparsable: no proof");
    }

    /// The warm-up and the measured requests differ in exactly one field.
    #[test]
    fn the_warm_up_asks_for_fewer_tokens_than_the_measurement() {
        let warm = completion_body(8);
        assert!(warm.contains("\"n_predict\":8"), "{warm}");
        let measured = completion_body(N_PREDICT);
        assert!(measured.contains("\"n_predict\":64"), "{measured}");
        assert!(warm.contains("\"ignore_eos\":true"), "{warm}");
    }

    #[test]
    fn a_complete_answer_is_the_rate_it_reports() {
        assert_eq!(rate_from(&body(64, 45.4), N_PREDICT), Some(45.4));
        assert_eq!(rate_from(&body(128, 11.8), N_PREDICT), Some(11.8));
    }

    /// One token short of the order is not a sample: the run decoded
    /// something other than the work we asked for, and its rate is not
    /// the rate of that work.
    #[test]
    fn fewer_tokens_than_ordered_is_no_sample() {
        assert_eq!(rate_from(&body(63, 99.9), N_PREDICT), None);
        assert_eq!(rate_from(&body(0, 99.9), N_PREDICT), None);
    }

    /// A rate that cannot be a measurement is not one, however the JSON
    /// spells it.
    #[test]
    fn a_rate_that_is_not_a_measurement_is_no_sample() {
        assert_eq!(rate_from(&body(64, 0.0), N_PREDICT), None);
        assert_eq!(rate_from(&body(64, -1.0), N_PREDICT), None);
        assert_eq!(rate_from(&body(64, f64::NAN), N_PREDICT), None);
    }

    #[test]
    fn an_answer_without_timings_is_no_sample() {
        assert_eq!(rate_from(r#"{"content":"hi"}"#, N_PREDICT), None);
        assert_eq!(rate_from(r#"{"timings":{"predicted_n":64}}"#, N_PREDICT), None);
        assert_eq!(rate_from("not json at all", N_PREDICT), None);
    }
}

#[cfg(test)]
mod check_tests {
    use super::*;
    use std::net::TcpListener;

    /// The distinction the check hangs on: a request that ran out of time is
    /// `Timeout` (slow), a connection that never could be made is `Failed`
    /// (says nothing about speed).
    #[test]
    fn a_timeout_and_a_dead_port_are_different_answers() {
        let hanging = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = hanging.local_addr().expect("addr").port();
        let _acceptor = std::thread::spawn(move || {
            if let Ok((stream, _)) = hanging.accept() {
                // Held open past the client's deadline, then dropped.
                std::thread::sleep(std::time::Duration::from_millis(400));
                drop(stream);
            }
        });
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("addr");
        assert!(
            matches!(
                checked_rate(addr, Duration::from_millis(100)),
                Answer::Timeout
            ),
            "an unanswered request is a timeout"
        );

        let closed = TcpListener::bind("127.0.0.1:0").expect("bind");
        let dead_port = closed.local_addr().expect("addr").port();
        drop(closed);
        let dead: SocketAddr = format!("127.0.0.1:{dead_port}").parse().expect("addr");
        assert!(
            matches!(
                checked_rate(dead, Duration::from_millis(500)),
                Answer::Failed
            ),
            "a refused connection is a failure, not a slow card"
        );
    }

    /// A 3xx is not our server's answer: it must read as `Failed` — not
    /// the `Timeout` that would blame the card, not a rate from somebody
    /// else's body — and it must never be followed: the Location points
    /// at a second listener this test owns, which has to see nothing.
    /// Nothing here is a stopwatch, so nothing here is a flake.
    #[test]
    fn a_redirect_is_refused_and_never_dialled() {
        // The redirect's own destination: bound, never accepted, and
        // asked once the check is done whether anything dialled it.
        let target = TcpListener::bind("127.0.0.1:0").expect("bind");
        target.set_nonblocking(true).expect("nonblocking");
        let target_addr = target.local_addr().expect("addr");

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let _responder = std::thread::spawn(move || {
            // The warm-up's request and the measured one: each is answered
            // with the same redirect.
            for _ in 0..2 {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                std::thread::spawn(move || {
                    use std::io::{Read, Write};
                    // Drain before answering: bytes still unread at close
                    // reset the connection and can eat the reply.
                    let mut got = Vec::new();
                    let mut chunk = [0u8; 512];
                    let want = loop {
                        match stream.read(&mut chunk) {
                            Ok(0) | Err(_) => break 0,
                            Ok(n) => got.extend_from_slice(&chunk[..n]),
                        }
                        if let Some(head_end) = got.windows(4).position(|w| w == b"\r\n\r\n") {
                            let head = String::from_utf8_lossy(&got[..head_end]).to_ascii_lowercase();
                            let body = head
                                .split_once("content-length:")
                                .and_then(|(_, rest)| rest.split_whitespace().next())
                                .and_then(|n| n.parse::<usize>().ok())
                                .unwrap_or(0);
                            break head_end + 4 + body;
                        }
                    };
                    while got.len() < want {
                        match stream.read(&mut chunk) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => got.extend_from_slice(&chunk[..n]),
                        }
                    }
                    // The body is a perfect rate on purpose: only the
                    // status may refuse it.
                    let fake = br#"{"timings":{"predicted_n":16,"predicted_per_second":99.9}}"#;
                    let reply = format!(
                        "HTTP/1.1 302 Found\r\nlocation: http://{target_addr}/\r\ncontent-length: {}\r\n\r\n{}",
                        fake.len(),
                        String::from_utf8_lossy(fake)
                    );
                    let _ = stream.write_all(reply.as_bytes());
                });
            }
        });
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("addr");
        let answer = checked_rate(addr, Duration::from_millis(500));
        // The proof, not a stopwatch: a followed redirect completes its
        // connect while the check is still running, so by now the target
        // either holds that connection or was never dialled at all.
        let dialled = match target.accept() {
            Ok(_) => true,
            // Nothing dialled is a plain WouldBlock; any other answer
            // fails loud rather than green.
            Err(error) => error.kind() != std::io::ErrorKind::WouldBlock,
        };
        assert!(!dialled, "the redirect target was dialled");
        assert!(
            matches!(answer, Answer::Failed),
            "a redirect must be a failure, not a rate and not a slow card"
        );
    }

    /// A body that stalls after its headers is a timeout too: the deadline
    /// covers reading the answer, not only receiving it.
    #[test]
    fn a_body_that_stalls_is_a_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let _writer = std::thread::spawn(move || {
            // The warm-up's request and the measured one: both get their
            // headers at once (each connection stalls on its own thread),
            // then a body that never finishes — so the measured request's
            // deadline runs out while reading, not while waiting.
            for _ in 0..2 {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                std::thread::spawn(move || {
                    use std::io::Write;
                    let _ = stream.write_all(
                        b"HTTP/1.1 200 OK\r\ncontent-length: 1000\r\n\r\nshort",
                    );
                    std::thread::sleep(std::time::Duration::from_millis(400));
                });
            }
        });
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("addr");
        assert!(
            matches!(
                checked_rate(addr, Duration::from_millis(100)),
                Answer::Timeout
            ),
            "a stalled body is the same timeout as a stalled header"
        );
    }
}
