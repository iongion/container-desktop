// Tauri (webview) implementation of the IWorkspaceAccess host port — a thin binding onto the native Rust
// commands in src-tauri/src/host.rs. The AI loop runs in the webview here, so every op crosses `invoke`.
//
// SECURITY: this layer performs NO path validation. The workspace root (from the user's AI settings) is passed
// with each call and the RUST command canonicalizes + confines the model-supplied relative path, rejecting `..`
// and symlink escapes. Keeping confinement native is the whole point — the webview must not be the guard.
// Mirrors platform/electron/capabilities/workspaceAccess.ts so both shells behave identically.

import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import type { TauriInvoke } from "@/platform/tauri/capabilities/invoke";

export function createTauriWorkspaceAccess(
  invoke: TauriInvoke,
  resolveRoot: () => Promise<string | undefined> | string | undefined,
): IWorkspaceAccess {
  // Resolved per call, so changing the folder in Settings takes effect without rebuilding the capability.
  const requireRoot = async (): Promise<string> => {
    const value = await resolveRoot();
    if (!value?.trim()) {
      throw new Error("No workspace is configured. Choose a workspace folder in Settings → AI.");
    }
    return value;
  };

  return {
    root: async () => invoke("workspace_root", { root: await requireRoot() }),
    read: async (path) => invoke("workspace_read", { root: await requireRoot(), path }),
    write: async (path, contents) => invoke("workspace_write", { root: await requireRoot(), path, contents }),
    edit: async (path, oldString, newString, replaceAll) =>
      invoke("workspace_edit", {
        root: await requireRoot(),
        path,
        oldString,
        newString,
        replaceAll: replaceAll ?? false,
      }),
    list: async (path) => invoke("workspace_list", { root: await requireRoot(), path }),
    stat: async (path) => invoke("workspace_stat", { root: await requireRoot(), path }),
    remove: async (path) => invoke("workspace_remove", { root: await requireRoot(), path }),
    glob: async (pattern) => invoke("workspace_glob", { root: await requireRoot(), pattern }),
    grep: async (pattern, options) =>
      invoke("workspace_grep", {
        root: await requireRoot(),
        pattern,
        glob: options?.glob,
        maxResults: options?.maxResults,
      }),
    exec: async (program, args) => invoke("workspace_exec", { root: await requireRoot(), program, args }),
  };
}
