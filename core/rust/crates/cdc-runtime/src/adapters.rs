//! `adapters/` — the engine's REST resources, one module per resource.
//!
//! Free functions, not a base class: the original's `ResourceAdapter` carries a driver and two engine
//! seams, and all three are values here ([`shared::EngineApi`]).
//!
//! An adapter is HANDED the connection it speaks for; it never looks one up.
//! What the engines really answer, and which route each call takes, is in
//!

pub mod base_urls;
pub mod shared;

pub mod containers;
pub mod images;
pub mod networks;
pub mod pods;
pub mod pods_rest;
pub mod secrets;
pub mod swarm;
pub mod swarm_net;
pub mod system_df;
pub mod volumes;
