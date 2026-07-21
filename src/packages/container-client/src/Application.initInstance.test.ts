import { afterEach, describe, expect, it } from "vitest";

import { OperatingSystem } from "@/container-client/types/os";
import { Application } from "./Application";

afterEach(() => {
  (Application as any).instance = undefined;
});

describe("Application.initInstance", () => {
  it("seeds the singleton without window, and getInstance returns it", () => {
    const bus = { send: () => undefined, invoke: async () => undefined };
    const app = Application.initInstance({
      osType: OperatingSystem.Linux,
      version: "0.0.0-test",
      environment: "test",
      messageBus: bus as any,
    });
    expect(Application.getInstance()).toBe(app);
    expect(app.getOsType()).toBe(OperatingSystem.Linux);
  });
});
