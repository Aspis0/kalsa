//! Prints what the catalog would decide for a machine, with the working shown.
//!
//! ```sh
//! cargo run -p kalsa-catalog -- --ram 32 --bandwidth 86 --gflops 103 --phone-gb 2.64
//! ```
//!
//! The bandwidth and compute numbers come from `kalsa-probe`; passing them by
//! hand is how this is used before the app is wired to the probe. `--vram`
//! models a discrete card (the budget becomes the card's memory),
//! `--battery-powered`/`--wall-powered` say what the pairing handshake would, and
//! `--phone-params` reports the phone's dense parameter count, without which
//! nothing is claimed as capability.

use kalsa_catalog::{
    capability_basis, choose, footprint_bytes, memory_budget, Backend, ChoiceInput, Decision,
    Parameters, PhoneModel, GIB,
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
                ", phone model {} ({})",
                gibs(phone.weights_bytes),
                match phone.parameters {
                    Some(p) => format!(
                        "{:.1}B/{:.1}B params",
                        p.total().count() as f64 / 1e9,
                        p.active().count() as f64 / 1e9
                    ),
                    None => "parameters unreported".to_string(),
                }
            ),
            None => ", phone unknown".to_string(),
        }
    );

    println!();
    println!(
        "{:<42} {:>10} {:>7} {:>8} {:>10}",
        "row", "weights", "fits", "capable", "decode"
    );
    for entry in kalsa_catalog::usable() {
        let entry = entry.entry();
        let footprint = footprint_bytes(entry, input.context_tokens);
        let fits = footprint.total_bytes() <= budget.usable_bytes;
        let capable = input
            .phone
            .as_ref()
            .and_then(|phone| {
                capability_basis(entry.parameters, entry.dense_equivalent, phone.parameters)
            })
            .is_some();
        // Speed comes from the ACTIVE weights; the footprint from the total.
        let active_bytes = entry.weights_bytes as f64 * entry.parameters.active().count() as f64
            / entry.parameters.total().count().max(1) as f64;
        let decode = 0.7 * input.bandwidth_bytes_per_second / active_bytes.max(1.0);
        println!(
            "{:<42} {:>10} {:>7} {:>8} {:>10}",
            entry.repo,
            gibs(entry.weights_bytes),
            yes_no(fits),
            yes_no(capable),
            format!("{decode:.1} tok/s")
        );
    }

    println!();
    match choose(&input) {
        Decision::Pick(selection) => {
            println!("chosen: {} ({})", selection.display_name, selection.repo);
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
            let plan = &selection.download;
            println!("fetch:   {}", plan.url);
            println!("         {} bytes, sha256 {}", plan.bytes, plan.sha256);
            println!("why:    {}", selection.plain_reason);
            println!("detail: {}", selection.details);
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
        bandwidth_is_lower_bound: false,
        compute_flops_per_second: 100.0e9,
        context_tokens: 8192,
        phone: Some(PhoneModel {
            weights_bytes: 2_834_975_040,
            parameters: None,
            measured_tokens_per_second: None,
            battery_powered: None,
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
            "--lower-bound" => input.bandwidth_is_lower_bound = true,
            "--gflops" => input.compute_flops_per_second = float(&mut args, &flag)? * 1e9,
            "--ctx" => input.context_tokens = number(&mut args, &flag, 1.0)? as u64,
            "--phone-gb" => {
                let gb = float(&mut args, &flag)?;
                let phone = input.phone.take().unwrap_or(PhoneModel {
                    weights_bytes: 0,
                    parameters: None,
                    measured_tokens_per_second: None,
                    battery_powered: None,
                });
                input.phone = Some(PhoneModel {
                    weights_bytes: (gb * GIB as f64) as u64,
                    ..phone
                });
            }
            "--phone-params" => {
                // Dense billions, as the handshake would report a dense model;
                // a MoE phone would report both axes.
                let billions = float(&mut args, &flag)?;
                if let Some(phone) = input.phone.as_mut() {
                    phone.parameters = Some(Parameters::dense((billions * 1e9) as u64));
                }
            }
            "--phone-tok-s" => {
                let speed = float(&mut args, &flag)?;
                if let Some(phone) = input.phone.as_mut() {
                    phone.measured_tokens_per_second = Some(speed);
                }
            }
            "--battery-powered" => set_battery(&mut input, Some(true)),
            "--wall-powered" => set_battery(&mut input, Some(false)),
            "--no-phone" => input.phone = None,
            other => {
                return Err(format!(
                    "unknown flag {other}\nusage: kalsa-catalog [--ram GiB] [--vram GiB] \
                     [--gpu-unread] [--bandwidth GB/s] [--gflops GFLOP/s] [--ctx tokens] \
                     [--phone-gb GiB] [--phone-params billions] [--phone-tok-s N] \
                     [--lower-bound] [--battery-powered] [--wall-powered] [--no-phone]"
                ))
            }
        }
    }
    Ok(input)
}

fn set_battery(input: &mut ChoiceInput, battery_powered: Option<bool>) {
    if let Some(phone) = input.phone.as_mut() {
        phone.battery_powered = battery_powered;
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
