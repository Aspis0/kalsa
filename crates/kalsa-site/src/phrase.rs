//! Plain-English phrases for gains, shared by cards, benchmark tables and hardware and developer pages.

use kalsa_engines::{chip_generation, family_label, Benchmark, Gains, MetricGain};

/// The platform a chip tag belongs to, as a page for it names it: "Apple", "NVIDIA", "AMD", "Intel" or "CPU".
pub fn platform_label(tag: &str) -> String {
    if chip_generation(tag).is_some() { "Apple".to_string() } else { family_label(tag) }
}

/// What a benchmark was measured against, as far as the catalog can say it. Anything else stays unnamed.
pub enum Baseline<'a> {
    /// Another engine in the catalog, by its display name.
    Engine(&'a str),
    /// The same engine and build with one feature switched off.
    FeatureOff,
    Other,
}

pub fn baseline_of(benchmark: &Benchmark) -> Baseline<'_> {
    match (&benchmark.baseline_engine, benchmark.feature_off) {
        (Some(name), _) => Baseline::Engine(name),
        (None, true) => Baseline::FeatureOff,
        (None, false) => Baseline::Other,
    }
}

/// "+35%", or "about the same" when the difference is under 5%.
pub fn gain_text(gain: &MetricGain) -> String {
    if gain.noise { "about the same".to_string() } else { gain.gain_label.clone() }
}

/// "prompt reading +35% · decoding about the same": the metric that clears 5% leads.
pub fn metric_summary(gains: &Gains) -> String {
    let mut parts: Vec<(bool, String)> = [("decoding", &gains.decode), ("prompt reading", &gains.prefill)]
        .into_iter()
        .filter_map(|(noun, gain)| gain.as_ref().map(|gain| (gain.noise, format!("{noun} {}", gain_text(gain)))))
        .collect();
    parts.sort_by_key(|(noise, _)| *noise);
    parts.into_iter().map(|(_, text)| text).collect::<Vec<_>>().join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gain(label: &str, noise: bool) -> Option<MetricGain> {
        Some(MetricGain { ratio: 1.0, gain_label: label.to_string(), noise, label: label.to_string() })
    }

    #[test]
    fn the_metric_that_clears_five_percent_leads_and_a_small_one_reads_as_about_the_same() {
        let gains = Gains { decode: gain("+1%", true), prefill: gain("+35%", false) };
        assert_eq!(metric_summary(&gains), "prompt reading +35% · decoding about the same");
        assert_eq!(metric_summary(&Gains::default()), "");
    }
}
