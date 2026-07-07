import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const platformDir = join(process.cwd(), "src/platform");

function moduleNames(relativeDir: string): string[] {
  const dir = join(platformDir, relativeDir);
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : [entry.name];
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
        return [];
      }
      return [basename(entry.name, ".ts")];
    })
    .sort();
}

function leftOnly(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((name) => !rightSet.has(name));
}

describe("platform runtime layout", () => {
  it("keeps Electron and Tauri top-level concepts aligned", () => {
    const electron = moduleNames("electron");
    const tauri = moduleNames("tauri");

    expect(leftOnly(electron, tauri)).toEqual(["contextMenu", "main", "preload"]);
    expect(leftOnly(tauri, electron)).toEqual(["inRealmBus", "linkPolicy"]);
  });

  it("keeps command exec modules aligned except for Electron-only data-plane adapters", () => {
    const electron = moduleNames("electron/exec");
    const tauri = moduleNames("tauri/exec");

    expect(leftOnly(electron, tauri)).toEqual(["api-driver", "ssh-stdio-bridge", "wsl-relay"]);
    expect(leftOnly(tauri, electron)).toEqual([]);
  });

  it("keeps AI/security capability modules aligned except for runtime adapters", () => {
    const electron = moduleNames("electron/capabilities");
    const tauri = moduleNames("tauri/capabilities");

    expect(leftOnly(electron, tauri)).toEqual(["credentialsFs"]);
    expect(leftOnly(tauri, electron)).toEqual(["invoke"]);
  });

  // Wails is the second webview backend (a twin of Tauri): its src/platform/wails/ binding mirrors
  // src/platform/tauri/ file-for-file, differing only in the native seam (bridge.ts). So it must be a FULL
  // mirror of Tauri's module set — no module present in one and missing in the other, at every level.
  it("keeps Tauri and Wails top-level concepts fully aligned", () => {
    const tauri = moduleNames("tauri");
    const wails = moduleNames("wails");

    expect(leftOnly(tauri, wails)).toEqual([]);
    expect(leftOnly(wails, tauri)).toEqual([]);
  });

  it("keeps Tauri and Wails command exec modules fully aligned", () => {
    const tauri = moduleNames("tauri/exec");
    const wails = moduleNames("wails/exec");

    expect(leftOnly(tauri, wails)).toEqual([]);
    expect(leftOnly(wails, tauri)).toEqual([]);
  });

  it("keeps Tauri and Wails AI/security capability modules fully aligned", () => {
    const tauri = moduleNames("tauri/capabilities");
    const wails = moduleNames("wails/capabilities");

    expect(leftOnly(tauri, wails)).toEqual([]);
    expect(leftOnly(wails, tauri)).toEqual([]);
  });
});
