//! One request, one number: ask a live server for decode and keep the
//! rate only when the answer proves it decoded what we ordered.

use std::net::SocketAddr;
use std::time::Duration;

use serde_json::Value;

/// One fixed prompt: the same work for every request of the check, a
/// plain factual paragraph no model is tempted to end early or refuse.
const PROMPT: &str = "Write a short paragraph about the history of the bicycle.";

/// One request's whole ask, as a per-request body needs it: the text, the
/// sampling, the seed, the length. Two asks reach a server through this
/// type — the per-start check's and the decode sweep's — and a rate only
/// ever compares against rates of the SAME ask; the room's prefill has its
/// own reader in `room`.
pub struct Ask {
    pub prompt: &'static str,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub top_k: Option<u32>,
    /// Fixed across every request of a comparison, so the text is the same
    /// work for every setting measured against it.
    pub seed: Option<u32>,
    pub n_predict: u64,
    /// True for the draft ask: it goes to `/v1/chat/completions` as one user
    /// message — the product's own road, chat template and all — and stops
    /// at EOS, because forced tokens past the answer are repetitive text a
    /// drafter accepts trivially.
    pub chat: bool,
    /// The fewest generated tokens a measured answer must hold to count:
    /// `ignore_eos` guarantees the raw road's full order, an EOS-stopped
    /// chat answer only promises this floor.
    pub min_generated: u64,
}

/// The per-start check's ask: one short factual prompt, greedy. The check
/// overrides the length per request — its warm-up is discarded, its
/// measured request is one number.
const CHECK_ASK: Ask = Ask {
    prompt: PROMPT,
    temperature: Some(0.0),
    top_p: None,
    top_k: None,
    seed: None,
    n_predict: CHECK_N_PREDICT,
    chat: false,
    min_generated: CHECK_N_PREDICT,
};

/// The draft dimension's prompt: one Italian-and-English request for plain
/// prose — chat-like text, mixed languages, nothing a model answers in code
/// or lists — because speculation's gain depends on the text, and the
/// short factual prompt the per-start check uses sits at the optimistic
/// end of what acceptance runs.
pub const DRAFT_PROMPT: &str = "Per il nostro appartamento a Milano sto cercando di capire \
    come funziona il riscaldamento: l'impianto è vecchio e una stanza resta sempre fredda. \
    Could you explain in plain prose, senza elenchi e senza codice, what usually causes one \
    room to stay cold and what you would check first?";

/// The seed every draft-ask request carries: the same text for every
/// setting, so the four settings are compared on the same work.
pub const DRAFT_SEED: u32 = 42;

/// The draft dimension's length: a chat-turn's worth of generated tokens,
/// so a per-step overhead has room to amortise.
pub const DRAFT_N_PREDICT: u64 = 128;

/// The fewest generated tokens a draft answer must hold: an EOS-stopped
/// answer shorter than this says less than a turn of chat, and a rate off
/// it would rank a refusal-shaped lifetime as a measurement.
pub const DRAFT_MIN_GENERATED: u64 = 48;

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
pub(crate) enum SendFailed {
    Timeout,
    Failed,
}

/// The agent both asks share, so the POST and the identity GET hold the
/// same bound: the request timeout covers neither the connect (ureq's
/// default is 30 s) nor a redirect's deadline-free DNS lookup — a 3xx is
/// not a rate, and following one would leave the bound, so none is
/// followed.
fn agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(timeout)
        .redirects(0)
        .build()
}

/// One POST to `/completion`, shared by the tune's samples and the check.
fn post(addr: SocketAddr, timeout: Duration, n_predict: u64) -> Result<String, SendFailed> {
    post_to(addr, timeout, "/completion", &completion_body(n_predict))
}

