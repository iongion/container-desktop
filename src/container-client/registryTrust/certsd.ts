// Pure builders for installing / removing a custom CA into the engine's certs.d. The native (local) install
// path uses the FS global directly in the orchestration layer; these helpers build the SCOPED-guest commands,
// where the PEM is piped via stdin (never argv) into `cat > …/ca.crt`. `sudo` wraps writes to root-owned guest
// dirs (docker /etc/docker/certs.d) — requires NOPASSWD sudo in the guest (a documented limitation).

import { caCertPath, certsDir, type TrustPathContext } from "./paths";

// Minimal POSIX single-quote escaping so a registry host with a port/odd chars can't break the shell script.
function singleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface CaInstallTarget {
  dir: string;
  file: string;
}

/** The certs.d target (dir + ca.crt file) for a host, or undefined for engines without a certs.d (Apple). */
export function caCertTarget(ctx: TrustPathContext, host: string): CaInstallTarget | undefined {
  const dir = certsDir(ctx, host);
  const file = caCertPath(ctx, host);
  if (!dir || !file) {
    return undefined;
  }
  return { dir, file };
}

export interface ScopedCommand {
  launcher: string;
  args: string[];
}

/** `sh -c "mkdir -p <dir> && cat > <file>"` — the PEM is piped to stdin, so the cert content never hits argv. */
export function buildCaInstallCommand(target: CaInstallTarget, opts?: { sudo?: boolean }): ScopedCommand {
  const script = `mkdir -p ${singleQuote(target.dir)} && cat > ${singleQuote(target.file)}`;
  return opts?.sudo ? { launcher: "sudo", args: ["sh", "-c", script] } : { launcher: "sh", args: ["-c", script] };
}

/** `sh -c "rm -f <file>"` — remove a previously installed CA. */
export function buildCaRemoveCommand(target: CaInstallTarget, opts?: { sudo?: boolean }): ScopedCommand {
  const script = `rm -f ${singleQuote(target.file)}`;
  return opts?.sudo ? { launcher: "sudo", args: ["sh", "-c", script] } : { launcher: "sh", args: ["-c", script] };
}
