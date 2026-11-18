//! One page per engine: credit, published comparisons, review, what installing does.

use kalsa_engines::{chip_label, hardware_labels, Catalog, Engine, Install, Kind};

use crate::bench::bench_block;
use crate::cards::{avatar, github_url, tags};
use crate::facts::{stars_label, Facts};
use crate::html::{escape, safe_href, slug};
use crate::layout::{page, Meta};
use crate::model::{author_name, is_org, login, pairs};
use crate::paths;
use crate::review::{badge_box, review_section};
use crate::widgets::{claim_line, url_bar};

fn install_download_row(engine: &Engine) -> (String, String) {
    let text = match &engine.install {
        Some(Install::ReleaseArchive { url, tag, sha256, size, .. }) => format!(
            "The {name} release {tag} from {url}: {mb:.1} MB, checked against sha256 {short} before it is used.",
            name = escape(&engine.name),
            tag = escape(tag),
            url = escape(url),
            mb = *size as f64 / 1_048_576.0,
            short = escape(&sha256.chars().take(8).collect::<String>()),
        ),
        Some(Install::Pip { package, version, python, .. }) => format!(
            "The {package} {version} package from PyPI, installed into its own Python {python} environment with uv from a lock file, every package checked by hash.",
            package = escape(package),
            version = escape(version),
            python = escape(python),
        ),
        None => format!("The official release or package of github.com/{}: one pinned version, checked against its checksum. Nothing from other websites.", escape(&engine.repo)),
    };
    ("What is downloaded, and from where".to_string(), text)
}

/// The rows of "Before you install". Download, folder and uninstall are claimed only for an engine with an install recipe.
fn install_rows(engine: &Engine) -> Vec<(String, String)> {
    let mut rows = Vec::new();
    if let Some(note) = engine.note.as_deref().filter(|note| note.starts_with("Requires")) {
        rows.push(("Needs another app first".to_string(), format!("{} Kalsa will not install that for you; it tells you when it is missing.", escape(note))));
    }
    if engine.install.is_some() {
        rows.push(install_download_row(engine));
        rows.push(("Where it goes".to_string(), format!("Its own folder: <code>~/Library/Application Support/Kalsa/engines/{}/</code>. Nothing is placed anywhere else.", escape(&engine.id))));
    } else {
        rows.push((
            "Install in Kalsa".to_string(),
            format!(
                "Installing through Kalsa isn't available yet. Follow the project's own instructions: <a class=\"lnk\" href=\"{}\">github.com/{}</a>.",
                safe_href(&github_url(&engine.repo)),
                escape(&engine.repo)
            ),
        ));
    }
    rows.push(("Who it runs as".to_string(), "An engine runs as you, with access to your files. macOS does not sandbox it, so install only what you trust.".to_string()));
    if engine.install.is_some() {
        rows.push(("Who can reach it".to_string(), "Kalsa starts it on <code>127.0.0.1</code> only. Other devices on your network cannot connect.".to_string()));
        rows.push(("Uninstall".to_string(), "Removing it deletes that folder.".to_string()));
    }
    rows
}

fn accordions(engine: &Engine) -> String {
    install_rows(engine).iter().map(|(title, text)| format!("<details class=\"acc\"><summary>{title}</summary><p>{text}</p></details>")).collect()
}

fn metrics_note(engine: &Engine) -> &'static str {
    let decode = engine.benchmark.iter().any(|b| b.decode_tok_s.is_some());
    let prefill = engine.benchmark.iter().any(|b| b.prefill_tok_s.is_some());
    match (decode, prefill) {
        (true, true) => "Decode and prefill are shown separately.",
        (true, false) => "Decode only here; no prefill numbers were published for these runs.",
        (false, true) => "Prefill only here; no decode numbers were published for these runs.",
        (false, false) => "",
    }
}

