// adapters/baseUrls.ts — the two engine REST roots, in a dependency-free leaf.
//
// Kept separate from adapters/shared.ts (which imports Application) so modules that must NOT pull the
// app-singleton graph — notably the pure swarm-rest helpers used by the runtime dialect — can import the
// base URLs without creating a dialect → adapter → Application import cycle. shared.ts re-exports these
// for the many adapters that already import them from "./shared".

/** libpod (Podman) compat root. */
export const LIBPOD_BASE_URL = "http://d/v4.0.0/libpod";
/** Docker root. */
export const DOCKER_BASE_URL = "http://localhost";

/**
 * Client request timeout (ms) for slow, destructive container lifecycle ops — stop, restart, force-remove and
 * stack teardown deletes. These wait on the container's stop grace period server-side (default ~10s, and far
 * longer when a container ignores SIGTERM and must be SIGKILLed), so the generic 3s request timeout would
 * spuriously "fail" them while the engine is still working — leaving state inconsistent and, under a teardown
 * request storm, tripping a transient disconnect. Finite so a truly hung request still resolves eventually.
 */
export const LIFECYCLE_TIMEOUT_MS = 60_000;
