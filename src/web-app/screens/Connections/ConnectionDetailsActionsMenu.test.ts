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

  it("follows the detail-screen tab and reload pattern", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/ActionsMenu.tsx"), "utf8");
    const detailMenuSource = source.slice(source.indexOf("export const ConnectionDetailsActionsMenu"));

    expect(detailMenuSource).toContain("export const ConnectionDetailsActionsMenu");
    expect(detailMenuSource).toContain('href={getConnectionUrl(connectionId, "connection-info")}');
    expect(detailMenuSource).toContain('href={getConnectionUrl(connectionId, "health")}');
    expect(detailMenuSource).toContain('href={getConnectionUrl(connectionId, "system-info")}');
    expect(detailMenuSource).toMatch(/icon=\{IconNames\.EYE_OPEN\}[\s\S]*text=\{t\("Connection info"\)\}/);
    expect(detailMenuSource).toMatch(/icon=\{IconNames\.DESKTOP\}[\s\S]*text=\{t\("System info"\)\}/);
    expect(detailMenuSource).toContain('text={t("Connection info")}');
    expect(detailMenuSource).toContain('text={t("Engine health")}');
    expect(detailMenuSource).toContain('text={t("System info")}');
    expect(detailMenuSource.indexOf('text={t("Connection info")}')).toBeLessThan(
      detailMenuSource.indexOf('text={t("System info")}'),
    );
    expect(detailMenuSource.indexOf('text={t("System info")}')).toBeLessThan(
      detailMenuSource.indexOf('text={t("Engine health")}'),
    );
    expect(detailMenuSource).toContain("<ResourceListActions");
    expect(detailMenuSource).toContain("navigation={navigation}");
    expect(detailMenuSource).toContain("onReload={onReload}");
  });
});
