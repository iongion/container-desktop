import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { removeConnectionQueries } from "./queryClient";

describe("removeConnectionQueries", () => {
  it("removes only the target connection's cached resources, across every resource type", () => {
    const qc = new QueryClient();
    qc.setQueryData(["containers", "list", "connA"], [{ id: 1 }]);
    qc.setQueryData(["images", "list", "connA"], [{ id: 2 }]);
    qc.setQueryData(["swarm", "info", "connA"], { ok: true });
    qc.setQueryData(["containers", "list", "connB"], [{ id: 3 }]);
    qc.setQueryData(["images", "list", "connB"], [{ id: 4 }]);

    removeConnectionQueries(qc, "connA");

    expect(qc.getQueryData(["containers", "list", "connA"])).toBeUndefined();
    expect(qc.getQueryData(["images", "list", "connA"])).toBeUndefined();
    expect(qc.getQueryData(["swarm", "info", "connA"])).toBeUndefined();
    // Other connections are untouched (scoped, not a global clear).
    expect(qc.getQueryData(["containers", "list", "connB"])).toEqual([{ id: 3 }]);
    expect(qc.getQueryData(["images", "list", "connB"])).toEqual([{ id: 4 }]);
  });

  it("no-ops on an empty connection id (never wipes the whole cache)", () => {
    const qc = new QueryClient();
    qc.setQueryData(["containers", "list", "connA"], [{ id: 1 }]);
    removeConnectionQueries(qc, "");
    expect(qc.getQueryData(["containers", "list", "connA"])).toEqual([{ id: 1 }]);
  });
});
