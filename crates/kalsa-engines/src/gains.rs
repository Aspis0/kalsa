//! Both gains of a benchmark, each labelled, with the catalog's noise rule applied once.

use serde::Serialize;

use crate::{display::gain_label, Benchmark};

/// PLAN R1b: a difference under 5% is noise, not a gain.
const NOISE_BAND: f64 = 0.05;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricGain {
    pub ratio: f64,
    /// "+1%" or "2.2×".
    pub gain_label: String,
    /// Under 5% either way: shown, but muted and labelled "within noise".
    pub noise: bool,
    /// "decode +1%, within noise" or "prefill +35%".
    pub label: String,
}

/// Decode and prefill, whichever the author published against a baseline. Decode stays the ranking basis.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Gains {
    pub decode: Option<MetricGain>,
    pub prefill: Option<MetricGain>,
}

impl Gains {
    /// Decode first when it exists, else prefill: the figure a ladder dot is drawn from.
    pub fn headline(&self) -> Option<&MetricGain> {
        self.decode.as_ref().or(self.prefill.as_ref())
    }

    /// The metric that clears the 5% bar, decode first. A site card leads with this one: for mistral.rs it is prefill.
    pub fn cleared(&self) -> Option<&MetricGain> {
        [&self.decode, &self.prefill].into_iter().flatten().find(|gain| !gain.noise)
    }

    /// Every metric, the one that clears the bar first and the other second.
    pub fn ordered(&self) -> Vec<&MetricGain> {
        let mut all: Vec<&MetricGain> = [&self.decode, &self.prefill].into_iter().flatten().collect();
        all.sort_by_key(|gain| gain.noise);
        all
    }

    /// "decode +1%, within noise · prefill +35%".
    pub fn label(&self) -> String {
        [&self.decode, &self.prefill].into_iter().flatten().map(|gain| gain.label.as_str()).collect::<Vec<_>>().join(" · ")
    }
}

fn metric_gain(name: &str, value: Option<f64>, base: Option<f64>) -> Option<MetricGain> {
    let ratio = value? / base?;
    let text = gain_label(ratio);
    let noise = ratio > 1.0 - NOISE_BAND && ratio < 1.0 + NOISE_BAND;
    let label = if noise { format!("{name} {text}, within noise") } else { format!("{name} {text}") };
    Some(MetricGain { ratio, gain_label: text, noise, label })
}

pub fn gains_of(benchmark: &Benchmark) -> Gains {
    Gains {
        decode: metric_gain("decode", benchmark.decode_tok_s, benchmark.baseline_decode_tok_s),
        prefill: metric_gain("prefill", benchmark.prefill_tok_s, benchmark.baseline_prefill_tok_s),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn benchmark(decode: f64, base_decode: f64, prefill: f64, base_prefill: f64) -> Benchmark {
        let text = format!(
            "source = \"https://example.invalid/a\"\nmachine = \"M1 Max\"\nchip_tag = \"apple-m1\"\nmodel = \"m\"\nquant = \"Q4\"\n\
             decode_tok_s = {decode}\nprefill_tok_s = {prefill}\nbaseline = \"b\"\nbaseline_decode_tok_s = {base_decode}\nbaseline_prefill_tok_s = {base_prefill}\n"
        );
        toml::from_str(&text).expect("a benchmark")
    }

    #[test]
    fn both_metrics_are_labelled_and_a_small_one_is_noise() {
        let gains = gains_of(&benchmark(46.8, 46.4, 2947.0, 2178.5));
        assert_eq!(gains.label(), "decode +1%, within noise · prefill +35%");
        assert!(gains.decode.as_ref().is_some_and(|gain| gain.noise));
        assert!(gains.prefill.as_ref().is_some_and(|gain| !gain.noise));
    }

    #[test]
    fn five_percent_is_a_gain_and_just_under_is_noise() {
        assert!(!gains_of(&benchmark(105.0, 100.0, 1.0, 1.0)).decode.unwrap().noise);
        assert!(gains_of(&benchmark(104.9, 100.0, 1.0, 1.0)).decode.unwrap().noise);
        assert!(gains_of(&benchmark(96.0, 100.0, 1.0, 1.0)).decode.unwrap().noise);
        assert!(!gains_of(&benchmark(90.0, 100.0, 1.0, 1.0)).decode.unwrap().noise);
    }

    #[test]
    fn the_metric_that_clears_the_bar_leads_and_neither_clearing_gives_no_headline() {
        let both = gains_of(&benchmark(46.8, 46.4, 2947.0, 2178.5));
        assert_eq!(both.cleared().map(|gain| gain.label.as_str()), Some("prefill +35%"));
        assert_eq!(both.ordered().iter().map(|gain| gain.label.as_str()).collect::<Vec<_>>(), ["prefill +35%", "decode +1%, within noise"]);
        let neither = gains_of(&benchmark(10.1, 10.0, 100.0, 101.0));
        assert!(neither.cleared().is_none());
        let both_clear = gains_of(&benchmark(20.0, 10.0, 150.0, 100.0));
        assert_eq!(both_clear.cleared().map(|gain| gain.label.as_str()), Some("decode 2.0×"));
    }

    #[test]
    fn a_missing_baseline_gives_no_gain_for_that_metric() {
        let mut only_decode = benchmark(10.0, 5.0, 1.0, 1.0);
        only_decode.prefill_tok_s = None;
        let gains = gains_of(&only_decode);
        assert_eq!(gains.label(), "decode 2.0×");
        assert!(gains.prefill.is_none());
        assert_eq!(gains.headline().map(|gain| gain.label.as_str()), Some("decode 2.0×"));
    }
}
