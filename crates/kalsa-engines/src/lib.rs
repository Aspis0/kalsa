//! Parse and rank the engine catalog. No I/O, no network, no machine probing:
//! callers hand in the TOML text and a `Machine`, and get ranked picks back.

use std::cmp::Ordering;
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

mod display;
mod install;
mod review;

pub use display::{chip_label, figure_label, gain_label, gain_of};
pub use install::{Install, Tooling};
use review::Review;

const KNOWN_TAGS: &[&str] = &[
    "apple-m1", "apple-m2", "apple-m3", "apple-m4", "apple-m5", "nvidia", "amd", "intel", "cpu",
];

const OSI_LICENSES: &[&str] = &[
    "Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "GPL-2.0", "GPL-3.0", "LGPL-2.1",
    "LGPL-3.0", "AGPL-3.0", "MPL-2.0", "ISC", "Unlicense",
];

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Reference,
    Fork,
    Engine,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Benchmark {
    pub source: String,
    pub machine: String,
    #[serde(rename(serialize = "chipTag", deserialize = "chip_tag"))]
    pub chip_tag: String,
    pub model: String,
    pub quant: String,
    #[serde(default, rename(serialize = "decodeTokS", deserialize = "decode_tok_s"))]
    pub decode_tok_s: Option<f64>,
    #[serde(default, rename(serialize = "prefillTokS", deserialize = "prefill_tok_s"))]
    pub prefill_tok_s: Option<f64>,
    pub baseline: String,
    #[serde(default, rename(serialize = "baselineDecodeTokS", deserialize = "baseline_decode_tok_s"))]
    pub baseline_decode_tok_s: Option<f64>,
    #[serde(default, rename(serialize = "baselinePrefillTokS", deserialize = "baseline_prefill_tok_s"))]
    pub baseline_prefill_tok_s: Option<f64>,
    #[serde(default)]
    pub note: Option<String>,
}

fn recommendable() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Engine {
    pub id: String,
    pub name: String,
    pub repo: String,
    pub author: String,
    pub license: String,
    pub kind: Kind,
    #[serde(default)]
    pub upstream: Option<String>,
    pub hardware: Vec<String>,
    pub summary: String,
    #[serde(default = "recommendable")]
    pub recommendable: bool,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub benchmark: Vec<Benchmark>,
    #[serde(default, rename(serialize = "reviewed", deserialize = "review"))]
    pub reviewed: Option<Review>,
    #[serde(default)]
    pub install: Option<Install>,
}
#[derive(Debug, Deserialize, Serialize)]
pub struct Catalog {
    pub engine: Vec<Engine>,
    #[serde(default)]
    pub tooling: Option<install::Tooling>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub chip_tag: String,
    pub chip_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub engine_id: String,
    pub benchmark: Option<Benchmark>,
    pub reason: String,
    pub same_chip: bool,
    pub exact_machine: bool,
    pub metric: Option<&'static str>,
    pub figure_label: Option<String>,
    pub gain: Option<f64>,
    pub gain_label: Option<String>,
    pub chip_label: Option<String>,
    pub recommendable: bool,
}

/// Parse the TOML and check the facts the weekly job also checks by hand:
/// shape and internal consistency of the catalog file.
pub fn parse(text: &str) -> Result<Catalog, String> {
    let catalog: Catalog = toml::from_str(text).map_err(|error| error.to_string())?;
    validate(&catalog)?;
    Ok(catalog)
}

fn validate(catalog: &Catalog) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut repos = HashSet::new();
    for engine in &catalog.engine {
        for field in [&engine.id, &engine.name, &engine.repo, &engine.license, &engine.summary] {
            if field.trim().is_empty() {
                return Err(format!("{}: an engine field is empty", engine.id));
            }
        }
        if !ids.insert(engine.id.as_str()) {
            return Err(format!("duplicate engine id {}", engine.id));
        }
        if !repos.insert(engine.repo.as_str()) {
            return Err(format!("duplicate repo {}", engine.repo));
        }
        if !valid_repo(&engine.repo) {
            return Err(format!("{}: repo must be owner/name", engine.id));
        }
        if engine.hardware.is_empty() {
            return Err(format!("{}: hardware is empty", engine.id));
        }
        for tag in &engine.hardware {
            if !KNOWN_TAGS.contains(&tag.as_str()) {
                return Err(format!("{}: unknown hardware tag {tag}", engine.id));
            }
        }
        if engine.kind == Kind::Fork && engine.upstream.as_deref().is_none_or(str::is_empty) {
            return Err(format!("{}: a fork must declare its upstream", engine.id));
        }
        if !OSI_LICENSES.contains(&engine.license.as_str()) {
            return Err(format!("{}: licence {} is not on the OSI list", engine.id, engine.license));
        }
        if let Some(record) = &engine.reviewed {
            review::validate(record, &engine.id)?;
        }
        if let Some(recipe) = &engine.install {
            install::validate(recipe, &engine.id)?;
        }
        validate_benchmarks(engine)?;
    }
    if let Some(tooling) = &catalog.tooling {
        install::validate(&tooling.uv, "tooling.uv")?;
    }
    Ok(())
}

