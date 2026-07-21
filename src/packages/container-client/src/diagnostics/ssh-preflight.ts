import type { CommandExecutionResult } from "@/host-contract/exec";
// Structured SSH pre-flight diagnostic. Instead of a connection that hangs forever (#171) or silently
// fails with no reason (#186), this runs a short, ordered sequence of checks and returns a per-step
// report with an actionable reason for the first thing that's wrong. Every check goes through injected
// primitives (Command/FS/Platform by default), so it is hermetically testable and also live-runnable.

import { OperatingSystem } from "@/container-client/types/os";
import { expandHome } from "@/utils";
import { buildSSHArgs } from "../ssh-args";

export const PREFLIGHT_SENTINEL = "container-desktop-ssh-preflight-ok";

export type SSHPreflightStepId = "ssh-binary" | "key-file" | "key-perms" | "host-reachable" | "remote-engine";

export interface SSHPreflightStep {
  id: SSHPreflightStepId;
  ok: boolean;
  skipped: boolean;
  details: string;
}

export interface SSHPreflightReport {
  ok: boolean;
  steps: SSHPreflightStep[];
}

export interface SSHPreflightTarget {
  hostName: string;
  port: number;
  user: string;
  identityFile?: string;
  configHost?: string;
}

export interface SSHPreflightOptions {
  osType: OperatingSystem;
  // ssh client to invoke (Windows uses the bundled relay exe). Defaults to "ssh".
  sshProgram?: string;
  // When set ("podman"/"docker"), also probe that the remote engine responds.
  engineProgram?: string;
  connectTimeoutSeconds?: number;
}

export interface SSHPreflightDeps {
  execute: (launcher: string, args: string[], opts?: any) => Promise<CommandExecutionResult>;
  isFilePresent: (path: string) => Promise<boolean>;
  getHomeDir: () => Promise<string>;
}

function defaultDeps(): SSHPreflightDeps {
  return {
    execute: (launcher, args, opts) => Command.Execute(launcher, args, opts),
    isFilePresent: (path) => FS.isFilePresent(path),
    getHomeDir: () => Platform.getHomeDir(),
  };
}

function firstLine(text?: string): string {
  return (text || "").split("\n")[0].trim();
}

export async function runSSHPreflight(
  target: SSHPreflightTarget,
  options: SSHPreflightOptions,
  deps: SSHPreflightDeps = defaultDeps(),
): Promise<SSHPreflightReport> {
  const ssh = options.sshProgram || "ssh";
  const isWindows = options.osType === OperatingSystem.Windows;
  const connectTimeoutSeconds = options.connectTimeoutSeconds ?? 15;
  const commandTimeoutMs = (connectTimeoutSeconds + 5) * 1000;
  const homeDir = await deps.getHomeDir();
  const keyPath = target.identityFile ? expandHome(target.identityFile, homeDir) : "";
  const sshParams = {
    host: target.hostName,
    port: target.port,
    username: target.user,
    privateKeyPath: keyPath,
    configHost: target.configHost,
  };

  const steps: SSHPreflightStep[] = [];
  const pass = (id: SSHPreflightStepId, details: string) => steps.push({ id, ok: true, skipped: false, details });
  const fail = (id: SSHPreflightStepId, details: string) => steps.push({ id, ok: false, skipped: false, details });
  const skip = (id: SSHPreflightStepId, details = "Skipped — a prerequisite check failed") =>
    steps.push({ id, ok: false, skipped: true, details });
  const finalize = (): SSHPreflightReport => ({ ok: steps.every((s) => s.skipped || s.ok), steps });
  const skipRest = (ids: SSHPreflightStepId[]) => {
    for (const id of ids) {
      if (id === "remote-engine" && !options.engineProgram) {
        continue;
      }
      skip(id);
    }
  };

  // 1 — ssh client present and runnable
  const version = await deps.execute(ssh, ["-V"], { timeout: 5000 });
  if (!version.success) {
    fail("ssh-binary", `SSH client not found or not runnable: ${ssh}`);
    skipRest(["key-file", "key-perms", "host-reachable", "remote-engine"]);
    return finalize();
  }
  pass("ssh-binary", firstLine(version.stderr) || firstLine(version.stdout) || "ssh present");

  // 2 — optional identity file. No IdentityFile is valid: OpenSSH will use ssh_config defaults,
  //     ssh-agent, and standard identity discovery just like an interactive terminal.
  if (!keyPath) {
    skip("key-file", "No IdentityFile configured; using OpenSSH agent/default identities");
    skip("key-perms", "Skipped; no IdentityFile configured");
  } else {
    if (!(await deps.isFilePresent(keyPath))) {
      fail("key-file", `Identity file not found: ${keyPath}`);
      skipRest(["key-perms", "host-reachable", "remote-engine"]);
      return finalize();
    }
    pass("key-file", `Identity file present: ${keyPath}`);

    // 3 — key permissions (POSIX only; Windows ACLs differ). Group/other bits must be zero or ssh
    //     silently ignores the key.
    if (isWindows) {
      skip("key-perms", "Skipped on Windows");
    } else {
      const stat = await deps.execute("stat", ["-c", "%a", keyPath]);
      const mode = (stat.stdout || "").trim();
      const groupOtherBits = mode.length >= 2 ? mode.slice(-2) : mode;
      if (stat.success && groupOtherBits === "00") {
        pass("key-perms", `Key permissions ${mode}`);
      } else {
        const detail = mode || firstLine(stat.stderr) || "unknown";
        fail("key-perms", `Key permissions too open (${detail}; expected 600 or 400 — ssh will ignore it)`);
        skipRest(["host-reachable", "remote-engine"]);
        return finalize();
      }
    }
  }

  // 4 — host reachable. Bounded by buildSSHArgs (BatchMode + ConnectTimeout + ConnectionAttempts) so
  //     a wrong key / unreachable host fails fast instead of hanging on "Please wait" (#171).
  const probe = await deps.execute(
    ssh,
    buildSSHArgs(sshParams, ["echo", PREFLIGHT_SENTINEL], { connectTimeoutSeconds }),
    { timeout: commandTimeoutMs },
  );
  if (!(probe.success && (probe.stdout || "").includes(PREFLIGHT_SENTINEL))) {
    fail(
      "host-reachable",
      firstLine(probe.stderr) || firstLine(probe.stdout) || "Host unreachable or authentication failed",
    );
    skipRest(["remote-engine"]);
    return finalize();
  }
  pass("host-reachable", `Reachable as ${target.user}@${target.hostName}:${target.port}`);

  // 5 — remote engine usable (optional). Distinguishes "engine not installed/running" from a bad link.
  if (options.engineProgram) {
    const info = await deps.execute(
      ssh,
      buildSSHArgs(sshParams, [options.engineProgram, "info"], { connectTimeoutSeconds }),
      { timeout: commandTimeoutMs },
    );
    if (info.success) {
      pass("remote-engine", `Remote ${options.engineProgram} responded`);
    } else {
      fail(
        "remote-engine",
        firstLine(info.stderr) || `Remote ${options.engineProgram} is not installed or not running`,
      );
    }
  }

  return finalize();
}
