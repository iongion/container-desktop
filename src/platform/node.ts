// IMPORTANT: Do not include any other concepts than types to avoid circular dependencies issues
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import SSHConfigParser from "ssh-config";

import { type CommandExecutionResult, ControllerScopeType, OperatingSystem, type SSHHost } from "@/env/Types";

export const CURRENT_OS_TYPE = os.type();

// Darwin kernel major from os.release() (e.g. "24.3.0" → 24). macOS 15 Sequoia = Darwin 24; macOS 26
// Tahoe = Darwin 25. Used to gate Apple Container networks (full only on macOS 26 / Darwin ≥ 25).
// undefined off Darwin or when the release string can't be parsed.
export const CURRENT_DARWIN_MAJOR: number | undefined =
  os.type() === "Darwin" ? Number.parseInt(`${os.release()}`.split(".")[0], 10) || undefined : undefined;

function configValue(config: any[], param: string): string {
  const value = config.find((item: any) => `${item?.param ?? ""}`.toLowerCase() === param.toLowerCase())?.value;
  return typeof value === "string" ? value.trim() : `${value ?? ""}`.trim();
}

function concreteHostPatterns(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item && item !== "*" && !item.startsWith("!") && !/[?*]/.test(item));
}

export interface TerminalLaunchOptions {
  launcher?: string;
  commandLauncher?: string;
  command?: string;
  args?: string[];
  params?: string[];
  title?: string;
}

export interface LinuxTerminalLaunch {
  launcher: string;
  args: string[];
}

const LINUX_TERMINAL_COMMANDS = [
  "ptyxis",
  "gnome-terminal",
  "kgx",
  "konsole",
  "kitty",
  "alacritty",
  "wezterm",
  "x-terminal-emulator",
  "xterm",
];

