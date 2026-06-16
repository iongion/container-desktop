import { Menu, nativeTheme, Tray } from "electron";

import { buildTrayMenuTemplate, type TrayMenuData } from "./trayMenu";

interface TrayControllerLogger {
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export interface TrayControllerOptions {
  logger: TrayControllerLogger;
  getTrayIcon: (isDark?: boolean) => string;
  showMainWindow: () => void;
  quitApplication: () => void;
  // Main is the engine authority: the menu's actions are executed here (no renderer in the loop), so the
  // tray works with the main window closed. `connection.switch` is handled by main (an open window follows).
  performAction: (request: { kind: string; id: string }) => Promise<{ ok: boolean; error?: string }>;
  // Snapshot of main's current data, projected for the menu. Read on every (re)build — see refreshMenu.
  getMenuData: () => TrayMenuData;
}

// Owns the native system-tray icon + its context menu. The menu is built ENTIRELY in main from
// EngineDataService data (no renderer, no extra window) and rebuilt on every data change — re-calling
// setContextMenu is the documented way to update a tray menu and is required on Linux.
export class TrayController {
  private tray: Tray | null = null;
  // show()/popup can fire activation twice in quick succession on some platforms — debounce it.
  private readonly activateGuard = { last: 0 };

  constructor(private readonly options: TrayControllerOptions) {}

  getIcon(isDark = nativeTheme.shouldUseDarkColors): string {
    return this.options.getTrayIcon(isDark);
  }

  refreshIcon(): void {
    if (!this.tray || this.tray.isDestroyed()) {
      return;
    }
    try {
      const trayIconPath = this.getIcon();
      this.options.logger.debug("Set tray icon from", trayIconPath);
      this.tray.setImage(trayIconPath);
    } catch (error: any) {
      this.options.logger.error("Unable to set sys-tray icon", error);
    }
  }

  createSystemTray(): Tray | null {
    if (this.tray) {
      this.options.logger.debug("Creating system tray - skipped - already present");
      return this.tray;
    }
    this.tray = new Tray(this.getIcon());
    this.tray.setToolTip("Container Desktop");
    this.refreshMenu();
    // Left-click pops the menu where the OS emits a click (macOS/Windows). On Linux the
    // StatusNotifierItem already shows the context menu on activation, so this is best-effort there.
    this.tray.on("click", () => this.onActivate());
    return this.tray;
  }

  // Rebuild the context menu from main's current data and re-apply it. Cheap (no engine calls — data is in
  // memory); called on every EngineDataService "change". Native menus snapshot at open, so this is how the
  // next open reflects fresh state.
  refreshMenu(): void {
    if (!this.tray || this.tray.isDestroyed()) {
      return;
    }
    try {
      const template = buildTrayMenuTemplate(this.options.getMenuData(), {
        onAction: (kind, id) =>
          void this.options
            .performAction({ kind, id })
            .catch((error) => this.options.logger.error("Tray action failed", { kind, id, error })),
        onShowApp: () => this.options.showMainWindow(),
        onQuit: () => this.options.quitApplication(),
      });
      this.tray.setContextMenu(Menu.buildFromTemplate(template));
    } catch (error: any) {
      this.options.logger.error("Unable to build tray menu", error);
    }
  }

  destroy(): void {
    this.destroySystemTray("destroy");
  }

  private onActivate(): void {
    const now = Date.now();
    if (now - this.activateGuard.last < 350) {
      return;
    }
    this.activateGuard.last = now;
    this.tray?.popUpContextMenu();
  }

  private destroySystemTray(reason: string): void {
    if (!this.tray) {
      return;
    }
    try {
      this.options.logger.debug("Destroying system tray", { reason });
      this.tray.destroy();
    } catch (error: any) {
      this.options.logger.error("Unable to destroy system tray", error);
    } finally {
      this.tray = null;
    }
  }
}
