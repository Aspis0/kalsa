//! The pages that are mostly words: the rules, submit, app, sign-in and privacy. Their copy lives in `site/templates`.

use kalsa_engines::{Benchmark, Engine, Kind};

use crate::html::{escape, HELP, MAIN};
use crate::layout::{page, Meta};
use crate::paths;

const RULES: &str = include_str!("../../../site/templates/listed-and-community.html");
const SUBMIT: &str = include_str!("../../../site/templates/submit.html");
const APP: &str = include_str!("../../../site/templates/app.html");
const SIGNIN: &str = include_str!("../../../site/templates/signin.html");
const REMOVE: &str = include_str!("../../../site/templates/remove.html");
const PRIVACY: &str = include_str!("../../../site/templates/privacy.html");

fn prose(dir: &str, active: &str, title: &str, description: &str, template: &str, extra: &[(&str, String)], scripts: &[&str]) -> String {
    let path = paths::section(dir);
    let mut body = template
        .replace("{{root}}", &paths::root_for(&path))
        .replace("{{help}}", HELP)
        .replace("{{main}}", MAIN);
    for (key, value) in extra {
        body = body.replace(key, value);
    }
    page(&Meta { title, description, path: &path, active, scripts }, &body)
}

pub fn listed_and_community() -> String {
    prose(
        "listed-and-community",
        "rules",
        "Listed and community engines | Kalsa",
        "What the Listed mark needs, what counts as better, how we judge the proof, and what a review means.",
        RULES,
        &[],
        &[],
    )
}

pub fn app() -> String {
    prose("app", "app", "App | Kalsa", "A small desktop app that lets you try an engine from the Kalsa database with one click. It is not available yet.", APP, &[], &[])
}

pub fn signin() -> String {
    prose(
        "signin",
        "signin",
        "Sign in | Kalsa",
        "Sign in to Kalsa with Hugging Face, GitHub or GitLab: what is kept, and what is not.",
        SIGNIN,
        &[],
        &[],
    )
}

pub fn privacy() -> String {
    prose(
        "privacy",
        "",
        "Privacy notice | Kalsa",
        "What Kalsa keeps when you sign in, why, for how long, and how to have it removed.",
        PRIVACY,
        &[],
        &[],
    )
}

/// The confirmation page every "Remove this page" link points at. Its script reads the kind and id from the query.
pub fn remove() -> String {
    prose(
        "remove",
        "",
        "Remove this page | Kalsa",
        "The owner of an engine or developer page can remove it at once, by signing in with GitHub.",
        REMOVE,
        &[],
        &["remove.js"],
    )
}

/// Whole numbers keep one decimal; everything else shows as published.
fn tok(value: f64) -> String {
    if value.fract() == 0.0 { format!("{value:.1}") } else { value.to_string() }
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

/// The submit page's example is invented, not a catalog entry: a removal must never take the example
/// with it, and the page must never republish a real engine's data.
const EXAMPLE: &str = r#"
[[engine]]
id = "example-engine"
name = "Example engine"
repo = "your-name/example-engine"
author = "your-name"
license = "MIT"
kind = "engine"
hardware = ["apple-m1"]
summary = "Runs a model on your own computer."

[[engine.benchmark]]
source = "https://github.com/your-name/example-engine"
machine = "Apple M1 Max"
chip_tag = "apple-m1"
model = "Example 7B"
quant = "Q4_K_M"
decode_tok_s = 40.0
prefill_tok_s = 300.0
baseline = "the same build with the feature off"
feature_off = true
baseline_decode_tok_s = 30.0
baseline_prefill_tok_s = 280.0
"#;

pub fn submit() -> String {
    let example = kalsa_engines::parse(EXAMPLE).expect("the example entry is a valid catalog entry");
    let entry = entry_toml(&example.engine[0]);
    prose(
        "submit",
        "submit",
        "List your engine | Kalsa",
        "Two ways to add an engine to the Kalsa database: in the catalog by pull request, or as a community listing by signing in with GitHub or GitLab.",
        SUBMIT,
        &[("{{entry}}", escape(&entry))],
        &[],
    )
}
