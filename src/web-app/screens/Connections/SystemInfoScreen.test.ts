// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Source assertions intentionally match literal template syntax.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("system info screen", () => {
  it("uses the route connection id and shared connection detail nav", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/SystemInfoScreen.tsx"), "utf8");

    expect(source).toContain("useRouteParams<{ id: string }>()");
    expect(source).toContain('decodeURIComponent(id || "")');
    expect(source).toContain("Path: `/screens/connections/$id/${View}`");
    expect(source).toContain("<AppScreenHeader");
    expect(source).toContain("breadcrumbs={getConnectionCrumbs(title, View, connectionId)}");
    expect(source).toMatch(/rightContent=\{[\s\n]*<ConnectionDetailsActionsMenu/);
    expect(source).toContain("const { data: systemInfo, refetch } = systemInfoQuery");
    expect(source).toContain("onReload={onReload}");
    expect(source).not.toContain("ConnectionSelect");
    expect(source).not.toContain("useState");
    expect(source).not.toContain("<ScreenHeader");
  });
});
