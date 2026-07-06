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
});
