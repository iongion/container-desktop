import { describe, expect, it } from "vitest";

import { type Container, ContainerStateList } from "@/env/Types";

import { buildContainerEnvRows, buildContainerPortRows, buildContainerSummary } from "./inspectSummary";

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
  it("prefers Computed.* and a human image ref", () => {
    const c = baseContainer({ Config: { Image: "nginx:latest", Cmd: ["nginx"] } as any });
    const rows = byKey(buildContainerSummary(c));
    expect(rows.name).toBeUndefined(); // name shows in the breadcrumbs / header, not the summary
    expect(rows.image.value).toBe("nginx:latest"); // Config.Image beats the sha in Image
    expect(rows.state.value).toBe("running");
    expect(rows.health.value).toBe("healthy");
    expect(rows.command.value).toBe("nginx");
    expect(rows.ports).toBeUndefined(); // ports render in their own table, not the identity summary
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
  });
});

describe("buildContainerEnvRows", () => {
  it("sorts by name, splits on the first '=', and preserves values that contain '='", () => {
    const c = baseContainer({
      Config: { Env: ["FOO=bar", "DSN=postgres://u:p@h/db?ssl=1", "BARE"] } as any,
    });
    const rows = buildContainerEnvRows(c);
    expect(rows.map((r) => r.label)).toEqual(["BARE", "DSN", "FOO"]);
    const byName = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byName.DSN.value).toBe("postgres://u:p@h/db?ssl=1"); // only the first "=" splits
    expect(byName.DSN.copyText).toBe("postgres://u:p@h/db?ssl=1");
    expect(byName.FOO.value).toBe("bar");
    expect(byName.BARE.value).toBe(""); // no "=" → empty value
    expect(rows.every((r) => r.mono)).toBe(true);
  });

  it("returns [] when there are no environment variables", () => {
    expect(buildContainerEnvRows(baseContainer())).toEqual([]);
  });
});

describe("buildContainerPortRows", () => {
  it("maps HostConfig.PortBindings to container-port → host-binding rows", () => {
    const rows = buildContainerPortRows(baseContainer());
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("80/tcp");
    expect(rows[0].value).toBe("0.0.0.0:8080");
    expect(rows[0].copyText).toBe("0.0.0.0:8080");
    expect(rows[0].mono).toBe(true);
  });

  it("prefers NetworkSettings.Ports and expands every binding, defaulting a blank host IP", () => {
    const c = baseContainer({
      NetworkSettings: {
        Ports: {
          "9000/tcp": [{ HostIp: "0.0.0.0", HostPort: "9000" }],
          "9001/tcp": [{ HostIp: "", HostPort: "9001" }],
        },
      } as any,
    });
    const rows = buildContainerPortRows(c);
    expect(rows.map((r) => `${r.label}=${r.value}`)).toEqual(["9000/tcp=0.0.0.0:9000", "9001/tcp=0.0.0.0:9001"]);
  });

  it("returns [] when there are no ports", () => {
    expect(buildContainerPortRows(baseContainer({ HostConfig: { Runtime: "", PortBindings: {} } }))).toEqual([]);
  });
});
