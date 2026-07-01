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
