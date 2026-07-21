import { describe, expect, it } from "vitest";

import { normalizeResourceEventDomains, RESOURCE_DOMAINS } from "./resourceDomains";

describe("resourceDomains", () => {
  it("lists the canonical domains", () => {
    expect(RESOURCE_DOMAINS).toEqual(["containers", "images", "pods", "volumes", "networks", "secrets"]);
  });

  it("maps a container event to containers + pods", () => {
    expect(normalizeResourceEventDomains({ Type: "container", Action: "start" }).sort()).toEqual([
      "containers",
      "pods",
    ]);
  });

  it("maps an image pull to images", () => {
    expect(normalizeResourceEventDomains({ Type: "image", Action: "pull" })).toEqual(["images"]);
  });

  it("returns nothing for an unrelated event", () => {
    expect(normalizeResourceEventDomains({ Type: "daemon", Action: "reload" })).toEqual([]);
  });

  it("drops health-check exec traffic — exec_* changes no resource list", () => {
    expect(normalizeResourceEventDomains({ Type: "container", Action: "exec_create: /bin/sh -c curl" })).toEqual([]);
    expect(normalizeResourceEventDomains({ Type: "container", Action: "exec_start: /bin/sh -c curl" })).toEqual([]);
    expect(normalizeResourceEventDomains({ Type: "container", Action: "exec_die" })).toEqual([]);
  });

  it("keeps health_status — a transition (not per-probe), so the health pill still updates", () => {
    expect(normalizeResourceEventDomains({ Type: "container", Action: "health_status: healthy" }).sort()).toEqual([
      "containers",
      "pods",
    ]);
  });
});
