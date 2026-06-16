import path from "node:path";
import * as url from "node:url";

import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  nativeTheme,
  type Rectangle,
  screen,
  Tray,
} from "electron";

import { trayPositioner } from "./trayPositioner";

interface TrayControllerLogger {
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export interface TrayControllerOptions {
  buildDir: string;
  logger: TrayControllerLogger;
  isDevelopment: () => boolean;
  isTrayWidgetEnabled: () => Promise<boolean>;
  getTrayIcon: (isDark?: boolean) => string;
  showMainWindow: () => void;
  quitApplication: () => void;
  // Main is the engine authority: the popover's actions are executed here (no renderer in the loop), and
  // the active-gated "live" extras (theme/machines/raw stats) are fetched here while the popover is visible.
  performAction: (request: {
    requestId?: string;
    kind: string;
    id: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  fetchTrayLive: () => Promise<unknown>;
}

export class TrayController {
  private tray: Tray | null = null;
  private popoverWindow: BrowserWindow | null = null;
  private popoverDestroyTimer: ReturnType<typeof setTimeout> | null = null;
  private popoverAnchorBounds: Rectangle | undefined;
  // Timestamp before which "blur" is ignored. show()/focus() can emit a transient blur while the
  // compositor hands over focus (Linux X11/Wayland), which would otherwise hide the popover the
  // instant it appears. reveal() sets this to a short window after showing.
  private suppressBlurUntil = 0;
  private readonly activateGuard = { last: 0 };
  // The active-gated "live" push runs only while the popover is visible — the app never background-polls.
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private liveInFlight = false;

  constructor(private readonly options: TrayControllerOptions) {}

  registerIpc(): void {
    // The popover invokes an action; main executes it against its own engine connection and replies. No
    // renderer round-trip — this is precisely what lets the tray act with the main window closed.
    ipcMain.handle("tray:action", async (event, request) => {
      if (!this.isFromPopover(event)) return { ok: false, error: "unauthorized" };
      if (!request?.kind) return { ok: false, error: "missing action kind" };
      try {
        return await this.options.performAction(request);
      } catch (error: any) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    });

    ipcMain.on("tray:show-app", (event) => {
      if (!this.isFromPopover(event)) return;
      this.hidePopover();
      this.options.showMainWindow();
    });

    ipcMain.on("tray:quit", (event) => {
      if (!this.isFromPopover(event)) return;
      this.options.quitApplication();
    });

    ipcMain.on("tray:resize", (event, size) => {
      if (!this.isFromPopover(event) || !this.popoverWindow || this.popoverWindow.isDestroyed()) return;
      const width = Math.min(420, Math.max(320, Number(size?.width) || 360));
      const height = Math.min(680, Math.max(180, Number(size?.height) || 520));
      const [currentWidth, currentHeight] = this.popoverWindow.getSize();
      if (currentWidth === width && currentHeight === height) return;
      this.popoverWindow.setSize(width, height, false);
      this.positionPopover(this.popoverAnchorBounds);
    });

    if (this.options.isDevelopment()) {
      // Dev convenience (yarn dev:tray / support/tray-cdp.mjs): toggle the popover. Dev-gated; no sender check.
      ipcMain.on("tray:dev-toggle", () => {
        this.togglePopover();
      });
    }
  }

  getIcon(isDark = nativeTheme.shouldUseDarkColors): string {
    return this.options.getTrayIcon(isDark);
  }

  refreshIcon(): void {
    if (!this.tray) {
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
    this.tray.setContextMenu(this.buildMenu());
    this.tray.on("click", () => this.onActivate());
    return this.tray;
  }

  showPopover(anchorBounds?: Rectangle): void {
    this.popoverAnchorBounds = anchorBounds;
    if (this.popoverDestroyTimer) {
      clearTimeout(this.popoverDestroyTimer);
      this.popoverDestroyTimer = null;
    }
    const { win, created } = this.createPopoverWindow();
    const reveal = () => {
      if (!win || win.isDestroyed()) return;
      this.positionPopover(anchorBounds);
      // Guard against the transient focus-acquisition blur on Linux before showing/focusing.
      this.suppressBlurUntil = Date.now() + 250;
      win.show();
      win.focus();
      this.startLive();
    };
    // A newly created window (or one still loading) must wait for ready-to-show; a reused window
    // that already finished loading can reveal immediately. Drop any prior listener so repeated
    // rapid show calls never stack multiple one-shot reveal handlers.
    win.removeAllListeners("ready-to-show");
    if (!created && !win.webContents.isLoading()) {
      reveal();
    } else {
      win.once("ready-to-show", reveal);
    }
  }

  hidePopover(): void {
    if (!this.popoverWindow || this.popoverWindow.isDestroyed()) return;
    this.popoverWindow.hide();
    this.stopLive();
    if (this.popoverDestroyTimer) clearTimeout(this.popoverDestroyTimer);
    this.popoverDestroyTimer = setTimeout(() => {
      this.popoverDestroyTimer = null;
      if (this.popoverWindow && !this.popoverWindow.isDestroyed() && !this.popoverWindow.isVisible()) {
        this.popoverWindow.destroy();
        this.popoverWindow = null;
      }
    }, 8000);
  }

  togglePopover(anchorBounds?: Rectangle): void {
    if (this.popoverWindow && !this.popoverWindow.isDestroyed() && this.popoverWindow.isVisible()) {
      this.hidePopover();
    } else {
      this.showPopover(anchorBounds);
    }
  }

  destroyPopover(): void {
    if (this.popoverDestroyTimer) {
      clearTimeout(this.popoverDestroyTimer);
      this.popoverDestroyTimer = null;
    }
    try {
      if (this.popoverWindow && !this.popoverWindow.isDestroyed()) {
        this.popoverWindow.destroy();
      }
    } catch (error: any) {
      this.options.logger.error("Unable to destroy tray popover", error);
    } finally {
      this.popoverWindow = null;
    }
  }

  destroy(): void {
    this.stopLive();
    this.destroyPopover();
    this.destroySystemTray("destroy");
  }

  private trayPopoverURL(): string {
    const appDevURL = import.meta.env.VITE_DEV_SERVER_URL;
    if (appDevURL) {
      return `${appDevURL}#tray`;
    }
    return url.format({
      pathname: path.join(this.options.buildDir, "index.html"),
      protocol: "file:",
      slashes: true,
      hash: "tray",
    });
  }

  private createPopoverWindow(): { win: BrowserWindow; created: boolean } {
    if (this.popoverWindow && !this.popoverWindow.isDestroyed()) {
      return { win: this.popoverWindow, created: false };
    }
    const preloadURL = path.join(this.options.buildDir, "preload.cjs");
    const win = new BrowserWindow({
      width: 360,
      height: 520,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        devTools: true,
        nodeIntegration: true,
        contextIsolation: true,
        sandbox: false,
        preload: preloadURL,
      },
    });
    win.setMenuBarVisibility(false);
    win.on("blur", () => {
      // Ignore the transient blur emitted while show()/focus() acquires focus (see suppressBlurUntil).
      if (Date.now() < this.suppressBlurUntil) return;
      // If the pointer is still inside the popover when it blurs, the user is interacting with it
      // (e.g. dragging the header via -webkit-app-region: drag) — don't hide. A genuine click-away
      // leaves the pointer outside, so we hide then. Platform-independent (no reliance on move events).
      const cursor = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const pointerInside = cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
      if (pointerInside) {
        return;
      }
      this.hidePopover();
    });
    win.on("closed", () => {
      this.popoverWindow = null;
    });
    win.webContents.on("did-fail-load", (_e, code, desc, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.options.logger.error("Tray popover failed to load", { code, desc, validatedURL });
    });
    this.popoverWindow = win;
    win
      .loadURL(this.trayPopoverURL())
      .catch((error: any) => this.options.logger.error("Unable to load tray popover", error));
    return { win, created: true };
  }

  private positionPopover(anchorBounds?: Rectangle): void {
    if (!this.popoverWindow || this.popoverWindow.isDestroyed()) return;
    try {
      if (anchorBounds) {
        trayPositioner.positionAnchored(this.popoverWindow, anchorBounds);
        return;
      }
      // With no live Electron tray (GNOME-suppressed mode), prefer the last anchor bounds the
      // GNOME bridge set when showing over a zero rectangle that would mis-place the popover.
      if (!this.tray && this.popoverAnchorBounds) {
        trayPositioner.positionAnchored(this.popoverWindow, this.popoverAnchorBounds);
        return;
      }
      const trayBounds = this.tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
      trayPositioner.position(this.popoverWindow, trayBounds);
    } catch (error: any) {
      this.options.logger.error("Unable to position tray popover", error);
    }
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: "Open widget", click: () => this.showPopover() },
      { type: "separator" },
      { label: "Quit", click: () => this.options.quitApplication() },
    ]);
  }

