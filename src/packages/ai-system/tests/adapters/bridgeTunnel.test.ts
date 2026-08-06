import { describe, expect, it, vi } from "vitest";

import { bridgeTunnelArgv, openBridgeTunnel } from "@/ai-system/adapters/bridgeTunnel";

// A pair on a REMOTE engine publishes its bridge on 127.0.0.1 of the machine running the engine, so the app — which
// dials 127.0.0.1 of its OWN machine — reaches nothing at all. A local forward is what makes that port answer here,
// and it is the only reason an assistant session can exist on an SSH connection.

const credentials = { host: "box.local", port: 22, username: "me", configHost: "win11" };

describe("bridgeTunnelArgv", () => {
  it("forwards a local port to the pair's published port on the remote's own loopback", () => {
    const argv = bridgeTunnelArgv(credentials, 41999, 43117);
    // The forward's destination is resolved ON the target, so 127.0.0.1 there is the remote's loopback — which is
    // exactly where the pair published its bridge.
    expect(argv).toContain("-NL");
    expect(argv).toContain("127.0.0.1:41999:127.0.0.1:43117");
    // No command: this connection exists to carry the forward and nothing else.
    expect(argv).not.toContain("--");
    expect(argv.at(-1)).toBe("win11");
  });

  // Without it, `ssh` reports the forward as established and the port silently answers nothing — the same symptom
  // as no tunnel at all, which is the failure this whole seam exists to remove.
  it("refuses to come up quietly when the forward cannot be bound", () => {
    expect(bridgeTunnelArgv(credentials, 41999, 43117)).toContain("-oExitOnForwardFailure=yes");
  });
});

describe("openBridgeTunnel", () => {
  function fakeProcess() {
    const handlers = new Map<string, (payload: unknown) => void>();
    return {
      kill: vi.fn(),
      on: (event: string, listener: (payload: unknown) => void) => handlers.set(event, listener),
      emit: (event: string, payload?: unknown) => handlers.get(event)?.(payload),
    };
  }

  it("dials the local end of the forward it opened", async () => {
    const spawned = fakeProcess();
    const spawn = vi.fn(async () => spawned);

    const tunnel = await openBridgeTunnel({ spawn, localPort: 41999 }, { credentials, remotePort: 43117 });

    expect(tunnel.localPort).toBe(41999);
    const [launcher, argv] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(launcher).toBe("ssh");
    expect(argv).toContain("127.0.0.1:41999:127.0.0.1:43117");
  });

  it("takes the forward down when the session does", async () => {
    const spawned = fakeProcess();
    const tunnel = await openBridgeTunnel(
      { spawn: async () => spawned, localPort: 41999 },
      {
        credentials,
        remotePort: 43117,
      },
    );

    tunnel.stop();

    // A forward left running holds a local port for the rest of the app's life, and the next session picks a
    // different one — so the leak is invisible until the ports run out.
    expect(spawned.kill).toHaveBeenCalled();
    // Stopping twice is what happens when a failed start tears down and stop() runs again.
    tunnel.stop();
    expect(spawned.kill).toHaveBeenCalledTimes(1);
  });

  // `ssh` exiting is not a detail: every frame after it goes nowhere. The caller is told so it can report the
  // session as lost rather than leaving a transcript that has quietly stopped receiving.
  it("reports a forward that dies under the session", async () => {
    const spawned = fakeProcess();
    const lost = vi.fn();
    await openBridgeTunnel(
      { spawn: async () => spawned, localPort: 41999 },
      {
        credentials,
        remotePort: 43117,
        onLost: lost,
      },
    );

    spawned.emit("exit", { code: 255 });

    expect(lost).toHaveBeenCalled();
  });

  it("says why when ssh cannot be spawned at all", async () => {
    const spawn = vi.fn(async () => {
      throw new Error("ENOENT: ssh");
    });

    await expect(openBridgeTunnel({ spawn, localPort: 41999 }, { credentials, remotePort: 43117 })).rejects.toThrow(
      /ENOENT/,
    );
  });
});
