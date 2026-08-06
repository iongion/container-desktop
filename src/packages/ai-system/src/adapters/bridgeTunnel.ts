// Reaching a pi-agent pair whose bridge is published on ANOTHER machine.
//
// The pair publishes its bridge on `127.0.0.1:<port>` of the machine running the engine, and the app dials
// `127.0.0.1` of its own — so on a remote (SSH) connection those are two different machines and the app reaches
// nothing at all. A local forward makes that port answer here, which is what lets an assistant session exist on an
// SSH connection in the first place.
//
// Deliberately NOT the engine's data plane: that one is the native proxy, request-shaped, and a bridge is a WebSocket
// upgrade over a long-lived socket. This is a plain `ssh -NL` child process, spawned through the same exec seam every
// other engine command uses, and killed with the session.

import { buildSSHTunnelArgs, type SSHClientConnection } from "@/container-client/ssh-args";
import { createLogger } from "@/logger";

const logger = createLogger("ai.bridgeTunnel");

// The little of a spawned process this needs. Kept local so the adapter does not reach for the platform contract:
// the caller passes whatever its shell's streaming exec returned.
export interface TunnelProcess {
  // No signal is ever passed: the default terminates `ssh -N`, and asking for less than the shells' own handles
  // require would make this port unassignable from either of them.
  kill: () => void;
  // Only "exit" is listened for, and named exactly that: a wider event type here would not accept the shells' own
  // stream handles, whose `on` is keyed to their four events.
  on?: (event: "exit", listener: (payload: unknown) => void) => void;
}

export interface BridgeTunnel {
  // The port on THIS machine that now answers for the pair's bridge.
  localPort: number;
  stop: () => void;
}

export interface BridgeTunnelDeps {
  spawn: (launcher: string, args: string[]) => Promise<TunnelProcess>;
  localPort: number;
  // Windows ships OpenSSH as `ssh.exe`; everywhere else it is `ssh`. The caller knows its own OS.
  launcher?: string;
}

export interface BridgeTunnelSpec {
  credentials: SSHClientConnection;
  // The port the pair published on the remote's loopback.
  remotePort: number;
  // Called when the forward dies under a live session. Every frame after that goes nowhere, so the caller reports the
  // session as lost rather than leaving a transcript that has silently stopped receiving.
  onLost?: (reason: string) => void;
}

const LOOPBACK = "127.0.0.1";

// `ssh -NL <local>:<remote>` with no command: this connection exists to carry the forward. The forward's destination is
// resolved ON the target, so `127.0.0.1` there is the remote's own loopback — exactly where the pair published.
export function bridgeTunnelArgv(credentials: SSHClientConnection, localPort: number, remotePort: number): string[] {
  return buildSSHTunnelArgs(credentials, `${LOOPBACK}:${localPort}`, `${LOOPBACK}:${remotePort}`);
}

export async function openBridgeTunnel(deps: BridgeTunnelDeps, spec: BridgeTunnelSpec): Promise<BridgeTunnel> {
  const argv = bridgeTunnelArgv(spec.credentials, deps.localPort, spec.remotePort);
  const child = await deps.spawn(deps.launcher ?? "ssh", argv);
  let stopped = false;
  child.on?.("exit", (payload) => {
    if (stopped) return;
    stopped = true;
    const reason = `the ssh forward for the assistant's bridge exited (${JSON.stringify(payload ?? {})})`;
    logger.warn(reason);
    spec.onLost?.(reason);
  });
  return {
    localPort: deps.localPort,
    stop: () => {
      // Once: a failed start tears down and the session's own stop runs afterwards, and killing a dead child would
      // report an error nobody can act on.
      if (stopped) return;
      stopped = true;
      try {
        child.kill();
      } catch (error) {
        logger.debug("killing the bridge forward failed", error);
      }
    },
  };
}
