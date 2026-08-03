import { describe, expect, it } from "vitest";
import {
  findProgramPath,
  findProgramVersion,
  parseCosignVersion,
  parseProgramVersion,
} from "@/container-client/detector";
import { OperatingSystem } from "@/container-client/types/os";
import type { CommandExecutionResult } from "@/host-contract/exec";

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

describe("parseProgramVersion", () => {
  it("reads the token after the word `version`, not a fixed position", () => {
    // Read off a real Mac: `container --version` prints this. The extra word before `version` makes
    // the positional third-token rule return the word "version" itself, which is then published as
    // the connection's engine version.
    expect(parseProgramVersion("container CLI version 1.1.0 (build: release, commit: unspeci)")).toBe("1.1.0");
  });

  it("still reads podman and docker, whose banners have no extra word", () => {
    expect(parseProgramVersion("podman version 5.2.2")).toBe("5.2.2");
    expect(parseProgramVersion("Docker version 29.6.2, build dfc4efb1e2")).toBe("29.6.2");
  });

  it("names no version when the banner ends on the word, rather than falling back to the bug", () => {
    // A truncated banner. The positional third token of `container CLI version` IS the word `version`,
    // so falling through to it re-creates the very defect the word rule removed.
    expect(parseProgramVersion("container CLI version")).toBeUndefined();
    expect(parseProgramVersion("podman version")).toBeUndefined();
  });

  it("keeps the positional third token for a banner that never says `version`", () => {
    expect(parseProgramVersion("Apptainer runtime 1.3.4")).toBe("1.3.4");
  });

  it("has nothing to say about output that names no version", () => {
    expect(parseProgramVersion("")).toBeUndefined();
    expect(parseProgramVersion("two words")).toBeUndefined();
  });
});

describe("parseCosignVersion", () => {
  const banner = (git: string) =>
    `\n  ______   ______\n /      | /  __  \\\ncosign: A tool for Container Signing...\n\nGitVersion:    ${git}\nGitCommit:     unknown\nGoVersion:     go1.25.0\nPlatform:      linux/amd64\n`;

  it("extracts GitVersion (never the GoVersion line below it)", () => {
    expect(parseCosignVersion(banner("v2.4.1"))).toBe("v2.4.1");
  });

  it("returns the source-build marker verbatim", () => {
    expect(parseCosignVersion(banner("devel"))).toBe("devel");
  });

  it("is empty when there is no GitVersion line", () => {
    expect(parseCosignVersion("cosign: A tool\nGoVersion: go1.25.0")).toBe("");
    expect(parseCosignVersion(undefined)).toBe("");
  });
});

describe("findProgramVersion for cosign", () => {
  it("uses the `version` subcommand (never --version) and reads GitVersion", async () => {
    const calls: { path: string; args: string[] }[] = [];
    const exec = async (path: string, args: string[]) => {
      calls.push({ path, args });
      return args[0] === "version"
        ? ok("GitVersion:    v2.4.1\nGoVersion:     go1.25.0\n")
        : fail("Error: unknown flag: --version");
    };
    const version = await findProgramVersion("/usr/bin/cosign", { osType: OperatingSystem.Linux }, exec);
    expect(version).toBe("v2.4.1");
    expect(calls[0]).toEqual({ path: "/usr/bin/cosign", args: ["version"] });
  });
});
