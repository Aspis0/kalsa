//! The "Benchmarks" section of an engine page: one plain sentence per published run.

use kalsa_engines::{Benchmark, Catalog, Engine, Kind, MetricGain};

use crate::html::{escape, safe_href};

fn plain(value: f64) -> String {
    if value.fract() == 0.0 { format!("{value:.0}") } else { value.to_string() }
}

/// "decodes at 122 tok/s, against 83.2 tok/s for llama.cpp (+47%)". A difference under 5% reads "about the same speed".
fn metric(verb: &str, value: Option<f64>, base: Option<f64>, gain: Option<&MetricGain>, baseline: &str) -> Option<String> {
    let value = value?;
    Some(match (base, gain) {
        (Some(base), Some(gain)) if gain.noise => format!("{verb} at {} tok/s, about the same speed as {} ({} tok/s)", plain(value), escape(baseline), plain(base)),
        (Some(base), Some(gain)) => format!("{verb} at {} tok/s, against {} tok/s for {} ({})", plain(value), plain(base), escape(baseline), escape(&gain.gain_label)),
        _ => format!("{verb} at {} tok/s", plain(value)),
    })
}

fn row(benchmark: &Benchmark) -> String {
    let gains = &benchmark.gains;
    let baseline = benchmark.baseline_engine.as_deref().unwrap_or(&benchmark.baseline);
    let parts: Vec<String> = [
        metric("decodes", benchmark.decode_tok_s, benchmark.baseline_decode_tok_s, gains.decode.as_ref(), baseline),
        metric("reads prompts", benchmark.prefill_tok_s, benchmark.baseline_prefill_tok_s, gains.prefill.as_ref(), baseline),
    ]
    .into_iter()
    .flatten()
    .collect();
    let note = benchmark.note.as_deref().map(|text| format!(" Note: {}", escape(text))).unwrap_or_default();
    format!(
        "<li>On {machine} with {model} ({quant}), it {parts}. <a class=\"lnk\" href=\"{source}\">Source</a>{note}</li>",
        machine = escape(&benchmark.machine),
        model = escape(&benchmark.model),
        quant = escape(&benchmark.quant),
        parts = parts.join(", and it "),
        source = safe_href(&benchmark.source),
    )
}

/// True when some entry's benchmark is measured against this engine, so the claim "others measure against it" is a fact.
fn is_a_baseline(catalog: &Catalog, engine: &Engine) -> bool {
    catalog.engine.iter().flat_map(|other| &other.benchmark).any(|benchmark| benchmark.baseline_engine.as_deref() == Some(engine.name.as_str()))
}

pub fn benchmarks_section(catalog: &Catalog, engine: &Engine) -> String {
    let body = if engine.benchmark.is_empty() {
        let text = if engine.kind == Kind::Reference && is_a_baseline(catalog, engine) {
            "Other engines measure themselves against this one, so it has no benchmarks of its own."
        } else {
            "The author hasn't published benchmarks yet."
        };
        format!("<p>{text}</p>")
    } else {
        format!("<ul class=\"plain rows\">{}</ul>", engine.benchmark.iter().map(row).collect::<String>())
    };
    format!("<h3 id=\"benchmarks\">Benchmarks</h3>{body}")
}
