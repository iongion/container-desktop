import { afterEach, describe, expect, it, vi } from "vitest";

import { Application } from "@/container-client/Application";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { RegistriesAdapter } from "./registries";

afterEach(() => {
  vi.restoreAllMocks();
});

// Record every Application registry call so we can assert the adapter threads its per-connection host
// through — without it, Application falls back to the unset singular client and throws on `.ENGINE`.
function stubApplication() {
  const calls: { method: string; opts: any }[] = [];
  const stub = {
    getRegistriesMap: async (opts?: any) => {
      calls.push({ method: "getRegistriesMap", opts });
      return { default: [], custom: [] };
    },
    setRegistriesMap: async (registries: any, opts?: any) => {
      calls.push({ method: "setRegistriesMap", opts });
      return registries;
    },
  };
  vi.spyOn(Application, "getInstance").mockReturnValue(stub as any);
  return calls;
}

describe("RegistriesAdapter host forwarding", () => {
  const host = { ENGINE: "podman" } as unknown as HostClientFacade;

  it("forwards its per-connection host to Application.getRegistriesMap", async () => {
    const calls = stubApplication();
    await new RegistriesAdapter(host).getRegistriesMap();
    expect(calls).toEqual([{ method: "getRegistriesMap", opts: { host } }]);
  });

  it("forwards the host through every call when creating a registry", async () => {
    const calls = stubApplication();
    await new RegistriesAdapter(host).createRegistry({ name: "x" } as any);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.opts?.host === host)).toBe(true);
  });

  it("forwards the host through every call when removing a registry", async () => {
    const calls = stubApplication();
    await new RegistriesAdapter(host).removeRegistry("missing");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.opts?.host === host)).toBe(true);
  });
});
