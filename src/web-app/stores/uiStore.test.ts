import { beforeEach, describe, expect, it } from "vitest";

import { useUIStore } from "./uiStore";

describe("uiStore selection", () => {
  beforeEach(() => {
    useUIStore.getState().reset();
  });

  it("sets selected rows per scope", () => {
    useUIStore.getState().setSelectedRows("containers", ["a", "b"]);
    expect(useUIStore.getState().selectedRows.containers).toEqual(["a", "b"]);
    expect(useUIStore.getState().selectedRows.images).toBeUndefined();
  });

  it("reset clears selected rows", () => {
    useUIStore.getState().setSelectedRows("containers", ["a", "b"]);
    useUIStore.getState().reset();
    expect(useUIStore.getState().selectedRows).toEqual({});
  });
});
