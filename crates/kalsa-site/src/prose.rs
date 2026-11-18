//! The pages that are mostly words: how we choose, submit, app. Their copy lives in `site/templates`.

use kalsa_engines::{Benchmark, Catalog, Engine, Kind};

use crate::bench::tok;
use crate::html::{escape, HELP};
use crate::layout::{page, Meta};
use crate::paths;

const HOW: &str = include_str!("../../../site/templates/how-we-choose.html");
const SUBMIT: &str = include_str!("../../../site/templates/submit.html");
const APP: &str = include_str!("../../../site/templates/app.html");

fn prose(dir: &str, active: &str, title: &str, description: &str, template: &str, extra: &[(&str, String)]) -> String {
    let path = paths::section(dir);
    let mut body = template
        .replace("{{root}}", &paths::root_for(&path))
        .replace("{{help}}", HELP);
    for (key, value) in extra {
        body = body.replace(key, value);
    }
    page(&Meta { title, description, path: &path, active, scripts: &[] }, &body)
}

pub fn how_we_choose() -> String {
    prose(
        "how-we-choose",
        "how",
        "How we choose | Kalsa",
        "How Kalsa decides what to list: the rules an engine must pass, what a review looks at, what counts as an improvement, and listing and removal.",
        HOW,
        &[],
    )
}

pub fn app() -> String {
    prose("app", "app", "App | Kalsa", "A small desktop app that lets you try an engine from the Kalsa database with one click. It is not available yet.", APP, &[])
}

fn benchmark_toml(benchmark: &Benchmark) -> String {
    let mut text = format!(
        "\n[[engine.benchmark]]\nsource = \"{}\"\nmachine = \"{}\"\nchip_tag = \"{}\"\nmodel = \"{}\"\nquant = \"{}\"\n",
        benchmark.source, benchmark.machine, benchmark.chip_tag, benchmark.model, benchmark.quant
    );
    for (key, value) in [
        ("decode_tok_s", benchmark.decode_tok_s),
        ("prefill_tok_s", benchmark.prefill_tok_s),
    ] {
        if let Some(value) = value {
            text += &format!("{key} = {}\n", tok(value));
        }
    }
    text += &format!("baseline = \"{}\"\n", benchmark.baseline);
    for (key, value) in [
        ("baseline_decode_tok_s", benchmark.baseline_decode_tok_s),
        ("baseline_prefill_tok_s", benchmark.baseline_prefill_tok_s),
    ] {
        if let Some(value) = value {
            text += &format!("{key} = {}\n", tok(value));
        }
    }
    text
}

/// An entry as it is in the catalog today, as the example on the submit page.
fn entry_toml(engine: &Engine) -> String {
    let kind = match engine.kind {
        Kind::Reference => "reference",
        Kind::Fork => "fork",
        Kind::Engine => "engine",
    };
    let hardware: Vec<String> = engine.hardware.iter().map(|tag| format!("\"{tag}\"")).collect();
    let mut text = format!(
        "[[engine]]\nid = \"{}\"\nname = \"{}\"\nrepo = \"{}\"\nauthor = \"{}\"\nlicense = \"{}\"\nkind = \"{kind}\"\nhardware = [{}]\nsummary = \"{}\"\n",
        engine.id, engine.name, engine.repo, engine.author, engine.license, hardware.join(", "), engine.summary
    );
    if let Some(benchmark) = engine.benchmark.first() {
        text += &benchmark_toml(benchmark);
    }
    text
}

pub fn submit(catalog: &Catalog) -> String {
    let example = catalog.engine.iter().find(|engine| engine.id == "frink").or_else(|| catalog.engine.iter().find(|e| !e.benchmark.is_empty()));
    let entry = example.map(entry_toml).unwrap_or_default();
    prose(
        "submit",
        "submit",
        "List your engine | Kalsa",
        "Two ways to add an engine to the Kalsa database: in the catalog by pull request, or as a community listing by signing in with GitHub or GitLab.",
        SUBMIT,
        &[("{{entry}}", escape(&entry))],
    )
}
