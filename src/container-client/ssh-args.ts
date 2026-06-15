// The native `ssh` argv builder, kept in its own module so both the SSH client (services.ts) and the
// pre-flight diagnostic (diagnostics/ssh-preflight.ts) share it without an import cycle.

export interface SSHClientConnection {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
}

/** Default bound for the SSH control connection — matches the Windows relay `--ssh-timeout`. */
export const SSH_CONNECT_TIMEOUT_SECONDS = 15;

/**
 * Single source of truth for the native `ssh` argv. Centralized so the port is never dropped and the
 * connection is always bounded:
 * - `-p <port>` is always passed (a missing `-p` silently broke non-22 hosts).
 * - `BatchMode=yes` + `ConnectTimeout` + `ConnectionAttempts=1` stop the control connection from
 *   blocking forever on an interactive prompt or an unreachable host (the #171 "Please wait" hang).
 */
export function buildSSHArgs(
  params: SSHClientConnection,
  command: string[],
  opts?: { connectTimeoutSeconds?: number },
): string[] {
  const connectTimeout = opts?.connectTimeoutSeconds ?? SSH_CONNECT_TIMEOUT_SECONDS;
  return [
    "-oStrictHostKeyChecking=accept-new",
    "-oBatchMode=yes",
    `-oConnectTimeout=${connectTimeout}`,
    "-oConnectionAttempts=1",
    "-i",
    params.privateKeyPath,
    "-p",
    `${params.port || 22}`,
    `${params.username}@${params.host}`,
    "--",
    ...command,
  ];
}
