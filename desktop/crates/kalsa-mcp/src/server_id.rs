use std::fmt;

use crate::error::Error;

/// The namespace a server's tools appear under: the model sees `<id>.<tool>`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ServerId(String);

impl ServerId {
    pub fn new(id: &str) -> Result<Self, Error> {
        let mut chars = id.chars();
        let starts_ok = chars.next().is_some_and(|c| c.is_ascii_lowercase());
        let rest_ok = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        if starts_ok && rest_ok && id.len() <= 32 {
            Ok(Self(id.to_owned()))
        } else {
            Err(Error::InvalidServerId)
        }
    }
}

impl fmt::Display for ServerId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
