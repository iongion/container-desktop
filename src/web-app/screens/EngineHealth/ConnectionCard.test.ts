import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("connection health card", () => {
  it("keeps the connection header separate from the page content", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/EngineHealth/ConnectionCard.tsx"), "utf8");

    expect(source).toContain("export function ConnectionHealthHeader");
    expect(source).toContain("export function ConnectionHealthContent");
    expect(source).toContain("collapsible?: boolean");
    expect(source).toContain("collapsible = false");
    expect(source).toContain("const canCollapse = collapsible");
    expect(source).toContain('className={`ConnHead ${klass}${canCollapse && !expanded ? " collapsed" : ""}`}');
    expect(source).toContain('role={canCollapse ? "button" : undefined}');
    expect(source).toContain('{canCollapse ? <Icon className="chev" icon={IconNames.CHEVRON_DOWN} /> : null}');
    expect(source).not.toContain('className="ConnBody"');
    expect(source).not.toContain("ConnCard");
    expect(source).not.toContain("onRecheck");
    expect(source).not.toContain('title={t("Re-check")}');
  });
});
