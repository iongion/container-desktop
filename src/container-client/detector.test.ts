import { describe, expect, it } from "vitest";
import { type CommandExecutionResult, OperatingSystem } from "@/env/Types";
import { findProgramPath, findProgramVersion } from "./detector";

const ok = (stdout: string, over: Partial<CommandExecutionResult> = {}): CommandExecutionResult => ({
  pid: 1,
  code: 0,
  success: true,
  stdout,
  stderr: "",
  ...over,
});
const fail = (stderr: string): CommandExecutionResult => ({ pid: 1, code: 1, success: false, stdout: "", stderr });

// A remote whose SSH shell is cmd.exe (Windows OpenSSH default): POSIX lookups are "not recognized",
// but `where` (cmd.exe's `which`) resolves the .exe — mirrors what the app runs over the SSH executor.
const cmdExecutor = (calls: { path: string; args: string[] }[]) => async (path: string, args: string[]) => {
  calls.push({ path, args });
  if (path === "which" || path === "whereis") {
    return fail(`'${path}' is not recognized as an internal or external command,`);
  }
  if (path === "where") {
    // `where docker.exe` prints one path per line (Docker Desktop + WinGet shim), CRLF-terminated.
    return ok(
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe\r\n" +
        "C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\docker.exe\r\n",
    );
  }
  if (args[0] === "--version") {
    return ok("Docker version 29.6.1, build 8ec5ab3\r\n");
  }
  return fail("unexpected");
};

// A POSIX remote (Linux VM / macOS over SSH): `which` resolves immediately — the common, must-not-regress case.
const posixExecutor = (calls: { path: string; args: string[] }[]) => async (path: string, args: string[]) => {
  calls.push({ path, args });
  if (path === "which") {
    return ok("/usr/bin/podman\n");
  }
  if (args[0] === "--version") {
    return ok("podman version 5.8.4\n");
  }
  return fail("unexpected");
};

describe("findProgramPath over an SSH executor", () => {
  it("resolves a Windows remote engine via `where` when POSIX lookups fail (cmd.exe shell)", async () => {
    const calls: { path: string; args: string[] }[] = [];
    const path = await findProgramPath("docker", { osType: OperatingSystem.Windows }, cmdExecutor(calls));
    expect(path).toBe("C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe");
    // Windows lookup appends `.exe` and uses `where`, not the local powershell/registry strategy.
    expect(calls.some((c) => c.path === "where" && c.args[0] === "docker.exe")).toBe(true);
  });

  it("still resolves a POSIX remote via `which` (no regression for Linux/macOS SSH remotes)", async () => {
    const calls: { path: string; args: string[] }[] = [];
    const path = await findProgramPath("podman", { osType: OperatingSystem.Linux }, posixExecutor(calls));
    expect(path).toBe("/usr/bin/podman");
    expect(calls[0]).toEqual({ path: "which", args: ["podman"] });
  });
});

describe("findProgramVersion over an SSH executor", () => {
  it("parses the engine version and passes the raw path through (cmd.exe quoting is the transport's job)", async () => {
    const calls: { path: string; args: string[] }[] = [];
    const version = await findProgramVersion(
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
      { osType: OperatingSystem.Windows },
      cmdExecutor(calls),
    );
    expect(version).toBe("29.6.1");
    // Unquoted here on purpose — SSHTransport.quoteScopeProgram applies cmd.exe quoting at the exec boundary.
    expect(calls[0].path).toBe("C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe");
  });
});
