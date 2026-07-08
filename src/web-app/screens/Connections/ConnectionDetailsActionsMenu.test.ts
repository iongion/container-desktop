import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("connection details actions menu", () => {
  it("follows the detail-screen tab and reload pattern", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/ActionsMenu.tsx"), "utf8");

    expect(source).toContain("export const ConnectionDetailsActionsMenu");
    expect(source).toContain('href={getConnectionUrl(connectionId, "connection-info")}');
    expect(source).toContain('href={getConnectionUrl(connectionId, "health")}');
    expect(source).toContain('href={getConnectionUrl(connectionId, "system-info")}');
    expect(source).toContain('text={t("Connection info")}');
    expect(source).toContain('text={t("Engine health")}');
    expect(source).toContain('text={t("System info")}');
    expect(source.indexOf('text={t("Engine health")}')).toBeLessThan(source.indexOf('text={t("Connection info")}'));
    expect(source.indexOf('text={t("Connection info")}')).toBeLessThan(source.indexOf('text={t("System info")}'));
    expect(source).toContain("<ResourceListActions");
    expect(source).toContain("navigation={navigation}");
    expect(source).toContain("onReload={onReload}");
  });
});
