import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveLinuxTerminalLaunch, resolveMacTerminalLaunch } from "./host";

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

// Linux-only: the terminal resolution relies on POSIX executable/symlink semantics under a fake
// PATH, which don't reproduce on macOS/Windows runners. Skip off Linux instead of failing there.
describe.skipIf(process.platform !== "linux")("resolveLinuxTerminalLaunch", () => {
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

// Pure string building (no PATH/filesystem lookups), so unlike the Linux suite these run on any OS.
describe("resolveMacTerminalLaunch", () => {
  it("builds an osascript Terminal.app launch for the command and params", () => {
    const launch = resolveMacTerminalLaunch("/usr/bin/docker", ["exec", "-it", "abc123", "/bin/sh"]);

    expect(launch).toEqual({
      launcher: "osascript",
      args: ["-e", 'tell app "Terminal" to do script "/usr/bin/docker exec -it abc123 /bin/sh"'],
    });
  });

  it("handles a bare command with no params", () => {
    const launch = resolveMacTerminalLaunch("podman");

    expect(launch).toEqual({
      launcher: "osascript",
      args: ["-e", 'tell app "Terminal" to do script "podman"'],
    });
  });

  it("escapes double quotes and backslashes so the AppleScript string stays valid", () => {
    const launch = resolveMacTerminalLaunch("podman", ["run", "--name", 'my"box', "C:\\tmp"]);

    expect(launch).toEqual({
      launcher: "osascript",
      args: ["-e", 'tell app "Terminal" to do script "podman run --name my\\"box C:\\\\tmp"'],
    });
  });
});
