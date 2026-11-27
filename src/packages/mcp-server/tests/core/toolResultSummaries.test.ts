import { describe, expect, it } from "vitest";
import { summarizeToolResult } from "@/mcp-server/core/toolResultSummaries";

// Shaped like what the engine adapters list: the computed fields next to the engine's own, heavy ones included.
const dockerContainer = {
  Id: "c1",
  Names: ["/shotsense-flipt"],
  Image: "sha256:abc",
  ImageName: "flipt/flipt:v2.13.0",
  State: "running",
  Status: "Up 42 hours (healthy)",
  Labels: { "com.docker.compose.project": "shotsense" },
  Mounts: [{ Type: "volume" }],
  NetworkSettings: { Networks: { bridge: {} } },
  Computed: { Name: "shotsense-flipt", DecodedState: "running", Health: "healthy" },
};

describe("summarizeToolResult", () => {
  it("answers listContainers with the id, name, image and state of each container", () => {
    expect(summarizeToolResult("listContainers", [dockerContainer])).toEqual([
      { id: "c1", name: "shotsense-flipt", image: "flipt/flipt:v2.13.0", state: "running" },
    ]);
  });

  it("falls back to the engine's own name, image and state when the computed ones are missing", () => {
    const bare = { Id: "c2", Names: ["/web"], Image: "nginx", State: "exited" };
    expect(summarizeToolResult("listContainers", [bare])).toEqual([
      { id: "c2", name: "web", image: "nginx", state: "exited" },
    ]);
  });

  it("answers listImages with the id, name, tag and size of each image", () => {
    const image = { Id: "sha256:1", Name: "docker.io/library/nginx", Tag: "1.27", Size: 1024, History: [{}] };
    expect(summarizeToolResult("listImages", [image])).toEqual([
      { id: "sha256:1", name: "docker.io/library/nginx", tag: "1.27", size: 1024 },
    ]);
  });

  it("answers listNetworks with the id, name and driver of each network", () => {
    const network = { id: "n1", name: "bridge", driver: "bridge", subnets: [{ subnet: "10.88.0.0/16" }] };
    expect(summarizeToolResult("listNetworks", [network])).toEqual([{ id: "n1", name: "bridge", driver: "bridge" }]);
  });

  it("answers listVolumes with the name, driver and mountpoint of each volume", () => {
    const volume = { Name: "data", Driver: "local", Mountpoint: "/var/lib/data", Labels: { a: "b" } };
    expect(summarizeToolResult("listVolumes", [volume])).toEqual([
      { name: "data", driver: "local", mountpoint: "/var/lib/data" },
    ]);
  });

  it("leaves every other tool's value as the engine gave it", () => {
    expect(summarizeToolResult("inspectContainer", dockerContainer)).toBe(dockerContainer);
    expect(summarizeToolResult("stopContainer", true)).toBe(true);
    const connections = [{ id: "podman", name: "Podman", engine: "podman", running: true, current: true }];
    expect(summarizeToolResult("listConnections", connections)).toBe(connections);
  });
});