pub(crate) fn post_to(
    addr: SocketAddr,
    timeout: Duration,
    path: &str,
    body: &str,
) -> Result<String, SendFailed> {
    match agent(timeout)
        .post(&format!("http://{addr}{path}"))
        .timeout(timeout)
        .send_string(body)
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

/// One POST of one ask at one length: the draft dimension's own request.
/// The chat road answers with the same `timings` block the raw one does —
/// `res["timings"] = stats.to_json()` in `to_json_oaicompat_chat()`
/// (kalsallama tools/server/server-task.cpp:456), and `stats.to_json()`
/// carries `predicted_n`/`predicted_ms`/`predicted_per_second` counted over
/// every generated token, reasoning included (server-common.cpp:92-95) — so
/// one reader serves both roads.
pub(crate) fn request_ask(
    addr: SocketAddr,
    timeout: Duration,
    ask: &Ask,
    n_predict: u64,
) -> Option<f64> {
    let (path, body) = ask_body(ask, n_predict);
    rate_from(
        &post_to(addr, timeout, path, &body).ok()?,
        ask.min_generated,
    )
}

/// The endpoint and the body one ask sends at one length: the raw road the
/// check uses, or the chat road with the ask as one user message and the
/// length as `max_tokens` — EOS ends the answer, `ignore_eos` is the raw
/// road's alone.
fn ask_body(ask: &Ask, n_predict: u64) -> (&'static str, String) {
    let mut body = serde_json::Map::new();
    if ask.chat {
        body.insert(
            "messages".to_string(),
            serde_json::json!([{ "role": "user", "content": ask.prompt }]),
        );
        body.insert("max_tokens".to_string(), serde_json::json!(n_predict));
    } else {
        body.insert("prompt".to_string(), serde_json::json!(ask.prompt));
        body.insert("n_predict".to_string(), serde_json::json!(n_predict));
        body.insert("ignore_eos".to_string(), serde_json::json!(true));
    }
    body.insert("cache_prompt".to_string(), serde_json::json!(false));
    if let Some(temperature) = ask.temperature {
        body.insert("temperature".to_string(), serde_json::json!(temperature));
    }
    if let Some(top_p) = ask.top_p {
        body.insert("top_p".to_string(), serde_json::json!(top_p));
    }
    if let Some(top_k) = ask.top_k {
        body.insert("top_k".to_string(), serde_json::json!(top_k));
    }
    if let Some(seed) = ask.seed {
        body.insert("seed".to_string(), serde_json::json!(seed));
    }
    let path = if ask.chat {
        "/v1/chat/completions"
    } else {
        "/completion"
    };
    (path, serde_json::Value::Object(body).to_string())
}

/// The check's body at one length: the same prompt, the same flags, a
/// different `n_predict` for the warm-up.
fn completion_body(n_predict: u64) -> String {
    ask_body(&CHECK_ASK, n_predict).1
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
        // A refused redirect arrives as an Ok: the status gates the
        // body, because somebody else's body is never our listing.
        Ok(response) if (200..300).contains(&response.status()) => {
            id_among(&response.into_string().unwrap_or_default(), nonce)
        }
        Ok(_) | Err(_) => false,
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

/// The shape the server really writes — the two fields the measure
/// reads and their neighbours, as the sentinel's real-server test and
/// the real walk read them. The millis are derived from the count and
/// the rate, so a fixture never contradicts itself.
#[cfg(test)]
fn body(predicted_n: u64, rate: f64) -> String {
    // A rate that is no measurement — or whose millis overflow — has
    // no millis to pair with it; serde_json spells those `null`.
    let millis = predicted_n as f64 / rate * 1000.0;
    let predicted_ms = (rate.is_finite() && rate > 0.0 && millis.is_finite()).then_some(millis);
    serde_json::json!({
        "content": "The bicycle began as a hobby-horse.",
        "timings": {
            "prompt_n": 12,
            "prompt_ms": 3.1,
            "prompt_per_second": 3870.9,
            "predicted_n": predicted_n,
            "predicted_ms": predicted_ms,
            "predicted_per_second": rate,
        },
    })
    .to_string()
}

/// The engine's real `/v1/models` entry (server-context.cpp:4879-4885
/// inside the `data` array of `:4924-4928`), as it lists our alias.
#[cfg(test)]
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(
            id_among(&aliases_body, nonce),
            "our nonce in aliases is ours"
        );
        let nowhere_body = serde_json::json!({
            "object": "list",
            "data": [{
                "id": "owner-inherited-name",
                "aliases": ["other-name"],
                "object": "model",
            }],
        })
        .to_string();
        assert!(
            !id_among(&nowhere_body, nonce),
            "neither id nor aliases: not ours"
        );
        assert!(!id_among(r#"{"data":[]}"#, nonce), "no entries: no proof");
        assert!(
            !id_among(r#"{"data":[{"object":"model"}]}"#, nonce),
            "no id: no proof"
        );
        assert!(!id_among("not json at all", nonce), "unparsable: no proof");
    }

    /// The two roads: the check's raw POST pins its order with
    /// `ignore_eos`; the draft ask goes to the chat road as one user
    /// message, ends at EOS (no `ignore_eos` anywhere), and carries the
    /// seed and the row's sampling.
    #[test]
    fn the_draft_ask_takes_the_chat_road_and_stops_at_eos() {
        let draft = Ask {
            prompt: DRAFT_PROMPT,
            temperature: Some(1.0),
            top_p: Some(0.95),
            top_k: Some(64),
            seed: Some(DRAFT_SEED),
            n_predict: DRAFT_N_PREDICT,
            chat: true,
            min_generated: DRAFT_MIN_GENERATED,
        };
        let (path, body) = ask_body(&draft, DRAFT_N_PREDICT);
        assert_eq!(path, "/v1/chat/completions");
        assert!(
            body.contains("\"role\":\"user\"") && body.contains("riscaldamento"),
            "one user message with the ask's text: {body}"
        );
        assert!(body.contains("\"max_tokens\":128"), "{body}");
        assert!(
            !body.contains("ignore_eos"),
            "an EOS-stopped answer is the point: {body}"
        );
        assert!(body.contains("\"seed\":42"), "{body}");
        assert!(body.contains("\"temperature\":1.0"), "{body}");
        let (check_path, check_body) = ask_body(&CHECK_ASK, CHECK_N_PREDICT);
        assert_eq!(check_path, "/completion");
        assert!(check_body.contains("\"ignore_eos\":true"), "{check_body}");
    }

    /// An EOS-stopped answer below the floor is not a sample; at or above it
    /// is, whatever the order said.
    #[test]
    fn a_short_chat_answer_is_refused_by_the_floor() {
        let draft = Ask {
            prompt: DRAFT_PROMPT,
            temperature: None,
            top_p: None,
            top_k: None,
            seed: None,
            n_predict: DRAFT_N_PREDICT,
            chat: true,
            min_generated: DRAFT_MIN_GENERATED,
        };
        assert_eq!(
            rate_from(&body(47, 12.0), draft.min_generated),
            None,
            "under the floor: not a measurement"
        );
        assert_eq!(
            rate_from(&body(48, 12.0), draft.min_generated),
            Some(12.0),
            "at the floor: the answer said enough"
        );
    }

    #[test]
    fn a_complete_answer_is_the_rate_it_reports() {
        assert_eq!(rate_from(&body(64, 45.4), DRAFT_MIN_GENERATED), Some(45.4));
        assert_eq!(rate_from(&body(128, 11.8), DRAFT_MIN_GENERATED), Some(11.8));
    }

    /// One token short of the order is not a sample: the run decoded
    /// something other than the work we asked for, and its rate is not
    /// the rate of that work.
    #[test]
    fn fewer_tokens_than_ordered_is_no_sample() {
        assert_eq!(rate_from(&body(47, 99.9), DRAFT_MIN_GENERATED), None);
        assert_eq!(rate_from(&body(0, 99.9), DRAFT_MIN_GENERATED), None);
    }

    /// A rate that cannot be a measurement is not one, however the JSON
    /// spells it.
    #[test]
    fn a_rate_that_is_not_a_measurement_is_no_sample() {
        assert_eq!(rate_from(&body(64, 0.0), DRAFT_MIN_GENERATED), None);
        assert_eq!(rate_from(&body(64, -1.0), DRAFT_MIN_GENERATED), None);
        assert_eq!(rate_from(&body(64, f64::NAN), DRAFT_MIN_GENERATED), None);
    }

    #[test]
    fn an_answer_without_timings_is_no_sample() {
        assert_eq!(rate_from(r#"{"content":"hi"}"#, DRAFT_MIN_GENERATED), None);
        assert_eq!(
            rate_from(r#"{"timings":{"predicted_n":64}}"#, DRAFT_MIN_GENERATED),
            None
        );
        assert_eq!(rate_from("not json at all", DRAFT_MIN_GENERATED), None);
    }
}

#[cfg(test)]
mod check_tests {
    use super::*;
    use std::net::TcpListener;

    /// One request read to the end of its body — headers, then the
    /// content-length bytes (a GET has none). The stubs drain before
    /// answering: bytes still unread at close reset the connection and
    /// eat the reply.
    fn drain_request(stream: &mut std::net::TcpStream) {
        use std::io::Read;
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
    }

    /// A stand-in server on loopback: each of its next `requests`
    /// connections is drained and answered with `reply`, verbatim.
    fn stub_server(requests: usize, reply: String) -> SocketAddr {
        stub_server_reported(requests, reply).0
    }

    /// The same stand-in, reporting whether each reply actually left the
    /// socket: a refusal is only proof if the reply was really sent.
    fn stub_server_reported(
        requests: usize,
        reply: String,
    ) -> (SocketAddr, std::sync::mpsc::Receiver<bool>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        // A stub whose ask never comes must not park its thread in
        // accept forever; the bound outlives every ask in these tests.
        listener.set_nonblocking(true).expect("nonblocking");
        let (sent_tx, sent_rx) = std::sync::mpsc::channel();
        let give_up_at = std::time::Instant::now() + Duration::from_secs(30);
        std::thread::spawn(move || {
            for _ in 0..requests {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            // accept(2) hands O_NONBLOCK over on macOS/BSD:
                            // the socket drains and writes as blocking.
                            stream.set_nonblocking(false).expect("blocking");
                            break stream;
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            if std::time::Instant::now() > give_up_at {
                                return;
                            }
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => return,
                    }
                };
                let reply = reply.clone();
                let sent_tx = sent_tx.clone();
                std::thread::spawn(move || {
                    use std::io::Write;
                    drain_request(&mut stream);
                    let _ = sent_tx.send(stream.write_all(reply.as_bytes()).is_ok());
                });
            }
        });
        (addr, sent_rx)
    }

    /// A 302 whose Location points at a listener this test owns — bound
    /// non-blocking and never accepted — so a dial at the redirect's
    /// destination is observable. Its body is a perfect rate on purpose:
    /// only the status may refuse it.
    struct Redirect {
        addr: SocketAddr,
        target: TcpListener,
        /// Reports, per connection, whether the redirect actually left.
        sent: std::sync::mpsc::Receiver<bool>,
    }

    impl Redirect {
        /// True once anything has dialled the destination: a followed
        /// redirect completes its connect while the ask is still running,
        /// so by the answer the dial (or its absence) is settled.
        fn target_dialled(&self) -> bool {
            match self.target.accept() {
                Ok(_) => true,
                // Nothing dialled is a plain WouldBlock; any other answer
                // fails loud rather than green.
                Err(error) => error.kind() != std::io::ErrorKind::WouldBlock,
            }
        }

        /// True once the redirect has actually been written: a listener
        /// that never answered would be refused too, so the refusals are
        /// only meaningful when this holds.
        fn reply_written(&self) -> bool {
            matches!(self.sent.recv_timeout(Duration::from_secs(2)), Ok(true))
        }
    }

    /// The fixture behind both refusal tests: `requests` connections,
    /// each answered with the same redirect.
    fn redirect(requests: usize) -> Redirect {
        let target = TcpListener::bind("127.0.0.1:0").expect("bind");
        target.set_nonblocking(true).expect("nonblocking");
        let target_addr = target.local_addr().expect("addr");
        let fake = br#"{"timings":{"predicted_n":16,"predicted_per_second":99.9}}"#;
        let reply = format!(
            "HTTP/1.1 302 Found\r\nlocation: http://{target_addr}/\r\ncontent-length: {}\r\n\r\n{}",
            fake.len(),
            String::from_utf8_lossy(fake)
        );
        let (addr, sent) = stub_server_reported(requests, reply);
        Redirect { addr, target, sent }
    }

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
    /// Nothing here depends on how fast the local hop is; what the
    /// classification still needs is the responder having answered inside
    /// the ask, which the ask's own bound gives it.
    #[test]
    fn a_redirect_is_refused_and_never_dialled() {
        let redirect = redirect(2);
        let answer = checked_rate(redirect.addr, Duration::from_millis(500));
        assert!(
            !redirect.target_dialled(),
            "the redirect target was dialled"
        );
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
                    let _ =
                        stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 1000\r\n\r\nshort");
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

    /// The success path, end to end: a 200 carrying the body the engine
    /// really writes comes back as the rate the parser reads out of it —
    /// the check must accept, not only refuse.
    #[test]
    fn a_real_answer_comes_back_as_its_rate() {
        let payload = body(CHECK_N_PREDICT, 45.4);
        let reply = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n{}",
            payload.len(),
            payload
        );
        let addr = stub_server(2, reply);
        match checked_rate(addr, Duration::from_millis(500)) {
            Answer::Rate(rate) => assert_eq!(rate, 45.4, "the rate the body reported"),
            Answer::Timeout => panic!("a served answer must not read as slow"),
            Answer::Failed => panic!("a real 200 answer must not read as a failure"),
        }
    }

    /// The identity GET holds the same bound as the POST: a 3xx is not a
    /// listing, and its destination is never dialled — the default agent
    /// would follow it out of the bound.
    #[test]
    fn serves_id_refuses_a_redirect_and_never_dials_it() {
        let nonce = "kalsa-tune-00112233445566778899aabbccddeeff";
        let redirect = redirect(1);
        let seen = serves_id(redirect.addr, nonce, Duration::from_millis(500));
        assert!(
            redirect.reply_written(),
            "the redirect was never sent, so the refusals above mean nothing"
        );
        assert!(!seen, "a redirect is not our server's listing");
        assert!(
            !redirect.target_dialled(),
            "the redirect target was dialled"
        );
    }

    /// The status gates the identity body: a refused 3xx comes back as
    /// an Ok (the guard's own case), a 5xx as an Err before any body is
    /// read (ureq-2.12.1 request.rs:169) — and a listing of our nonce
    /// counts only under a 2xx that was really sent.
    #[test]
    fn a_non_2xx_body_is_not_our_servers_listing() {
        let nonce = "kalsa-tune-00112233445566778899aabbccddeeff";
        for status in ["302 Found", "500 Internal Server Error"] {
            let payload = models_json(nonce);
            let reply = format!(
                "HTTP/1.1 {status}\r\ncontent-length: {}\r\n\r\n{}",
                payload.len(),
                payload
            );
            let (addr, sent) = stub_server_reported(1, reply);
            let seen = serves_id(addr, nonce, Duration::from_millis(500));
            assert!(
                matches!(sent.recv_timeout(Duration::from_secs(2)), Ok(true)),
                "the {status} was never sent, so the refusal above means nothing"
            );
            assert!(!seen, "a {status} body is not our server's listing");
        }
    }
}
