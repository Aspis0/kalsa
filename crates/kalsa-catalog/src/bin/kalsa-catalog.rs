//! Prints what the catalog would decide for a machine, with the working shown.
//!
//! ```sh
//! cargo run -p kalsa-catalog -- --ram 32 --bandwidth 86 --gflops 103 --phone-gb 2.64
//! ```
//!
//! The bandwidth and compute numbers come from `kalsa-probe`; passing them by
//! hand is how this is used before the app is wired to the probe. `--vram`
//! models a discrete card (the budget becomes the card's memory), and
//! `--on-battery`/`--on-charger` say what the pairing handshake would.

use kalsa_catalog::{
    choose, footprint_bytes, memory_budget, Backend, ChoiceInput, Decision, PhoneModel, GIB,
    IMPROVEMENT_RATIO,
};

fn main() {
    let input = match configured() {
        Ok(input) => input,
        Err(usage) => {
            eprintln!("{usage}");
            std::process::exit(2);
        }
    };
    let budget = memory_budget(input.backend, input.ram_bytes);

    println!(
        "machine: {} RAM, {} budget after the {:.0}% / 3 GiB margin, {} context",
        gibs(input.ram_bytes),
        gibs(budget.usable_bytes),
        25.0,
        input.context_tokens
    );
    println!(
        "backend: {:?}{}",
        input.backend,
        if budget.gpu_accounted_for {
            String::new()
        } else {
            " — the card's memory could not be read, so it is NOT accounted for".to_string()
        }
    );
    println!(
        "probe:   {:.1} GB/s, {:.1} GFLOP/s{}",
        input.bandwidth_bytes_per_second / 1e9,
        input.compute_flops_per_second / 1e9,
        match input.phone {
            Some(phone) => format!(
                ", phone model {} ({}× the improvement bar)",
                gibs(phone.weights_bytes),
                (phone.weights_bytes as f64 * IMPROVEMENT_RATIO / phone.weights_bytes as f64)
            ),
            None => ", phone unknown".to_string(),
        }
    );

    println!();
    println!(
        "{:<42} {:>10} {:>7} {:>9} {:>10}",
        "row", "weights", "fits", "improves", "decode"
    );
    for entry in kalsa_catalog::usable() {
        let entry = entry.entry();
        let footprint = footprint_bytes(entry, input.context_tokens);
        let fits = footprint.total_bytes() <= budget.usable_bytes;
        let improves = match input.phone {
            Some(phone) => {
                entry.weights_bytes as f64 >= phone.weights_bytes as f64 * IMPROVEMENT_RATIO
            }
            None => false,
        };
        // Speed comes from the ACTIVE weights; the footprint from the total.
        let active_bytes = entry.weights_bytes as f64 * entry.parameters.active().count() as f64
            / entry.parameters.total().count().max(1) as f64;
        let decode = 0.7 * input.bandwidth_bytes_per_second / active_bytes.max(1.0);
        println!(
            "{:<42} {:>10} {:>7} {:>9} {:>10}",
            entry.repo,
            gibs(entry.weights_bytes),
            yes_no(fits),
            yes_no(improves),
            format!("{decode:.1} tok/s")
        );
    }

    println!();
    match choose(&input) {
        Decision::Pick(selection) => {
            println!("chosen: {}", selection.repo);
            println!(
                "        {} of weights, {} in memory at {} context",
                gibs(selection.weights_bytes),
                gibs(selection.footprint.total_bytes()),
                selection.context_tokens
            );
            println!(
                "        offered for {:?}, licence {}",
                selection.justification,
                selection.licence.id()
            );
            println!("why:    {}", selection.rationale);
        }
        Decision::Refuse(refusal) => {
            println!("refused ({:?}): {}", refusal.reason, refusal.explanation);
        }
    }
}

fn configured() -> Result<ChoiceInput, String> {
    let mut input = ChoiceInput {
        backend: Backend::Cpu,
        ram_bytes: 16 * GIB,
        bandwidth_bytes_per_second: 80.0e9,
        compute_flops_per_second: 100.0e9,
        context_tokens: 8192,
        phone: Some(PhoneModel {
            weights_bytes: 2_834_975_040,
            measured_tokens_per_second: None,
            on_battery: None,
        }),
    };
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--ram" => input.ram_bytes = number(&mut args, &flag, 1.0)? as u64 * GIB,
            "--vram" => {
                input.backend = Backend::DiscreteGpu {
                    vram_bytes: Some(number(&mut args, &flag, 1.0)? as u64 * GIB),
                };
            }
            "--gpu-unread" => {
                input.backend = Backend::DiscreteGpu { vram_bytes: None };
            }
            "--bandwidth" => {
                input.bandwidth_bytes_per_second = float(&mut args, &flag)? * 1e9;
            }
            "--gflops" => input.compute_flops_per_second = float(&mut args, &flag)? * 1e9,
            "--ctx" => input.context_tokens = number(&mut args, &flag, 1.0)? as u64,
            "--phone-gb" => {
                let gb = float(&mut args, &flag)?;
                let phone = input.phone.take().unwrap_or(PhoneModel {
                    weights_bytes: 0,
                    measured_tokens_per_second: None,
                    on_battery: None,
                });
                input.phone = Some(PhoneModel {
                    weights_bytes: (gb * GIB as f64) as u64,
                    measured_tokens_per_second: phone.measured_tokens_per_second,
                    on_battery: phone.on_battery,
                });
            }
            "--phone-tok-s" => {
                let speed = float(&mut args, &flag)?;
                if let Some(phone) = input.phone.as_mut() {
                    phone.measured_tokens_per_second = Some(speed);
                }
            }
            "--on-battery" => set_battery(&mut input, Some(true)),
            "--on-charger" => set_battery(&mut input, Some(false)),
            "--no-phone" => input.phone = None,
            other => {
                return Err(format!(
                    "unknown flag {other}\nusage: kalsa-catalog [--ram GiB] [--vram GiB] \
                     [--gpu-unread] [--bandwidth GB/s] [--gflops GFLOP/s] [--ctx tokens] \
                     [--phone-gb GiB] [--phone-tok-s N] [--on-battery] [--on-charger] \
                     [--no-phone]"
                ))
            }
        }
    }
    Ok(input)
}

fn set_battery(input: &mut ChoiceInput, on_battery: Option<bool>) {
    if let Some(phone) = input.phone.as_mut() {
        phone.on_battery = on_battery;
    }
}

fn number(args: &mut impl Iterator<Item = String>, flag: &str, floor: f64) -> Result<f64, String> {
    let value = float(args, flag)?;
    if value < floor {
        return Err(format!("{flag} must be at least {floor}"));
    }
    Ok(value)
}

fn float(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<f64, String> {
    args.next()
        .ok_or_else(|| format!("{flag} needs a value"))?
        .parse()
        .map_err(|e| format!("{flag}: {e}"))
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}

fn gibs(bytes: u64) -> String {
    format!("{:.1} GiB", bytes as f64 / GIB as f64)
}
