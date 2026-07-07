// Shared type for the Wails runtime call bound into the host adapters (keyStore, sandboxExec, dns).
// bridge.ts builds the concrete shim over @wailsio/runtime's Call.ByName — mapping the Tauri command
// names to main.<Service>.<Method> — then dependency-injects it, so the adapters never import
// @wailsio directly. Mirrors src/platform/tauri/capabilities/invoke.ts.
export type WailsInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
