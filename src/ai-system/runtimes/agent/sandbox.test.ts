import { describe, expect, it, vi } from "vitest";

import type { CommandExecutionResult } from "@/env/Types";
import { executeSandboxed, isFloorBlocked } from "./sandbox";

// A fake executor: records how the sandbox invoked it and returns a canned result.
function fakeExec(result: Partial<CommandExecutionResult> = {}) {
  return vi.fn(
    async (_program: string, _args: string[], _opts: any): Promise<CommandExecutionResult> => ({
      pid: 1,
      code: 0,
      success: true,
      stdout: "",
      stderr: "",
      command: "",
      ...result,
    }),
  );
}

describe("executeSandboxed — enforcement", () => {
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/u",
    AWS_SECRET_ACCESS_KEY: "AKIA-super-secret",
    GITHUB_TOKEN: "ghp_shouldnotleak",
    LANG: "en_US.UTF-8",
  };

  it("NEVER executes a floor-blocked command (it must not reach the executor)", async () => {
    const exec = fakeExec();
    const res = await executeSandboxed({ program: "rm", args: ["-rf", "/"] }, { exec, baseEnv });
    expect(exec).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.tier).toBe("blocked");
    expect(res.rejectedReason).toBeTruthy();
  });

  it("runs a floor-blocked command when enforceFloor is false (always-allow mode)", async () => {
    const exec = fakeExec({ stdout: "done\n" });
    const res = await executeSandboxed(
      { program: "sudo", args: ["systemctl", "restart", "x"] },
      { exec, baseEnv, enforceFloor: false },
    );
    expect(exec).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.tier).toBe("ran");
  });

  it("runs a SAFE command with a fixed cwd, hard timeout, NO shell, and a SCRUBBED env (no inherited secrets)", async () => {
    const exec = fakeExec({ stdout: "CONTAINER ID\n" });
    const res = await executeSandboxed({ program: "podman", args: ["ps", "-a"] }, { exec, baseEnv, cwd: "/sandbox" });
    expect(res.ok).toBe(true);
    expect(res.tier).toBe("ran");
    expect(exec).toHaveBeenCalledTimes(1);
    const [program, args, opts] = exec.mock.calls[0];
    expect(program).toBe("podman");
    expect(args).toEqual(["ps", "-a"]);
    expect(opts.cwd).toBe("/sandbox");
    expect(opts.timeout).toBeGreaterThan(0);
    // The env handed to the child is an allowlist — inherited secrets are gone, PATH/HOME survive.
    expect(opts.env.PATH).toBe("/usr/bin:/bin");
    expect(opts.env.HOME).toBe("/home/u");
    expect(opts.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(opts.env.GITHUB_TOKEN).toBeUndefined();
    // The model can NEVER smuggle a shell or process options through the sandbox.
    expect(opts.shell).toBeFalsy();
    expect(opts.detached).toBeFalsy();
    expect(opts.wrapper).toBeUndefined();
  });

  it("runs an APPROVE command once invoked (the approval gate lives upstream, in the agent loop)", async () => {
    const exec = fakeExec({ stdout: "web\n" });
    const res = await executeSandboxed({ program: "podman", args: ["stop", "web"] }, { exec, baseEnv });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(res.tier).toBe("ran");
    expect(res.ok).toBe(true);
  });

  it("caps oversized output and flags truncation", async () => {
    const huge = "x".repeat(500_000);
    const exec = fakeExec({ stdout: huge });
    const res = await executeSandboxed(
      { program: "podman", args: ["logs", "web"] },
      { exec, baseEnv, maxOutputBytes: 1000 },
    );
    expect(res.truncated).toBe(true);
    expect(res.stdout.length).toBeLessThan(huge.length);
    expect(res.stdout.length).toBeLessThanOrEqual(1000 + 64); // cap + a short truncation marker
  });

  it("redacts secrets in tool output before it can re-enter the model", async () => {
    const exec = fakeExec({
      stdout: "key=sk-ant-abc123456789 and Authorization: Bearer abcdef123456",
      stderr: "token ghp_aaaaaaaaaaaaaaaaaaaaaa",
    });
    const res = await executeSandboxed({ program: "podman", args: ["inspect", "web"] }, { exec, baseEnv });
    expect(res.stdout).toContain("[REDACTED]");
    expect(res.stdout).not.toContain("sk-ant-abc123456789");
    expect(res.stderr).not.toContain("ghp_aaaaaaaaaaaaaaaaaaaaaa");
  });
});

describe("isFloorBlocked — the catastrophic floor (ask + remember)", () => {
  it("blocks denylisted destructive/privilege/shell/network programs", () => {
    for (const program of ["rm", "sudo", "bash", "ssh", "curl", "dd", "mkfs.ext4", "chmod"]) {
      expect(isFloorBlocked({ program, args: [] }).blocked).toBe(true);
    }
  });

  it("blocks shell metacharacters, invalid program tokens, and `..` traversal", () => {
    expect(isFloorBlocked({ program: "podman", args: ["ps", "$(rm -rf /)"] }).blocked).toBe(true);
    expect(isFloorBlocked({ program: "podman", args: ["logs", "a|b"] }).blocked).toBe(true);
    expect(isFloorBlocked({ program: "/usr/bin/rm", args: [] }).blocked).toBe(true);
    expect(isFloorBlocked({ program: "", args: [] }).blocked).toBe(true);
    expect(isFloorBlocked({ program: "cat", args: ["/var/log/../../etc/shadow"] }).blocked).toBe(true);
  });

  it("does NOT block ordinary commands — including arbitrary reads (now user-gated, not hard-blocked)", () => {
    expect(isFloorBlocked({ program: "podman", args: ["stop", "web"] }).blocked).toBe(false);
    expect(isFloorBlocked({ program: "docker", args: ["run", "--rm", "alpine"] }).blocked).toBe(false);
    expect(isFloorBlocked({ program: "cat", args: ["/etc/shadow"] }).blocked).toBe(false);
    expect(isFloorBlocked({ program: "grep", args: ["-r", "secret", "."] }).blocked).toBe(false);
  });
});
