//! Print the catalog's choice and every row it leaves behind at memory tiers.
//!
//! Defaults describe a CPU machine with a paired, battery-powered dense 4B
//! phone, 80 GB/s bandwidth, 100 GFLOP/s compute and an 8192-token context.
//! Use --tiers and the other flags to inspect a different machine.
//!
//! ```text
//! cargo run -p kalsa-catalog --bin kalsa-catalog-audit -- --tiers 8,16,32,64
//! ```

#[path = "kalsa-catalog-audit/audit_config.rs"]
mod audit_config;

use kalsa_catalog::{
    audit::{inspect, RowAssessment},
    choose, memory_budget, ChoiceInput, Decision, PhoneModel, Prediction, Standing, CATALOG, GIB,
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
    let without_source: Vec<_> = CATALOG
        .iter()
        .filter(|entry| entry.source.is_none())
        .collect();
    let usable_without_source = without_source
        .iter()
        .filter(|entry| entry.is_usable())
        .count();
    println!(
        "catalog: {} rows; {} without an identified GGUF ({} usable, {} excluded)",
        CATALOG.len(),
        without_source.len(),
        usable_without_source,
        without_source.len() - usable_without_source
    );
    println!("no GGUF identified:");
    for entry in without_source {
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
            if selection.download.is_none() {
                println!("  download: NO GGUF IDENTIFIED (choice selected an unfetchable row)");
            } else {
                println!("  download: identified and pinned GGUF");
            }
            Some(selection.repo)
        }
        Decision::Refuse(refusal) => {
            println!(
                "winner: REFUSED | {:?}: {}",
                refusal.reason, refusal.explanation
            );
            None
        }
    };
    println!("rejected rows:");
    for row in rows.iter().filter(|row| Some(row.entry.repo) != winner) {
        println!(
            "  - {} | {} | weights={} | footprint={} | {}",
            row.entry.repo,
            row.entry.quant,
            gibs(row.entry.weights_bytes),
            gibs(row.footprint.total_bytes()),
            rejection(row, budget)
        );
    }
}

fn rejection(row: &RowAssessment, budget: kalsa_catalog::MemoryBudget) -> String {
    let mut reasons = Vec::new();
    if let Standing::Excluded { reason } = row.standing {
        reasons.push(format!("excluded by manifest: {reason}"));
    } else {
        if row.footprint.total_bytes() > budget.usable_bytes {
            reasons.push(format!("too big for {}", gibs(budget.usable_bytes)));
        }
        if row.too_slow {
            reasons.push("too slow: predicted range is below 3.0 tok/s".to_string());
        }
        if row.entry.source.is_none() {
            reasons.push("no GGUF identified".to_string());
        }
        if reasons.is_empty() {
            reasons.push("not selected by the chooser's preference".to_string());
        }
    }
    if row.entry.source.is_none() && !reasons.iter().any(|reason| reason == "no GGUF identified") {
        reasons.push("no GGUF identified".to_string());
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
