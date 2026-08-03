// The domain model, named as `src/packages/container-client/src/types/` names it — one module per
// module, and the two the original keeps outside that directory named after the file that declares
// them, plus `diagnostic` — the design's code vocabulary, which the original has no counterpart for
// at all.
//
// Hand-written and hand-maintained.
//
// Note what is NOT here: `deny_unknown_fields`. The core must tolerate keys it does not model, or a
// settings write would delete whatever a newer app version added.

/// A closed set of variants and the string each one IS on the wire.
///
/// **The spelling is written once.** It used to be written three times per variant — the `serde`
/// rename, a `Display` arm and a `FromStr` arm — with nothing in the tree comparing them, so a
/// rename that reached only `serde` would have left `to_string()` and `serde_json` disagreeing about
/// the same value, in a model whose entire job is to agree with the TypeScript oracle byte for byte.
/// One literal per variant now feeds all three, and the per-module tests walk
/// `ControllerScopeType::VOCABULARY` to assert they still do.
///
/// `TryFrom<&str>`, `TryFrom<String>` and `TryFrom<&String>` are NOT generated. `typify` emitted all
/// three for every enum; each one was `value.parse()` spelled longer, and across the workspace —
/// every crate, every target, every feature — the only caller of any of them was a test written to
/// cover them. `FromStr` is the one that carries the rule, and `.parse()` is how Rust asks for it.
macro_rules! wire_enum {
    ($(#[$outer:meta])* $name:ident { $($variant:ident = $wire:literal),+ $(,)? }) => {
        $(#[$outer])*
        #[derive(
            ::serde::Deserialize,
            ::serde::Serialize,
            Clone,
            Copy,
            Debug,
            Eq,
            Hash,
            Ord,
            PartialEq,
            PartialOrd,
        )]
        pub enum $name {
            $(#[serde(rename = $wire)] $variant,)+
        }

        impl $name {
            /// Every variant, in declaration order, for a caller that has to walk the set — the
            /// tests do, and so would a `--list` flag. Named as
            /// [`DiagnosticCode::VOCABULARY`](super::diagnostic::DiagnosticCode::VOCABULARY) is.
            pub const VOCABULARY: &'static [Self] = &[$(Self::$variant),+];

            /// The wire spelling: the same literal `serde` reads and writes.
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $wire,)+
                }
            }
        }

        impl ::std::fmt::Display for $name {
            fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl ::std::str::FromStr for $name {
            type Err = super::error::ConversionError;
            fn from_str(value: &str) -> ::std::result::Result<Self, super::error::ConversionError> {
                match value {
                    $($wire => Ok(Self::$variant),)+
                    _ => Err("invalid value".into()),
                }
            }
        }
    };
}

pub mod command_proxy_protocol;
pub mod connection;
pub mod container;
pub mod diagnostic;
pub mod engine;
pub mod host;
pub mod image;
pub mod machine;
pub mod network;
pub mod os;
pub mod pod;
pub mod registry;
pub mod resource_sync_protocol;
pub mod secret;
pub mod security;
pub mod swarm;
pub mod system;
pub mod user_settings;
pub mod volume;

/// `null` where a collection was expected, read as the empty collection.
///
/// **Not defensive tidying — it is what the engines send.** Real podman answers `"Labels": null` for
/// a container with no labels and real Docker answers `"Options": null` for a volume with none; a
/// `Vec` or a map would refuse both, and `#[serde(default)]` does not help because the key is
/// PRESENT. The original never meets this because a cast cannot fail.
pub(crate) fn null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + serde::Deserialize<'de>,
{
    use serde::Deserialize;
    Ok(Option::deserialize(deserializer)?.unwrap_or_default())
}

/// The same rule one level deeper: a map that may be `null`, whose VALUES may be `null` too.
///
/// A port that is exposed but bound to nothing is `"Ports": {"80/tcp": null}` on a real container
/// inspect (measured, podman 5.7.0), so [`null_default`] on the map is not enough — it refuses the
/// value. Both readings mean the empty list, and collapsing them here spares every consumer an
/// `Option` that carries no information.
pub(crate) fn null_tolerant_map<'de, D, T>(
    deserializer: D,
) -> Result<std::collections::BTreeMap<String, T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + serde::Deserialize<'de>,
{
    use serde::Deserialize;
    let raw: Option<std::collections::BTreeMap<String, Option<T>>> =
        Option::deserialize(deserializer)?;
    Ok(raw
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| (key, value.unwrap_or_default()))
        .collect())
}

pub mod error {
    /// What a [`FromStr`](std::str::FromStr) in this model refuses with.
    #[derive(Debug, thiserror::Error)]
    #[error("{0}")]
    pub struct ConversionError(&'static str);

    impl From<&'static str> for ConversionError {
        fn from(value: &'static str) -> Self {
            Self(value)
        }
    }
}
