import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { SSHStdioBridgeServer, type StdioChannel } from "./ssh-stdio-bridge";

// A loopback "daemon": whatever is written to stdin is echoed back on stdout — stands in for
// `ssh host -- docker system dial-stdio` so the bridge can be tested without a real SSH connection.
function echoChannelFactory(spawned: StdioChannel[]) {
  return (): StdioChannel => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.on("data", (chunk) => stdout.write(chunk));
    let onExit = () => {};
    const channel: StdioChannel = {
      stdin,
      stdout,
      kill: () => {
        stdin.end();
        stdout.end();
        onExit();
      },
      onExit: (cb: () => void) => {
        onExit = cb;
      },
    };
    spawned.push(channel);
    return channel;
  };
}

const uniqueSock = () => path.join(os.tmpdir(), `cdt-bridge-${process.pid}-${Math.floor(performance.now())}.sock`);

describe("SSHStdioBridgeServer", () => {
  it("bridges bytes both directions between a client socket and the stdio channel", async () => {
    const spawned: StdioChannel[] = [];
    const bridge = new SSHStdioBridgeServer(uniqueSock(), echoChannelFactory(spawned));
    expect(await bridge.start()).toBe(true);
    try {
      const echoed = await new Promise<string>((resolve, reject) => {
        const client = net.connect((bridge as any).localAddress);
        const chunks: Buffer[] = [];
        client.on("connect", () => client.write("GET /_ping HTTP/1.0\r\n\r\n"));
        client.on("data", (c: Buffer) => {
          chunks.push(c);
          resolve(Buffer.concat(chunks).toString());
        });
        client.on("error", reject);
      });
      expect(echoed).toBe("GET /_ping HTTP/1.0\r\n\r\n");
      expect(spawned).toHaveLength(1);
    } finally {
      await bridge.stop();
    }
  });

  it("kills the spawned channel and stops listening on stop()", async () => {
    const spawned: StdioChannel[] = [];
    const bridge = new SSHStdioBridgeServer(uniqueSock(), echoChannelFactory(spawned));
    await bridge.start();
    await new Promise<void>((resolve) => {
      net.connect((bridge as any).localAddress, () => resolve());
    });
    await bridge.stop();
    expect(bridge.isListening()).toBe(false);
  });
});
