import { describe, expect, it } from "vitest";

import { friendlyEndpoint } from "./endpointLabels";

describe("friendlyEndpoint", () => {
  it("labels common list/read routes (ignoring query strings)", () => {
    expect(friendlyEndpoint("GET", "/containers/json?all=true")).toBe("List containers");
    expect(friendlyEndpoint("GET", "/images/json")).toBe("List images");
    expect(friendlyEndpoint("GET", "/networks")).toBe("List networks");
    expect(friendlyEndpoint("GET", "/volumes")).toBe("List volumes");
    expect(friendlyEndpoint("GET", "/_ping")).toBe("Ping engine");
    expect(friendlyEndpoint("GET", "/version")).toBe("Engine version");
  });

  it("labels lifecycle routes", () => {
    expect(friendlyEndpoint("POST", "/containers/create")).toBe("Create container");
    expect(friendlyEndpoint("POST", "/containers/abc123/start")).toBe("Start container");
    expect(friendlyEndpoint("POST", "/images/create?fromImage=nginx")).toBe("Pull image");
  });

  it("disambiguates by HTTP method on the same path shape", () => {
    expect(friendlyEndpoint("GET", "/containers/abc123/json")).toBe("Inspect container");
    expect(friendlyEndpoint("DELETE", "/containers/abc123")).toBe("Remove container");
  });

  it("returns undefined for unknown routes", () => {
    expect(friendlyEndpoint("GET", "/totally/unknown/path")).toBeUndefined();
  });
});
