//! One published benchmark as a card: both metrics, the baseline and the chip.

use kalsa_engines::{chip_label, Benchmark, Engine, MetricGain};

use crate::html::{escape, safe_href};
use crate::phrase::gain_text;

/// Whole numbers keep one decimal; everything else shows as published.
pub fn tok(value: f64) -> String {
    if value.fract() == 0.0 { format!("{value:.1}") } else { value.to_string() }
}

fn bar(class: &str, label: &str, value: f64, widest: f64) -> String {
    let percent = if widest > 0.0 { value / widest * 100.0 } else { 0.0 };
    format!(
        "<div class=\"bar{class}\"><span>{label}</span><i class=\"w{width}\"></i><b class=\"num\">{value}</b></div>",
        width = percent.round() as u8,
        label = escape(label),
        value = tok(value),
    )
}

fn metric_rows(name: &str, engine: &str, baseline: &str, value: f64, base: Option<f64>, gain: Option<&MetricGain>) -> String {
    let widest = value.max(base.unwrap_or(0.0));
    let noise = gain.is_some_and(|gain| gain.noise);
    let gain = gain.map(gain_text).unwrap_or_default();
    let base_row = base.map(|base| bar(" base", baseline, base, widest)).unwrap_or_default();
    format!(
        "<div class=\"pair\"><div class=\"ph2\"><b>{name}</b><span class=\"g num{muted}\">{gain}</span></div>{engine}{base_row}</div>",
        muted = if noise { " noise" } else { "" },
        gain = escape(&gain),
        engine = bar("", engine, value, widest),
    )
}

fn metrics(benchmark: &Benchmark, engine: &Engine) -> String {
    let mut out = String::new();
    if let Some(decode) = benchmark.decode_tok_s {
        out += &metric_rows("Decode", &engine.name, &benchmark.baseline, decode, benchmark.baseline_decode_tok_s, benchmark.gains.decode.as_ref());
    }
    if let Some(prefill) = benchmark.prefill_tok_s {
        out += &metric_rows("Prefill", &engine.name, &benchmark.baseline, prefill, benchmark.baseline_prefill_tok_s, benchmark.gains.prefill.as_ref());
    }
    if out.is_empty() {
        let base = benchmark.baseline_decode_tok_s.or(benchmark.baseline_prefill_tok_s).unwrap_or(0.0);
        out = format!("<div class=\"pair\">{}</div>", bar(" base", &benchmark.baseline, base, base));
    }
    out
}

/// `same_as` is the chip the page is about; a number from another chip says so, in words.
pub fn bench_block(benchmark: &Benchmark, engine: &Engine, same_as: Option<&str>) -> String {
    let chip = chip_label(benchmark);
    let context = match same_as {
        Some(wanted) if wanted == chip => String::new(),
        Some(_) => ", a different chip".to_string(),
        None => String::new(),
    };
    let same = same_as == Some(chip.as_str());
    let quant = if benchmark.quant == "unstated" { "quant not stated".to_string() } else { benchmark.quant.clone() };
    format!(
        "<div class=\"bc{same_class}\"><div class=\"bh\"><span class=\"wh{wh}\">Measured on {chip}{context}</span></div>\
         <h4>{model} <span>{quant}</span></h4><p class=\"sm\">tok/s</p>{metrics}\
         <p class=\"mc\">{machine}{note}<br><a href=\"{source}\">{shown}</a></p></div>",
        same_class = if same { " sameb" } else { "" },
        wh = if same { " same" } else { "" },
        chip = escape(&chip),
        context = escape(&context),
        model = escape(&benchmark.model),
        quant = escape(&quant),
        metrics = metrics(benchmark, engine),
        machine = escape(&benchmark.machine),
        note = benchmark.note.as_deref().map(|note| format!("<br>{}", escape(note))).unwrap_or_default(),
        source = safe_href(&benchmark.source),
        shown = escape(benchmark.source.trim_start_matches("https://")),
    )
}
