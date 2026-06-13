import { describe, expect, it } from "vitest";

import { normalizeResourceEventDomains } from "./resourceEvents";

describe("normalizeResourceEventDomains", () => {
  it("maps Docker container events to container and pod snapshots", () => {
    expect(
      normalizeResourceEventDomains({
        Type: "container",
        Action: "start",
        Actor: { Attributes: { name: "web" } },
      }),
    ).toEqual(["containers", "pods"]);
  });

  it("maps Podman status-style pod events to pods and containers", () => {
    expect(
      normalizeResourceEventDomains({
        type: "pod",
        status: "remove",
        id: "pod-id",
      }),
    ).toEqual(["pods", "containers"]);
  });

  it("maps image action events even when the resource type is absent", () => {
    expect(
      normalizeResourceEventDomains({
        status: "pull",
        id: "busybox",
      }),
    ).toEqual(["images"]);
  });

  it("maps volume, network, and secret events to their own domains", () => {
    expect(normalizeResourceEventDomains({ Type: "volume", Action: "create" })).toEqual(["volumes"]);
    expect(normalizeResourceEventDomains({ Type: "network", Action: "remove" })).toEqual(["networks"]);
    expect(normalizeResourceEventDomains({ Type: "secret", Action: "create" })).toEqual(["secrets"]);
  });
});
