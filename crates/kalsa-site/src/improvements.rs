//! The "Improvements" section of an engine page: the speed its benchmarks show and everything else it declares.

use kalsa_engines::{Engine, Improvement, ImprovementKind};

use crate::html::{escape, safe_href};

fn plain(value: f64) -> String {
    if value.fract() == 0.0 { format!("{value:.0}") } else { value.to_string() }
}

/// The numbers a kind carries, as one line: before and after, or model size, memory and speed.
fn figures(item: &Improvement) -> String {
    match (item.kind, item.before, item.after, &item.unit, item.model_gib, item.memory_gb, item.tok_s) {
        (_, Some(before), Some(after), Some(unit), ..) => format!("{} to {} {}", plain(before), plain(after), escape(unit)),
        (ImprovementKind::BiggerModels, _, _, _, Some(size), Some(memory), Some(speed)) => {
            format!("{} GiB model on {} GB of memory, {} tok/s", plain(size), plain(memory), plain(speed))
        }
        _ => String::new(),
    }
}

fn entry(kind: ImprovementKind, summary: &str, place: &str, figures: &str, source: &str, tradeoff: Option<&str>) -> String {
    let figures = if figures.is_empty() { String::new() } else { format!("<p class=\"sm num\">{figures}</p>") };
    let tradeoff = tradeoff.map(|text| format!("<p class=\"trade\"><b>Trade-off.</b> {}</p>", escape(text))).unwrap_or_default();
    format!(
        "<div class=\"impitem\"><div class=\"ih\"><span class=\"tg imp\">{label}</span><span class=\"sm\">{place}</span></div><p class=\"isum\">{summary}</p>{figures}\
         <p class=\"sm\">Claimed by the author. <a class=\"lnk\" href=\"{source}\">Source</a></p>{tradeoff}</div>",
        label = kind.label(),
        place = escape(place),
        summary = escape(summary),
        source = safe_href(source),
    )
}

/// One entry for each speed gain that clears the 5% band, decode and prefill apart.
fn speed_entries(engine: &Engine) -> String {
    let mut out = String::new();
    for benchmark in &engine.benchmark {
        for (kind, gain) in [(ImprovementKind::FasterDecode, &benchmark.gains.decode), (ImprovementKind::FasterPrefill, &benchmark.gains.prefill)] {
            let Some(gain) = gain.as_ref().filter(|gain| gain.is_gain()) else { continue };
            let summary = format!("{} against {}", gain.label, benchmark.baseline);
            let place = format!("{} · {}", benchmark.machine, benchmark.model);
            out += &entry(kind, &summary, &place, "", &benchmark.source, None);
        }
    }
    out
}

fn declared_entries(engine: &Engine) -> String {
    engine
        .improvement
        .iter()
        .map(|item| {
            let place = match &item.model {
                Some(model) => format!("{} · {model}", item.machine),
                None => item.machine.clone(),
            };
            entry(item.kind, &item.summary, &place, &figures(item), &item.source, item.tradeoff.as_deref())
        })
        .collect()
}

/// Empty when the engine declares nothing and shows no speed gain (a reference engine, for one).
pub fn improvements_section(engine: &Engine) -> String {
    let items = format!("{}{}", declared_entries(engine), speed_entries(engine));
    if items.is_empty() {
        return String::new();
    }
    format!("<h3 id=\"improvements\">Improvements</h3><p class=\"sm\">Each one is claimed by its author. A difference under 5% is noise and is not listed.</p><div class=\"impl\">{items}</div>")
}