fn comparisons(engine: &Engine) -> String {
    if engine.benchmark.is_empty() {
        return match (engine.kind, engine.note.as_deref()) {
            (Kind::Reference, _) => "<div class=\"refbox\">A reference engine is the baseline other engines are measured against, so it has no comparison of its own.</div>".to_string(),
            (_, Some(note)) => format!("<div class=\"refbox\"><b>No like-for-like comparison.</b> The author's own words: {}</div>", escape(note)),
            _ => "<div class=\"refbox\">No comparison has been published.</div>".to_string(),
        };
    }
    let blocks: String = engine.benchmark.iter().map(|benchmark| bench_block(benchmark, engine, None)).collect();
    format!(
        "<p class=\"sm\">Claimed by the author, with the source linked on each. {} Kalsa has not re-run them.</p><div class=\"bgrid\">{blocks}</div>",
        metrics_note(engine)
    )
}

fn compare_links(catalog: &Catalog, engine: &Engine) -> String {
    let links: String = pairs(catalog)
        .iter()
        .filter(|pair| pair.engine.id == engine.id)
        .map(|pair| {
            format!(
                "<li><a class=\"lnk\" href=\"../../{}\">{} vs {} on {}</a></li>",
                safe_href(&paths::compare(&pair.slug())),
                escape(&engine.name),
                escape(pair.baseline),
                escape(&pair.chip)
            )
        })
        .collect();
    if links.is_empty() { String::new() } else { format!("<h3>Published pairs</h3><ul class=\"plain\">{links}</ul>") }
}

fn about(engine: &Engine) -> String {
    let relation = engine
        .upstream
        .as_deref()
        .map(|upstream| format!(", {} {}", if engine.kind == Kind::Fork { "a fork of" } else { "built on" }, escape(upstream)))
        .unwrap_or_default();
    let mut chips: Vec<String> = engine.benchmark.iter().map(chip_label).collect();
    chips.sort();
    chips.dedup();
    let measured = if chips.is_empty() { String::new() } else { format!(" Every number below comes from the author's own README, measured on {}.", escape(&chips.join(", "))) };
    format!(
        "<div id=\"about\"><h3 class=\"first\">About</h3><p class=\"aboutp\">{summary}. Made by {author}{relation}. The summary is ours.{measured}</p>",
        summary = escape(&engine.summary),
        author = escape(author_name(engine)),
    )
}

fn hardware_links(engine: &Engine) -> String {
    let mut seen: Vec<(String, String)> = Vec::new();
    for benchmark in &engine.benchmark {
        let label = chip_label(benchmark);
        let (title, slug_text) = if kalsa_engines::chip_generation(&benchmark.chip_tag).is_some() && label.starts_with('M') {
            (format!("Apple {label}"), slug(&format!("Apple {label}")))
        } else {
            let family = kalsa_engines::family_label(&benchmark.chip_tag);
            (family.clone(), slug(&family))
        };
        if !seen.iter().any(|(_, existing)| *existing == slug_text) {
            seen.push((title, slug_text));
        }
    }
    seen.iter().map(|(title, slug_text)| format!("<a class=\"chipx\" href=\"../../{}\">Engines for {}</a>", safe_href(&paths::hardware(slug_text)), escape(title))).collect()
}

fn details(engine: &Engine, facts: &Facts) -> String {
    let mut rows = format!("<dt>Licence</dt><dd>{}</dd><dt>Kind</dt><dd>{}</dd>", escape(&engine.license), engine.kind.label());
    if let Some(upstream) = &engine.upstream {
        rows += &format!("<dt>Upstream</dt><dd>{}</dd>", escape(upstream));
    }
    rows += &format!("<dt>Runs on</dt><dd>{}</dd>", escape(&hardware_labels(&engine.hardware).join(", ")));
    if let Some(fact) = facts.get(&engine.repo) {
        if let Some(stars) = fact.stars {
            rows += &format!("<dt>Stars</dt><dd>{}</dd>", stars_label(stars));
        }
        if let Some(pushed) = &fact.pushed {
            rows += &format!("<dt>Updated</dt><dd>{}</dd>", escape(pushed));
        }
    }
    format!("<div class=\"box\"><h5>Details</h5><dl class=\"kv\">{rows}</dl></div>")
}

