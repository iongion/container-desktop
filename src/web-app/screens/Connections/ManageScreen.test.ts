import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("connections manage screen", () => {
  it("does not render socket/API paths in the connection list", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/ManageScreen.tsx"), "utf8");

    expect(source).not.toContain("PlatformConnectionUri");
    expect(source).not.toContain("CopyToClipboardInput");
  });

  it("links each connection name to its scoped Connection info page", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/ManageScreen.tsx"), "utf8");

    expect(source).toContain('href={getConnectionUrl(connection.id, "connection-info")}');
    expect(source).toContain('className="PlatformConnectionName PlatformConnectionNameLink"');
    expect(source).not.toContain('<p className="PlatformConnectionName">{connection.name}</p>');
  });
});
