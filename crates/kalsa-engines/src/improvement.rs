//! What an engine improves besides speed. Speed itself is derived from the benchmark rows (`gains.rs`),
//! so an `[[engine.improvement]]` never carries decode or prefill.

use serde::{Deserialize, Serialize};

use crate::gains::clears_noise;
use crate::{valid_source, Engine, KNOWN_TAGS};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum ImprovementKind {
    BiggerModels,
    MultiMachine,
    LongerContext,
    NewHardware,
    NewModel,
    FasterDecode,
    FasterPrefill,
    FasterStart,
    LessMemory,
    ParallelThroughput,
    Quality,
    Energy,
}

impl ImprovementKind {
    pub const ALL: [ImprovementKind; 12] = [
        Self::BiggerModels, Self::MultiMachine, Self::LongerContext, Self::NewHardware, Self::NewModel, Self::FasterDecode,
        Self::FasterPrefill, Self::FasterStart, Self::LessMemory, Self::ParallelThroughput, Self::Quality, Self::Energy,
    ];

    /// The id used in the catalog file and in filters.
    pub fn id(self) -> &'static str {
        match self {
            Self::BiggerModels => "bigger-models",
            Self::MultiMachine => "multi-machine",
            Self::LongerContext => "longer-context",
            Self::NewHardware => "new-hardware",
            Self::NewModel => "new-model",
            Self::FasterDecode => "faster-decode",
            Self::FasterPrefill => "faster-prefill",
            Self::FasterStart => "faster-start",
            Self::LessMemory => "less-memory",
            Self::ParallelThroughput => "parallel-throughput",
            Self::Quality => "quality",
            Self::Energy => "energy",
        }
    }

    /// The plain words on a tag.
    pub fn label(self) -> &'static str {
        match self {
            Self::BiggerModels => "Bigger models",
            Self::MultiMachine => "Multiple machines",
            Self::LongerContext => "Longer context",
            Self::NewHardware => "New hardware",
            Self::NewModel => "New model",
            Self::FasterDecode => "Faster decode",
            Self::FasterPrefill => "Faster prefill",
            Self::FasterStart => "Faster start",
            Self::LessMemory => "Less memory",
            Self::ParallelThroughput => "Parallel throughput",
            Self::Quality => "Quality",
            Self::Energy => "Energy",
        }
    }

    /// Kinds that are a number before and after, in one unit.
    fn is_before_after(self) -> bool {
        matches!(self, Self::FasterStart | Self::LessMemory | Self::ParallelThroughput | Self::LongerContext | Self::Quality | Self::Energy)
    }

    fn is_speed(self) -> bool {
        matches!(self, Self::FasterDecode | Self::FasterPrefill)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct Improvement {
    pub kind: ImprovementKind,
    /// One line in our own words, with the number.
    pub summary: String,
    pub machine: String,
    #[serde(default)]
    pub chip_tag: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub source: String,
    /// A cost the source states, such as lower quality or slower speed.
    #[serde(default)]
    pub tradeoff: Option<String>,
    #[serde(default)]
    pub before: Option<f64>,
    #[serde(default)]
    pub after: Option<f64>,
    #[serde(default)]
    pub unit: Option<String>,
    /// Bigger models only: the model's size on disk, in GiB, the machine's memory in GB, and the measured decode speed.
    #[serde(default)]
    pub model_gib: Option<f64>,
    #[serde(default)]
    pub memory_gb: Option<f64>,
    #[serde(default)]
    pub tok_s: Option<f64>,
}

fn positive(value: Option<f64>) -> bool {
    value.is_some_and(|number| number.is_finite() && number > 0.0)
}

fn filled(text: &str) -> bool {
    !text.trim().is_empty()
}

fn validate_numbers(item: &Improvement, id: &str) -> Result<(), String> {
    let pair = [item.before, item.after];
    let before_after = pair.iter().any(Option::is_some) || item.unit.is_some();
    let size = [item.model_gib, item.memory_gb, item.tok_s].iter().any(Option::is_some);
    if item.kind.is_before_after() {
        if size {
            return Err(format!("{id}: {} takes before, after and unit, not model sizes", item.kind.id()));
        }
        let (Some(before), Some(after)) = (item.before, item.after) else {
            return Err(format!("{id}: {} needs before, after and unit", item.kind.id()));
        };
        if !positive(Some(before)) || !positive(Some(after)) || !item.unit.as_deref().is_some_and(filled) {
            return Err(format!("{id}: {} needs a positive before, a positive after and a unit", item.kind.id()));
        }
        if !clears_noise(after / before) {
            return Err(format!("{id}: {} changes by under 5%, which is noise", item.kind.id()));
        }
    } else if item.kind == ImprovementKind::BiggerModels {
        if before_after {
            return Err(format!("{id}: bigger-models takes model_gib, memory_gb and tok_s, not before and after"));
        }
        if !(positive(item.model_gib) && positive(item.memory_gb) && positive(item.tok_s)) {
            return Err(format!("{id}: bigger-models needs a positive model_gib, memory_gb and tok_s"));
        }
    } else if before_after || size {
        return Err(format!("{id}: {} carries no numbers beyond its summary", item.kind.id()));
    }
    Ok(())
}

fn validate_one(item: &Improvement, engine: &Engine) -> Result<(), String> {
    let id = &engine.id;
    if item.kind.is_speed() {
        return Err(format!("{id}: {} comes from the benchmark rows, not from an improvement", item.kind.id()));
    }
    if !filled(&item.summary) || !filled(&item.machine) {
        return Err(format!("{id}: an improvement needs a summary and a machine"));
    }
    if !valid_source(&item.source) {
        return Err(format!("{id}: improvement source must be an https URL without credentials"));
    }
    if let Some(tag) = &item.chip_tag {
        if !KNOWN_TAGS.contains(&tag.as_str()) || !engine.hardware.contains(tag) {
            return Err(format!("{id}: improvement tag {tag} is not in hardware"));
        }
    }
    for text in [&item.model, &item.tradeoff].into_iter().flatten() {
        if !filled(text) {
            return Err(format!("{id}: an improvement field is empty"));
        }
    }
    validate_numbers(item, id)
}

pub(crate) fn validate(engine: &Engine) -> Result<(), String> {
    engine.improvement.iter().try_for_each(|item| validate_one(item, engine))
}

/// Everything an engine improves, in the catalog's own order of kinds: the speed its benchmarks show, then the rest.
pub fn improvement_kinds(engine: &Engine) -> Vec<ImprovementKind> {
    let mut kinds: Vec<ImprovementKind> = engine.improvement.iter().map(|item| item.kind).collect();
    let gains = engine.benchmark.iter().map(|benchmark| &benchmark.gains);
    if gains.clone().any(|gain| gain.decode.as_ref().is_some_and(|metric| metric.is_gain())) {
        kinds.push(ImprovementKind::FasterDecode);
    }
    if gains.clone().any(|gain| gain.prefill.as_ref().is_some_and(|metric| metric.is_gain())) {
        kinds.push(ImprovementKind::FasterPrefill);
    }
    kinds.sort();
    kinds.dedup();
    kinds
}
