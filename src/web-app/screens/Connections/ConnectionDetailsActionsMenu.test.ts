import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("connection details actions menu", () => {
  it("adds scoped connection detail links to the row menu", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/ActionsMenu.tsx"), "utf8");

    expect(source).toContain('href={getConnectionUrl(connection.id, "connection-info")}');
    expect(source).toContain('href={isConnected ? getConnectionUrl(connection.id, "system-info") : undefined}');
    expect(source).toContain('href={isConnected ? getConnectionUrl(connection.id, "health") : undefined}');
    expect(source).toMatch(/icon=\{IconNames\.EYE_OPEN\}[\s\S]*text=\{t\("Connection info"\)\}/);
    expect(source).toMatch(/icon=\{IconNames\.DESKTOP\}[\s\S]*text=\{t\("System info"\)\}/);
    expect(source).toContain('text={t("Connection info")}');
    expect(source).toContain('text={t("System info")}');
    expect(source).toContain('text={t("Engine health")}');
    expect(source).toContain("disabled={!isConnected}");
    expect(source).not.toContain("IconNames.POWER");
  });

  it("moves detail-view navigation to the left rail, keeping only reload in the header", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/ActionsMenu.tsx"), "utf8");
    const detailMenuSource = source.slice(source.indexOf("export const ConnectionDetailsActionsMenu"));

    expect(detailMenuSource).toContain("export const ConnectionDetailsActionsMenu");
    expect(detailMenuSource).toContain("<ResourceListActions");
    expect(detailMenuSource).toContain("onReload={onReload}");
    // The view navigation is no longer a header ButtonGroup — it moved to the rail.
    expect(detailMenuSource).not.toContain("navigation={navigation}");
  });

  it("renders the connection detail views as an ordered left rail", () => {
    const railSource = readFileSync(path.resolve("src/web-app/screens/Connections/ConnectionDetailRail.tsx"), "utf8");

    expect(railSource).toContain("getConnectionUrl(connectionId, item.view)");
    expect(railSource).toContain('"Connection info"');
    expect(railSource).toContain('"System info"');
    expect(railSource).toContain('"Engine health"');
    const views = railSource.slice(railSource.indexOf("CONNECTION_DETAIL_VIEWS"));
    expect(views.indexOf('"connection-info"')).toBeLessThan(views.indexOf('"system-info"'));
    expect(views.indexOf('"system-info"')).toBeLessThan(views.indexOf('"health"'));
  });
});