pub(crate) fn valid_repo(repo: &str) -> bool {
    let parts: Vec<&str> = repo.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        })
}

fn validate_benchmarks(engine: &Engine) -> Result<(), String> {
    let mut seen = HashSet::new();
    for benchmark in &engine.benchmark {
        let key = (
            benchmark.source.as_str(),
            benchmark.machine.as_str(),
            benchmark.chip_tag.as_str(),
            benchmark.model.as_str(),
            benchmark.quant.as_str(),
            benchmark.note.as_deref().unwrap_or(""),
            benchmark.decode_tok_s.map(f64::to_bits),
            benchmark.prefill_tok_s.map(f64::to_bits),
        );
        if !seen.insert(key) {
            return Err(format!("{}: duplicate benchmark", engine.id));
        }
        let id = &engine.id;
        if !KNOWN_TAGS.contains(&benchmark.chip_tag.as_str())
            || !engine.hardware.contains(&benchmark.chip_tag)
        {
            return Err(format!("{id}: benchmark tag {} is not in hardware", benchmark.chip_tag));
        }
        for field in [
            &benchmark.source,
            &benchmark.machine,
            &benchmark.model,
            &benchmark.quant,
            &benchmark.baseline,
        ] {
            if field.trim().is_empty() {
                return Err(format!("{id}: a benchmark field is empty"));
            }
        }
        for number in [
            benchmark.decode_tok_s,
            benchmark.prefill_tok_s,
            benchmark.baseline_decode_tok_s,
            benchmark.baseline_prefill_tok_s,
        ] {
            if number.is_some() && !number.is_some_and(|value| value.is_finite() && value > 0.0) {
                return Err(format!("{id}: a tok/s figure is not finite and positive"));
            }
        }
    }
    if engine.kind != Kind::Reference && !engine.benchmark.iter().any(baseline_number) {
        return Err(format!("{}: no benchmark with a baseline number", engine.id));
    }
    Ok(())
}

fn baseline_number(benchmark: &Benchmark) -> bool {
    benchmark.baseline_decode_tok_s.is_some() || benchmark.baseline_prefill_tok_s.is_some()
}

/// The probe's brand string to a catalog tag, with a token boundary so that
/// "Apple M10" cannot be read as "Apple M1".
pub fn chip_tag_for_brand(brand: &str) -> Option<&'static str> {
    let lower = brand.trim().to_ascii_lowercase();
    for (needle, tag) in [
        ("apple m1", "apple-m1"),
        ("apple m2", "apple-m2"),
        ("apple m3", "apple-m3"),
        ("apple m4", "apple-m4"),
        ("apple m5", "apple-m5"),
    ] {
        if let Some(at) = lower.find(needle) {
            let after = &lower[at + needle.len()..];
            if !after.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
                return Some(tag);
            }
        }
    }
    None
}

/// "Apple M1 Max" → "M1 Max"; non-Apple brands keep their own name.
fn chip_key(chip_name: &str) -> &str {
    let name = chip_name.trim();
    name.strip_prefix("Apple ").unwrap_or(name)
}

/// Whole-word match. "M1" must not take an "M1 Max" benchmark as exact.
fn exact_chip(machine_text: &str, chip: &str) -> bool {
    let words: Vec<&str> = machine_text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    let needle: Vec<&str> = chip.split_whitespace().collect();
    if needle.is_empty() || needle.len() > words.len() {
        return false;
    }
    for at in 0..=words.len() - needle.len() {
        if !words[at..at + needle.len()]
            .iter()
            .zip(&needle)
            .all(|(word, wanted)| word.eq_ignore_ascii_case(wanted))
        {
            continue;
        }
        if let Some(next) = words.get(at + needle.len()) {
            let qualifier = next.to_ascii_lowercase();
            if matches!(qualifier.as_str(), "pro" | "max" | "ultra")
                && !needle.iter().any(|word| word.eq_ignore_ascii_case(&qualifier))
            {
                continue;
            }
        }
        return true;
    }
    false
}

