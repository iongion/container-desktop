import { describe, expect, it } from "vitest";

import { executionTargetLabel, type NamedConnection } from "./executionTargetLabel";

const t = (key: string) => key;
const connections: NamedConnection[] = [{ id: "c1", name: "System Podman" }];

describe("executionTargetLabel", () => {
  it("labels host (and a missing target) as Host", () => {
    expect(executionTargetLabel({ kind: "host" }, connections, t)).toBe("Host");
    expect(executionTargetLabel(undefined, connections, t)).toBe("Host");
  });

  it("labels remote with the connection name and SSH", () => {
    expect(executionTargetLabel({ kind: "remote", connectionId: "c1" }, connections, t)).toBe("System Podman (SSH)");
  });

  it("labels a container as <id> @ <connection>", () => {
    expect(
      executionTargetLabel({ kind: "container", connectionId: "c1", containerId: "abcdef0123456789" }, connections, t),
    ).toBe("abcdef012345 @ System Podman");
  });

  it("labels a sandbox with its image", () => {
    expect(executionTargetLabel({ kind: "sandbox", connectionId: "c1", image: "alpine:3" }, connections, t)).toBe(
      "Sandbox: alpine:3",
    );
  });

  it("falls back to the connection id when the connection is unknown", () => {
    expect(executionTargetLabel({ kind: "remote", connectionId: "gone" }, connections, t)).toBe("gone (SSH)");
  });
});
