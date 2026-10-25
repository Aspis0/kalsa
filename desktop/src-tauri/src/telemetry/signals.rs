use super::spec;
use regex::Regex;

pub(super) const PATTERNS: &[(&str, &str)] = &[
    (r"(?i)\bENOSPC\b", "ENOSPC"),
    (r"(?i)\bEACCES\b", "EACCES"),
    (r"(?i)\bENOENT\b", "ENOENT"),
    (r"(?i)\bENOMEM\b", "ENOMEM"),
    (r"(?i)\bEIO\b", "EIO"),
    (r"(?i)\bEPERM\b", "EPERM"),
    (r"(?i)segmentation\s+fault", "segmentation fault"),
    (r"(?i)out\s+of\s+memory", "out of memory"),
    (r"(?i)file\s+not\s+found", "file not found"),
    (r"(?i)Unable\s+to\s+map", "Unable to map"),
    (r"(?i)\bggml_[A-Za-z0-9_]+", "ggml_*"),
    (r"(?i)CUDA\s+error", "CUDA error"),
    (r"(?i)init\s+failed", "init failed"),
    (r"(?i)no\s+space\s+left", "ENOSPC"),
    (
        r"(?i)context\s+overflow|ctx\s+overflow|n_ctx",
        "ctx overflow",
    ),
    (r"(?i)permission\s+denied", "EACCES"),
];

fn matches(pattern: &str, text: &str) -> bool {
    Regex::new(pattern).is_ok_and(|re| re.is_match(text))
}

pub(super) fn signature(raw: &str) -> Option<String> {
    // Source filenames are a closed set, so even a path ending in a user filename cannot escape.
    let location = Regex::new(spec::ASSERT_LOCATION_PATTERN).ok()?;
    let assertion = raw
        .lines()
        .filter(|line| line.contains("GGML_ASSERT"))
        .find_map(|line| location.captures(line));
    let candidate = if let Some(c) = assertion {
        format!("GGML_ASSERT {}.{}:{}", &c[1], &c[2], &c[3])
    } else {
        let known = Regex::new(spec::ENGINE_ERROR_PATTERN).ok()?;
        known.find(raw)?.as_str().to_owned()
    };
    (candidate.len() <= spec::SIGNATURE_CHARS as usize
        && matches(spec::SIGNATURE_PATTERN, &candidate))
    .then_some(candidate)
}

pub(super) fn signal(raw: &str) -> Option<&'static str> {
    let clean = crate::logging::redact_str(raw);
    PATTERNS
        .iter()
        .find(|(pattern, _)| matches(pattern, &clean))
        .map(|(_, token)| *token)
}
