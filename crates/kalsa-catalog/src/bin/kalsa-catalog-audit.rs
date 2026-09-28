//! Print the catalog's choice and every row it leaves behind at memory tiers.
//!
//! Defaults describe a CPU machine with a paired, battery-powered dense 4B
//! phone, 80 GB/s bandwidth, 100 GFLOP/s compute and the chooser's own
//! 65_536-token pricing window.
//! Use --tiers and the other flags to inspect a different machine.
//!
//! ```text
//! cargo run -p kalsa-catalog --bin kalsa-catalog-audit -- --tiers 8,16,32,64
//! ```

#[path = "kalsa-catalog-audit/audit_config.rs"]
mod audit_config;

use kalsa_catalog::{
    audit::{inspect, RowAssessment},
    choose, fits_footprint, largest_that_runs_well, memory_budget, quicker_alternative,
    ChoiceInput, Decision, DownloadPlan, PhoneModel, Prediction, RefusalReason, RunnableRow,
    Standing, CATALOG, GIB,
};

use audit_config::Config;

fn main() {
    let config = match Config::parse() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    print_catalog_facts();
    println!(
        "inputs: {:?}, {:.1} GB/s, {:.1} GFLOP/s, {} context",
        config.backend,
        config.bandwidth / 1e9,
        config.compute / 1e9,
        config.context
    );
    println!("phone: {}", phone_description(config.input.phone));
    for tier in config.tiers {
        print_tier(tier, config.input);
    }
}

fn print_catalog_facts() {
    println!(
        "download table (the chooser's only menu): {} rows, each with a pinned, \
         digest-verified file",
        kalsa_catalog::DOWNLOADABLE.len()
    );
    for row in kalsa_catalog::DOWNLOADABLE {
        println!(
            "  = {} | {} | {} bytes | sha256 {}",
            row.model.repo, row.model.quant, row.source.bytes, row.source.sha256
        );
    }
    println!(
        "research record (never offerable — no identified file): {} rows",
        CATALOG.len()
    );
    for entry in CATALOG {
        println!("  - {} | {}", entry.repo, entry.quant);
    }
}

fn print_tier(tier: u64, base: ChoiceInput) {
    let input = ChoiceInput {
        ram_bytes: tier * GIB,
        ..base
    };
    let budget = memory_budget(input.backend, input.ram_bytes);
    let rows = inspect(&input);
    println!("\n=== {tier} GiB RAM ===");
    println!("budget: {}", gibs(budget.usable_bytes));
    let decision = choose(&input);
    let winner = match &decision {
        Decision::Pick(selection) => {
            println!(
                "winner: {} | repo={} | quant={} | weights={} | footprint={}",
                selection.display_name,
                selection.repo,
                selection.quant,
                gibs(selection.weights_bytes),
                gibs(selection.footprint.total_bytes())
            );
            println!("  decode: {}", prediction(&selection.decode));
            let DownloadPlan {
                url,
                bytes,
                sha256,
            } = &selection.download;
            println!("  download: {url}");
            println!("            {bytes} bytes, sha256 {sha256}");
            Some((selection.repo, selection.quant, selection.weights_bytes))
        }
        // No phone is not no choice: the page answers "what can this
        // computer run?" with the phone-free question — capability.rs takes
        // this same refusal down that road — so the report shows those two
        // cards, stand-down included: nothing clears a line there, and speed
        // rather than size picked them.
        Decision::Refuse(refusal) if refusal.reason == RefusalReason::PhoneUnknown => {
            match largest_that_runs_well(&input) {
                Ok(first) => {
                    print_winner(&first);
                    if let Some(second) = quicker_alternative(&input, &first.decode) {
                        println!(
                            "second: {} | repo={} | quant={} | weights={} | \
                             footprint={} | decode: {}",
                            second.entry.display_name,
                            second.entry.repo,
                            second.entry.quant,
                            gibs(second.entry.weights_bytes),
                            gibs(second.footprint.total_bytes()),
                            prediction(&second.decode)
                        );
                    }
                    Some((first.entry.repo, first.entry.quant, first.entry.weights_bytes))
                }
                Err(fallback) => {
                    println!(
                        "winner: REFUSED | {:?}: {}",
                        fallback.reason, fallback.explanation
                    );
                    None
                }
            }
        }
        Decision::Refuse(refusal) => {
            println!(
                "winner: REFUSED | {:?}: {}",
                refusal.reason, refusal.explanation
            );
            None
        }
    };
    // The dense floors are conditional in the chooser (choice.rs): they
    // withhold a row only while some row on the menu clears its own line.
    // The report mirrors that, or it would withhold rows the chooser starts.
    // The same stand-down orders the phone-free cards above: speed when no
    // line can speak, size when one did.
    let any_clears_line = rows
        .iter()
        .filter(|row| on_the_menu(row, budget, input.ram_bytes))
        .any(|row| {
            row.dense_line
                .is_none_or(|line| row.decode.as_ref().is_some_and(|decode| decode.floor() >= line))
        });
    println!("other rows:");
    // The whole row is the identity, not the repo alone: two files of one
    // model (Q8_0 and F16) are separate menu entries, and hiding both
    // because one of them won would hide the other's verdict too.
    for row in rows
        .iter()
        .filter(|row| Some((row.entry.repo, row.entry.quant, row.entry.weights_bytes)) != winner)
    {
        println!(
            "  - {} | {} | weights={} | footprint={} | {} | {}",
            row.entry.repo,
            row.entry.quant,
            gibs(row.entry.weights_bytes),
            gibs(row.footprint.total_bytes()),
            offering(row, budget, input.ram_bytes, any_clears_line),
            rejection(row, budget, input.ram_bytes, any_clears_line)
        );
    }
}

