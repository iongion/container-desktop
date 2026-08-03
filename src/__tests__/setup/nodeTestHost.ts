// Node-backed host globals for the Vitest process. container-client reads Command/Platform/Path/FS/
// CURRENT_OS_TYPE as globals that each shell installs from its native ports; under plain Node the test
// process installs these thin node: adapters over the same host-contract ports instead.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OperatingSystem } from "@/container-client/types/os";
import type { FileSystemEntryKind, IFileDiscoverySystem, IPath } from "@/host-contract/fs";
import { createLogger } from "@/logger";
import type { IPlatform } from "@/platform/contract";
import { getWindowsPipeName } from "@/utils";

const logger = createLogger("test.nodeHost");

export const CURRENT_OS_TYPE = os.type() as OperatingSystem;

// Darwin kernel major from os.release() (e.g. "24.3.0" → 24). macOS 15 Sequoia = Darwin 24; macOS 26
// Tahoe = Darwin 25. Used to gate Apple Container networks (full only on macOS 26 / Darwin ≥ 25).
// undefined off Darwin or when the release string can't be parsed.
export const CURRENT_DARWIN_MAJOR: number | undefined =
  os.type() === "Darwin" ? Number.parseInt(`${os.release()}`.split(".")[0], 10) || undefined : undefined;

function fileSystemEntryKind(value: fs.Stats | fs.Dirent): FileSystemEntryKind {
  if (value.isSymbolicLink()) return "symlink";
  if (value.isFile()) return "file";
  if (value.isDirectory()) return "directory";
  return "other";
}

// The named-pipe filesystem, which is a real directory Windows lets you list.
const WINDOWS_PIPE_DIRECTORY = "\\\\.\\pipe\\";

// Whether a Windows named pipe is being served, WITHOUT opening it.
//
// `fs.existsSync` cannot answer this: measured against a live Docker Desktop on Windows 11, statting
// `\\.\pipe\dockerDesktopLinuxEngine` fails with EBUSY and existsSync returns false for EVERY named pipe,
// present or not — libuv's stat opens the path, and opening a pipe means becoming a CLIENT of it. That also
// makes the check destructive: it consumes one of the server's instances, and a pipe whose instances are all
// busy is indistinguishable from one that does not exist.
//
// Listing the pipe filesystem answers the question the caller actually asked and touches nothing. Names are
// compared case-insensitively because Windows pipe names are.
function isNamedPipeServed(name: string): boolean {
  try {
    const target = name.toLowerCase();
    return fs.readdirSync(WINDOWS_PIPE_DIRECTORY).some((entry) => entry.toLowerCase() === target);
  } catch (error: any) {
    logger.error("Unable to enumerate named pipes", error);
    return false;
  }
}

export const FS: IFileDiscoverySystem = {
  async readTextFile(location: string) {
    return await fs.readFileSync(location, { encoding: "utf-8" }).toString();
  },

  async writeTextFile(location: string, contents: string) {
    return await fs.writeFileSync(location, contents, { encoding: "utf-8" });
  },

  async writePrivateTextFile(location: string, contents: string) {
    fs.writeFileSync(location, contents, { encoding: "utf-8", mode: 0o600 });
    // `mode` only applies when writeFileSync CREATES the file; harden a pre-existing loose file too.
    fs.chmodSync(location, 0o600);
  },

  async isFilePresent(filePath: string) {
    const pipe = getWindowsPipeName(filePath);
    if (pipe) {
      return isNamedPipeServed(pipe);
    }
    return fs.existsSync(filePath);
  },

  async mkdir(location: string, options?: any) {
    fs.mkdirSync(location, options);
    return location;
  },

  async rename(oldPath: string, newPath: string, options?: any) {
    return await fs.renameSync(oldPath, newPath);
  },

  async listDirectory(location: string) {
    return fs
      .readdirSync(location, { withFileTypes: true })
      .map((entry) => ({ name: entry.name, kind: fileSystemEntryKind(entry) }));
  },

  async lstat(location: string) {
    const stat = fs.lstatSync(location);
    return { kind: fileSystemEntryKind(stat), size: stat.size, modifiedMs: stat.mtimeMs };
  },

  async realPath(location: string) {
    return fs.realpathSync.native(location);
  },

  async isPathWithin(root: string, location: string) {
    const canonicalRoot = fs.realpathSync.native(root);
    const canonicalLocation = fs.realpathSync.native(location);
    const relative = path.relative(canonicalRoot, canonicalLocation);
    return (
      relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  },
};

export const Path: IPath = {
  async join(...paths: string[]) {
    return await path.join(...paths);
  },
  async basename(location: string, ext?: string) {
    return await path.basename(location, ext);
  },
  async dirname(location: string) {
    return await path.dirname(location);
  },
  async resolve(...paths: string[]) {
    return await path.resolve(...paths);
  },
};

export const Platform: IPlatform = {
  OPERATING_SYSTEM: os.type() as OperatingSystem,

  async getHomeDir() {
    return await (os.homedir() || process.env?.HOME || "");
  },

  async getEnvironmentVariable(name: string) {
    const value = await Promise.resolve(process.env?.[name]);
    return value;
  },

  async isFlatpak() {
    const osType = os.type() as OperatingSystem;
    if (osType !== OperatingSystem.Linux) {
      return false;
    }
    const FLATPAK_ID = await Platform.getEnvironmentVariable("FLATPAK_ID");
    if (FLATPAK_ID !== undefined) {
      return true;
    }
    try {
      const flag = await fs.existsSync("/.flatpak-info");
      return flag;
    } catch (error: any) {
      logger.error("Unable to detect flatpak-info presence", error);
    }
    return false;
  },

  async getUserDataPath() {
    const explicitUserDataDir = await Platform.getEnvironmentVariable("CONTAINER_DESKTOP_USER_DATA_DIR");
    if (explicitUserDataDir) {
      return path.isAbsolute(explicitUserDataDir)
        ? explicitUserDataDir
        : path.resolve(process.cwd(), explicitUserDataDir);
    }
    const home = await Platform.getHomeDir();
    const appName = import.meta.env.PROJECT_NAME || "container-desktop";
    switch (process.platform) {
      case "win32":
        return await Path.join(home, "AppData/Roaming", appName);
      case "darwin":
        return await Path.join(home, "Library/Application Support", appName);
      default: {
        const XDG_CONFIG_HOME = await Platform.getEnvironmentVariable("XDG_CONFIG_HOME");
        if (XDG_CONFIG_HOME) {
          return await Path.join(XDG_CONFIG_HOME, appName);
        }
        return await Path.join(home, ".config", appName);
      }
    }
  },

  async getOsType(): Promise<OperatingSystem> {
    const osType = await os.type();
    return osType as OperatingSystem;
  },

  async getOsArch(): Promise<string> {
    return os.arch();
  },

  // The test process discovers no SSH hosts: parsing the developer's ~/.ssh/config made results depend on
  // the machine running the suite. A suite that needs hosts builds them as fixtures.
  async getSSHConfig() {
    return [];
  },

  async launchTerminal() {
    throw new Error("launchTerminal is not available in the test host");
  },
};
