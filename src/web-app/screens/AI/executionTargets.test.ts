import { describe, expect, it } from "vitest";

import type { Container } from "@/container-client/types/container";
import type { ContainerImage } from "@/container-client/types/image";

import { executionTargetMatches, pulledImageOptions, runningContainerOptions } from "./executionTargets";

function container(partial: {
  id: string;
  names?: string[];
  computedName?: string;
  image?: string;
  state: string;
}): Container {
  return {
    Id: partial.id,
    Names: partial.names ?? [],
    Image: partial.image ?? "",
    Computed: { Name: partial.computedName, DecodedState: partial.state },
  } as unknown as Container;
}

function image(partial: { id: string; name?: string; tag?: string; fullName?: string }): ContainerImage {
  return {
    Id: partial.id,
    Name: partial.name,
    Tag: partial.tag,
    FullName: partial.fullName,
  } as unknown as ContainerImage;
}

describe("runningContainerOptions", () => {
  it("offers only the containers a command can be entered into", () => {
    const options = runningContainerOptions([
      container({ id: "aaaaaaaaaaaa1111", computedName: "web", image: "nginx:1.27", state: "running" }),
      container({ id: "bbbbbbbbbbbb2222", computedName: "db", image: "postgres:17", state: "exited" }),
      container({ id: "cccccccccccc3333", computedName: "cache", image: "redis:7", state: "paused" }),
    ]);
    expect(options.map((option) => option.reference)).toEqual(["web"]);
  });

  it("names a container the way the list screens do, and shows what tells two apart", () => {
    const [option] = runningContainerOptions([
      container({ id: "aaaaaaaaaaaa1111", computedName: "web", image: "nginx:1.27", state: "running" }),
    ]);
    expect(option).toEqual({ reference: "web", label: "web", meta: "nginx:1.27 · aaaaaaaaaaaa" });
  });

  it("falls back to the engine name, then to the short id, so a row is never blank", () => {
    const options = runningContainerOptions([
      container({ id: "aaaaaaaaaaaa1111", names: ["/from-engine"], image: "nginx:1.27", state: "running" }),
      container({ id: "bbbbbbbbbbbb2222", image: "redis:7", state: "running" }),
    ]);
    expect(options.map((option) => option.reference)).toEqual(["bbbbbbbbbbbb", "from-engine"]);
    expect(options.map((option) => option.label)).toEqual(["bbbbbbbbbbbb", "from-engine"]);
  });

  it("omits the image from the meta line when the engine did not report one", () => {
    const [option] = runningContainerOptions([
      container({ id: "aaaaaaaaaaaa1111", computedName: "web", state: "running" }),
    ]);
    expect(option.meta).toBe("aaaaaaaaaaaa");
  });

  it("sorts by name so the list does not reorder between reads", () => {
    const options = runningContainerOptions([
      container({ id: "1", computedName: "zeta", state: "running" }),
      container({ id: "2", computedName: "alpha", state: "running" }),
    ]);
    expect(options.map((option) => option.label)).toEqual(["alpha", "zeta"]);
  });
});

describe("pulledImageOptions", () => {
  it("offers the reference the engine would resolve, with its short id", () => {
    const options = pulledImageOptions([
      image({ id: "sha256:aaaaaaaaaaaa1111", name: "docker.io/library/alpine", tag: "3", fullName: "alpine:3" }),
    ]);
    expect(options).toEqual([{ reference: "alpine:3", label: "alpine:3", meta: "aaaaaaaaaaaa" }]);
  });

  it("drops an untagged image, which cannot be named in a start form", () => {
    const options = pulledImageOptions([
      image({ id: "sha256:aaaaaaaaaaaa1111", fullName: "alpine:3" }),
      image({ id: "sha256:bbbbbbbbbbbb2222" }),
    ]);
    expect(options.map((option) => option.reference)).toEqual(["alpine:3"]);
  });
});

describe("executionTargetMatches", () => {
  const option = { reference: "web", label: "web", meta: "nginx:1.27 · aaaaaaaaaaaa" };

  it("matches on the name, the image and the id, case-insensitively", () => {
    expect(executionTargetMatches(option, "WEB")).toBe(true);
    expect(executionTargetMatches(option, "nginx")).toBe(true);
    expect(executionTargetMatches(option, "aaaaaa")).toBe(true);
  });

  it("does not match what the row does not carry", () => {
    expect(executionTargetMatches(option, "postgres")).toBe(false);
  });

  it("matches everything on an empty query", () => {
    expect(executionTargetMatches(option, "   ")).toBe(true);
  });
});
