// A local IPC listener (Unix socket on Linux/macOS, named pipe on Windows) that bridges each incoming
// connection to a raw bidirectional stdio channel — used to reach a remote container engine whose API is
// a Windows named pipe (`npipe://…`) that can't be `ssh -NL` forwarded. Per connection we open a fresh
// `ssh <host> -- docker system dial-stdio` channel and shuttle raw bytes both ways. No TCP anywhere: local
// IPC + SSH stdio only. Modeled on WSLRelayServer (wsl-relay.ts).

import fs from "node:fs";
import net from "node:net";
import { createLogger } from "@/logger";

const logger = createLogger("platform.ssh-stdio-bridge");

/** A raw, byte-accurate duplex to the remote engine daemon (e.g. `docker system dial-stdio` over SSH). */
export interface StdioChannel {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  kill: () => void;
  onExit: (cb: () => void) => void;
}

export type StdioChannelFactory = () => StdioChannel;

// A Windows named pipe path (\\.\pipe\…) is not a filesystem entry; a Unix socket path is, and a stale file
// from a crashed run makes listen() fail with EADDRINUSE — so unlink it first.
function isWindowsPipe(address: string): boolean {
  return address.startsWith("\\\\");
}

export class SSHStdioBridgeServer {
  private server: net.Server | undefined;
  private readonly channels = new Set<StdioChannel>();

  constructor(
    public readonly localAddress: string,
    private readonly makeChannel: StdioChannelFactory,
  ) {}

  isListening(): boolean {
    return Boolean(this.server?.listening);
  }

  start(): Promise<boolean> {
    if (!isWindowsPipe(this.localAddress)) {
      try {
        fs.unlinkSync(this.localAddress);
      } catch {
        /* no stale socket — fine */
      }
    }
    return new Promise((resolve) => {
      const server = net.createServer((socket) => this.handleConnection(socket));
      server.on("error", (err: any) => {
        logger.error("SSH stdio bridge server error", `${err?.message ?? err}`);
        resolve(false);
      });
      server.listen(this.localAddress, () => {
        logger.debug("SSH stdio bridge listening", this.localAddress);
        resolve(true);
      });
      this.server = server;
    });
  }

  private handleConnection(socket: net.Socket): void {
    const channel = this.makeChannel();
    this.channels.add(channel);
    const cleanup = () => {
      if (!this.channels.delete(channel)) {
        return;
      }
      try {
        channel.kill();
      } catch {
        /* already gone */
      }
      socket.destroy();
    };
    // Duplex pipe: .pipe() carries backpressure and forwards EOF (half-close) in each direction — exactly the
    // dial-stdio contract. Bytes stay raw Buffers; nothing is decoded to a string.
    channel.stdout.pipe(socket);
    socket.pipe(channel.stdin);
    channel.onExit(cleanup);
    socket.on("close", cleanup);
    socket.on("error", cleanup);
    channel.stdout.on("error", cleanup);
  }

  async stop(): Promise<void> {
    for (const channel of this.channels) {
      try {
        channel.kill();
      } catch {
        /* already gone */
      }
    }
    this.channels.clear();
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
      this.server = undefined;
    });
  }
}
