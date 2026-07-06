// The compose labels we write (and read back for grouping/reconciliation). Single source of truth,
// shared by the translator, the REST reconcile/listing, and (re-exported) the container normalizer.

export const LABEL_PROJECT = "com.docker.compose.project";
export const LABEL_SERVICE = "com.docker.compose.service";
export const LABEL_CONTAINER_NUMBER = "com.docker.compose.container-number";
export const LABEL_CONFIG_HASH = "com.docker.compose.config-hash";
export const LABEL_NETWORK = "com.docker.compose.network";
export const LABEL_VOLUME = "com.docker.compose.volume";
/** podman-compose also stamps these; the Containers grouping already keys off both project keys. */
export const LABEL_PODMAN_PROJECT = "io.podman.compose.project";
export const LABEL_PODMAN_SERVICE = "io.podman.compose.service";

/** The keys that identify a container's owning project (either engine's convention). */
export const COMPOSE_PROJECT_LABELS = [LABEL_PROJECT, LABEL_PODMAN_PROJECT] as const;
/** Service-name keys — read BOTH so we recognize stacks created by podman-compose, not just our own. */
export const COMPOSE_SERVICE_LABELS = [LABEL_SERVICE, LABEL_PODMAN_SERVICE] as const;
