//! The disk-usage summarizer, over the real numbers both engines answered on this machine.

use cdc_runtime::adapters::base_urls::LIBPOD_PATH_PREFIX;
use cdc_runtime::adapters::system_df::{self, summarize};
use cdc_runtime::domain::types::engine::ApiSurface;
use serde_json::json;

use super::{only, serving};

/// Three rows of real `GET http://d/v4.0.0/libpod/system/df` — `ImagesSize` plus `UniqueSize`.
fn libpod_answer() -> serde_json::Value {
    json!({
        "ImagesSize": 701_505_876_i64,
        "Images": [
            {"Size": 120_227_625, "SharedSize": 0, "UniqueSize": 120_227_625, "Containers": 1},
            {"Size": 138_172_120, "SharedSize": 138_154_496, "UniqueSize": 17_624, "Containers": 0},
            {"Size": 138_164_221, "SharedSize": 138_154_496, "UniqueSize": 9_725, "Containers": 0}
        ]
    })
}

/// Three rows of real `GET http://localhost/system/df` — `LayersSize`, and no `UniqueSize` at all.
fn docker_answer() -> serde_json::Value {
    json!({
        "LayersSize": 15_727_171_663_i64,
        "Images": [
            {"Size": 525_159_599, "SharedSize": 12_919_065, "Containers": 0},
            {"Size": 193_265_711, "SharedSize": 12_973_693, "Containers": 0},
            {"Size": 714_563_035, "SharedSize": 0, "Containers": 1}
        ]
    })
}

#[test]
fn libpods_answer_reduces_to_the_declared_total_and_the_unique_bytes_nothing_references() {
    let summary = summarize(&libpod_answer(), false);

    assert_eq!(summary.images_size, 701_505_876);
    assert_eq!(summary.images_count, 3);
    assert_eq!(summary.images_reclaimable, 17_624 + 9_725);
    assert_eq!(
        summary.reclaimable_count, 2,
        "the referenced image is not reclaimable"
    );
}

#[test]
fn dockers_answer_reduces_to_the_same_shape_from_size_minus_shared() {
    let summary = summarize(&docker_answer(), true);

    assert_eq!(summary.images_size, 15_727_171_663);
    assert_eq!(summary.images_count, 3);
    assert_eq!(
        summary.images_reclaimable,
        (525_159_599 - 12_919_065) + (193_265_711 - 12_973_693)
    );
    assert_eq!(summary.reclaimable_count, 2);
}

#[test]
fn reading_the_wrong_surfaces_unique_field_would_answer_nothing_at_all() {
    // libpod's rows read as Docker's: `Size - SharedSize` is 17624 and 9725 by coincidence of the
    // same data, but the DECLARED total comes from the other key and is what diverges.
    let summary = summarize(&libpod_answer(), true);

    assert_eq!(
        summary.images_size,
        120_227_625 + 17_624 + 9_725,
        "no `LayersSize`, so it falls back to summing"
    );
}

#[test]
fn the_declared_total_is_only_trusted_when_it_is_positive() {
    let answer = json!({
        "ImagesSize": 0,
        "Images": [{"UniqueSize": 500, "Containers": 0}]
    });

    assert_eq!(summarize(&answer, false).images_size, 500);
}

#[test]
fn a_shared_size_larger_than_the_size_is_clamped_rather_than_subtracted_from_the_total() {
    let answer = json!({"Images": [{"Size": 100, "SharedSize": 150, "Containers": 0}]});

    let summary = summarize(&answer, true);

    assert_eq!(summary.images_size, 0);
    assert_eq!(summary.images_reclaimable, 0);
    assert_eq!(
        summary.reclaimable_count, 1,
        "it is still an image nothing references"
    );
}

#[test]
fn an_unattributable_shared_size_adds_a_byte_and_that_is_the_originals_arithmetic() {
    let answer = json!({"Images": [{"Size": 100, "SharedSize": -1, "Containers": 0}]});

    assert_eq!(summarize(&answer, true).images_reclaimable, 101);
}

#[test]
fn an_answer_with_no_images_is_all_zeroes_and_not_a_failure() {
    for answer in [json!({}), json!({"Images": null}), json!({"Images": []})] {
        let summary = summarize(&answer, true);
        assert_eq!(summary.images_count, 0);
        assert_eq!(summary.images_size, 0);
        assert_eq!(summary.reclaimable_count, 0);
    }
}

#[tokio::test]
async fn the_call_names_the_surface_root() {
    let (api, log) = serving(ApiSurface::Libpod, &libpod_answer().to_string());

    let summary = system_df::get(&api).await.expect("the usage");

    assert_eq!(only(&log).path, format!("{LIBPOD_PATH_PREFIX}/system/df"));
    assert_eq!(summary.images_count, 3);
}

#[tokio::test]
async fn the_docker_surface_asks_the_same_path_with_no_prefix_and_reads_its_own_fields() {
    let (api, log) = serving(ApiSurface::Docker, &docker_answer().to_string());

    let summary = system_df::get(&api).await.expect("the usage");

    assert_eq!(only(&log).path, "/system/df");
    assert_eq!(summary.images_size, 15_727_171_663);
}