  private onActivate(): void {
    const now = Date.now();
    if (now - this.activateGuard.last < 350) {
      return;
    }
    this.activateGuard.last = now;
    this.togglePopover();
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

  // Public so the resource broker can let the popover PULL the shared snapshot (read-only), the same way
  // the app window does — without granting it the write channels.
  isFromPopover(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return !!this.popoverWindow && !this.popoverWindow.isDestroyed() && event.sender === this.popoverWindow.webContents;
  }

  private sendToPopover(channel: string, payload?: any): void {
    if (this.popoverWindow && !this.popoverWindow.isDestroyed()) {
      this.popoverWindow.webContents.send(channel, payload);
    }
  }

  // Active-gated "live" push: while the popover is visible, fetch the tray-only extras (theme + machines +
  // raw container stats) from main on an interval and push them to the popover; stopped the moment it hides.
  // This is the only repeating tray timer and it exists only while visible — so the app never background-polls.
  private startLive(): void {
    this.pushLive();
    if (this.liveTimer) {
      return;
    }
    this.liveTimer = setInterval(() => this.pushLive(), 2000);
  }

  private stopLive(): void {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
  }

  private pushLive(): void {
    if (this.liveInFlight || !this.popoverWindow || this.popoverWindow.isDestroyed()) {
      return;
    }
    this.liveInFlight = true;
    this.options
      .fetchTrayLive()
      .then((live) => this.sendToPopover("tray:live", live))
      .catch((error) => this.options.logger.error("Unable to fetch tray live data", error))
      .finally(() => {
        this.liveInFlight = false;
      });
  }
}
