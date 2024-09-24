// IMPORTANT: Do not include any other concepts than types to avoid circular dependencies issues
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import SSHConfigParser from "ssh-config";

import { CommandExecutionResult, ControllerScopeType, OperatingSystem, SSHHost } from "@/env/Types";

export const Platform: IPlatform = {
  OPERATING_SYSTEM: os.type() as OperatingSystem,

  async getHomeDir() {
    return await (os.homedir() || process.env?.HOME || "");
  },

  async getEnvironmentVariable(name: string) {
    // console.debug("> Reading environment variable", name);
    const value = await Promise.resolve((process.env || {})[name]);
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
          const matchHost = itemConfig.find((c: any) => c.param === "HostName");
          const matchPort = itemConfig.find((c: any) => c.param === "Port");
          const matchUser = itemConfig.find((c: any) => c.param === "User");
          const matchIdentityFile = itemConfig.find((c: any) => c.param === "IdentityFile");
          const port = matchPort?.value ? Number(matchPort?.value) : 22;
          const host: SSHHost = {
            Name: `${item.value}`,
            Host: `${item.value}`,
            Port: Number.isNaN(port) ? 22 : port,
            HostName: `${matchHost.value}`,
            User: `${matchUser.value}`,
            Type: ControllerScopeType.SSHConnection,
            IdentityFile: `${matchIdentityFile?.value || ""}`,
            Connected: false,
            Usable: false
          };
          config.push(host);
        }
      }
    } else {
      console.debug("Config file not found", pathToSSHConfig);
    }
    return config;
  },

  async launchTerminal(commandLauncher: string, params?: string[], opts?: { title: string }) {
    console.debug("Launching terminal", commandLauncher, params);
    const args = [commandLauncher].concat(params || []).join(" ");
    let status: CommandExecutionResult;
    const title = opts?.title || import.meta.env.PROJECT_NAME || "";
    if (os.type() === OperatingSystem.MacOS) {
      status = await Command.Execute("osascript", ["-e", `tell app "Terminal" to do script "${args}"`]);
    } else if (os.type() === OperatingSystem.Windows) {
      status = await Command.Execute("wt", ["-w", "nt", "--title", title, "-p", "Command Prompt", "-d", ".", "cmd", "/k", commandLauncher, ...(params || [])]);
    } else {
      status = await Command.Execute("gnome-terminal", ["--title", title, "-e", args]);
    }
    return status;
  }
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
    console.debug("Creating directory", { location });
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
  }
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
  }
};

export const CURRENT_OS_TYPE = os.type();
