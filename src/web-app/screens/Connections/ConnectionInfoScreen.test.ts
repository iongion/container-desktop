// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Source assertions intentionally match literal template syntax.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("connection info screen", () => {
  it("uses the route connection id instead of a header connection switcher", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/ConnectionInfoScreen.tsx"), "utf8");

    expect(source).toContain("useRouteParams<{ id: string }>()");
    expect(source).toContain('decodeURIComponent(id || "")');
    expect(source).toContain("Path: `/screens/connections/$id/${View}`");
    expect(source).toContain("<AppScreenHeader");
    expect(source).toContain("breadcrumbs={getConnectionCrumbs(title, View, connectionId)}");
    expect(source).toMatch(/rightContent=\{[\s\n]*<ConnectionDetailsActionsMenu/);
    expect(source).toContain("const refreshConnections = useAppStore((state) => state.getConnections)");
    expect(source).toContain("onReload={onReload}");
    expect(source).toContain("<PropertyValueTable");
    expect(source).toContain('dataTable="connections.connection-info"');
    expect(source).not.toContain("ConnectionSelect");
    expect(source).not.toContain("<ScreenHeader");
    expect(source).not.toContain("<HTMLTable");
  });
});
