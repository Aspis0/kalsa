use kalsa_engines::{chip_label, figure_label, gain_label, gain_of, Benchmark, Engine, Kind};

use crate::html::escape;
use crate::layout::page;

fn kind_tag(kind: Kind) -> &'static str {
    match kind {
        Kind::Reference => "reference",
        Kind::Fork => "fork",
        Kind::Engine => "engine",
    }
}

pub fn engine_path(id: &str) -> String {
    format!("engines/{id}/index.html")
}

pub fn home(engines: &[Engine]) -> String {
    let first = engines.first().map(|engine| engine_path(&engine.id)).unwrap_or_default();
    let body = r#"
<section class="top">
  <h1>Local inference engines, described plainly.</h1>
  <p class="lede">One page per project, with its licence, author and published numbers. Every number shows the machine it came from.</p>
  <div class="cta"><a class="btn" href="FIRST">Browse the engines</a></div>
</section>
"#
    .replace("FIRST", &first);
    page("Kalsa — local inference engines", "", &first, &body)
}

fn benchmark_card(benchmark: &Benchmark) -> String {
    let figure = figure_label(benchmark).unwrap_or_else(|| "published result".to_string());
    let baseline = benchmark
        .baseline_decode_tok_s
        .or(benchmark.baseline_prefill_tok_s)
        .map(|value| format!(" vs {value} tok/s on {}", escape(&benchmark.baseline)))
        .unwrap_or_default();
    let gain = gain_of(benchmark).map(gain_label).unwrap_or_default();
    format!(
        r#"<article class="card">
  <span class="cl">Claimed by the author</span>
  <div class="bm">{model} <span>{quant}</span></div>
  <div class="cmp"><span class="g num">{figure}</span><span class="k">{gain}{baseline}</span></div>
  <div class="m">Measured on {chip}</div>
  <div class="sm">{machine}{note}</div>
  <div class="sm"><a href="{source}">Source</a></div>
</article>"#,
        model = escape(&benchmark.model),
        quant = escape(&benchmark.quant),
        figure = escape(&figure),
        gain = escape(&gain),
        baseline = baseline,
        chip = escape(&chip_label(benchmark)),
        machine = escape(&benchmark.machine),
        note = benchmark
            .note
            .as_ref()
            .map(|note| format!(" — {}", escape(note)))
            .unwrap_or_default(),
        source = escape(&benchmark.source),
    )
}

pub fn engine(engine: &Engine, first_path: &str) -> String {
    let cards = if engine.benchmark.is_empty() {
        r#"<div class="refbox">A reference engine is the baseline other engines are measured against, so it has no comparison of its own.</div>"#.to_string()
    } else {
        engine.benchmark.iter().map(benchmark_card).collect::<String>()
    };
    let hardware = engine
        .hardware
        .iter()
        .map(|tag| format!("<span class=\"tg\">{tag}</span>"))
        .collect::<String>();
    let body = format!(
        r#"<div class="crumb"><a href="../../index.html">Home</a> / Engines / {name}</div>
<section class="title">
  <h1>{name}</h1>
</section>
<p class="sm">Made by {author} at github.com/{repo}. {summary}</p>
<div class="tags">{kind}<span class="tg lic">{licence}</span>{hardware}</div>
<h2 style="margin-top:32px;font-size:26px">Published benchmarks</h2>
<div class="grid">{cards}</div>"#,
        name = escape(&engine.name),
        author = escape(&engine.author),
        repo = escape(&engine.repo),
        summary = escape(&engine.summary),
        kind = format!(
            "<span class=\" tg {kind}\">{label}</span>",
            kind = kind_tag(engine.kind),
            label = kind_tag(engine.kind),
        ),
        licence = escape(&engine.license),
        hardware = hardware,
        cards = cards,
    );
    page(&engine.name, "../../", first_path, &body)
}
