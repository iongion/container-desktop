// Composition runtime: the symmetric facade, the 3-unit seam (transport × dialect × profile), the composed
// HostClient, and the (engine, host) registry. The legacy AbstractEngine + 10-leaf inheritance tree this
// replaced has been removed.
export * from "./composition";
export * from "./facade";
export * from "./host-client";
export * from "./registry";
