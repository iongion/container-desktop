import { describe, expect, it } from "vitest";
import { OperatingSystem } from "@/container-client/types/os";
import type { CommandExecutionResult } from "@/host-contract/exec";
import {
  PREFLIGHT_SENTINEL,
  runSSHPreflight,
  type SSHPreflightDeps,
  type SSHPreflightReport,
  type SSHPreflightStepId,
} from "./ssh-preflight";

const target = { hostName: "10.0.0.5", port: 22, user: "ion", identityFile: "~/.ssh/id_ed25519" };
const options = { osType: OperatingSystem.Linux, engineProgram: "podman" };

type ExecHandler = (launcher: string, args: string[]) => Partial<CommandExecutionResult>;

function deps(opts: { exec?: ExecHandler; keyPresent?: boolean } = {}): SSHPreflightDeps {
  return {
    execute: async (launcher: string, args: string[]) => ({
      pid: 1,
      code: 0,
      success: true,
      stdout: "",
      stderr: "",
      ...opts.exec?.(launcher, args),
    }),
    isFilePresent: async () => opts.keyPresent ?? true,
    getHomeDir: async () => "/home/ion",
  };
}

// Happy-path router: ssh present, key 0600, host answers the sentinel, engine running.
const allGood: ExecHandler = (launcher, args) => {
  if (args.includes("-V")) {
    return { success: true, stderr: "OpenSSH_9.6p1" };
  }
  if (launcher === "stat") {
    return { success: true, stdout: "600\n" };
  }
  if (args.includes(PREFLIGHT_SENTINEL)) {
    return { success: true, stdout: `${PREFLIGHT_SENTINEL}\n` };
  }
  if (args.includes("info")) {
    return { success: true, stdout: "podman ok" };
  }
  return { success: true };
};

function stepIds(report: SSHPreflightReport) {
  return report.steps.map((s) => s.id);
}
function step(report: SSHPreflightReport, id: SSHPreflightStepId) {
  return report.steps.find((s) => s.id === id);
}

describe("runSSHPreflight", () => {
  it("passes every step when ssh, key, perms, host and remote engine are all good", async () => {
    const report = await runSSHPreflight(target, options, deps({ exec: allGood }));
    expect(report.ok).toBe(true);
    expect(stepIds(report)).toEqual(["ssh-binary", "key-file", "key-perms", "host-reachable", "remote-engine"]);
    expect(report.steps.every((s) => s.ok)).toBe(true);
  });

  it("the host-reachable probe is bounded (BatchMode + ConnectTimeout) so it cannot hang (#171)", async () => {
    const seen: string[][] = [];
    await runSSHPreflight(
      target,
      options,
      deps({
        exec: (l, a) => {
          seen.push(a);
          return allGood(l, a);
        },
      }),
    );
    const probe = seen.find((a) => a.includes(PREFLIGHT_SENTINEL))!;
    expect(probe).toContain("-oBatchMode=yes");
    expect(probe).toContain("-oConnectTimeout=15");
    expect(probe).toContain("-oConnectionAttempts=1");
    // and it must carry the explicit port
    expect(probe).toContain("-p");
  });

  it("reports a missing ssh client and skips everything after it", async () => {
    const report = await runSSHPreflight(
      target,
      options,
      deps({ exec: (l, a) => (a.includes("-V") ? { success: false } : allGood(l, a)) }),
    );
    expect(report.ok).toBe(false);
    expect(step(report, "ssh-binary")?.ok).toBe(false);
    expect(step(report, "host-reachable")?.skipped).toBe(true);
    expect(step(report, "remote-engine")?.skipped).toBe(true);
  });

  it("reports a missing identity file", async () => {
    const report = await runSSHPreflight(target, options, deps({ exec: allGood, keyPresent: false }));
    expect(report.ok).toBe(false);
    expect(step(report, "key-file")?.ok).toBe(false);
    expect(step(report, "key-file")?.details).toContain("/home/ion/.ssh/id_ed25519");
    expect(step(report, "key-perms")?.skipped).toBe(true);
  });

  it("does not require IdentityFile and lets OpenSSH use agent/default identities", async () => {
    const seen: string[][] = [];
    let keyFileChecked = false;
    const report = await runSSHPreflight({ ...target, identityFile: "" }, options, {
      execute: async (launcher: string, args: string[]) => {
        seen.push(args);
        return {
          pid: 1,
          code: 0,
          success: true,
          stdout: "",
          stderr: "",
          ...allGood(launcher, args),
        };
      },
      isFilePresent: async () => {
        keyFileChecked = true;
        return true;
      },
      getHomeDir: async () => "/home/ion",
    });

    const probe = seen.find((a) => a.includes(PREFLIGHT_SENTINEL))!;
    expect(report.ok).toBe(true);
    expect(step(report, "key-file")?.skipped).toBe(true);
    expect(step(report, "key-perms")?.skipped).toBe(true);
    expect(step(report, "host-reachable")?.ok).toBe(true);
    expect(probe).not.toContain("-i");
    expect(keyFileChecked).toBe(false);
  });

  it("uses the SSH config host alias for the reachability probe when available", async () => {
    const seen: string[][] = [];
    const report = await runSSHPreflight(
      { ...target, configHost: "MacOS" },
      options,
      deps({
        exec: (launcher, args) => {
          seen.push(args);
          return allGood(launcher, args);
        },
      }),
    );

    const probe = seen.find((a) => a.includes(PREFLIGHT_SENTINEL))!;
    expect(report.ok).toBe(true);
    expect(probe).toContain("MacOS");
    expect(probe).not.toContain("-p");
    expect(probe).not.toContain("-i");
  });

  it("flags world/group-readable key permissions as too open", async () => {
    const report = await runSSHPreflight(
      target,
      options,
      deps({ exec: (l, a) => (l === "stat" ? { success: true, stdout: "644" } : allGood(l, a)) }),
    );
    expect(step(report, "key-perms")?.ok).toBe(false);
    expect(step(report, "key-perms")?.details).toContain("644");
    expect(step(report, "host-reachable")?.skipped).toBe(true);
  });

  it("skips the key-perms check on Windows", async () => {
    const report = await runSSHPreflight(
      target,
      { ...options, osType: OperatingSystem.Windows },
      deps({ exec: allGood }),
    );
    expect(step(report, "key-perms")?.skipped).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("surfaces an unreachable host with the ssh stderr and skips the remote engine check", async () => {
    const report = await runSSHPreflight(
      target,
      options,
      deps({
        exec: (l, a) =>
          a.includes(PREFLIGHT_SENTINEL)
            ? { success: false, stderr: "ssh: connect to host 10.0.0.5 port 22: Connection timed out" }
            : allGood(l, a),
      }),
    );
    expect(report.ok).toBe(false);
    expect(step(report, "host-reachable")?.ok).toBe(false);
    expect(step(report, "host-reachable")?.details).toContain("Connection timed out");
    expect(step(report, "remote-engine")?.skipped).toBe(true);
  });

  it("reports when the remote engine is not running", async () => {
    const report = await runSSHPreflight(
      target,
      options,
      deps({
        exec: (l, a) => (a.includes("info") ? { success: false, stderr: "podman: command not found" } : allGood(l, a)),
      }),
    );
    expect(report.ok).toBe(false);
    expect(step(report, "remote-engine")?.ok).toBe(false);
  });

  it("omits the remote-engine step when no engine program is given", async () => {
    const report = await runSSHPreflight(target, { osType: OperatingSystem.Linux }, deps({ exec: allGood }));
    expect(stepIds(report)).not.toContain("remote-engine");
    expect(report.ok).toBe(true);
  });
});
