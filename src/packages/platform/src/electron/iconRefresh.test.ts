import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const trayInstances: any[] = [];
  const buildFromTemplate = vi.fn((template) => ({ template }));
  const createImage = () => ({ isEmpty: () => false });
  const Tray = vi.fn(function MockTray(this: any, icon: any) {
    this.icon = icon;
    this.destroy = vi.fn();
    this.isDestroyed = vi.fn(() => false);
    this.on = vi.fn();
    this.popUpContextMenu = vi.fn();
    this.setContextMenu = vi.fn();
    this.setImage = vi.fn();
    this.setToolTip = vi.fn();
    trayInstances.push(this);
  });
  return {
    buildFromTemplate,
    module: {
      app: { dock: { hide: vi.fn(), setIcon: vi.fn(), show: vi.fn() }, quit: vi.fn() },
      BrowserWindow: vi.fn(),
      dialog: {},
      Menu: { buildFromTemplate },
      nativeImage: {
        createFromBuffer: vi.fn(createImage),
        createFromPath: vi.fn(createImage),
      },
      nativeTheme: { shouldUseDarkColors: true },
      shell: { openExternal: vi.fn() },
      Tray,
    },
    trayInstances,
  };
});

vi.mock("electron", () => electronMock.module);

import { TrayController } from "@/platform/electron/trayController";
import { WindowManager, type WindowManagerDeps } from "@/platform/electron/windowManager";
import type { TrayMenuData } from "@/platform/trayMenu";

function makeIconFile(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, name);
  return file;
}

function makeTrayController(getIcon: () => string, getMenuData: () => TrayMenuData = () => ({ connections: [] })) {
  return new TrayController({
    getTrayIcon: getIcon,
    getMenuData,
    logger: { debug: vi.fn(), error: vi.fn() },
    performAction: vi.fn(async () => ({ ok: true })),
    quitApplication: vi.fn(),
    showMainWindow: vi.fn(),
  });
}

function makeWindowManager() {
  const deps = {
    appConfig: {},
    createContextMenu: vi.fn(),
    ensureTray: vi.fn(),
    logger: { debug: vi.fn(), error: vi.fn() },
    onRendererGone: vi.fn(),
    recovery: { showRecoveryDialog: vi.fn() },
    runtime: {},
    urlPolicy: { shouldOpenExternally: vi.fn() },
  } as unknown as WindowManagerDeps;
  return new WindowManager(deps);
}

describe("native shell refresh de-duplication", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "container-desktop-icons-"));
    electronMock.trayInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it("does not reset the tray icon when the resolved icon path is unchanged", () => {
    const first = makeIconFile(tmpDir, "first.png");
    const second = makeIconFile(tmpDir, "second.png");
    let iconPath = first;
    const controller = makeTrayController(() => iconPath);

    controller.createSystemTray();
    const tray = electronMock.trayInstances[0];
    controller.refreshIcon();
    expect(tray.setImage).not.toHaveBeenCalled();

    iconPath = second;
    controller.refreshIcon();
    controller.refreshIcon();
    expect(tray.setImage).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild the tray menu when menu data is unchanged", () => {
    const icon = makeIconFile(tmpDir, "tray.png");
    let menuData: TrayMenuData = { connections: [] };
    const controller = makeTrayController(
      () => icon,
      () => menuData,
    );

    controller.createSystemTray();
    const tray = electronMock.trayInstances[0];
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1);

    controller.refreshMenu();
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1);

    menuData = {
      connections: [
        { containers: [], engine: "podman", id: "c1", machines: [], name: "Local", pods: [], running: false },
      ],
    };
    controller.refreshMenu();
    expect(tray.setContextMenu).toHaveBeenCalledTimes(2);
  });

  it("does not reset the application icon when the icon path is unchanged", () => {
    const first = makeIconFile(tmpDir, "app-first.png");
    const second = makeIconFile(tmpDir, "app-second.png");
    const setIcon = vi.fn();
    const manager = makeWindowManager();
    (manager as any).window = { isDestroyed: () => false, setIcon, webContents: { id: 1, send: vi.fn() } };

    manager.setIcon(first);
    manager.setIcon(first);
    manager.setIcon(second);

    expect(setIcon).toHaveBeenCalledTimes(2);
  });
});
