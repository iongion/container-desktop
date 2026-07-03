import { afterEach, describe, expect, it } from "vitest";

import type { Connection } from "@/env/Types";

import { createApplicationApiDriver } from "./Api.clients";

// Regression: the /events (and container-logs) streams pass an AbortSignal to bound the attach. The request
// funnel deep-merges the per-request config, and deepMerge clones plain objects — which would turn the
// AbortSignal into a prototype-less object. The Node http adapter then throws
// "config.signal.addEventListener is not a function", the events stream never opens, and the UI stops
// live-updating (dashboard/containers don't reflect `docker run` until a manual reload). The signal must
// reach ProxyRequest with its identity intact.
describe("createApplicationApiDriver — request signal handling", () => {
  const previousCommand = (globalThis as any).Command;
  afterEach(() => {
    (globalThis as any).Command = previousCommand;
  });

  const connection = { id: "c1", name: "Current", engine: "docker", host: "docker.native" } as unknown as Connection;

  it("forwards the caller's AbortSignal unmangled (deepMerge must not clone it to a plain object)", async () => {
    let captured: any;
    (globalThis as any).Command = {
      async ProxyRequest(req: any) {
        captured = req;
        return { status: 200, data: "OK" };
      },
    };
    const controller = new AbortController();
    const driver = createApplicationApiDriver(connection);
    await driver.get("/events", { signal: controller.signal, responseType: "stream" });

    expect(captured.signal).toBe(controller.signal);
    expect(typeof captured.signal.addEventListener).toBe("function");
    expect(captured.signal.aborted).toBe(false);
  });

  it("leaves requests without a signal untouched", async () => {
    let captured: any;
    (globalThis as any).Command = {
      async ProxyRequest(req: any) {
        captured = req;
        return { status: 200, data: "OK" };
      },
    };
    const driver = createApplicationApiDriver(connection);
    await driver.get("/containers/json", { params: { all: true } });
    expect(captured.signal).toBeUndefined();
  });
});
