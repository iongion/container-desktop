// Shared type for the Tauri `invoke` bound into the AI runtime adapters (keyStore, sandboxExec, dns). Kept here
// so the adapters don't each re-declare the generic command signature.
export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
