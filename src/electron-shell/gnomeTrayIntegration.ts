import path from "node:path";

import { app, type Rectangle } from "electron";

import { OperatingSystem } from "@/env/Types";
import { CURRENT_OS_TYPE } from "@/platform/node";
import {
  createGnomeTrayBridgeServer,
  GNOME_TRAY_EXTENSION_UUID,
  type GnomeTrayBridgeLogger,
  type GnomeTrayBridgeServer,
  getGnomeTrayBridgeSocketPath,
  installGnomeTrayExtension,
  isGnomeShellSession,
  isGnomeTrayExtensionEnabled,
  parseGnomeTrayToggleArg,
  stripGnomeTrayArgs,
  writeGnomeTrayBridgeConfig,
} from "./gnomeTrayBridge";

export interface GnomeTrayIntegrationOptions {
  projectHome: string;
  buildDir: string;
  logger: GnomeTrayBridgeLogger;
  isDevelopment: () => boolean;
  isTrayWidgetEnabled: () => Promise<boolean>;
  getTrayIcon: () => string;
  showPopover: (bounds?: Rectangle) => void;
  togglePopover: (bounds?: Rectangle) => void;
  hidePopover: () => void;
  destroyFallbackTray: (reason: string) => void;
  restoreFallbackTray: (reason: string) => void | Promise<void>;
}

export class GnomeTrayIntegration {
  private bridge: GnomeTrayBridgeServer | null = null;
  private active = false;
  private startHidden = false;
  private pendingShowBounds: Rectangle | null = null;

  constructor(private readonly options: GnomeTrayIntegrationOptions) {
    const startupBounds = parseGnomeTrayToggleArg(process.argv);
    this.startHidden = !!startupBounds;
    this.pendingShowBounds = startupBounds;
  }

  isActive(): boolean {
    return this.active;
  }

  shouldStartHidden(): boolean {
    return this.startHidden;
  }

  consumePendingShowBounds(): Rectangle | null {
    const bounds = this.pendingShowBounds;
    this.pendingShowBounds = null;
    return bounds;
  }

  handleSecondInstance(argv: string[]): boolean {
    const bounds = parseGnomeTrayToggleArg(argv);
    if (!bounds) {
      return false;
    }
    this.startHidden = true;
    this.options.togglePopover(bounds);
    return true;
  }

  async setup(): Promise<void> {
    if (
      CURRENT_OS_TYPE !== OperatingSystem.Linux ||
      !isGnomeShellSession() ||
      !(await this.options.isTrayWidgetEnabled())
    ) {
      return;
    }

    try {
      this.writeLaunchConfig();
    } catch (error: any) {
      this.options.logger.error("Unable to write GNOME tray bridge config", error);
    }

    this.bridge = createGnomeTrayBridgeServer(
      {
        onReady: () => {
          this.active = true;
          this.options.destroyFallbackTray("GNOME extension ready");
        },
        onDisabled: () => {
          this.active = false;
          void this.options.restoreFallbackTray("GNOME extension disabled");
        },
        onDisconnect: () => {
          // If a connected extension drops without sending "disabled", restore
          // the fallback so the user is never left without a tray.
          if (this.active) {
            this.active = false;
            void this.options.restoreFallbackTray("GNOME extension disconnected");
          }
        },
        onToggle: (bounds) => {
          this.startHidden = true;
          this.options.togglePopover(bounds);
        },
        onShow: (bounds) => {
          this.startHidden = true;
          this.options.showPopover(bounds);
        },
        onHide: () => this.options.hidePopover(),
      },
      this.options.logger,
    );

    if (this.options.isDevelopment()) {
      installGnomeTrayExtension(this.getExtensionSourceDir(), this.options.logger);
    }

    // Per the design contract, the fallback tray is suppressed only when the
    // extension actually connects and sends "ready" (handled above) — not from a
    // synchronous CLI probe. An installed/enabled-but-inactive extension is
    // treated as absent. The enabled check stays for logging only.
    if (isGnomeTrayExtensionEnabled(this.options.logger)) {
      this.options.logger.debug("GNOME tray extension is enabled; waiting for socket ready to suppress fallback");
    }
  }

  close(): void {
    this.bridge?.close();
    this.bridge = null;
  }

  private getExtensionSourceDir(): string {
    if (this.options.isDevelopment()) {
      return path.join(this.options.projectHome, "support", "gnome-shell-extension", GNOME_TRAY_EXTENSION_UUID);
    }
    return path.join(this.options.buildDir, "gnome-shell-extension", GNOME_TRAY_EXTENSION_UUID);
  }

  private writeLaunchConfig(): void {
    writeGnomeTrayBridgeConfig({
      socketPath: getGnomeTrayBridgeSocketPath(),
      command: process.execPath,
      args: app.isPackaged ? [] : stripGnomeTrayArgs(process.argv.slice(1)),
      cwd: this.options.projectHome,
      iconPath: this.options.getTrayIcon(),
    });
  }
}
