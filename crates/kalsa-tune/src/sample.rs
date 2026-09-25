//! One request, one number: ask a live server for decode and keep the
//! rate only when the answer proves it decoded what we ordered.

use std::net::SocketAddr;
use std::time::Duration;

use serde_json::Value;

/// Every sample decodes exactly this many tokens — `ignore_eos` holds the
/// server to it — so rates from different builds are the same work made.
const N_PREDICT: u64 = 64;

/// One fixed prompt: the same work for every candidate, a plain factual
/// paragraph no model is tempted to end early or refuse.
const PROMPT: &str = "Write a short paragraph about the history of the bicycle.";

/// The decode rate the server itself measured, or nothing: fewer tokens
/// than ordered (the answer proved less than we asked for), no timings
/// block, or a rate that is not a positive finite number — none of those
/// is a measurement.
pub(crate) fn rate_from(body: &str) -> Option<f64> {
    let parsed: Value = serde_json::from_str(body).ok()?;
    let timings = parsed.get("timings")?;
    if timings.get("predicted_n")?.as_u64()? < N_PREDICT {
        return None;
    }
    let rate = timings.get("predicted_per_second")?.as_f64()?;
    (rate.is_finite() && rate > 0.0).then_some(rate)
}

/// One POST to llama-server's `/completion` — the endpoint that takes
/// `n_predict` and reports `timings`. Anything that is not a 2xx with a
/// parseable body is no sample: a server still loading answers 503, a
/// build without the endpoint answers 404, and neither is this crate's
/// problem to surface — it is a lifetime with no usable answer.
pub(crate) fn request(addr: SocketAddr, timeout: Duration) -> Option<f64> {
    let body = serde_json::json!({
        "prompt": PROMPT,
        "n_predict": N_PREDICT,
        "ignore_eos": true,
        "temperature": 0.0,
        "cache_prompt": false,
    })
    .to_string();
    let reply = ureq::post(&format!("http://{addr}/completion"))
        .timeout(timeout)
        .send_string(&body);
    match reply {
        Ok(response) => rate_from(&response.into_string().ok()?),
        Err(_) => None,
    }
}

/// True when the port lists OUR nonce among `/v1/models`'s entries — the
/// only proof the 200s and the rates came from our child: the engine
/// builds each entry as `{"id", meta.model_name}` inside a `data` array
/// (kalsallama `tools/server/server-context.cpp:4879-4885`, wrapped at
/// `:4924-4928`), and `--alias` is what `model_name` is filled from (see
/// `measure.rs`'s `without_aliases`).
pub(crate) fn serves_id(addr: SocketAddr, nonce: &str, timeout: Duration) -> bool {
    let reply = ureq::get(&format!("http://{addr}/v1/models")).timeout(timeout).call();
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
            entries
                .iter()
                .any(|entry| entry.get("id").and_then(Value::as_str) == Some(nonce))
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
        assert!(!id_among(r#"{"data":[]}"#, nonce), "no entries: no proof");
        assert!(!id_among(r#"{"data":[{"object":"model"}]}"#, nonce), "no id: no proof");
        assert!(!id_among("not json at all", nonce), "unparsable: no proof");
    }

    #[test]
    fn a_complete_answer_is_the_rate_it_reports() {
        assert_eq!(rate_from(&body(64, 45.4)), Some(45.4));
        assert_eq!(rate_from(&body(128, 11.8)), Some(11.8));
    }

    /// One token short of the order is not a sample: the run decoded
    /// something other than the work we asked for, and its rate is not
    /// the rate of that work.
    #[test]
    fn fewer_tokens_than_ordered_is_no_sample() {
        assert_eq!(rate_from(&body(63, 99.9)), None);
        assert_eq!(rate_from(&body(0, 99.9)), None);
    }

    /// A rate that cannot be a measurement is not one, however the JSON
    /// spells it.
    #[test]
    fn a_rate_that_is_not_a_measurement_is_no_sample() {
        assert_eq!(rate_from(&body(64, 0.0)), None);
        assert_eq!(rate_from(&body(64, -1.0)), None);
        assert_eq!(rate_from(&body(64, f64::NAN)), None);
    }

    #[test]
    fn an_answer_without_timings_is_no_sample() {
        assert_eq!(rate_from(r#"{"content":"hi"}"#), None);
        assert_eq!(rate_from(r#"{"timings":{"predicted_n":64}}"#), None);
        assert_eq!(rate_from("not json at all"), None);
    }
}
