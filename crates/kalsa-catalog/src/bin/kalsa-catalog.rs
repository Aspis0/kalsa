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
    candidate_footprint, capability_basis, choose, largest_that_runs_well, memory_budget,
    quicker_alternative, served, Backend, ChoiceInput, Decision, DownloadPlan, Parameters,
    PhoneModel, Prediction, CHOOSER_CONTEXT_TOKENS, GIB,
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
    // Which margin made the budget: the card's own one-GiB floor on a
    // discrete path, the RAM margin on every other — the number alone
    // cannot say, and after the measured VRAM floor it is no longer the
    // same margin either way.
    let basis = match input.backend {
        kalsa_probe::Backend::DiscreteGpu {
            vram_bytes: Some(vram),
        } => format!("of the {} card, after its 1 GiB floor", gibs(vram)),
        _ => format!("after the {:.0}% / 3 GiB margin", 25.0),
    };

    println!(
        "machine: {} RAM, {} budget {}, {} context",
        gibs(input.ram_bytes),
        gibs(budget.usable_bytes),
        basis,
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
        "{:<42} {:>10} {:>7} {:>8} {:>22}",
        "row", "weights", "fits", "capable", "decode"
    );
    // The menu as the chooser serves it on this machine — the Q8 rule
    // applied, the drafter charged — so the table cannot disagree with the
    // pick below: the same resolution decides both.
    for usable in served(&input) {
        let entry = usable.entry();
        let footprint = candidate_footprint(usable, &input);
        let fits = kalsa_catalog::fits_footprint(entry, &footprint, &budget);
        let capable = input
            .phone
            .as_ref()
            .and_then(|phone| {
                capability_basis(entry.parameters, entry.dense_equivalent, phone.parameters)
            })
            .is_some();
        let repo = entry.repo;
        let weights = gibs(entry.weights_bytes);
        // The library's own prediction for this row — the chooser's
        // construction, cache and all, not a recomputation beside it.
        let decode = kalsa_catalog::decode_prediction(usable, &input);
        println!(
            "{:<42} {:>10} {:>7} {:>8} {:>22}",
            repo,
            weights,
            yes_no(fits),
            yes_no(capable),
            decode_text(&decode)
        );
    }

    println!();
    // Two routes, mirroring the app: a paired phone gets the upgrade
    // comparison (`choose`); no phone gets the phone-free question
    // (`largest_that_runs_well`) — the phone decides whether this computer
    // is an upgrade, never whether it can run. The route is named so the
    // reader knows which question was answered.
    if input.phone.is_none() {
        println!("route:  phone-free (the row this machine runs well: biggest while a line clears, any other family before LFM while none does)");
        match largest_that_runs_well(&input) {
            Ok(row) => {
                println!(
                    "starts: {} ({}, {})",
                    row.entry.display_name, row.entry.repo, row.entry.quant
                );
                println!(
                    "        {} of weights, {} in memory at the {}-token pricing context",
                    gibs(row.entry.weights_bytes),
                    gibs(row.footprint.total_bytes()),
                    row.entry.priced_context(input.context_tokens)
                );
                print_fetch(&row.download);
                match quicker_alternative(&input, &row.decode) {
                    Some(second) => println!(
                        "second:  {} ({}) — {} of weights",
                        second.entry.display_name,
                        second.entry.repo,
                        gibs(second.entry.weights_bytes)
                    ),
                    None => println!("second:  none (nothing beside it clears the speed bar)"),
                }
            }
            Err(refusal) => {
                println!("refused ({:?}): {}", refusal.reason, refusal.explanation);
            }
        }
    } else {
        println!("route:  paired (the upgrade comparison against the phone)");
        match choose(&input) {
            Decision::Pick(selection) => {
                println!(
                    "chosen: {} ({}, {})",
                    selection.display_name, selection.repo, selection.quant
                );
                println!(
                    "        {} of weights, {} in memory at the {}-token pricing context",
                    gibs(selection.weights_bytes),
                    gibs(selection.footprint.total_bytes()),
                    selection.context_tokens
                );
                println!(
                    "        offered for {:?}, licence {}",
                    selection.justification,
                    selection.licence.id()
                );
                print_fetch(&selection.download);
                match quicker_alternative(&input, &selection.decode) {
                    Some(second) => println!(
                        "second:  {} ({}) — {} of weights",
                        second.entry.display_name,
                        second.entry.repo,
                        gibs(second.entry.weights_bytes)
                    ),
                    None => println!("second:  none (nothing beside it clears the speed bar)"),
                }
                println!("why:    {}", selection.plain_reason);
                println!("detail: {}", selection.details);
            }
            Decision::Refuse(refusal) => {
                println!("refused ({:?}): {}", refusal.reason, refusal.explanation);
            }
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
        // The chooser's window: what the pick has to fit, not the launch's
        // own default. `--ctx` overrides it to ask what another window does.
        context_tokens: CHOOSER_CONTEXT_TOKENS,
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
            // Apple Silicon: unified memory, decodes through Metal. The
            // bandwidth was measured on the CPU path beneath it, so pair
            // this with --lower-bound to model the machine honestly.
            "--metal" => input.backend = Backend::Metal,
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
                "unknown flag {other}\nusage: kalsa-catalog [--ram GiB] [--vram GiB] [--metal] \
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

/// The pick's fetch lines: the weights file, and the drafter beside it with
/// the one total both cost, when the row ships with a drafter.
fn print_fetch(plan: &DownloadPlan) {
    println!("fetch:   {}", plan.url);
    println!("         {} bytes, sha256 {}", plan.bytes, plan.sha256);
    if let Some(drafter) = &plan.drafter {
        println!("drafter: {}", drafter.url);
        println!(
            "         {} bytes, sha256 {} — {} with the weights",
            drafter.bytes,
            drafter.sha256,
            gibs(plan.total_bytes())
        );
    }
}

/// The prediction's own shape, rendered: a range with both ends, a floor
/// always marked as a floor, a measurement naming its machine. Decode never
/// produces `Estimate` — that is prefill's shape — and it renders as the
/// at-least it is.
fn decode_text(prediction: &Prediction) -> String {
    match *prediction {
        Prediction::Range { low, high } => format!("{low:.1}–{high:.1} tok/s"),
        Prediction::Floor(value) | Prediction::Estimate(value) => {
            format!("≥ {value:.1} tok/s (floor)")
        }
        Prediction::Measured {
            tokens_per_second,
            machine,
        } => format!("{tokens_per_second:.1} tok/s on {machine}"),
    }
}

fn gibs(bytes: u64) -> String {
    format!("{:.1} GiB", bytes as f64 / GIB as f64)
}