function uniqueItems(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function isExecutable(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    fs.accessSync(filePath, fs.constants.X_OK);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function resolveExecutable(command: string, pathEnv = process.env.PATH || ""): string | undefined {
  if (!command) {
    return undefined;
  }
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return isExecutable(command) ? command : undefined;
  }
  for (const dir of pathEnv.split(path.delimiter)) {
    const candidate = path.join(dir, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function realExecutablePath(executable: string): string {
  try {
    return fs.realpathSync.native(executable);
  } catch {
    return executable;
  }
}

function linuxTerminalArgs(terminalName: string, title: string, commandLauncher: string, params: string[]): string[] {
  switch (terminalName) {
    case "ptyxis":
      return ["--new-window", "-T", title, "--", commandLauncher, ...params];
    case "gnome-terminal":
    case "kgx":
      return ["--title", title, "--", commandLauncher, ...params];
    case "konsole":
      return ["--new-tab", "--title", title, "-e", commandLauncher, ...params];
    case "kitty":
      return ["--title", title, commandLauncher, ...params];
    case "alacritty":
      return ["--title", title, "-e", commandLauncher, ...params];
    case "wezterm":
      return ["start", "--", commandLauncher, ...params];
    case "xterm":
      return ["-T", title, "-e", commandLauncher, ...params];
    default:
      return ["-e", commandLauncher, ...params];
  }
}

export function resolveLinuxTerminalLaunch(
  commandLauncher: string,
  params: string[] = [],
  title = "",
  pathEnv = process.env.PATH || "",
  preferredTerminal = process.env.TERMINAL || "",
): LinuxTerminalLaunch | undefined {
  const candidates = uniqueItems([preferredTerminal, ...LINUX_TERMINAL_COMMANDS]);
  for (const command of candidates) {
    const executable = resolveExecutable(command, pathEnv);
    if (!executable) {
      continue;
    }
    const resolvedExecutable = realExecutablePath(executable);
    const terminalName = path.basename(resolvedExecutable);
    return {
      launcher: resolvedExecutable,
      args: linuxTerminalArgs(terminalName, title, commandLauncher, params),
    };
  }
  return undefined;
}

function normalizeTerminalLaunch(
  commandLauncherOrOptions: string | TerminalLaunchOptions,
  params?: string[],
  opts?: { title?: string },
) {
  if (typeof commandLauncherOrOptions === "object") {
    const options = commandLauncherOrOptions;
    return {
      commandLauncher: options.commandLauncher || options.launcher || options.command || "",
      params: options.params || options.args || [],
      title: options.title || import.meta.env.PROJECT_NAME || "",
    };
  }
  return {
    commandLauncher: commandLauncherOrOptions,
    params: params || [],
    title: opts?.title || import.meta.env.PROJECT_NAME || "",
  };
}

export const Platform: IPlatform = {
  OPERATING_SYSTEM: os.type() as OperatingSystem,

  async getHomeDir() {
    return await (os.homedir() || process.env?.HOME || "");
  },

  async getEnvironmentVariable(name: string) {
    // console.debug("> Reading environment variable", name);
    const value = await Promise.resolve(process.env?.[name]);
    // console.debug("< Reading environment variable", name, value);
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
      console.error("Unable to detect flatpak-info presence", error);
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

  async getSSHConfig() {
    const config: SSHHost[] = [];
    const homeDir = await Platform.getHomeDir();
    const pathToSSHConfig = await Path.join(homeDir, ".ssh/config");
    const isPresent = await FS.isFilePresent(pathToSSHConfig);
    if (isPresent) {
      const contents = await FS.readTextFile(pathToSSHConfig);
      const parsed = SSHConfigParser.parse(contents);
      for (const item of parsed) {
        if (item.type === 1 && item.param === "Host" && item.value !== "*") {
          const itemConfig = (item as any).config || [];
          const hostName = configValue(itemConfig, "HostName");
          const port = Number(configValue(itemConfig, "Port") || "22");
          const user = configValue(itemConfig, "User");
          const identityFile = configValue(itemConfig, "IdentityFile");
          for (const alias of concreteHostPatterns(`${item.value}`)) {
            const host: SSHHost = {
              Name: alias,
              Host: alias,
              Port: Number.isNaN(port) ? 22 : port,
              HostName: hostName || alias,
              User: user,
              Type: ControllerScopeType.SSHConnection,
              IdentityFile: identityFile,
              ConfigHost: alias,
              Connected: false,
              Usable: false,
            };
            config.push(host);
          }
        }
      }
    }
    return config;
  },

  async launchTerminal(
    commandLauncherOrOptions: string | TerminalLaunchOptions,
    params?: string[],
    opts?: { title?: string },
  ) {
    const {
      commandLauncher,
      params: commandParams,
      title,
    } = normalizeTerminalLaunch(commandLauncherOrOptions, params, opts);
    const args = [commandLauncher].concat(commandParams || []).join(" ");
    let status: CommandExecutionResult;
    if (os.type() === OperatingSystem.MacOS) {
      status = await Command.Execute("osascript", ["-e", `tell app "Terminal" to do script "${args}"`]);
    } else if (os.type() === OperatingSystem.Windows) {
      status = await Command.Execute("wt", [
        "-w",
        "nt",
        "--title",
        title,
        "-p",
        "Command Prompt",
        "-d",
        ".",
        "cmd",
        "/k",
        commandLauncher,
        ...(commandParams || []),
      ]);
    } else {
      const terminal = resolveLinuxTerminalLaunch(commandLauncher, commandParams, title);
      if (!terminal) {
        return {
          pid: undefined,
          code: -2,
          success: false,
          stdout: "",
          stderr: "No supported terminal emulator found on PATH",
          command: "",
        };
      }
      status = await Command.Execute(terminal.launcher, terminal.args, { detached: true });
    }
    return status;
  },
};

export const FS: IFileSystem = {
  async readTextFile(location: string) {
    return await fs.readFileSync(location, { encoding: "utf-8" }).toString();
  },

  async writeTextFile(location: string, contents: string) {
    return await fs.writeFileSync(location, contents, { encoding: "utf-8" });
  },

  async isFilePresent(filePath: string) {
    return await fs.existsSync(filePath);
  },

  async mkdir(location: string, options?: any) {
    const lastCreated = await fs.mkdirSync(location, options);
    const created = !!lastCreated;
    const exists = await fs.existsSync(location);
    if (!created || !exists) {
      console.error("Directory creation failed", location);
    }
    return location;
  },

  async rename(oldPath: string, newPath: string, options?: any) {
    return await fs.renameSync(oldPath, newPath);
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
