import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("PropertyValueTable source", () => {
  it("owns sortable Property/Value headers and row copy buttons", () => {
    const source = readFileSync(path.resolve("src/web-app/components/PropertyValueTable.tsx"), "utf8");

    expect(source).toContain('import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader"');
    expect(source).toMatch(/<SortableColumnHeader[\s\n]+field="property"/);
    expect(source).toContain('<SortableColumnHeader field="value"');
    expect(source).toContain("<CopyButton");
    expect(source).toContain("propertyValueCopyText(row.value, row.copyText)");
  });
});
