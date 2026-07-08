import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("InspectSummary", () => {
  it("delegates Property/Value rendering to the shared PropertyValueTable", () => {
    const source = readFileSync(path.resolve("src/web-app/components/InspectSummary.tsx"), "utf8");

    expect(source).toContain('from "@/web-app/components/PropertyValueTable"');
    expect(source).toContain("<PropertyValueTable");
    expect(source).not.toContain("<HTMLTable");
    expect(source).not.toContain("<CopyButton");
  });
});
