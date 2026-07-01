import { describe, expect, it, vi } from "vitest";
import { applyModelMarkers, MARKER_OWNER } from "../applyModelMarkers";

describe("applyModelMarkers", () => {
  it("sets model markers on the editor's model when monaco is ready", () => {
    const setModelMarkers = vi.fn();
    const model = {};
    const monaco = { editor: { setModelMarkers } } as any;
    const editor = { getModel: () => model } as any;
    const markers = [
      { message: "CF002", severity: 4, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
    ];
    expect(applyModelMarkers(monaco, editor, markers as any)).toBe(true);
    expect(setModelMarkers).toHaveBeenCalledWith(model, MARKER_OWNER, markers);
  });

  it("no-ops (returns false) with no monaco instance or no model", () => {
    const setModelMarkers = vi.fn();
    expect(applyModelMarkers(null, { getModel: () => ({}) } as any, [])).toBe(false);
    expect(applyModelMarkers({ editor: { setModelMarkers } } as any, { getModel: () => null } as any, [])).toBe(false);
    expect(setModelMarkers).not.toHaveBeenCalled();
  });

  it("clears markers when passed undefined", () => {
    const setModelMarkers = vi.fn();
    const monaco = { editor: { setModelMarkers } } as any;
    applyModelMarkers(monaco, { getModel: () => ({}) } as any, undefined);
    expect(setModelMarkers).toHaveBeenCalledWith(expect.anything(), MARKER_OWNER, []);
  });
});
