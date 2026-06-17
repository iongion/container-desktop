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
});
