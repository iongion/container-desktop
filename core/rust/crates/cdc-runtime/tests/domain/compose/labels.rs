//! The labels a stack is stamped with.
//!
//! One test, and it is not decorative: these strings are a CONTRACT with two external tools. A
//! typo here regroups every container in the app and nothing else notices.

use cdc_runtime::domain::compose::labels::{
    COMPOSE_PROJECT_LABELS, COMPOSE_SERVICE_LABELS, LABEL_CONFIG_HASH, LABEL_CONTAINER_NUMBER,
    LABEL_NETWORK, LABEL_PODMAN_PROJECT, LABEL_PODMAN_SERVICE, LABEL_PROJECT, LABEL_SERVICE,
    LABEL_VOLUME,
};

#[test]
fn the_labels_are_spelled_as_the_two_compose_implementations_write_them() {
    assert_eq!(LABEL_PROJECT, "com.docker.compose.project");
    assert_eq!(LABEL_SERVICE, "com.docker.compose.service");
    assert_eq!(
        LABEL_CONTAINER_NUMBER,
        "com.docker.compose.container-number"
    );
    assert_eq!(LABEL_CONFIG_HASH, "com.docker.compose.config-hash");
    assert_eq!(LABEL_NETWORK, "com.docker.compose.network");
    assert_eq!(LABEL_VOLUME, "com.docker.compose.volume");
    assert_eq!(LABEL_PODMAN_PROJECT, "io.podman.compose.project");
    assert_eq!(LABEL_PODMAN_SERVICE, "io.podman.compose.service");
}

#[test]
fn both_conventions_are_searched_for_a_project_and_for_a_service() {
    assert_eq!(
        COMPOSE_PROJECT_LABELS,
        [LABEL_PROJECT, LABEL_PODMAN_PROJECT]
    );
    assert_eq!(
        COMPOSE_SERVICE_LABELS,
        [LABEL_SERVICE, LABEL_PODMAN_SERVICE]
    );
}
