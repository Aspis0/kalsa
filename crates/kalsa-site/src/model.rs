//! Views over the catalog that more than one page needs. Labels and figures come from `kalsa-engines`.

use std::collections::BTreeMap;

use kalsa_engines::{chip_generation, chip_label, gain_of, Benchmark, Catalog, Engine};

use crate::facts::Facts;
use crate::html::slug;

pub fn login(engine: &Engine) -> &str {
    engine.repo.split('/').next().unwrap_or_default()
}

pub fn author_name(engine: &Engine) -> &str {
    engine.author.strip_suffix(" (org)").unwrap_or(&engine.author)
}

pub fn is_org(engine: &Engine) -> bool {
    engine.author.ends_with("(org)")
}

pub fn runs_on(engine: &Engine, tag: &str) -> bool {
    engine.hardware.iter().any(|candidate| candidate == tag)
}

/// Engines A to Z, which is the only order any list on the site uses besides "recently added".
pub fn alphabetical(catalog: &Catalog) -> Vec<&Engine> {
    let mut engines: Vec<&Engine> = catalog.engine.iter().collect();
    engines.sort_by_key(|engine| engine.name.to_lowercase());
    engines
}

pub fn has_gain(benchmark: &Benchmark) -> bool {
    gain_of(benchmark).is_some()
}

/// The first published benchmark with a comparison: what a card shows when no chip is in context.
pub fn headline(engine: &Engine) -> Option<&Benchmark> {
    engine.benchmark.iter().find(|benchmark| has_gain(benchmark))
}

/// The benchmark on the nearest chip generation to `tag` (distance 0 is the same family), if any.
pub fn closest_benchmark<'a>(engine: &'a Engine, tag: &str) -> Option<(u8, &'a Benchmark)> {
    let generation = chip_generation(tag);
    engine
        .benchmark
        .iter()
        .filter(|benchmark| has_gain(benchmark))
        .filter_map(|benchmark| {
            let distance = match (generation, chip_generation(&benchmark.chip_tag)) {
                (Some(want), Some(have)) => want.abs_diff(have),
                _ if benchmark.chip_tag == tag => 0,
                _ => return None,
            };
            Some((distance, benchmark))
        })
        .min_by_key(|(distance, _)| *distance)
}

pub struct Developer<'a> {
    pub login: &'a str,
    pub name: &'a str,
    pub org: bool,
    pub engines: Vec<&'a Engine>,
}

pub fn developers(catalog: &Catalog) -> Vec<Developer<'_>> {
    let mut by_login: BTreeMap<String, Developer> = BTreeMap::new();
    for engine in &catalog.engine {
        let entry = by_login.entry(login(engine).to_lowercase()).or_insert_with(|| Developer {
            login: login(engine),
            name: author_name(engine),
            org: is_org(engine),
            engines: Vec::new(),
        });
        entry.engines.push(engine);
    }
    by_login.into_values().collect()
}

/// A hardware page: a whole chip family, or one concrete chip that a benchmark names.
pub struct HardwarePage {
    pub slug: String,
    pub title: String,
    pub tag: String,
    pub chip: Option<String>,
}

pub fn hardware_pages(catalog: &Catalog) -> Vec<HardwarePage> {
    let mut pages: Vec<HardwarePage> = kalsa_engines::FAMILIES
        .iter()
        .map(|tag| HardwarePage { slug: slug(&kalsa_engines::family_label(tag)), title: kalsa_engines::family_label(tag), tag: tag.to_string(), chip: None })
        .collect();
    let mut chips: BTreeMap<String, String> = BTreeMap::new();
    for benchmark in catalog.engine.iter().flat_map(|engine| &engine.benchmark) {
        let label = chip_label(benchmark);
        if chip_generation(&benchmark.chip_tag).is_some() && label.starts_with('M') {
            chips.insert(label, benchmark.chip_tag.clone());
        }
    }
    pages.extend(chips.into_iter().map(|(label, tag)| HardwarePage {
        slug: slug(&format!("Apple {label}")),
        title: format!("Apple {label}"),
        tag,
        chip: Some(label),
    }));
    pages
}

/// The reviewed commit is behind the latest commit GitHub reports: the badge waits for a re-check.
pub fn recheck_pending(engine: &Engine, facts: &Facts) -> bool {
    let Some(review) = &engine.reviewed else { return false };
    let latest = facts.get(&engine.repo).and_then(|fact| fact.latest_commit.as_deref());
    latest.is_some_and(|latest| !latest.starts_with(&review.commit) && !review.commit.starts_with(latest))
}