fn best_benchmark<'a>(engine: &'a Engine, machine: &Machine, chip: &str) -> Option<&'a Benchmark> {
    engine.benchmark.iter().max_by(|a, b| {
        benchmark_score(a, machine, chip)
            .partial_cmp(&benchmark_score(b, machine, chip))
            .unwrap_or(Ordering::Equal)
    })
}

fn benchmark_score(benchmark: &Benchmark, machine: &Machine, chip: &str) -> (bool, bool, f64) {
    (
        benchmark.chip_tag == machine.chip_tag,
        exact_chip(&benchmark.machine, chip),
        benchmark.decode_tok_s.unwrap_or(0.0),
    )
}

fn explain(engine: &Engine, best: Option<&Benchmark>, same: bool, exact: bool) -> String {
    if engine.kind == Kind::Reference {
        return "Reference baseline; no benchmark in the catalog".to_string();
    }
    let Some(benchmark) = best else {
        return "No published benchmark in the catalog".to_string();
    };
    let where_ = if same && exact {
        "measured on this chip and machine"
    } else if same {
        "measured on this chip"
    } else {
        "published on another chip"
    };
    let speed = match (benchmark.decode_tok_s, benchmark.prefill_tok_s) {
        (Some(decode), Some(prefill)) => {
            format!("decode {decode} tok/s, prefill {prefill} tok/s vs {}", benchmark.baseline)
        }
        (Some(decode), None) => format!("decode {decode} tok/s vs {}", benchmark.baseline),
        (None, Some(prefill)) => {
            format!("prefill {prefill} tok/s (no decode figure) vs {}", benchmark.baseline)
        }
        (None, None) => format!("no tok/s figure vs {}", benchmark.baseline),
    };
    match &benchmark.note {
        Some(note) => format!("{where_}: {speed} in {}; {note}", benchmark.machine),
        None => format!("{where_}: {speed} in {}", benchmark.machine),
    }
}

/// Rank engines that run on this machine's chip. Same-chip benchmarks come
/// first, an exact machine match within them, then decode tok/s. References
/// trail the field, and a non-recommendable engine is always last.
pub fn recommend(machine: &Machine, catalog: &Catalog) -> Vec<Pick> {
    let chip = chip_key(&machine.chip_name);
    let mut picks: Vec<(Rank, Pick)> = catalog
        .engine
        .iter()
        .filter(|engine| engine.hardware.contains(&machine.chip_tag))
        .map(|engine| {
            let best = best_benchmark(engine, machine, chip);
            let score = best.map(|b| benchmark_score(b, machine, chip));
            let rank = Rank {
                recommendable: engine.recommendable,
                not_reference: engine.kind != Kind::Reference,
                same_chip: score.is_some_and(|s| s.0),
                exact: score.is_some_and(|s| s.1),
                decode: score.map(|s| s.2).unwrap_or(0.0),
            };
            let same = score.is_some_and(|s| s.0);
            let exact = score.is_some_and(|s| s.1);
            let gain = best.and_then(display::gain_of);
            (
                rank,
                Pick {
                    engine_id: engine.id.clone(),
                    benchmark: best.cloned(),
                    reason: explain(engine, best, same, exact),
                    same_chip: same,
                    exact_machine: exact,
                    metric: best.map(|b| if b.decode_tok_s.is_some() { "decode" } else { "prefill" }),
                    figure_label: best.and_then(display::figure_label),
                    gain,
                    gain_label: gain.map(display::gain_label),
                    chip_label: best.map(display::chip_label),
                    recommendable: engine.recommendable,
                },
            )
        })
        .collect();
    picks.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.1.engine_id.cmp(&b.1.engine_id))
    });
    picks.into_iter().map(|(_, pick)| pick).collect()
}

#[derive(Clone, Copy, PartialEq, PartialOrd)]
struct Rank {
    recommendable: bool,
    not_reference: bool,
    same_chip: bool,
    exact: bool,
    decode: f64,
}
