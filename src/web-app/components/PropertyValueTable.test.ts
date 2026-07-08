import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { type PropertyValueTableRow, propertyValueCopyText, sortPropertyValueRows } from "./PropertyValueTable";

describe("PropertyValueTable", () => {
  it("uses explicit copy text when provided", () => {
    expect(propertyValueCopyText("short", "full-value")).toBe("full-value");
  });

  it("falls back to simple display values for copy text", () => {
    expect(propertyValueCopyText("plain")).toBe("plain");
    expect(propertyValueCopyText(42)).toBe("42");
    expect(propertyValueCopyText(false)).toBe("false");
  });

  it("falls back to an empty copy value for complex React nodes", () => {
    expect(propertyValueCopyText(createElement("span", null, "nested"))).toBe("");
  });

  it("sorts rows by property label or copyable value", () => {
    const rows: PropertyValueTableRow[] = [
      { key: "b", label: "Beta", value: "2" },
      { key: "a", label: "Alpha", value: "10" },
    ];

    expect(sortPropertyValueRows(rows, undefined).map((row) => row.key)).toEqual(["a", "b"]);
    expect(sortPropertyValueRows(rows, { field: "property", dir: "asc" }).map((row) => row.key)).toEqual(["a", "b"]);
    expect(sortPropertyValueRows(rows, { field: "value", dir: "asc" }).map((row) => row.key)).toEqual(["b", "a"]);
  });
});
