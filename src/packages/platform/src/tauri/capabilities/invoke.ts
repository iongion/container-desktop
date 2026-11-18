// Shared type for the Tauri `invoke` bound into the webview-realm capabilities (keychain), so each one doesn't
// re-declare the generic command signature.
export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
