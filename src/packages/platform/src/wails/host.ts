import type { IFileSystem, IPath } from "@/host-contract/fs";
import type { IPlatform } from "@/platform/contract";

// Mirror of src/platform/tauri/host.ts: Platform + FileSystem forward to native commands over the
// injected invoke shim (here Wails' Call.ByName → the Go PlatformService/FsService, the analog of
// src-tauri/src/host.rs); Path is pure-JS (no round trip). Keeping this identical to the Tauri host
// is the point — only the invoke transport differs.
export type WailsInvoke = (command: string, args?: Record<string, unknown>) => Promise<any>;

export function createPlatform(invoke: WailsInvoke, osType: string): IPlatform {
  return {
    OPERATING_SYSTEM: osType as IPlatform["OPERATING_SYSTEM"],
    getHomeDir: () => invoke("get_home_dir"),
    getEnvironmentVariable: (name: string) => invoke("get_env_var", { name }),
    isFlatpak: () => invoke("is_flatpak"),
    getUserDataPath: () => invoke("get_user_data_path"),
    getOsType: () => invoke("get_os_type"),
    getOsArch: () => invoke("get_os_arch"),
    // ~/.ssh/config parsed natively (Go) — the ssh-config npm parser pulls node builtins and can't
    // bundle into the webview, so it lives in the host I/O layer. Returns the SSHHost[] the scope picker lists.
    getSSHConfig: () => invoke("get_ssh_config"),
    // Launch a per-OS terminal running `launcher args...` via the Go launch_terminal command. Normalize the
    // same overloads as the Electron host, then hand off {launcher, args, title}.
    launchTerminal: (commandLauncherOrOptions, params, opts) => {
      let launcher: string;
      let args: string[];
      let title: string | undefined;
      if (typeof commandLauncherOrOptions === "string") {
        launcher = commandLauncherOrOptions;
        args = params ?? [];
        title = opts?.title;
      } else {
        const options = commandLauncherOrOptions ?? {};
        launcher = options.commandLauncher || options.launcher || options.command || "";
        args = options.params || options.args || [];
        title = options.title;
      }
      return invoke("launch_terminal", { payload: { launcher, args, title } });
    },
  };
}

// Pure-JS path ops (no Go round-trip). Cleans separators, joins, and collapses `.`/`..` segments with the
// same posix semantics node's `path` gives the Electron host (a relative path may ascend above its start,
// an absolute path cannot rise above root).
export function createPath(osType: string): IPath {
  const isWin = osType === "Windows_NT";
  const toPosix = (p: string) => (isWin ? p.replace(/\\/g, "/") : p);
  const toNative = (p: string) => (isWin ? p.replace(/\//g, "\\") : p);
  const normalizePosix = (p: string): string => {
    const isAbsolute = p.startsWith("/");
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") {
        continue;
      }
      if (seg === "..") {
        if (out.length > 0 && out[out.length - 1] !== "..") {
          out.pop();
        } else if (!isAbsolute) {
          out.push(".."); // a relative path keeps leading `..`; an absolute one drops them at root
        }
        continue;
      }
      out.push(seg);
    }
    const joined = out.join("/");
    if (isAbsolute) {
      return `/${joined}`;
    }
    return joined === "" ? "." : joined;
  };
  const joinPosix = (parts: string[]) =>
    normalizePosix(
      parts
        .filter((p) => p != null && p !== "")
        .map((p) => toPosix(p))
        .join("/"),
    );
  return {
    join: async (...parts: string[]) => toNative(joinPosix(parts)),
    resolve: async (...parts: string[]) => toNative(joinPosix(parts)),
    basename: async (location: string, ext?: string) => {
      const base = toPosix(location).replace(/\/+$/, "").split("/").pop() || "";
      return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
    },
    dirname: async (location: string) => {
      const cleaned = toPosix(location).replace(/\/+$/, "");
      const idx = cleaned.lastIndexOf("/");
      if (idx < 0) return ".";
      if (idx === 0) return toNative("/");
      return toNative(cleaned.slice(0, idx));
    },
  };
}

export function createFileSystem(invoke: WailsInvoke): IFileSystem {
  return {
    readTextFile: (location: string) => invoke("fs_read_text_file", { path: location }),
    writeTextFile: (location: string, contents: string) => invoke("fs_write_text_file", { path: location, contents }),
    // 0600 owner-only write for AI credentials/permissions/knowledge — the native Go command hardens the mode
    // (FsService.WritePrivateTextFile), matching the Node impl. Best-effort on Windows (no unix mode).
    writePrivateTextFile: (location: string, contents: string) =>
      invoke("fs_write_private_text_file", { path: location, contents }),
    isFilePresent: (filePath: string) => invoke("fs_is_file_present", { path: filePath }),
    mkdir: (location: string, options?: any) =>
      invoke("fs_mkdir", { path: location, recursive: options?.recursive ?? true }),
    rename: (oldPath: string | URL, newPath: string | URL) =>
      invoke("fs_rename", { oldPath: String(oldPath), newPath: String(newPath) }),
  };
}
