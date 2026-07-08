import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("connections screen header", () => {
  it("does not expose connection detail pages as global header tabs", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/ScreenHeader.tsx"), "utf8");

    expect(source).not.toContain("connections.connection-info");
    expect(source).not.toContain('getConnectionsUrl("connection-info")');
    expect(source).not.toContain("Connection info");
    expect(source).not.toContain("connections.system-info");
    expect(source).not.toContain('getConnectionsUrl("system-info")');
    expect(source).not.toContain("System info");
    expect(source).not.toContain("connections.health");
    expect(source).not.toContain('getConnectionsUrl("health")');
    expect(source).not.toContain("Health");
  });
});
