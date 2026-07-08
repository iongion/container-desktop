// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Source assertions intentionally match literal template syntax.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("connection health screen", () => {
  it("uses the route connection id and shared connection detail nav", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/EngineHealth/ManageScreen.tsx"), "utf8");

    expect(source).toContain("useRouteParams<{ id: string }>()");
    expect(source).toContain('decodeURIComponent(id || "")');
    expect(source).toContain('export const Title = i18n.t("Engine health")');
    expect(source).toContain("Path: `/screens/connections/$id/${View}`");
    expect(source).toContain("<AppScreenHeader");
    expect(source).toContain("breadcrumbs={getConnectionCrumbs(title, View, connectionId)}");
    expect(source).toMatch(/rightContent=\{[\s\n]*<ConnectionDetailsActionsMenu/);
    expect(source).toContain("const onReload = useCallback(() => {");
    expect(source).toContain("recheck(connectionId)");
    expect(source).toContain("const selectedEntry = entries.find((entry) => entry.card.id === connectionId)");
    expect(source).toContain("<ConnectionHealthHeader");
    expect(source).toContain("<ConnectionHealthContent");
    expect(source).not.toContain("<ConnectionCard");
    expect(source).not.toContain("collapsible={false}");
    expect(source).not.toContain("onRecheck");
    expect(source).not.toContain("<ScreenHeader");
    expect(source).not.toContain("entries.map((entry)");
    expect(source).not.toContain("useState");
    expect(source).not.toContain("rerunAll");
  });
});
