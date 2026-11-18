//! A per-launch bearer key. It never appears in Debug, logs, pidfiles or errors.

use std::fmt;

#[derive(Clone)]
pub struct ApiKey(String);

impl ApiKey {
    pub fn random() -> Result<Self, String> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
        Ok(Self(bytes.iter().map(|byte| format!("{byte:02x}")).collect()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ApiKey(<redacted>)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_never_contains_the_key() {
        let key = ApiKey::random().expect("OS entropy");
        assert_eq!(key.as_str().len(), 64);
        assert!(!format!("{key:?}").contains(key.as_str()));
        let holder = format!("state {:?}", vec![key.clone()]);
        assert!(!holder.contains(key.as_str()));
    }
}
