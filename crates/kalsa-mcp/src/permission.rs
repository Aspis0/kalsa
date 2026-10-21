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
///
/// The browser's click and type are here too, and that is a decision and not an
/// oversight: a write is never sent on the model's word. The sidecar holds every
/// write it is asked for and only sends it when the person confirms that card, so
/// the permission layer does not have to be the thing that stops a write.
const FIRST_PARTY_ALLOW: &[&str] = &[
    "mail.list",
    "mail.read",
    "mail.draft",
    "browser.browser_open",
    "browser.browser_read",
    "browser.browser_find",
    "browser.browser_click",
    "browser.browser_type",
    // **The picture of the page is a look, and it is the model's own tool.**
    // It is a read of the screen the model is driving, not a write, and the
    // sidecar takes the conversation's own guards for it: a page that is not
    // this conversation's is refused there.
    "browser.browser_screenshot",
];

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
