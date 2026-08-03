//! Deny-by-default attribute filtering.
//!
//! Connection data is unusually hostile to telemetry: a detected engine path carries the user's home
//! directory and therefore their username, socket URIs carry uids and hostnames, an SSH scope name is
//! routinely a real hostname, proxy URLs can embed credentials, and argv and stdin carry registry
//! tokens. So an attribute is exported only if it is explicitly allowlisted.
//!
//! The bounds matter as much as the allowlist: without them an allowlisted key holding an
//! unexpectedly large value would turn a span into an exfiltration channel.

use crate::attributes::attr;
use crate::trace::{Attribute, AttributeValue};

/// Maximum attributes exported on a single span. Beyond this, extras are dropped.
pub const MAX_ATTRIBUTES: usize = 32;
/// Maximum characters in an exported attribute value. Longer values are dropped, not truncated —
/// a truncated secret is still a secret, and a truncated identifier is misleading.
pub const MAX_VALUE_CHARS: usize = 256;

/// Is this key allowed to leave the process?
///
/// Exact match only. No prefix or wildcard matching: `cdc.exec.*` would happily admit
/// `cdc.exec.stdin`, which is exactly the mistake this module exists to prevent.
pub fn is_exportable(key: &str) -> bool {
    attr::EXPORTABLE.contains(&key)
}

/// Reason an attribute was dropped. Returned rather than logged so callers can surface it in
/// diagnostics or tests; a silent drop is how an allowlist becomes a mystery.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dropped {
    NotAllowlisted,
    ValueTooLong,
    TooManyAttributes,
}

/// Apply the allowlist and the bounds to a set of candidate attributes.
///
/// Returns the attributes that may be exported, plus what was dropped and why. Input order is
/// preserved so the `TooManyAttributes` cut is deterministic and testable.
pub fn filter<I>(candidates: I) -> (Vec<Attribute>, Vec<(String, Dropped)>)
where
    I: IntoIterator<Item = (String, AttributeValue)>,
{
    let mut kept: Vec<Attribute> = Vec::new();
    let mut dropped: Vec<(String, Dropped)> = Vec::new();

    for (key, value) in candidates {
        if !is_exportable(&key) {
            dropped.push((key, Dropped::NotAllowlisted));
            continue;
        }
        if value.exported_chars() > MAX_VALUE_CHARS {
            dropped.push((key, Dropped::ValueTooLong));
            continue;
        }
        if kept.len() >= MAX_ATTRIBUTES {
            dropped.push((key, Dropped::TooManyAttributes));
            continue;
        }
        kept.push(Attribute::new(key, value));
    }

    (kept, dropped)
}
