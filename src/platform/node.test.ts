import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveLinuxTerminalLaunch } from "./node";

const tempDirs: string[] = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "container-desktop-terminal-"));
  tempDirs.push(dir);
  return dir;
}

function createExecutable(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "#!/bin/sh\n");
  fs.chmodSync(filePath, 0o755);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("resolveLinuxTerminalLaunch", () => {
  it("uses the resolved target args for x-terminal-emulator alternatives", () => {
    const root = createTempDir();
    const binDir = path.join(root, "bin");
    const realDir = path.join(root, "real");
    const ptyxis = path.join(realDir, "ptyxis");
    const terminalAlternative = path.join(binDir, "x-terminal-emulator");
    createExecutable(ptyxis);
    fs.mkdirSync(binDir, { recursive: true });
    fs.symlinkSync(ptyxis, terminalAlternative);

    const launch = resolveLinuxTerminalLaunch(
      "/usr/bin/docker",
      ["exec", "-it", "abc123", "/bin/sh"],
      "Container shell",
      binDir,
      "",
    );

    expect(launch).toEqual({
      launcher: ptyxis,
      args: ["--new-window", "-T", "Container shell", "--", "/usr/bin/docker", "exec", "-it", "abc123", "/bin/sh"],
    });
  });

  it("prefers the configured terminal when it is executable", () => {
    const root = createTempDir();
    const binDir = path.join(root, "bin");
    const kitty = path.join(binDir, "kitty");
    const ptyxis = path.join(binDir, "ptyxis");
    createExecutable(kitty);
    createExecutable(ptyxis);

    const launch = resolveLinuxTerminalLaunch("podman", ["machine", "ssh", "dev"], "Machine", binDir, "kitty");

    expect(launch).toEqual({
      launcher: kitty,
      args: ["--title", "Machine", "podman", "machine", "ssh", "dev"],
    });
  });

  it("returns undefined when no supported terminal exists", () => {
    const root = createTempDir();
    const binDir = path.join(root, "bin");
    fs.mkdirSync(binDir, { recursive: true });

    expect(resolveLinuxTerminalLaunch("docker", ["ps"], "Containers", binDir, "")).toBeUndefined();
  });
});
