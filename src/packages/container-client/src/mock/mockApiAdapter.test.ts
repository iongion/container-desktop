import { describe, expect, it } from "vitest";

import { ContainerEngine } from "@/container-client/types/engine";

import { mockApiAdapter } from "./mockApiAdapter";

describe("mockApiAdapter streaming", () => {
  it("returns an on/off/destroy stream emitter for container logs with responseType stream", async () => {
    const res = await mockApiAdapter(
      { url: "/containers/abc/logs", method: "GET", responseType: "stream" },
      { engine: ContainerEngine.PODMAN },
    );
    const stream: any = res.data;
    expect(typeof stream.on).toBe("function");
    expect(typeof stream.off).toBe("function");
    expect(typeof stream.removeListener).toBe("function");
    expect(typeof stream.destroy).toBe("function");
    expect(typeof stream.close).toBe("function");

    const events: string[] = [];
    const chunks: string[] = [];
    await new Promise<void>((resolve) => {
      stream.on("data", (c: Uint8Array) => {
        events.push("data");
        chunks.push(new TextDecoder().decode(c));
      });
      stream.on("end", () => {
        events.push("end");
        resolve();
      });
    });

    // Podman log fixtures are non-empty, so chunks arrive, and "end" is always the final event.
    expect(chunks.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toBe("end");
    // destroy is safe/idempotent after the stream has ended.
    expect(() => stream.destroy()).not.toThrow();
    expect(() => stream.destroy()).not.toThrow();
  });

  it("returns an empty stream that still ends for the /events endpoint", async () => {
    const res = await mockApiAdapter(
      { url: "/events", method: "GET", responseType: "stream" },
      { engine: ContainerEngine.PODMAN },
    );
    const stream: any = res.data;
    await new Promise<void>((resolve) => {
      stream.on("end", () => resolve());
    });
    expect(typeof stream.destroy).toBe("function");
  });
});
