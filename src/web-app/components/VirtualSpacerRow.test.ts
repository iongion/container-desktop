import { describe, expect, it } from "vitest";

import { VirtualSpacerRow } from "./VirtualSpacerRow";

// A pure presentational component — call it directly and assert the returned element tree (no DOM render).
describe("VirtualSpacerRow", () => {
  it("renders nothing when there is no height to reserve", () => {
    expect(VirtualSpacerRow({ height: 0, columnCount: 3 })).toBeNull();
    expect(VirtualSpacerRow({ height: -5, columnCount: 3 })).toBeNull();
  });

  it("reserves the given height across every column when positive", () => {
    const row = VirtualSpacerRow({ height: 42, columnCount: 5 }) as any;
    expect(row.type).toBe("tr");
    expect(row.props.className).toBe("AppVirtualSpacer");
    const cell = row.props.children;
    expect(cell.type).toBe("td");
    expect(cell.props.colSpan).toBe(5);
    expect(cell.props.style).toMatchObject({ height: 42 });
  });
});
