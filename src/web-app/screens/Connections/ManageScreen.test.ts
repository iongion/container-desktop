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

  it("filters the connections list through the standard app screen search field", () => {
    const source = readFileSync(path.resolve("src/web-app/screens/Connections/ManageScreen.tsx"), "utf8");

    expect(source).toContain('import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";');
    expect(source).toContain("const createConnectionSearchFilter = (searchTerm: string)");
    expect(source).toContain("const { searchTerm, onSearchChange } = useAppScreenSearch();");
    expect(source).toContain("const filteredConnections = useMemo(");
    expect(source).toContain("connections.filter(createConnectionSearchFilter(searchTerm))");
    expect(source).toContain("<ScreenHeader");
    expect(source).toContain("searchTerm={searchTerm}");
    expect(source).toContain("onSearch={onSearchChange}");
    expect(source).toContain("filteredConnections.map((connection, index) => {");
  });
});
