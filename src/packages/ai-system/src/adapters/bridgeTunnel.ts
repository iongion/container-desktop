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

import { LOOPBACK_ADDRESS } from "@/container-client/runtimes/publishedPortHost";
import { buildSSHTunnelArgs, type SSHClientConnection } from "@/container-client/ssh-args";
import { SSH_RETRY_DELAY_MS } from "@/container-client/ssh-retry";
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
  // The port the pair published on the remote.
  remotePort: number;
  // Where that port answers, as reached FROM the remote. Its own loopback for an engine that runs the containers
  // itself; the machine's own address for one whose engine lives inside a machine, because a port published there
  // never appears on the host running it (`container-client/runtimes/publishedPortHost`).
  remoteHost?: string;
  // Called when the forward dies under a live session. Every frame after that goes nowhere, so the caller reports the
  // session as lost rather than leaving a transcript that has silently stopped receiving.
  onLost?: (reason: string) => void;
  // What this forward carries, in the words the reason string uses. A pair has two sockets reached this same way — the
  // bridge and the conversation store — and a reason naming the wrong one sends the reader to the wrong place.
  label?: string;
  // How many times a forward that died before it could carry anything is opened again, how long "before it could
  // have carried anything" means, and how long to WAIT before each of those attempts. Overridden only by tests.
  retry?: { attempts: number; graceMs: number; delayMs?: number };
  // The clock the grace window is measured on. Injected so a test does not have to wait one out.
  now?: () => number;
}

// `ssh` exits 255 when the remote refuses the handshake, which a remote's sshd does under a burst — measured, up to 2
// of 14 simultaneous connections on a Windows remote. A forward that dies that way never carried a byte, so re-opening
// it repeats nothing; a forward that dies after it has been carrying the session is a real loss and is reported. The
// window is what tells those two apart.
const RETRY_ATTEMPTS = 3;
const RETRY_GRACE_MS = 5000;

// Waiting between attempts is what MAKES them attempts. Re-opening from the exit handler put all three into the same
// instant, which is one more connection into the very burst the remote is refusing: measured on a real run, three
// exits with code 255 within milliseconds of each other, after which the session dialled a local port nothing was
// listening on for ten seconds and reported it as a socket error. This is the delay the app already waits out for a
// burst-refused engine command, doubled per attempt so the last try is a second away rather than in the same breath.
const RETRY_DELAY_MS = SSH_RETRY_DELAY_MS;

// `ssh -NL <local>:<remote>` with no command: this connection exists to carry the forward. The forward's destination is
// resolved ON the target, so `127.0.0.1` there is the remote's own loopback — where a pair published by an engine that
// runs its containers itself is — and a machine's address there is that machine, reached from the host running it.
export function bridgeTunnelArgv(
  credentials: SSHClientConnection,
  localPort: number,
  remotePort: number,
  remoteHost: string = LOOPBACK_ADDRESS,
): string[] {
  return buildSSHTunnelArgs(credentials, `${LOOPBACK_ADDRESS}:${localPort}`, `${remoteHost}:${remotePort}`);
}

export async function openBridgeTunnel(deps: BridgeTunnelDeps, spec: BridgeTunnelSpec): Promise<BridgeTunnel> {
  const argv = bridgeTunnelArgv(spec.credentials, deps.localPort, spec.remotePort, spec.remoteHost);
  const launcher = deps.launcher ?? "ssh";
  const attempts = spec.retry?.attempts ?? RETRY_ATTEMPTS;
  const graceMs = spec.retry?.graceMs ?? RETRY_GRACE_MS;
  const delayMs = spec.retry?.delayMs ?? RETRY_DELAY_MS;
  const now = spec.now ?? (() => Date.now());
  const what = spec.label ?? "the assistant's bridge";
  let stopped = false;
  let child: TunnelProcess | undefined;
  let reopening: ReturnType<typeof setTimeout> | undefined;

  const open = async (attempt: number): Promise<void> => {
    const startedAt = now();
    const spawned = await deps.spawn(launcher, argv);
    child = spawned;
    spawned.on?.("exit", (payload) => {
      if (stopped) return;
      const carried = now() - startedAt;
      // Refused before it could carry anything, and there is another attempt: open it again rather than take a session
      // down for a connection the remote dropped mid-handshake.
      if (carried <= graceMs && attempt < attempts) {
        const wait = delayMs * 2 ** (attempt - 1);
        logger.debug(`the ssh forward for ${what} was refused at once, opening it again in ${wait}ms`, {
          attempt,
          payload,
        });
        reopening = setTimeout(() => {
          reopening = undefined;
          // The session may have been stopped while this was waiting, and a forward brought up behind a pair that is
          // gone holds a local port for the rest of the app's life.
          if (stopped) return;
          void open(attempt + 1).catch((error) => {
            stopped = true;
            const reason = `the ssh forward for ${what} could not be opened again: ${error}`;
            logger.warn(reason);
            spec.onLost?.(reason);
          });
        }, wait);
        return;
      }
      stopped = true;
      const exhausted = carried <= graceMs ? ` after ${attempt} attempts` : "";
      const reason = `the ssh forward for ${what} exited${exhausted} (${JSON.stringify(payload ?? {})})`;
      logger.warn(reason);
      spec.onLost?.(reason);
    });
  };

  await open(1);
  return {
    localPort: deps.localPort,
    stop: () => {
      // Once: a failed start tears down and the session's own stop runs afterwards, and killing a dead child would
      // report an error nobody can act on.
      if (stopped) return;
      stopped = true;
      if (reopening) {
        clearTimeout(reopening);
        reopening = undefined;
      }
      try {
        child?.kill();
      } catch (error) {
        logger.debug("killing the bridge forward failed", error);
      }
    },
  };
}
