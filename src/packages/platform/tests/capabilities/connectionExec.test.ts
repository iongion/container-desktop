import { describe, expect, it } from "vitest";

import { OperatingSystem } from "@/container-client/types/os";
import { createConnectionExecAdapter } from "@/platform/capabilities/connectionExec";
import type { EngineDataService } from "@/platform/engineDataService";

interface Call {
  method: "host" | "scope";
  program: string;
  args: string[];
  scope?: string;
  input?: string;
}

function makeHost(opts: {
  scoped: boolean;
  scope?: string;
  program?: string;
  osType?: OperatingSystem;
  result?: { code: number; success: boolean; stdout?: string; stderr?: string };
}) {
  const calls: Call[] = [];
  const result = opts.result ?? { code: 0, success: true, stdout: "", stderr: "" };
  const host = {
    osType: opts.osType ?? OperatingSystem.Linux,
    isScoped: () => opts.scoped,
    getSettings: async () => ({
      program: { name: opts.program ?? "podman", path: "" },
      controller: opts.scope ? { scope: opts.scope } : undefined,
    }),
    runHostCommand: async (program: string, args: string[], _s: unknown, execOpts?: { input?: string }) => {
      calls.push({ method: "host", program, args, input: execOpts?.input });
      return { pid: 1, ...result };
    },
    runScopeCommand: async (
      program: string,
      args: string[],
      scope: string,
      _s: unknown,
      execOpts?: { input?: string },
    ) => {
      calls.push({ method: "scope", program, args, scope, input: execOpts?.input });
      return { pid: 1, ...result };
    },
  };
  return { host, calls };
}

function makeService(host: unknown, id = "c1"): EngineDataService {
  return { getHost: (cid: string) => (cid === id ? host : undefined) } as unknown as EngineDataService;
}

