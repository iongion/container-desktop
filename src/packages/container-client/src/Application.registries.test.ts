import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContainerEngine } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";
import type { Registry } from "@/container-client/types/registry";
import { Application } from "./Application";

// Point user-data at a nonexistent dir so getRegistriesMap never reads a real registries.json — the
// "default" list (where the podman-only "system" entry lives) is all these tests assert on.
beforeEach(() => {
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR = "/nonexistent/cd-registries-test";
});
afterEach(() => {
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR = undefined;
  (Application as any).instance = undefined;
});

function makeApp() {
  const bus = { send: () => undefined, invoke: async () => undefined };
  return Application.initInstance({
    osType: OperatingSystem.Linux,
    version: "0.0.0-test",
    environment: "test",
    messageBus: bus as any,
  });
}

const systemOf = (map: { default: Registry[] }) => map.default.find((it) => it.id === "system");

describe("Application.getRegistriesMap", () => {
  it("does not throw when no engine host is current (the merged connectAll path)", async () => {
    const app = makeApp();
    // _currentContainerEngineHostClient is unset here, exactly like the always-merged workspace.
    await expect(app.getRegistriesMap()).resolves.toBeDefined();
  });

  it("enables the podman-only system registry when the provided host is podman", async () => {
    const app = makeApp();
    const map = await app.getRegistriesMap({ host: { ENGINE: ContainerEngine.PODMAN } as any });
    expect(systemOf(map)?.enabled).toBe(true);
  });

  it("disables the system registry for a docker host (and when no host is resolvable)", async () => {
    const app = makeApp();
    const docker = await app.getRegistriesMap({ host: { ENGINE: ContainerEngine.DOCKER } as any });
    expect(systemOf(docker)?.enabled).toBe(false);
    const none = await app.getRegistriesMap();
    expect(systemOf(none)?.enabled).toBe(false);
  });
});
