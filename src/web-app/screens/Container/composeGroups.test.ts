import { describe, expect, it } from "vitest";

import type { Container } from "@/container-client/types/container";
import type { ContainerGroup } from "@/web-app/Types";

import { composeProjectOf, isComposeContainer, isComposeGroup, stackHookTargetOf } from "./composeGroups";
import type { MergedContainer } from "./flattenGroups";

const withLabels = (labels?: Record<string, string>): Container => ({ Labels: labels }) as unknown as Container;

describe("isComposeContainer", () => {
  it("is true when the docker-compose project label is present", () => {
    expect(isComposeContainer(withLabels({ "com.docker.compose.project": "shop" }))).toBe(true);
  });

  it("is true when the podman-compose project label is present", () => {
    expect(isComposeContainer(withLabels({ "io.podman.compose.project": "shop" }))).toBe(true);
  });

  it("is false without a project label (service label alone, empty, or missing)", () => {
    expect(isComposeContainer(withLabels({ "com.docker.compose.service": "web" }))).toBe(false);
    expect(isComposeContainer(withLabels({}))).toBe(false);
    expect(isComposeContainer(withLabels(undefined))).toBe(false);
  });
});

describe("composeProjectOf", () => {
  it("returns the project name from either engine's convention", () => {
    expect(composeProjectOf(withLabels({ "com.docker.compose.project": "shop" }))).toBe("shop");
    expect(composeProjectOf(withLabels({ "io.podman.compose.project": "blog" }))).toBe("blog");
  });

  it("is undefined for a non-compose container", () => {
    expect(composeProjectOf(withLabels({}))).toBeUndefined();
  });
});

describe("isComposeGroup", () => {
  const group = (items: Container[]): ContainerGroup => ({ Items: items }) as unknown as ContainerGroup;

  it("is true when any member carries a compose project label", () => {
    expect(isComposeGroup(group([withLabels({ "com.docker.compose.project": "shop" })]))).toBe(true);
  });

  it("is false for a name-prefix / lonely group", () => {
    expect(isComposeGroup(group([withLabels({}), withLabels(undefined)]))).toBe(false);
  });

  it("is false for an empty group", () => {
    expect(isComposeGroup(group([]))).toBe(false);
  });
});

describe("stackHookTargetOf", () => {
  const member = (labels: Record<string, string> | undefined, connectionId = "c1") =>
    ({ Labels: labels, connectionId, engine: "podman" }) as unknown as MergedContainer;

  it("names the stack, its connection and engine from the first member with a project label", () => {
    expect(stackHookTargetOf([member(undefined), member({ "com.docker.compose.project": "shop" })])).toEqual({
      connectionId: "c1",
      engine: "podman",
      name: "shop",
    });
  });

  it("is undefined for a name-prefix group", () => {
    expect(stackHookTargetOf([member(undefined), member({ other: "x" })])).toBeUndefined();
  });
});