fn sidebar(engine: &Engine, facts: &Facts, path: &str) -> String {
    format!(
        "<aside class=\"side\"><div class=\"box\"><h5>Developer</h5><div class=\"dev\">{avatar}<div><b>{author}</b><span>github.com/{login}</span></div></div>\
         <p class=\"sm\">Avatar and username come from the public GitHub profile. <a class=\"lnk\" href=\"../../{dev}\">Developer page</a></p></div>{details}\
         <div class=\"box\"><h5>Share</h5>{url}</div><div class=\"box\"><h5>Hardware pages</h5><div class=\"chips\">{hardware}</div></div>{badge}</aside>",
        avatar = avatar(login(engine), "md", is_org(engine)),
        author = escape(author_name(engine)),
        login = escape(login(engine)),
        dev = safe_href(&paths::developer(login(engine))),
        details = details(engine, facts),
        url = url_bar(path),
        hardware = hardware_links(engine),
        badge = badge_box(engine),
    )
}

// TODO(M6): "Open in Kalsa" (kalsa://engine/<id>) comes back when the app registers the scheme.
fn header(engine: &Engine, facts: &Facts) -> String {
    format!(
        "<div class=\"crumb\"><a href=\"../index.html\">Engines</a> / <a href=\"../../{dev}\">{login}</a> / {name}</div>\
         <div class=\"title\">{avatar}<div><h1><span>{login} /</span> {name}</h1><div class=\"tags\">{tags}</div></div></div>\
         <div class=\"acts\"><a class=\"btn\" href=\"../../{app}\">Get the app</a><a class=\"btn two\" href=\"{github}\">GitHub</a>\
         <span class=\"soonbtn\">Like <span class=\"ph\">coming soon</span></span><span class=\"soonbtn\">Used by <span class=\"ph\">coming soon</span></span></div>\
         <nav class=\"tabs\" aria-label=\"Sections\"><a href=\"#about\" aria-current=\"page\">Overview</a><a href=\"#cmp\">Comparisons</a><a href=\"#review\">Review</a><a href=\"#install\">Before you install</a><span>Discussion<i>coming soon</i></span></nav>",
        dev = safe_href(&paths::developer(login(engine))),
        login = escape(login(engine)),
        name = escape(&engine.name),
        avatar = avatar(login(engine), "lg", is_org(engine)),
        tags = tags(engine, facts),
        app = safe_href(&paths::section("download")),
        github = safe_href(&github_url(&engine.repo)),
    )
}

pub fn engine_page(catalog: &Catalog, engine: &Engine, facts: &Facts) -> String {
    let path = paths::engine(&engine.id);
    let note = engine.note.as_deref().map(|note| format!("<div class=\"note\"><b>Read this first.</b> {}</div>", escape(note))).unwrap_or_default();
    let main = format!(
        "{about}<h3 id=\"cmp\">Published comparisons</h3>{comparisons}\
         <div class=\"soonbox\"><b>Measured by Kalsa users</b> <span class=\"ph\">coming soon</span><p class=\"sm\">Opt-in numbers from real machines will appear beside the author's claim. Your Mac: not measured yet.</p></div>\
         {pairs}{review}<h3 id=\"install\">Before you install</h3>{install}</div>",
        about = about(engine),
        comparisons = comparisons(engine),
        pairs = compare_links(catalog, engine),
        review = review_section(engine, facts),
        install = accordions(engine),
    );
    let body = format!(
        "<div class=\"wrap\">{header}{note}<div class=\"cols\"><div>{main}</div>{side}</div>{claim}</div>",
        header = header(engine, facts),
        side = sidebar(engine, facts, &path),
        claim = claim_line("../../", &engine.name),
    );
    page(
        &Meta {
            title: &format!("{} / {} | Kalsa", login(engine), engine.name),
            description: &format!("{} by {}: licence, published benchmarks (claimed by the author) and how to run it with Kalsa.", engine.name, author_name(engine)),
            path: &path,
            active: "engines",
            scripts: &["site.js"],
        },
        &body,
    )
}
