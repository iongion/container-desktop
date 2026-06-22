import { describe, expect, it } from "vitest";

import type { Registry } from "@/env/Types";
import {
  buildDockerSearchArgs,
  buildImageSearchParams,
  buildPodmanSearchArgs,
  normalizeAndSortSearchResults,
  normalizeSearchOutput,
} from "./registrySearch";

const reg = (id: string, name: string) => ({ id, name }) as Registry;

describe("buildImageSearchParams", () => {
  it("podman: emits term, is-automated, is-official in that order", () => {
    const params = buildImageSearchParams("nginx", { isAutomated: true, isOfficial: true }, { includeAutomated: true });
    expect(params.toString()).toBe("term=nginx&is-automated=true&is-official=true");
  });

  it("apple: never emits is-automated even when the filter is set", () => {
    const params = buildImageSearchParams(
      "nginx",
      { isAutomated: true, isOfficial: true },
      { includeAutomated: false },
    );
    expect(params.toString()).toBe("term=nginx&is-official=true");
  });

  it("defaults an empty term and omits unset filters", () => {
    const params = buildImageSearchParams(undefined as unknown as string, undefined, { includeAutomated: true });
    expect(params.toString()).toBe("term=");
  });
});

describe("buildPodmanSearchArgs", () => {
  it("includes both filters, then <registry>/<term> --format json", () => {
    expect(buildPodmanSearchArgs(reg("quay.io", "quay.io"), "nginx", { isOfficial: true, isAutomated: true })).toEqual([
      "search",
      "--filter=is-official",
      "--filter=is-automated",
      "quay.io/nginx",
      "--format",
      "json",
    ]);
  });

  it("omits filters when none requested", () => {
    expect(buildPodmanSearchArgs(reg("docker.io", "docker.io"), "redis", {})).toEqual([
      "search",
      "docker.io/redis",
      "--format",
      "json",
    ]);
  });
});

describe("buildDockerSearchArgs", () => {
  it("search --format json --filter is-official=true <term>", () => {
    expect(buildDockerSearchArgs("nginx", { isOfficial: true })).toEqual([
      "search",
      "--format",
      "json",
      "--filter",
      "is-official=true",
      "nginx",
    ]);
  });

  it("omits the official filter when not requested", () => {
    expect(buildDockerSearchArgs("nginx", {})).toEqual(["search", "--format", "json", "nginx"]);
  });
});

describe("normalizeSearchOutput", () => {
  it("docker: joins multi-line JSON into one array string", () => {
    expect(normalizeSearchOutput('{"a":1}\n{"b":2}', true)).toBe('[{"a":1},{"b":2}]');
  });

  it("docker: empty stdout becomes an empty array", () => {
    expect(normalizeSearchOutput("", true)).toBe("[]");
  });

  it("non-docker: returns stdout unchanged", () => {
    expect(normalizeSearchOutput('[{"a":1}]', false)).toBe('[{"a":1}]');
  });
});

describe("normalizeAndSortSearchResults", () => {
  it("defaults Stars from StarCount and sorts by stars desc", () => {
    const out = normalizeAndSortSearchResults([
      { Name: "bravo", StarCount: 5 },
      { Name: "alpha", Stars: 10 },
      { Name: "charlie" },
    ]);
    expect(out.map((it: any) => it.Name)).toEqual(["alpha", "bravo", "charlie"]);
    expect(out[0].Stars).toBe(10);
    expect(out[1].Stars).toBe(5); // derived from StarCount
    expect(out[2].Stars).toBe(0); // defaulted
  });
});
