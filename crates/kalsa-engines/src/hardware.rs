//! Labels for hardware tags, shared by the app and the site.

/// Every hardware family a catalog entry may name, in the order the pages list them.
pub const FAMILIES: &[&str] = &["apple-m1", "apple-m2", "apple-m3", "apple-m4", "apple-m5", "apple-m6", "nvidia", "amd", "intel", "cpu"];

/// "apple-m3" is generation 3; every other tag has none.
pub fn chip_generation(tag: &str) -> Option<u8> {
    tag.strip_prefix("apple-m")?.parse().ok()
}

/// "apple-m1" is "Apple M1", "nvidia" is "NVIDIA".
pub fn family_label(tag: &str) -> String {
    match (chip_generation(tag), tag) {
        (Some(generation), _) => format!("Apple M{generation}"),
        (None, "nvidia") => "NVIDIA".to_string(),
        (None, "amd") => "AMD".to_string(),
        (None, "intel") => "Intel".to_string(),
        (None, "cpu") => "CPU".to_string(),
        (None, other) => other.to_string(),
    }
}

/// The hardware a project says it runs on: Apple generations first as one label ("Apple M1–M5"), then the rest.
pub fn hardware_labels(tags: &[String]) -> Vec<String> {
    let mut generations: Vec<u8> = tags.iter().filter_map(|tag| chip_generation(tag)).collect();
    generations.sort_unstable();
    let mut labels = Vec::new();
    if let (Some(first), Some(last)) = (generations.first(), generations.last()) {
        let range = generations.len() > 2 && usize::from(last - first) == generations.len() - 1;
        labels.push(if range {
            format!("Apple M{first}–M{last}")
        } else {
            let names: Vec<String> = generations.iter().map(|generation| format!("M{generation}")).collect();
            format!("Apple {}", names.join(", "))
        });
    }
    labels.extend(
        ["nvidia", "amd", "intel", "cpu"]
            .into_iter()
            .filter(|tag| tags.iter().any(|candidate| candidate == tag))
            .map(family_label),
    );
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn labels_group_apple_generations() {
        assert_eq!(hardware_labels(&tags(&["apple-m1", "apple-m2", "apple-m3", "nvidia"])), ["Apple M1–M3", "NVIDIA"]);
        assert_eq!(hardware_labels(&tags(&["apple-m1", "apple-m5"])), ["Apple M1, M5"]);
        assert_eq!(hardware_labels(&tags(&["cpu", "amd"])), ["AMD", "CPU"]);
    }

    #[test]
    fn a_tag_reads_as_its_family_name() {
        assert_eq!(family_label("apple-m2"), "Apple M2");
        assert_eq!(family_label("nvidia"), "NVIDIA");
    }
}
