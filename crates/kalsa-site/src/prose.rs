//! The pages that are mostly words: how we choose, submit, download. Their copy lives in `site/templates`.

use kalsa_engines::{Benchmark, Catalog, Engine, Kind};

use crate::bench::tok;
use crate::html::{escape, HELP, SUPPORT};
use crate::layout::{page, Meta};
use crate::paths;

const HOW: &str = include_str!("../../../site/templates/how-we-choose.html");
const SUBMIT: &str = include_str!("../../../site/templates/submit.html");
const DOWNLOAD: &str = include_str!("../../../site/templates/download.html");

fn prose(dir: &str, active: &str, title: &str, description: &str, template: &str, extra: &[(&str, String)]) -> String {
    let path = paths::section(dir);
    let mut body = template
        .replace("{{root}}", &paths::root_for(&path))
        .replace("{{help}}", HELP)
        .replace("{{support}}", SUPPORT);
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
        "The rules an engine must pass to be listed on Kalsa, what the badge means, the safety note, and listing and removal.",
        HOW,
        &[],
    )
}

pub fn download() -> String {
    prose("download", "", "Download Kalsa for macOS", "Kalsa for macOS: the app that installs and runs local inference engines. The 0.1 build is unsigned.", DOWNLOAD, &[])
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
        "Two ways to list an engine on Kalsa: in the catalog by pull request, or as a community listing by signing in with GitHub or GitLab.",
        SUBMIT,
        &[("{{entry}}", escape(&entry))],
    )
}
