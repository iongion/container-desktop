//! `adapters/systemDf.ts` — image disk usage, and the pure summarizer over the two shapes.
//!
//! Measured on this machine: Docker 29.7.0 answers `LayersSize` plus `Images[].Size/SharedSize`,
//! libpod 5.7.0 answers `ImagesSize` plus `Images[].UniqueSize`. Reclaimable is the unique bytes of
//! images no container references.

use serde_json::Value;

use super::shared::{AdapterError, ApiCall, EngineApi};
use crate::domain::types::system::SystemDf;

pub async fn get(api: &EngineApi) -> Result<SystemDf, AdapterError> {
    let raw: Value = api.read(&ApiCall::get("/system/df").on_surface()).await?;
    Ok(summarize(&raw, api.uses_docker_api()))
}

/// `Math.max(0, …)` absorbs a `SharedSize` LARGER than the size, which is the only way the difference
/// goes negative. Docker's `SharedSize: -1` for an image it cannot attribute is not absorbed by it —
/// it adds a byte — and that is reproduced rather than repaired: what to charge an unattributable
/// layer is a decision, not a typo.
///
/// The declared total is trusted only when positive, else the unique bytes are summed.
pub fn summarize(raw: &Value, is_docker: bool) -> SystemDf {
    let images = raw.get("Images").and_then(Value::as_array);
    let images = images.map_or(&[][..], Vec::as_slice);
    let mut sum_unique = 0_i64;
    let mut reclaimable = 0_i64;
    let mut reclaimable_count = 0_i64;
    for image in images {
        let in_use = number(image.get("Containers")) > 0;
        let unique = if is_docker {
            number(image.get("Size")) - number(image.get("SharedSize"))
        } else {
            number(image.get("UniqueSize"))
        }
        .max(0);
        sum_unique += unique;
        if !in_use {
            reclaimable += unique;
            reclaimable_count += 1;
        }
    }
    let declared = number(raw.get(if is_docker {
        "LayersSize"
    } else {
        "ImagesSize"
    }));
    SystemDf {
        images_size: if declared > 0 { declared } else { sum_unique },
        images_reclaimable: reclaimable,
        images_count: images.len() as i64,
        reclaimable_count,
    }
}

/// `Number(x ?? 0)` — absent, null and a non-number are all zero, which is what
/// `Number.isFinite` leaves after the original's guards.
fn number(value: Option<&Value>) -> i64 {
    value.and_then(Value::as_i64).unwrap_or_default()
}
