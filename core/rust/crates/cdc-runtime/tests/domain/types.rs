//! Serialization behaviour of the domain model — one file per module of `src/domain/types/`.
//!
//! Two properties matter more than the shapes themselves, because both are silent when broken and
//! destructive when they reach a user's settings file:
//!
//! 1. an absent optional field must NOT come back as `null` — otherwise every settings write churns
//!    the document, and `git diff` on a user's config becomes noise
//! 2. unknown keys must survive — the core does not model `ai`, `wizard`, or whatever a newer app
//!    version adds, and deleting them would destroy the user's AI configuration
//!
//! Every module that declares a `wire_enum!` now has a file, and the reason is
//! [`agrees_on_the_wire`]: those enums used to spell each variant three times over and the tree
//! compared none of them. `user_settings.rs` still has none — it declares no enum, and its shapes
//! are asserted where they are produced, in `settings/`.
//!
//! `diagnostic.rs` is the exception in the other direction: it is the one module of the model that
//! carries a RULE rather than a shape, so it is the one the gates measure and the one whose tests
//! are load-bearing rather than illustrative.

use std::fmt::{Debug, Display};
use std::str::FromStr;

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

mod command_proxy_protocol;
mod connection;
pub mod container;
mod diagnostic;
mod engine;
mod host;
pub mod image;
mod machine;
mod network;
mod os;
mod pod;
mod registry;
mod resource_sync_protocol;
mod secret;
mod security;
mod swarm;
mod system;
mod volume;

/// The one invariant every `wire_enum!` has: the string `Display` writes, the string `serde` writes
/// and the string `FromStr` reads are the SAME string, for every variant.
///
/// **Walking `VOCABULARY` is the point.** A test that names three variants proves nothing about the
/// fourth somebody adds, and the failure that shape misses is silent — a value this core printed
/// that its own parser then refuses.
pub fn agrees_on_the_wire<T>(vocabulary: &[T])
where
    T: Copy + Debug + Display + FromStr + PartialEq + Serialize + DeserializeOwned,
{
    // Two variants sharing a spelling is not asserted here: it makes `FromStr`'s second arm an
    // unreachable pattern, which the clippy gate denies before any test runs.
    let (first, rest) = vocabulary.split_first().expect("a wire enum has variants");

    for &value in std::iter::once(first).chain(rest) {
        let shown = value.to_string();
        assert_eq!(
            serde_json::to_value(value).expect("a wire enum serializes"),
            Value::String(shown.clone()),
            "Display and serde disagree about {value:?}"
        );
        assert_eq!(
            shown.parse::<T>().ok(),
            Some(value),
            "FromStr does not invert Display for {value:?}"
        );
        assert_eq!(
            serde_json::from_value::<T>(Value::String(shown)).ok(),
            Some(value),
            "serde does not read back what it wrote for {value:?}"
        );
    }

    // Built from a real spelling so it is refused for being unknown rather than for being empty.
    let unknown = format!("{first}-not-a-variant");
    assert!(
        unknown.parse::<T>().is_err(),
        "FromStr accepted {unknown:?}, so an unknown value would arrive as some other variant"
    );
    assert!(
        serde_json::from_value::<T>(Value::String(unknown.clone())).is_err(),
        "serde accepted {unknown:?}"
    );
}
