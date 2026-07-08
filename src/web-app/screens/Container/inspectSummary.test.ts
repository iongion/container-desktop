import { describe, expect, it } from "vitest";

import { type Container, ContainerStateList } from "@/env/Types";

import { buildContainerSummary } from "./inspectSummary";

const baseContainer = (overrides: Partial<Container> = {}): Container =>
  ({
    Id: "cid1234567890abcdef",
    Image: "sha256:deadbeefcafe",
    ImageName: "",
    Command: [],
    Created: "2026-07-02T10:06:05.000Z",
    Labels: {},
    Config: { Cmd: ["nginx", "-g", "daemon off;"], Env: [], ExposedPorts: {}, StopSignal: "", WorkDir: "" },
    Mounts: [],
    Names: ["/web"],
    State: { Status: ContainerStateList.RUNNING, Running: true } as any,
    Status: "Up 2 minutes",
    HostConfig: { Runtime: "", PortBindings: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" } as any] } },
    Computed: { Name: "web", DecodedState: ContainerStateList.RUNNING, Health: "healthy" },
    ...overrides,
  }) as Container;

const byKey = (rows: ReturnType<typeof buildContainerSummary>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("buildContainerSummary", () => {
  it("prefers Computed.* and a human image ref, and derives ports", () => {
    const c = baseContainer({ Config: { Image: "nginx:latest", Cmd: ["nginx"] } as any });
    const rows = byKey(buildContainerSummary(c));
    expect(rows.name.value).toBe("web");
    expect(rows.image.value).toBe("nginx:latest"); // Config.Image beats the sha in Image
    expect(rows.state.value).toBe("running");
    expect(rows.health.value).toBe("healthy");
    expect(rows.command.value).toBe("nginx");
    expect(rows.ports.value).toBe("0.0.0.0:8080→80/tcp");
    expect(rows.id.value).toBe("cid123456789");
    expect(String(rows.created.value)).toMatch(/\d{2} \w{3} \d{4}/);
  });

  it("uses ImageName when present (Podman)", () => {
    const rows = byKey(buildContainerSummary(baseContainer({ ImageName: "docker.io/library/nginx:1.27" })));
    expect(rows.image.value).toBe("docker.io/library/nginx:1.27");
  });

  it("omits health when there is no healthcheck", () => {
    const c = baseContainer({ Computed: { Name: "web", DecodedState: ContainerStateList.RUNNING } });
    expect(buildContainerSummary(c).some((r) => r.key === "health")).toBe(false);
  });

  it("falls back to a string State and list Command when Computed/Config are absent", () => {
    const c = baseContainer({
      Computed: undefined as any,
      State: ContainerStateList.EXITED,
      Config: undefined as any,
      Command: ["/bin/sh", "-c", "sleep 1"],
    });
    const rows = byKey(buildContainerSummary(c));
    expect(rows.state.value).toBe("exited");
    expect(rows.command.value).toBe("/bin/sh -c sleep 1");
    expect(rows.name.value).toBe("web"); // from Name/Names fallback
  });
});
