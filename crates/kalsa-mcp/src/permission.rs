use std::fmt;

use crate::name::NamespacedName;
use crate::record::Trust;

/// Whether a program or a tool still matches what the user approved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PinState {
    Unpinned,
    Pinned,
    Changed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DenyReason {
    BinaryChanged,
    DefinitionChanged,
    NotPinned,
}

impl fmt::Display for DenyReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::BinaryChanged => "the server program changed since it was approved",
            Self::DefinitionChanged => "the tool changed since it was approved",
            Self::NotPinned => "it has not been approved yet",
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Permission {
    Allow,
    Ask,
    Deny(DenyReason),
}

/// First-party tools that run without asking, once their pins match.
const FIRST_PARTY_ALLOW: &[&str] = &["mail.list", "mail.read", "mail.draft"];

pub(crate) struct Standing {
    pub(crate) binary: PinState,
    pub(crate) definition: PinState,
    pub(crate) always_allowed: bool,
    pub(crate) untrusted_elsewhere: bool,
}

/// A pin mismatch denies before anything can allow, and an untrusted result from
/// another server asks before a standing allow.
pub(crate) fn decide(trust: Trust, name: &NamespacedName, standing: Standing) -> Permission {
    if standing.binary == PinState::Changed {
        return Permission::Deny(DenyReason::BinaryChanged);
    }
    if standing.definition == PinState::Changed {
        return Permission::Deny(DenyReason::DefinitionChanged);
    }
    if standing.binary == PinState::Unpinned || standing.definition == PinState::Unpinned {
        return Permission::Deny(DenyReason::NotPinned);
    }
    let table_allows = trust == Trust::FirstParty && FIRST_PARTY_ALLOW.contains(&name.to_string().as_str());
    if standing.untrusted_elsewhere {
        Permission::Ask
    } else if standing.always_allowed || table_allows {
        Permission::Allow
    } else {
        Permission::Ask
    }
}
