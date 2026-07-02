import { describe, expect, it } from "vitest";

import {
  reloadResources,
  resolveShowEngineColumn,
  resolveShowEngineRowAccent,
  sameDomainItems,
} from "./useMergedResources";

describe("resolveShowEngineColumn", () => {
  it("keeps the engine column hidden by default", () => {
    expect(resolveShowEngineColumn(true, undefined)).toBe(false);
    expect(resolveShowEngineColumn(true, false)).toBe(false);
  });

  it("shows the engine column only when unified mode and the user setting are both enabled", () => {
    expect(resolveShowEngineColumn(false, true)).toBe(false);
    expect(resolveShowEngineColumn(true, true)).toBe(true);
  });
});

describe("resolveShowEngineRowAccent", () => {
  it("shows row accents automatically in unified mode", () => {
    expect(resolveShowEngineRowAccent(false)).toBe(false);
    expect(resolveShowEngineRowAccent(true)).toBe(true);
  });
});

describe("reloadResources", () => {
  it("attempts every connection even when one refresh throws synchronously (connection dropped)", () => {
    const calls: string[] = [];
    reloadResources(["a", "b", "c"], ["containers"], (connId) => {
      calls.push(connId);
      if (connId === "b") {
        throw new Error("connection dropped");
      }
    });
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("does not reject on an async refresh failure (swallowed per connection)", () => {
    const calls: string[] = [];
    expect(() =>
      reloadResources(["a", "b"], ["containers", "images"], async (connId, domain) => {
        calls.push(`${connId}:${domain}`);
        if (connId === "a") {
          throw new Error("async fail");
        }
      }),
    ).not.toThrow();
    expect(calls).toEqual(["a:containers", "a:images", "b:containers", "b:images"]);
  });
});

describe("sameDomainItems", () => {
  it("treats unrelated resource-domain updates as unchanged", () => {
    const containers = [{ Id: "c1" }];
    expect(
      sameDomainItems(
        [{ connectionId: "docker", items: containers as any[] }],
        [{ connectionId: "docker", items: containers as any[] }],
      ),
    ).toBe(true);
  });

  it("detects changed domain item arrays and connection membership", () => {
    expect(
      sameDomainItems(
        [{ connectionId: "docker", items: [{ Id: "c1" }] as any[] }],
        [{ connectionId: "docker", items: [{ Id: "c1" }] as any[] }],
      ),
    ).toBe(false);
    expect(sameDomainItems([{ connectionId: "docker", items: [] }], [{ connectionId: "podman", items: [] }])).toBe(
      false,
    );
  });
});
