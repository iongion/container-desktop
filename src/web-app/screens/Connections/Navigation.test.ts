import { IconNames } from "@blueprintjs/icons";
import { describe, expect, it } from "vitest";
import { getConnectionCrumbs, getConnectionUrl } from "./Navigation";

describe("connections navigation", () => {
  it("builds a detail URL scoped to the connection id", () => {
    const url = getConnectionUrl("MacOS/docker", "connection-info");

    expect(new URL(url).hash).toBe("#/screens/connections/MacOS%2Fdocker/connection-info");
  });

  it("builds the Connections > name > Connection info breadcrumb trail", () => {
    const crumbs = getConnectionCrumbs("System Podman", "connection-info", "system-default.podman");

    expect(crumbs).toEqual([
      {
        textKey: "Connections",
        icon: IconNames.DATA_CONNECTION,
        href: expect.stringContaining("#/screens/connections/manage"),
      },
      { text: "System Podman" },
      { textKey: "Connection info", current: true },
    ]);
  });

  it("builds the Connections > name > System info breadcrumb trail", () => {
    const crumbs = getConnectionCrumbs("System Podman", "system-info", "system-default.podman");

    expect(crumbs).toEqual([
      {
        textKey: "Connections",
        icon: IconNames.DATA_CONNECTION,
        href: expect.stringContaining("#/screens/connections/manage"),
      },
      {
        text: "System Podman",
        href: expect.stringContaining("#/screens/connections/system-default.podman/connection-info"),
      },
      { textKey: "System info", current: true },
    ]);
  });

  it("builds the Connections > name > Engine health breadcrumb trail", () => {
    const url = getConnectionUrl("System Podman", "health");
    const crumbs = getConnectionCrumbs("System Podman", "health", "System Podman");

    expect(new URL(url).hash).toBe("#/screens/connections/System%20Podman/health");
    expect(crumbs).toEqual([
      {
        textKey: "Connections",
        icon: IconNames.DATA_CONNECTION,
        href: expect.stringContaining("#/screens/connections/manage"),
      },
      { text: "System Podman", href: expect.stringContaining("#/screens/connections/System%20Podman/connection-info") },
      { textKey: "Engine health", current: true },
    ]);
  });
});
