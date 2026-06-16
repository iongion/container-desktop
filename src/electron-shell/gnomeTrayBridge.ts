import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { Rectangle } from "electron";

export const GNOME_TRAY_EXTENSION_UUID = "container-desktop-tray@iongion.github.io";
export const GNOME_TRAY_TOGGLE_ARG = "--container-desktop-gnome-tray-toggle";

// The bridge only ever exchanges tiny JSON lines with the GNOME extension. Cap
// the per-connection read buffer so a misbehaving/unauthorized peer cannot grow
// main-process memory by never sending a newline, and drop idle sockets.
const GNOME_TRAY_MAX_LINE_BYTES = 64 * 1024;
const GNOME_TRAY_SOCKET_IDLE_MS = 60_000;

export interface GnomeTrayBridgeMessage {
  type: "ready" | "disabled" | "toggle" | "show" | "hide";
  bounds?: Partial<Rectangle>;
}

export interface GnomeTrayBridgeConfig {
  socketPath: string;
  command: string;
  args: string[];
  cwd?: string;
  iconPath?: string;
}

export interface GnomeTrayBridgeLogger {
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export interface GnomeTrayBridgeHandlers {
  onReady: () => void;
  onDisabled: () => void;
  onToggle: (bounds?: Rectangle) => void;
  onShow: (bounds?: Rectangle) => void;
  onHide: () => void;
  onDisconnect?: () => void;
}

export interface GnomeTrayBridgeServer {
  socketPath: string;
  close: () => void;
}

function runtimeDir(): string {
  return process.env.XDG_RUNTIME_DIR || os.tmpdir();
}

function configDir(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

export function getGnomeTrayBridgeSocketPath(): string {
  return path.join(runtimeDir(), "container-desktop", "gnome-tray-bridge.sock");
}

export function getGnomeTrayBridgeConfigPath(): string {
  return path.join(configDir(), "container-desktop", "gnome-tray-bridge.json");
}

export function isGnomeShellSession(): boolean {
  const desktop = `${process.env.XDG_CURRENT_DESKTOP || ""}:${process.env.DESKTOP_SESSION || ""}`.toLowerCase();
  return desktop.includes("gnome");
}

export function parseGnomeTrayToggleArg(argv: string[]): Rectangle | null {
  const index = argv.indexOf(GNOME_TRAY_TOGGLE_ARG);
  if (index < 0) {
    return null;
  }
  const values = argv.slice(index + 1, index + 5).map((value) => Number(value));
  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [x, y, width, height] = values;
  return { x, y, width, height };
}

export function stripGnomeTrayArgs(argv: string[]): string[] {
  const index = argv.indexOf(GNOME_TRAY_TOGGLE_ARG);
  if (index < 0) {
    return argv;
  }
  return [...argv.slice(0, index), ...argv.slice(index + 5)];
}

export function normalizeBounds(bounds: Partial<Rectangle> | undefined): Rectangle | undefined {
  if (!bounds) {
    return undefined;
  }
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  // A zero/negative-size actor rectangle cannot anchor the popover; treat it as
  // absent so callers fall back to the cursor/tray positioner path.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

export function isGnomeTrayExtensionEnabled(logger: GnomeTrayBridgeLogger): boolean {
  if (!isGnomeShellSession()) {
    return false;
  }
  try {
    const output = execFileSync("gnome-extensions", ["list", "--enabled"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes(GNOME_TRAY_EXTENSION_UUID);
  } catch (error: any) {
    logger.debug("Unable to query GNOME extensions", error?.message || error);
    return false;
  }
}

export function isGnomeTrayExtensionActive(logger: GnomeTrayBridgeLogger): boolean {
  if (!isGnomeShellSession()) {
    return false;
  }
  try {
    const output = execFileSync("gnome-extensions", ["info", GNOME_TRAY_EXTENSION_UUID], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    });
    return /^\s*State:\s+ACTIVE\s*$/m.test(output);
  } catch (error: any) {
    logger.debug("Unable to query GNOME tray extension state", error?.message || error);
    return false;
  }
}

export function writeGnomeTrayBridgeConfig(config: GnomeTrayBridgeConfig): void {
  const file = getGnomeTrayBridgeConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function installGnomeTrayExtension(sourceDir: string, logger: GnomeTrayBridgeLogger): boolean {
  if (!isGnomeShellSession() || !fs.existsSync(sourceDir)) {
    return false;
  }
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-desktop-gnome-tray-"));
  try {
    const packOutput = execFileSync("gnome-extensions", ["pack", "-f", "-o", bundleDir, sourceDir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
    });
    const reportedBundle = packOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.endsWith(".shell-extension.zip") && fs.existsSync(line));
    const bundle =
      reportedBundle ??
      fs
        .readdirSync(bundleDir)
        .filter((entry) => entry.endsWith(".shell-extension.zip"))
        .map((entry) => path.join(bundleDir, entry))[0];
    if (!bundle) {
      throw new Error(`gnome-extensions pack did not create an extension bundle in ${bundleDir}`);
    }
    execFileSync("gnome-extensions", ["install", "-f", bundle], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 3000,
    });
    try {
      execFileSync("gnome-extensions", ["enable", GNOME_TRAY_EXTENSION_UUID], {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 2000,
      });
      logger.debug("Installed and enabled GNOME tray extension", { sourceDir, bundle });
      return true;
    } catch (error: any) {
      logger.debug("Installed GNOME tray extension, but GNOME Shell did not enable it in the current session", {
        sourceDir,
        bundle,
        error: error?.message || error,
      });
      return false;
    }
  } catch (error: any) {
    logger.error("Unable to install GNOME tray extension", error?.message || error);
    return false;
  } finally {
    try {
      fs.rmSync(bundleDir, { recursive: true, force: true });
    } catch {
      // Temporary bundle cleanup is best-effort.
    }
  }
}

export function createGnomeTrayBridgeServer(
  handlers: GnomeTrayBridgeHandlers,
  logger: GnomeTrayBridgeLogger,
): GnomeTrayBridgeServer | null {
  if (process.platform !== "linux" || !isGnomeShellSession()) {
    return null;
  }

  const socketPath = getGnomeTrayBridgeSocketPath();
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  try {
    fs.rmSync(socketPath, { force: true });
  } catch {
    // Ignore stale-socket cleanup failures; listen() below will surface real errors.
  }

  const sockets = new Set<net.Socket>();
  let closing = false;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.setTimeout(GNOME_TRAY_SOCKET_IDLE_MS, () => {
      logger.debug("GNOME tray bridge socket idle timeout; closing");
      socket.destroy();
    });
    // An abrupt peer disconnect (EPIPE/ECONNRESET) emits 'error'; without a
    // handler Node would rethrow it and crash the main process.
    socket.on("error", (error: any) => logger.debug("GNOME tray bridge socket error", error?.message || error));
    socket.on("close", () => {
      sockets.delete(socket);
      // Don't report a disconnect when we are tearing the server down ourselves;
      // that only happens for a real peer drop while the bridge is still live.
      if (!closing) {
        handlers.onDisconnect?.();
      }
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      // Cap the unparsed buffer so a peer that never sends a newline cannot grow
      // main-process memory without bound.
      if (buffer.length > GNOME_TRAY_MAX_LINE_BYTES) {
        logger.error("GNOME tray bridge message exceeded buffer cap; closing socket");
        buffer = "";
        socket.destroy();
        return;
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const message = JSON.parse(trimmed) as GnomeTrayBridgeMessage;
          const bounds = normalizeBounds(message.bounds);
          switch (message.type) {
            case "ready":
              handlers.onReady();
              break;
            case "disabled":
              handlers.onDisabled();
              break;
            case "toggle":
              handlers.onToggle(bounds);
              break;
            case "show":
              handlers.onShow(bounds);
              break;
            case "hide":
              handlers.onHide();
              break;
          }
          socket.write('{"ok":true}\n');
        } catch (error: any) {
          logger.error("Invalid GNOME tray bridge message", error?.message || error);
          socket.write(`${JSON.stringify({ ok: false, error: "invalid-message" })}\n`);
        }
      }
    });
  });

  // Only the single GNOME extension should ever connect.
  server.maxConnections = 1;

  server.on("error", (error) => logger.error("GNOME tray bridge server error", error));
  // Create the socket file private from the start (the listen callback runs only
  // after the socket is already accepting), then restore the previous umask.
  const previousUmask = process.umask(0o077);
  server.listen(socketPath, () => {
    process.umask(previousUmask);
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {
      // Best-effort; the parent runtime directory is already user-private on normal systems.
    }
    logger.debug("GNOME tray bridge listening", { socketPath });
  });

  return {
    socketPath,
    close: () => {
      closing = true;
      // server.close() only stops accepting; destroy live sockets so quit is clean.
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      server.close();
      try {
        fs.rmSync(socketPath, { force: true });
      } catch {
        // Best-effort cleanup.
      }
    },
  };
}