describe("createConnectionExecAdapter", () => {
  it("execOnConnection uses runHostCommand for a native connection", async () => {
    const { host, calls } = makeHost({ scoped: false });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execOnConnection("c1", "ls", ["-la"]);
    expect(calls).toEqual([{ method: "host", program: "ls", args: ["-la"], input: undefined }]);
  });

  it("execOnConnection uses runScopeCommand (with scope) for a scoped/SSH connection", async () => {
    const { host, calls } = makeHost({ scoped: true, scope: "ssh-conn" });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execOnConnection("c1", "whoami", []);
    expect(calls[0]).toMatchObject({ method: "scope", program: "whoami", args: [], scope: "ssh-conn" });
  });

  it("execOnConnection bridges through WSL on a Windows connection (no POSIX tools + cmd.exe there)", async () => {
    const { host, calls } = makeHost({ scoped: true, scope: "win-remote", osType: OperatingSystem.Windows });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execOnConnection("c1", "stat", ["-c", "%s %Y %F", "/workspace/x"]);
    // A one-time `wsl -e true` pre-flight runs first so an absent WSL fails clearly, THEN the bridged argv.
    expect(calls[0]).toMatchObject({ method: "scope", scope: "win-remote", program: "wsl", args: ["-e", "true"] });
    // The POSIX workspace argv is run via `wsl -e <program> <args…>` on the Windows host, not directly.
    expect(calls[1]).toMatchObject({
      method: "scope",
      scope: "win-remote",
      program: "wsl",
      args: ["-e", "stat", "-c", "%s %Y %F", "/workspace/x"],
    });
  });

  it("execOnConnection probes WSL only ONCE per connection, then reuses the result", async () => {
    const { host, calls } = makeHost({ scoped: true, scope: "win-remote", osType: OperatingSystem.Windows });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execOnConnection("c1", "stat", ["-c", "%F", "/x"]);
    await exec.execOnConnection("c1", "cat", ["/x"]);
    const probes = calls.filter((c) => c.program === "wsl" && c.args[0] === "-e" && c.args[1] === "true");
    expect(probes).toHaveLength(1);
  });

  it("execOnConnection surfaces a clear error when WSL is unavailable on a Windows connection", async () => {
    const { host } = makeHost({
      scoped: true,
      scope: "win-remote",
      osType: OperatingSystem.Windows,
      result: { code: 1, success: false, stdout: "", stderr: "wsl: command not found" },
    });
    const exec = createConnectionExecAdapter(makeService(host));
    await expect(exec.execOnConnection("c1", "stat", ["-c", "%F", "/x"])).rejects.toThrow(/requires WSL/);
  });

  it("non-Windows connections never probe WSL", async () => {
    const { host, calls } = makeHost({ scoped: true, scope: "ssh", osType: OperatingSystem.Linux });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execOnConnection("c1", "stat", ["-c", "%F", "/x"]);
    expect(calls.some((c) => c.program === "wsl")).toBe(false);
  });

  it("execInContainer does NOT WSL-bridge on Windows — the engine CLI (docker.exe) talks to a Linux engine", async () => {
    const { host, calls } = makeHost({
      scoped: true,
      scope: "win-remote",
      program: "docker",
      osType: OperatingSystem.Windows,
    });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execInContainer("c1", "cid", "cat", ["/workspace/x"]);
    expect(calls[0]).toMatchObject({
      method: "scope",
      scope: "win-remote",
      program: "docker",
      args: ["exec", "-i", "cid", "cat", "/workspace/x"],
    });
  });

  it("execInContainer composes `<engine> exec -i <id> <program> <args>` (no -t) and always feeds stdin", async () => {
    const { host, calls } = makeHost({ scoped: false, program: "docker" });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execInContainer("c1", "abc123", "sh", ["-c", "echo hi"]);
    expect(calls[0]).toMatchObject({
      method: "host",
      program: "docker",
      args: ["exec", "-i", "abc123", "sh", "-c", "echo hi"],
      // -i with no caller input must still get a (closed, empty) stdin so it never blocks.
      input: "",
    });
  });

  it("execInContainer passes --workdir when requested (sandbox cwd pinning)", async () => {
    const { host, calls } = makeHost({ scoped: false, program: "podman" });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execInContainer("c1", "cid", "pwd", [], { workdir: "/workspace" });
    expect(calls[0].args).toEqual(["exec", "-i", "--workdir", "/workspace", "cid", "pwd"]);
  });

  it("execInContainer on a remote connection routes through the scope (remote-container)", async () => {
    const { host, calls } = makeHost({ scoped: true, scope: "remote1", program: "podman" });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execInContainer("c1", "cid", "cat", ["/etc/os-release"]);
    expect(calls[0]).toMatchObject({
      method: "scope",
      scope: "remote1",
      program: "podman",
      args: ["exec", "-i", "cid", "cat", "/etc/os-release"],
    });
  });

  it("pipes input on stdin without a shell (the writeFile path)", async () => {
    const { host, calls } = makeHost({ scoped: false, program: "docker" });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.execInContainer("c1", "cid", "tee", ["/workspace/x"], { input: "file body" });
    expect(calls[0].input).toBe("file body");
  });

  it("createSandboxContainer creates a detached labeled container (no --workdir) then mkdir -p /workspace", async () => {
    const { host, calls } = makeHost({
      scoped: false,
      program: "podman",
      result: { code: 0, success: true, stdout: "deadbeefcafe\n" },
    });
    const exec = createConnectionExecAdapter(makeService(host));
    const { containerId } = await exec.createSandboxContainer("c1", "alpine:3", { runId: "r1", label: "l=r1" });
    expect(containerId).toBe("deadbeefcafe");
    // 1) run -d WITHOUT --workdir (a missing workdir aborts container start on podman).
    expect(calls[0].args).toEqual(["run", "-d", "--label", "l=r1", "--entrypoint", "sleep", "alpine:3", "infinity"]);
    // 2) create /workspace by exec (also WITHOUT --workdir, since it does not exist yet).
    expect(calls[1].args).toEqual(["exec", "-i", "deadbeefcafe", "mkdir", "-p", "/workspace"]);
  });

  it("createSandboxContainer throws when the engine returns no id", async () => {
    const { host } = makeHost({
      scoped: false,
      result: { code: 125, success: false, stdout: "", stderr: "no such image" },
    });
    const exec = createConnectionExecAdapter(makeService(host));
    await expect(exec.createSandboxContainer("c1", "bad", { runId: "r1", label: "l" })).rejects.toThrow(/bad/);
  });

  it("removeSandboxContainer runs `rm -f`", async () => {
    const { host, calls } = makeHost({ scoped: false, program: "podman" });
    const exec = createConnectionExecAdapter(makeService(host));
    await exec.removeSandboxContainer("c1", "cid");
    expect(calls[0].args).toEqual(["rm", "-f", "cid"]);
  });

  it("throws a clear error when the connection is not running", async () => {
    const exec = createConnectionExecAdapter(makeService(undefined));
    await expect(exec.execOnConnection("missing", "ls", [])).rejects.toThrow(/not running/);
  });

  it("caps oversized output and flags truncation", async () => {
    const big = "x".repeat(200_000);
    const { host } = makeHost({ scoped: false, result: { code: 0, success: true, stdout: big } });
    const exec = createConnectionExecAdapter(makeService(host));
    const res = await exec.execOnConnection("c1", "cat", ["big"]);
    expect(res.truncated).toBe(true);
    expect(res.stdout.length).toBe(100_000);
  });
});
