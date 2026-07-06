import { describe, expect, it } from "vitest";

import { type Container, ContainerStateList } from "@/env/Types";
import type { MergedResource } from "@/web-app/hooks/useMergedResources";

import { enrichHealth, selectComposeHealthTargets } from "./useComposeHealth";

type MergedContainer = MergedResource<Container>;

const container = (
  id: string,
  connId: string,
  compose: boolean,
  health?: "healthy" | "unhealthy" | "starting",
  state: ContainerStateList = ContainerStateList.RUNNING,
): MergedContainer =>
  ({
    Id: id,
    connectionId: connId,
    Labels: compose ? { "com.docker.compose.project": "proj" } : {},
    Computed: { DecodedState: state, Health: health },
  }) as unknown as MergedContainer;

describe("selectComposeHealthTargets", () => {
  it("selects RUNNING compose containers missing health (podman's compat list omits it)", () => {
    const targets = selectComposeHealthTargets([
      container("a", "podman", true), // running compose, no health → needs inspect
      container("b", "docker", true, "healthy"), // compose but health already known (docker) → skip
      container("c", "podman", false), // not compose → skip
    ]);
    expect(targets.map((c) => c.Id)).toEqual(["a"]);
  });

  it("skips stopped compose containers — their health is stale, so it must not be inspected/overlaid", () => {
    const targets = selectComposeHealthTargets([
      container("running", "podman", true, undefined, ContainerStateList.RUNNING),
      container("exited", "podman", true, undefined, ContainerStateList.EXITED),
      container("created", "podman", true, undefined, ContainerStateList.CREATED),
    ]);
    expect(targets.map((c) => c.Id)).toEqual(["running"]);
  });
});

describe("enrichHealth", () => {
  it("overlays resolved health by connection-qualified id, leaving others untouched", () => {
    const list = [container("a", "podman", true), container("b", "podman", true)];
    const out = enrichHealth(list, new Map([["podman:a", "healthy"]]));
    expect(out.find((c) => c.Id === "a")?.Computed.Health).toBe("healthy");
    expect(out.find((c) => c.Id === "b")?.Computed.Health).toBeUndefined();
  });

  it("returns the same array reference when there is nothing to overlay", () => {
    const list = [container("a", "podman", true)];
    expect(enrichHealth(list, new Map())).toBe(list);
  });
});
