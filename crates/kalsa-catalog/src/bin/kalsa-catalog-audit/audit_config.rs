use kalsa_catalog::{Backend, ChoiceInput, Parameters, PhoneModel, GIB};

const DEFAULT_TIERS: &[u64] = &[8, 16, 32, 64];
const PHONE_WEIGHTS: u64 = 2_834_975_040;

pub(super) struct Config {
    pub(super) tiers: Vec<u64>,
    pub(super) input: ChoiceInput,
    pub(super) backend: Backend,
    pub(super) bandwidth: f64,
    pub(super) compute: f64,
    pub(super) context: u64,
}

impl Config {
    pub(super) fn parse() -> Result<Self, String> {
        let mut input = ChoiceInput {
            backend: Backend::Cpu,
            ram_bytes: 16 * GIB,
            bandwidth_bytes_per_second: 80.0e9,
            bandwidth_is_lower_bound: false,
            compute_flops_per_second: 100.0e9,
            context_tokens: 8192,
            phone: Some(PhoneModel {
                weights_bytes: PHONE_WEIGHTS,
                parameters: Some(Parameters::dense(4_000_000_000)),
                measured_tokens_per_second: Some(9.0),
                battery_powered: Some(true),
            }),
        };
        let mut tiers = DEFAULT_TIERS.to_vec();
        let mut args = std::env::args().skip(1);
        while let Some(flag) = args.next() {
            match flag.as_str() {
                "--tiers" => tiers = parse_tiers(&mut args, &flag)?,
                "--ram" => tiers = vec![number(&mut args, &flag, 1.0)? as u64],
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
                "--phone-gb" => set_phone_weights(&mut input, float(&mut args, &flag)?),
                "--phone-params" => {
                    let billions = float(&mut args, &flag)?;
                    set_phone_parameters(&mut input, Parameters::dense(billions_value(billions)));
                }
                "--phone-moe" => {
                    let shape = args
                        .next()
                        .ok_or_else(|| format!("{flag} needs total,active"))?;
                    let (total, active) = shape
                        .split_once(',')
                        .ok_or_else(|| format!("{flag} needs total,active billions"))?;
                    let total = billions_value(parse_float(total, &flag)?);
                    let active = billions_value(parse_float(active, &flag)?);
                    if active == 0 || active > total {
                        return Err(format!("{flag} needs 0 < active <= total"));
                    }
                    set_phone_parameters(&mut input, Parameters::mixture(total, active));
                }
                "--phone-tok-s" => {
                    set_phone_speed(&mut input, float(&mut args, &flag)?);
                }
                "--battery-powered" => set_battery(&mut input, Some(true)),
                "--wall-powered" => set_battery(&mut input, Some(false)),
                "--no-phone" => input.phone = None,
                other => return Err(format!("unknown flag {other}\n{}", usage())),
            }
        }
        if tiers.is_empty()
            || tiers
                .iter()
                .any(|tier| *tier == 0 || tier.checked_mul(GIB).is_none())
        {
            return Err("--tiers must contain positive, representable GiB values".to_string());
        }
        Ok(Self {
            tiers,
            backend: input.backend,
            bandwidth: input.bandwidth_bytes_per_second,
            compute: input.compute_flops_per_second,
            context: input.context_tokens,
            input,
        })
    }
}

fn usage() -> &'static str {
    "usage: kalsa-catalog-audit [--tiers 8,16,32,64] [--ram GiB] [--vram GiB] \
     [--gpu-unread] [--bandwidth GB/s] [--gflops GFLOP/s] [--ctx tokens] \
     [--phone-gb GiB] [--phone-params billions] [--phone-moe total,active] \
     [--phone-tok-s N] [--lower-bound] [--battery-powered] [--wall-powered] [--no-phone]"
}

fn parse_tiers(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<Vec<u64>, String> {
    args.next()
        .ok_or_else(|| format!("{flag} needs comma-separated GiB values"))?
        .split(',')
        .map(|value| value.parse().map_err(|error| format!("{flag}: {error}")))
        .collect()
}

fn set_phone_weights(input: &mut ChoiceInput, gib: f64) {
    if let Some(phone) = input.phone.as_mut() {
        phone.weights_bytes = (gib * GIB as f64) as u64;
    }
}

fn set_phone_parameters(input: &mut ChoiceInput, parameters: Parameters) {
    if let Some(phone) = input.phone.as_mut() {
        phone.parameters = Some(parameters);
    }
}

fn set_phone_speed(input: &mut ChoiceInput, speed: f64) {
    if let Some(phone) = input.phone.as_mut() {
        phone.measured_tokens_per_second = Some(speed);
    }
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
        .map_err(|error| format!("{flag}: {error}"))
}

fn parse_float(value: &str, flag: &str) -> Result<f64, String> {
    value.parse().map_err(|error| format!("{flag}: {error}"))
}

fn billions_value(billions: f64) -> u64 {
    (billions * 1e9) as u64
}