/// The chooser's gates, in the order it applies them: manifest standing,
/// fit at the pricing window, the reading floor, the roomy-machine rule, a
/// file to fetch — then the row's dense speed floor, asked only when some
/// other row on the menu clears its own (choice.rs). `offered` means on
/// this machine's menu; the pick is one of them, chosen by preference,
/// which is a separate question with its own sentence below.
/// The phone-free first card, in this report's own shape.
fn print_winner(row: &RunnableRow) {
    println!(
        "winner: {} | repo={} | quant={} | weights={} | footprint={}",
        row.entry.display_name,
        row.entry.repo,
        row.entry.quant,
        gibs(row.entry.weights_bytes),
        gibs(row.footprint.total_bytes())
    );
    println!("  decode: {}", prediction(&row.decode));
    let DownloadPlan {
        url,
        bytes,
        sha256,
    } = &row.download;
    println!("  download: {url}");
    println!("            {bytes} bytes, sha256 {sha256}");
}

fn on_the_menu(
    row: &RowAssessment,
    budget: kalsa_catalog::MemoryBudget,
    ram_bytes: u64,
) -> bool {
    !matches!(row.standing, Standing::Excluded { .. })
        && fits_footprint(row.entry, &row.footprint, &budget)
        && !row.too_slow
        && !(kalsa_catalog::full_precision_file(row.entry)
            && ram_bytes < kalsa_catalog::ROOMY_RAM_BYTES)
        && has_a_file(row.entry)
}

fn offering(
    row: &RowAssessment,
    budget: kalsa_catalog::MemoryBudget,
    ram_bytes: u64,
    any_clears_line: bool,
) -> &'static str {
    if !on_the_menu(row, budget, ram_bytes) {
        return "withheld";
    }
    if any_clears_line {
        if let (Some(line), Some(decode)) = (row.dense_line, &row.decode) {
            if decode.floor() < line {
                return "withheld";
            }
        }
    }
    "offered"
}

fn has_a_file(entry: &kalsa_catalog::ModelEntry) -> bool {
    kalsa_catalog::DOWNLOADABLE.iter().any(|row| row.model.repo == entry.repo)
}

fn rejection(
    row: &RowAssessment,
    budget: kalsa_catalog::MemoryBudget,
    ram_bytes: u64,
    any_clears_line: bool,
) -> String {
    let mut reasons = Vec::new();
    if let Standing::Excluded { reason } = row.standing {
        reasons.push(format!("excluded by manifest: {reason}"));
    } else {
        if row.footprint.total_bytes() > budget.usable_bytes {
            reasons.push(format!("too big for {}", gibs(budget.usable_bytes)));
        }
        if kalsa_catalog::full_precision_file(row.entry)
            && ram_bytes < kalsa_catalog::ROOMY_RAM_BYTES
        {
            reasons.push("roomy machines only: the full-precision file (32 GiB of RAM)".to_string());
        }
        if row.too_slow {
            reasons.push("too slow: below the reading floor".to_string());
        }
        if any_clears_line {
            if let (Some(line), Some(decode)) = (row.dense_line, &row.decode) {
                if decode.floor() < line {
                    reasons.push(format!(
                        "dense speed floor: predicts {floor:.1} tok/s, needs {line:.0}",
                        floor = decode.floor()
                    ));
                }
            }
        }
        if reasons.is_empty() {
            reasons.push("not selected by the chooser's preference".to_string());
        }
    }
    let is_research_row = !kalsa_catalog::DOWNLOADABLE
        .iter()
        .any(|download| download.model.repo == row.entry.repo);
    if is_research_row {
        reasons.push("research row: no identified file, never offerable".to_string());
    }
    reasons.join("; ")
}

fn prediction(value: &Prediction) -> String {
    match *value {
        Prediction::Range { low, high } => format!("Range/predicted {low:.1}–{high:.1} tok/s"),
        Prediction::Floor(value) => format!("Floor/lower bound {value:.1} tok/s"),
        Prediction::Estimate(value) => format!("Estimate {value:.1} tok/s"),
        Prediction::Measured {
            tokens_per_second,
            machine,
        } => format!("Measured/real {tokens_per_second:.1} tok/s on {machine}"),
    }
}

fn phone_description(phone: Option<PhoneModel>) -> String {
    let Some(phone) = phone else {
        return "unknown".to_string();
    };
    let parameters = phone
        .parameters
        .map(|p| {
            format!(
                "{:.1}B total/{:.1}B active",
                p.total().count() as f64 / 1e9,
                p.active().count() as f64 / 1e9
            )
        })
        .unwrap_or_else(|| "parameters unknown".to_string());
    format!(
        "{} weights, {parameters}, battery={:?}",
        gibs(phone.weights_bytes),
        phone.battery_powered
    )
}

fn gibs(bytes: u64) -> String {
    format!("{:.2} GiB", bytes as f64 / GIB as f64)
}
